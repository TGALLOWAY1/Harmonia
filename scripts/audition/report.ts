/**
 * Audition report — markdown table + the pass/fail rules behind `--check`.
 *
 * Pure functions over `RenderResult[]`: no audio, no I/O, so the failure rules
 * are readable (and testable) on their own.
 */

import type { RenderResult } from "./specs";
import { VELOCITIES } from "./specs";

/** Tolerances: rendering is deterministic, these only absorb float noise. */
const RMS_TOLERANCE_DB = 0.2;
const CENTROID_TOLERANCE_RATIO = 0.985;
/** The longest tail a note may have before it smears the next chord. */
export const MAX_TAIL_SEC = 6;

function fmtDb(value: number): string {
  if (!Number.isFinite(value)) return value < 0 ? "−∞" : "∞";
  return value.toFixed(1);
}

function fmtHz(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toString();
}

function fmtTail(value: number): string {
  if (!Number.isFinite(value)) return ">render";
  return value.toFixed(2);
}

function flags(result: RenderResult): string {
  const out: string[] = [];
  if (result.error) out.push("ERROR");
  if (result.metrics.nan) out.push("NaN");
  if (result.metrics.silent) out.push("SILENT");
  if (result.metrics.clipping) out.push("CLIP");
  return out.length ? out.join(",") : "ok";
}

/** One markdown row per render, grouped by instrument then role. */
export function renderMarkdownTable(results: RenderResult[]): string {
  const lines: string[] = [];
  lines.push(
    "| Instrument | Role | Vel | Peak dBFS | RMS dBFS | Note RMS dBFS | Centroid Hz | Attack ms | Tail s | Flags |",
  );
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const r of results) {
    lines.push(
      `| ${r.label} | ${r.role} | ${r.velocity.toFixed(1)} | ${fmtDb(r.metrics.peakDb)} | ` +
        `${fmtDb(r.metrics.rmsDb)} | ${fmtDb(r.metrics.noteRmsDb)} | ${fmtHz(r.metrics.centroidHz)} | ` +
        `${r.metrics.attackMs.toFixed(1)} | ${fmtTail(r.metrics.tailS)} | ${flags(r)} |`,
    );
  }
  return lines.join("\n");
}

/**
 * Level-matching summary: how far each instrument sits from the pack at the
 * reference velocity. Gain staging is only "done" when this spread is small.
 */
export function renderBalanceTable(results: RenderResult[], velocity = 0.7): string {
  const rows = results.filter((r) => Math.abs(r.velocity - velocity) < 1e-6);
  if (rows.length === 0) return "";
  const byRole = new Map<string, RenderResult[]>();
  for (const row of rows) {
    const list = byRole.get(row.role) ?? [];
    list.push(row);
    byRole.set(row.role, list);
  }

  const lines: string[] = [];
  lines.push(`Gain staging at velocity ${velocity.toFixed(1)} (whole-note RMS dBFS):`);
  for (const [role, list] of byRole) {
    const levels = list
      .map((r) => ({ label: r.label, db: r.metrics.noteRmsDb }))
      .filter((entry) => Number.isFinite(entry.db));
    if (levels.length === 0) continue;
    const dbs = levels.map((entry) => entry.db);
    const min = Math.min(...dbs);
    const max = Math.max(...dbs);
    const mean = dbs.reduce((a, b) => a + b, 0) / dbs.length;
    const quietest = levels.find((entry) => entry.db === min)?.label ?? "";
    const loudest = levels.find((entry) => entry.db === max)?.label ?? "";
    lines.push(
      `  ${role}: mean ${mean.toFixed(1)} dB, spread ${(max - min).toFixed(1)} dB ` +
        `(${quietest} ${fmtDb(min)} … ${loudest} ${fmtDb(max)})`,
    );
  }
  return lines.join("\n");
}

/** A single reason the run should fail. */
export interface CheckFailure {
  instrumentId: string;
  role: string;
  reason: string;
}

/**
 * The rules `--check` enforces:
 * 1. nothing silent, NaN or clipping;
 * 2. no tail longer than {@link MAX_TAIL_SEC};
 * 3. for velocity-sensitive instruments, both loudness *and* brightness rise
 *    (never fall) with velocity — the whole point of the layered voices.
 */
export function checkResults(results: RenderResult[]): CheckFailure[] {
  const failures: CheckFailure[] = [];

  for (const r of results) {
    if (r.error) {
      failures.push({ instrumentId: r.instrumentId, role: r.role, reason: `render failed: ${r.error}` });
      continue;
    }
    if (r.metrics.nan) {
      failures.push({ instrumentId: r.instrumentId, role: r.role, reason: `NaN samples at velocity ${r.velocity}` });
    }
    if (r.metrics.silent) {
      failures.push({ instrumentId: r.instrumentId, role: r.role, reason: `silent at velocity ${r.velocity}` });
    }
    if (r.metrics.clipping) {
      failures.push({
        instrumentId: r.instrumentId,
        role: r.role,
        reason: `clipping at velocity ${r.velocity} (peak ${r.metrics.peakDb.toFixed(2)} dBFS)`,
      });
    }
    if (r.metrics.tailS > MAX_TAIL_SEC) {
      failures.push({
        instrumentId: r.instrumentId,
        role: r.role,
        reason: `tail ${fmtTail(r.metrics.tailS)}s exceeds ${MAX_TAIL_SEC}s at velocity ${r.velocity}`,
      });
    }
  }

  // Monotonicity is a per-(instrument, role) property across the velocity sweep.
  const groups = new Map<string, RenderResult[]>();
  for (const r of results) {
    const key = `${r.instrumentId}::${r.role}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  for (const list of groups.values()) {
    const first = list[0];
    if (!first?.velocitySensitive) continue;
    const ordered = [...list].sort((a, b) => a.velocity - b.velocity);
    if (ordered.length < VELOCITIES.length) continue;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const next = ordered[i];
      if (next.metrics.rmsDb < prev.metrics.rmsDb - RMS_TOLERANCE_DB) {
        failures.push({
          instrumentId: first.instrumentId,
          role: first.role,
          reason:
            `loudness falls with velocity: ${prev.velocity}→${next.velocity} ` +
            `(${fmtDb(prev.metrics.rmsDb)} → ${fmtDb(next.metrics.rmsDb)} dB)`,
        });
      }
      if (next.metrics.centroidHz < prev.metrics.centroidHz * CENTROID_TOLERANCE_RATIO) {
        failures.push({
          instrumentId: first.instrumentId,
          role: first.role,
          reason:
            `brightness falls with velocity: ${prev.velocity}→${next.velocity} ` +
            `(${fmtHz(prev.metrics.centroidHz)} → ${fmtHz(next.metrics.centroidHz)} Hz)`,
        });
      }
    }
  }

  return failures;
}
