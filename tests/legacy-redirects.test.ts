import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseMetaRefreshRedirect } from '../scripts/gates/canonical-sitemap.ts';
import { isRedirectHtml } from '../scripts/gates/axe.ts';

const EXPECTED_PGMMV_MAPPINGS: Record<string, { pageFile: string; route: string; targetUrl: string; canonicalUrl: string }> = {
  '/pgmmv/': {
    pageFile: 'src/pages/pgmmv/index.astro',
    route: '/pgmmv/',
    targetUrl: 'https://github.com/kidthales?tab=repositories&q=pgmmv-&type=&language=&sort=',
    canonicalUrl: 'https://kidthales.github.io/pgmmv/',
  },
  '/pgmmv/collision-plugin/': {
    pageFile: 'src/pages/pgmmv/collision-plugin.astro',
    route: '/pgmmv/collision-plugin/',
    targetUrl: 'https://github.com/kidthales/pgmmv-collision-plugin',
    canonicalUrl: 'https://kidthales.github.io/pgmmv/collision-plugin/',
  },
  '/pgmmv/coordinates-plugin/': {
    pageFile: 'src/pages/pgmmv/coordinates-plugin.astro',
    route: '/pgmmv/coordinates-plugin/',
    targetUrl: 'https://github.com/kidthales/pgmmv-coordinates-plugin',
    canonicalUrl: 'https://kidthales.github.io/pgmmv/coordinates-plugin/',
  },
  '/pgmmv/snap-to-tile-plugin/': {
    pageFile: 'src/pages/pgmmv/snap-to-tile-plugin.astro',
    route: '/pgmmv/snap-to-tile-plugin/',
    targetUrl: 'https://github.com/kidthales/pgmmv-snap-to-tile-plugin',
    canonicalUrl: 'https://kidthales.github.io/pgmmv/snap-to-tile-plugin/',
  },
  '/pgmmv/storage-plugin/': {
    pageFile: 'src/pages/pgmmv/storage-plugin.astro',
    route: '/pgmmv/storage-plugin/',
    targetUrl: 'https://github.com/kidthales/pgmmv-storage-plugin',
    canonicalUrl: 'https://kidthales.github.io/pgmmv/storage-plugin/',
  },
};

test('legacy-urls.txt: all entries map to verified active pages or redirect stubs', () => {
  const legacyUrlsFile = path.join(process.cwd(), 'legacy-urls.txt');
  assert.ok(fs.existsSync(legacyUrlsFile), 'legacy-urls.txt must exist at repo root');

  const content = fs.readFileSync(legacyUrlsFile, 'utf8');
  const urls = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  assert.equal(urls.length, 8, 'legacy-urls.txt must contain exactly 8 URLs');

  const expectedUrls = [
    'https://kidthales.github.io/',
    'https://kidthales.github.io/404.html',
    'https://kidthales.github.io/pgmmv/',
    'https://kidthales.github.io/pgmmv/collision-plugin/',
    'https://kidthales.github.io/pgmmv/coordinates-plugin/',
    'https://kidthales.github.io/pgmmv/snap-to-tile-plugin/',
    'https://kidthales.github.io/pgmmv/storage-plugin/',
    'https://kidthales.github.io/spiderex/',
  ];

  assert.deepEqual(urls, expectedUrls);

  // Verify file existence for each legacy URL
  for (const url of urls) {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    if (pathname === '/') {
      assert.ok(fs.existsSync(path.join(process.cwd(), 'src/pages/index.astro')));
    } else if (pathname === '/404.html') {
      assert.ok(fs.existsSync(path.join(process.cwd(), 'src/pages/404.astro')));
    } else if (pathname === '/spiderex/') {
      assert.ok(fs.existsSync(path.join(process.cwd(), 'src/pages/spiderex.astro')));
    } else if (EXPECTED_PGMMV_MAPPINGS[pathname]) {
      const { pageFile } = EXPECTED_PGMMV_MAPPINGS[pathname];
      assert.ok(fs.existsSync(path.join(process.cwd(), pageFile)), `Missing redirect page for ${pathname}`);
    } else {
      assert.fail(`Unrecognized legacy URL pathname: ${pathname}`);
    }
  }
});

test('pgmmv redirect stubs: comply with all site redirect invariants and target mappings', () => {
  for (const expected of Object.values(EXPECTED_PGMMV_MAPPINGS)) {
    const filePath = path.join(process.cwd(), expected.pageFile);
    assert.ok(fs.existsSync(filePath), `File does not exist: ${expected.pageFile}`);

    const content = fs.readFileSync(filePath, 'utf8');

    // 1. Zero client script tags
    assert.ok(!/<script\b/i.test(content), `${expected.pageFile} must contain 0 script tags`);

    // 2. Zero CSS stylesheets or external link tags (only canonical link allowed)
    const linkMatches = content.match(/<link\b[^>]*>/gi) || [];
    for (const link of linkMatches) {
      assert.ok(
        /\brel\s*=\s*["']canonical["']/i.test(link),
        `${expected.pageFile} has forbidden non-canonical <link> tag: ${link}`
      );
    }

    // 3. Frontmatter constants define exact target and self-canonical URLs
    const targetUrlMatch = /const\s+targetUrl\s*=\s*['"]([^'"]+)['"]/.exec(content);
    assert.ok(targetUrlMatch, `${expected.pageFile} must define targetUrl`);
    assert.equal(targetUrlMatch[1], expected.targetUrl, `${expected.pageFile} targetUrl must match spec`);

    const canonicalUrlMatch = /const\s+canonicalUrl\s*=\s*['"]([^'"]+)['"]/.exec(content);
    assert.ok(canonicalUrlMatch, `${expected.pageFile} must define canonicalUrl`);
    assert.equal(canonicalUrlMatch[1], expected.canonicalUrl, `${expected.pageFile} canonicalUrl must match self-canonical spec`);

    // 4. Robots noindex tag
    assert.ok(
      /<meta\b[^>]*?\bname\s*=\s*["']robots["'][^>]*?\bcontent\s*=\s*["'][^"']*noindex[^"']*["']/i.test(content) ||
      /<meta\b[^>]*?\bcontent\s*=\s*["'][^"']*noindex[^"']*["'][^>]*?\bname\s*=\s*["']robots["']/i.test(content),
      `${expected.pageFile} must have <meta name="robots" content="noindex" />`
    );

    // 5. Canonical link tag references canonicalUrl
    assert.ok(
      /<link\b[^>]*?\brel\s*=\s*["']canonical["'][^>]*?\bhref\s*=\s*\{canonicalUrl\}/i.test(content) ||
      /<link\b[^>]*?\bhref\s*=\s*\{canonicalUrl\}[^>]*?\brel\s*=\s*["']canonical["']/i.test(content),
      `${expected.pageFile} canonical <link> must bind to {canonicalUrl}`
    );

    // 6. Meta refresh tag references targetUrl
    assert.ok(
      /<meta\b[^>]*?\bhttp-equiv\s*=\s*["']refresh["'][^>]*?\bcontent\s*=\s*\{`0;url=\$\{targetUrl\}`\}/i.test(content) ||
      /<meta\b[^>]*?\bcontent\s*=\s*\{`0;url=\$\{targetUrl\}`\}[^>]*?\bhttp-equiv\s*=\s*["']refresh["']/i.test(content),
      `${expected.pageFile} meta refresh must bind to targetUrl`
    );

    // 7. Accessible fallback body link references targetUrl
    assert.ok(
      /<a\b[^>]*?\bhref\s*=\s*\{targetUrl\}[^>]*>(.*?)<\/a>/is.test(content),
      `${expected.pageFile} must have accessible body fallback anchor link binding to {targetUrl}`
    );

    // 8. Simulated rendered HTML passes parseMetaRefreshRedirect and isRedirectHtml
    const renderedHtml = `<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=${expected.targetUrl}" />
      <meta name="robots" content="noindex" />
      <link rel="canonical" href="${expected.canonicalUrl}" />
    </head><body><p>Redirecting to <a href="${expected.targetUrl}">fallback</a>...</p></body></html>`;

    const { isRedirect, target } = parseMetaRefreshRedirect(renderedHtml);
    assert.equal(isRedirect, true);
    assert.equal(target, expected.targetUrl);
    assert.equal(isRedirectHtml(renderedHtml), true);
  }
});
