import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CssLintResult {
  ok: boolean;
  errors: string[];
  themeChecksPassed: boolean;
  ledgerCount: number;
}

/**
 * 1. Colour lint: no colour literals outside picotol tokens in site CSS.
 * Raw colour literals include: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla(), oklab(), oklch(), or named colors (red, blue, etc. except transparent, currentColor, inherit, initial, unset).
 * Note: Metric fallback font-face or standard font-family names are not colors.
 */
const HEX_COLOR_REGEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/i;
const FUNCTIONAL_COLOR_REGEX = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/i;
const NAMED_COLOR_REGEX = /\b(?:black|white|red|green|blue|yellow|orange|purple|cyan|magenta|pink|brown|gray|grey)\b/i;

/**
 * Strips comments from CSS string
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Strips font-family declarations so font names like "Courier New" or fallback fonts don't trigger color or other false positives.
 */
function stripNonColorProperties(css: string): string {
  // Remove font-family: ... ; and font: ... ;
  return css.replace(/\b(?:font-family|font)\s*:[^;]+;/gi, '');
}

export function lintColourLiterals(cssContent: string, fileName: string): string[] {
  const errors: string[] = [];
  const clean = stripNonColorProperties(stripCssComments(cssContent));
  const lines = clean.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check hex
    const hexMatch = HEX_COLOR_REGEX.exec(line);
    if (hexMatch) {
      errors.push(`${fileName}:${i + 1} contains raw hex color literal "${hexMatch[0]}". Must use picotol tokens.`);
    }

    // Check functional colors
    const funcMatch = FUNCTIONAL_COLOR_REGEX.exec(line);
    if (funcMatch) {
      errors.push(`${fileName}:${i + 1} contains raw functional color "${funcMatch[0]}". Must use picotol tokens.`);
    }

    // Check named colors (only in property values, e.g. color: black; background: white;)
    if (line.includes(':')) {
      const value = line.split(':')[1];
      // Strip valid var(--pt-...) expressions so tokens like var(--pt-red) or var(--pt-yellow) are not falsely flagged
      const valueWithoutTokens = value.replace(/var\(--pt-[^)]+\)/g, '');
      const namedMatch = NAMED_COLOR_REGEX.exec(valueWithoutTokens);
      if (namedMatch) {
        errors.push(`${fileName}:${i + 1} contains raw named color "${namedMatch[0]}". Must use picotol tokens.`);
      }
    }
  }

  return errors;
}

/**
 * 2. theme.css lint:
 * Only documented --pt-* overrides, @font-face/@import of pinned fontsource packages,
 * and metric-override fallback @font-face blocks (src: local(...) + override descriptors: ascent-override, descent-override, line-gap-override, size-adjust).
 */
export function lintThemeCss(themeCssContent: string): string[] {
  const errors: string[] = [];
  // Parse blocks or inspect rules
  // Allowed rules:
  // - @font-face { ... }
  // - @import ... ;
  // - :root { ... } with only --pt-* properties!
  // Any other selector or unexpected CSS rule fails.

  const clean = stripCssComments(themeCssContent).trim();

  // Find all top-level statements/blocks
  // A simple block parser
  const blockRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let parsedContent = '';

  while ((match = blockRegex.exec(clean)) !== null) {
    const selector = match[1].trim();
    const body = match[2].trim();
    parsedContent += match[0];

    if (selector === '@font-face') {
      // Validate @font-face: either fontsource package font-face OR metric-override fallback
      const isMetricFallback = /ascent-override|descent-override|line-gap-override|size-adjust/i.test(body) && /src\s*:\s*local\(/i.test(body);
      const isFontsourceFace = /src\s*:\s*url\(['"]?\/fonts\/[a-z0-9_-]+\.woff2['"]?\)/i.test(body);

      if (!isMetricFallback && !isFontsourceFace) {
        errors.push(`Invalid @font-face in theme.css: must be either pinned fontsource font or metric-override fallback with src: local(...). Body: ${body}`);
      }
    } else if (selector === ':root' || selector === 'html') {
      // Body must only contain --pt-* variable overrides
      const declarations = body.split(';').map((d) => d.trim()).filter(Boolean);
      for (const decl of declarations) {
        const colonIdx = decl.indexOf(':');
        if (colonIdx === -1) {
          errors.push(`Invalid CSS declaration in ${selector}: "${decl}"`);
          continue;
        }
        const prop = decl.slice(0, colonIdx).trim();
        if (!prop.startsWith('--pt-')) {
          errors.push(`Forbidden property "${prop}" in theme.css ${selector}. Only documented "--pt-*" overrides are permitted.`);
        }
      }
    } else {
      errors.push(`Forbidden selector "${selector}" in theme.css. theme.css must only contain @font-face, @import, or :root/html --pt-* overrides.`);
    }
  }

  // Also check if there are top-level rules outside blocks (like @import)
  const nonBlock = clean.replace(blockRegex, '').trim();
  if (nonBlock) {
    const statements = nonBlock.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      if (!stmt.startsWith('@import')) {
        errors.push(`Forbidden top-level statement in theme.css: "${stmt}"`);
      }
    }
  }

  return errors;
}

/**
 * 3. Ledger citation lint:
 * Every block in picotol-gaps.css cites kidthales/picotol#N (citation-only blocks allowed); report ledger count.
 */
export function lintLedgerGaps(gapsCssContent: string): { errors: string[]; ledgerCount: number } {
  const errors: string[] = [];
  let ledgerCount = 0;

  // Find blocks or rule definitions in picotol-gaps.css
  // Note: @layer gaps; is allowed at root.
  // Blocks look like:
  // /* comment with kidthales/picotol#123 */
  // selector { ... }
  // OR citation-only block:
  // /* kidthales/picotol#123: description */

  // Let's find all issue citations: kidthales/picotol#<number>
  const citationRegex = /kidthales\/picotol#\d+\b/gi;
  const citations = gapsCssContent.match(citationRegex) || [];
  ledgerCount = citations.length;

  // Let's check every CSS rule block inside picotol-gaps.css
  // For every rule `{ ... }`, ensure the preceding comments contain `kidthales/picotol#N`.
  const blockRegex = /((?:\/\*[\s\S]*?\*\/|\s)*)([^{};]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(gapsCssContent)) !== null) {
    const comments = match[1];
    const selector = match[2].trim();
    // @layer gaps { ... } container
    if (selector.startsWith('@layer')) {
      continue;
    }

    if (!citationRegex.test(comments)) {
      errors.push(`Block with selector "${selector}" in picotol-gaps.css does not cite upstream issue "kidthales/picotol#N".`);
    }
  }

  return { errors, ledgerCount };
}

export function runCssLints(srcStylesDir: string, projectRoot?: string): CssLintResult {
  const errors: string[] = [];

  const themeCssPath = path.join(srcStylesDir, 'theme.css');
  const gapsCssPath = path.join(srcStylesDir, 'picotol-gaps.css');

  let ledgerCount = 0;

  if (fs.existsSync(themeCssPath)) {
    const themeContent = fs.readFileSync(themeCssPath, 'utf8');
    const colorErrors = lintColourLiterals(themeContent, 'theme.css');
    errors.push(...colorErrors);

    const themeErrors = lintThemeCss(themeContent);
    errors.push(...themeErrors);
  } else {
    errors.push(`File not found: ${themeCssPath}`);
  }

  if (fs.existsSync(gapsCssPath)) {
    const gapsContent = fs.readFileSync(gapsCssPath, 'utf8');
    const colorErrors = lintColourLiterals(gapsContent, 'picotol-gaps.css');
    errors.push(...colorErrors);

    const gapsResult = lintLedgerGaps(gapsContent);
    errors.push(...gapsResult.errors);
    ledgerCount = gapsResult.ledgerCount;
  } else {
    errors.push(`File not found: ${gapsCssPath}`);
  }

  // Scan .astro files and src/scripts/**/*.ts
  const resolvedSrcDir = projectRoot
    ? path.join(projectRoot, 'src')
    : path.resolve(srcStylesDir, '..');

  if (fs.existsSync(resolvedSrcDir)) {
    const astroErrors = lintAstroFiles(resolvedSrcDir);
    errors.push(...astroErrors);

    const scriptsDir = path.join(resolvedSrcDir, 'scripts');
    if (fs.existsSync(scriptsDir)) {
      const scriptErrors = lintTsScriptFiles(scriptsDir);
      errors.push(...scriptErrors);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    themeChecksPassed: errors.length === 0,
    ledgerCount,
  };
}

/**
 * 4. Astro <style> block lint:
 * Extracts <style> blocks from .astro content and verifies zero raw colour literals.
 */
export function extractAstroStyles(astroContent: string): { css: string; startLine: number }[] {
  const blocks: { css: string; startLine: number }[] = [];
  const styleRegex = /<style(?:\s+[^>]*)?>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;

  while ((match = styleRegex.exec(astroContent)) !== null) {
    const preMatch = astroContent.slice(0, match.index);
    const startLine = preMatch.split('\n').length;
    blocks.push({
      css: match[1],
      startLine,
    });
  }

  return blocks;
}

export function lintAstroContent(astroContent: string, fileName: string): string[] {
  const errors: string[] = [];
  const blocks = extractAstroStyles(astroContent);

  for (const block of blocks) {
    const blockErrors = lintColourLiterals(block.css, `${fileName} (style line ${block.startLine})`);
    errors.push(...blockErrors);
  }

  return errors;
}

/**
 * 5. TypeScript CSS/SVG string and template literal lint:
 * Scans string and template literals in .ts files that have CSS property or SVG attribute syntax
 * (e.g. color:, fill:, stroke:, background:, border:, or style="...") for raw colour literals.
 */
export function extractTsCssLiterals(tsContent: string): { content: string; startLine: number }[] {
  const literals: { content: string; startLine: number }[] = [];
  const CSS_PROPERTY_OR_ATTR_PATTERN = /\b(?:color|background|background-color|fill|stroke|border|border-color)\s*[:=]/i;

  // 1. Template literals `...`
  const templateRegex = /`([\s\S]*?)`/g;
  let match: RegExpExecArray | null;
  while ((match = templateRegex.exec(tsContent)) !== null) {
    const raw = match[1];
    if (CSS_PROPERTY_OR_ATTR_PATTERN.test(raw)) {
      const pre = tsContent.slice(0, match.index);
      const startLine = pre.split('\n').length;
      literals.push({ content: raw, startLine });
    }
  }

  // 2. String literals "..." and '...'
  const stringRegex = /(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')/g;
  while ((match = stringRegex.exec(tsContent)) !== null) {
    const raw = match[1] ?? match[2] ?? '';
    if (CSS_PROPERTY_OR_ATTR_PATTERN.test(raw)) {
      const pre = tsContent.slice(0, match.index);
      const startLine = pre.split('\n').length;
      literals.push({ content: raw, startLine });
    }
  }

  return literals;
}

export function lintTsScriptContent(tsContent: string, fileName: string): string[] {
  const errors: string[] = [];
  const literals = extractTsCssLiterals(tsContent);

  for (const lit of literals) {
    // Normalize SVG attribute assignments key="value" to separate lines key: value;
    // Also ensure semicolons are followed by newlines so multiple declarations on a single line are each inspected
    const normalized = lit.content
      .replace(/\b([a-zA-Z-]+)\s*=\s*(["'])(.*?)\2/g, '\n$1: $3;\n')
      .replace(/;/g, ';\n');
    const blockErrors = lintColourLiterals(normalized, `${fileName} (line ${lit.startLine})`);
    errors.push(...blockErrors);
  }

  return errors;
}

/**
 * Recursively walks a directory to find all files ending with a given extension.
 */
export function walkFiles(dir: string, extension: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }

  return results;
}

export function lintAstroFiles(srcDir: string): string[] {
  const errors: string[] = [];
  const astroFiles = walkFiles(srcDir, '.astro');

  for (const file of astroFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relPath = path.relative(process.cwd(), file);
    errors.push(...lintAstroContent(content, relPath));
  }

  return errors;
}

export function lintTsScriptFiles(scriptsDir: string): string[] {
  const errors: string[] = [];
  const tsFiles = walkFiles(scriptsDir, '.ts');

  for (const file of tsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relPath = path.relative(process.cwd(), file);
    errors.push(...lintTsScriptContent(content, relPath));
  }

  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const stylesDir = process.argv[2] || path.resolve(process.cwd(), 'src/styles');
  const result = runCssLints(stylesDir);
  if (!result.ok) {
    console.error('CSS Lints FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`CSS Lints PASSED (theme.css verified, ${result.ledgerCount} picotol ledger citation(s) reported).`);
}
