export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMetaForQuery } from "@/lib/cards/metaNormalization";

export async function GET(request: Request) {
  try {
    // Parse query parameters
    const url = new URL(request.url);
    const milestoneKey = url.searchParams.get("milestoneKey");
    const cardKind = url.searchParams.get("cardKind");
    const scaleType = url.searchParams.get("scaleType");
    const scaleRoot = url.searchParams.get("scaleRoot"); // Optional: specific key root
    const difficulty = url.searchParams.get("difficulty"); // "easy" | "all"

    // Chord-based card kinds that use scaleMemberships
    const CHORD_BASED_KINDS = ["notes_from_chord", "chord_from_notes"];

    // Build where clause
    const whereClause: any = {};
    if (milestoneKey) {
      whereClause.milestoneKey = milestoneKey;
    }
    if (cardKind) {
      whereClause.kind = cardKind;
    }

    // 1) Fetch all templates (optionally filtered)
    const templates = await prisma.cardTemplate.findMany({
      where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
    });

    // If milestoneKey was provided but no templates match, return 404
    if (milestoneKey && templates.length === 0) {
      return NextResponse.json(
        { error: "No cards found for this milestoneKey." },
        { status: 404 }
      );
    }

    if (templates.length === 0) {
      return NextResponse.json({ error: "No cards available" }, { status: 404 });
    }

    // 2) Filter by scale type/root if specified (requires checking meta field)
    let filteredTemplates = templates;
    if (scaleType || scaleRoot) {
      filteredTemplates = templates.filter((t) => {
        if (!t.meta || typeof t.meta !== "object") return false;
        const meta = t.meta as any;

        // For chord-based cards, check scaleMemberships
        if (CHORD_BASED_KINDS.includes(t.kind)) {
          if (!meta.scaleMemberships || !Array.isArray(meta.scaleMemberships)) {
            return false; // No scale memberships = doesn't match
          }

          // Check if any scaleMembership matches the filter criteria
          return meta.scaleMemberships.some((membership: any) => {
            const matchesType = !scaleType || membership.keyType === scaleType;
            const matchesRoot = !scaleRoot || membership.keyRoot === scaleRoot;
            return matchesType && matchesRoot;
          });
        } else {
          // For non-chord cards (e.g., scale_spelling), use normalized meta
          // (handles legacy root->keyRoot, type->keyType)
          const norm = normalizeMetaForQuery(meta, t.kind);
          if (scaleType && norm.keyType !== scaleType) {
            return false;
          }
          if (scaleRoot && norm.keyRoot !== scaleRoot) {
            return false;
          }
          return true;
        }
      });
    }

    if (filteredTemplates.length === 0) {
      return NextResponse.json(
        { error: "No cards match the selected filters." },
        { status: 404 }
      );
    }

    // 3) Ensure CardState exists for each filtered template
    const templateIds = filteredTemplates.map((t: { id: number }) => t.id);

    const existingStates = await prisma.cardState.findMany({
      where: { cardId: { in: templateIds } },
    });

    const existingMap = new Map(existingStates.map((s: { cardId: number }) => [s.cardId, s]));

    const missingTemplateIds = templateIds.filter((id: number) => !existingMap.has(id));

    if (missingTemplateIds.length > 0) {
      await prisma.cardState.createMany({
        data: missingTemplateIds.map((cardId: number) => ({ cardId })),
      });
    }

    // 4) Filter by difficulty if specified
    if (difficulty === "easy") {
      // Get states for these templates to filter by mastery
      const statesForDifficulty = await prisma.cardState.findMany({
        where: { cardId: { in: templateIds } },
      });
      const stateMap = new Map(statesForDifficulty.map((s) => [s.cardId, s]));

      // Filter to cards that are either:
      // - Not attempted yet (attemptsCount === 0)
      // - Have high accuracy (correctCount / attemptsCount >= 0.7) and attemptsCount >= 3
      filteredTemplates = filteredTemplates.filter((t) => {
        const state = stateMap.get(t.id);
        if (!state) return true; // Not attempted = easy
        if (state.attemptsCount === 0) return true;
        if (state.attemptsCount < 3) return false;
        const accuracy = state.correctCount / state.attemptsCount;
        return accuracy >= 0.7;
      });

      if (filteredTemplates.length === 0) {
        return NextResponse.json(
          { error: "No easy cards found. Try practicing more cards first!" },
          { status: 404 }
        );
      }
    }

    // 5) Re-fetch states (or update the map) since new ones may have been created
    // Order by dueAt ascending to prioritize earliest due dates
    const filteredTemplateIds = filteredTemplates.map((t) => t.id);
    const allStates = await prisma.cardState.findMany({
      where: { cardId: { in: filteredTemplateIds } },
      orderBy: [{ dueAt: "asc" }],
    });

    if (allStates.length === 0) {
      return NextResponse.json({ error: "No card state found" }, { status: 500 });
    }

    // 6) Partition cards: due cards (dueAt <= now) vs future cards
    const now = new Date();
    const dueCards = allStates.filter((s: { dueAt: Date | string }) => {
      const dueDate = s.dueAt instanceof Date ? s.dueAt : new Date(s.dueAt);
      return dueDate <= now;
    });

    let nextState: (typeof allStates)[0];

    if (dueCards.length > 0) {
      // If there are due cards, randomly select one to improve distribution
      const randomIndex = Math.floor(Math.random() * dueCards.length);
      nextState = dueCards[randomIndex];
    } else {
      // No due cards, find earliest future due date
      const firstDue = allStates[0].dueAt;
      const firstDueDate = firstDue instanceof Date ? firstDue : new Date(firstDue);
      const firstDueTime = firstDueDate.getTime();

      // Find all cards with the same earliest due date
      const futureWithSameDue = allStates.filter((s: { dueAt: Date | string }) => {
        const dueDate = s.dueAt instanceof Date ? s.dueAt : new Date(s.dueAt);
        return dueDate.getTime() === firstDueTime;
      });

      // Randomly select among cards with the same earliest due date
      const randomIndex = Math.floor(Math.random() * futureWithSameDue.length);
      nextState = futureWithSameDue[randomIndex];
    }

    if (!nextState) {
      return NextResponse.json({ error: "No card state found" }, { status: 500 });
    }

    const nextTemplate = filteredTemplates.find((t: { id: number }) => t.id === nextState.cardId);

    if (!nextTemplate) {
      return NextResponse.json({ error: "Card state mismatch" }, { status: 500 });
    }

    const responseBody = {
      card: {
        id: nextTemplate.id,
        slug: nextTemplate.slug,
        kind: nextTemplate.kind,
        question: nextTemplate.question,
        options: [
          nextTemplate.optionA,
          nextTemplate.optionB,
          nextTemplate.optionC,
          nextTemplate.optionD,
        ],
        correctIndex: nextTemplate.correctIndex,
        meta: nextTemplate.meta,
      },
      state: {
        id: nextState.id,
        attemptsCount: nextState.attemptsCount,
        correctCount: nextState.correctCount,
        lastResult: nextState.lastResult,
      },
    };

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Error fetching next card:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
