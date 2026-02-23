export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { retrieve } from "@/lib/rag/retriever";
import { verifyProgressionFromPrompt } from "@/lib/rag/verify";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return NextResponse.json(
        { error: "Missing prompt", details: "Request body must include { prompt: string }" },
        { status: 400 }
      );
    }

    const [chunks, verified] = await Promise.all([
      retrieve(prompt, 5),
      verifyProgressionFromPrompt(prompt),
    ]);

    if (verified.progression.length === 0 && verified.verification.failures.length > 0) {
      return NextResponse.json(
        {
          error: "Parse failed",
          details: verified.verification.failures.join("; "),
        },
        { status: 400 }
      );
    }

    const answerLines: string[] = [];
    for (const chord of verified.progression) {
      answerLines.push(
        `${chord.degree} = ${chord.symbol} = ${chord.notes.join(" ")}`
      );
    }
    const answer = answerLines.join("\n");

    const citations = chunks.slice(0, 5).map((c) => ({
      id: c.id,
      source: c.source,
      title: c.headingPath,
      snippet: c.content.slice(0, 200).replace(/\n/g, " ").trim(),
    }));

    return NextResponse.json({
      answer,
      progression: verified.progression,
      citations,
      verification: verified.verification,
      parsed: {
        keyRoot: verified.keyRoot,
        keyType: verified.keyType,
        romanNumerals: verified.parsed.romanNumerals,
      },
    });
  } catch (err) {
    console.error("RAG progression error:", err);
    return NextResponse.json(
      { error: "Internal server error", details: String(err) },
      { status: 500 }
    );
  }
}
