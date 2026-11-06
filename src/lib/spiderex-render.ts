import type {
  Finger,
  Permutation,
  StringCount,
  TwisterBar,
  WarmupDrill,
  SpiderexDrill,
} from './spiderex.ts';
import { TUNINGS } from './spiderex.ts';

/**
 * Pure SVG rendering engine for Spiderex fretboard boxes, badges, and twister systems.
 * Adheres strictly to picotol tokens with zero raw color literals.
 */

export interface BadgeRenderOptions {
  radius?: number;
  fontSize?: number;
}

/**
 * Renders an accessible, contrast-hardened SVG geometric status badge for fingers 1..4.
 * - Finger 1: Circle shape, stroke var(--pt-status-info-border), text var(--pt-status-info-fg)
 * - Finger 2: Rounded square, stroke var(--pt-status-ok-border), text var(--pt-status-ok-fg)
 * - Finger 3: Diamond shape, stroke var(--pt-status-warning-border), text var(--pt-status-warning-fg)
 * - Finger 4: Hexagon shape, stroke var(--pt-status-critical-border), text var(--pt-status-critical-fg)
 * All badges use opaque fill="var(--pt-card-bg)" surfaces.
 */
export function renderFingerBadgeSvg(
  finger: Finger,
  cx: number,
  cy: number,
  options?: BadgeRenderOptions
): string {
  const r = options?.radius ?? 10;
  const fontSize = options?.fontSize ?? Math.round(r * 1.15);

  switch (finger) {
    case 1:
      return `<g class="finger-badge finger-1" data-finger="1">
  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="var(--pt-card-bg)" stroke="var(--pt-status-info-border)" stroke-width="2" />
  <text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="var(--pt-status-info-fg)" font-size="${fontSize}" font-weight="bold" font-family="var(--pt-font-mono)">1</text>
</g>`;

    case 2:
      return `<g class="finger-badge finger-2" data-finger="2">
  <rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" rx="3" ry="3" fill="var(--pt-card-bg)" stroke="var(--pt-status-ok-border)" stroke-width="2" />
  <text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="var(--pt-status-ok-fg)" font-size="${fontSize}" font-weight="bold" font-family="var(--pt-font-mono)">2</text>
</g>`;

    case 3: {
      const top = (cy - r * 1.18).toFixed(1);
      const right = (cx + r * 1.18).toFixed(1);
      const bottom = (cy + r * 1.18).toFixed(1);
      const left = (cx - r * 1.18).toFixed(1);
      const cxStr = cx.toFixed(1);
      const cyStr = cy.toFixed(1);
      return `<g class="finger-badge finger-3" data-finger="3">
  <polygon points="${cxStr},${top} ${right},${cyStr} ${cxStr},${bottom} ${left},${cyStr}" fill="var(--pt-card-bg)" stroke="var(--pt-status-warning-border)" stroke-width="2" stroke-linejoin="round" />
  <text x="${cxStr}" y="${cyStr}" text-anchor="middle" dominant-baseline="central" fill="var(--pt-status-warning-fg)" font-size="${fontSize}" font-weight="bold" font-family="var(--pt-font-mono)">3</text>
</g>`;
    }

    case 4: {
      const top = (cy - r * 1.12).toFixed(1);
      const bottom = (cy + r * 1.12).toFixed(1);
      const cxStr = cx.toFixed(1);
      const cyStr = cy.toFixed(1);
      const rX = r * 0.95;
      const rYHalf = r * 0.56;
      const xRight = (cx + rX).toFixed(1);
      const xLeft = (cx - rX).toFixed(1);
      const yTopHalf = (cy - rYHalf).toFixed(1);
      const yBottomHalf = (cy + rYHalf).toFixed(1);
      return `<g class="finger-badge finger-4" data-finger="4">
  <polygon points="${cxStr},${top} ${xRight},${yTopHalf} ${xRight},${yBottomHalf} ${cxStr},${bottom} ${xLeft},${yBottomHalf} ${xLeft},${yTopHalf}" fill="var(--pt-card-bg)" stroke="var(--pt-status-critical-border)" stroke-width="2" stroke-linejoin="round" />
  <text x="${cxStr}" y="${cyStr}" text-anchor="middle" dominant-baseline="central" fill="var(--pt-status-critical-fg)" font-size="${fontSize}" font-weight="bold" font-family="var(--pt-font-mono)">4</text>
</g>`;
    }
  }
}

/**
 * Computes Y coordinate of a string line given strings count and box bounds.
 */
function getStringY(stringIndex: number, totalStrings: StringCount, topY: number, bottomY: number): number {
  if (totalStrings <= 1) return (topY + bottomY) / 2;
  return topY + stringIndex * ((bottomY - topY) / (totalStrings - 1));
}

/**
 * Renders the shared 4-fret SVG fretboard diagram for Warmup exercises:
 * Displays tuning labels, frets 1-4, and finger badges 1-4 on the fretboard.
 * ViewBox: 0 0 280 148
 */
export function renderWarmupFretboardSvg(strings: StringCount): string {
  const tuning = TUNINGS[strings];
  const topY = 28;
  const bottomY = 118;
  const nutX = 38;
  const fretXs = [92, 146, 200, 254];
  const fretCenters = [65, 119, 173, 227];

  // String lines & tuning labels
  const stringElements: string[] = [];
  for (let s = 0; s < strings; s++) {
    const y = getStringY(s, strings, topY, bottomY);
    stringElements.push(
      `<line x1="${nutX}" y1="${y.toFixed(1)}" x2="${fretXs[3]}" y2="${y.toFixed(1)}" stroke="var(--pt-muted-border)" stroke-width="1" />`,
      `<text x="18" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="var(--pt-muted-color)" font-size="11" font-weight="bold" font-family="var(--pt-font-mono)">${tuning[s]}</text>`
    );
  }

  // Fret vertical lines
  const fretLines: string[] = [
    `<line x1="${nutX}" y1="${topY}" x2="${nutX}" y2="${bottomY}" stroke="var(--pt-muted-border)" stroke-width="3" />`,
  ];
  for (let i = 0; i < 4; i++) {
    const fx = fretXs[i]!;
    fretLines.push(
      `<line x1="${fx}" y1="${topY}" x2="${fx}" y2="${bottomY}" stroke="var(--pt-muted-border)" stroke-width="1.5" />`,
      `<text x="${fretCenters[i]}" y="132" text-anchor="middle" dominant-baseline="central" fill="var(--pt-muted-color)" font-size="11" font-family="var(--pt-font-mono)">Fret ${i + 1}</text>`
    );
  }

  // Place the 4 finger badges at frets 1..4 on mid-height of neck
  const fretboardBadges: string[] = [];
  for (let f = 1; f <= 4; f++) {
    const fretIdx = f - 1;
    const cx = fretCenters[fretIdx]!;
    const cy = (topY + bottomY) / 2;
    fretboardBadges.push(renderFingerBadgeSvg(f as Finger, cx, cy, { radius: 9.5 }));
  }

  return `<svg class="warmup-fretboard-svg" viewBox="0 0 280 148" width="100%" height="auto" role="img" aria-label="4-fret fretboard diagram: frets 1 to 4 with fingers 1 to 4">
  <rect width="100%" height="100%" fill="var(--pt-card-bg)" />
  ${stringElements.join('\n  ')}
  ${fretLines.join('\n  ')}
  ${fretboardBadges.join('\n  ')}
</svg>`;
}

/**
 * Renders an isolated execution sequence diagram:
 * Shows 'Play:' followed by the 4 finger badges in execution order.
 * ViewBox: 0 0 210 44
 */
export function renderWarmupPatternSvg(pattern: Permutation): string {
  const sequenceElements: string[] = [
    `<text x="24" y="22" text-anchor="middle" dominant-baseline="central" fill="var(--pt-muted-color)" font-size="11" font-weight="bold" font-family="var(--pt-font-mono)">Play:</text>`,
  ];
  const seqXs = [66, 104, 142, 180];
  for (let step = 0; step < 4; step++) {
    const finger = pattern[step]!;
    sequenceElements.push(
      renderFingerBadgeSvg(finger, seqXs[step]!, 22, { radius: 10, fontSize: 11 })
    );
  }

  return `<svg class="warmup-pattern-svg" viewBox="0 0 210 44" width="100%" height="auto" role="img" aria-label="Play sequence: ${pattern.join('-')}">
  <rect width="100%" height="100%" fill="var(--pt-card-bg)" />
  ${sequenceElements.join('\n  ')}
</svg>`;
}

/**
 * Renders all 4 compact Warmup pattern cards for the responsive grid.
 */
export function renderWarmupCards(warmup: WarmupDrill, _strings?: StringCount): string {
  const cards: string[] = [];

  for (let i = 0; i < 4; i++) {
    const pattern = warmup.patterns[i]!;
    const patternLabel = pattern.join('-');
    const patternSvg = renderWarmupPatternSvg(pattern);

    cards.push(`<article class="pt-card warmup-card" data-pattern-index="${i}">
  <header class="warmup-card-header">
    <h4 class="warmup-card-title">Pattern ${i + 1}</h4>
    <code class="warmup-pattern-code pt-tabular-nums">${patternLabel}</code>
  </header>
  <div class="warmup-svg-wrap">
    ${patternSvg}
  </div>
</article>`);
  }

  return cards.join('\n');
}

/**
 * Renders a single Twister system (1 row of 4 bars, 16 notes).
 * ViewBox: 0 0 800 180 (Fixed geometry across all string counts for 0.0000 CLS)
 */
export function renderTwisterSystemSvg(
  bars: TwisterBar[],
  systemIndex: number,
  strings: StringCount
): string {
  const tuning = TUNINGS[strings];
  const topY = 40;
  const bottomY = 150;
  const nutX = 45;
  const systemWidth = 740;
  const barWidth = systemWidth / 4; // 185px
  const endX = nutX + systemWidth; // 785px

  // Badge radius proportional to string spacing
  const radius = strings === 4 ? 10.5 : strings === 6 ? 9.5 : 8.5;

  // Left tuning labels & horizontal string lines
  const stringElements: string[] = [];
  for (let s = 0; s < strings; s++) {
    const y = getStringY(s, strings, topY, bottomY);
    stringElements.push(
      `<line x1="${nutX}" y1="${y.toFixed(1)}" x2="${endX}" y2="${y.toFixed(1)}" stroke="var(--pt-muted-border)" stroke-width="1" />`,
      `<text x="20" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="var(--pt-muted-color)" font-size="12" font-weight="bold" font-family="var(--pt-font-mono)">${tuning[s]}</text>`
    );
  }

  // Vertical bar dividers and bar labels
  const barDividers: string[] = [
    `<line x1="${nutX}" y1="${topY - 4}" x2="${nutX}" y2="${bottomY + 4}" stroke="var(--pt-muted-border)" stroke-width="2" />`,
  ];

  const noteElements: string[] = [];

  for (let b = 0; b < 4; b++) {
    const bar = bars[b];
    const barStartX = nutX + b * barWidth;
    const barEndX = barStartX + barWidth;
    const barNum = systemIndex * 4 + b + 1;

    // Bar boundary divider
    barDividers.push(
      `<line x1="${barEndX}" y1="${topY - 4}" x2="${barEndX}" y2="${bottomY + 4}" stroke="var(--pt-muted-border)" stroke-width="${b === 3 ? '2' : '1.5'}" />`,
      `<text x="${barStartX + 8}" y="20" text-anchor="start" dominant-baseline="central" fill="var(--pt-muted-color)" font-size="11" font-family="var(--pt-font-mono)">Bar ${barNum}</text>`
    );

    if (bar) {
      // 4 notes per bar
      for (let n = 0; n < 4; n++) {
        const note = bar.notes[n]!;
        const noteX = barStartX + 23.125 + n * 46.25;
        const noteY = getStringY(note.stringIndex, strings, topY, bottomY);

        noteElements.push(
          renderFingerBadgeSvg(note.finger, noteX, noteY, { radius })
        );
      }
    }
  }

  return `<svg class="twister-system" data-system="${systemIndex}" viewBox="0 0 800 180" width="100%" height="auto" role="img" aria-label="Twister System ${systemIndex + 1} (Bars ${systemIndex * 4 + 1} to ${systemIndex * 4 + 4})">
  <rect width="100%" height="100%" fill="var(--pt-bg)" />
  ${stringElements.join('\n  ')}
  ${barDividers.join('\n  ')}
  ${noteElements.join('\n  ')}
</svg>`;
}

/**
 * Renders all 4 Twister systems (16 bars total) for the drill.
 */
export function renderTwisterSystems(drill: SpiderexDrill): string {
  const { twister, params } = drill;
  const systems: string[] = [];

  for (let sysIdx = 0; sysIdx < 4; sysIdx++) {
    const startBar = sysIdx * 4;
    const endBar = startBar + 4;
    const systemBars = twister.bars.slice(startBar, endBar);

    systems.push(renderTwisterSystemSvg(systemBars, sysIdx, params.strings));
  }

  return systems.join('\n');
}
