import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { createWordsSchema } from '../src/lib/schema.ts';
import { createWorksSchema } from '../src/lib/works-schema.ts';
import { validateSupersededBy, type ValidationEntry } from '../src/lib/entries.ts';
import { validateSlug } from '../src/reserved-slugs.ts';

function extractFrontmatter(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) {
    throw new Error(`No frontmatter found in ${filePath}`);
  }
  return YAML.parse(match[1]) as Record<string, unknown>;
}

const invalidFixturesDir = path.join(process.cwd(), 'tests', 'fixtures', 'invalid');

test('negative fixtures: N1 (essay-missing-description) fails schema validation', () => {
  const data = extractFrontmatter(
    path.join(invalidFixturesDir, 'n1-essay-missing-description', 'essay-no-desc.md')
  );
  const wordsSchema = createWordsSchema();
  assert.throws(
    () => wordsSchema.parse(data),
    (err: unknown) => {
      const msg = String(err);
      return /description/i.test(msg);
    }
  );
});

test('negative fixtures: N2 (dangling-superseded-by) fails supersede validation', () => {
  const data = extractFrontmatter(
    path.join(invalidFixturesDir, 'n2-dangling-superseded-by', 'dangling-ref.md')
  );
  const entry: ValidationEntry = {
    id: 'dangling-ref',
    data: data as ValidationEntry['data'],
  };
  assert.throws(
    () => validateSupersededBy([entry]),
    /Dangling reference.*non-existent-target/
  );
});

test('negative fixtures: N3 (wrong-kind) fails schema kind validation', () => {
  const data = extractFrontmatter(
    path.join(invalidFixturesDir, 'n3-wrong-kind', 'wrong-kind.md')
  );
  const wordsSchema = createWordsSchema();
  assert.throws(
    () => wordsSchema.parse(data),
    (err: unknown) => {
      const msg = String(err);
      return /kind/i.test(msg) || /Invalid (option|enum value)/i.test(msg);
    }
  );
});

test('negative fixtures: N4 (published-without-published-on) fails refinement', () => {
  const data = extractFrontmatter(
    path.join(invalidFixturesDir, 'n4-published-without-published-on', 'missing-published-on.md')
  );
  const wordsSchema = createWordsSchema();
  assert.throws(
    () => wordsSchema.parse(data),
    /Published entries require published_on/
  );
});

test('negative fixtures: N5 (reserved-slug) fails slug validation', () => {
  assert.throws(
    () => validateSlug('notes', 'notes'),
    /Reserved slug error/
  );
});

test('negative fixtures: N6 (unknown-form) fails form discriminator', () => {
  const data = extractFrontmatter(
    path.join(invalidFixturesDir, 'n6-unknown-form', 'unknown-form.md')
  );
  const wordsSchema = createWordsSchema();
  assert.throws(
    () => wordsSchema.parse(data),
    /Did not match union|Invalid discriminator/i
  );
});

test('negative fixtures: N7 (superseded-by-draft) fails supersede validation', () => {
  const entryData = extractFrontmatter(
    path.join(invalidFixturesDir, 'n7-superseded-by-draft', 'entry.md')
  );
  const targetData = extractFrontmatter(
    path.join(invalidFixturesDir, 'n7-superseded-by-draft', 'target-draft.md')
  );
  const entry: ValidationEntry = {
    id: 'entry',
    data: entryData as ValidationEntry['data'],
  };
  const targetDraft: ValidationEntry = {
    id: 'target-draft',
    data: targetData as ValidationEntry['data'],
  };
  assert.throws(
    () => validateSupersededBy([entry, targetDraft]),
    /target is a draft/
  );
});

test('negative fixtures: N8 (supersede-cycle) detects cycle in validation', () => {
  const dataA = extractFrontmatter(
    path.join(invalidFixturesDir, 'n8-supersede-cycle', 'cycle-a.md')
  );
  const dataB = extractFrontmatter(
    path.join(invalidFixturesDir, 'n8-supersede-cycle', 'cycle-b.md')
  );
  const entryA: ValidationEntry = {
    id: 'cycle-a',
    data: dataA as ValidationEntry['data'],
  };
  const entryB: ValidationEntry = {
    id: 'cycle-b',
    data: dataB as ValidationEntry['data'],
  };
  assert.throws(
    () => validateSupersededBy([entryA, entryB]),
    /Supersede cycle detected/
  );
});

test('negative fixtures: N9 (bad-slug-grammar) fails regex grammar validation', () => {
  assert.throws(
    () => validateSlug('Bad_Slug!', 'Bad_Slug!'),
    /Invalid slug grammar error/
  );
});

test('negative fixtures: N10 (retired-without-note) fails work schema refinement', () => {
  const data = extractFrontmatter(
    path.join(invalidFixturesDir, 'n10-retired-without-note', 'invalid-retired.md')
  );
  const worksSchema = createWorksSchema();
  assert.throws(
    () => worksSchema.parse(data),
    /Retired works require retirement_note/
  );
});
