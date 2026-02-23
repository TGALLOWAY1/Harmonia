export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCircleNodes, type PitchClass } from "@/lib/theory";

type KeySummaryDto = {
  id: string;
  mastery: number;
  avgRecallMs: number | null;
  lastReviewedAt: string | null;
  dueCount: number;
};

type CircleSummaryResponse = {
  keys: KeySummaryDto[];
};

/**
 * Type guard to check if meta has a majorRoot field
 */
function hasMajorRoot(meta: unknown): meta is { majorRoot: string } {
  return (
    typeof meta === "object" &&
    meta !== null &&
    "majorRoot" in meta &&
    typeof (meta as { majorRoot: unknown }).majorRoot === "string"
  );
}

/**
 * Compute mastery metrics for a single major key
 */
function computeKeySummary(
  root: PitchClass,
  templates: Array<{
    id: number;
    meta: unknown;
    states: Array<{
      attemptsCount: number;
      correctCount: number;
      dueAt: Date;
    }>;
    attempts: Array<{
      responseMs: number | null;
      createdAt: Date;
    }>;
  }>
): KeySummaryDto {
  const keyId = `${root}_major`;

  // Filter templates that belong to this key (meta.majorRoot === root)
  const keyTemplates = templates.filter((template) => {
    if (!hasMajorRoot(template.meta)) {
      return false;
    }
    return template.meta.majorRoot === root;
  });

  // If no templates exist for this key, return default values
  if (keyTemplates.length === 0) {
    return {
      id: keyId,
      mastery: 0,
      avgRecallMs: null,
      lastReviewedAt: null,
      dueCount: 0,
    };
  }

  // Aggregate data from all templates
  let totalAttempts = 0;
  let totalCorrect = 0;
  let templatesWithAttempts = 0;
  const allResponseMs: number[] = [];
  const allAttemptDates: Date[] = [];
  let dueCount = 0;
  const now = new Date();

  for (const template of keyTemplates) {
    // Aggregate CardState data
    let templateHasAttempts = false;
    for (const state of template.states) {
      totalAttempts += state.attemptsCount;
      totalCorrect += state.correctCount;

      if (state.attemptsCount > 0) {
        templateHasAttempts = true;

        // Count due cards (only if attemptsCount > 0)
        if (state.dueAt <= now) {
          dueCount++;
        }
      }
    }

    // Track if this template has any attempts
    if (templateHasAttempts) {
      templatesWithAttempts++;
    }

    // Aggregate CardAttempt data
    for (const attempt of template.attempts) {
      if (attempt.responseMs !== null && attempt.responseMs !== undefined) {
        allResponseMs.push(attempt.responseMs);
      }
      allAttemptDates.push(attempt.createdAt);
    }
  }

  // Compute accuracy
  const accuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;

  // Compute coverage
  const coverage =
    keyTemplates.length > 0 ? templatesWithAttempts / keyTemplates.length : 0;

  // Compute mastery (accuracy * coverage)
  const mastery = accuracy * coverage;

  // Compute avgRecallMs
  const avgRecallMs =
    allResponseMs.length > 0
      ? Math.round(allResponseMs.reduce((sum, ms) => sum + ms, 0) / allResponseMs.length)
      : null;

  // Compute lastReviewedAt
  const lastReviewedAt =
    allAttemptDates.length > 0
      ? new Date(Math.max(...allAttemptDates.map((d) => d.getTime())))
      : null;

  return {
    id: keyId,
    mastery: Math.round(mastery * 100) / 100, // Round to 2 decimal places
    avgRecallMs,
    lastReviewedAt: lastReviewedAt?.toISOString() ?? null,
    dueCount,
  };
}

export async function GET() {
  try {
    console.log("[Circle Summary API] Starting request...");
    
    // Fetch all circle-related CardTemplates once
    console.log("[Circle Summary API] Fetching card templates...");
    const allCircleTemplates = await prisma.cardTemplate.findMany({
      where: {
        kind: {
          startsWith: "circle_",
        },
      },
      include: {
        states: true,
        attempts: true,
      },
    });
    console.log(`[Circle Summary API] Found ${allCircleTemplates.length} circle templates`);

    // Get all major keys from the circle
    const nodes = getCircleNodes();
    console.log(`[Circle Summary API] Processing ${nodes.length} circle nodes`);
    const summaries: KeySummaryDto[] = [];

    // Compute summary for each major key
    for (const node of nodes) {
      try {
        const summary = computeKeySummary(node.root, allCircleTemplates);
        // Validate summary structure
        if (typeof summary.mastery !== 'number' || isNaN(summary.mastery)) {
          console.error(`[Circle Summary API] Invalid mastery for ${node.root}:`, summary.mastery);
          summary.mastery = 0; // Fallback to 0
        }
        summaries.push(summary);
      } catch (nodeError) {
        console.error(`[Circle Summary API] Error processing node ${node.root}:`, nodeError);
        // Add a default summary for this node
        summaries.push({
          id: `${node.root}_major`,
          mastery: 0,
          avgRecallMs: null,
          lastReviewedAt: null,
          dueCount: 0,
        });
      }
    }

    // Validate all summaries have mastery
    const invalidSummaries = summaries.filter(s => typeof s.mastery !== 'number' || isNaN(s.mastery));
    if (invalidSummaries.length > 0) {
      console.error("[Circle Summary API] Found invalid summaries:", invalidSummaries);
      // Fix invalid summaries
      invalidSummaries.forEach(s => {
        s.mastery = 0;
      });
    }

    const response: CircleSummaryResponse = {
      keys: summaries,
    };

    console.log(`[Circle Summary API] Returning ${summaries.length} summaries`);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[Circle Summary API] Fatal error:", error);
    console.error("[Circle Summary API] Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    
    // Return empty but valid response structure
    const nodes = getCircleNodes();
    const fallbackSummaries: KeySummaryDto[] = nodes.map(node => ({
      id: `${node.root}_major`,
      mastery: 0,
      avgRecallMs: null,
      lastReviewedAt: null,
      dueCount: 0,
    }));

    return NextResponse.json(
      { 
        keys: fallbackSummaries,
        error: error instanceof Error ? error.message : "Internal server error"
      },
      { status: 200 } // Return 200 with fallback data so frontend doesn't break
    );
  }
}
