export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import {
  buildTriadFromRoot,
  buildSeventhFromRoot,
  formatChordSymbol,
  pitchClassesToMidi,
  type PitchClass,
  type ChordQuality,
} from "@/lib/theory";

type ChordQualityParam = "maj" | "min" | "maj7" | "min7" | "dom7" | "dim" | "aug";

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

const VALID_CHORD_QUALITIES: ChordQualityParam[] = [
  "maj",
  "min",
  "maj7",
  "min7",
  "dom7",
  "dim",
  "aug",
];

// Default octave for MIDI mapping (same as scale endpoint)
const DEFAULT_OCTAVE = 3;

type ChordResponse = {
  symbol: string;
  root: string;
  quality: string;
  notes: string[];
  degrees: string[];
  midiNotes: number[];
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rootParam = url.searchParams.get("root");
    const qualityParam = url.searchParams.get("quality");

    // Validate root parameter
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

    // Validate quality parameter
    if (!qualityParam) {
      return NextResponse.json(
        { error: "Missing required parameter: quality" },
        { status: 400 }
      );
    }

    if (!VALID_CHORD_QUALITIES.includes(qualityParam as ChordQualityParam)) {
      return NextResponse.json(
        {
          error: `Invalid quality: "${qualityParam}". Must be one of: ${VALID_CHORD_QUALITIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const root = rootParam as PitchClass;
    const quality = qualityParam as ChordQualityParam;

    // Build chord based on quality
    let pitchClasses: PitchClass[];
    let degrees: string[];

    if (quality === "maj7" || quality === "min7" || quality === "dom7") {
      // Seventh chord
      const seventh = buildSeventhFromRoot(root, quality);
      pitchClasses = seventh.pitchClasses;
      degrees = ["1", "3", "5", "7"];
    } else {
      // Triad
      const triad = buildTriadFromRoot(root, quality);
      pitchClasses = triad.pitchClasses;
      degrees = ["1", "3", "5"];
    }

    // Format chord symbol
    const symbol = formatChordSymbol(root, quality as ChordQuality);

    // Map to MIDI notes
    const midiNotes = pitchClassesToMidi(pitchClasses, DEFAULT_OCTAVE);

    const response: ChordResponse = {
      symbol,
      root,
      quality,
      notes: pitchClasses,
      degrees,
      midiNotes,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error computing chord:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
