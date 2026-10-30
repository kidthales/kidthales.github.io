import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripAnsi,
  validateDiagnosticsLogs,
  type AllowlistEntry,
} from '../scripts/gates/diagnostics.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('stripAnsi removes ANSI color escape sequences', () => {
  const colored = '\u001b[33m10:52:01 [WARN] [glob-loader] warning text\u001b[0m';
  assert.strictEqual(stripAnsi(colored), '10:52:01 [WARN] [glob-loader] warning text');
});

test('diagnostics allowlist file exists and cites #N on every entry', () => {
  const allowlistPath = path.resolve(
    __dirname,
    '..',
    'scripts',
    'gates',
    'diagnostics-allowlist.json'
  );
  const raw = fs.readFileSync(allowlistPath, 'utf8');
  const entries = JSON.parse(raw) as AllowlistEntry[];
  assert.ok(Array.isArray(entries) && entries.length > 0);
  for (const entry of entries) {
    assert.ok(entry.pattern.length > 0);
    assert.match(entry.issue, /^#\d+$/);
  }
});

test('validateDiagnosticsLogs passes clean logs when allowlist is matched across prod and fixture builds', () => {
  const allowlist: AllowlistEntry[] = [
    {
      pattern:
        '\\[WARN\\] \\[glob-loader\\] No files found matching "\\*\\*/\\*\\.md" in directory "src[/\\\\]content[/\\\\]words"',
      issue: '#441',
    },
  ];

  const prodLog = [
    '10:52:01 [content] Syncing content',
    '10:52:01 [WARN] [glob-loader] No files found matching "**/*.md" in directory "src\\content\\words"',
    '10:52:01 [build] Complete!',
  ].join('\n');

  const fixtureLog = [
    '10:52:10 [content] Syncing content',
    '10:52:10 [build] 15 page(s) built in 875ms',
    '10:52:10 [build] Complete!',
  ].join('\n');

  const result = validateDiagnosticsLogs([prodLog, fixtureLog], allowlist);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.matchedAllowlistIndices, [0]);
});

test('validateDiagnosticsLogs fails on any [ERROR] line', () => {
  const log = [
    '10:52:01 [content] Syncing content',
    '10:52:01 [ERROR] [vite] Build failed with 1 error',
  ].join('\n');

  const result = validateDiagnosticsLogs([log], []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Diagnostics [ERROR] in astro build log')));
});

test('validateDiagnosticsLogs fails on unallowlisted [WARN] line', () => {
  const log = [
    '10:52:01 [content] Syncing content',
    '10:52:01 [WARN] [astro] Unexpected deprecation warning',
  ].join('\n');

  const result = validateDiagnosticsLogs([log], []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Unallowlisted [WARN] in astro build log')));
});

test('validateDiagnosticsLogs fails when an allowlist entry does not cite #N', () => {
  const allowlist: AllowlistEntry[] = [
    {
      pattern: '\\[WARN\\] expected warning',
      issue: 'no-issue-number',
    },
  ];
  const log = '10:52:01 [WARN] expected warning';

  const result = validateDiagnosticsLogs([log], allowlist);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("must cite a tracker issue '#N'")));
});

test('validateDiagnosticsLogs fails when an allowlist entry matches nothing (stale)', () => {
  const allowlist: AllowlistEntry[] = [
    {
      pattern: '\\[WARN\\] obsolete warning that no longer fires',
      issue: '#441',
    },
  ];
  const log = '10:52:01 [build] Complete!';

  const result = validateDiagnosticsLogs([log], allowlist);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Stale diagnostics allowlist entry')));
});

test('validateDiagnosticsLogs fails if Contrast/AAA reports print into the astro build log', () => {
  const log = [
    '10:52:01 [build] Complete!',
    '10:52:02 [REPORT] AAA body text report (color-contrast-enhanced): 15/15 passed',
  ].join('\n');

  const result = validateDiagnosticsLogs([log], []);
  assert.strictEqual(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('Forbidden Contrast/AAA report output in astro build log'))
  );
});
