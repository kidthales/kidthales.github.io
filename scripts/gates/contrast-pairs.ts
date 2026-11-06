import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TokenPair {
  name: string;
  fgToken: string;
  bgToken: string;
  minRatio: number; // default 4.5
}

export interface ResolvedPairResult {
  name: string;
  fgToken: string;
  bgToken: string;
  fgColor: string;
  bgColor: string;
  ratio: number;
  scheme: 'light' | 'dark';
  pass: boolean;
  minRatio: number;
}

export interface ContrastPairsGateResult {
  ok: boolean;
  results: ResolvedPairResult[];
  errors: string[];
}

/**
 * Standard token pairs list for kidthales.github.io.
 * Resolves foreground and background pairs from picotol tokens + theme.css.
 */
export const TOKEN_PAIRS: TokenPair[] = [
  { name: 'Default Body Text', fgToken: '--pt-color', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Muted Secondary Text', fgToken: '--pt-muted-color', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Card Body Text', fgToken: '--pt-color', bgToken: '--pt-card-bg', minRatio: 4.5 },
  { name: 'Card Muted Text', fgToken: '--pt-muted-color', bgToken: '--pt-card-bg', minRatio: 4.5 },
  { name: 'Primary Link / Accent Text', fgToken: '--pt-primary', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Primary Link Hover', fgToken: '--pt-primary-hover', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Form Validation Success', fgToken: '--pt-valid', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Form Validation Warning', fgToken: '--pt-warning', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Form Validation Error', fgToken: '--pt-invalid', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Status Badge OK Text', fgToken: '--pt-status-ok-fg', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Status Badge Warning Text', fgToken: '--pt-status-warning-fg', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Status Badge Critical Text', fgToken: '--pt-status-critical-fg', bgToken: '--pt-bg', minRatio: 4.5 },
  { name: 'Status Badge Info Text', fgToken: '--pt-status-info-fg', bgToken: '--pt-bg', minRatio: 4.5 },
];

/**
 * Parses hex colour into [r, g, b] (0..255). Supports #rgb and #rrggbb.
 */
export function parseHex(hex: string): [number, number, number] {
  let clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) {
    throw new Error(`Invalid hex color string: "${hex}"`);
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Calculates relative luminance according to WCAG 2.1 specification.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const srgbToLinear = (c: number) => {
    const val = c / 255;
    return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  };
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * Calculates WCAG contrast ratio between two hex colours.
 */
export function calculateContrastRatio(hex1: string, hex2: string): number {
  const [r1, g1, b1] = parseHex(hex1);
  const [r2, g2, b2] = parseHex(hex2);
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolves token values from CSS text content (handling light-dark(...) and var(--...)).
 */
export function extractCssTokens(cssContent: string): Map<string, { light: string; dark: string }> {
  const tokens = new Map<string, { light: string; dark: string }>();

  // Match --var-name: value;
  const propRegex = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;

  while ((match = propRegex.exec(cssContent)) !== null) {
    const name = match[1].trim();
    const value = match[2].trim();

    // Check light-dark(valLight, valDark)
    const ldMatch = /^light-dark\(\s*(.*?)\s*,\s*(.*?)\s*\)$/.exec(value);
    if (ldMatch) {
      tokens.set(name, { light: ldMatch[1].trim(), dark: ldMatch[2].trim() });
    } else {
      tokens.set(name, { light: value, dark: value });
    }
  }

  return tokens;
}

/**
 * Recursively resolves a token in a given color scheme to a raw hex color.
 */
export function resolveTokenHex(
  tokenOrValue: string,
  scheme: 'light' | 'dark',
  tokenMap: Map<string, { light: string; dark: string }>,
  depth = 0
): string {
  if (depth > 20) {
    throw new Error(`Circular or overly deep token reference while resolving "${tokenOrValue}"`);
  }

  let trimmed = tokenOrValue.trim();

  // If it's a var(--name)
  const varMatch = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/.exec(trimmed);
  if (varMatch) {
    trimmed = varMatch[1];
  }

  // If it's a token name
  if (trimmed.startsWith('--')) {
    const entry = tokenMap.get(trimmed);
    if (!entry) {
      throw new Error(`Token "${trimmed}" not found in token definitions`);
    }
    const target = scheme === 'light' ? entry.light : entry.dark;
    return resolveTokenHex(target, scheme, tokenMap, depth + 1);
  }

  // If it's already a hex color
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Unable to resolve "${trimmed}" to a hex color in ${scheme} scheme`);
}

/**
 * Audits all token pairs in TOKEN_PAIRS against resolved tokens from picotol + theme.css.
 */
export function checkContrastPairs(
  picotolTokensPath: string,
  themeCssPath?: string,
  pairs: TokenPair[] = TOKEN_PAIRS
): ContrastPairsGateResult {
  const tokenMap = new Map<string, { light: string; dark: string }>();

  if (fs.existsSync(picotolTokensPath)) {
    const picotolTokens = extractCssTokens(fs.readFileSync(picotolTokensPath, 'utf8'));
    for (const [k, v] of picotolTokens) {
      tokenMap.set(k, v);
    }
  }

  if (themeCssPath && fs.existsSync(themeCssPath)) {
    const themeTokens = extractCssTokens(fs.readFileSync(themeCssPath, 'utf8'));
    for (const [k, v] of themeTokens) {
      tokenMap.set(k, v);
    }
  }

  const results: ResolvedPairResult[] = [];
  const errors: string[] = [];

  for (const pair of pairs) {
    for (const scheme of ['light', 'dark'] as const) {
      try {
        const fgHex = resolveTokenHex(pair.fgToken, scheme, tokenMap);
        const bgHex = resolveTokenHex(pair.bgToken, scheme, tokenMap);
        const ratio = calculateContrastRatio(fgHex, bgHex);
        const pass = ratio >= pair.minRatio;

        results.push({
          name: pair.name,
          fgToken: pair.fgToken,
          bgToken: pair.bgToken,
          fgColor: fgHex,
          bgColor: bgHex,
          ratio,
          scheme,
          pass,
          minRatio: pair.minRatio,
        });

        if (!pass) {
          errors.push(
            `Contrast failure: "${pair.name}" in ${scheme} scheme (${pair.fgToken} [${fgHex}] on ${pair.bgToken} [${bgHex}]) ratio ${ratio.toFixed(2)}:1 < ${pair.minRatio}:1 minimum.`
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Error evaluating "${pair.name}" in ${scheme} scheme: ${msg}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    results,
    errors,
  };
}

// CLI entrypoint
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const defaultPicotol = path.join(process.cwd(), 'node_modules', '@kidthales', 'picotol', 'src', 'tokens.css');
  const defaultTheme = path.join(process.cwd(), 'src', 'styles', 'theme.css');

  console.log(`[contrast-pairs] Auditing ${TOKEN_PAIRS.length} token pairs across light and dark schemes...`);
  const gateResult = checkContrastPairs(defaultPicotol, defaultTheme);

  for (const res of gateResult.results) {
    const mark = res.pass ? '✓' : '✗';
    console.log(
      `  ${mark} [${res.scheme.toUpperCase()}] ${res.name.padEnd(28)}: ${res.fgColor} on ${res.bgColor} => ${res.ratio.toFixed(2)}:1 (min ${res.minRatio}:1)`
    );
  }

  if (!gateResult.ok) {
    console.error(`\n[contrast-pairs] FAILED with ${gateResult.errors.length} error(s):`);
    for (const err of gateResult.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`\n[contrast-pairs] All ${gateResult.results.length} token-pair checks PASSED.`);
}
