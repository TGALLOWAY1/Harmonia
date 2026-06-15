/**
 * Tests for the audio engine's unlock + status state machine. Tone.js is
 * mocked so we can drive the AudioContext state deterministically and assert
 * that silent failures become visible status transitions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mutable fake AudioContext state the mock reads from. */
const ctx = { state: "suspended" as AudioContextState };
const startMock = vi.fn(async () => {
  ctx.state = "running";
});
const resumeMock = vi.fn(async () => {
  ctx.state = "running";
});

vi.mock("tone", () => ({
  start: () => startMock(),
  getContext: () => ({
    get state() {
      return ctx.state;
    },
    resume: () => resumeMock(),
    rawContext: { addEventListener: vi.fn() },
  }),
}));

async function freshEngine() {
  vi.resetModules();
  return import("../audioEngine");
}

beforeEach(() => {
  ctx.state = "suspended";
  startMock.mockClear();
  resumeMock.mockClear();
  startMock.mockImplementation(async () => {
    ctx.state = "running";
  });
});

describe("ensureAudioReady", () => {
  it("resumes a suspended context and reports ready", async () => {
    const { ensureAudioReady, useAudioStatusStore } = await freshEngine();

    const ok = await ensureAudioReady();

    expect(ok).toBe(true);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(useAudioStatusStore.getState().status).toBe("ready");
    expect(useAudioStatusStore.getState().error).toBeNull();
  });

  it("is idempotent and does not re-start an already-running context", async () => {
    const { ensureAudioReady } = await freshEngine();

    await ensureAudioReady();
    await ensureAudioReady();

    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight unlock between concurrent callers", async () => {
    const { ensureAudioReady } = await freshEngine();

    const [a, b] = await Promise.all([ensureAudioReady(), ensureAudioReady()]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failure (does not swallow it) when Tone.start rejects", async () => {
    const { ensureAudioReady, useAudioStatusStore } = await freshEngine();
    startMock.mockImplementation(async () => {
      throw new Error("NotAllowedError");
    });

    const ok = await ensureAudioReady();

    expect(ok).toBe(false);
    expect(useAudioStatusStore.getState().status).toBe("failed");
    expect(useAudioStatusStore.getState().error).toContain("NotAllowedError");
  });

  it("reports failed when the context stays suspended after starting", async () => {
    const { ensureAudioReady, useAudioStatusStore } = await freshEngine();
    // Neither start nor resume manages to flip the context to running.
    startMock.mockImplementation(async () => {});
    resumeMock.mockImplementation(async () => {});

    const ok = await ensureAudioReady();

    expect(ok).toBe(false);
    expect(useAudioStatusStore.getState().status).toBe("failed");
    expect(useAudioStatusStore.getState().error).toContain("suspended");
  });
});
