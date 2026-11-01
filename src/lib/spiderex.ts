/**
 * Spiderex chromatic finger-independence drill generator.
 * Pure TypeScript domain library powering Warmup and Twister exercises.
 * Zero external dependencies.
 */

export type Finger = 1 | 2 | 3 | 4;

export type Permutation = readonly [Finger, Finger, Finger, Finger];

export type StringCount = 4 | 6 | 7;

export interface SpiderexParams {
  date: string;
  variant: number;
  strings: StringCount;
  skip: boolean;
}

export interface WarmupDrill {
  patterns: [Permutation, Permutation, Permutation, Permutation];
  stringOrder: number[];
  ascendingFrets: number[];
  descendingFrets: number[];
}

export interface TwisterNote {
  barIndex: number;
  noteIndex: number;
  globalIndex: number;
  finger: Finger;
  fret: number;
  stringIndex: number;
}

export interface TwisterBar {
  barIndex: number;
  pattern: Permutation;
  notes: [TwisterNote, TwisterNote, TwisterNote, TwisterNote];
}

export interface TwisterDrill {
  bars: TwisterBar[];
  notes: TwisterNote[];
}

export interface SpiderexDrill {
  params: SpiderexParams;
  seed: number;
  warmup: WarmupDrill;
  twister: TwisterDrill;
}

/**
 * Standard tunings displayed top-to-bottom (highest pitch string to lowest pitch string).
 */
export const TUNINGS: Record<StringCount, readonly string[]> = {
  4: ['G', 'D', 'A', 'E'],
  6: ['e', 'B', 'G', 'D', 'A', 'E'],
  7: ['e', 'B', 'G', 'D', 'A', 'E', 'B'],
};

/**
 * All 24 canonical permutations of the 4 fingers [1, 2, 3, 4] in lexicographical order.
 */
export const CANONICAL_PERMUTATIONS: readonly Permutation[] = [
  [1, 2, 3, 4],
  [1, 2, 4, 3],
  [1, 3, 2, 4],
  [1, 3, 4, 2],
  [1, 4, 2, 3],
  [1, 4, 3, 2],
  [2, 1, 3, 4],
  [2, 1, 4, 3],
  [2, 3, 1, 4],
  [2, 3, 4, 1],
  [2, 4, 1, 3],
  [2, 4, 3, 1],
  [3, 1, 2, 4],
  [3, 1, 4, 2],
  [3, 2, 1, 4],
  [3, 2, 4, 1],
  [3, 4, 1, 2],
  [3, 4, 2, 1],
  [4, 1, 2, 3],
  [4, 1, 3, 2],
  [4, 2, 1, 3],
  [4, 2, 3, 1],
  [4, 3, 1, 2],
  [4, 3, 2, 1],
];

/**
 * 4 starting-finger buckets (6 permutations each):
 * Bucket 1: 1***, Bucket 2: 2***, Bucket 3: 3***, Bucket 4: 4***.
 */
export const BUCKETS: readonly (readonly Permutation[])[] = [
  CANONICAL_PERMUTATIONS.slice(0, 6),
  CANONICAL_PERMUTATIONS.slice(6, 12),
  CANONICAL_PERMUTATIONS.slice(12, 18),
  CANONICAL_PERMUTATIONS.slice(18, 24),
];

/**
 * 32-bit FNV-1a hash returning an unsigned 32-bit integer (uint32).
 */
export function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Mulberry32 pseudo-random number generator producing normalized floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives canonical composite seed string and 32-bit FNV-1a seed.
 * Format: `${date}:v${variant}:s${strings}:k${skip ? 1 : 0}`
 */
export function computeSpiderexSeed(params: SpiderexParams): number {
  const composite = `${params.date}:v${params.variant}:s${params.strings}:k${params.skip ? 1 : 0}`;
  return fnv1a32(composite);
}

/**
 * Validates ISO YYYY-MM-DD date representation and real calendar validity.
 */
export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Returns today's UTC calendar date as YYYY-MM-DD.
 */
export function getTodayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parses and sanitizes Spiderex URL search parameters or plain object input.
 */
export function parseSpiderexParams(input?: unknown): SpiderexParams {
  let rawDate: unknown;
  let rawVariant: unknown;
  let rawStrings: unknown;
  let rawSkip: unknown;

  if (typeof URLSearchParams !== 'undefined' && input instanceof URLSearchParams) {
    rawDate = input.get('date');
    rawVariant = input.get('variant');
    rawStrings = input.get('strings');
    rawSkip = input.get('skip');
  } else if (typeof input === 'string') {
    const query = input.startsWith('?') ? input.slice(1) : input;
    const params = new URLSearchParams(query);
    rawDate = params.get('date');
    rawVariant = params.get('variant');
    rawStrings = params.get('strings');
    rawSkip = params.get('skip');
  } else if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    rawDate = record.date;
    rawVariant = record.variant;
    rawStrings = record.strings;
    rawSkip = record.skip;
  }

  // Sanitize date
  let date: string;
  if (typeof rawDate === 'string' && isValidDateString(rawDate)) {
    date = rawDate;
  } else {
    date = getTodayUtcDate();
  }

  // Sanitize variant (integer >= 1, default 1)
  let variant = 1;
  if (typeof rawVariant === 'number' && Number.isInteger(rawVariant) && rawVariant >= 1) {
    variant = rawVariant;
  } else if (typeof rawVariant === 'string') {
    const parsed = parseInt(rawVariant, 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      variant = parsed;
    }
  }

  // Sanitize strings (4 | 6 | 7, default 6)
  let strings: StringCount = 6;
  const parsedStrings = typeof rawStrings === 'number' ? rawStrings : parseInt(String(rawStrings), 10);
  if (parsedStrings === 4 || parsedStrings === 6 || parsedStrings === 7) {
    strings = parsedStrings;
  }

  // Sanitize skip (boolean, default false)
  let skip = false;
  if (typeof rawSkip === 'boolean') {
    skip = rawSkip;
  } else if (typeof rawSkip === 'number') {
    skip = rawSkip === 1;
  } else if (typeof rawSkip === 'string') {
    const lower = rawSkip.trim().toLowerCase();
    skip = lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on';
  }

  return { date, variant, strings, skip };
}

/**
 * Returns string traversal order for warmup exercises:
 * - Consecutive 0..S-1 in adjacent mode
 * - Alternating outside-in 0, S-1, 1, S-2, ... in skipping mode
 */
export function getWarmupStringOrder(strings: StringCount, skip: boolean): number[] {
  if (!skip) {
    return Array.from({ length: strings }, (_, i) => i);
  }
  const result: number[] = [];
  let low = 0;
  let high = strings - 1;
  while (low <= high) {
    result.push(low);
    if (low !== high) {
      result.push(high);
    }
    low++;
    high--;
  }
  return result;
}

/**
 * Generates the deterministic Warmup drill:
 * Samples 1 permutation per bucket (1***, 2***, 3***, 4***) using Mulberry32.
 */
export function generateWarmupDrill(
  prng: () => number,
  strings: StringCount,
  skip: boolean
): WarmupDrill {
  const p1 = BUCKETS[0][Math.floor(prng() * BUCKETS[0].length)] as Permutation;
  const p2 = BUCKETS[1][Math.floor(prng() * BUCKETS[1].length)] as Permutation;
  const p3 = BUCKETS[2][Math.floor(prng() * BUCKETS[2].length)] as Permutation;
  const p4 = BUCKETS[3][Math.floor(prng() * BUCKETS[3].length)] as Permutation;

  const patterns: [Permutation, Permutation, Permutation, Permutation] = [p1, p2, p3, p4];
  const stringOrder = getWarmupStringOrder(strings, skip);
  const ascendingFrets = Array.from({ length: 12 }, (_, i) => i + 1);
  const descendingFrets = Array.from({ length: 12 }, (_, i) => 12 - i);

  return {
    patterns,
    stringOrder,
    ascendingFrets,
    descendingFrets,
  };
}

/**
 * In-place Fisher-Yates array shuffle using the given PRNG.
 */
function shuffle<T>(array: T[], prng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

/**
 * Generates the deterministic Twister drill:
 * - 16 bars (4 repetitions of 4 warmup patterns shuffled via Fisher-Yates, 64 notes).
 * - Fixed 4-fret chromatic box (frets 1, 2, 3, 4).
 * - Note 0 starts on a string picked uniformly (0..S-1).
 * - Note-to-note string transitions strictly filtered by |Δs| = 1 (adjacent) vs |Δs| >= 2 (skipping).
 */
export function generateTwisterDrill(
  warmupPatterns: [Permutation, Permutation, Permutation, Permutation],
  prng: () => number,
  strings: StringCount,
  skip: boolean
): TwisterDrill {
  const repeatedPatterns: Permutation[] = [
    ...warmupPatterns,
    ...warmupPatterns,
    ...warmupPatterns,
    ...warmupPatterns,
  ];

  const shuffledBars = shuffle(repeatedPatterns, prng);

  const notes: TwisterNote[] = [];
  const bars: TwisterBar[] = [];

  let currentString = Math.floor(prng() * strings);

  for (let barIdx = 0; barIdx < 16; barIdx++) {
    const pattern = shuffledBars[barIdx]!;
    const barNotes: TwisterNote[] = [];

    for (let noteIdx = 0; noteIdx < 4; noteIdx++) {
      const globalIndex = barIdx * 4 + noteIdx;

      if (globalIndex > 0) {
        const candidates: number[] = [];
        for (let s = 0; s < strings; s++) {
          const delta = Math.abs(s - currentString);
          if (!skip && delta === 1) {
            candidates.push(s);
          } else if (skip && delta >= 2) {
            candidates.push(s);
          }
        }
        const pickIndex = Math.floor(prng() * candidates.length);
        currentString = candidates[pickIndex]!;
      }

      const finger = pattern[noteIdx]!;
      const fret = finger; // Fixed 4-fret chromatic box: finger 1->fret 1, 2->2, 3->3, 4->4

      const note: TwisterNote = {
        barIndex: barIdx,
        noteIndex: noteIdx,
        globalIndex,
        finger,
        fret,
        stringIndex: currentString,
      };

      notes.push(note);
      barNotes.push(note);
    }

    bars.push({
      barIndex: barIdx,
      pattern,
      notes: barNotes as [TwisterNote, TwisterNote, TwisterNote, TwisterNote],
    });
  }

  return { bars, notes };
}

/**
 * Generates a complete deterministic Spiderex drill for the given parameters.
 */
export function generateSpiderexDrill(rawParams?: unknown): SpiderexDrill {
  const params = parseSpiderexParams(rawParams);
  const seed = computeSpiderexSeed(params);
  const prng = mulberry32(seed);

  const warmup = generateWarmupDrill(prng, params.strings, params.skip);
  const twister = generateTwisterDrill(warmup.patterns, prng, params.strings, params.skip);

  return {
    params,
    seed,
    warmup,
    twister,
  };
}

/**
 * Formats a Spiderex drill as a plain-text ASCII tablature block for clipboard export:
 * - Metadata header block with date, variant, strings count, mode, seed, and warmup patterns.
 * - 4 systems of 4 bars each (16 bars total), separated by '|' with '-' spacers.
 * - String tuning order: 4-string G-D-A-E, 6-string e-B-G-D-A-E, 7-string e-B-G-D-A-E-B.
 */
export function formatSpiderexAsciiTab(drill: SpiderexDrill): string {
  const { params, seed, warmup, twister } = drill;
  const tuning = TUNINGS[params.strings];
  const modeLabel = params.skip ? 'String-Skipping' : 'Adjacent';
  const seedHex = `0x${seed.toString(16).padStart(8, '0')}`;

  const headerLines: string[] = [
    `Spiderex Daily Drill — ${params.date} (v${params.variant})`,
    `Strings: ${params.strings} | Mode: ${modeLabel} | Seed: ${seedHex} (${seed})`,
    'Warmup Patterns:',
    `  1: ${warmup.patterns[0].join('-')}`,
    `  2: ${warmup.patterns[1].join('-')}`,
    `  3: ${warmup.patterns[2].join('-')}`,
    `  4: ${warmup.patterns[3].join('-')}`,
    'Twister (16 Bars):',
  ];

  const systems: string[] = [];

  // 4 systems, each containing 4 bars
  for (let sysIdx = 0; sysIdx < 4; sysIdx++) {
    const startBar = sysIdx * 4;
    const endBar = startBar + 4;
    const systemBars = twister.bars.slice(startBar, endBar);

    const stringLines: string[] = [];

    for (let s = 0; s < params.strings; s++) {
      let line = `${tuning[s]}|`;

      for (let b = 0; b < systemBars.length; b++) {
        const bar = systemBars[b]!;

        for (let n = 0; n < 4; n++) {
          const note = bar.notes[n]!;
          line += '-';
          line += note.stringIndex === s ? String(note.fret) : '-';
        }
        line += '-|';
      }

      stringLines.push(line);
    }

    systems.push(stringLines.join('\n'));
  }

  return `${headerLines.join('\n')}\n\n${systems.join('\n\n')}\n`;
}

/**
 * Formats the Warmup full-neck exercise as a structured ASCII tab.
 */
export function formatWarmupAsciiTab(warmup: WarmupDrill, strings: StringCount): string {
  const tuning = TUNINGS[strings];
  const lines: string[] = [
    'Warmup Exercise (Frets 1..12 Ascending, 12..1 Descending):',
    `Patterns: ${warmup.patterns.map((p, i) => `[${i + 1}]: ${p.join('')}`).join('  ')}`,
    `String Order: ${warmup.stringOrder.map((s) => tuning[s]).join(' -> ')}`,
    '',
  ];

  for (let pIdx = 0; pIdx < warmup.patterns.length; pIdx++) {
    const pattern = warmup.patterns[pIdx]!;
    lines.push(`Pattern ${pIdx + 1} (${pattern.join('')}):`);

    for (let s = 0; s < strings; s++) {
      let line = `${tuning[s]}|`;
      for (const fretBase of warmup.ascendingFrets) {
        if (warmup.stringOrder.includes(s)) {
          line += `-${pattern.map((f) => fretBase + f - 1).join('-')}-|`;
        } else {
          line += '------------|';
        }
      }
      lines.push(line);
    }
    lines.push('');
  }

  return lines.join('\n');
}
