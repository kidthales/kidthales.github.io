import test from 'node:test';
import assert from 'node:assert';
import {
  RESERVED_SLUGS,
  isReservedSlug,
  validateSlug,
  validateEntrySlugs,
  assertCanReserveSlug,
  MAX_SLUG_LENGTH,
} from '../src/reserved-slugs.ts';
import {
  getErrataCalloutText,
  getSuccessor,
  getPredecessors,
  formatDate,
  FORM_LABELS,
  FORM_GLYPHS,
} from '../src/lib/entries.ts';

test('RESERVED_SLUGS contains exact required 12 slugs', () => {
  const expected = [
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
  ];
  assert.deepStrictEqual(Array.from(RESERVED_SLUGS), expected);
});

test('isReservedSlug correctly identifies reserved slugs', () => {
  for (const slug of RESERVED_SLUGS) {
    assert.strictEqual(isReservedSlug(slug), true, `Slug '${slug}' should be reserved`);
  }
  assert.strictEqual(isReservedSlug('valid-slug'), false);
  assert.strictEqual(isReservedSlug('my-note'), false);
});

test('validateSlug rejects all reserved slugs (N5)', () => {
  for (const slug of RESERVED_SLUGS) {
    assert.throws(
      () => validateSlug(slug),
      (err: any) =>
        err.message.includes('Reserved slug error') &&
        err.message.includes(slug),
      `Expected reserved slug error for '${slug}'`
    );
  }
});

test('validateSlug enforces grammar rules (N9)', () => {
  // Valid slugs
  assert.doesNotThrow(() => validateSlug('a'));
  assert.doesNotThrow(() => validateSlug('valid-note'));
  assert.doesNotThrow(() => validateSlug('note-123-test'));
  assert.doesNotThrow(() => validateSlug('123-numbers'));

  // Invalid: uppercase
  assert.throws(
    () => validateSlug('Bad-Slug'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Invalid: underscores
  assert.throws(
    () => validateSlug('bad_slug'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Invalid: special chars
  assert.throws(
    () => validateSlug('bad!slug'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Invalid: leading hyphen
  assert.throws(
    () => validateSlug('-leading'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Invalid: trailing hyphen
  assert.throws(
    () => validateSlug('trailing-'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Invalid: double hyphen
  assert.throws(
    () => validateSlug('double--hyphen'),
    (err: any) => err.message.includes('Invalid slug grammar error')
  );

  // Invalid: length > 60 chars
  const longSlug = 'a'.repeat(MAX_SLUG_LENGTH + 1);
  assert.throws(
    () => validateSlug(longSlug),
    (err: any) =>
      err.message.includes('Invalid slug grammar error') &&
      err.message.includes('exceeding max length of 60')
  );

  // Valid length exactly 60 chars
  const exactSlug = 'a'.repeat(MAX_SLUG_LENGTH);
  assert.doesNotThrow(() => validateSlug(exactSlug));
});

test('validateEntrySlugs validates array of entries', () => {
  const validEntries = [
    { id: 'first-entry' },
    { id: 'second-entry' },
  ];
  assert.doesNotThrow(() => validateEntrySlugs(validEntries));

  const invalidEntries = [
    { id: 'first-entry' },
    { id: 'notes' },
  ];
  assert.throws(
    () => validateEntrySlugs(invalidEntries),
    (err: any) => err.message.includes('Reserved slug error: Entry \'notes\' uses reserved slug \'notes\'')
  );
});

test('assertCanReserveSlug permits only unallocated slugs', () => {
  const publishedSlugs = ['first-entry', 'second-entry'];

  // Not published -> permitted
  assert.doesNotThrow(() => assertCanReserveSlug('brand-new', publishedSlugs));

  // Already published -> prohibited
  assert.throws(
    () => assertCanReserveSlug('first-entry', publishedSlugs),
    (err: any) => err.message.includes("Cannot reserve slug 'first-entry': already in use by a published Entry")
  );
});

test('getErrataCalloutText formats substantive errata properly', () => {
  // Empty or undefined -> null
  assert.strictEqual(getErrataCalloutText(undefined), null);
  assert.strictEqual(getErrataCalloutText([]), null);

  // Only typos -> null (no top callout for typos)
  assert.strictEqual(
    getErrataCalloutText([{ class: 'typo' }]),
    null
  );

  // Corrections only
  assert.strictEqual(
    getErrataCalloutText([{ class: 'correction' }]),
    'Corrected 1×'
  );
  assert.strictEqual(
    getErrataCalloutText([{ class: 'correction' }, { class: 'correction' }]),
    'Corrected 2×'
  );

  // Clarifications only
  assert.strictEqual(
    getErrataCalloutText([{ class: 'clarification' }]),
    'Clarified 1×'
  );

  // Mixed: Corrected 2× · clarified 1×
  assert.strictEqual(
    getErrataCalloutText([
      { class: 'typo' },
      { class: 'correction' },
      { class: 'correction' },
      { class: 'clarification' },
    ]),
    'Corrected 2× · clarified 1×'
  );
});

test('getSuccessor and getPredecessors resolve reciprocal supersession links', () => {
  const entryA = {
    id: 'legacy-entry',
    data: {
      title: 'Legacy Entry',
      superseded_by: 'modern-entry',
    },
  };
  const entryB = {
    id: 'modern-entry',
    data: {
      title: 'Modern Entry',
    },
  };
  const allEntries = [entryA, entryB];

  // Successor resolution
  assert.strictEqual(getSuccessor(entryA, allEntries)?.id, 'modern-entry');
  assert.strictEqual(getSuccessor(entryB, allEntries), undefined);

  // Predecessors backlink resolution
  const predecessors = getPredecessors(entryB, allEntries);
  assert.strictEqual(predecessors.length, 1);
  assert.strictEqual(predecessors[0].id, 'legacy-entry');
  assert.strictEqual(getPredecessors(entryA, allEntries).length, 0);
});

test('FORM_LABELS and FORM_GLYPHS are defined for all forms', () => {
  assert.strictEqual(FORM_LABELS.note, 'Note');
  assert.strictEqual(FORM_LABELS.essay, 'Essay');
  assert.strictEqual(FORM_LABELS.paper, 'Paper');

  assert.strictEqual(FORM_GLYPHS.note, '✎');
  assert.strictEqual(FORM_GLYPHS.essay, '✒');
  assert.strictEqual(FORM_GLYPHS.paper, '📄');
});

test('formatDate outputs ISO YYYY-MM-DD', () => {
  assert.strictEqual(formatDate(new Date('2026-03-01T00:00:00Z')), '2026-03-01');
  assert.strictEqual(formatDate('2026-03-15'), '2026-03-15');
  assert.strictEqual(formatDate(undefined), '');
});
