import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export interface BudgetConfig {
  pageBudgets: {
    [key: string]: {
      measuredCompressedBytes: number;
      maxCompressedBytes: number;
      description?: string;
    };
  };
  assetBudgets: {
    totalWoff2Bytes: {
      measuredBytes: number;
      maxBytes: number;
      description?: string;
    };
    totalJsGzipBytes?: {
      measuredBytes: number;
      maxBytes: number;
      description?: string;
    };
  };
}

export interface BudgetCheckResult {
  ok: boolean;
  errors: string[];
  metrics: Record<string, { measured: number; max: number }>;
}

/**
 * Extracts linked CSS stylesheets and JS script assets from an HTML document.
 */
export function extractPageAssets(htmlContent: string): { cssAssets: string[]; jsAssets: string[] } {
  const cssAssets: string[] = [];
  const jsAssets: string[] = [];

  // Match <link rel="stylesheet" href="..."> and <link href="..." rel="stylesheet">
  const linkRegex = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const tag = match[0];
    if (/\brel\s*=\s*(?:"stylesheet"|'stylesheet')/i.test(tag)) {
      const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      if (hrefMatch) {
        const href = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3];
        if (href && !cssAssets.includes(href)) {
          cssAssets.push(href);
        }
      }
    }
  }

  // Match <script src="...">
  const scriptRegex = /<script\b[^>]*>/gi;
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const tag = match[0];
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (srcMatch) {
      const src = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3];
      if (src && !jsAssets.includes(src)) {
        jsAssets.push(src);
      }
    }
  }

  return { cssAssets, jsAssets };
}

/**
 * Categorizes an HTML page path to its budget type, factoring in client script presence for works islands.
 */
export function getPageType(
  relHtmlPath: string,
  hasJs: boolean = false
): 'note' | 'essay' | 'paper' | 'index' | 'work' | 'workIsland' | null {
  const normalized = relHtmlPath.replace(/\\/g, '/');
  if (
    normalized === 'index.html' ||
    normalized === 'words/index.html' ||
    normalized === 'words/notes/index.html' ||
    normalized === 'words/essays/index.html' ||
    normalized === 'words/papers/index.html' ||
    normalized === 'works/index.html' ||
    normalized === 'credits/index.html'
  ) {
    return 'index';
  }

  if (normalized.startsWith('words/')) {
    // In fixture build, determine kind by fixture name or inspect content
    if (normalized.includes('essay')) return 'essay';
    if (normalized.includes('paper')) return 'paper';
    return 'note';
  }

  if (normalized.startsWith('works/')) {
    return hasJs ? 'workIsland' : 'work';
  }

  return null;
}

export function checkBudgets(
  distDir: string,
  budgetsConfigPath: string
): BudgetCheckResult {
  const errors: string[] = [];
  const metrics: Record<string, { measured: number; max: number }> = {};

  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      errors: [`distDir does not exist: ${distDir}`],
      metrics,
    };
  }

  if (!fs.existsSync(budgetsConfigPath)) {
    return {
      ok: false,
      errors: [`budgets.json not found at ${budgetsConfigPath}`],
      metrics,
    };
  }

  const budgetConfig: BudgetConfig = JSON.parse(
    fs.readFileSync(budgetsConfigPath, 'utf8')
  );

  const assetGzipCache = new Map<string, number>();
  function getAssetGzipSize(assetRef: string): number {
    const cleanRef = assetRef.split('?')[0].split('#')[0];
    if (assetGzipCache.has(cleanRef)) {
      return assetGzipCache.get(cleanRef)!;
    }
    const diskPath = path.join(distDir, cleanRef.replace(/^\/+/, ''));
    if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
      const raw = fs.readFileSync(diskPath);
      const size = zlib.gzipSync(raw).length;
      assetGzipCache.set(cleanRef, size);
      return size;
    }
    return 0;
  }

  // 1. Measure WOFF2 font assets
  const fontsDir = path.join(distDir, 'fonts');
  let totalWoff2Bytes = 0;
  if (fs.existsSync(fontsDir)) {
    for (const f of fs.readdirSync(fontsDir)) {
      if (f.endsWith('.woff2')) {
        totalWoff2Bytes += fs.statSync(path.join(fontsDir, f)).size;
      }
    }
  }

  const woff2Budget = budgetConfig.assetBudgets?.totalWoff2Bytes;
  if (woff2Budget) {
    metrics['asset:totalWoff2Bytes'] = {
      measured: totalWoff2Bytes,
      max: woff2Budget.maxBytes,
    };
    if (totalWoff2Bytes > woff2Budget.maxBytes) {
      errors.push(
        `Total WOFF2 font size exceeded budget: ${totalWoff2Bytes} B > ${woff2Budget.maxBytes} B limit.`
      );
    }
  }

  // 2. Measure client JS assets in dist/_astro/
  let totalJsGzipBytes = 0;
  const astroDir = path.join(distDir, '_astro');
  if (fs.existsSync(astroDir)) {
    for (const f of fs.readdirSync(astroDir)) {
      if (f.endsWith('.js') || f.endsWith('.mjs')) {
        const raw = fs.readFileSync(path.join(astroDir, f));
        totalJsGzipBytes += zlib.gzipSync(raw).length;
      }
    }
  }

  const jsBudget = budgetConfig.assetBudgets?.totalJsGzipBytes;
  if (jsBudget) {
    metrics['asset:totalJsGzipBytes'] = {
      measured: totalJsGzipBytes,
      max: jsBudget.maxBytes,
    };
    if (totalJsGzipBytes > jsBudget.maxBytes) {
      errors.push(
        `Total client JS size exceeded budget: ${totalJsGzipBytes} B > ${jsBudget.maxBytes} B limit.`
      );
    }
  }

  // Check each HTML file against its page type budget
  function walkHtml(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walkHtml(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const relPath = path.relative(distDir, fullPath).replace(/\\/g, '/');
        const raw = fs.readFileSync(fullPath);
        const htmlContent = raw.toString('utf8');
        const { cssAssets, jsAssets } = extractPageAssets(htmlContent);
        const pageType = getPageType(relPath, jsAssets.length > 0);

        if (pageType && budgetConfig.pageBudgets?.[pageType]) {
          const budget = budgetConfig.pageBudgets[pageType];
          const htmlGzipBytes = zlib.gzipSync(raw).length;

          let pageCssGzipBytes = 0;
          for (const cssRef of cssAssets) {
            pageCssGzipBytes += getAssetGzipSize(cssRef);
          }

          let pageJsGzipBytes = 0;
          for (const jsRef of jsAssets) {
            pageJsGzipBytes += getAssetGzipSize(jsRef);
          }

          const combinedCompressed = htmlGzipBytes + pageCssGzipBytes + pageJsGzipBytes;

          const metricKey = `page:${pageType}:${relPath}`;
          metrics[metricKey] = {
            measured: combinedCompressed,
            max: budget.maxCompressedBytes,
          };

          if (combinedCompressed > budget.maxCompressedBytes) {
            errors.push(
              `Page "${relPath}" (${pageType}) exceeded weight budget: ${combinedCompressed} B (HTML ${htmlGzipBytes} B + CSS ${pageCssGzipBytes} B + JS ${pageJsGzipBytes} B) > ${budget.maxCompressedBytes} B limit.`
            );
          }
        }
      }
    }
  }

  walkHtml(distDir);

  return {
    ok: errors.length === 0,
    errors,
    metrics,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const distDir = process.argv[2] || path.resolve(process.cwd(), 'dist');
  const budgetsJson = process.argv[3] || path.resolve(process.cwd(), 'budgets.json');

  const result = checkBudgets(distDir, budgetsJson);
  if (!result.ok) {
    console.error('Weight Budgets Gate FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`Weight Budgets Gate PASSED (all page types and woff2 assets within budget limits).`);
}
