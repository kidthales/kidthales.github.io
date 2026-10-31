import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, type WorksIsland } from './islands.ts';
import { routeFromHtmlPath } from './zero-js.ts';

export interface OriginCheckResult {
  ok: boolean;
  errors: string[];
  resourcesChecked: number;
}

/**
 * Extracts non-same-origin URLs from resource-loading attributes:
 * - <script src="...">
 * - <link href="...">
 * - <img> / <source> src="..." and srcset="..."
 * - <iframe src="...">
 * - <video> / <audio> src="..." and poster="..."
 * - CSS url(...) and @import ...
 *
 * Outbound <a href> is strictly NOT scanned.
 */

// Helper to determine if a URL is same-origin or local
export function isNonSameOrigin(
  urlStr: string,
  siteOrigin: string = 'https://kidthales.github.io'
): { isExternal: boolean; origin?: string } {
  const trimmed = urlStr.trim().replace(/^['"]|['"]$/g, '');

  // Empty or anchors or data URIs or mailto
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('data:') || trimmed.startsWith('mailto:') || trimmed.startsWith('javascript:')) {
    return { isExternal: false };
  }

  // Root-relative or relative paths are same-origin
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { isExternal: false };
  }

  // Protocol-relative //example.com
  if (trimmed.startsWith('//')) {
    try {
      const parsed = new URL('https:' + trimmed);
      if (parsed.origin === siteOrigin) {
        return { isExternal: false };
      }
      return { isExternal: true, origin: parsed.origin };
    } catch {
      return { isExternal: true, origin: trimmed };
    }
  }

  // Absolute URL
  try {
    const parsed = new URL(trimmed);
    if (parsed.origin === siteOrigin) {
      return { isExternal: false };
    }
    return { isExternal: true, origin: parsed.origin };
  } catch {
    // Relative path like "fonts/font.woff2" without leading slash
    return { isExternal: false };
  }
}

export function scanHtmlResources(htmlContent: string): string[] {
  const urls: string[] = [];

  // 1. <script ... src="...">
  const scriptRegex = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const val = match[1] ?? match[2] ?? match[3];
    if (val) urls.push(val);
  }

  // 2. <link ... href="...">
  const linkRegex = /<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const val = match[1] ?? match[2] ?? match[3];
    if (val) urls.push(val);
  }

  // 3. <img ... src="..." or srcset="...">
  const imgRegex = /<img\b[^>]*>/gi;
  while ((match = imgRegex.exec(htmlContent)) !== null) {
    const tag = match[0];
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (srcMatch) {
      const val = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3];
      if (val) urls.push(val);
    }
    const srcsetMatch = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (srcsetMatch) {
      const srcsetVal = srcsetMatch[1] ?? srcsetMatch[2] ?? srcsetMatch[3];
      if (srcsetVal) {
        // split srcset candidates
        const parts = srcsetVal.split(',').map((p) => p.trim().split(/\s+/)[0]);
        for (const p of parts) {
          if (p) urls.push(p);
        }
      }
    }
  }

  // 4. <source ... src="..." or srcset="...">
  const sourceRegex = /<source\b[^>]*>/gi;
  while ((match = sourceRegex.exec(htmlContent)) !== null) {
    const tag = match[0];
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (srcMatch) {
      const val = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3];
      if (val) urls.push(val);
    }
    const srcsetMatch = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (srcsetMatch) {
      const srcsetVal = srcsetMatch[1] ?? srcsetMatch[2] ?? srcsetMatch[3];
      if (srcsetVal) {
        const parts = srcsetVal.split(',').map((p) => p.trim().split(/\s+/)[0]);
        for (const p of parts) {
          if (p) urls.push(p);
        }
      }
    }
  }

  // 5. <iframe ... src="...">
  const iframeRegex = /<iframe\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  while ((match = iframeRegex.exec(htmlContent)) !== null) {
    const val = match[1] ?? match[2] ?? match[3];
    if (val) urls.push(val);
  }

  // 6. <video> / <audio> ... src="..." and poster="..."
  const mediaRegex = /<(?:video|audio)\b[^>]*>/gi;
  while ((match = mediaRegex.exec(htmlContent)) !== null) {
    const tag = match[0];
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (srcMatch) {
      const val = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3];
      if (val) urls.push(val);
    }
    const posterMatch = /\bposter\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (posterMatch) {
      const val = posterMatch[1] ?? posterMatch[2] ?? posterMatch[3];
      if (val) urls.push(val);
    }
  }

  // 7. Inline styles with url(...)
  const inlineUrlRegex = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi;
  while ((match = inlineUrlRegex.exec(htmlContent)) !== null) {
    const val = match[1] ?? match[2] ?? match[3];
    if (val) urls.push(val);
  }

  return urls;
}

export function scanCssResources(cssContent: string): string[] {
  const urls: string[] = [];

  // CSS url(...)
  const urlRegex = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(cssContent)) !== null) {
    const val = match[1] ?? match[2] ?? match[3];
    if (val) urls.push(val.trim());
  }

  // CSS @import ...
  const importRegex = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)|"([^"]*)"|'([^']*)');?/gi;
  while ((match = importRegex.exec(cssContent)) !== null) {
    const val = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (val) urls.push(val.trim());
  }

  return urls;
}

export function checkOrigins(
  distDir: string,
  manifest: WorksIsland[] = [],
  siteOrigin: string = 'https://kidthales.github.io'
): OriginCheckResult {
  const errors: string[] = [];
  let resourcesChecked = 0;

  // Validate manifest structure and routes
  const manifestErrors = validateManifest(manifest);
  for (const merr of manifestErrors) {
    errors.push(`Manifest validation error for route "${merr.route}": ${merr.error}`);
  }

  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      errors: [`distDir does not exist: ${distDir}`, ...errors],
      resourcesChecked: 0,
    };
  }

  // Build lookup of allowed origins per route
  const allowedOriginsByRoute = new Map<string, Set<string>>();
  for (const item of manifest) {
    const set = new Set<string>();
    if (Array.isArray(item.origins)) {
      for (const orig of item.origins) {
        try {
          const parsed = new URL(orig.origin);
          set.add(parsed.origin);
        } catch {
          // ignore here, manifest validation handles malformed
        }
      }
    }
    allowedOriginsByRoute.set(item.route, set);
  }

  // Also check CSS files for non-same-origin references
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(distDir, fullPath).replace(/\\/g, '/');

        if (relPath.endsWith('.html')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const route = routeFromHtmlPath(relPath);
          const urls = scanHtmlResources(content);
          const routeAllowedOrigins = allowedOriginsByRoute.get(route) || new Set<string>();

          for (const u of urls) {
            resourcesChecked++;
            const { isExternal, origin } = isNonSameOrigin(u, siteOrigin);
            if (isExternal && origin) {
              if (!routeAllowedOrigins.has(origin)) {
                errors.push(
                  `Unauthorized third-party origin "${origin}" in resource "${u}" loaded on route "${route}" (${relPath}). Route does not grant this origin in works-islands.ts.`
                );
              }
            }
          }
        } else if (relPath.endsWith('.css')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const urls = scanCssResources(content);
          for (const u of urls) {
            resourcesChecked++;
            const { isExternal, origin } = isNonSameOrigin(u, siteOrigin);
            if (isExternal && origin) {
              errors.push(
                `Unauthorized third-party origin "${origin}" in CSS resource "${u}" in file "${relPath}". Site CSS must have 0 external origins.`
              );
            }
          }
        }
      }
    }
  }

  walk(distDir);

  return {
    ok: errors.length === 0,
    errors,
    resourcesChecked,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const distDir = process.argv[2] || path.resolve(process.cwd(), 'dist');
  let manifest: WorksIsland[] = [];
  try {
    const mod = await import('../../src/works-islands.js');
    manifest = mod.worksIslands || [];
  } catch {
    try {
      const mod = await import('../../src/works-islands.ts');
      manifest = mod.worksIslands || [];
    } catch {
      // fallback
    }
  }

  const result = checkOrigins(distDir, manifest);
  if (!result.ok) {
    console.error('Origin Gate FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`Origin Gate PASSED (${result.resourcesChecked} resource references checked).`);
}
