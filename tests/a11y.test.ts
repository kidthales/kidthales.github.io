import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  parseHex,
  relativeLuminance,
  calculateContrastRatio,
  extractCssTokens,
  resolveTokenHex,
  checkContrastPairs,
  type TokenPair,
} from '../scripts/gates/contrast-pairs.ts';
import {
  findHtmlFiles,
  filePathToRoute,
  nodeMatchesSelector,
  runAxeAudit,
} from '../scripts/gates/axe.ts';

test('contrast-pairs: parseHex, relativeLuminance and calculateContrastRatio calculations', () => {
  // Test black and white
  assert.deepEqual(parseHex('#000000'), [0, 0, 0]);
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('#FFFFFF'), [255, 255, 255]);

  const lumWhite = relativeLuminance(255, 255, 255);
  const lumBlack = relativeLuminance(0, 0, 0);
  assert.equal(lumWhite, 1);
  assert.equal(lumBlack, 0);

  const ratioBW = calculateContrastRatio('#ffffff', '#000000');
  assert.equal(Math.round(ratioBW), 21);

  // Throws on bad hex
  assert.throws(() => parseHex('#badcolor'));
});

test('contrast-pairs: extractCssTokens and resolveTokenHex correctly handles light-dark and var', () => {
  const css = `
    :root {
      --pt-bg: light-dark(#FFFFFF, #000000);
      --pt-color: light-dark(#000000, #FFFFFF);
      --pt-card-bg: var(--pt-bg);
      --pt-p1: #AACCEE;
      --pt-p4: #2255AA;
      --pt-primary: light-dark(var(--pt-p4), var(--pt-p1));
    }
  `;
  const tokens = extractCssTokens(css);
  assert.ok(tokens.has('--pt-bg'));
  assert.ok(tokens.has('--pt-primary'));

  const bgLight = resolveTokenHex('--pt-bg', 'light', tokens);
  const bgDark = resolveTokenHex('--pt-bg', 'dark', tokens);
  assert.equal(bgLight, '#FFFFFF');
  assert.equal(bgDark, '#000000');

  const cardLight = resolveTokenHex('--pt-card-bg', 'light', tokens);
  assert.equal(cardLight, '#FFFFFF');

  const primLight = resolveTokenHex('--pt-primary', 'light', tokens);
  const primDark = resolveTokenHex('--pt-primary', 'dark', tokens);
  assert.equal(primLight, '#2255AA');
  assert.equal(primDark, '#AACCEE');
});

test('contrast-pairs: checkContrastPairs gate passes on project tokens and fails on substandard pair', () => {
  const picotolTokens = path.join(process.cwd(), 'node_modules', '@kidthales', 'picotol', 'src', 'tokens.css');
  const themeCss = path.join(process.cwd(), 'src', 'styles', 'theme.css');

  // Audit passing pairs
  const gateResult = checkContrastPairs(picotolTokens, themeCss);
  assert.equal(gateResult.ok, true);
  assert.equal(gateResult.errors.length, 0);

  // Audit failing custom pair
  const badPairs: TokenPair[] = [
    { name: 'Low Contrast Failure Pair', fgToken: '--pt-surface', bgToken: '--pt-bg', minRatio: 4.5 },
  ];
  const failResult = checkContrastPairs(picotolTokens, themeCss, badPairs);
  assert.equal(failResult.ok, false);
  assert.ok(failResult.errors.length > 0);
  assert.match(failResult.errors[0], /Contrast failure: "Low Contrast Failure Pair"/);
});

test('axe: findHtmlFiles and filePathToRoute mapping', () => {
  const distDir = path.join(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    const files = findHtmlFiles(distDir);
    assert.ok(files.length > 0);

    const indexRoute = filePathToRoute(distDir, path.join(distDir, 'index.html'));
    assert.equal(indexRoute, '/');

    const wordsRoute = filePathToRoute(distDir, path.join(distDir, 'words', 'index.html'));
    assert.equal(wordsRoute, '/words/');
  }
});

test('axe: nodeMatchesSelector matches target selectors', () => {
  assert.equal(nodeMatchesSelector(['li > span[aria-hidden="true"]'], 'span[aria-hidden="true"]'), true);
  assert.equal(nodeMatchesSelector(['div.content > p'], 'span[aria-hidden="true"]'), false);
});

test('axe: stale allowlist entries cause gate failure', async () => {
  // Test using minimal simulated dist to test fast
  const tmpDist = path.join(process.cwd(), 'tests', 'fixtures', 'temp-stale-dist');
  fs.mkdirSync(tmpDist, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDist, 'index.html'),
    '<!doctype html><html lang="en"><head><title>Test</title></head><body><h1>Hello</h1></body></html>'
  );

  const tmpAllowlist = path.join(process.cwd(), 'tests', 'fixtures', 'temp-stale-allowlist.json');
  fs.writeFileSync(
    tmpAllowlist,
    JSON.stringify([
      {
        ruleId: 'color-contrast',
        selector: 'span.non-existent-selector-12345',
        issue: '#999',
        reason: 'Testing stale entry detection',
      },
    ])
  );

  try {
    const res = await runAxeAudit({ distDir: tmpDist, allowlistPath: tmpAllowlist });
    assert.equal(res.ok, false);
    assert.ok(res.staleAllowlistEntries.length > 0);
    assert.match(res.errors[0], /Stale allowlist entry/);
  } finally {
    if (fs.existsSync(tmpAllowlist)) {
      fs.unlinkSync(tmpAllowlist);
    }
    if (fs.existsSync(tmpDist)) {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  }
});
