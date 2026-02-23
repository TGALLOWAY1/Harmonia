export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import {
  getMajorScale,
  getNaturalMinorScale,
  getDorianScale,
  getMixolydianScale,
  getPhrygianScale,
  mapScaleToMidi,
  type PitchClass,
} from "@/lib/theory";

type ScaleType = "major" | "natural_minor" | "dorian" | "mixolydian" | "phrygian";

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

// Default octave for MIDI mapping (same as PianoRollDemo)
const DEFAULT_OCTAVE = 3;

type ScaleResponse = {
  root: string;
  type: string;
  notes: string[];
  intervals: string[];
  midiNotes: number[];
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rootParam = url.searchParams.get("root");
    const typeParam = url.searchParams.get("type");

    // Validate root parameter
    if (!rootParam) {
      return NextResponse.json(
        { error: "Missing required parameter: root" },
        { status: 400 }
      );
    }

    if (!VALID_PITCH_CLASSES.includes(rootParam as PitchClass)) {
      return NextResponse.json(
        { error: `Invalid root: "${rootParam}". Must be one of: ${VALID_PITCH_CLASSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate type parameter
    if (!typeParam) {
      return NextResponse.json(
        { error: "Missing required parameter: type" },
        { status: 400 }
      );
    }

    if (!VALID_SCALE_TYPES.includes(typeParam as ScaleType)) {
      return NextResponse.json(
        { error: `Invalid type: "${typeParam}". Must be one of: ${VALID_SCALE_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const root = rootParam as PitchClass;
    const type = typeParam as ScaleType;

    // Get scale definition based on type
    let scale;
    switch (type) {
      case "major":
        scale = getMajorScale(root);
        break;
      case "natural_minor":
        scale = getNaturalMinorScale(root);
        break;
      case "dorian":
        scale = getDorianScale(root);
        break;
      case "mixolydian":
        scale = getMixolydianScale(root);
        break;
      case "phrygian":
        scale = getPhrygianScale(root);
        break;
      default:
        return NextResponse.json(
          { error: `Unsupported scale type: ${type}` },
          { status: 400 }
        );
    }

    // Map scale to MIDI notes
    const mapped = mapScaleToMidi(scale, DEFAULT_OCTAVE);

    // Generate interval labels (simple 1-7 for now, as per API spec)
    const intervals = ["1", "2", "3", "4", "5", "6", "7"];

    const response: ScaleResponse = {
      root: scale.root,
      type: scale.type,
      notes: scale.pitchClasses,
      intervals,
      midiNotes: mapped.midiNotes,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error computing scale:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
