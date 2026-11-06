/**
 * Reserved Slugs and Slug Grammar Invariants
 *
 * Prevents route shadowing and malformed permalinks for Words entries.
 */

export const RESERVED_SLUGS = [
  'notes',
  'essays',
  'papers',
  'feed',
  'rss',
  'atom',
  'tags',
  'archive',
  'page',
  'index',
  'search',
  'drafts',
] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];

const RESERVED_SLUG_SET = new Set<string>(RESERVED_SLUGS);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUG_SET.has(slug);
}

export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 60;

/**
 * Validates slug grammar and checks against reserved slugs.
 * Throws explicit build errors naming the slug and entry id.
 */
export function validateSlug(slug: string, entryId?: string): void {
  const id = entryId ?? slug;

  if (isReservedSlug(slug)) {
    throw new Error(
      `Reserved slug error: Entry '${id}' uses reserved slug '${slug}'. Reserved route slugs cannot be used as Entry slugs.`
    );
  }

  if (slug.length > MAX_SLUG_LENGTH) {
    throw new Error(
      `Invalid slug grammar error: Entry '${id}' has slug '${slug}' exceeding max length of ${MAX_SLUG_LENGTH} characters (length: ${slug.length}).`
    );
  }

  if (!SLUG_REGEX.test(slug)) {
    throw new Error(
      `Invalid slug grammar error: Entry '${id}' has slug '${slug}' which does not conform to regex ^[a-z0-9]+(-[a-z0-9]+)*$.`
    );
  }
}

/**
 * Validates that all entries conform to slug grammar and do not collide with reserved slugs.
 */
export function validateEntrySlugs<T extends { id: string }>(entries: T[]): void {
  for (const entry of entries) {
    validateSlug(entry.id, entry.id);
  }
}

/**
 * Invariant: Adding a reserved slug later is allowed only if no published Entry uses it.
 */
export function assertCanReserveSlug(newReservedSlug: string, publishedSlugs: string[]): void {
  if (publishedSlugs.includes(newReservedSlug)) {
    throw new Error(
      `Cannot reserve slug '${newReservedSlug}': already in use by a published Entry.`
    );
  }
}
