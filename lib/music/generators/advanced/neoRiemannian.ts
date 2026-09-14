/**
 * Neo-Riemannian transforms.
 *
 * Each transform maps a major or minor triad onto another by moving as few
 * voices as possible, and each *names which voice moves and by how much*.
 * That is what makes them useful here: they reach chords that are distant on
 * the circle of fifths (chromatic mediants, the hexatonic pole) while the
 * voice leading stays parsimonious by construction, with no search.
 *
 * Roots are pitch classes 0-11. Definitions follow music21's
 * `analysis.neoRiemannian` and Lehman, *Hollywood Harmony* ch. 3:
 *
 *   P  (parallel)        (r,maj) -> (r,min)     third moves 1     2 common tones
 *   L  (leittonwechsel)  (r,maj) -> (r+4,min)   root moves 1      2 common tones
 *   R  (relative)        (r,maj) -> (r+9,min)   fifth moves 2     2 common tones
 *   S  (slide) = LPR     (r,maj) -> (r+1,min)   root+fifth by 1   1 common tone
 *   N  (nebenverwandt)   (r,maj) -> (r+5,min)                     1 common tone
 *   H  (hexatonic pole)  (r,maj) -> (r+8,min)                     0 common tones
 *   LP                   (r,maj) -> (r+4,maj)   chromatic mediant
 *   PL                   (r,maj) -> (r+8,maj)   chromatic mediant
 *
 * P, L, R, S, N and H are involutions (applying one twice returns the
 * starting triad), so their minor cases are the inverses of the major ones.
 * LP and PL are inverses of *each other*: LP twice walks the major-third
 * cycle (C → E → G#), and PL walks it the other way.
 */

export type NeoRiemannianTransform = "P" | "L" | "R" | "S" | "N" | "H" | "LP" | "PL";

export type TriadClass = "maj" | "min";

export type NeoRiemannianTriad = {
  /** Root pitch class, 0-11. */
  root: number;
  quality: TriadClass;
};

export const TRANSFORMS: NeoRiemannianTransform[] = ["P", "L", "R", "S", "N", "H", "LP", "PL"];

/** Transforms that leave the diatonic set of the starting chord's key. */
export const CHROMATIC_TRANSFORMS: NeoRiemannianTransform[] = ["P", "S", "N", "H", "LP", "PL"];

export const TRANSFORM_INFO: Record<
  NeoRiemannianTransform,
  { name: string; commonTones: number; cost: number; motion: string }
> = {
  P: { name: "parallel", commonTones: 2, cost: 1, motion: "the third moves a semitone" },
  L: { name: "leittonwechsel", commonTones: 2, cost: 1, motion: "the root moves a semitone" },
  R: { name: "relative", commonTones: 2, cost: 2, motion: "the fifth moves a whole tone" },
  S: { name: "slide", commonTones: 1, cost: 2, motion: "root and fifth move a semitone" },
  N: { name: "nebenverwandt", commonTones: 1, cost: 2, motion: "two voices move a semitone" },
  H: { name: "hexatonic pole", commonTones: 0, cost: 3, motion: "every voice moves a semitone" },
  LP: { name: "chromatic mediant (LP)", commonTones: 1, cost: 2, motion: "two voices move" },
  PL: { name: "chromatic mediant (PL)", commonTones: 1, cost: 2, motion: "two voices move" },
};

/** Root shift and resulting quality for each transform, by starting quality. */
const SHIFT: Record<NeoRiemannianTransform, Record<TriadClass, [number, TriadClass]>> = {
  P: { maj: [0, "min"], min: [0, "maj"] },
  L: { maj: [4, "min"], min: [8, "maj"] },
  R: { maj: [9, "min"], min: [3, "maj"] },
  S: { maj: [1, "min"], min: [11, "maj"] },
  N: { maj: [5, "min"], min: [7, "maj"] },
  H: { maj: [8, "min"], min: [4, "maj"] },
  LP: { maj: [4, "maj"], min: [8, "min"] },
  PL: { maj: [8, "maj"], min: [4, "min"] },
};

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function applyTransform(
  triad: NeoRiemannianTriad,
  transform: NeoRiemannianTransform
): NeoRiemannianTriad {
  const [shift, quality] = SHIFT[transform][triad.quality];
  return { root: mod12(triad.root + shift), quality };
}

/** Pitch classes of a triad, root first. */
export function triadPitchClasses(triad: NeoRiemannianTriad): number[] {
  const third = triad.quality === "maj" ? 4 : 3;
  return [triad.root, mod12(triad.root + third), mod12(triad.root + 7)];
}

/** The single transform that maps `from` onto `to`, if one exists. */
export function transformBetween(
  from: NeoRiemannianTriad,
  to: NeoRiemannianTriad
): NeoRiemannianTransform | null {
  for (const transform of TRANSFORMS) {
    const result = applyTransform(from, transform);
    if (result.root === mod12(to.root) && result.quality === to.quality) return transform;
  }
  return null;
}

/** Number of pitch classes two triads share. */
export function commonTones(a: NeoRiemannianTriad, b: NeoRiemannianTriad): number {
  const set = new Set(triadPitchClasses(a));
  return triadPitchClasses(b).filter((pc) => set.has(pc)).length;
}

// ---------------------------------------------------------------------------
// Parsimonious voice leading
// ---------------------------------------------------------------------------

/**
 * Move each voice of `previous` as little as possible onto `targetPitchClasses`.
 *
 * Common tones are held. The remaining voices are assigned to the uncovered
 * chord tones by minimum total displacement (voices that are still left over
 * take the nearest chord tone, doubling it). This is the voice leading a
 * transform *names* — for P, L and R one voice moves by a step and the rest
 * hold — generalised so it also works for seventh chords and doubled voicings.
 *
 * Returns null when the result would not cover every target pitch class, land
 * two voices on one note, or leave the range.
 */
export function parsimoniousVoicing(
  previous: number[],
  targetPitchClasses: number[],
  range?: { low: number; high: number }
): number[] | null {
  if (previous.length === 0 || targetPitchClasses.length === 0) return null;
  const targets = Array.from(new Set(targetPitchClasses.map(mod12)));
  const voices = [...previous].sort((a, b) => a - b);

  const result: number[] = new Array(voices.length).fill(NaN);
  const covered = new Set<number>();
  const movers: number[] = [];

  voices.forEach((midi, index) => {
    if (targets.includes(mod12(midi))) {
      result[index] = midi;
      covered.add(mod12(midi));
    } else {
      movers.push(index);
    }
  });

  const uncovered = targets.filter((pc) => !covered.has(pc));

  // Nearest instance of a pitch class to a midi note, searching both directions.
  const nearest = (midi: number, pc: number): number => {
    const up = midi + mod12(pc - mod12(midi));
    const down = up - 12;
    return Math.abs(up - midi) <= Math.abs(down - midi) ? up : down;
  };

  // Assign movers to uncovered tones by minimum total displacement. The
  // counts are tiny (at most five voices), so try every assignment.
  const assign = (
    remainingMovers: number[],
    remainingTargets: number[]
  ): { cost: number; pairs: [number, number][] } => {
    if (remainingMovers.length === 0 || remainingTargets.length === 0) return { cost: 0, pairs: [] };
    let best: { cost: number; pairs: [number, number][] } | null = null;
    const [mover, ...rest] = remainingMovers;
    for (let t = 0; t < remainingTargets.length; t++) {
      const pc = remainingTargets[t];
      const target = nearest(voices[mover], pc);
      const sub = assign(rest, remainingTargets.filter((_, i) => i !== t));
      const cost = Math.abs(target - voices[mover]) + sub.cost;
      if (!best || cost < best.cost) best = { cost, pairs: [[mover, target], ...sub.pairs] };
    }
    // A mover can also stay unassigned when there are more movers than targets.
    if (remainingMovers.length > remainingTargets.length) {
      const skip = assign(rest, remainingTargets);
      if (!best || skip.cost < best.cost) best = skip;
    }
    return best ?? { cost: 0, pairs: [] };
  };

  const { pairs } = assign(movers, uncovered);
  for (const [index, midi] of pairs) result[index] = midi;

  // Leftover movers double the nearest chord tone.
  for (const index of movers) {
    if (!Number.isNaN(result[index])) continue;
    const midi = voices[index];
    let bestMidi = midi;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const pc of targets) {
      const candidate = nearest(midi, pc);
      const distance = Math.abs(candidate - midi);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMidi = candidate;
      }
    }
    result[index] = bestMidi;
  }

  const sorted = [...result].sort((a, b) => a - b);
  const reached = new Set(sorted.map(mod12));
  if (targets.some((pc) => !reached.has(pc))) return null;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) return null;
  }
  if (range && (sorted[0] < range.low || sorted[sorted.length - 1] > range.high)) return null;
  return sorted;
}
