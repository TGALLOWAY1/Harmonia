/**
 * Whole-progression voicing search.
 *
 * The voicer used to be greedy: each chord took the cheapest candidate given
 * only the chord before it, so an early choice could strand the rest of the
 * phrase (a soprano boxed into the top of the range, a bass with nowhere
 * stepwise to go). This is the Viterbi recurrence from Harrison & Pearce's
 * `voicer` —
 *
 *   C[t][s] = emit(s) + min over s' of (C[t-1][s'] + trans(s', s))
 *
 * — bounded to a beam so it costs about what the greedy pass did: candidates
 * are pruned to the best `maxCandidates` by their own emission cost, and only
 * the `beamWidth` best partial paths survive each step. Hard constraints are
 * expressed as `Infinity` and compose with the soft costs.
 *
 * Deterministic for a given input, so seeded reproducibility survives.
 */

export type VoicingSearchParams = {
  /** Candidate voicings per chord, ascending MIDI. */
  candidates: number[][][];
  /** Cost of a candidate on its own: register, planned bass, roughness, ... */
  emission: (index: number, voicing: number[]) => number;
  /** Cost of moving from one voicing to the next. */
  transition: (previous: number[], next: number[], index: number) => number;
  /**
   * Extra candidates that depend on the previous voicing — the parsimonious
   * voice leading of a Neo-Riemannian transform, say. Each is charged its
   * transition and emission like any other, less `bonus`.
   */
  dependentCandidates?: (index: number, previous: number[]) => { voicing: number[]; bonus: number }[];
  beamWidth?: number;
  maxCandidates?: number;
};

export type VoicingSearchResult = {
  voicings: number[][];
  /** Per chord: the emission cost for the first, the transition cost after. */
  costs: number[];
};

type Path = {
  voicing: number[];
  total: number;
  stepCost: number;
  back: Path | null;
};

const DEFAULT_BEAM = 6;
const DEFAULT_MAX_CANDIDATES = 24;

export function searchVoicings(params: VoicingSearchParams): VoicingSearchResult {
  const { candidates, emission, transition, dependentCandidates } = params;
  const beamWidth = Math.max(1, params.beamWidth ?? DEFAULT_BEAM);
  const maxCandidates = Math.max(1, params.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const n = candidates.length;
  if (n === 0) return { voicings: [], costs: [] };

  const prune = (index: number): { voicing: number[]; emit: number }[] => {
    const scored = candidates[index].map((voicing) => ({ voicing, emit: emission(index, voicing) }));
    scored.sort((a, b) => a.emit - b.emit);
    return scored.slice(0, maxCandidates);
  };

  let beam: Path[] = prune(0)
    .map((entry) => ({ voicing: entry.voicing, total: entry.emit, stepCost: entry.emit, back: null }))
    .sort((a, b) => a.total - b.total)
    .slice(0, beamWidth);

  if (beam.length === 0) return { voicings: [], costs: [] };

  for (let index = 1; index < n; index++) {
    const pruned = prune(index);
    const next = new Map<string, Path>();

    const consider = (voicing: number[], emit: number, previous: Path, bonus: number) => {
      const step = transition(previous.voicing, voicing, index) - bonus;
      const total = previous.total + step + emit;
      if (!Number.isFinite(total)) return;
      const key = voicing.join(",");
      const existing = next.get(key);
      if (!existing || total < existing.total) {
        next.set(key, { voicing, total, stepCost: step, back: previous });
      }
    };

    for (const entry of pruned) {
      for (const previous of beam) consider(entry.voicing, entry.emit, previous, 0);
    }

    if (dependentCandidates) {
      for (const previous of beam) {
        for (const extra of dependentCandidates(index, previous.voicing)) {
          consider(extra.voicing, emission(index, extra.voicing), previous, extra.bonus);
        }
      }
    }

    const ranked = [...next.values()].sort((a, b) => a.total - b.total);
    if (ranked.length === 0) {
      // Every transition was forbidden: fall back to the cheapest emission so
      // the progression still voices rather than stopping short.
      const fallback = pruned[0] ?? { voicing: candidates[index][0] ?? [], emit: 0 };
      const previous = beam[0];
      beam = [{ voicing: fallback.voicing, total: previous.total + fallback.emit, stepCost: fallback.emit, back: previous }];
      continue;
    }
    beam = ranked.slice(0, beamWidth);
  }

  const voicings: number[][] = [];
  const costs: number[] = [];
  let cursor: Path | null = beam[0];
  while (cursor) {
    voicings.unshift(cursor.voicing);
    costs.unshift(cursor.stepCost);
    cursor = cursor.back;
  }
  return { voicings, costs };
}
