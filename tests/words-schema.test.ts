import test from 'node:test';
import assert from 'node:assert';
import {
  createWordsSchema,
  createKindSchema,
  KIND_LEGACY_ALIASES,
  NOTE_KINDS,
  CANONICAL_REDACTION_STUB,
} from '../src/lib/schema.ts';
import { validateSupersededBy, isSuperseded, isCorrected } from '../src/lib/entries.ts';

test('KIND_LEGACY_ALIASES is empty in MVP', () => {
  assert.deepStrictEqual(Object.keys(KIND_LEGACY_ALIASES), []);
});

test('kind legacy alias map resolves legacy value to current value via z.preprocess', () => {
  const customAliasMap: Record<string, string> = {
    legacy_thought: 'observation',
    field_log: 'field_note',
  };

  const schema = createKindSchema(NOTE_KINDS, customAliasMap);

  // Unaliased valid value
  assert.strictEqual(schema.parse('note'), 'note');
  assert.strictEqual(schema.parse('observation'), 'observation');

  // Legacy values resolve to mapped values
  assert.strictEqual(schema.parse('legacy_thought'), 'observation');
  assert.strictEqual(schema.parse('field_log'), 'field_note');

  // Unknown value not in map throws
  assert.throws(() => schema.parse('completely_unknown'), {
    name: 'ZodError',
  });
});

test('wordsSchema validates valid Note, Essay, and Paper forms', () => {
  const schema = createWordsSchema();

  // Valid Note
  const validNote = schema.parse({
    form: 'note',
    kind: 'observation',
    title: 'An Observation',
    published_on: '2026-03-01',
  });
  assert.strictEqual(validNote.form, 'note');
  assert.strictEqual(validNote.title, 'An Observation');

  // Valid Essay (requires description)
  const validEssay = schema.parse({
    form: 'essay',
    kind: 'critique',
    title: 'A Critique',
    description: 'Essay description',
    published_on: '2026-03-05',
  });
  assert.strictEqual(validEssay.form, 'essay');
  assert.strictEqual(validEssay.description, 'Essay description');

  // Valid Paper (requires description)
  const validPaper = schema.parse({
    form: 'paper',
    kind: 'specification',
    title: 'A Specification',
    description: 'Paper description',
    published_on: '2026-03-10',
  });
  assert.strictEqual(validPaper.form, 'paper');
  assert.strictEqual(validPaper.description, 'Paper description');
});

test('wordsSchema enforces Form-specific kind enums (N3)', () => {
  const schema = createWordsSchema();

  // Note cannot use essay kind 'critique'
  assert.throws(
    () =>
      schema.parse({
        form: 'note',
        kind: 'critique',
        title: 'Invalid Note',
        published_on: '2026-03-01',
      }),
    (err: any) => err.name === 'ZodError'
  );
});

test('wordsSchema requires description for essay and paper (N1)', () => {
  const schema = createWordsSchema();

  // Essay missing description throws
  assert.throws(
    () =>
      schema.parse({
        form: 'essay',
        kind: 'analysis',
        title: 'Essay Missing Description',
        published_on: '2026-03-01',
      }),
    (err: any) => err.name === 'ZodError'
  );

  // Paper missing description throws
  assert.throws(
    () =>
      schema.parse({
        form: 'paper',
        kind: 'report',
        title: 'Paper Missing Description',
        published_on: '2026-03-01',
      }),
    (err: any) => err.name === 'ZodError'
  );
});

test('wordsSchema rejects unknown forms (N6)', () => {
  const schema = createWordsSchema();

  assert.throws(
    () =>
      schema.parse({
        form: 'book',
        kind: 'observation',
        title: 'Unknown Form',
        published_on: '2026-03-01',
      }),
    (err: any) => err.name === 'ZodError'
  );
});

test('wordsSchema enforces published entries have published_on (N4)', () => {
  const schema = createWordsSchema();

  // Published (draft absent) without published_on
  assert.throws(
    () =>
      schema.parse({
        form: 'note',
        kind: 'observation',
        title: 'Note Without Published Date',
      }),
    (err: any) => err.name === 'ZodError' && err.message.includes('Published entries require published_on')
  );

  // Draft does not require published_on
  const draft = schema.parse({
    form: 'note',
    kind: 'observation',
    title: 'Draft Note',
    draft: true,
  });
  assert.strictEqual(draft.draft, true);
  assert.strictEqual(draft.published_on, undefined);
});

test('wordsSchema enforces withdrawn_on <=> withdrawal_note and expunged_on', () => {
  const schema = createWordsSchema();

  // withdrawn_on without withdrawal_note
  assert.throws(
    () =>
      schema.parse({
        form: 'note',
        kind: 'observation',
        title: 'Missing Note',
        published_on: '2026-03-01',
        withdrawn_on: '2026-03-10',
      }),
    (err: any) => err.name === 'ZodError' && err.message.includes('Withdrawn entries require withdrawal_note')
  );

  // withdrawal_note without withdrawn_on
  assert.throws(
    () =>
      schema.parse({
        form: 'note',
        kind: 'observation',
        title: 'Missing Date',
        published_on: '2026-03-01',
        withdrawal_note: 'Retracted',
      }),
    (err: any) => err.name === 'ZodError' && err.message.includes('withdrawal_note requires withdrawn_on')
  );

  // expunged_on requires withdrawal_note and withdrawn_on
  assert.throws(
    () =>
      schema.parse({
        form: 'note',
        kind: 'observation',
        title: 'Incomplete Expunge',
        published_on: '2026-03-01',
        expunged_on: '2026-03-15',
      }),
    (err: any) => err.name === 'ZodError'
  );

  // Valid expunged metadata
  const expunged = schema.parse({
    form: 'note',
    kind: 'observation',
    title: 'Valid Expunged Entry',
    published_on: '2026-03-01',
    withdrawn_on: '2026-03-10',
    expunged_on: '2026-03-15',
    withdrawal_note: 'Expunged',
  });
  assert.ok(expunged.expunged_on);
});

test('wordsSchema parses typed errata array', () => {
  const schema = createWordsSchema();

  const entry = schema.parse({
    form: 'note',
    kind: 'reference',
    title: 'Note with errata',
    published_on: '2026-03-01',
    errata: [
      { on: '2026-03-05', class: 'typo', note: 'Typo fixed' },
      { on: '2026-03-08', class: 'correction', fields: ['title'], note: 'Title corrected' },
      { on: '2026-03-10', class: 'clarification', note: 'Clarified terms' },
    ],
  });

  assert.strictEqual(entry.errata.length, 3);
  assert.strictEqual(entry.errata[0].class, 'typo');
  assert.strictEqual(entry.errata[1].class, 'correction');
  assert.strictEqual(entry.errata[2].class, 'clarification');
});

test('validateSupersededBy detects dangling reference (N2)', () => {
  const entries = [
    {
      id: 'entry-a',
      data: {
        title: 'Entry A',
        published_on: new Date('2026-03-01'),
        superseded_by: 'entry-non-existent',
      },
    },
  ];

  assert.throws(() => validateSupersededBy(entries), {
    message: /Dangling reference: Entry 'entry-a' has superseded_by 'entry-non-existent'/,
  });
});

test('validateSupersededBy detects draft supersede target (N7)', () => {
  const entries = [
    {
      id: 'entry-a',
      data: {
        title: 'Entry A',
        published_on: new Date('2026-03-01'),
        superseded_by: 'entry-draft',
      },
    },
    {
      id: 'entry-draft',
      data: {
        title: 'Draft Entry',
        draft: true,
      },
    },
  ];

  assert.throws(() => validateSupersededBy(entries), {
    message: /Invalid supersede target: Entry 'entry-a' has superseded_by 'entry-draft', but target is a draft/,
  });
});

test('validateSupersededBy detects withdrawn supersede target', () => {
  const entries = [
    {
      id: 'entry-a',
      data: {
        title: 'Entry A',
        published_on: new Date('2026-03-01'),
        superseded_by: 'entry-withdrawn',
      },
    },
    {
      id: 'entry-withdrawn',
      data: {
        title: 'Withdrawn Entry',
        published_on: new Date('2026-02-01'),
        withdrawn_on: new Date('2026-02-15'),
        withdrawal_note: 'Retracted',
      },
    },
  ];

  assert.throws(() => validateSupersededBy(entries), {
    message: /Invalid supersede target: Entry 'entry-a' has superseded_by 'entry-withdrawn', but target is withdrawn/,
  });
});

test('validateSupersededBy detects supersede cycles (N8)', () => {
  const entries = [
    {
      id: 'entry-a',
      data: {
        title: 'Entry A',
        published_on: new Date('2026-03-01'),
        superseded_by: 'entry-b',
      },
    },
    {
      id: 'entry-b',
      data: {
        title: 'Entry B',
        published_on: new Date('2026-03-02'),
        superseded_by: 'entry-a',
      },
    },
  ];

  assert.throws(() => validateSupersededBy(entries), {
    message: /Supersede cycle detected: entry-a -> entry-b -> entry-a/,
  });
});

test('isSuperseded and isCorrected helper functions', () => {
  const normalEntry = {
    id: 'normal',
    data: {
      title: 'Normal',
      published_on: new Date('2026-03-01'),
    },
  };
  const supersededEntry = {
    id: 'superseded',
    data: {
      title: 'Superseded',
      published_on: new Date('2026-03-01'),
      superseded_by: 'target',
    },
  };
  const correctedEntry = {
    id: 'corrected',
    data: {
      title: 'Corrected',
      published_on: new Date('2026-03-01'),
      errata: [{ on: new Date('2026-03-05'), class: 'correction' as const, note: 'Fix' }],
    },
  };

  assert.strictEqual(isSuperseded(normalEntry), false);
  assert.strictEqual(isSuperseded(supersededEntry), true);

  assert.strictEqual(isCorrected(normalEntry), false);
  assert.strictEqual(isCorrected(correctedEntry), true);
});

test('CANONICAL_REDACTION_STUB constant', () => {
  assert.strictEqual(CANONICAL_REDACTION_STUB, 'This Entry has been expunged.');
});
