/**
 * Seeded RNG utilities for melody generation.
 *
 * All melody stages draw from a mulberry32 stream so that a fixed seed
 * reproduces the exact same melody. `deriveSeed` spawns independent,
 * deterministic sub-streams (one per candidate melody) from a base seed.
 */

/** Simple seeded PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a deterministic sub-seed for candidate stream `stream`. */
export function deriveSeed(base: number, stream: number): number {
  return (base ^ Math.imul(stream + 1, 0x9e3779b9)) | 0;
}
