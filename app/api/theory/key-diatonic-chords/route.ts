export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import {
  getDiatonicChords,
  formatChordSymbol,
  type PitchClass,
  type ScaleType,
  type ChordQuality,
} from "@/lib/theory";

type KeyType = "major" | "natural_minor";
type Extensions = "triads" | "sevenths";

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

const VALID_KEY_TYPES: KeyType[] = ["major", "natural_minor"];
const VALID_EXTENSIONS: Extensions[] = ["triads", "sevenths"];

type ChordResponseItem = {
  degree: string;
  symbol: string;
  quality: string;
  notes: string[];
};

type KeyDiatonicChordsResponse = {
  key: {
    root: string;
    type: string;
  };
  chords: ChordResponseItem[];
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rootParam = url.searchParams.get("root");
    const typeParam = url.searchParams.get("type");
    const extensionsParam = url.searchParams.get("extensions");

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

    // Validate type parameter
    if (!typeParam) {
      return NextResponse.json(
        { error: "Missing required parameter: type" },
        { status: 400 }
      );
    }

    if (!VALID_KEY_TYPES.includes(typeParam as KeyType)) {
      return NextResponse.json(
        {
          error: `Invalid type: "${typeParam}". Must be one of: ${VALID_KEY_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate extensions parameter
    if (!extensionsParam) {
      return NextResponse.json(
        { error: "Missing required parameter: extensions" },
        { status: 400 }
      );
    }

    if (!VALID_EXTENSIONS.includes(extensionsParam as Extensions)) {
      return NextResponse.json(
        {
          error: `Invalid extensions: "${extensionsParam}". Must be one of: ${VALID_EXTENSIONS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const root = rootParam as PitchClass;
    const keyType = typeParam as KeyType;
    const extensions = extensionsParam as Extensions;

    // Get diatonic chords from theory engine
    const diatonicSet = getDiatonicChords(root, keyType);

    // Map to response format based on extensions
    const chords: ChordResponseItem[] = [];

    if (extensions === "triads") {
      for (const diatonicTriad of diatonicSet.triads) {
        const symbol = formatChordSymbol(
          diatonicTriad.triad.root,
          diatonicTriad.triad.quality
        );
        chords.push({
          degree: diatonicTriad.degree,
          symbol,
          quality: diatonicTriad.triad.quality,
          notes: diatonicTriad.triad.pitchClasses,
        });
      }
    } else {
      // extensions === "sevenths"
      for (const diatonicSeventh of diatonicSet.sevenths) {
        // Map SeventhQuality to ChordQuality for formatChordSymbol
        const qualityMap: Record<string, ChordQuality> = {
          maj7: "maj7",
          min7: "min7",
          dom7: "dom7",
          "half-dim7": "min7", // Approximate as min7 for display
          dim7: "min7", // Approximate as min7 for display
        };
        const chordQuality = qualityMap[diatonicSeventh.seventh.quality] || "min7";
        const symbol = formatChordSymbol(
          diatonicSeventh.seventh.root,
          chordQuality
        );
        chords.push({
          degree: diatonicSeventh.degree,
          symbol,
          quality: diatonicSeventh.seventh.quality,
          notes: diatonicSeventh.seventh.pitchClasses,
        });
      }
    }

    const response: KeyDiatonicChordsResponse = {
      key: {
        root: diatonicSet.keyRoot,
        type: diatonicSet.keyType,
      },
      chords,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error computing diatonic chords:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
