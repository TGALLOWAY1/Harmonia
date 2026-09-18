/**
 * Metre on the half-beat grid.
 *
 * The engine assumes 4/4 from the progression's first beat. Each grid
 * position carries a metric weight from the GTTM hierarchy — the downbeat
 * strongest, beat 3 next, beats 2 and 4, then the off-beats — and the
 * Longuet-Higgins & Lee syncopation measure counts how often a note sounds on
 * a weak position and lets a stronger one pass in silence (or under a held
 * note). Both replace the old two-level "even beats are strong" test.
 */

export const GRID = 0.5;

/** Metric weight of an absolute beat position: 4 downbeat, 3 beat three, 2 beats two/four, 1 off-beat. */
export function metricWeight(beat: number): number {
  const inBar = ((beat % 4) + 4) % 4;
  if (inBar === 0) return 4;
  if (inBar === 2) return 3;
  if (Number.isInteger(inBar)) return 2;
  return 1;
}

/** Snap to the half-beat grid. */
export function snapToGrid(beats: number): number {
  return Math.round(beats / GRID) * GRID;
}

/**
 * Longuet-Higgins & Lee syncopation of an onset list: for every onset, the
 * strongest position it lets pass before the next onset (or the end) minus its
 * own weight, when positive. Zero for a march, about two per bar for pop.
 */
export function syncopationOf(onsets: number[], endBeat: number): number {
  let total = 0;
  const sorted = [...onsets].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = i + 1 < sorted.length ? sorted[i + 1] : endBeat;
    let strongest = 0;
    for (let p = a + GRID; p < b - 1e-9; p += GRID) strongest = Math.max(strongest, metricWeight(p));
    total += Math.max(0, strongest - metricWeight(a));
  }
  return total;
}
