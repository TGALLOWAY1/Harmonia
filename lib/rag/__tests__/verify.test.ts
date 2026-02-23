import { describe, it, expect } from "vitest";
import { verifyProgressionFromPrompt } from "../verify";

describe("verifyProgressionFromPrompt", () => {
  it("parses i–VI–III–VII in A minor and returns correct chord tones", async () => {
    const result = await verifyProgressionFromPrompt(
      "Give a i–VI–III–VII progression in A minor with chord tones"
    );
    expect(result.keyRoot).toBe("A");
    expect(result.keyType).toBe("minor");
    expect(result.parsed.romanNumerals).toEqual(["i", "VI", "III", "VII"]);
    expect(result.progression).toHaveLength(4);
    expect(result.progression[0]).toEqual({
      degree: "i",
      symbol: "Am",
      notes: ["A", "C", "E"],
    });
    expect(result.progression[1]).toEqual({
      degree: "VI",
      symbol: "F",
      notes: ["F", "A", "C"],
    });
    expect(result.progression[2]).toEqual({
      degree: "III",
      symbol: "C",
      notes: ["C", "E", "G"],
    });
    expect(result.progression[3]).toEqual({
      degree: "VII",
      symbol: "G",
      notes: ["G", "B", "D"],
    });
    expect(result.verification.passed).toBe(true);
  });

  it("parses I–V–vi–IV in C major", async () => {
    const result = await verifyProgressionFromPrompt(
      "I–V–vi–IV in C major"
    );
    expect(result.keyRoot).toBe("C");
    expect(result.keyType).toBe("major");
    expect(result.progression[0].degree).toBe("I");
    expect(result.progression[0].notes).toEqual(["C", "E", "G"]);
  });

  it("returns parse failure when key cannot be extracted", async () => {
    const result = await verifyProgressionFromPrompt("random text");
    expect(result.progression).toHaveLength(0);
    expect(result.verification.passed).toBe(false);
    expect(result.verification.failures.length).toBeGreaterThan(0);
  });
});
