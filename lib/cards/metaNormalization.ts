/**
 * Meta normalization for CardTemplate filtering.
 *
 * Canonical fields for filtering:
 * - keyType: "major" | "natural_minor" | "dorian" | "mixolydian" | "phrygian" (scale/key type)
 * - keyRoot: PitchClass (e.g. "C", "F#") - root of scale or key
 *
 * Legacy fallbacks:
 * - meta.type -> keyType (scale_spelling uses "type")
 * - meta.root -> keyRoot (scale_spelling uses "root")
 * - meta.keyType, meta.keyRoot already canonical (diatonic cards)
 */

export type NormalizedMetaForQuery = {
  keyType?: string;
  keyRoot?: string;
};

/**
 * Normalize meta for filter/query matching. Provides canonical keyType and keyRoot
 * with fallbacks from legacy keys (type->keyType, root->keyRoot).
 */
export function normalizeMetaForQuery(
  meta: unknown,
  kind: string
): NormalizedMetaForQuery {
  if (!meta || typeof meta !== "object") return {};

  const m = meta as Record<string, unknown>;
  const result: NormalizedMetaForQuery = {};

  // keyType: prefer keyType, fallback to type
  if (typeof m.keyType === "string") {
    result.keyType = m.keyType;
  } else if (typeof m.type === "string") {
    result.keyType = m.type;
  }

  // keyRoot: prefer keyRoot, fallback to root, then majorRoot (circle cards)
  if (typeof m.keyRoot === "string") {
    result.keyRoot = m.keyRoot;
  } else if (typeof m.root === "string") {
    result.keyRoot = m.root;
  } else if (typeof m.majorRoot === "string") {
    result.keyRoot = m.majorRoot;
  }

  return result;
}

/**
 * Normalize a template's meta for filtering. Returns the template with a
 * normalized meta view (does not mutate).
 */
export function normalizeTemplateMeta<T extends { meta: unknown; kind: string }>(
  template: T
): T & { _normalizedMeta: NormalizedMetaForQuery } {
  return {
    ...template,
    _normalizedMeta: normalizeMetaForQuery(template.meta, template.kind),
  };
}
