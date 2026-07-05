"use client";

/**
 * MpeToolbar — a compact, icon-first expression toolbar that sits above the
 * piano roll while the MPE Editor mode is active. Its available actions adapt to
 * the current note/chord selection so a musician can express an idea in seconds.
 */

import React, { useState } from "react";
import clsx from "clsx";
import {
  MousePointer2,
  Link2,
  Spline,
  Activity,
  ChevronsDown,
  ChevronsUp,
  RotateCcw,
  MoreHorizontal,
  Copy,
  ClipboardPaste,
  Trash2,
  FlipHorizontal2,
  Maximize2,
  Minimize2,
  Clock,
} from "lucide-react";
import {
  GLIDE_PRESET_LABELS,
  DEFAULT_DROP,
  DEFAULT_SCOOP,
  DEFAULT_VIBRATO,
  type GlidePreset,
  type PitchDropOptions,
  type PitchScoopOptions,
  type VibratoOptions,
} from "@/lib/expression/presets";

export type MpeSelectionKind =
  | "none"
  | "one-note"
  | "multi-notes"
  | "two-notes"
  | "two-chords"
  | "two-chords-unequal";

export interface MpeToolbarProps {
  selectionKind: MpeSelectionKind;
  selectionCount: number;
  hasExpression: boolean;
  canPaste: boolean;
  onGlide: (preset: GlidePreset) => void;
  onPitchDrop: (opts: PitchDropOptions) => void;
  onScoop: (opts: PitchScoopOptions) => void;
  onVibrato: (opts: VibratoOptions) => void;
  onJoin: () => void;
  onReset: () => void;
  onReverse: () => void;
  onScaleAmount: (factor: number) => void;
  onScaleDuration: (factor: number) => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

type OpenPanel = "glide" | "drop" | "scoop" | "vibrato" | "more" | null;

function ToolButton({
  icon,
  label,
  active,
  disabled,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      className={clsx(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors shrink-0",
        active
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-border-subtle bg-surface text-muted hover:border-accent/50 hover:text-accent",
        disabled && "opacity-40 cursor-not-allowed hover:border-border-subtle hover:text-muted"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-foreground">
          {value}
          {suffix ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-accent"
      />
    </label>
  );
}

function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute left-0 top-full mt-1 z-30 w-56 rounded-xl border border-border-subtle bg-surface p-3 shadow-lg">
      {children}
    </div>
  );
}

export function MpeToolbar(props: MpeToolbarProps) {
  const { selectionKind, selectionCount, hasExpression, canPaste } = props;
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [drop, setDrop] = useState<PitchDropOptions>(DEFAULT_DROP);
  const [scoop, setScoop] = useState<PitchScoopOptions>(DEFAULT_SCOOP);
  const [vib, setVib] = useState<VibratoOptions>(DEFAULT_VIBRATO);

  const toggle = (p: OpenPanel) => setPanel((cur) => (cur === p ? null : p));

  // Which single-note gestures are available. Any live selection of notes can
  // receive glide/drop/scoop/vibrato (applied to each selected note).
  const hasNotes = selectionCount > 0;
  const canJoin = selectionKind === "two-notes" || selectionKind === "two-chords";

  const hint = (() => {
    if (selectionKind === "none") return "Select a note or chord to add expression";
    if (selectionKind === "two-chords-unequal")
      return "Auto voice pairing needs two equal-sized chords";
    if (selectionKind === "two-chords") return "Join pairs notes by pitch order";
    if (selectionKind === "two-notes") return "Join creates an editable pitch bend";
    return null;
  })();

  return (
    <div className="mpe-toolbar mb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Select — the resting tool; shows the current selection count. */}
        <ToolButton
          icon={<MousePointer2 className="w-3.5 h-3.5" />}
          label={selectionCount > 0 ? `Select (${selectionCount})` : "Select"}
          active
          title="Click notes or chord headers to select"
        />

        {/* Join — only when the selection is joinable. */}
        <ToolButton
          icon={<Link2 className="w-3.5 h-3.5" />}
          label="Join"
          disabled={!canJoin}
          onClick={props.onJoin}
          title={
            canJoin
              ? "Create a pitch bend between the selection"
              : "Select two notes, or two equal-sized chords, to join"
          }
        />

        {/* Glide shape presets */}
        <div className="relative">
          <ToolButton
            icon={<Spline className="w-3.5 h-3.5" />}
            label="Glide"
            active={panel === "glide"}
            disabled={!hasNotes}
            onClick={() => toggle("glide")}
          />
          {panel === "glide" && (
            <Popover>
              <p className="text-[11px] font-semibold text-foreground mb-1.5">Glide shape</p>
              <div className="flex flex-col gap-1">
                {(Object.keys(GLIDE_PRESET_LABELS) as GlidePreset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      props.onGlide(p);
                      setPanel(null);
                    }}
                    className="text-left text-xs px-2 py-1.5 rounded-md text-muted hover:bg-surface-muted hover:text-accent transition-colors"
                  >
                    {GLIDE_PRESET_LABELS[p]}
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        {/* Vibrato */}
        <div className="relative">
          <ToolButton
            icon={<Activity className="w-3.5 h-3.5" />}
            label="Vibrato"
            active={panel === "vibrato"}
            disabled={!hasNotes}
            onClick={() => toggle("vibrato")}
          />
          {panel === "vibrato" && (
            <Popover>
              <p className="text-[11px] font-semibold text-foreground mb-2">Vibrato</p>
              <div className="flex flex-col gap-2.5">
                <Slider label="Depth" value={vib.depth} min={0.1} max={2} step={0.1} suffix=" st"
                  onChange={(v) => setVib({ ...vib, depth: v })} />
                <Slider label="Speed" value={vib.cycles} min={1} max={12} step={1} suffix=" cyc"
                  onChange={(v) => setVib({ ...vib, cycles: v })} />
                <Slider label="Fade in" value={vib.fadeIn} min={0} max={1} step={0.05}
                  onChange={(v) => setVib({ ...vib, fadeIn: v })} />
                <Slider label="Fade out" value={vib.fadeOut} min={0} max={1} step={0.05}
                  onChange={(v) => setVib({ ...vib, fadeOut: v })} />
                <Slider label="Region start" value={vib.region[0]} min={0} max={1} step={0.05}
                  onChange={(v) => setVib({ ...vib, region: [v, vib.region[1]] })} />
                <button
                  type="button"
                  onClick={() => {
                    props.onVibrato(vib);
                    setPanel(null);
                  }}
                  className="mt-1 w-full text-xs font-medium px-2 py-1.5 rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                >
                  Apply vibrato
                </button>
              </div>
            </Popover>
          )}
        </div>

        {/* Pitch Drop */}
        <div className="relative">
          <ToolButton
            icon={<ChevronsDown className="w-3.5 h-3.5" />}
            label="Drop"
            active={panel === "drop"}
            disabled={!hasNotes}
            onClick={() => toggle("drop")}
          />
          {panel === "drop" && (
            <Popover>
              <p className="text-[11px] font-semibold text-foreground mb-2">Pitch drop</p>
              <div className="flex flex-col gap-2.5">
                <Slider label="Amount" value={drop.amount} min={1} max={24} step={1} suffix=" st"
                  onChange={(v) => setDrop({ ...drop, amount: v })} />
                <Slider label="Duration" value={drop.duration} min={0.05} max={1} step={0.05}
                  onChange={(v) => setDrop({ ...drop, duration: v })} />
                <div className="flex gap-1">
                  {(["start", "end"] as const).map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setDrop({ ...drop, position: pos })}
                      className={clsx(
                        "flex-1 text-[11px] px-2 py-1 rounded-md border capitalize transition-colors",
                        drop.position === pos
                          ? "border-accent/50 bg-accent/10 text-accent"
                          : "border-border-subtle text-muted hover:text-accent"
                      )}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {(["smooth", "linear"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDrop({ ...drop, curve: c })}
                      className={clsx(
                        "flex-1 text-[11px] px-2 py-1 rounded-md border capitalize transition-colors",
                        drop.curve === c
                          ? "border-accent/50 bg-accent/10 text-accent"
                          : "border-border-subtle text-muted hover:text-accent"
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    props.onPitchDrop(drop);
                    setPanel(null);
                  }}
                  className="mt-1 w-full text-xs font-medium px-2 py-1.5 rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                >
                  Apply drop
                </button>
              </div>
            </Popover>
          )}
        </div>

        {/* Pitch Scoop */}
        <div className="relative">
          <ToolButton
            icon={<ChevronsUp className="w-3.5 h-3.5" />}
            label="Scoop"
            active={panel === "scoop"}
            disabled={!hasNotes}
            onClick={() => toggle("scoop")}
          />
          {panel === "scoop" && (
            <Popover>
              <p className="text-[11px] font-semibold text-foreground mb-2">Pitch scoop</p>
              <div className="flex flex-col gap-2.5">
                <Slider label="Amount" value={scoop.amount} min={1} max={12} step={1} suffix=" st"
                  onChange={(v) => setScoop({ ...scoop, amount: v })} />
                <Slider label="Duration" value={scoop.duration} min={0.05} max={1} step={0.05}
                  onChange={(v) => setScoop({ ...scoop, duration: v })} />
                <button
                  type="button"
                  onClick={() => {
                    props.onScoop(scoop);
                    setPanel(null);
                  }}
                  className="mt-1 w-full text-xs font-medium px-2 py-1.5 rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                >
                  Apply scoop
                </button>
              </div>
            </Popover>
          )}
        </div>

        {/* Reset */}
        <ToolButton
          icon={<RotateCcw className="w-3.5 h-3.5" />}
          label="Reset"
          disabled={!hasExpression}
          onClick={props.onReset}
          title="Remove expression from the selection"
        />

        {/* More… */}
        <div className="relative">
          <ToolButton
            icon={<MoreHorizontal className="w-3.5 h-3.5" />}
            label="More"
            active={panel === "more"}
            onClick={() => toggle("more")}
          />
          {panel === "more" && (
            <Popover>
              <div className="flex flex-col gap-0.5">
                <MoreItem icon={<Copy className="w-3.5 h-3.5" />} label="Copy expression"
                  disabled={!hasExpression} onClick={() => { props.onCopy(); setPanel(null); }} />
                <MoreItem icon={<ClipboardPaste className="w-3.5 h-3.5" />} label="Paste expression"
                  disabled={!canPaste || !hasNotes} onClick={() => { props.onPaste(); setPanel(null); }} />
                <MoreItem icon={<Copy className="w-3.5 h-3.5" />} label="Duplicate to selection"
                  disabled={!hasExpression || selectionCount < 2} onClick={() => { props.onDuplicate(); setPanel(null); }} />
                <div className="my-1 border-t border-border-subtle" />
                <MoreItem icon={<FlipHorizontal2 className="w-3.5 h-3.5" />} label="Reverse curve"
                  disabled={!hasExpression} onClick={() => { props.onReverse(); setPanel(null); }} />
                <MoreItem icon={<Maximize2 className="w-3.5 h-3.5" />} label="Scale amount +"
                  disabled={!hasExpression} onClick={() => props.onScaleAmount(1.25)} />
                <MoreItem icon={<Minimize2 className="w-3.5 h-3.5" />} label="Scale amount −"
                  disabled={!hasExpression} onClick={() => props.onScaleAmount(0.8)} />
                <MoreItem icon={<Clock className="w-3.5 h-3.5" />} label="Scale duration +"
                  disabled={!hasExpression} onClick={() => props.onScaleDuration(1.25)} />
                <MoreItem icon={<Clock className="w-3.5 h-3.5" />} label="Scale duration −"
                  disabled={!hasExpression} onClick={() => props.onScaleDuration(0.8)} />
                <div className="my-1 border-t border-border-subtle" />
                <MoreItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Remove expression" danger
                  disabled={!hasExpression} onClick={() => { props.onRemove(); setPanel(null); }} />
              </div>
            </Popover>
          )}
        </div>
      </div>

      {hint && <p className="mt-1.5 text-[11px] text-muted/80">{hint}</p>}
    </div>
  );
}

function MoreItem({
  icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded-md transition-colors",
        danger ? "text-rose-400 hover:bg-rose-500/10" : "text-muted hover:bg-surface-muted hover:text-accent",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
