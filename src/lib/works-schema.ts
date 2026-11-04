import { z } from 'astro/zod';

export const WORK_KINDS = ['tool', 'app', 'game'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const RESERVED_WORK_SLUGS = ['tools', 'apps', 'games'] as const;
export type ReservedWorkSlug = (typeof RESERVED_WORK_SLUGS)[number];

const RESERVED_WORK_SLUG_SET = new Set<string>(RESERVED_WORK_SLUGS);

export function isReservedWorkSlug(slug: string): boolean {
  return RESERVED_WORK_SLUG_SET.has(slug);
}

export const WORK_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_WORK_SLUG_LENGTH = 60;

/**
 * Validates work slug grammar and checks against reserved slugs.
 * Throws explicit build errors naming the slug and entry id.
 */
export function validateWorkSlug(slug: string, entryId?: string): void {
  const id = entryId ?? slug;

  if (isReservedWorkSlug(slug)) {
    throw new Error(
      `Reserved slug error: Work '${id}' uses reserved slug '${slug}'. Reserved route slugs cannot be used as Work slugs.`
    );
  }

  if (slug.length > MAX_WORK_SLUG_LENGTH) {
    throw new Error(
      `Invalid slug grammar error: Work '${id}' has slug '${slug}' exceeding max length of ${MAX_WORK_SLUG_LENGTH} characters (length: ${slug.length}).`
    );
  }

  if (!WORK_SLUG_REGEX.test(slug)) {
    throw new Error(
      `Invalid slug grammar error: Work '${id}' has slug '${slug}' which does not conform to regex ^[a-z0-9]+(-[a-z0-9]+)*$.`
    );
  }
}

/**
 * Validates that all work entries conform to slug grammar and do not collide with reserved slugs.
 */
export function validateWorkSlugs<T extends { id: string }>(entries: T[]): void {
  for (const entry of entries) {
    validateWorkSlug(entry.id, entry.id);
  }
}

/**
 * Invariant: Adding a reserved slug later is allowed only if no published Work uses it.
 */
export function assertCanReserveWorkSlug(newReservedSlug: string, publishedSlugs: string[]): void {
  if (publishedSlugs.includes(newReservedSlug)) {
    throw new Error(
      `Cannot reserve slug '${newReservedSlug}': already in use by a published Work.`
    );
  }
}

export function refineWork(
  data: {
    kind?: WorkKind;
    draft?: boolean;
    published_on?: Date;
    retired_on?: Date;
    retirement_note?: string;
    external_url?: string;
  },
  ctx: z.RefinementCtx
): void {
  const isDraft = data.draft === true;

  // Published (draft false or absent) => published_on required
  if (!isDraft && !data.published_on) {
    ctx.addIssue({
      code: 'custom',
      message: 'Published works require published_on',
      path: ['published_on'],
    });
  }

  // Published game and app entries require external_url
  if (!isDraft && (data.kind === 'game' || data.kind === 'app') && !data.external_url) {
    ctx.addIssue({
      code: 'custom',
      message: `Published ${data.kind} works require external_url`,
      path: ['external_url'],
    });
  }

  // retired_on <=> retirement_note (biconditional)
  const hasNote = Boolean(data.retirement_note && data.retirement_note.trim().length > 0);
  if (data.retired_on && !hasNote) {
    ctx.addIssue({
      code: 'custom',
      message: 'Retired works require retirement_note',
      path: ['retirement_note'],
    });
  }

  if (data.retirement_note && !data.retired_on) {
    ctx.addIssue({
      code: 'custom',
      message: 'retirement_note requires retired_on',
      path: ['retired_on'],
    });
  }
}

export const workBaseSchema = z
  .object({
    title: z.string().min(1, 'Title cannot be empty'),
    kind: z.enum(WORK_KINDS),
    description: z.string().min(1, 'Description cannot be empty'),
    draft: z.boolean().default(false),
    published_on: z.coerce.date().optional(),
    retired_on: z.coerce.date().optional(),
    retirement_note: z.string().optional(),
    external_url: z.string().url().optional(),
  })
  .strict();

export type WorkData = z.infer<typeof workBaseSchema>;

export function createWorksSchema() {
  return workBaseSchema.superRefine(refineWork);
}

export const worksSchema = createWorksSchema();
