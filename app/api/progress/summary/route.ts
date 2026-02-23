export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type ProgressSummaryResponse = {
  totals: {
    cardsTotal: number;
    cardsSeen: number;
    cardsUnseen: number;
    attemptsTotal: number;
    correctTotal: number;
    accuracyOverall: number;
  };
  srs: {
    dueNow: number;
    overdue: number;
    dueToday: number;
    averageIntervalDays: number;
    averageEaseFactor: number;
  };
  byKind: Array<{
    kind: string;
    cards: number;
    seen: number;
    accuracy: number;
  }>;
  recentActivity: Array<{
    date: string; // YYYY-MM-DD
    attempts: number;
    correct: number;
  }>;
};

function getEndOfToday(): Date {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return endOfToday;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function GET() {
  try {
    const now = new Date();
    const endOfToday = getEndOfToday();
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // a) Totals
    const cardsTotal = await prisma.cardTemplate.count();

    // Get all states with their cards
    const allStates = await prisma.cardState.findMany({
      include: {
        card: true,
      },
    });

    const cardsSeen = allStates.filter((s: { attemptsCount: number }) => s.attemptsCount > 0).length;
    
    // cardsUnseen = cards without a state OR with attemptsCount = 0
    const cardsWithStateIds = new Set(allStates.map((s: { cardId: number }) => s.cardId));
    const cardsWithoutState = cardsTotal - cardsWithStateIds.size;
    const cardsWithStateButUnseen = allStates.filter(
      (s: { attemptsCount: number }) => s.attemptsCount === 0
    ).length;
    const cardsUnseen = cardsWithoutState + cardsWithStateButUnseen;

    const attemptsTotal = allStates.reduce((sum: number, s: { attemptsCount: number }) => sum + s.attemptsCount, 0);
    const correctTotal = allStates.reduce((sum: number, s: { correctCount: number }) => sum + s.correctCount, 0);
    const accuracyOverall =
      attemptsTotal > 0 ? correctTotal / attemptsTotal : 0;

    // b) SRS
    const dueNow = allStates.filter((s: { dueAt: Date }) => s.dueAt <= now).length;
    const overdue = allStates.filter(
      (s: { dueAt: Date; attemptsCount: number }) => s.dueAt < now && s.attemptsCount > 0
    ).length;
    const dueToday = allStates.filter((s: { dueAt: Date }) => s.dueAt <= endOfToday).length;

    const statesWithAttempts = allStates.filter((s: { attemptsCount: number }) => s.attemptsCount > 0);
    const averageIntervalDays =
      statesWithAttempts.length > 0
        ? statesWithAttempts.reduce((sum: number, s: { intervalDays: number }) => sum + s.intervalDays, 0) /
          statesWithAttempts.length
        : 0;
    const averageEaseFactor =
      statesWithAttempts.length > 0
        ? statesWithAttempts.reduce((sum, s) => sum + s.easeFactor, 0) /
          statesWithAttempts.length
        : 0;

    // c) byKind
    // Get all templates grouped by kind
    const templatesByKind = await prisma.cardTemplate.groupBy({
      by: ["kind"],
      _count: {
        id: true,
      },
    });

    const byKind = await Promise.all(
      templatesByKind.map(async (group) => {
        const kind = group.kind;
        const cards = group._count.id;

        // Get states for cards of this kind with attemptsCount > 0
        const statesForKind = await prisma.cardState.findMany({
          where: {
            card: {
              kind: kind,
            },
            attemptsCount: {
              gt: 0,
            },
          },
        });

        const seen = statesForKind.length;
        const totalAttemptsForKind = statesForKind.reduce(
          (sum, s) => sum + s.attemptsCount,
          0
        );
        const totalCorrectForKind = statesForKind.reduce(
          (sum, s) => sum + s.correctCount,
          0
        );
        const accuracy =
          totalAttemptsForKind > 0
            ? totalCorrectForKind / totalAttemptsForKind
            : 0;

        return {
          kind,
          cards,
          seen,
          accuracy,
        };
      })
    );

    // d) recentActivity
    const recentAttempts = await prisma.cardAttempt.findMany({
      where: {
        createdAt: {
          gte: fourteenDaysAgo,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Group by date
    const activityByDate = new Map<
      string,
      { attempts: number; correct: number }
    >();

    recentAttempts.forEach((attempt) => {
      const dateStr = formatDate(attempt.createdAt);
      const existing = activityByDate.get(dateStr) || {
        attempts: 0,
        correct: 0,
      };
      existing.attempts += 1;
      if (attempt.isCorrect) {
        existing.correct += 1;
      }
      activityByDate.set(dateStr, existing);
    });

    // Convert to array and sort by date
    const recentActivity = Array.from(activityByDate.entries())
      .map(([date, stats]) => ({
        date,
        attempts: stats.attempts,
        correct: stats.correct,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const response: ProgressSummaryResponse = {
      totals: {
        cardsTotal,
        cardsSeen,
        cardsUnseen,
        attemptsTotal,
        correctTotal,
        accuracyOverall,
      },
      srs: {
        dueNow,
        overdue,
        dueToday,
        averageIntervalDays,
        averageEaseFactor,
      },
      byKind,
      recentActivity,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching progress summary:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
