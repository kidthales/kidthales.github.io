import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, type WorksIsland } from './islands.ts';

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

  // Validate manifest structure and routes
  const manifestErrors = validateManifest(manifest);
  for (const merr of manifestErrors) {
    errors.push(`Manifest validation error for route "${merr.route}": ${merr.error}`);
  }

  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      errors: [`distDir does not exist: ${distDir}`, ...errors],
      htmlFilesChecked: 0,
    };
  }

  // Map allowed JS routes from manifest
  const jsAllowedRoutes = new Set(
    manifest.filter((m) => m.js).map((m) => m.route)
  );

  const encounteredJsRoutes = new Set<string>();
  const allJsFiles: string[] = [];
  const referencedJsFiles = new Set<string>();

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
          if (!relPath.startsWith('.prerender/')) {
            allJsFiles.push(relPath);
          }
        }

        if (relPath.endsWith('.html')) {
          htmlFilesChecked++;
          const route = routeFromHtmlPath(relPath);
          const content = fs.readFileSync(fullPath, 'utf8');

          const hasScriptTag = /<script\b/i.test(content);

          if (hasScriptTag) {
            if (jsAllowedRoutes.has(route)) {
              encounteredJsRoutes.add(route);

              // Extract referenced scripts from this allowed island route
              const scriptSrcRegex = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
              let match: RegExpExecArray | null;
              while ((match = scriptSrcRegex.exec(content)) !== null) {
                const srcVal = match[1] ?? match[2] ?? match[3];
                if (srcVal) {
                  let normSrc = srcVal.trim().replace(/^['"]|['"]$/g, '');
                  if (normSrc.startsWith('/')) {
                    normSrc = normSrc.slice(1);
                  } else {
                    const htmlDir = path.dirname(relPath).replace(/\\/g, '/');
                    normSrc = path.posix.join(htmlDir, normSrc);
                  }
                  referencedJsFiles.add(normSrc);
                }
              }

              // Also extract modulepreload links associated with scripts
              const preloadRegex = /<link\b[^>]*?\brel\s*=\s*['"]modulepreload['"][^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
              while ((match = preloadRegex.exec(content)) !== null) {
                const hrefVal = match[1] ?? match[2] ?? match[3];
                if (hrefVal) {
                  let normHref = hrefVal.trim().replace(/^['"]|['"]$/g, '');
                  if (normHref.startsWith('/')) {
                    normHref = normHref.slice(1);
                  } else {
                    const htmlDir = path.dirname(relPath).replace(/\\/g, '/');
                    normHref = path.posix.join(htmlDir, normHref);
                  }
                  referencedJsFiles.add(normHref);
                }
              }
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

  // Verify every .js/.mjs in dist is referenced by an allowed island route
  for (const jsFile of allJsFiles) {
    if (jsAllowedRoutes.size === 0) {
      errors.push(`Forbidden client JavaScript file in dist: ${jsFile}`);
    } else if (!referencedJsFiles.has(jsFile)) {
      errors.push(
        `Unreferenced client JavaScript file in dist: ${jsFile}. Every .js/.mjs file in dist must be referenced by <script src="..."> on an allowed island route.`
      );
    }
  }

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
    } catch (err) {
      console.error('Zero-JS Gate FAILED: Unable to load src/works-islands manifest (fail-closed):', err);
      process.exit(1);
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
