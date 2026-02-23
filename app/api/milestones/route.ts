export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { updateMilestonesProgressAndUnlock } from "@/lib/curriculum/milestonesService";

type MilestoneDto = {
  id: number;
  key: string;
  title: string;
  description: string;
  order: number;
  isUnlocked: boolean;
  isCompleted: boolean;
  progress: number; // 0–1
  totalCards: number;
  seenCards: number;
  masteredCards: number;
};

type GetMilestonesResponse = {
  milestones: MilestoneDto[];
};

export async function GET() {
  try {
    // Update milestone progress and unlock status before fetching
    // This also returns card counts for each milestone
    const cardCounts = await updateMilestonesProgressAndUnlock();

    // Fetch updated milestones
    const milestones = await prisma.milestone.findMany({
      orderBy: { order: "asc" },
    });

    // Create a map of milestone id -> card counts for quick lookup
    const cardCountsMap = new Map(
      cardCounts.map((cc) => [cc.id, cc])
    );

    const milestonesDto: MilestoneDto[] = milestones.map((m: { id: number; key: string; title: string; description: string; order: number; isUnlocked: boolean; isCompleted: boolean; progress: number }) => {
      const counts = cardCountsMap.get(m.id) ?? {
        totalCards: 0,
        seenCards: 0,
        masteredCards: 0,
      };
      return {
        id: m.id,
        key: m.key,
        title: m.title,
        description: m.description,
        order: m.order,
        isUnlocked: m.isUnlocked,
        isCompleted: m.isCompleted,
        progress: m.progress,
        totalCards: counts.totalCards,
        seenCards: counts.seenCards,
        masteredCards: counts.masteredCards,
      };
    });

    const response: GetMilestonesResponse = {
      milestones: milestonesDto,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching milestones:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
