/**
 * Works Islands Manifest
 *
 * Tracks client-side islands and third-party origins permitted strictly within /works/** routes.
 * Outside of /works/**, the site enforces 0 client JS.
 */

export interface IslandOrigin {
  origin: string;
  reason: string;
}

export interface WorksIsland {
  route: string;
  reason: string;
  js: boolean;
  origins: IslandOrigin[];
}

export const worksIslands: WorksIsland[] = [
  {
    route: '/works/spiderex/',
    reason: 'Interactive guitar fretboard spider-exercise trainer',
    js: true,
    origins: [],
  },
];
