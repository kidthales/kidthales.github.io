import test from 'node:test';
import assert from 'node:assert';
import {
  CANONICAL_PERMUTATIONS,
  BUCKETS,
  TUNINGS,
  fnv1a32,
  mulberry32,
  computeSpiderexSeed,
  computeWarmupSeed,
  isValidDateString,
  getTodayUtcDate,
  getTodayLocalDate,
  parseSpiderexParams,
  generateWarmupDrill,
  generateTwisterDrill,
  generateSpiderexDrill,
  formatSpiderexAsciiTab,
} from '../src/lib/spiderex.ts';

test('CANONICAL_PERMUTATIONS contains 24 unique valid 4-finger permutations', () => {
  assert.strictEqual(CANONICAL_PERMUTATIONS.length, 24);

  const seen = new Set<string>();
  for (const perm of CANONICAL_PERMUTATIONS) {
    assert.strictEqual(perm.length, 4);
    const sorted = [...perm].sort();
    assert.deepStrictEqual(sorted, [1, 2, 3, 4], 'Each permutation must contain fingers 1, 2, 3, 4');
    const key = perm.join('');
    assert.strictEqual(seen.has(key), false, `Duplicate permutation found: ${key}`);
    seen.add(key);
  }
});

test('BUCKETS partition CANONICAL_PERMUTATIONS into 4 buckets of 6 starting with fingers 1..4', () => {
  assert.strictEqual(BUCKETS.length, 4);
  for (let i = 0; i < 4; i++) {
    const expectedLeadingFinger = i + 1;
    const bucket = BUCKETS[i]!;
    assert.strictEqual(bucket.length, 6, `Bucket ${expectedLeadingFinger} must contain 6 permutations`);
    for (const perm of bucket) {
      assert.strictEqual(perm[0], expectedLeadingFinger, `Permutation in bucket ${i} must start with finger ${expectedLeadingFinger}`);
    }
  }
});

test('fnv1a32 produces deterministic unsigned 32-bit integer hashes', () => {
  // Empty string standard test vector for 32-bit FNV-1a is 0x811c9dc5 = 2166136261
  assert.strictEqual(fnv1a32(''), 2166136261);

  const hash1 = fnv1a32('2026-10-31:v1:s6:k0');
  const hash2 = fnv1a32('2026-10-31:v1:s6:k0');
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1 >= 0 && hash1 <= 0xffffffff, true);

  const hashVariant = fnv1a32('2026-10-31:v2:s6:k0');
  assert.notStrictEqual(hash1, hashVariant);
});

test('mulberry32 produces deterministic floats in [0, 1)', () => {
  const seed = 123456789;
  const rng1 = mulberry32(seed);
  const rng2 = mulberry32(seed);

  const seq1 = Array.from({ length: 10 }, () => rng1());
  const seq2 = Array.from({ length: 10 }, () => rng2());

  assert.deepStrictEqual(seq1, seq2);
  for (const val of seq1) {
    assert.strictEqual(val >= 0 && val < 1, true);
  }

  const rngOther = mulberry32(seed + 1);
  const seqOther = Array.from({ length: 10 }, () => rngOther());
  assert.notDeepStrictEqual(seq1, seqOther);
});

test('isValidDateString correctly validates ISO YYYY-MM-DD calendar dates', () => {
  assert.strictEqual(isValidDateString('2026-10-31'), true);
  assert.strictEqual(isValidDateString('2024-02-29'), true); // Leap year valid
  assert.strictEqual(isValidDateString('2025-02-29'), false); // Non-leap year invalid
  assert.strictEqual(isValidDateString('2026-02-31'), false); // Invalid day
  assert.strictEqual(isValidDateString('2026-13-01'), false); // Invalid month
  assert.strictEqual(isValidDateString('2026/10/31'), false); // Wrong delimiter
  assert.strictEqual(isValidDateString('not-a-date'), false);
  assert.strictEqual(isValidDateString(''), false);
});

test('parseSpiderexParams handles URLSearchParams, strings, objects, and defaults', () => {
  const today = getTodayUtcDate();

  // Empty / undefined inputs default gracefully
  const defaultParams = parseSpiderexParams();
  assert.strictEqual(defaultParams.date, today);
  assert.strictEqual(defaultParams.variant, 1);
  assert.strictEqual(defaultParams.strings, 6);
  assert.strictEqual(defaultParams.skip, false);

  // URLSearchParams input
  const searchParams = new URLSearchParams('date=2026-05-15&variant=3&strings=7&skip=1');
  const parsedFromUrl = parseSpiderexParams(searchParams);
  assert.strictEqual(parsedFromUrl.date, '2026-05-15');
  assert.strictEqual(parsedFromUrl.variant, 3);
  assert.strictEqual(parsedFromUrl.strings, 7);
  assert.strictEqual(parsedFromUrl.skip, true);

  // Query string input with leading '?'
  const parsedFromQuery = parseSpiderexParams('?date=2026-05-15&variant=2&strings=4&skip=true');
  assert.strictEqual(parsedFromQuery.date, '2026-05-15');
  assert.strictEqual(parsedFromQuery.variant, 2);
  assert.strictEqual(parsedFromQuery.strings, 4);
  assert.strictEqual(parsedFromQuery.skip, true);

  // Fallbacks for invalid values
  const parsedInvalid = parseSpiderexParams({
    date: 'invalid-date',
    variant: -5,
    strings: 8,
    skip: 'unknown',
  });
  assert.strictEqual(parsedInvalid.date, today);
  assert.strictEqual(parsedInvalid.variant, 1);
  assert.strictEqual(parsedInvalid.strings, 6);
  assert.strictEqual(parsedInvalid.skip, false);
});

test('computeSpiderexSeed computes composite string and FNV-1a hash', () => {
  const seed = computeSpiderexSeed({
    date: '2026-01-01',
    variant: 1,
    strings: 6,
    skip: false,
  });
  const expected = fnv1a32('2026-01-01:v1:s6:k0');
  assert.strictEqual(seed, expected);

  const seedSkip = computeSpiderexSeed({
    date: '2026-01-01',
    variant: 1,
    strings: 6,
    skip: true,
  });
  assert.notStrictEqual(seed, seedSkip);
});

test('computeWarmupSeed computes warmup composite string and FNV-1a hash', () => {
  const seed = computeWarmupSeed({
    date: '2026-01-01',
    variant: 1,
  });
  const expected = fnv1a32('2026-01-01:v1');
  assert.strictEqual(seed, expected);

  const seedVariant = computeWarmupSeed({
    date: '2026-01-01',
    variant: 2,
  });
  assert.notStrictEqual(seed, seedVariant);
});

test('getTodayLocalDate returns ISO YYYY-MM-DD formatted local date', () => {
  const localDate = getTodayLocalDate();
  assert.strictEqual(typeof localDate, 'string');
  assert.strictEqual(/^\d{4}-\d{2}-\d{2}$/.test(localDate), true, 'Must match YYYY-MM-DD');
  assert.strictEqual(isValidDateString(localDate), true, 'Must be a valid calendar date');
});

test('generateWarmupDrill deterministically selects 1 permutation per bucket', () => {
  const seed = 42;
  const drill1 = generateWarmupDrill(mulberry32(seed));
  const drill2 = generateWarmupDrill(mulberry32(seed));

  assert.deepStrictEqual(drill1, drill2);
  assert.strictEqual(drill1.patterns.length, 4);
  assert.strictEqual(drill1.patterns[0][0], 1, 'Pattern 1 must start with 1');
  assert.strictEqual(drill1.patterns[1][0], 2, 'Pattern 2 must start with 2');
  assert.strictEqual(drill1.patterns[2][0], 3, 'Pattern 3 must start with 3');
  assert.strictEqual(drill1.patterns[3][0], 4, 'Pattern 4 must start with 4');
});

test('generateTwisterDrill satisfies all bar, note, and string-transition invariants in adjacent mode', () => {
  for (const strings of [4, 6, 7] as const) {
    const seed = 12345;
    const warmup = generateWarmupDrill(mulberry32(seed));
    const twisterDirect = generateTwisterDrill(warmup.patterns, mulberry32(seed + 1), strings, false);
    assert.strictEqual(twisterDirect.bars.length, 16);
    assert.strictEqual(twisterDirect.notes.length, 64);

    const drill = generateSpiderexDrill({
      date: '2026-10-31',
      variant: 1,
      strings,
      skip: false,
    });

    const twister = drill.twister;
    assert.strictEqual(twister.bars.length, 16, 'Twister must generate 16 bars');
    assert.strictEqual(twister.notes.length, 64, 'Twister must generate 64 notes');

    // Warmup pattern distribution: each of the 4 warmup patterns must appear exactly 4 times
    const patternCounts = new Map<string, number>();
    for (const bar of twister.bars) {
      const key = bar.pattern.join('-');
      patternCounts.set(key, (patternCounts.get(key) || 0) + 1);
    }
    for (const pattern of drill.warmup.patterns) {
      assert.strictEqual(patternCounts.get(pattern.join('-')), 4, 'Each warmup pattern must repeat 4 times in 16 bars');
    }

    // Fixed 4-fret chromatic box: finger equals fret
    for (const note of twister.notes) {
      assert.strictEqual(note.fret, note.finger, 'Fret must equal finger position (1..4)');
      assert.strictEqual(note.stringIndex >= 0 && note.stringIndex < strings, true, 'String index must be within range');
    }

    // Adjacent transition invariant: |Δs| === 1 for every consecutive note step
    for (let i = 1; i < twister.notes.length; i++) {
      const prevString = twister.notes[i - 1]!.stringIndex;
      const currString = twister.notes[i]!.stringIndex;
      const delta = Math.abs(currString - prevString);
      assert.strictEqual(
        delta,
        1,
        `Note ${i} string transition (${prevString} -> ${currString}) must have |Δs| = 1 in adjacent mode`
      );
    }
  }
});

test('generateTwisterDrill satisfies all bar, note, and string-transition invariants in skipping mode', () => {
  for (const strings of [4, 6, 7] as const) {
    const drill = generateSpiderexDrill({
      date: '2026-10-31',
      variant: 1,
      strings,
      skip: true,
    });

    const twister = drill.twister;
    assert.strictEqual(twister.bars.length, 16);
    assert.strictEqual(twister.notes.length, 64);

    // Skipping transition invariant: |Δs| >= 2 for every consecutive note step
    for (let i = 1; i < twister.notes.length; i++) {
      const prevString = twister.notes[i - 1]!.stringIndex;
      const currString = twister.notes[i]!.stringIndex;
      const delta = Math.abs(currString - prevString);
      assert.strictEqual(
        delta >= 2,
        true,
        `Note ${i} string transition (${prevString} -> ${currString}, delta ${delta}) must have |Δs| >= 2 in skipping mode`
      );
    }
  }
});

test('generateSpiderexDrill produces identical drills for identical parameters and distinct drills for changed parameters', () => {
  const d1 = generateSpiderexDrill({ date: '2026-01-01', variant: 1, strings: 6, skip: false });
  const d2 = generateSpiderexDrill({ date: '2026-01-01', variant: 1, strings: 6, skip: false });
  assert.deepStrictEqual(d1, d2);

  const dVariant2 = generateSpiderexDrill({ date: '2026-01-01', variant: 2, strings: 6, skip: false });
  assert.notDeepStrictEqual(d1.twister.notes, dVariant2.twister.notes);

  const dSkip = generateSpiderexDrill({ date: '2026-01-01', variant: 1, strings: 6, skip: true });
  assert.notDeepStrictEqual(d1.twister.notes, dSkip.twister.notes);
});

test('Warmup patterns 1-4 are decoupled from strings count and skipping mode', () => {
  const date = '2026-11-04';
  const variant = 1;

  // 1. Assert Warmup patterns 1–4 are identical across all string counts (4, 6, 7) for identical date and variant
  const d4 = generateSpiderexDrill({ date, variant, strings: 4, skip: false });
  const d6 = generateSpiderexDrill({ date, variant, strings: 6, skip: false });
  const d7 = generateSpiderexDrill({ date, variant, strings: 7, skip: false });

  assert.deepStrictEqual(d4.warmup.patterns, d6.warmup.patterns);
  assert.deepStrictEqual(d6.warmup.patterns, d7.warmup.patterns);

  // 2. Assert Warmup patterns 1–4 are identical between adjacent (skip: false) and string-skipping (skip: true) modes for identical date and variant
  const d4Skip = generateSpiderexDrill({ date, variant, strings: 4, skip: true });
  const d6Skip = generateSpiderexDrill({ date, variant, strings: 6, skip: true });
  const d7Skip = generateSpiderexDrill({ date, variant, strings: 7, skip: true });

  assert.deepStrictEqual(d4.warmup.patterns, d4Skip.warmup.patterns);
  assert.deepStrictEqual(d6.warmup.patterns, d6Skip.warmup.patterns);
  assert.deepStrictEqual(d7.warmup.patterns, d7Skip.warmup.patterns);

  // Warmup patterns DO vary when date or variant changes
  const dVariant2 = generateSpiderexDrill({ date, variant: 2, strings: 6, skip: false });
  assert.notDeepStrictEqual(d6.warmup.patterns, dVariant2.warmup.patterns);

  const dDate2 = generateSpiderexDrill({ date: '2026-11-05', variant, strings: 6, skip: false });
  assert.notDeepStrictEqual(d6.warmup.patterns, dDate2.warmup.patterns);

  // 3. Assert Twister note sequences and string transitions continue to vary correctly when skip or strings change
  assert.notDeepStrictEqual(d6.twister.notes, d6Skip.twister.notes);
  assert.notDeepStrictEqual(d6.twister.notes, d4.twister.notes);
  assert.notDeepStrictEqual(d6.twister.notes, d7.twister.notes);

  // Confirm string ranges and transition rules continue to hold
  for (const n of d4.twister.notes) {
    assert.strictEqual(n.stringIndex >= 0 && n.stringIndex < 4, true);
  }
  for (const n of d7.twister.notes) {
    assert.strictEqual(n.stringIndex >= 0 && n.stringIndex < 7, true);
  }
  for (let i = 1; i < d6Skip.twister.notes.length; i++) {
    const delta = Math.abs(d6Skip.twister.notes[i]!.stringIndex - d6Skip.twister.notes[i - 1]!.stringIndex);
    assert.strictEqual(delta >= 2, true);
  }
  for (let i = 1; i < d6.twister.notes.length; i++) {
    const delta = Math.abs(d6.twister.notes[i]!.stringIndex - d6.twister.notes[i - 1]!.stringIndex);
    assert.strictEqual(delta === 1, true);
  }
});

test('formatSpiderexAsciiTab formats metadata header and 4 systems of 4 bars correctly', () => {
  for (const strings of [4, 6, 7] as const) {
    const drill = generateSpiderexDrill({
      date: '2026-01-01',
      variant: 1,
      strings,
      skip: false,
    });

    const tab = formatSpiderexAsciiTab(drill);
    assert.strictEqual(typeof tab, 'string');
    assert.strictEqual(tab.includes('Spiderex Daily Drill — 2026-01-01 (v1)'), true);
    assert.strictEqual(tab.includes(`Strings: ${strings}`), true);
    assert.strictEqual(tab.includes('Warmup Patterns:'), true);
    assert.strictEqual(tab.includes('Twister (16 Bars):'), true);

    const tuning = TUNINGS[strings];
    for (const t of tuning) {
      assert.strictEqual(tab.includes(`${t}|`), true, `Tab must include tuning line for ${t}`);
    }

    // Split into systems after header
    const parts = tab.split('\n\n');
    // Header is parts[0], followed by 4 systems
    assert.strictEqual(parts.length, 5, 'Must contain header + 4 systems separated by blank lines');

    for (let sysIdx = 1; sysIdx <= 4; sysIdx++) {
      const systemLines = parts[sysIdx]!.trim().split('\n');
      assert.strictEqual(systemLines.length, strings, `System ${sysIdx} must have ${strings} string lines`);

      for (let s = 0; s < strings; s++) {
        const line = systemLines[s]!;
        assert.strictEqual(line.startsWith(`${tuning[s]}|`), true);
        // Each bar is 9 chars plus trailing '|' -> 4 bars = 4 barlines inside
        const barlineCount = (line.match(/\|/g) || []).length;
        assert.strictEqual(barlineCount, 5, 'Each system line must have opening tuning barline + 4 bar-ending barlines');
      }
    }
  }
});


