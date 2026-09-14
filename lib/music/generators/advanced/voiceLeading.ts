export type VoiceLeadingSelection = {
  voicing: number[];
  cost: number;
};

// ---------------------------------------------------------------------------
// Voice assignment — greedy nearest-match (preserves voice identity)
// ---------------------------------------------------------------------------

/**
 * Pair each voice in `next` to the nearest unmatched voice in `prev`
 * using greedy nearest-match. Returns array of [prevIdx, nextIdx] pairs.
 */
function assignVoices(prev: number[], next: number[]): [number, number][] {
  const prevSorted = prev.map((v, i) => ({ midi: v, idx: i })).sort((a, b) => a.midi - b.midi);
  const nextSorted = next.map((v, i) => ({ midi: v, idx: i })).sort((a, b) => a.midi - b.midi);

  const overlap = Math.min(prevSorted.length, nextSorted.length);
  const usedPrev = new Set<number>();
  const usedNext = new Set<number>();
  const pairs: [number, number][] = [];

  // Build all possible pairings with their distances
  const allPairs: { prevIdx: number; nextIdx: number; dist: number }[] = [];
  for (let pi = 0; pi < prevSorted.length; pi++) {
    for (let ni = 0; ni < nextSorted.length; ni++) {
      allPairs.push({
        prevIdx: pi,
        nextIdx: ni,
        dist: Math.abs(prevSorted[pi].midi - nextSorted[ni].midi),
      });
    }
  }

  // Sort by distance, pick greedily
  allPairs.sort((a, b) => a.dist - b.dist);

  for (const pair of allPairs) {
    if (pairs.length >= overlap) break;
    if (usedPrev.has(pair.prevIdx) || usedNext.has(pair.nextIdx)) continue;
    usedPrev.add(pair.prevIdx);
    usedNext.add(pair.nextIdx);
    pairs.push([prevSorted[pair.prevIdx].idx, nextSorted[pair.nextIdx].idx]);
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Voice-crossing detection
// ---------------------------------------------------------------------------

/**
 * Count voice crossings: when voice A was above voice B in prev,
 * but voice A is below voice B in next (or vice versa).
 */
function countVoiceCrossings(prev: number[], next: number[], pairs: [number, number][]): number {
  let crossings = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [prevI, nextI] = pairs[i];
      const [prevJ, nextJ] = pairs[j];
      const prevOrder = prev[prevI] - prev[prevJ];
      const nextOrder = next[nextI] - next[nextJ];
      if ((prevOrder > 0 && nextOrder < 0) || (prevOrder < 0 && nextOrder > 0)) {
        crossings++;
      }
    }
  }
  return crossings;
}

// ---------------------------------------------------------------------------
// Parallel perfect interval detection
// ---------------------------------------------------------------------------

/**
 * Detect parallel perfect fifths and octaves between two voicings.
 * Returns { parallelFifths, parallelOctaves }.
 */
function detectParallelPerfects(
  prev: number[],
  next: number[],
  pairs: [number, number][]
): { parallelFifths: number; parallelOctaves: number } {
  let parallelFifths = 0;
  let parallelOctaves = 0;

  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [prevI, nextI] = pairs[i];
      const [prevJ, nextJ] = pairs[j];

      const prevInterval = Math.abs(prev[prevI] - prev[prevJ]) % 12;
      const nextInterval = Math.abs(next[nextI] - next[nextJ]) % 12;

      // Both voices moved (not static) and interval is preserved
      const prevIMoved = prev[prevI] !== next[nextI];
      const prevJMoved = prev[prevJ] !== next[nextJ];

      if (prevIMoved && prevJMoved) {
        if (prevInterval === 7 && nextInterval === 7) parallelFifths++;
        if (prevInterval === 0 && nextInterval === 0 && prev[prevI] !== prev[prevJ]) parallelOctaves++;
      }
    }
  }

  return { parallelFifths, parallelOctaves };
}

// ---------------------------------------------------------------------------
// Common-tone detection
// ---------------------------------------------------------------------------

function countCommonTones(prev: number[], next: number[], pairs: [number, number][]): number {
  let count = 0;
  for (const [prevIdx, nextIdx] of pairs) {
    if (prev[prevIdx] === next[nextIdx]) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Bass motion scoring
// ---------------------------------------------------------------------------

function scoreBassMotion(prevBass: number, nextBass: number): number {
  const delta = Math.abs(prevBass - nextBass) % 12;

  if (delta === 0) return 1;      // static — slightly boring
  if (delta <= 2) return -3;      // stepwise — excellent
  if (delta === 5 || delta === 7) return -3; // P4/P5 — strong harmonic motion
  if (delta === 6) return 5;      // tritone — jarring
  if (delta === 3 || delta === 4) return 1;  // 3rd-based — acceptable
  if (delta >= 8 && delta <= 9) return 2;    // large — disjunct
  return 0;                       // near-step in other direction
}

// ---------------------------------------------------------------------------
// Span penalty
// ---------------------------------------------------------------------------

function spanPenalty(voicing: number[]): number {
  if (voicing.length < 2) return 0;
  const span = voicing[voicing.length - 1] - voicing[0];
  // Penalize spans over 28 semitones (about 2.3 octaves)
  return span > 28 ? (span - 28) * 0.5 : 0;
}

// ---------------------------------------------------------------------------
// Main cost function
// ---------------------------------------------------------------------------

export function calculateVoiceLeadingCost(previous: number[], next: number[]): number {
  if (previous.length === 0 || next.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const pairs = assignVoices(previous, next);

  // 1. Voice-leading smoothness (25% weight)
  let voiceLeadingCost = 0;
  for (const [prevIdx, nextIdx] of pairs) {
    const delta = Math.abs(previous[prevIdx] - next[nextIdx]);
    if (delta === 0) voiceLeadingCost += 0;
    else if (delta <= 2) voiceLeadingCost += 1;
    else if (delta <= 4) voiceLeadingCost += delta;
    else if (delta <= 7) voiceLeadingCost += delta * 1.3;
    else voiceLeadingCost += delta * 2.0;
  }

  // 2. Bass motion quality (20% weight)
  const prevBass = Math.min(...previous);
  const nextBass = Math.min(...next);
  const bassScore = scoreBassMotion(prevBass, nextBass);

  // 3. Common-tone retention (15% weight) — reward
  const commonTones = countCommonTones(previous, next, pairs);
  const commonToneReward = commonTones * 2;

  // 4. Parallel perfect intervals (5% weight) — hard penalty
  const { parallelFifths, parallelOctaves } = detectParallelPerfects(previous, next, pairs);
  const parallelPenalty = parallelFifths * 6 + parallelOctaves * 8;

  // 5. Voice crossing (5% weight) — hard penalty
  const crossings = countVoiceCrossings(previous, next, pairs);
  const crossingPenalty = crossings * 8;

  // 6. Span penalty
  const span = spanPenalty(next);

  // 7. Contrary motion bonus — reward bass and soprano moving in opposite directions
  let contraryMotionBonus = 0;
  const prevSoprano = Math.max(...previous);
  const nextSoprano = Math.max(...next);
  const bassDirection = nextBass - prevBass;
  const sopranoDirection = nextSoprano - prevSoprano;
  if (bassDirection !== 0 && sopranoDirection !== 0 && Math.sign(bassDirection) !== Math.sign(sopranoDirection)) {
    contraryMotionBonus = -2;
  }

  // Extra voices penalty (different voice counts)
  const extraVoices = Math.abs(previous.length - next.length) * 2;

  // Composite score (lower is better)
  const total =
    voiceLeadingCost * 0.25 +
    bassScore * 0.20 +
    (4 - commonToneReward) * 0.15 + // inverted: fewer common tones = higher cost
    parallelPenalty * 0.05 +
    crossingPenalty * 0.05 +
    span * 0.10 +
    contraryMotionBonus +
    extraVoices;

  return total;
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

export type VoicingPreference = {
  /**
   * Reward candidates whose lowest note is the chord root. Structural arrivals
   * — the opening chord and the final cadence — need the root in the bass to
   * sound settled; without this the pure minimum-motion argmin routinely ends a
   * progression on a second-inversion tonic, which never lands.
   */
  preferRootPosition?: boolean;
  /** Pitch class (0-11) of the chord root, required by `preferRootPosition`. */
  rootPitchClass?: number;
  /**
   * Seeded source used to choose between voicings whose costs are effectively
   * equal. The voicing stage had no randomness at all, so a given chord got the
   * same shape in over 90% of generations; a strict argmin is far more
   * confident than the cost differences justify. Omit for pure argmin.
   */
  rng?: () => number;
};

/**
 * Cost difference below which two voicings count as equally good.
 *
 * Calibrated against this cost function's scale: the terms are weighted so a
 * whole extra step of voice motion is worth ~0.25, so half that is comfortably
 * inside the noise floor of "which of these sounds better".
 */
const COST_TIE_BAND = 0.5;

/** Pick among candidates whose cost ties the best, or the sole best if none. */
function resolveTies(
  entries: { voicing: number[]; cost: number }[],
  rng: (() => number) | undefined
): { voicing: number[]; cost: number } {
  let bestCost = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    if (entry.cost < bestCost) bestCost = entry.cost;
  }

  const tied = entries.filter((entry) => entry.cost <= bestCost + COST_TIE_BAND);
  if (tied.length === 0) return entries[0];
  if (!rng || tied.length === 1) return tied[0];

  const pick = Math.floor(rng() * tied.length);
  return tied[Math.min(pick, tied.length - 1)];
}

/** How strongly a root-position bass is favoured at a structural arrival. */
const ROOT_POSITION_BONUS = 6;

function rootPositionBonus(candidate: number[], preference?: VoicingPreference): number {
  if (!preference?.preferRootPosition) return 0;
  if (preference.rootPitchClass === undefined) return 0;
  const bass = Math.min(...candidate);
  return ((bass % 12) + 12) % 12 === preference.rootPitchClass ? -ROOT_POSITION_BONUS : 0;
}

export function pickBestVoiceLedCandidate(
  previous: number[] | null,
  candidates: number[][],
  fallbackCenter: number,
  preference?: VoicingPreference
): VoiceLeadingSelection {
  if (candidates.length === 0) {
    return {
      voicing: [fallbackCenter],
      cost: Number.POSITIVE_INFINITY,
    };
  }

  if (!previous) {
    const entries = candidates.map((candidate) => {
      const center = (candidate[0] + candidate[candidate.length - 1]) / 2;
      return {
        voicing: candidate,
        cost:
          Math.abs(center - fallbackCenter) + spanPenalty(candidate) + rootPositionBonus(candidate, preference),
      };
    });
    return resolveTies(entries, preference?.rng);
  }

  const entries = candidates.map((candidate) => ({
    voicing: candidate,
    cost: calculateVoiceLeadingCost(previous, candidate) + rootPositionBonus(candidate, preference),
  }));

  return resolveTies(entries, preference?.rng);
}
