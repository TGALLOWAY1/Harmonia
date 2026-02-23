export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    // Parse query parameters (same as /api/cards/next)
    const url = new URL(request.url);
    const milestoneKey = url.searchParams.get("milestoneKey");
    const cardKind = url.searchParams.get("cardKind");
    const scaleType = url.searchParams.get("scaleType");
    const scaleRoot = url.searchParams.get("scaleRoot");
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

    if (templates.length === 0) {
      return NextResponse.json({ count: 0 });
    }

    // 2) Filter by scale type/root if specified (same logic as /api/cards/next)
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
          // For non-chord cards (e.g., scale_spelling), use existing behavior
          // Check meta.type for scale type
          if (scaleType && meta.type !== scaleType) {
            return false;
          }
          // If scaleRoot is specified for non-chord cards, check meta.keyRoot
          if (scaleRoot && meta.keyRoot !== scaleRoot) {
            return false;
          }
          return true;
        }
      });
    }

    // 3) Filter by difficulty if specified (same logic as /api/cards/next)
    if (difficulty === "easy") {
      const templateIds = filteredTemplates.map((t: { id: number }) => t.id);
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
    }

    return NextResponse.json({ count: filteredTemplates.length });
  } catch (error) {
    console.error("Error counting cards:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
