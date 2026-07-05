"use client";

/**
 * ExpressionOverlay — draws editable pitch-bend curves directly on top of the
 * piano roll, aligned to the note grid.
 *
 * The overlay is a single absolutely-positioned SVG that scrolls with the roll
 * content. Curves are always drawn read-only when expression exists (so the roll
 * communicates pitch movement even in normal mode); draggable control handles
 * appear only in MPE mode for the currently selected notes. When no expression
 * exists the SVG renders nothing and the roll looks identical to before.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Chord } from "@/lib/theory/progressionTypes";
import type { ExpressionSegment } from "@/lib/expression/types";
import { buildSvgPath, clamp, insertPointAt, removePointAt, sortPoints, type PixelPoint } from "@/lib/expression/curve";

export interface ColumnGeom {
  left: number;
  width: number;
}

export interface RollGeom {
  columns: ColumnGeom[];
  cellsTop: number;
  rowHeight: number;
  contentWidth: number;
  contentHeight: number;
}

export interface SelectedNoteRef {
  chordIndex: number;
  midi: number;
}

interface ExpressionOverlayProps {
  chords: Chord[];
  noteRange: number[];
  geom: RollGeom | null;
  mpeMode: boolean;
  /** Notes whose control handles should be shown/editable. */
  selection: SelectedNoteRef[];
  /** Scroll container used to convert client coords → content coords during drag. */
  containerRef: React.RefObject<HTMLDivElement>;
  onUpdateSegment: (
    chordIndex: number,
    midi: number,
    segId: string,
    patch: Partial<Pick<ExpressionSegment, "points" | "smooth">>
  ) => void;
}

interface DragState {
  chordIndex: number;
  midi: number;
  segId: string;
  pointIndex: number;
  isEndpoint: boolean;
}

/** A curve resolved to pixel space for one segment of one note. */
interface ResolvedCurve {
  chordIndex: number;
  midi: number;
  seg: ExpressionSegment;
  pixels: PixelPoint[];
  centerY: number;
  colLeft: number;
  colWidth: number;
}

const SEMI_LIMIT = 24; // clamp handle drags to ±2 octaves

export function ExpressionOverlay({
  chords,
  noteRange,
  geom,
  mpeMode,
  selection,
  containerRef,
  onUpdateSegment,
}: ExpressionOverlayProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const selectedKey = useCallback(
    (chordIndex: number, midi: number) =>
      selection.some((s) => s.chordIndex === chordIndex && s.midi === midi),
    [selection]
  );

  // Resolve every stored segment into pixel space. Segments whose note no longer
  // exists in the chord are skipped, so stale keys never draw.
  const curves: ResolvedCurve[] = [];
  if (geom) {
    chords.forEach((chord, chordIndex) => {
      const expr = chord.expressions;
      const col = geom.columns[chordIndex];
      if (!expr || !col) return;
      const midiSet = new Set(chord.midiNotes ?? []);
      for (const midiKey of Object.keys(expr)) {
        const midi = Number(midiKey);
        if (!midiSet.has(midi)) continue;
        const rowIndex = noteRange.indexOf(midi);
        if (rowIndex === -1) continue;
        const centerY = geom.cellsTop + rowIndex * geom.rowHeight + geom.rowHeight / 2;
        for (const seg of expr[midi]) {
          const pts = sortPoints(seg.points);
          const pixels = pts.map((p) => ({
            x: col.left + p.t * col.width,
            y: centerY - p.y * geom.rowHeight,
          }));
          curves.push({ chordIndex, midi, seg, pixels, centerY, colLeft: col.left, colWidth: col.width });
        }
      }
    });
  }

  // ─── Drag handling ───

  const clientToLocal = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      return {
        x: clientX - rect.left + container.scrollLeft,
        y: clientY - rect.top + container.scrollTop,
      };
    },
    [containerRef]
  );

  useEffect(() => {
    if (!drag || !geom) return;

    const handleMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;
      const col = geom.columns[d.chordIndex];
      if (!col) return;

      const chord = chords[d.chordIndex];
      const seg = chord.expressions?.[d.midi]?.find((s) => s.id === d.segId);
      if (!seg) return;

      const rowIndex = noteRange.indexOf(d.midi);
      const centerY = geom.cellsTop + rowIndex * geom.rowHeight + geom.rowHeight / 2;

      const points = sortPoints(seg.points);
      const newY = clamp((centerY - local.y) / geom.rowHeight, -SEMI_LIMIT, SEMI_LIMIT);
      let newT = clamp((local.x - col.left) / Math.max(col.width, 1), 0, 1);

      const next = points.map((p, i) => {
        if (i !== d.pointIndex) return p;
        // Endpoints keep their t pinned to 0 / 1; only their pitch moves. Middle
        // points move freely but stay ordered between their neighbours.
        if (d.isEndpoint) {
          return { t: p.t, y: newY };
        }
        const lo = points[i - 1] ? points[i - 1].t + 0.001 : 0;
        const hi = points[i + 1] ? points[i + 1].t - 0.001 : 1;
        newT = clamp(newT, lo, hi);
        return { t: newT, y: newY };
      });

      onUpdateSegment(d.chordIndex, d.midi, d.segId, { points: sortPoints(next) });
    };

    const handleUp = () => setDrag(null);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [drag, geom, chords, noteRange, clientToLocal, onUpdateSegment]);

  const startDrag = useCallback(
    (e: React.PointerEvent, c: ResolvedCurve, pointIndex: number) => {
      if (!mpeMode) return;
      e.preventDefault();
      e.stopPropagation();
      const isEndpoint = pointIndex === 0 || pointIndex === c.pixels.length - 1;
      setDrag({ chordIndex: c.chordIndex, midi: c.midi, segId: c.seg.id, pointIndex, isEndpoint });
    },
    [mpeMode]
  );

  // Double-click a handle to delete it (endpoints are protected inside removePointAt).
  const deletePoint = useCallback(
    (c: ResolvedCurve, pointIndex: number) => {
      if (!mpeMode) return;
      const next = removePointAt(sortPoints(c.seg.points), pointIndex);
      onUpdateSegment(c.chordIndex, c.midi, c.seg.id, { points: next });
    },
    [mpeMode, onUpdateSegment]
  );

  // Double-click the curve line to insert a control point where you clicked.
  const insertPoint = useCallback(
    (e: React.MouseEvent, c: ResolvedCurve) => {
      if (!mpeMode) return;
      e.stopPropagation();
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;
      const t = clamp((local.x - c.colLeft) / Math.max(c.colWidth, 1), 0, 1);
      const next = insertPointAt(sortPoints(c.seg.points), t);
      onUpdateSegment(c.chordIndex, c.midi, c.seg.id, { points: next });
    },
    [mpeMode, clientToLocal, onUpdateSegment]
  );

  if (!geom) return null;

  return (
    <svg
      className="expression-overlay"
      width={geom.contentWidth}
      height={geom.contentHeight}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 6 }}
    >
      {curves.map((c) => {
        const editable = mpeMode && selectedKey(c.chordIndex, c.midi);
        const path = buildSvgPath(c.pixels, c.seg.smooth);
        const startPx = c.pixels[0];
        const endPx = c.pixels[c.pixels.length - 1];
        return (
          <g key={`${c.chordIndex}-${c.midi}-${c.seg.id}`}>
            {/* Base pitch guide (thin dotted line at the note's centre) */}
            {editable && (
              <line
                x1={c.colLeft}
                y1={c.centerY}
                x2={c.colLeft + c.colWidth}
                y2={c.centerY}
                className="expr-baseline"
              />
            )}

            {/* Wide invisible hit-path for inserting points (MPE only) */}
            {editable && (
              <path
                d={path}
                className="expr-hit"
                style={{ pointerEvents: "stroke" }}
                onDoubleClick={(e) => insertPoint(e, c)}
              />
            )}

            {/* The visible curve */}
            <path d={path} className={editable ? "expr-curve editable" : "expr-curve"} />

            {/* Start/end anchor dots (always visible so the gesture reads clearly) */}
            <circle cx={startPx.x} cy={startPx.y} r={editable ? 3 : 2} className="expr-anchor" />
            <circle cx={endPx.x} cy={endPx.y} r={editable ? 3 : 2} className="expr-anchor" />

            {/* Draggable handles (MPE + selected only) */}
            {editable &&
              c.pixels.map((px, i) => (
                <circle
                  key={i}
                  cx={px.x}
                  cy={px.y}
                  r={5.5}
                  className={
                    i === 0 || i === c.pixels.length - 1
                      ? "expr-handle endpoint"
                      : "expr-handle"
                  }
                  style={{ pointerEvents: "all", cursor: "grab" }}
                  onPointerDown={(e) => startDrag(e, c, i)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    deletePoint(c, i);
                  }}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}
