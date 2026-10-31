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
      const namedMatch = NAMED_COLOR_REGEX.exec(value);
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

export function runCssLints(srcStylesDir: string): CssLintResult {
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

  return {
    ok: errors.length === 0,
    errors,
    themeChecksPassed: errors.length === 0,
    ledgerCount,
  };
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
