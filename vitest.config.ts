import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.ts", "**/*.{test,spec}.tsx"],
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
