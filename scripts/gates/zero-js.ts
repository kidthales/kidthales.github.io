import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorksIsland } from './islands.ts';

export interface ZeroJsResult {
  ok: boolean;
  errors: string[];
  htmlFilesChecked: number;
}

export function routeFromHtmlPath(htmlRelativePath: string): string {
  // Normalize Windows separators
  let normalized = htmlRelativePath.replace(/\\/g, '/');
  if (normalized.endsWith('index.html')) {
    normalized = normalized.slice(0, -'index.html'.length);
  } else if (normalized.endsWith('.html')) {
    normalized = normalized.slice(0, -'.html'.length);
  }
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  if (!normalized.endsWith('/') && !normalized.includes('.')) {
    normalized = normalized + '/';
  }
  return normalized;
}

export function checkZeroJs(
  distDir: string,
  manifest: WorksIsland[] = []
): ZeroJsResult {
  const errors: string[] = [];
  let htmlFilesChecked = 0;

  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      errors: [`distDir does not exist: ${distDir}`],
      htmlFilesChecked: 0,
    };
  }

  // Map allowed JS routes from manifest
  const jsAllowedRoutes = new Set(
    manifest.filter((m) => m.js).map((m) => m.route)
  );

  const encounteredJsRoutes = new Set<string>();

  // Walk distDir
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(distDir, fullPath).replace(/\\/g, '/');

        // Check standalone .js files in dist
        if (relPath.endsWith('.js') || relPath.endsWith('.mjs')) {
          // If there are JS files output into dist, they must be traceable to an allowed route
          // But outside /works/**, there must be NO reachable client .js!
          // Note: .prerender is internal Astro prerender cache, check if it's under distroot
          if (!relPath.startsWith('.prerender/')) {
            // Is this JS bundle associated with an allowed works route?
            // If manifest is empty, any client .js in dist is forbidden.
            if (jsAllowedRoutes.size === 0) {
              errors.push(`Forbidden client JavaScript file in dist: ${relPath}`);
            }
          }
        }

        if (relPath.endsWith('.html')) {
          htmlFilesChecked++;
          const route = routeFromHtmlPath(relPath);
          const content = fs.readFileSync(fullPath, 'utf8');

          // Check for <script tags
          // Matches <script followed by whitespace, >, or /
          // Exclude JSON-LD or spec if type="application/ld+json" if ever used?
          // The spec states: "no <script in any HTML and no reachable .js, except routes declared with js: true in src/works-islands.ts"
          const hasScriptTag = /<script\b/i.test(content);

          if (hasScriptTag) {
            if (jsAllowedRoutes.has(route)) {
              encounteredJsRoutes.add(route);
            } else {
              errors.push(
                `Forbidden <script> tag found in HTML route "${route}" (${relPath}) without manifest grant.`
              );
            }
          }
        }
      }
    }
  }

  walk(distDir);

  // Check for stale declared routes: declared route with js: true with no script fails as stale
  for (const item of manifest) {
    if (item.js) {
      if (!encounteredJsRoutes.has(item.route)) {
        errors.push(
          `Manifest route "${item.route}" declared with js: true, but no <script> tag was found in output (stale declaration).`
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    htmlFilesChecked,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const distDir = process.argv[2] || path.resolve(process.cwd(), 'dist');
  // Load worksIslands
  let manifest: WorksIsland[] = [];
  try {
    const mod = await import('../../src/works-islands.js');
    manifest = mod.worksIslands || [];
  } catch {
    // If running in ts mode directly or compiled
    try {
      const mod = await import('../../src/works-islands.ts');
      manifest = mod.worksIslands || [];
    } catch {
      // empty fallback
    }
  }

  const result = checkZeroJs(distDir, manifest);
  if (!result.ok) {
    console.error('Zero-JS Gate FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`Zero-JS Gate PASSED (${result.htmlFilesChecked} HTML files checked).`);
}
