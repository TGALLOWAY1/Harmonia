/**
 * Sensory roughness of a voicing (Plomp & Levelt, parameterised by Sethares).
 *
 * The corpus-fitted voice-leading model in Harrison & Pearce (2020) weights
 * roughness above every other feature — 23 times the weight on voice-leading
 * distance — and Harmonia's voicer optimised almost exclusively for the
 * latter. This term is what lets the search hear that a close-position chord
 * low on the keyboard is muddy and the same chord an octave up is not,
 * rather than relying on a hard spacing rule at one register boundary.
 *
 * For two partials at f1, f2 with amplitudes a1, a2:
 *
 *   d = a1·a2·(exp(−b1·s·|f2−f1|) − exp(−b2·s·|f2−f1|)),  s = x⋆ / (s1·fmin + s2)
 *
 * with b1 = 3.5, b2 = 5.75, x⋆ = 0.24, s1 = 0.0207, s2 = 18.96 — the scaling
 * the assessment's research pass dropped. A voicing's roughness sums this over
 * every pair of partials of every pair of notes.
 */

const B1 = 3.5;
const B2 = 5.75;
const X_STAR = 0.24;
const S1 = 0.0207;
const S2 = 18.96;

/** Number of harmonics modelled per note and their amplitude roll-off. */
const PARTIALS = 6;
const ROLL_OFF = 0.88;

/**
 * Normalises a single partial pair so its maximum roughness is 1.0; the raw
 * curve peaks at about 0.181.
 */
const PEAK = 1 / 0.1809;

const frequencyOf = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Roughness of one pair of partials. */
export function partialRoughness(f1: number, f2: number, a1 = 1, a2 = 1): number {
  const fmin = Math.min(f1, f2);
  const df = Math.abs(f2 - f1);
  const s = X_STAR / (S1 * fmin + S2);
  return a1 * a2 * (Math.exp(-B1 * s * df) - Math.exp(-B2 * s * df)) * PEAK;
}

const cache = new Map<string, number>();

/** Roughness of a voicing, memoised by its notes. */
export function voicingRoughness(midi: number[]): number {
  const key = midi.join(",");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const spectra = midi.map((note) => {
    const base = frequencyOf(note);
    return Array.from({ length: PARTIALS }, (_, k) => ({
      f: base * (k + 1),
      a: Math.pow(ROLL_OFF, k),
    }));
  });

  let total = 0;
  for (let i = 0; i < spectra.length; i++) {
    for (let j = i + 1; j < spectra.length; j++) {
      for (const p of spectra[i]) {
        for (const q of spectra[j]) {
          total += partialRoughness(p.f, q.f, p.a, q.a);
        }
      }
    }
  }

  cache.set(key, total);
  return total;
}
