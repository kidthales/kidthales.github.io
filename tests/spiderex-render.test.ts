import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderFingerBadgeSvg,
  renderWarmupFretboardSvg,
  renderWarmupPatternSvg,
  renderWarmupCards,
  renderTwisterSystemSvg,
  renderTwisterSystems,
} from '../src/lib/spiderex-render.ts';
import { generateSpiderexDrill, parseSpiderexParams } from '../src/lib/spiderex.ts';
import { lintColourLiterals } from '../scripts/gates/css-lint.ts';

test('spiderex-render: renders 4 distinct shapes for fingers 1..4 with zero raw colours', () => {
  const b1 = renderFingerBadgeSvg(1, 50, 50);
  const b2 = renderFingerBadgeSvg(2, 50, 50);
  const b3 = renderFingerBadgeSvg(3, 50, 50);
  const b4 = renderFingerBadgeSvg(4, 50, 50);

  // Shape elements
  assert.ok(b1.includes('<circle'), 'Finger 1 must be a circle');
  assert.ok(b2.includes('<rect'), 'Finger 2 must be a rounded square (rect)');
  assert.ok(b3.includes('<polygon'), 'Finger 3 must be a diamond (polygon)');
  assert.ok(b4.includes('<polygon'), 'Finger 4 must be a hexagon (polygon)');

  // Border & FG token classes
  assert.ok(b1.includes('var(--pt-status-info-border)'));
  assert.ok(b1.includes('var(--pt-status-info-fg)'));

  assert.ok(b2.includes('var(--pt-status-ok-border)'));
  assert.ok(b2.includes('var(--pt-status-ok-fg)'));

  assert.ok(b3.includes('var(--pt-status-warning-border)'));
  assert.ok(b3.includes('var(--pt-status-warning-fg)'));

  assert.ok(b4.includes('var(--pt-status-critical-border)'));
  assert.ok(b4.includes('var(--pt-status-critical-fg)'));

  // All badges use opaque var(--pt-card-bg) fills
  for (const b of [b1, b2, b3, b4]) {
    assert.ok(b.includes('fill="var(--pt-card-bg)"'));
    const errors = lintColourLiterals(b.replace(/=/g, ': '), 'badge.svg');
    assert.equal(errors.length, 0);
  }
});

test('spiderex-render: renders shared Warmup fretboard with backing rect, frets, strings, and zero raw colours', () => {
  const svg = renderWarmupFretboardSvg(6);

  assert.ok(svg.includes('<rect width="100%" height="100%" fill="var(--pt-card-bg)" />'));
  assert.ok(svg.includes('Fret 1'));
  assert.ok(svg.includes('Fret 4'));
  assert.ok(svg.includes('var(--pt-muted-border)'));
  assert.ok(svg.includes('var(--pt-muted-color)'));

  // 6 string lines & tuning labels + fretboard badges 1..4
  assert.ok(svg.includes('data-finger="1"'));
  assert.ok(svg.includes('data-finger="2"'));
  assert.ok(svg.includes('data-finger="3"'));
  assert.ok(svg.includes('data-finger="4"'));

  const errors = lintColourLiterals(svg.replace(/=/g, ': '), 'warmup-fretboard.svg');
  assert.equal(errors.length, 0);
});

test('spiderex-render: renders isolated Warmup pattern sequence SVG with Play prefix and zero raw colours', () => {
  const pattern = [1, 3, 2, 4] as const;
  const svg = renderWarmupPatternSvg(pattern);

  assert.ok(svg.includes('<rect width="100%" height="100%" fill="var(--pt-card-bg)" />'));
  assert.ok(svg.includes('Play:'));
  assert.ok(svg.includes('data-finger="1"'));
  assert.ok(svg.includes('data-finger="3"'));
  assert.ok(svg.includes('data-finger="2"'));
  assert.ok(svg.includes('data-finger="4"'));

  const errors = lintColourLiterals(svg.replace(/=/g, ': '), 'warmup-pattern.svg');
  assert.equal(errors.length, 0);

  // Warmup cards grid
  const warmupDrill = {
    patterns: [
      [1, 2, 3, 4],
      [2, 1, 3, 4],
      [3, 1, 2, 4],
      [4, 1, 2, 3],
    ] as [[1, 2, 3, 4], [2, 1, 3, 4], [3, 1, 2, 4], [4, 1, 2, 3]],
  };
  const cardsHtml = renderWarmupCards(warmupDrill, 6);
  assert.ok(cardsHtml.includes('Pattern 1'));
  assert.ok(cardsHtml.includes('Pattern 4'));
  assert.ok(cardsHtml.includes('warmup-pattern-svg'));
});

test('spiderex-render: renders Twister systems with backing rect, 16 notes per row, and 0.0000 CLS fixed geometry', () => {
  const params = parseSpiderexParams({ date: '2026-01-01', variant: 1, strings: 6, skip: false });
  const drill = generateSpiderexDrill(params);
  const systemsHtml = renderTwisterSystems(drill);

  // Single system test
  const singleSystem = renderTwisterSystemSvg(drill.twister.bars.slice(0, 4), 0, 6);
  assert.ok(singleSystem.includes('data-system="0"'));

  // 4 systems
  assert.ok(systemsHtml.includes('data-system="0"'));
  assert.ok(systemsHtml.includes('data-system="1"'));
  assert.ok(systemsHtml.includes('data-system="2"'));
  assert.ok(systemsHtml.includes('data-system="3"'));

  // Each system has fixed viewBox="0 0 800 180" and backing rect
  const systemMatches = systemsHtml.match(/viewBox="0 0 800 180"/g);
  assert.equal(systemMatches?.length, 4);

  const rectMatches = systemsHtml.match(/<rect width="100%" height="100%" fill="var\(--pt-bg\)" \/>/g);
  assert.equal(rectMatches?.length, 4);

  // Zero raw color errors
  const errors = lintColourLiterals(systemsHtml.replace(/=/g, ': '), 'twister-systems.svg');
  assert.equal(errors.length, 0);
});
