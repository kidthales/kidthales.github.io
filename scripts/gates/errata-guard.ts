import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSeq, parseDocument } from 'yaml';
import { CANONICAL_REDACTION_STUB } from '../../src/lib/schema.ts';

export interface ParsedErratumItem {
  raw: string;
  on: string;
  class: string;
  fields?: string[];
  note: string;
}

export interface ParsedEntryData {
  slug?: string;
  form?: string;
  kind?: string;
  title?: string;
  description?: string;
  draft?: boolean;
  published_on?: string;
  superseded_by?: string;
  withdrawn_on?: string;
  withdrawal_note?: string;
  expunged_on?: string;
}

export interface ParsedEntry {
  slug: string;
  data: ParsedEntryData;
  errata: ParsedErratumItem[];
  body: string;
}

export interface EntryGuardResult {
  slug: string;
  ok: boolean;
  errors: string[];
}

export interface ErrataGuardResult {
  ok: boolean;
  errors: string[];
  checkedCount: number;
}

const VALID_ERRATUM_CLASSES = new Set(['typo', 'correction', 'clarification']);
const MAX_DIR_DEPTH = 5;

/**
 * Normalizes Entry markdown body by collapsing whitespace runs and line-wraps.
 */
export function normalizeBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

export function normalizeDateValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function deepEqualStringArray(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined && b === undefined) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Parses a Markdown Entry file into frontmatter data, raw-sliced errata items, and body.
 */
export function parseEntryMarkdown(rawContent: string, slug: string): ParsedEntry {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(normalized);
  if (!match) {
    throw new Error(`Entry '${slug}' is missing valid YAML frontmatter delimiters (---).`);
  }

  const yamlBlock = match[1];
  const rawAfterFrontmatter = match[2] ?? '';
  // Strip at most a single trailing newline at EOF while preserving internal or extra trailing blank lines
  const body = rawAfterFrontmatter.endsWith('\n')
    ? rawAfterFrontmatter.slice(0, -1)
    : rawAfterFrontmatter;

  const doc = parseDocument(yamlBlock);
  if (doc.errors.length > 0) {
    throw new Error(`Entry '${slug}' has YAML syntax error: ${doc.errors[0].message}`);
  }

  const parsedJs: unknown = doc.toJS();
  if (!parsedJs || typeof parsedJs !== 'object' || Array.isArray(parsedJs)) {
    throw new Error(`Entry '${slug}' frontmatter must be a YAML mapping.`);
  }

  const record = parsedJs as Record<string, unknown>;
  const data: ParsedEntryData = {
    slug: record.slug !== undefined ? String(record.slug) : undefined,
    form: record.form !== undefined ? String(record.form) : undefined,
    kind: record.kind !== undefined ? String(record.kind) : undefined,
    title: record.title !== undefined ? String(record.title) : undefined,
    description: record.description !== undefined ? String(record.description) : undefined,
    draft: record.draft === true,
    published_on: normalizeDateValue(record.published_on),
    superseded_by:
      record.superseded_by !== undefined && record.superseded_by !== null
        ? String(record.superseded_by)
        : undefined,
    withdrawn_on: normalizeDateValue(record.withdrawn_on),
    withdrawal_note:
      record.withdrawal_note !== undefined && record.withdrawal_note !== null
        ? String(record.withdrawal_note)
        : undefined,
    expunged_on: normalizeDateValue(record.expunged_on),
  };

  const errata: ParsedErratumItem[] = [];
  const errataNode = doc.get('errata', true);
  const rawErrataArray = Array.isArray(record.errata) ? record.errata : [];

  if (errataNode && isSeq(errataNode)) {
    for (let i = 0; i < errataNode.items.length; i++) {
      const itemNode = errataNode.items[i] as { range?: [number, number, number] } | null;
      const itemJs = (rawErrataArray[i] ?? {}) as Record<string, unknown>;
      const range = itemNode?.range;
      const rawSlice = range
        ? yamlBlock.slice(range[0], range[1]).replace(/\n$/, '')
        : JSON.stringify(itemJs);

      const fields = Array.isArray(itemJs.fields)
        ? itemJs.fields.map((f) => String(f))
        : undefined;

      errata.push({
        raw: rawSlice,
        on: normalizeDateValue(itemJs.on) ?? '',
        class: itemJs.class !== undefined ? String(itemJs.class) : '',
        fields,
        note: itemJs.note !== undefined ? String(itemJs.note) : '',
      });
    }
  }

  return {
    slug,
    data,
    errata,
    body,
  };
}

function getLifecycleStateLabel(data: ParsedEntryData): string {
  if (data.draft === true) {
    return 'Draft';
  }
  if (data.withdrawn_on || data.withdrawal_note || data.expunged_on) {
    return 'Withdrawn';
  }
  if (data.superseded_by) {
    return 'Superseded';
  }
  return 'Published';
}

/**
 * Compares a single Entry between base and head, enforcing all 9 errata-guard lifecycle rules.
 */
export function compareEntryPair(
  slug: string,
  baseRaw: string | undefined,
  headRaw: string | undefined
): EntryGuardResult {
  const errors: string[] = [];

  // New Entry created at head (never existed at base) -> unrestricted by errata-guard
  if (baseRaw === undefined) {
    return { slug, ok: true, errors };
  }

  let baseEntry: ParsedEntry;
  try {
    baseEntry = parseEntryMarkdown(baseRaw, slug);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { slug, ok: false, errors: [`Base parse error for '${slug}': ${msg}`] };
  }

  // Rule 9: Drafts (never published at base) are unrestricted
  if (baseEntry.data.draft === true) {
    return { slug, ok: true, errors };
  }

  const baseStateLabel = getLifecycleStateLabel(baseEntry.data);

  // Rule 1: Deleting or renaming a Published/Superseded/Withdrawn Entry file fails
  if (headRaw === undefined) {
    errors.push(
      `Entry '${slug}' (${baseStateLabel}) was deleted or renamed. Deleting or renaming a Published/Superseded/Withdrawn Entry file is forbidden.`
    );
    return { slug, ok: false, errors };
  }

  let headEntry: ParsedEntry;
  try {
    headEntry = parseEntryMarkdown(headRaw, slug);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { slug, ok: false, errors: [`Head parse error for '${slug}': ${msg}`] };
  }

  // Rule 2: Frozen after publication: slug, form, published_on, stored kind (and cannot revert to draft)
  if (headEntry.data.draft === true) {
    errors.push(`Entry '${slug}' cannot revert to draft: true after publication.`);
  }
  if (headEntry.data.slug !== baseEntry.data.slug) {
    errors.push(
      `Entry '${slug}' modified frozen field 'slug' ('${baseEntry.data.slug ?? slug}' -> '${headEntry.data.slug ?? slug}').`
    );
  }
  if (headEntry.data.form !== baseEntry.data.form) {
    errors.push(
      `Entry '${slug}' modified frozen field 'form' ('${baseEntry.data.form ?? ''}' -> '${headEntry.data.form ?? ''}').`
    );
  }
  if (headEntry.data.published_on !== baseEntry.data.published_on) {
    errors.push(
      `Entry '${slug}' modified frozen field 'published_on' ('${baseEntry.data.published_on ?? ''}' -> '${headEntry.data.published_on ?? ''}').`
    );
  }
  if (headEntry.data.kind !== baseEntry.data.kind) {
    errors.push(
      `Entry '${slug}' modified frozen stored field 'kind' ('${baseEntry.data.kind ?? ''}' -> '${headEntry.data.kind ?? ''}'). Kind renames are only permitted via KIND_LEGACY_ALIASES.`
    );
  }

  const baseIsSuperseded = Boolean(baseEntry.data.superseded_by);
  const baseIsWithdrawn = Boolean(
    baseEntry.data.withdrawn_on || baseEntry.data.withdrawal_note || baseEntry.data.expunged_on
  );
  const baseIsExpunged = Boolean(baseEntry.data.expunged_on);

  const headIsSuperseded = Boolean(headEntry.data.superseded_by);
  const headIsWithdrawn = Boolean(
    headEntry.data.withdrawn_on || headEntry.data.withdrawal_note || headEntry.data.expunged_on
  );
  const headIsExpunged = Boolean(headEntry.data.expunged_on);

  const isExpungeTransition = !baseIsExpunged && headIsExpunged;

  // Rule 6: Set-once lifecycle fields: superseded_by, withdrawn_on, withdrawal_note, expunged_on
  if (baseEntry.data.superseded_by !== undefined) {
    if (
      headEntry.data.superseded_by === undefined ||
      headEntry.data.superseded_by !== baseEntry.data.superseded_by
    ) {
      errors.push(
        `Entry '${slug}' modified or removed set-once field 'superseded_by' ('${baseEntry.data.superseded_by}' -> '${headEntry.data.superseded_by ?? ''}').`
      );
    }
  }

  if (baseEntry.data.withdrawn_on !== undefined) {
    if (
      headEntry.data.withdrawn_on === undefined ||
      headEntry.data.withdrawn_on !== baseEntry.data.withdrawn_on
    ) {
      errors.push(
        `Entry '${slug}' modified or removed set-once field 'withdrawn_on' ('${baseEntry.data.withdrawn_on}' -> '${headEntry.data.withdrawn_on ?? ''}').`
      );
    }
  }

  if (baseEntry.data.expunged_on !== undefined) {
    if (
      headEntry.data.expunged_on === undefined ||
      headEntry.data.expunged_on !== baseEntry.data.expunged_on
    ) {
      errors.push(
        `Entry '${slug}' modified or removed set-once field 'expunged_on' ('${baseEntry.data.expunged_on}' -> '${headEntry.data.expunged_on ?? ''}').`
      );
    }
  }

  if (baseEntry.data.withdrawal_note !== undefined) {
    if (
      headEntry.data.withdrawal_note === undefined ||
      headEntry.data.withdrawal_note.trim() === ''
    ) {
      errors.push(`Entry '${slug}' removed set-once field 'withdrawal_note'.`);
    } else if (
      !isExpungeTransition &&
      headEntry.data.withdrawal_note !== baseEntry.data.withdrawal_note
    ) {
      errors.push(
        `Entry '${slug}' modified set-once field 'withdrawal_note' outside an expunge transition.`
      );
    }
  }

  // Enforce mutually exclusive terminal transitions (Superseded vs Withdrawn)
  if (baseIsSuperseded && (headIsWithdrawn || headIsExpunged)) {
    errors.push(
      `Entry '${slug}' is in terminal state Superseded and cannot transition to Withdrawn or Expunged.`
    );
  }
  if (baseIsWithdrawn && headIsSuperseded) {
    errors.push(
      `Entry '${slug}' is in terminal state Withdrawn and cannot transition to Superseded.`
    );
  }

  // Rule 8: expunge transition (Published/Withdrawn -> Withdrawn)
  if (isExpungeTransition) {
    if (!headEntry.data.withdrawn_on) {
      errors.push(`Entry '${slug}' expunge transition requires 'withdrawn_on' to be present.`);
    }
    if (!headEntry.data.withdrawal_note || headEntry.data.withdrawal_note.trim() === '') {
      errors.push(`Entry '${slug}' expunge transition requires 'withdrawal_note' to be present.`);
    }
    if (headEntry.body !== CANONICAL_REDACTION_STUB) {
      errors.push(
        `Entry '${slug}' expunge transition requires body to equal canonical redaction stub ("${CANONICAL_REDACTION_STUB}") byte-for-byte.`
      );
    }
  } else if (
    !baseIsExpunged &&
    headEntry.body === CANONICAL_REDACTION_STUB &&
    baseEntry.body !== CANONICAL_REDACTION_STUB
  ) {
    errors.push(
      `Entry '${slug}' replaced body with canonical redaction stub without newly setting 'expunged_on'.`
    );
  }

  // Rule 5: Existing errata[] items must be byte-identical (append-only)
  const baseErrata = baseEntry.errata;
  const headErrata = headEntry.errata;

  if (headErrata.length < baseErrata.length) {
    errors.push(
      `Entry '${slug}' removed existing errata[] items (base had ${baseErrata.length}, head has ${headErrata.length}). errata[] is append-only.`
    );
  } else {
    for (let i = 0; i < baseErrata.length; i++) {
      const bItem = baseErrata[i];
      const hItem = headErrata[i];

      if (bItem.raw !== hItem.raw) {
        const isAllowedExpungeRedaction =
          isExpungeTransition &&
          bItem.on === hItem.on &&
          bItem.class === hItem.class &&
          deepEqualStringArray(bItem.fields, hItem.fields) &&
          hItem.note === CANONICAL_REDACTION_STUB;

        if (!isAllowedExpungeRedaction) {
          errors.push(
            `Entry '${slug}' modified existing errata[${i}] item. Existing errata[] items must be byte-identical (or have 'note' redacted to canonical stub during an expunge transition).`
          );
        }
      }
    }
  }

  // Validate newly appended errata items
  const newErrata = headErrata.slice(baseErrata.length);
  for (let i = 0; i < newErrata.length; i++) {
    const item = newErrata[i];
    const idx = baseErrata.length + i;
    if (!item.on) {
      errors.push(`Entry '${slug}' newly appended errata[${idx}] is missing 'on' date.`);
    }
    if (!VALID_ERRATUM_CLASSES.has(item.class)) {
      errors.push(
        `Entry '${slug}' newly appended errata[${idx}] has invalid class '${item.class}'.`
      );
    }
    if (!item.note || item.note.trim() === '') {
      errors.push(`Entry '${slug}' newly appended errata[${idx}] has an empty 'note'.`);
    }
  }

  // Rule 7 (Terminal states: body edits on Superseded/Withdrawn fail) & Rule 3 (Normalized body diff requires new errata[])
  const rawBodyChanged = headEntry.body !== baseEntry.body;
  const normalizedBodyChanged = normalizeBody(headEntry.body) !== normalizeBody(baseEntry.body);
  const inTerminalState =
    baseIsSuperseded || baseIsWithdrawn || headIsSuperseded || headIsWithdrawn;

  if (!isExpungeTransition) {
    if (inTerminalState) {
      if (normalizedBodyChanged || rawBodyChanged) {
        const stateName =
          baseIsSuperseded || headIsSuperseded ? 'Superseded' : 'Withdrawn';
        errors.push(
          `Entry '${slug}' is in terminal state (${stateName}); body edits on Superseded/Withdrawn entries are forbidden.`
        );
      }
    } else if (normalizedBodyChanged) {
      if (newErrata.length === 0) {
        errors.push(
          `Entry '${slug}' has a normalized body change without a newly appended errata[] item.`
        );
      }
    }
  }

  // Rule 4: title/description may change only with a new errata[] item whose fields names them
  if (headEntry.data.title !== baseEntry.data.title) {
    if (inTerminalState) {
      errors.push(`Entry '${slug}' cannot modify 'title' in terminal state.`);
    } else {
      const hasTitleErratum = newErrata.some(
        (e) => Array.isArray(e.fields) && e.fields.includes('title')
      );
      if (!hasTitleErratum) {
        errors.push(
          `Entry '${slug}' modified 'title' without a newly appended errata[] item naming 'title' in fields.`
        );
      }
    }
  }

  if ((headEntry.data.description ?? undefined) !== (baseEntry.data.description ?? undefined)) {
    if (inTerminalState) {
      errors.push(`Entry '${slug}' cannot modify 'description' in terminal state.`);
    } else {
      const hasDescErratum = newErrata.some(
        (e) => Array.isArray(e.fields) && e.fields.includes('description')
      );
      if (!hasDescErratum) {
        errors.push(
          `Entry '${slug}' modified 'description' without a newly appended errata[] item naming 'description' in fields.`
        );
      }
    }
  }

  return {
    slug,
    ok: errors.length === 0,
    errors,
  };
}

/**
 * Evaluates errata-guard across full maps of base and head Markdown files (`slug -> rawMarkdown`).
 */
export function evaluateErrataGuard(
  baseFiles: Map<string, string>,
  headFiles: Map<string, string>
): ErrataGuardResult {
  const allSlugs = new Set<string>([...baseFiles.keys(), ...headFiles.keys()]);
  const sortedSlugs = Array.from(allSlugs).sort();
  const errors: string[] = [];

  for (const slug of sortedSlugs) {
    const result = compareEntryPair(slug, baseFiles.get(slug), headFiles.get(slug));
    if (!result.ok) {
      errors.push(...result.errors);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    checkedCount: sortedSlugs.length,
  };
}

function readMarkdownFilesInDirectory(
  rootDir: string,
  currentDir: string = rootDir,
  depth: number = 0,
  out: Map<string, string> = new Map()
): Map<string, string> {
  if (depth > MAX_DIR_DEPTH || !fs.existsSync(currentDir)) {
    return out;
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      readMarkdownFilesInDirectory(rootDir, fullPath, depth + 1, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      const slug = rel.replace(/\.md$/, '');
      out.set(slug, fs.readFileSync(fullPath, 'utf8'));
    }
  }

  return out;
}

/**
 * Compares all `.md` files in `baseDir` against `headDir`.
 */
export function compareWordsDirectories(baseDir: string, headDir: string): ErrataGuardResult {
  const baseFiles = readMarkdownFilesInDirectory(baseDir);
  const headFiles = readMarkdownFilesInDirectory(headDir);
  return evaluateErrataGuard(baseFiles, headFiles);
}

/**
 * Compares `src/content/words/*.md` in the working tree against `baseRef` in git.
 */
export function compareWordsAgainstGitRef(repoDir: string, baseRef: string): ErrataGuardResult {
  const baseFiles = new Map<string, string>();
  const wordsDirRel = 'src/content/words';

  let treeOutput = '';
  try {
    treeOutput = execFileSync(
      'git',
      ['-C', repoDir, 'ls-tree', '-r', '--name-only', baseRef, '--', wordsDirRel],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`Failed to inspect git ref '${baseRef}': ${msg}`],
      checkedCount: 0,
    };
  }

  const lines = treeOutput
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.md'));

  for (const fileRel of lines) {
    const slug = fileRel
      .slice(wordsDirRel.length + 1)
      .replace(/\\/g, '/')
      .replace(/\.md$/, '');
    const content = execFileSync('git', ['-C', repoDir, 'show', `${baseRef}:${fileRel}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    baseFiles.set(slug, content);
  }

  const headWordsDir = path.join(repoDir, 'src', 'content', 'words');
  const headFiles = readMarkdownFilesInDirectory(headWordsDir);

  return evaluateErrataGuard(baseFiles, headFiles);
}

function parseCliArgs(argv: string[]): {
  baseRef?: string;
  baseDir?: string;
  headDir?: string;
  repoDir: string;
} {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  let repoDir = path.resolve(scriptDir, '..', '..');
  let baseRef: string | undefined;
  let baseDir: string | undefined;
  let headDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--base-ref' || arg === '-BaseRef') && i + 1 < argv.length) {
      baseRef = argv[++i];
    } else if ((arg === '--base-dir' || arg === '-BaseDir') && i + 1 < argv.length) {
      baseDir = path.resolve(argv[++i]);
    } else if ((arg === '--head-dir' || arg === '-HeadDir') && i + 1 < argv.length) {
      headDir = path.resolve(argv[++i]);
    } else if ((arg === '--repo-dir' || arg === '-RepoDir') && i + 1 < argv.length) {
      repoDir = path.resolve(argv[++i]);
    }
  }

  return { baseRef, baseDir, headDir, repoDir };
}

export function runErrataGuardCli(argv: string[] = process.argv.slice(2)): number {
  const { baseRef, baseDir, headDir, repoDir } = parseCliArgs(argv);

  let result: ErrataGuardResult;
  if (baseDir && headDir) {
    result = compareWordsDirectories(baseDir, headDir);
  } else {
    const resolvedBaseRef = baseRef || 'origin/next';
    result = compareWordsAgainstGitRef(repoDir, resolvedBaseRef);
  }

  if (!result.ok) {
    console.error('errata-guard FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    return 1;
  }

  console.log(`errata-guard PASSED (${result.checkedCount} entry file(s) checked).`);
  return 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exitCode = runErrataGuardCli();
}
