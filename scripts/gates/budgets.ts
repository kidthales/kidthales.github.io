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
  };
}

export interface BudgetCheckResult {
  ok: boolean;
  errors: string[];
  metrics: Record<string, { measured: number; max: number }>;
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

  // 1. Calculate site CSS compressed size
  const cssDir = path.join(distDir, '_astro');
  let siteCssGzipBytes = 0;
  if (fs.existsSync(cssDir)) {
    for (const f of fs.readdirSync(cssDir)) {
      if (f.endsWith('.css')) {
        const raw = fs.readFileSync(path.join(cssDir, f));
        siteCssGzipBytes += zlib.gzipSync(raw).length;
      }
    }
  }

  // 2. Measure WOFF2 font assets
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

  // Helper to categorize page type
  function getPageType(relHtmlPath: string): 'note' | 'essay' | 'paper' | 'index' | null {
    const normalized = relHtmlPath.replace(/\\/g, '/');
    if (
      normalized === 'index.html' ||
      normalized === 'words/index.html' ||
      normalized === 'words/notes/index.html' ||
      normalized === 'words/essays/index.html' ||
      normalized === 'words/papers/index.html' ||
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

    return null;
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
        const pageType = getPageType(relPath);

        if (pageType && budgetConfig.pageBudgets?.[pageType]) {
          const budget = budgetConfig.pageBudgets[pageType];
          const raw = fs.readFileSync(fullPath);
          const htmlGzipBytes = zlib.gzipSync(raw).length;
          const combinedCompressed = htmlGzipBytes + siteCssGzipBytes;

          const metricKey = `page:${pageType}:${relPath}`;
          metrics[metricKey] = {
            measured: combinedCompressed,
            max: budget.maxCompressedBytes,
          };

          if (combinedCompressed > budget.maxCompressedBytes) {
            errors.push(
              `Page "${relPath}" (${pageType}) exceeded weight budget: ${combinedCompressed} B (HTML ${htmlGzipBytes} B + CSS ${siteCssGzipBytes} B) > ${budget.maxCompressedBytes} B limit.`
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
