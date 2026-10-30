import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareWordsDirectories,
  compareEntryPair,
  normalizeBody,
} from '../scripts/gates/errata-guard.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures', 'errata-guard');

interface FixtureTableCase {
  rule: string;
  fixtureDir: string;
  expectOk: boolean;
  expectedErrorPattern?: RegExp;
}

const FIXTURE_TABLE: FixtureTableCase[] = [
  // Rule 1: Deleting or renaming a Published/Superseded/Withdrawn Entry file fails
  {
    rule: 'Rule 1 (pass): deleting a Draft entry is allowed',
    fixtureDir: 'r1-delete-draft-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 1 (fail): deleting a Published entry fails',
    fixtureDir: 'r1-delete-published-fail',
    expectOk: false,
    expectedErrorPattern: /Entry 'published-entry' \(Published\) was deleted or renamed/,
  },
  {
    rule: 'Rule 1 (fail): renaming a Published entry fails',
    fixtureDir: 'r1-rename-published-fail',
    expectOk: false,
    expectedErrorPattern: /Entry 'original-slug' \(Published\) was deleted or renamed/,
  },

  // Rule 2: Frozen after publication: slug, form, published_on, stored kind
  {
    rule: 'Rule 2 (pass): frozen fields (slug, form, published_on, kind) unchanged',
    fixtureDir: 'r2-frozen-unchanged-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 2 (fail): mutating frozen fields (slug, form, published_on, kind) fails',
    fixtureDir: 'r2-frozen-fields-fail',
    expectOk: false,
    expectedErrorPattern: /modified frozen (?:stored )?field '(?:slug|form|published_on|kind)'/,
  },

  // Rule 3: Body compared after normalization; non-whitespace change requires newly appended errata[]
  {
    rule: 'Rule 3 (pass): whitespace and line-wrap body changes without errata pass',
    fixtureDir: 'r3-whitespace-only-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 3 (pass): substantive body change with newly appended errata[] item passes',
    fixtureDir: 'r3-body-with-errata-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 3 (fail): substantive body change without newly appended errata[] item fails',
    fixtureDir: 'r3-body-without-errata-fail',
    expectOk: false,
    expectedErrorPattern: /normalized body change without a newly appended errata\[\] item/,
  },

  // Rule 4: title/description may change only with a new errata[] item whose fields names them
  {
    rule: 'Rule 4 (pass): title and description changed with new errata[] item naming them in fields',
    fixtureDir: 'r4-title-desc-with-fields-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 4 (fail): title and description changed without fields naming them fails',
    fixtureDir: 'r4-title-desc-missing-fields-fail',
    expectOk: false,
    expectedErrorPattern: /modified '(?:title|description)' without a newly appended errata\[\] item naming/,
  },

  // Rule 5: Existing errata[] items must be byte-identical (append-only)
  {
    rule: 'Rule 5 (pass): existing errata[0] byte-identical and new errata[1] appended',
    fixtureDir: 'r5-errata-append-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 5 (fail): mutating an existing errata[] item in place fails',
    fixtureDir: 'r5-errata-mutated-fail',
    expectOk: false,
    expectedErrorPattern: /modified existing errata\[0\] item/,
  },

  // Rule 6: Set-once: superseded_by, withdrawn_on, withdrawal_note, expunged_on may be added, never changed or removed
  {
    rule: 'Rule 6 (pass): adding set-once field superseded_by to Published entry passes',
    fixtureDir: 'r6-set-once-added-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 6 (fail): changing or removing set-once field superseded_by fails',
    fixtureDir: 'r6-set-once-mutated-fail',
    expectOk: false,
    expectedErrorPattern: /modified or removed set-once field 'superseded_by'/,
  },

  // Rule 7: Terminal states: body edits on Superseded/Withdrawn fail
  {
    rule: 'Rule 7 (pass): Superseded entry with unchanged body passes',
    fixtureDir: 'r7-terminal-unchanged-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 7 (fail): body edit on Superseded entry fails even with new errata[]',
    fixtureDir: 'r7-terminal-body-edit-fail',
    expectOk: false,
    expectedErrorPattern: /terminal state \(Superseded\); body edits on Superseded\/Withdrawn entries are forbidden/,
  },

  // Rule 8: expunge transition (Published/Withdrawn -> Withdrawn)
  {
    rule: 'Rule 8 (pass): valid expunge transition with canonical stub, newly set expunged_on, replaced withdrawal_note, and redacted erratum note',
    fixtureDir: 'r8-expunge-valid-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 8 (fail): expunge transition with non-canonical body fails',
    fixtureDir: 'r8-expunge-invalid-fail',
    expectOk: false,
    expectedErrorPattern: /expunge transition requires body to equal canonical redaction stub/,
  },

  // Rule 9: Drafts (never published at base) are unrestricted
  {
    rule: 'Rule 9 (pass): Draft at base is unrestricted when revised or published',
    fixtureDir: 'r9-draft-unrestricted-pass',
    expectOk: true,
  },
  {
    rule: 'Rule 9 (fail): Entry published at base (draft: false) is restricted',
    fixtureDir: 'r9-published-not-draft-fail',
    expectOk: false,
    expectedErrorPattern: /modified frozen field 'form'/,
  },
];

for (const tc of FIXTURE_TABLE) {
  test(`errata-guard fixture pair — ${tc.rule}`, () => {
    const caseRoot = path.join(FIXTURES_ROOT, tc.fixtureDir);
    const baseDir = path.join(caseRoot, 'base');
    const headDir = path.join(caseRoot, 'head');

    const result = compareWordsDirectories(baseDir, headDir);
    assert.strictEqual(
      result.ok,
      tc.expectOk,
      `Expected ok=${tc.expectOk} for ${tc.fixtureDir}, got errors: ${result.errors.join(' | ')}`
    );

    if (!tc.expectOk && tc.expectedErrorPattern) {
      const combined = result.errors.join('\n');
      assert.match(combined, tc.expectedErrorPattern);
    }
  });
}

test('errata-guard additional edge cases for set-once, terminal states, and expunge', () => {
  // Deleting Superseded or Withdrawn fails (Rule 1)
  const delSuperseded = compareEntryPair(
    'superseded-item',
    '---\nform: note\nkind: note\ntitle: Sup\npublished_on: 2026-03-01\nsuperseded_by: next\n---\nBody.',
    undefined
  );
  assert.strictEqual(delSuperseded.ok, false);
  assert.match(delSuperseded.errors[0], /\(Superseded\) was deleted or renamed/);

  const delWithdrawn = compareEntryPair(
    'withdrawn-item',
    '---\nform: note\nkind: note\ntitle: Withdrawn\npublished_on: 2026-03-01\nwithdrawn_on: 2026-03-05\nwithdrawal_note: Retracted\n---\nBody.',
    undefined
  );
  assert.strictEqual(delWithdrawn.ok, false);
  assert.match(delWithdrawn.errors[0], /\(Withdrawn\) was deleted or renamed/);

  // Removing existing errata[] item fails (Rule 5)
  const removedErrata = compareEntryPair(
    'errata-del',
    '---\nform: note\nkind: note\ntitle: T\npublished_on: 2026-03-01\nerrata:\n  - on: 2026-03-02\n    class: typo\n    note: Fix.\n---\nBody.',
    '---\nform: note\nkind: note\ntitle: T\npublished_on: 2026-03-01\n---\nBody.'
  );
  assert.strictEqual(removedErrata.ok, false);
  assert.ok(removedErrata.errors.some((e) => e.includes('removed existing errata[] items')));

  // Mutating withdrawn_on, withdrawal_note (outside expunge), or expunged_on fails (Rule 6)
  const mutateWithdrawnFields = compareEntryPair(
    'withdrawn-mutate',
    '---\nform: note\nkind: note\ntitle: T\npublished_on: 2026-03-01\nwithdrawn_on: 2026-03-05\nwithdrawal_note: Original note\nexpunged_on: 2026-03-06\n---\nThis Entry has been expunged.',
    '---\nform: note\nkind: note\ntitle: T\npublished_on: 2026-03-01\nwithdrawn_on: 2026-03-09\nwithdrawal_note: Changed note\nexpunged_on: 2026-03-10\n---\nThis Entry has been expunged.'
  );
  assert.strictEqual(mutateWithdrawnFields.ok, false);
  assert.ok(mutateWithdrawnFields.errors.some((e) => e.includes("set-once field 'withdrawn_on'")));
  assert.ok(mutateWithdrawnFields.errors.some((e) => e.includes("set-once field 'withdrawal_note'")));
  assert.ok(mutateWithdrawnFields.errors.some((e) => e.includes("set-once field 'expunged_on'")));

  // Body edit on Withdrawn entry (non-expunge) fails (Rule 7)
  const withdrawnBodyEdit = compareEntryPair(
    'withdrawn-body-edit',
    '---\nform: note\nkind: note\ntitle: T\npublished_on: 2026-03-01\nwithdrawn_on: 2026-03-05\nwithdrawal_note: Retracted\n---\nOriginal body.',
    '---\nform: note\nkind: note\ntitle: T\npublished_on: 2026-03-01\nwithdrawn_on: 2026-03-05\nwithdrawal_note: Retracted\n---\nEdited body.'
  );
  assert.strictEqual(withdrawnBodyEdit.ok, false);
  assert.ok(
    withdrawnBodyEdit.errors.some((e) =>
      e.includes('terminal state (Withdrawn); body edits on Superseded/Withdrawn entries are forbidden')
    )
  );

  // Published -> Withdrawn direct expunge transition passes (Rule 8)
  const directPublishedExpunge = compareEntryPair(
    'direct-expunge',
    '---\nform: note\nkind: note\ntitle: T\npublished_on: 2026-03-01\n---\nSensitive published text.',
    '---\nform: note\nkind: note\ntitle: T\npublished_on: 2026-03-01\nwithdrawn_on: 2026-03-10\nexpunged_on: 2026-03-10\nwithdrawal_note: Expunged per policy.\n---\nThis Entry has been expunged.'
  );
  assert.strictEqual(directPublishedExpunge.ok, true);

  // normalizeBody collapses line-wraps and whitespace
  assert.strictEqual(
    normalizeBody('Hello   world\nfrom   Astro\n'),
    normalizeBody('Hello world from Astro')
  );
});
