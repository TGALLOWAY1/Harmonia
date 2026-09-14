import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.ts", "**/*.{test,spec}.tsx"],
    environment: "node",
    globals: true,
    // Several generator suites sweep thousands of seeds across every key and
    // complexity. Progressions are now chosen best-of-8, so each generation
    // does roughly eight times the work (~10ms vs ~1.4ms) and those sweeps need
    // more headroom than the 5s default. The assertions are unchanged.
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
