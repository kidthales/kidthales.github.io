import test from 'node:test';
import assert from 'node:assert';
import {
  createWorksSchema,
  worksSchema,
  WORK_KINDS,
  RESERVED_WORK_SLUGS,
  isReservedWorkSlug,
  validateWorkSlug,
  validateWorkSlugs,
  assertCanReserveWorkSlug,
  MAX_WORK_SLUG_LENGTH,
} from '../src/lib/works-schema.ts';

test('WORK_KINDS contains tool, app, and game', () => {
  assert.deepStrictEqual(WORK_KINDS, ['tool', 'app', 'game']);
});

test('RESERVED_WORK_SLUGS contains exact required 3 slugs', () => {
  assert.deepStrictEqual(RESERVED_WORK_SLUGS, ['tools', 'apps', 'games']);
});

test('isReservedWorkSlug identifies reserved work slugs', () => {
  assert.strictEqual(isReservedWorkSlug('tools'), true);
  assert.strictEqual(isReservedWorkSlug('apps'), true);
  assert.strictEqual(isReservedWorkSlug('games'), true);
  assert.strictEqual(isReservedWorkSlug('spiderex'), false);
  assert.strictEqual(isReservedWorkSlug('tool'), false);
});

test('validateWorkSlug rejects all reserved slugs', () => {
  for (const reserved of RESERVED_WORK_SLUGS) {
    assert.throws(
      () => validateWorkSlug(reserved),
      (err: any) =>
        err.message.includes('Reserved slug error') &&
        err.message.includes(`uses reserved slug '${reserved}'`)
    );
  }
});

test('validateWorkSlug accepts valid kebab-case slugs', () => {
  assert.doesNotThrow(() => validateWorkSlug('spiderex'));
  assert.doesNotThrow(() => validateWorkSlug('spiderex-trainer'));
  assert.doesNotThrow(() => validateWorkSlug('guitar-tool-1'));
  assert.doesNotThrow(() => validateWorkSlug('cool-game-2026'));
});

test('validateWorkSlug rejects malformed slug grammar', () => {
  // Uppercase
  assert.throws(
    () => validateWorkSlug('Spiderex'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Underscores
  assert.throws(
    () => validateWorkSlug('spider_ex'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Special characters
  assert.throws(
    () => validateWorkSlug('spiderex!'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Consecutive hyphens
  assert.throws(
    () => validateWorkSlug('spider--ex'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Leading hyphen
  assert.throws(
    () => validateWorkSlug('-spiderex'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Trailing hyphen
  assert.throws(
    () => validateWorkSlug('spiderex-'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Empty string
  assert.throws(
    () => validateWorkSlug(''),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Exceeding max length
  const tooLong = 'a'.repeat(MAX_WORK_SLUG_LENGTH + 1);
  assert.throws(
    () => validateWorkSlug(tooLong),
    (err: any) =>
      err.message.includes('Invalid slug grammar error') &&
      err.message.includes(`exceeding max length of ${MAX_WORK_SLUG_LENGTH}`)
  );
});

test('validateWorkSlugs validates an array of work entries', () => {
  assert.doesNotThrow(() =>
    validateWorkSlugs([
      { id: 'spiderex' },
      { id: 'sample-app' },
      { id: 'sample-game' },
    ])
  );

  assert.throws(
    () =>
      validateWorkSlugs([
        { id: 'spiderex' },
        { id: 'tools' }, // Reserved
      ]),
    (err: any) => err.message.includes('Reserved slug error')
  );
});

test('assertCanReserveWorkSlug enforces unallocated slug requirement', () => {
  const published = ['spiderex', 'sample-app'];
  assert.doesNotThrow(() => assertCanReserveWorkSlug('new-category', published));
  assert.throws(
    () => assertCanReserveWorkSlug('spiderex', published),
    (err: any) => err.message.includes("Cannot reserve slug 'spiderex': already in use")
  );
});

test('worksSchema validates valid Tool, App, and Game works', () => {
  const schema = worksSchema;

  // Valid Tool
  const validTool = schema.parse({
    title: 'Spiderex',
    kind: 'tool',
    description: 'Guitar fretboard permutational spider-exercise trainer.',
    draft: false,
    published_on: '2026-03-01',
  });
  assert.strictEqual(validTool.title, 'Spiderex');
  assert.strictEqual(validTool.kind, 'tool');
  assert.strictEqual(validTool.draft, false);

  // Valid App
  const validApp = schema.parse({
    title: 'Sample App',
    kind: 'app',
    description: 'An interactive web application.',
    published_on: '2026-03-05',
  });
  assert.strictEqual(validApp.kind, 'app');
  assert.strictEqual(validApp.draft, false); // Default false

  // Valid Game
  const validGame = schema.parse({
    title: 'Sample Game',
    kind: 'game',
    description: 'A 2D Action Game Maker game.',
    published_on: '2026-03-10',
  });
  assert.strictEqual(validGame.kind, 'game');
});

test('worksSchema enforces kind enum', () => {
  const schema = createWorksSchema();

  assert.throws(
    () =>
      schema.parse({
        title: 'Unknown Kind Work',
        kind: 'movie',
        description: 'Not a valid kind.',
        published_on: '2026-03-01',
      }),
    (err: any) => err.name === 'ZodError'
  );
});

test('worksSchema enforces published works have published_on', () => {
  const schema = createWorksSchema();

  assert.throws(
    () =>
      schema.parse({
        title: 'Published Work Without Date',
        kind: 'tool',
        description: 'Should fail because published_on is missing.',
        draft: false,
      }),
    (err: any) =>
      err.name === 'ZodError' &&
      err.message.includes('Published works require published_on')
  );

  // Draft works do not require published_on
  const draft = schema.parse({
    title: 'Draft Work',
    kind: 'tool',
    description: 'Upcoming work.',
    draft: true,
  });
  assert.strictEqual(draft.draft, true);
  assert.strictEqual(draft.published_on, undefined);
});

test('worksSchema enforces biconditional retired_on <=> retirement_note (N10 scenario)', () => {
  const schema = createWorksSchema();

  // retired_on without retirement_note throws N10 violation
  assert.throws(
    () =>
      schema.parse({
        title: 'Retired Without Note',
        kind: 'tool',
        description: 'Should fail due to missing retirement_note.',
        published_on: '2026-01-01',
        retired_on: '2026-03-01',
      }),
    (err: any) =>
      err.name === 'ZodError' &&
      err.message.includes('Retired works require retirement_note')
  );

  // retired_on with empty / whitespace retirement_note throws
  assert.throws(
    () =>
      schema.parse({
        title: 'Retired With Empty Note',
        kind: 'tool',
        description: 'Should fail due to whitespace retirement_note.',
        published_on: '2026-01-01',
        retired_on: '2026-03-01',
        retirement_note: '   ',
      }),
    (err: any) =>
      err.name === 'ZodError' &&
      err.message.includes('Retired works require retirement_note')
  );

  // retirement_note without retired_on throws
  assert.throws(
    () =>
      schema.parse({
        title: 'Note Without Retired Date',
        kind: 'tool',
        description: 'Should fail due to missing retired_on.',
        published_on: '2026-01-01',
        retirement_note: 'Archived project.',
      }),
    (err: any) =>
      err.name === 'ZodError' &&
      err.message.includes('retirement_note requires retired_on')
  );

  // Valid retired work parses cleanly
  const validRetired = schema.parse({
    title: 'Valid Retired Work',
    kind: 'app',
    description: 'An archived historical application.',
    published_on: '2024-01-01',
    retired_on: '2025-01-01',
    retirement_note: 'Superseded by modern rewrite.',
  });
  assert.strictEqual(validRetired.title, 'Valid Retired Work');
  assert.ok(validRetired.retired_on);
  assert.strictEqual(validRetired.retirement_note, 'Superseded by modern rewrite.');
});

test('worksSchema rejects extraneous unknown fields (.strict())', () => {
  const schema = createWorksSchema();

  assert.throws(
    () =>
      schema.parse({
        title: 'Work With Extra Property',
        kind: 'tool',
        description: 'Should fail strictness check.',
        published_on: '2026-03-01',
        repository_url: 'https://github.com/example/repo',
      }),
    (err: any) =>
      err.name === 'ZodError' &&
      err.message.includes('Unrecognized key')
  );
});

test('worksSchema rejects empty title and description', () => {
  const schema = createWorksSchema();

  assert.throws(
    () =>
      schema.parse({
        title: '',
        kind: 'tool',
        description: 'Valid description.',
        published_on: '2026-03-01',
      }),
    (err: any) => err.name === 'ZodError' && err.message.includes('Title cannot be empty')
  );

  assert.throws(
    () =>
      schema.parse({
        title: 'Valid Title',
        kind: 'tool',
        description: '',
        published_on: '2026-03-01',
      }),
    (err: any) => err.name === 'ZodError' && err.message.includes('Description cannot be empty')
  );
});

test('KIND_LABELS and KIND_GLYPHS are defined for all work kinds', async () => {
  const { KIND_LABELS, KIND_GLYPHS } = await import('../src/lib/works.ts');

  assert.strictEqual(KIND_LABELS.tool, 'Tool');
  assert.strictEqual(KIND_LABELS.app, 'App');
  assert.strictEqual(KIND_LABELS.game, 'Game');

  assert.strictEqual(KIND_GLYPHS.tool, '🛠');
  assert.strictEqual(KIND_GLYPHS.app, '◈');
  assert.strictEqual(KIND_GLYPHS.game, '🎮');
});

test('isRetired correctly identifies retirement status', async () => {
  const { isRetired } = await import('../src/lib/works.ts');

  assert.strictEqual(isRetired({ data: { retired_on: new Date('2025-01-01') } }), true);
  assert.strictEqual(isRetired({ data: { retired_on: undefined } }), false);
  assert.strictEqual(isRetired({ data: {} }), false);
});

test('works formatDate outputs ISO YYYY-MM-DD', async () => {
  const { formatDate } = await import('../src/lib/works.ts');

  assert.strictEqual(formatDate(new Date('2026-03-01T00:00:00Z')), '2026-03-01');
  assert.strictEqual(formatDate('2026-03-01'), '2026-03-01');
  assert.strictEqual(formatDate(undefined), '');
});
