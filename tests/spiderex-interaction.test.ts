import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function ensureDistBuilt(distDir: string): void {
  const targetHtml = path.join(distDir, 'works', 'spiderex', 'index.html');
  if (!fs.existsSync(targetHtml)) {
    execSync('npx astro build', { stdio: 'pipe' });
  }
}

function createStaticServer(distDir: string): Promise<{ server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url?.split('?')[0] || '/';
      if (reqPath.endsWith('/')) {
        reqPath += 'index.html';
      }
      const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(distDir, safePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        baseUrl,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

test('spiderex-trainer interaction: hydration, variant stepper v1 -> v2, string count selector, and URL query sync', async () => {
  const distDir = path.join(process.cwd(), 'dist');
  ensureDistBuilt(distDir);

  const { baseUrl, close: closeServer } = await createStaticServer(distDir);
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();

  try {
    // -------------------------------------------------------------
    // 1. Initial Hydration Verification
    // -------------------------------------------------------------
    await page.goto(`${baseUrl}/works/spiderex/`, { waitUntil: 'networkidle' });

    // Verify custom element is defined and present
    const trainerCount = await page.locator('spiderex-trainer').count();
    assert.equal(trainerCount, 1, '<spiderex-trainer> island element must exist in DOM');

    // Controls must be hydrated with expected initial defaults
    const variantBadge = page.locator('#spiderex-variant-badge');
    assert.equal(await variantBadge.textContent(), 'v1');

    const prevBtn = page.locator('#spiderex-prev');
    assert.equal(await prevBtn.isDisabled(), true, 'Previous variant button must be disabled at v1');

    const nextBtn = page.locator('#spiderex-next');
    assert.equal(await nextBtn.isEnabled(), true, 'Next variant button must be enabled');

    const stringsSelect = page.locator('#spiderex-strings');
    assert.equal(await stringsSelect.inputValue(), '6', 'Initial strings selection must default to 6');

    const skipCheckbox = page.locator('#spiderex-skip');
    assert.equal(await skipCheckbox.isChecked(), false, 'String skipping must be unchecked initially');

    const metaSummary = page.locator('#spiderex-meta-summary');
    const summaryText = (await metaSummary.textContent()) ?? '';
    assert.ok(summaryText.includes('(v1)'), `Summary should include (v1): "${summaryText}"`);
    assert.ok(summaryText.includes('6 Strings'), `Summary should include 6 Strings: "${summaryText}"`);
    assert.ok(summaryText.includes('Adjacent'), `Summary should include Adjacent mode: "${summaryText}"`);
    assert.ok(summaryText.includes('Seed: 0x'), `Summary should include hex seed: "${summaryText}"`);

    // Verify SVG fretboard and Twister systems are rendered
    const fretboardSvg = page.locator('#spiderex-warmup-fretboard svg');
    assert.ok((await fretboardSvg.count()) >= 1, 'Warmup fretboard SVG must be rendered');

    const twisterRows = page.locator('#spiderex-twister-systems svg.twister-system');
    assert.equal(await twisterRows.count(), 4, 'Must render exactly 4 twister systems');

    // -------------------------------------------------------------
    // 2. Variant Stepper Interaction (v1 -> v2 and return)
    // -------------------------------------------------------------
    await nextBtn.click();
    assert.equal(await variantBadge.textContent(), 'v2', 'Variant badge must increment to v2');
    assert.equal(await prevBtn.isEnabled(), true, 'Previous variant button must become enabled at v2');

    const summaryV2 = (await metaSummary.textContent()) ?? '';
    assert.ok(summaryV2.includes('(v2)'), `Summary should update to (v2): "${summaryV2}"`);
    assert.notEqual(summaryV2, summaryText, 'Seed/summary must change on variant increment');

    // Verify URL query sync on variant step
    const urlAfterNext = new URL(page.url());
    assert.equal(urlAfterNext.searchParams.get('variant'), '2');
    assert.equal(urlAfterNext.searchParams.get('strings'), '6');
    assert.equal(urlAfterNext.searchParams.get('skip'), '0');

    // Step back to v1
    await prevBtn.click();
    assert.equal(await variantBadge.textContent(), 'v1', 'Variant badge must decrement back to v1');
    assert.equal(await prevBtn.isDisabled(), true, 'Previous variant button must be disabled at v1');

    const urlAfterPrev = new URL(page.url());
    assert.equal(urlAfterPrev.searchParams.get('variant'), '1');

    // -------------------------------------------------------------
    // 3. String Count Selector Interaction (6 -> 7 -> 4)
    // -------------------------------------------------------------
    await stringsSelect.selectOption('7');
    assert.equal(await stringsSelect.inputValue(), '7');

    const summary7 = (await metaSummary.textContent()) ?? '';
    assert.ok(summary7.includes('7 Strings'), `Summary must reflect 7 Strings: "${summary7}"`);

    const urlAfter7 = new URL(page.url());
    assert.equal(urlAfter7.searchParams.get('strings'), '7');

    await stringsSelect.selectOption('4');
    assert.equal(await stringsSelect.inputValue(), '4');

    const summary4 = (await metaSummary.textContent()) ?? '';
    assert.ok(summary4.includes('4 Strings'), `Summary must reflect 4 Strings: "${summary4}"`);

    const urlAfter4 = new URL(page.url());
    assert.equal(urlAfter4.searchParams.get('strings'), '4');

    // -------------------------------------------------------------
    // 4. String-Skipping Toggle Interaction
    // -------------------------------------------------------------
    await skipCheckbox.check();
    assert.equal(await skipCheckbox.isChecked(), true);

    const summarySkipping = (await metaSummary.textContent()) ?? '';
    assert.ok(summarySkipping.includes('String-Skipping'), `Summary must reflect String-Skipping: "${summarySkipping}"`);

    const urlAfterSkip = new URL(page.url());
    assert.equal(urlAfterSkip.searchParams.get('skip'), '1');

    await skipCheckbox.uncheck();
    assert.equal(await skipCheckbox.isChecked(), false);

    const summaryAdjacent = (await metaSummary.textContent()) ?? '';
    assert.ok(summaryAdjacent.includes('Adjacent'), `Summary must reflect Adjacent mode: "${summaryAdjacent}"`);

    const urlAfterUnskip = new URL(page.url());
    assert.equal(urlAfterUnskip.searchParams.get('skip'), '0');

    // -------------------------------------------------------------
    // 5. URL Query Sync On Direct Load
    // -------------------------------------------------------------
    await page.goto(`${baseUrl}/works/spiderex/?date=2026-05-15&variant=3&strings=4&skip=1`, { waitUntil: 'networkidle' });

    const dateInput = page.locator('#spiderex-date');
    assert.equal(await dateInput.inputValue(), '2026-05-15', 'Date input must hydrate from query param');
    assert.equal(await variantBadge.textContent(), 'v3', 'Variant must hydrate from query param');
    assert.equal(await stringsSelect.inputValue(), '4', 'Strings must hydrate from query param');
    assert.equal(await skipCheckbox.isChecked(), true, 'Skip checkbox must hydrate from query param');

    const summaryDeepLink = (await metaSummary.textContent()) ?? '';
    assert.ok(summaryDeepLink.includes('2026-05-15'), `Summary should include query date: "${summaryDeepLink}"`);
    assert.ok(summaryDeepLink.includes('(v3)'), `Summary should include query variant v3: "${summaryDeepLink}"`);
    assert.ok(summaryDeepLink.includes('4 Strings'), `Summary should include 4 Strings: "${summaryDeepLink}"`);
    assert.ok(summaryDeepLink.includes('String-Skipping'), `Summary should include String-Skipping: "${summaryDeepLink}"`);
  } finally {
    await page.close();
    await browser.close();
    await closeServer();
  }
});
