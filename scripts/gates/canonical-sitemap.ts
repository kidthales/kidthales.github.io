import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeFromHtmlPath } from './zero-js.ts';

export interface CanonicalSitemapResult {
  ok: boolean;
  errors: string[];
  pagesChecked: number;
  sitemapUrlsChecked: number;
}

export function checkCanonicalAndSitemap(
  distDir: string,
  siteOrigin: string = 'https://kidthales.github.io'
): CanonicalSitemapResult {
  const errors: string[] = [];
  let pagesChecked = 0;
  let sitemapUrlsChecked = 0;

  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      errors: [`distDir does not exist: ${distDir}`],
      pagesChecked: 0,
      sitemapUrlsChecked: 0,
    };
  }

  // Set of all HTML routes present in dist, mapping route -> { hasNoindex: boolean }
  const htmlRoutes = new Map<string, { hasNoindex: boolean; file: string }>();

  // Walk dist to check canonical tag on every HTML file
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(distDir, fullPath).replace(/\\/g, '/');

        if (relPath.endsWith('.html')) {
          pagesChecked++;
          const route = routeFromHtmlPath(relPath);
          const content = fs.readFileSync(fullPath, 'utf8');

          const hasNoindex = /<meta\b[^>]*?\bname\s*=\s*(?:"robots"|'robots')[^>]*?\bcontent\s*=\s*(?:"[^"]*noindex[^"]*"|'[^']*noindex[^']*')[^>]*>/i.test(
            content
          ) || /<meta\b[^>]*?\bcontent\s*=\s*(?:"[^"]*noindex[^"]*"|'[^']*noindex[^']*')[^>]*?\bname\s*=\s*(?:"robots"|'robots')[^>]*>/i.test(
            content
          );

          htmlRoutes.set(route, { hasNoindex, file: relPath });

          // 404 page is not an indexed route, but does it have canonical?
          // The spec requirement:
          // "exactly one absolute trailing-slash canonical per dist/**/*.html"
          // Let's verify <link rel="canonical" href="...">
          const canonicalMatches: string[] = [];
          const canonicalRegex = /<link\b[^>]*?\brel\s*=\s*(?:"canonical"|'canonical')[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
          let match: RegExpExecArray | null;
          while ((match = canonicalRegex.exec(content)) !== null) {
            const href = match[1] ?? match[2] ?? match[3];
            if (href) canonicalMatches.push(href);
          }
          // Also check reverse attribute order: href before rel
          const reverseCanonicalRegex = /<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*?\brel\s*=\s*(?:"canonical"|'canonical')[^>]*>/gi;
          while ((match = reverseCanonicalRegex.exec(content)) !== null) {
            const href = match[1] ?? match[2] ?? match[3];
            if (href && !canonicalMatches.includes(href)) {
              canonicalMatches.push(href);
            }
          }

          if (canonicalMatches.length === 0) {
            errors.push(`Missing canonical tag in "${relPath}" (route "${route}")`);
          } else if (canonicalMatches.length > 1) {
            errors.push(
              `Multiple canonical tags found in "${relPath}": ${canonicalMatches.join(', ')}`
            );
          } else {
            const href = canonicalMatches[0];
            // Must be absolute
            if (!href.startsWith('http://') && !href.startsWith('https://')) {
              errors.push(`Canonical URL "${href}" in "${relPath}" is not absolute.`);
            } else {
              // Must have siteOrigin
              if (!href.startsWith(siteOrigin)) {
                errors.push(
                  `Canonical URL "${href}" in "${relPath}" origin does not match expected "${siteOrigin}".`
                );
              }
              // Must have trailing slash
              if (!href.endsWith('/')) {
                errors.push(
                  `Canonical URL "${href}" in "${relPath}" violates trailing-slash requirement.`
                );
              }
              // Expected canonical url for route
              const expectedHref = `${siteOrigin}${route}`;
              if (href !== expectedHref) {
                errors.push(
                  `Canonical URL mismatch in "${relPath}": got "${href}", expected "${expectedHref}".`
                );
              }
            }
          }
        }
      }
    }
  }

  walk(distDir);

  // Validate sitemap.xml
  const sitemapPath = path.join(distDir, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    errors.push('sitemap.xml not found in dist');
    return {
      ok: false,
      errors,
      pagesChecked,
      sitemapUrlsChecked,
    };
  }

  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let locMatch: RegExpExecArray | null;
  const sitemapUrls: string[] = [];
  while ((locMatch = locRegex.exec(sitemapContent)) !== null) {
    sitemapUrls.push(locMatch[1]);
  }

  sitemapUrlsChecked = sitemapUrls.length;

  for (const urlStr of sitemapUrls) {
    // 1. Must be absolute and have trailing slash
    if (!urlStr.startsWith(siteOrigin)) {
      errors.push(`Sitemap URL "${urlStr}" does not match site origin "${siteOrigin}".`);
      continue;
    }
    if (!urlStr.endsWith('/')) {
      errors.push(`Sitemap URL "${urlStr}" is missing trailing slash.`);
      continue;
    }

    const route = urlStr.slice(siteOrigin.length);
    const pageInfo = htmlRoutes.get(route);

    if (!pageInfo) {
      errors.push(
        `Sitemap URL "${urlStr}" (route "${route}") does not correspond to any generated HTML file in dist.`
      );
    } else if (pageInfo.hasNoindex) {
      errors.push(
        `Sitemap URL "${urlStr}" points to a page marked with noindex (file: "${pageInfo.file}"). Pages with noindex must not be in sitemap.`
      );
    }
  }

  // Also check if any page marked with noindex appears in sitemap
  // The check above already caught that, but let's confirm withdrawn / expunged notes in fixture build
  // (which have noindex: true) are absent from sitemap.

  return {
    ok: errors.length === 0,
    errors,
    pagesChecked,
    sitemapUrlsChecked,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const distDir = process.argv[2] || path.resolve(process.cwd(), 'dist');
  const result = checkCanonicalAndSitemap(distDir);
  if (!result.ok) {
    console.error('Canonical & Sitemap Gate FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(
    `Canonical & Sitemap Gate PASSED (${result.pagesChecked} HTML pages and ${result.sitemapUrlsChecked} sitemap URLs checked).`
  );
}
