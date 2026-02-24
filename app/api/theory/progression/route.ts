export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { generateRandomProgression } from "@/lib/progressionRandom";
import type { PitchClass, ScaleType } from "@/lib/theory";

const VALID_PITCH_CLASSES: PitchClass[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const VALID_SCALE_TYPES: ScaleType[] = [
  "major",
  "natural_minor",
  "dorian",
  "mixolydian",
  "phrygian",
];

type ProgressionResponse = {
  root: string;
  scaleType: string;
  chords: Array<{
    degree: string;
    symbol: string;
    quality: string;
    notes: string[];
    notesWithOctave: string[];
  }>;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rootParam = url.searchParams.get("root");
    const scaleTypeParam = url.searchParams.get("scaleType");

    if (!rootParam) {
      return NextResponse.json(
        { error: "Missing required parameter: root" },
        { status: 400 }
      );
    }

    if (!VALID_PITCH_CLASSES.includes(rootParam as PitchClass)) {
      return NextResponse.json(
        {
          error: `Invalid root: "${rootParam}". Must be one of: ${VALID_PITCH_CLASSES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (!scaleTypeParam) {
      return NextResponse.json(
        { error: "Missing required parameter: scaleType" },
        { status: 400 }
      );
    }

    if (!VALID_SCALE_TYPES.includes(scaleTypeParam as ScaleType)) {
      return NextResponse.json(
        {
          error: `Invalid scaleType: "${scaleTypeParam}". Must be one of: ${VALID_SCALE_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const root = rootParam as PitchClass;
    const scaleType = scaleTypeParam as ScaleType;

    const chords = generateRandomProgression(root, scaleType);

    const response: ProgressionResponse = {
      root,
      scaleType,
      chords: chords.map((c) => ({
        degree: c.degree,
        symbol: c.symbol,
        quality: c.quality,
        notes: c.notes,
        notesWithOctave: c.notesWithOctave,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error generating progression:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
