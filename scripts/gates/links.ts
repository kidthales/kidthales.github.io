import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeFromHtmlPath } from './zero-js.ts';

export interface LinkCheckResult {
  ok: boolean;
  errors: string[];
  linksChecked: number;
}

export function extractHtmlLinksAndAnchors(htmlContent: string): {
  links: string[];
  anchors: string[];
} {
  const links: string[] = [];
  const anchors: string[] = [];

  // 1. Collect all elements with id="..."
  const idRegex = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(htmlContent)) !== null) {
    const id = match[1] ?? match[2] ?? match[3];
    if (id) anchors.push(id);
  }

  // Also collect <a name="...">
  const nameRegex = /<a\b[^>]*?\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  while ((match = nameRegex.exec(htmlContent)) !== null) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name) anchors.push(name);
  }

  // 2. Collect internal <a href="...">
  const aRegex = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  while ((match = aRegex.exec(htmlContent)) !== null) {
    const href = match[1] ?? match[2] ?? match[3];
    if (href) links.push(href.trim());
  }

  return { links, anchors };
}

export function checkLinksAndAnchors(
  distDir: string,
  siteOrigin: string = 'https://kidthales.github.io'
): LinkCheckResult {
  const errors: string[] = [];
  let linksChecked = 0;

  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      errors: [`distDir does not exist: ${distDir}`],
      linksChecked: 0,
    };
  }

  // Map of normalized route -> Set of anchors present in that HTML file
  // Map of static asset paths that exist in dist
  const htmlPages = new Map<string, Set<string>>();
  const staticFiles = new Set<string>();

  // First pass: collect all HTML routes, their internal anchors, and all static files
  function indexFiles(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        indexFiles(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(distDir, fullPath).replace(/\\/g, '/');
        staticFiles.add('/' + relPath);

        if (relPath.endsWith('.html')) {
          const route = routeFromHtmlPath(relPath);
          const content = fs.readFileSync(fullPath, 'utf8');
          const { anchors } = extractHtmlLinksAndAnchors(content);
          htmlPages.set(route, new Set(anchors));
        }
      }
    }
  }

  indexFiles(distDir);

  // Second pass: validate internal links and fragments
  function validateLinks(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        validateLinks(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(distDir, fullPath).replace(/\\/g, '/');

        if (relPath.endsWith('.html')) {
          const currentRoute = routeFromHtmlPath(relPath);
          const content = fs.readFileSync(fullPath, 'utf8');
          const { links } = extractHtmlLinksAndAnchors(content);

          for (const href of links) {
            // Ignore mailto:, tel:, javascript:, etc.
            if (/^(mailto:|tel:|javascript:)/i.test(href)) {
              continue;
            }

            // External link check: if it has protocol or // and not siteOrigin, it's external (out of scope for broken link check)
            if (/^(https?:)?\/\//i.test(href)) {
              try {
                const parsed = new URL(href, siteOrigin);
                if (parsed.origin !== siteOrigin) {
                  // External link, skip
                  continue;
                }
              } catch {
                // Ignore parse errors on external
                continue;
              }
            }

            linksChecked++;

            // Split into path and fragment
            let targetPath = '';
            let fragment = '';

            if (href.startsWith('#')) {
              targetPath = currentRoute;
              fragment = href.slice(1);
            } else {
              let urlToParse = href;
              if (urlToParse.startsWith(siteOrigin)) {
                urlToParse = urlToParse.slice(siteOrigin.length);
              }
              const hashIndex = urlToParse.indexOf('#');
              if (hashIndex !== -1) {
                targetPath = urlToParse.slice(0, hashIndex);
                fragment = urlToParse.slice(hashIndex + 1);
              } else {
                targetPath = urlToParse;
              }

              // Resolve relative paths if any
              if (!targetPath.startsWith('/')) {
                // Relative to current directory
                targetPath = path.posix.join(currentRoute, targetPath);
              }
            }

            // Remove query params if any
            const qIndex = targetPath.indexOf('?');
            if (qIndex !== -1) {
              targetPath = targetPath.slice(0, qIndex);
            }

            // Trailing-slash requirement check for non-asset internal HTML routes:
            // If targetPath has an extension or exists as a static file in dist, it's an asset/static file.
            // Otherwise, internal HTML routes MUST end with a trailing slash!
            const hasExtension = /\.[a-z0-9]+$/i.test(targetPath);
            const isStaticFile = staticFiles.has(targetPath);

            if (!hasExtension && !isStaticFile && !targetPath.endsWith('/')) {
              errors.push(
                `Internal link "${href}" on page "${currentRoute}" violates trailing-slash requirement (target: "${targetPath}"). Must end with "/".`
              );
            }

            // Verify target exists
            if (isStaticFile) {
              // File exists in dist
            } else if (hasExtension) {
              if (!staticFiles.has(targetPath)) {
                errors.push(
                  `Broken internal link "${href}" on page "${currentRoute}": file "${targetPath}" not found in dist.`
                );
              }
            } else {
              // Normalized target route
              const normalizedTarget = targetPath.endsWith('/') ? targetPath : targetPath + '/';
              const targetAnchors = htmlPages.get(normalizedTarget);

              if (!targetAnchors) {
                errors.push(
                  `Broken internal link "${href}" on page "${currentRoute}": target route "${normalizedTarget}" does not exist in dist.`
                );
              } else if (fragment) {
                // Verify anchor exists on target page
                if (!targetAnchors.has(fragment)) {
                  errors.push(
                    `Broken anchor "${href}" on page "${currentRoute}": anchor "#${fragment}" does not exist in route "${normalizedTarget}".`
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  validateLinks(distDir);

  return {
    ok: errors.length === 0,
    errors,
    linksChecked,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const distDir = process.argv[2] || path.resolve(process.cwd(), 'dist');
  const result = checkLinksAndAnchors(distDir);
  if (!result.ok) {
    console.error('Internal Links & Anchors Gate FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`Internal Links & Anchors Gate PASSED (${result.linksChecked} links checked).`);
}
