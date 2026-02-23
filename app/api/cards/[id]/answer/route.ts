export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateSM2, type ConfidenceRating } from "@/lib/srs";

type Params = { params: { id: string } };

type AnswerRequest = {
  selectedIndex: number;
  quality: 0 | 1 | 2 | 3;
  responseMs?: number;
};

/**
 * Maps quality value (0-3) to SM-2 confidence rating
 * 0 = Again, 1 = Hard, 2 = Good, 3 = Easy
 */
function qualityToConfidence(quality: 0 | 1 | 2 | 3): ConfidenceRating {
  switch (quality) {
    case 0:
      return "Again";
    case 1:
      return "Hard";
    case 2:
      return "Good";
    case 3:
      return "Easy";
    default:
      return "Again";
  }
}

/**
 * Maps quality value (0-3) to SM-2 quality value (0-5)
 * 0 = 0 (Again), 1 = 1 (Hard), 2 = 3 (Good), 3 = 5 (Easy)
 */
function qualityToSM2Quality(quality: 0 | 1 | 2 | 3): number {
  switch (quality) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 3;
    case 3:
      return 5;
    default:
      return 0;
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const cardId = Number(params.id);
    if (Number.isNaN(cardId)) {
      return NextResponse.json({ error: "Invalid card id" }, { status: 400 });
    }

    const body: AnswerRequest = await req.json();
    const { selectedIndex, quality, responseMs } = body;

    // Validate selectedIndex
    if (
      typeof selectedIndex !== "number" ||
      selectedIndex < 0 ||
      selectedIndex > 3
    ) {
      return NextResponse.json({ error: "Invalid selectedIndex" }, { status: 400 });
    }

    // Validate quality
    if (
      typeof quality !== "number" ||
      quality < 0 ||
      quality > 3 ||
      !Number.isInteger(quality)
    ) {
      return NextResponse.json(
        { error: "Invalid quality. Must be 0, 1, 2, or 3" },
        { status: 400 }
      );
    }

    const card = await prisma.cardTemplate.findUnique({ where: { id: cardId } });
    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    // Ensure state exists
    let state = await prisma.cardState.findFirst({ where: { cardId } });
    if (!state) {
      state = await prisma.cardState.create({ data: { cardId } });
    }

    const isCorrect = selectedIndex === card.correctIndex;

    await prisma.cardAttempt.create({
      data: {
        cardId,
        selectedIndex,
        isCorrect,
        responseMs: responseMs ?? 0,
      },
    });

    // Calculate SM-2 update
    const sm2Quality = qualityToSM2Quality(quality);
    const srs = calculateSM2({
      easeFactor: state.easeFactor,
      intervalDays: state.intervalDays,
      repetitions: state.repetitions ?? 0,
      lapses: state.lapses ?? 0,
      quality: sm2Quality,
    });

    const confidence = qualityToConfidence(quality);

    const updatedState = await prisma.cardState.update({
      where: { id: state.id },
      data: {
        easeFactor: srs.easeFactor,
        intervalDays: srs.intervalDays,
        repetitions: srs.repetitions,
        lapses: srs.lapses,
        dueAt: srs.dueAt,
        attemptsCount: { increment: 1 },
        correctCount: { increment: isCorrect ? 1 : 0 },
        lastResult: confidence,
        lastAnswerAt: new Date(),
      },
    });

    const responseBody = {
      correct: isCorrect,
      correctIndex: card.correctIndex,
      nextDueAt: srs.dueAt.toISOString(),
      state: {
        attemptsCount: updatedState.attemptsCount,
        correctCount: updatedState.correctCount,
        lastResult: updatedState.lastResult,
        easeFactor: updatedState.easeFactor,
        intervalDays: updatedState.intervalDays,
        repetitions: updatedState.repetitions,
      },
    };

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Error processing answer:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
