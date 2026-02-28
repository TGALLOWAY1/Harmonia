/**
 * Shared seed logic for dev (destructive) and prod (non-destructive) modes.
 * seed.dev: wipes and reseeds.
 * seed.prod: upserts baseline content only; NEVER touches attempts/states.
 */

import { prisma } from "../lib/db";
import { STATIC_CARDS, getAllAdvancedCards, generateOptionsForSeed, generateSlug } from "../lib/cards/seedTemplates";
import { getDiatonicChords, buildTriadFromRoot, type TriadQuality } from "../lib/theory";
import type { PitchClass } from "../lib/theory/midiUtils";
import type { ScaleType } from "../lib/theory/types";
import type { CardTemplateSeed } from "../lib/cards/generators/advancedGenerators";
import type { ScaleMembership } from "../lib/cards/basicCardMeta";
import { generateChordCardTemplates } from "../lib/flashcards/chordCardGenerator";

export type SeedMode = "dev" | "prod";

const MILESTONES = [
  { key: "FOUNDATION", title: "Notes, intervals & major scale", description: "Learn natural notes, sharps/flats, whole/half steps, and how to build the major scale.", order: 1, isUnlocked: true, isCompleted: false, progress: 0 },
  { key: "NATURAL_MINOR", title: "Natural minor & relative keys", description: "Understand natural minor scales and how they relate to their relative majors.", order: 2, isUnlocked: false, isCompleted: false, progress: 0 },
  { key: "TRIADS", title: "Major & minor triads", description: "Build and recognize basic triads that show up constantly in EDM and bass music.", order: 3, isUnlocked: false, isCompleted: false, progress: 0 },
  { key: "DIATONIC_TRIADS", title: "Diatonic chords in a key", description: "Map the chords inside a key with Roman numerals, and see them on the piano roll.", order: 4, isUnlocked: false, isCompleted: false, progress: 0 },
  { key: "CIRCLE_OF_FIFTHS", title: "Circle of fifths", description: "Use the circle to navigate keys, find neighbors, and connect harmony visually.", order: 5, isUnlocked: false, isCompleted: false, progress: 0 },
  { key: "SEVENTH_CHORDS", title: "Seventh chords", description: "Add 7ths to your chords for richer harmonies and more expressive EDM progressions.", order: 6, isUnlocked: false, isCompleted: false, progress: 0 },
  { key: "MODES", title: "Useful modes for bass music", description: "Explore Dorian, Mixolydian and Phrygian, and how they color bass-heavy tracks.", order: 7, isUnlocked: false, isCompleted: false, progress: 0 },
  { key: "ADVANCED", title: "Advanced harmony", description: "Dim / aug chords, borrowed chords and secondary dominants (future expansion).", order: 8, isUnlocked: false, isCompleted: false, progress: 0 },
];

function identifyTriadFromNotes(notes: PitchClass[]): { root: PitchClass; quality: TriadQuality } | null {
  if (notes.length !== 3) return null;
  const allPitchClasses: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  for (const potentialRoot of notes) {
    try {
      for (const quality of ["maj", "min", "dim", "aug"] as TriadQuality[]) {
        const triad = buildTriadFromRoot(potentialRoot, quality);
        const triadNotes = new Set(triad.pitchClasses);
        const inputNotes = new Set(notes);
        if (triadNotes.size === inputNotes.size && [...triadNotes].every((n) => inputNotes.has(n as PitchClass))) {
          return { root: potentialRoot, quality };
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function notesMatch(notes1: PitchClass[], notes2: PitchClass[]): boolean {
  if (notes1.length !== notes2.length) return false;
  const set1 = new Set(notes1);
  const set2 = new Set(notes2);
  return set1.size === set2.size && [...set1].every((n) => set2.has(n));
}

async function attachScaleMemberships() {
  const chordCards = await prisma.cardTemplate.findMany({
    where: { kind: { in: ["notes_from_chord", "chord_from_notes"] } },
  });
  if (chordCards.length === 0) return;
  const allPitchClasses: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const keyTypes: Array<{ type: ScaleType }> = [{ type: "major" }, { type: "natural_minor" }];
  for (const card of chordCards) {
    if (!card.meta || typeof card.meta !== "object") continue;
    const meta = card.meta as Record<string, unknown>;
    let chordRoot: PitchClass | null = null;
    let chordQuality: TriadQuality | null = null;
    let chordNotes: PitchClass[] | null = null;
    if (card.kind === "notes_from_chord" && meta.root && meta.quality) {
      chordRoot = meta.root as PitchClass;
      chordQuality = meta.quality as TriadQuality;
      try {
        chordNotes = buildTriadFromRoot(chordRoot, chordQuality).pitchClasses;
      } catch {
        continue;
      }
    } else if (card.kind === "chord_from_notes" && meta.notes && Array.isArray(meta.notes)) {
      chordNotes = meta.notes as PitchClass[];
      const id = identifyTriadFromNotes(chordNotes);
      if (!id) continue;
      chordRoot = id.root;
      chordQuality = id.quality;
    } else continue;
    if (!chordRoot || !chordQuality || !chordNotes) continue;
    const scaleMemberships: ScaleMembership[] = [];
    for (const keyRoot of allPitchClasses) {
      for (const { type: keyType } of keyTypes) {
        try {
          const diatonicSet = getDiatonicChords(keyRoot, keyType);
          for (const { degree, triad } of diatonicSet.triads) {
            if (triad.root === chordRoot && triad.quality === chordQuality && notesMatch(triad.pitchClasses, chordNotes)) {
              scaleMemberships.push({ keyRoot, keyType: keyType === "major" ? "major" : "natural_minor", degree });
              break;
            }
          }
        } catch {
          continue;
        }
      }
    }
    if (scaleMemberships.length > 0) {
      await prisma.cardTemplate.update({
        where: { id: card.id },
        data: { meta: { ...meta, root: chordRoot, quality: chordQuality, notes: chordNotes, scaleMemberships } },
      });
    }
  }
  console.log(`Attached scale memberships to ${chordCards.length} chord-based cards`);
}

async function seedAdvancedCards(mode: SeedMode) {
  const allAdvancedCards = getAllAdvancedCards();
  let count = 0;
  for (let i = 0; i < allAdvancedCards.length; i++) {
    const { seed, milestoneKey } = allAdvancedCards[i];
    const options = generateOptionsForSeed(seed);
    const slug = generateSlug(seed, i);
    const data = {
      slug,
      kind: seed.kind,
      question: seed.prompt,
      optionA: options.optionA,
      optionB: options.optionB,
      optionC: options.optionC,
      optionD: options.optionD,
      correctIndex: options.correctIndex,
      meta: seed.meta as object,
      milestoneKey,
    };
    try {
      if (mode === "prod") {
        await prisma.cardTemplate.upsert({
          where: { slug },
          update: { ...data, updatedAt: new Date() },
          create: data,
        });
      } else {
        await prisma.cardTemplate.create({ data });
      }
      count++;
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code !== "P2002") console.error(`Error creating card ${slug}:`, e);
    }
  }
  console.log(`Seeded ${count} advanced flashcard cards`);
}

async function seedChordCards(mode: SeedMode) {
  const chordCards = generateChordCardTemplates();

  if (mode === "prod") {
    await prisma.cardTemplate.deleteMany({
      where: {
        slug: {
          startsWith: "chords-v1-",
        },
      },
    });
  }

  let count = 0;
  for (const card of chordCards) {
    if (mode === "prod") {
      await prisma.cardTemplate.upsert({
        where: { slug: card.slug as string },
        update: {
          kind: card.kind,
          question: card.question,
          optionA: card.optionA,
          optionB: card.optionB,
          optionC: card.optionC,
          optionD: card.optionD,
          correctIndex: card.correctIndex,
          meta: card.meta as object,
          milestoneKey: card.milestoneKey,
          updatedAt: new Date(),
        },
        create: {
          slug: card.slug as string,
          kind: card.kind,
          question: card.question,
          optionA: card.optionA,
          optionB: card.optionB,
          optionC: card.optionC,
          optionD: card.optionD,
          correctIndex: card.correctIndex,
          meta: card.meta as object,
          milestoneKey: card.milestoneKey,
        },
      });
    } else {
      await prisma.cardTemplate.create({ data: card });
    }
    count++;
  }

  console.log(`Seeded ${count} chord dataset cards (chords_v1)`);
}

export async function runSeed(mode: SeedMode) {
  if (mode === "dev") {
    await prisma.cardAttempt.deleteMany();
    await prisma.cardState.deleteMany();
    await prisma.cardTemplate.deleteMany();
    await prisma.milestone.deleteMany();
  }

  if (mode === "dev") {
    const cMajor = buildTriadFromRoot("C", "maj");
    for (const card of STATIC_CARDS) {
      const meta = card.meta as Record<string, unknown>;
      if (card.slug === "c-major-chord-notes") (meta as Record<string, unknown>).notes = cMajor.pitchClasses;
      if (card.slug === "which-chord-c-e-g") (meta as Record<string, unknown>).notes = cMajor.pitchClasses;
      await prisma.cardTemplate.create({
        data: {
          slug: card.slug,
          kind: card.kind,
          question: card.question,
          optionA: card.optionA,
          optionB: card.optionB,
          optionC: card.optionC,
          optionD: card.optionD,
          correctIndex: card.correctIndex,
          meta: meta as any,
          milestoneKey: card.milestoneKey,
        },
      });
    }
  } else {
    const cMajor = buildTriadFromRoot("C", "maj");
    for (const card of STATIC_CARDS) {
      const meta = { ...(card.meta as object) };
      if (card.slug === "c-major-chord-notes") (meta as Record<string, unknown>).notes = cMajor.pitchClasses;
      if (card.slug === "which-chord-c-e-g") (meta as Record<string, unknown>).notes = cMajor.pitchClasses;
      await prisma.cardTemplate.upsert({
        where: { slug: card.slug },
        update: {
          kind: card.kind,
          question: card.question,
          optionA: card.optionA,
          optionB: card.optionB,
          optionC: card.optionC,
          optionD: card.optionD,
          correctIndex: card.correctIndex,
          meta: meta as any,
          milestoneKey: card.milestoneKey,
        },
        create: {
          slug: card.slug,
          kind: card.kind,
          question: card.question,
          optionA: card.optionA,
          optionB: card.optionB,
          optionC: card.optionC,
          optionD: card.optionD,
          correctIndex: card.correctIndex,
          meta: meta as any,
          milestoneKey: card.milestoneKey,
        },
      });
    }
  }

  for (const m of MILESTONES) {
    await prisma.milestone.upsert({
      where: { key: m.key },
      update: {},
      create: m,
    });
  }

  await seedChordCards(mode);
  await seedAdvancedCards(mode);
  await attachScaleMemberships();
}
