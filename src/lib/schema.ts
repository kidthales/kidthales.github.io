import { z } from 'astro/zod';

export const NOTE_KINDS = ['note', 'field_note', 'observation', 'reference'] as const;
export const ESSAY_KINDS = ['essay', 'analysis', 'critique', 'retrospective'] as const;
export const PAPER_KINDS = ['paper', 'specification', 'report', 'whitepaper'] as const;

export type NoteKind = (typeof NOTE_KINDS)[number];
export type EssayKind = (typeof ESSAY_KINDS)[number];
export type PaperKind = (typeof PAPER_KINDS)[number];
export type EntryForm = 'note' | 'essay' | 'paper';

export const CANONICAL_REDACTION_STUB = 'This Entry has been expunged.';

/**
 * Legacy alias map for kinds (legacy frontmatter value -> current schema value).
 * Kept empty in MVP as specified; mutated only when deprecating/renaming kinds without modifying stored files.
 */
export const KIND_LEGACY_ALIASES: Record<string, string> = {};

export function createKindSchema<T extends readonly [string, ...string[]]>(
  validKinds: T,
  aliasMap: Record<string, string> = KIND_LEGACY_ALIASES
) {
  return z.preprocess((val) => {
    if (typeof val === 'string' && val in aliasMap) {
      return aliasMap[val];
    }
    return val;
  }, z.enum(validKinds));
}

export const erratumClassEnum = z.enum(['typo', 'correction', 'clarification']);
export type ErratumClass = z.infer<typeof erratumClassEnum>;

export const erratumSchema = z.object({
  on: z.coerce.date(),
  class: erratumClassEnum,
  fields: z.array(z.string()).optional(),
  note: z.string().min(1, 'Erratum note cannot be empty'),
});
export type Erratum = z.infer<typeof erratumSchema>;

export function defaultReferenceSchema(collection: string) {
  return z
    .union([
      z.number().transform((num) => num.toString(10)),
      z.string(),
      z.object({
        id: z.string(),
        collection: z.string(),
      }),
    ])
    .transform((val) => {
      if (typeof val === 'object') {
        return val;
      }
      return {
        id: val,
        collection,
      };
    });
}

export function refineEntry(
  data: {
    draft?: boolean;
    published_on?: Date;
    withdrawn_on?: Date;
    withdrawal_note?: string;
    expunged_on?: Date;
  },
  ctx: z.RefinementCtx
) {
  const isDraft = data.draft === true;

  // Published (draft false or absent) => published_on required
  if (!isDraft && !data.published_on) {
    ctx.addIssue({
      code: 'custom',
      message: 'Published entries require published_on',
      path: ['published_on'],
    });
  }

  // withdrawn_on <=> withdrawal_note (biconditional)
  if (data.withdrawn_on && !data.withdrawal_note) {
    ctx.addIssue({
      code: 'custom',
      message: 'Withdrawn entries require withdrawal_note',
      path: ['withdrawal_note'],
    });
  }
  if (data.withdrawal_note && !data.withdrawn_on) {
    ctx.addIssue({
      code: 'custom',
      message: 'withdrawal_note requires withdrawn_on',
      path: ['withdrawn_on'],
    });
  }

  // expunged_on => withdrawal_note and withdrawn_on
  if (data.expunged_on) {
    if (!data.withdrawal_note) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expunged entries require withdrawal_note',
        path: ['withdrawal_note'],
      });
    }
    if (!data.withdrawn_on) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expunged entries require withdrawn_on',
        path: ['withdrawn_on'],
      });
    }
  }
}

export function createWordsSchema(
  referenceFn: (collection: string) => z.ZodType = defaultReferenceSchema,
  aliasMap: Record<string, string> = KIND_LEGACY_ALIASES
) {
  const refSchema = referenceFn('words');

  const baseSchema = {
    title: z.string().min(1, 'Title cannot be empty'),
    draft: z.boolean().default(false),
    published_on: z.coerce.date().optional(),
    errata: z.array(erratumSchema).default([]),
    superseded_by: refSchema.optional(),
    withdrawal_note: z.string().optional(),
    withdrawn_on: z.coerce.date().optional(),
    expunged_on: z.coerce.date().optional(),
  };

  const noteSchema = z.object({
    ...baseSchema,
    form: z.literal('note'),
    kind: createKindSchema(NOTE_KINDS, aliasMap),
    description: z.string().optional(),
  });

  const essaySchema = z.object({
    ...baseSchema,
    form: z.literal('essay'),
    kind: createKindSchema(ESSAY_KINDS, aliasMap),
    description: z.string().min(1, 'description is required'),
  });

  const paperSchema = z.object({
    ...baseSchema,
    form: z.literal('paper'),
    kind: createKindSchema(PAPER_KINDS, aliasMap),
    description: z.string().min(1, 'description is required'),
  });

  return z.discriminatedUnion('form', [noteSchema, essaySchema, paperSchema]).superRefine(refineEntry);
}
