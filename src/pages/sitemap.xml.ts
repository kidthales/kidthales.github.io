import type { APIRoute } from 'astro';
import { getAllEntries } from '../lib/entries';
import { getAllWorks } from '../lib/works';

export const GET: APIRoute = async ({ site }) => {
  const baseUrl = (site ? site.toString() : 'https://kidthales.github.io').replace(/\/+$/, '');

  const staticUrls = [
    `${baseUrl}/`,
    `${baseUrl}/words/`,
    `${baseUrl}/words/notes/`,
    `${baseUrl}/words/essays/`,
    `${baseUrl}/words/papers/`,
    `${baseUrl}/works/`,
    `${baseUrl}/credits/`,
  ];

  const allEntries = await getAllEntries();

  // Published + Superseded entries are included.
  // Exclude drafts, Withdrawn/expunged (noindex), and 404.
  const eligibleEntries = allEntries.filter(
    (entry) => entry.data.draft !== true && !entry.data.withdrawn_on
  );

  const entryUrls = eligibleEntries.map((entry) => `${baseUrl}/words/${entry.id}/`);

  const allWorks = await getAllWorks();

  // Non-draft works (both active and retired) are included.
  // Exclude drafts.
  const eligibleWorks = allWorks.filter((work) => work.data.draft !== true);
  const workUrls = eligibleWorks.map((work) => `${baseUrl}/works/${work.id}/`);

  const allUrls = [...staticUrls, ...entryUrls, ...workUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (url) => `  <url>
    <loc>${url}</loc>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
