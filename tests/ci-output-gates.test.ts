import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest, type WorksIsland } from '../scripts/gates/islands.ts';
import { checkZeroJs } from '../scripts/gates/zero-js.ts';
import { checkOrigins, isNonSameOrigin, scanHtmlResources } from '../scripts/gates/origins.ts';
import { checkLinksAndAnchors, extractHtmlLinksAndAnchors } from '../scripts/gates/links.ts';
import { checkCanonicalAndSitemap, parseMetaRefreshRedirect } from '../scripts/gates/canonical-sitemap.ts';
import { isRedirectHtml } from '../scripts/gates/axe.ts';
import { lintColourLiterals, lintThemeCss, lintLedgerGaps, lintAstroContent, lintTsScriptContent, runCssLints } from '../scripts/gates/css-lint.ts';
import { lintReleasedPicotol, lintCreditsCompleteness } from '../scripts/gates/integrity-lint.ts';
import { checkBudgets, extractPageAssets, getPageType } from '../scripts/gates/budgets.ts';

test('islands manifest cross-check: empty MVP manifest passes with 0 JS dist', () => {
  const emptyManifest: WorksIsland[] = [];
  const errors = validateManifest(emptyManifest);
  assert.equal(errors.length, 0);
});

test('islands manifest: rejects non-/works/** routes', () => {
  const invalidManifest: WorksIsland[] = [
    {
      route: '/words/my-essay/',
      reason: 'Interactive essay',
      js: true,
      origins: [],
    },
  ];
  const errors = validateManifest(invalidManifest);
  assert.equal(errors.length, 1);
  assert.match(errors[0].error, /must be under \/works\/\*\*/);
});

test('islands manifest: rejects invalid origin URLs', () => {
  const invalidManifest: WorksIsland[] = [
    {
      route: '/works/demo/',
      reason: 'Demo widget',
      js: false,
      origins: [{ origin: 'not-a-url', reason: 'bad url' }],
    },
  ];
  const errors = validateManifest(invalidManifest);
  assert.equal(errors.length, 1);
  assert.match(errors[0].error, /Invalid origin URL/);
});

test('zero-js gate: detects unauthorized <script> in HTML', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-zero-js-test');
  fs.mkdirSync(tmpDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(tmpDir, 'index.html'),
    '<!doctype html><html><head><script>console.log("bad")</script></head><body></body></html>'
  );

  const result = checkZeroJs(tmpDir, []);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Forbidden <script> tag found in HTML route/);
});

test('zero-js gate: permits declared /works/** island with js: true', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-zero-js-works');
  const worksDir = path.join(tmpDir, 'works', 'interactive-sim');
  fs.mkdirSync(worksDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(worksDir, 'index.html'),
    '<!doctype html><html><head><script src="/works/interactive-sim/app.js"></script></head><body></body></html>'
  );

  const manifest: WorksIsland[] = [
    {
      route: '/works/interactive-sim/',
      reason: 'Interactive simulation island',
      js: true,
      origins: [],
    },
  ];

  const result = checkZeroJs(tmpDir, manifest);
  assert.equal(result.ok, true);
});

test('zero-js gate: fails when declared route has no script (stale declaration)', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-zero-js-stale');
  const worksDir = path.join(tmpDir, 'works', 'interactive-sim');
  fs.mkdirSync(worksDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(worksDir, 'index.html'),
    '<!doctype html><html><head></head><body>No scripts here</body></html>'
  );

  const manifest: WorksIsland[] = [
    {
      route: '/works/interactive-sim/',
      reason: 'Stale declaration',
      js: true,
      origins: [],
    },
  ];

  const result = checkZeroJs(tmpDir, manifest);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /stale declaration/);
});

test('zero-js gate: rejects invalid manifest (non-/works/** route)', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-zero-js-manifest-invalid-route');
  fs.mkdirSync(tmpDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const invalidManifest: WorksIsland[] = [
    {
      route: '/words/invalid-route/',
      reason: 'Interactive essay outside /works/**',
      js: false,
      origins: [],
    },
  ];

  const result = checkZeroJs(tmpDir, invalidManifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('must be under /works/**')));
});

test('zero-js gate: rejects invalid manifest (invalid origin URL)', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-zero-js-manifest-invalid-origin');
  fs.mkdirSync(tmpDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const invalidManifest: WorksIsland[] = [
    {
      route: '/works/demo/',
      reason: 'Demo island with malformed origin',
      js: false,
      origins: [{ origin: 'not-a-valid-url', reason: 'bad url' }],
    },
  ];

  const result = checkZeroJs(tmpDir, invalidManifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('Invalid origin URL')));
});

test('origins gate: detects unauthorized third-party resource attributes', () => {
  const html = `
    <html>
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto">
      </head>
      <body>
        <img src="https://cdn.example.com/image.png" alt="example">
        <a href="https://external-link.org">Outbound links are NOT scanned</a>
      </body>
    </html>
  `;

  const urls = scanHtmlResources(html);
  assert.equal(urls.length, 2);
  assert.ok(urls.includes('https://fonts.googleapis.com/css?family=Roboto'));
  assert.ok(urls.includes('https://cdn.example.com/image.png'));
  assert.ok(!urls.includes('https://external-link.org'));

  const parsed1 = isNonSameOrigin('https://fonts.googleapis.com/css?family=Roboto');
  assert.equal(parsed1.isExternal, true);
  assert.equal(parsed1.origin, 'https://fonts.googleapis.com');

  const parsedLocal = isNonSameOrigin('/fonts/font.woff2');
  assert.equal(parsedLocal.isExternal, false);
});

test('origins gate: js grant never grants an origin', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-origin-test');
  const worksDir = path.join(tmpDir, 'works', 'map');
  fs.mkdirSync(worksDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(worksDir, 'index.html'),
    '<!doctype html><html><head><script src="https://api.mapbox.com/mapbox.js"></script></head><body></body></html>'
  );

  // Route grants JS, but does NOT list the mapbox origin
  const manifest: WorksIsland[] = [
    {
      route: '/works/map/',
      reason: 'Map viewer',
      js: true,
      origins: [],
    },
  ];

  const result = checkOrigins(tmpDir, manifest);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Unauthorized third-party origin "https:\/\/api\.mapbox\.com"/);
});

test('origins gate: rejects invalid manifest (non-/works/** route)', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-origins-manifest-invalid-route');
  fs.mkdirSync(tmpDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const invalidManifest: WorksIsland[] = [
    {
      route: '/words/invalid-route/',
      reason: 'Route outside /works/**',
      js: false,
      origins: [],
    },
  ];

  const result = checkOrigins(tmpDir, invalidManifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('must be under /works/**')));
});

test('origins gate: rejects invalid manifest (invalid origin URL)', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-origins-manifest-invalid-origin');
  fs.mkdirSync(tmpDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const invalidManifest: WorksIsland[] = [
    {
      route: '/works/demo/',
      reason: 'Demo island with malformed origin',
      js: false,
      origins: [{ origin: 'not-a-valid-url', reason: 'bad url' }],
    },
  ];

  const result = checkOrigins(tmpDir, invalidManifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('Invalid origin URL')));
});

test('internal links gate: verifies anchors and enforces trailing slash', () => {
  const html = `
    <html>
      <body>
        <h2 id="section-1">Section 1</h2>
        <a href="#section-1">Local Anchor</a>
        <a href="/words/">Valid Words</a>
        <a href="/words/no-slash">Invalid No Slash</a>
      </body>
    </html>
  `;
  const { links, anchors } = extractHtmlLinksAndAnchors(html);
  assert.ok(anchors.includes('section-1'));
  assert.ok(links.includes('#section-1'));
  assert.ok(links.includes('/words/'));
  assert.ok(links.includes('/words/no-slash'));
});

test('css-lint: flags raw color literals and verifies theme.css invariants', () => {
  const badCss = `
    .badge {
      background-color: #ff0000;
      color: rgb(0, 0, 0);
      border: 1px solid blue;
    }
  `;
  const colorErrors = lintColourLiterals(badCss, 'bad.css');
  assert.equal(colorErrors.length, 3);
  assert.match(colorErrors[0], /raw hex color literal/);
  assert.match(colorErrors[1], /raw functional color/);
  assert.match(colorErrors[2], /raw named color/);

  const invalidThemeCss = `
    @font-face {
      font-family: 'BadFont';
      src: url('https://external.com/font.woff2');
    }
    .custom-class {
      display: block;
    }
  `;
  const themeErrors = lintThemeCss(invalidThemeCss);
  assert.equal(themeErrors.length, 2);
});

test('css-lint: verifies picotol-gaps.css ledger citations', () => {
  const validGaps = `
    /* kidthales/picotol#12: add support for compact callout */
    .callout-compact {
      margin: 0;
    }
  `;
  const { errors: validErrors, ledgerCount: count1 } = lintLedgerGaps(validGaps);
  assert.equal(validErrors.length, 0);
  assert.equal(count1, 1);

  const uncitedGaps = `
    .uncited {
      margin: 0;
    }
  `;
  const { errors: uncitedErrors } = lintLedgerGaps(uncitedGaps);
  assert.equal(uncitedErrors.length, 1);
  assert.match(uncitedErrors[0], /does not cite upstream issue/);
});

test('css-lint: runCssLints scans theme, gaps, astro, and ts scripts successfully', () => {
  const stylesDir = path.join(process.cwd(), 'src', 'styles');
  const result = runCssLints(stylesDir);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.themeChecksPassed, true);
  assert.equal(typeof result.ledgerCount, 'number');
});

test('css-lint: scans <style> blocks in .astro files for raw colour literals', () => {
  const cleanAstro = `
    ---
    const title = 'Clean Component';
    ---
    <div class="box">Clean</div>
    <style>
      .box {
        color: var(--pt-color);
        background: var(--pt-card-bg);
        border: 1px solid var(--pt-muted-border);
      }
    </style>
  `;
  const cleanErrors = lintAstroContent(cleanAstro, 'Clean.astro');
  assert.equal(cleanErrors.length, 0);

  const dirtyAstro = `
    ---
    const title = 'Dirty Component';
    ---
    <div class="box">Dirty</div>
    <style>
      .box {
        color: #ff0000;
        background: rgb(255, 255, 255);
        border-color: red;
      }
    </style>
  `;
  const dirtyErrors = lintAstroContent(dirtyAstro, 'Dirty.astro');
  assert.equal(dirtyErrors.length, 3);
  assert.match(dirtyErrors[0], /raw hex color literal/);
  assert.match(dirtyErrors[1], /raw functional color/);
  assert.match(dirtyErrors[2], /raw named color/);
});

test('css-lint: scans string and template literals with CSS property-like syntax in .ts files', () => {
  const cleanTs = `
    export function renderSvg() {
      const badge = \`<circle cx="10" cy="10" r="5" fill="var(--pt-card-bg)" stroke="var(--pt-status-info-border)" />\`;
      const text = '<text fill="var(--pt-status-info-fg)">1</text>';
      return badge + text;
    }
  `;
  const cleanErrors = lintTsScriptContent(cleanTs, 'clean.ts');
  assert.equal(cleanErrors.length, 0);

  const dirtyTs = `
    export function renderSvg() {
      const hexSvg = \`<circle cx="10" cy="10" r="5" fill="#aabbcc" />\`;
      const namedSvg = '<rect width="10" height="10" fill="blue" stroke="rgb(0,0,0)" />';
      return hexSvg + namedSvg;
    }
  `;
  const dirtyErrors = lintTsScriptContent(dirtyTs, 'dirty.ts');
  assert.equal(dirtyErrors.length, 3);
  assert.match(dirtyErrors[0], /raw hex color literal/);
  assert.match(dirtyErrors[1], /raw named color/);
  assert.match(dirtyErrors[2], /raw functional color/);
});

test('integrity-lint: verifies exact semver picotol and font credits completeness', () => {
  const goodPkgPath = path.join(process.cwd(), 'package.json');
  const picotolErrors = lintReleasedPicotol(goodPkgPath);
  assert.equal(picotolErrors.length, 0);

  const creditsPath = path.join(process.cwd(), 'src/pages/credits.astro');
  const creditsErrors = lintCreditsCompleteness(goodPkgPath, creditsPath);
  assert.equal(creditsErrors.length, 0);
});

test('end-to-end output gates: checkCanonicalAndSitemap, checkLinksAndAnchors, checkBudgets work on simulated valid build', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-e2e-dist');
  fs.mkdirSync(path.join(tmpDir, 'words'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '_astro'), { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Create simulated valid dist
  fs.writeFileSync(
    path.join(tmpDir, 'index.html'),
    '<!doctype html><html><head><link rel="canonical" href="https://kidthales.github.io/"><title>Home</title></head><body><h1 id="top">Home</h1><a href="/words/">Words</a><a href="#top">Top</a></body></html>'
  );

  fs.writeFileSync(
    path.join(tmpDir, 'words', 'index.html'),
    '<!doctype html><html><head><link rel="canonical" href="https://kidthales.github.io/words/"><title>Words</title></head><body><a href="/">Home</a></body></html>'
  );

  fs.writeFileSync(
    path.join(tmpDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://kidthales.github.io/</loc></url>
  <url><loc>https://kidthales.github.io/words/</loc></url>
</urlset>`
  );

  fs.writeFileSync(path.join(tmpDir, 'fonts', 'font.woff2'), Buffer.alloc(100));
  fs.writeFileSync(path.join(tmpDir, '_astro', 'main.css'), 'body { margin: 0; }');

  const canonicalRes = checkCanonicalAndSitemap(tmpDir);
  assert.equal(canonicalRes.ok, true);

  const linksRes = checkLinksAndAnchors(tmpDir);
  assert.equal(linksRes.ok, true);

  const testBudgetsPath = path.join(tmpDir, 'budgets.json');
  fs.writeFileSync(
    testBudgetsPath,
    JSON.stringify({
      pageBudgets: {
        index: { measuredCompressedBytes: 50, maxCompressedBytes: 1000 },
      },
      assetBudgets: {
        totalWoff2Bytes: { measuredBytes: 100, maxBytes: 1000 },
      },
    })
  );

  const budgetRes = checkBudgets(tmpDir, testBudgetsPath);
  assert.equal(budgetRes.ok, true);
});

test('redirect gates: parseMetaRefreshRedirect & isRedirectHtml parse redirect stubs correctly', () => {
  const redirectHtml = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="refresh" content="0;url=/works/spiderex/" />
        <meta name="robots" content="noindex" />
        <link rel="canonical" href="https://kidthales.github.io/works/spiderex/" />
      </head>
      <body>
        <p>Redirecting to <a href="/works/spiderex/">Spiderex</a>...</p>
      </body>
    </html>
  `;

  const parsed = parseMetaRefreshRedirect(redirectHtml);
  assert.equal(parsed.isRedirect, true);
  assert.equal(parsed.target, '/works/spiderex/');
  assert.equal(isRedirectHtml(redirectHtml), true);

  const normalHtml = `
    <!doctype html>
    <html>
      <head><title>Normal</title></head>
      <body><h1>Normal</h1></body>
    </html>
  `;
  const normalParsed = parseMetaRefreshRedirect(normalHtml);
  assert.equal(normalParsed.isRedirect, false);
  assert.equal(normalParsed.target, null);
  assert.equal(isRedirectHtml(normalHtml), false);
});

test('canonical & sitemap gate: verifies redirect stubs require noindex, canonical to target, and sitemap omission', (t) => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'temp-redirect-gate');
  const spiderexDir = path.join(tmpDir, 'spiderex');
  const worksSpiderexDir = path.join(tmpDir, 'works', 'spiderex');
  fs.mkdirSync(spiderexDir, { recursive: true });
  fs.mkdirSync(worksSpiderexDir, { recursive: true });
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Valid target page
  fs.writeFileSync(
    path.join(worksSpiderexDir, 'index.html'),
    '<!doctype html><html><head><link rel="canonical" href="https://kidthales.github.io/works/spiderex/"><title>Spiderex</title></head><body><h1>Spiderex</h1></body></html>'
  );

  // Valid redirect stub
  fs.writeFileSync(
    path.join(spiderexDir, 'index.html'),
    `<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=/works/spiderex/" />
      <meta name="robots" content="noindex" />
      <link rel="canonical" href="https://kidthales.github.io/works/spiderex/" />
    </head><body><p>Redirecting...</p></body></html>`
  );

  // Valid sitemap omitting /spiderex/
  fs.writeFileSync(
    path.join(tmpDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://kidthales.github.io/works/spiderex/</loc></url>
</urlset>`
  );

  const validResult = checkCanonicalAndSitemap(tmpDir);
  assert.equal(validResult.ok, true);

  // Failure scenario 1: redirect stub missing noindex
  fs.writeFileSync(
    path.join(spiderexDir, 'index.html'),
    `<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=/works/spiderex/" />
      <link rel="canonical" href="https://kidthales.github.io/works/spiderex/" />
    </head><body><p>Redirecting...</p></body></html>`
  );
  const noNoindexResult = checkCanonicalAndSitemap(tmpDir);
  assert.equal(noNoindexResult.ok, false);
  assert.ok(noNoindexResult.errors.some((e) => e.includes('must have <meta name="robots" content="noindex">')));

  // Failure scenario 2: redirect stub canonical pointing to self (/spiderex/) instead of destination
  fs.writeFileSync(
    path.join(spiderexDir, 'index.html'),
    `<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=/works/spiderex/" />
      <meta name="robots" content="noindex" />
      <link rel="canonical" href="https://kidthales.github.io/spiderex/" />
    </head><body><p>Redirecting...</p></body></html>`
  );
  const badCanonicalResult = checkCanonicalAndSitemap(tmpDir);
  assert.equal(badCanonicalResult.ok, false);
  assert.ok(badCanonicalResult.errors.some((e) => e.includes('Canonical URL mismatch')));

  // Failure scenario 3: redirect stub included in sitemap.xml
  fs.writeFileSync(
    path.join(spiderexDir, 'index.html'),
    `<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=/works/spiderex/" />
      <meta name="robots" content="noindex" />
      <link rel="canonical" href="https://kidthales.github.io/works/spiderex/" />
    </head><body><p>Redirecting...</p></body></html>`
  );
  fs.writeFileSync(
    path.join(tmpDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://kidthales.github.io/spiderex/</loc></url>
  <url><loc>https://kidthales.github.io/works/spiderex/</loc></url>
</urlset>`
  );
  const sitemapLeakResult = checkCanonicalAndSitemap(tmpDir);
  assert.equal(sitemapLeakResult.ok, false);
  assert.ok(sitemapLeakResult.errors.some((e) => e.includes('points to a page marked with noindex') || e.includes('points to a redirect page')));
});

test('budgets gate: extractPageAssets and getPageType handle works vs workIsland correctly', () => {
  const htmlWithoutJs = `
    <html>
      <head>
        <link rel="stylesheet" href="/_astro/main.123456.css" />
      </head>
      <body><h1>Static</h1></body>
    </html>
  `;
  const assets1 = extractPageAssets(htmlWithoutJs);
  assert.deepEqual(assets1.cssAssets, ['/_astro/main.123456.css']);
  assert.deepEqual(assets1.jsAssets, []);
  assert.equal(getPageType('works/sample-game/index.html', assets1.jsAssets.length > 0), 'work');

  const htmlWithJs = `
    <html>
      <head>
        <link rel="stylesheet" href="/_astro/main.123456.css" />
        <script type="module" src="/_astro/spiderex-trainer.789012.js"></script>
      </head>
      <body><spiderex-trainer></spiderex-trainer></body>
    </html>
  `;
  const assets2 = extractPageAssets(htmlWithJs);
  assert.deepEqual(assets2.cssAssets, ['/_astro/main.123456.css']);
  assert.deepEqual(assets2.jsAssets, ['/_astro/spiderex-trainer.789012.js']);
  assert.equal(getPageType('works/spiderex/index.html', assets2.jsAssets.length > 0), 'workIsland');
});
