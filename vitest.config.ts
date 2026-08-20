import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/ui/**", "**/node_modules/**", "**/dist/**", "**/.wrangler/**"]
  }
});
