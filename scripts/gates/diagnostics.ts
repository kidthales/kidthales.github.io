import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AllowlistEntry {
  pattern: string;
  issue: string;
  reason?: string;
}

export interface DiagnosticsResult {
  ok: boolean;
  errors: string[];
  matchedAllowlistIndices: number[];
}

const ANSI_REGEX = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const ISSUE_CITATION_REGEX = /#\d+\b/;
const CONTRAST_REPORT_LEAK_REGEX = /\[REPORT\]|\bcolor-contrast-enhanced\b|\bAAA body text report\b/i;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '');
}

/**
 * Validates one or more `astro build` logs (e.g. production + fixture builds)
 * against the diagnostics allowlist:
 * 1. Every allowlist entry must have a non-empty `pattern` and an `issue` citing `#N`.
 * 2. Contrast/AAA reports must never print into the `astro build` log.
 * 3. Any `[ERROR]` line fails unconditionally.
 * 4. Any `[WARN]` line fails unless matched by at least one allowlist entry.
 * 5. Any allowlist entry that matches 0 `[WARN]` lines across the evaluated logs fails as stale.
 */
export function validateDiagnosticsLogs(
  logs: string[],
  allowlist: AllowlistEntry[]
): DiagnosticsResult {
  const errors: string[] = [];
  const compiledAllowlist: Array<{ index: number; entry: AllowlistEntry; regex: RegExp }> = [];
  const matchedIndices = new Set<number>();

  for (let i = 0; i < allowlist.length; i++) {
    const entry = allowlist[i];
    if (!entry || typeof entry.pattern !== 'string' || entry.pattern.trim() === '') {
      errors.push(`Allowlist entry at index ${i} has an empty or invalid pattern.`);
      continue;
    }
    if (typeof entry.issue !== 'string' || !ISSUE_CITATION_REGEX.test(entry.issue)) {
      errors.push(
        `Allowlist entry at index ${i} (pattern: "${entry.pattern}") must cite a tracker issue '#N' (got: "${entry.issue ?? ''}").`
      );
      continue;
    }
    try {
      compiledAllowlist.push({
        index: i,
        entry,
        regex: new RegExp(entry.pattern),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Allowlist entry at index ${i} has invalid regex "${entry.pattern}": ${msg}`);
    }
  }

  for (const rawLog of logs) {
    const cleanLog = stripAnsi(rawLog).replace(/\r\n/g, '\n');
    const lines = cleanLog.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (CONTRAST_REPORT_LEAK_REGEX.test(trimmed)) {
        errors.push(`Forbidden Contrast/AAA report output in astro build log: ${trimmed}`);
      }

      if (trimmed.includes('[ERROR]')) {
        errors.push(`Diagnostics [ERROR] in astro build log: ${trimmed}`);
      }

      if (trimmed.includes('[WARN]')) {
        let matched = false;
        for (const item of compiledAllowlist) {
          if (item.regex.test(trimmed)) {
            matched = true;
            matchedIndices.add(item.index);
          }
        }
        if (!matched) {
          errors.push(`Unallowlisted [WARN] in astro build log: ${trimmed}`);
        }
      }
    }
  }

  for (const item of compiledAllowlist) {
    if (!matchedIndices.has(item.index)) {
      errors.push(
        `Stale diagnostics allowlist entry at index ${item.index} (${item.entry.issue}): pattern "${item.entry.pattern}" matched no [WARN] lines.`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    matchedAllowlistIndices: Array.from(matchedIndices).sort((a, b) => a - b),
  };
}

function parseCliArgs(argv: string[]): { logFiles: string[]; allowlistFile: string } {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  let allowlistFile = path.join(scriptDir, 'diagnostics-allowlist.json');
  const logFiles: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--log' || arg === '-Log') && i + 1 < argv.length) {
      logFiles.push(path.resolve(argv[++i]));
    } else if ((arg === '--allowlist' || arg === '-Allowlist') && i + 1 < argv.length) {
      allowlistFile = path.resolve(argv[++i]);
    }
  }

  return { logFiles, allowlistFile };
}

export function runDiagnosticsCli(argv: string[] = process.argv.slice(2)): number {
  const { logFiles, allowlistFile } = parseCliArgs(argv);

  if (logFiles.length === 0) {
    console.error('Diagnostics Gate Error: At least one --log <file> argument is required.');
    return 1;
  }

  if (!fs.existsSync(allowlistFile)) {
    console.error(`Diagnostics Gate Error: Allowlist file not found at ${allowlistFile}`);
    return 1;
  }

  let allowlist: AllowlistEntry[];
  try {
    const rawAllowlist = fs.readFileSync(allowlistFile, 'utf8');
    const parsed: unknown = JSON.parse(rawAllowlist);
    if (!Array.isArray(parsed)) {
      console.error('Diagnostics Gate Error: Allowlist JSON must be an array.');
      return 1;
    }
    allowlist = parsed as AllowlistEntry[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Diagnostics Gate Error: Failed to read allowlist file: ${msg}`);
    return 1;
  }

  const logs: string[] = [];
  for (const logPath of logFiles) {
    if (!fs.existsSync(logPath)) {
      console.error(`Diagnostics Gate Error: Build log file not found at ${logPath}`);
      return 1;
    }
    logs.push(fs.readFileSync(logPath, 'utf8'));
  }

  const result = validateDiagnosticsLogs(logs, allowlist);
  if (!result.ok) {
    console.error('Diagnostics Gate FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    return 1;
  }

  console.log(
    `Diagnostics Gate PASSED (${logs.length} build log(s) verified, ${result.matchedAllowlistIndices.length}/${allowlist.length} allowlist entries active).`
  );
  return 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exitCode = runDiagnosticsCli();
}
