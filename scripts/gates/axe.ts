import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import axe from 'axe-core';

export interface IncompleteAllowlistEntry {
  ruleId: string;
  selector: string;
  issue: string;
  reason: string;
}

export interface AxeAuditOptions {
  distDir: string;
  allowlistPath?: string;
  reportOnly?: boolean;
}

export interface AxePageResult {
  route: string;
  scheme: 'light' | 'dark';
  violations: Array<{
    id: string;
    impact?: string | null;
    description: string;
    help: string;
    nodes: Array<{ html: string; target: string[]; failureSummary?: string }>;
  }>;
  incomplete: Array<{
    id: string;
    impact?: string | null;
    description: string;
    nodes: Array<{ html: string; target: string[]; failureSummary?: string }>;
  }>;
  unallowedIncomplete: Array<{
    id: string;
    target: string;
    html: string;
    failureSummary?: string;
  }>;
  matchedAllowlistEntries: Set<string>;
  aaaBodyPassCount: number;
  aaaBodyFailCount: number;
  cls: number;
}

export interface AxeAuditResult {
  ok: boolean;
  totalPagesScanned: number;
  totalViolations: number;
  totalUnallowedIncomplete: number;
  staleAllowlistEntries: string[];
  pageResults: AxePageResult[];
  errors: string[];
  reportLines: {
    aaaRatioLines: string[];
    clsLines: string[];
  };
}

/**
 * Finds all HTML files recursively in dist directory.
 */
export function findHtmlFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Converts a file path in dist to a route URL.
 */
export function filePathToRoute(distDir: string, filePath: string): string {
  let rel = path.relative(distDir, filePath).replace(/\\/g, '/');
  if (rel.endsWith('index.html')) {
    rel = rel.slice(0, -'index.html'.length);
  }
  return '/' + rel;
}

/**
 * Starts a minimal static HTTP server for dist directory.
 */
export async function startDistServer(distDir: string): Promise<{ server: http.Server; port: number }> {
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  };

  const server = http.createServer((req, res) => {
    let reqUrl = req.url?.split('?')[0] || '/';
    if (reqUrl.endsWith('/')) {
      reqUrl += 'index.html';
    }
    let localPath = path.join(distDir, reqUrl);
    if (!fs.existsSync(localPath) && fs.existsSync(localPath + '.html')) {
      localPath += '.html';
    }

    if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const ext = path.extname(localPath).toLowerCase();
    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
    fs.createReadStream(localPath).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to obtain server address'));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on('error', reject);
  });
}

/**
 * Verifies if an incomplete node target matches an allowlist selector.
 */
export function nodeMatchesSelector(targetSelectors: unknown, allowlistSelector: string): boolean {
  if (Array.isArray(targetSelectors)) {
    for (const t of targetSelectors) {
      const str = String(t);
      if (str.includes(allowlistSelector) || str.endsWith(allowlistSelector)) {
        return true;
      }
    }
  } else if (typeof targetSelectors === 'string') {
    return targetSelectors.includes(allowlistSelector) || targetSelectors.endsWith(allowlistSelector);
  }
  return false;
}

/**
 * Runs axe-core and CLS audit on all pages in distDir.
 */
export async function runAxeAudit(options: AxeAuditOptions): Promise<AxeAuditResult> {
  const { distDir, allowlistPath } = options;

  let allowlist: IncompleteAllowlistEntry[] = [];
  if (allowlistPath && fs.existsSync(allowlistPath)) {
    const raw = fs.readFileSync(allowlistPath, 'utf8');
    allowlist = JSON.parse(raw);
    for (const item of allowlist) {
      if (!item.issue || !item.issue.startsWith('#')) {
        throw new Error(`Allowlist entry for "${item.ruleId}" must cite an issue (e.g. #441)`);
      }
    }
  }

  const htmlFiles = findHtmlFiles(distDir);
  if (htmlFiles.length === 0) {
    return {
      ok: false,
      totalPagesScanned: 0,
      totalViolations: 0,
      totalUnallowedIncomplete: 0,
      staleAllowlistEntries: [],
      pageResults: [],
      errors: [`No HTML files found in dist directory "${distDir}".`],
      reportLines: { aaaRatioLines: [], clsLines: [] },
    };
  }

  const routes = htmlFiles.map((f) => filePathToRoute(distDir, f)).sort();
  const { server, port } = await startDistServer(distDir);

  const matchedAllowlistKeys = new Set<string>();
  const pageResults: AxePageResult[] = [];
  const errors: string[] = [];
  const aaaRatioLines: string[] = [];
  const clsLines: string[] = [];

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch();

    for (const route of routes) {
      // 1. Measure CLS on light scheme
      let pageCls = 0;
      {
        const context = await browser.newContext({ colorScheme: 'light' });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle' });

        pageCls = await page.evaluate(() => {
          return new Promise<number>((resolve) => {
            let clsValue = 0;
            const observer = new PerformanceObserver((entryList) => {
              for (const entry of entryList.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
                if (!entry.hadRecentInput) {
                  clsValue += entry.value;
                }
              }
            });
            observer.observe({ type: 'layout-shift', buffered: true });
            setTimeout(() => {
              observer.disconnect();
              resolve(clsValue);
            }, 100);
          });
        });

        clsLines.push(`CLS ${route.padEnd(35)}: ${pageCls.toFixed(4)}`);
        await context.close();
      }

      // 2. Audit axe tags in light and dark
      for (const scheme of ['light', 'dark'] as const) {
        const context = await browser.newContext({ colorScheme: scheme });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle' });

        await page.addScriptTag({ content: axe.source });

        // Run gated WCAG 2.2 A/AA rules
        const axeResults = await page.evaluate(async () => {
          return await (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
            },
          });
        });

        // Run non-failing AAA color-contrast-enhanced body text report
        const aaaResults = await page.evaluate(async () => {
          const mainEl = document.querySelector('main') || document.body;
          return await (window as unknown as { axe: typeof axe }).axe.run(mainEl, {
            runOnly: {
              type: 'rule',
              values: ['color-contrast-enhanced'],
            },
          });
        });

        const matchedInThisRun = new Set<string>();
        const unallowedIncomplete: AxePageResult['unallowedIncomplete'] = [];

        for (const inc of axeResults.incomplete) {
          for (const node of inc.nodes) {
            let allowed = false;
            for (let i = 0; i < allowlist.length; i++) {
              const entry = allowlist[i];
              if (entry.ruleId === inc.id && nodeMatchesSelector(node.target, entry.selector)) {
                allowed = true;
                const allowKey = `${entry.ruleId}::${entry.selector}`;
                matchedInThisRun.add(allowKey);
                matchedAllowlistKeys.add(allowKey);
                break;
              }
            }

            if (!allowed) {
              unallowedIncomplete.push({
                id: inc.id,
                target: node.target.join(', '),
                html: node.html,
                failureSummary: node.failureSummary,
              });
            }
          }
        }

        const aaaPasses = aaaResults.passes.length ? aaaResults.passes[0].nodes.length : 0;
        const aaaFails = aaaResults.violations.length ? aaaResults.violations[0].nodes.length : 0;
        const aaaTotal = aaaPasses + aaaFails;
        const aaaPercent = aaaTotal > 0 ? ((aaaPasses / aaaTotal) * 100).toFixed(1) : '100.0';

        aaaRatioLines.push(
          `AAA Body Contrast [${scheme.toUpperCase().padEnd(5)}] ${route.padEnd(35)}: ${aaaPasses}/${aaaTotal} elements (${aaaPercent}%) meet 7:1`
        );

        pageResults.push({
          route,
          scheme,
          violations: axeResults.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            help: v.help,
            nodes: v.nodes.map((n) => ({
              html: n.html,
              target: Array.isArray(n.target) ? n.target.map(String) : [String(n.target)],
              failureSummary: n.failureSummary,
            })),
          })),
          incomplete: axeResults.incomplete.map((inc) => ({
            id: inc.id,
            impact: inc.impact,
            description: inc.description,
            nodes: inc.nodes.map((n) => ({
              html: n.html,
              target: Array.isArray(n.target) ? n.target.map(String) : [String(n.target)],
              failureSummary: n.failureSummary,
            })),
          })),
          unallowedIncomplete,
          matchedAllowlistEntries: matchedInThisRun,
          aaaBodyPassCount: aaaPasses,
          aaaBodyFailCount: aaaFails,
          cls: pageCls,
        });

        // Record errors for violations
        if (axeResults.violations.length > 0) {
          for (const v of axeResults.violations) {
            errors.push(
              `Violation [${v.id}] on ${route} (${scheme}): ${v.help} (${v.nodes.length} instance(s))`
            );
          }
        }

        // Record errors for unallowed incomplete
        if (unallowedIncomplete.length > 0) {
          for (const inc of unallowedIncomplete) {
            errors.push(
              `Unallowed incomplete [${inc.id}] on ${route} (${scheme}) at "${inc.target}". Reason: ${inc.failureSummary || 'Needs investigation'}`
            );
          }
        }

        await context.close();
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    server.close();
  }

  // Check for stale allowlist entries
  const staleAllowlistEntries: string[] = [];
  for (const entry of allowlist) {
    const key = `${entry.ruleId}::${entry.selector}`;
    if (!matchedAllowlistKeys.has(key)) {
      staleAllowlistEntries.push(key);
      errors.push(`Stale allowlist entry: "${key}" (cited ${entry.issue}) was never matched during the audit.`);
    }
  }

  const totalViolations = pageResults.reduce((acc, p) => acc + p.violations.length, 0);
  const totalUnallowedIncomplete = pageResults.reduce((acc, p) => acc + p.unallowedIncomplete.length, 0);

  return {
    ok: errors.length === 0,
    totalPagesScanned: routes.length,
    totalViolations,
    totalUnallowedIncomplete,
    staleAllowlistEntries,
    pageResults,
    errors,
    reportLines: {
      aaaRatioLines,
      clsLines,
    },
  };
}

// CLI entrypoint
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const isReport = args.includes('--report');
  const distDir = args.find((a) => !a.startsWith('--')) || path.join(process.cwd(), 'dist');
  const allowlistPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'axe-allowlist.json');

  (async () => {
    try {
      if (isReport) {
        console.log(`[a11y-report] Generating accessibility and performance reports for "${distDir}"...`);
        const result = await runAxeAudit({ distDir, allowlistPath, reportOnly: true });

        console.log('\n--- WCAG AAA Body Text Contrast Report (color-contrast-enhanced) ---');
        for (const line of result.reportLines.aaaRatioLines) {
          console.log(`  ${line}`);
        }

        console.log('\n--- Cumulative Layout Shift (CLS) Report ---');
        for (const line of result.reportLines.clsLines) {
          console.log(`  ${line}`);
        }

        console.log('\n[a11y-report] Report complete.');
        process.exit(0);
      } else {
        console.log(`[axe-gate] Auditing WCAG 2.2 A/AA accessibility on "${distDir}"...`);
        const result = await runAxeAudit({ distDir, allowlistPath, reportOnly: false });

        console.log(
          `[axe-gate] Scanned ${result.totalPagesScanned} pages in light and dark (${result.totalPagesScanned * 2} runs).`
        );

        if (!result.ok) {
          console.error(`\n[axe-gate] FAILED with ${result.errors.length} issue(s):`);
          for (const err of result.errors) {
            console.error(`  - ${err}`);
          }
          process.exit(1);
        }

        console.log(`\n[axe-gate] All WCAG 2.2 A/AA axe checks PASSED with 0 violations and 0 unallowed incompletes.`);
      }
    } catch (err: unknown) {
      console.error('[axe-gate] Fatal error during audit:', err);
      process.exit(1);
    }
  })();
}
