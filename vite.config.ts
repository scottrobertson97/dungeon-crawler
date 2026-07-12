import { defineConfig } from "vitest/config";

const pagesBase = process.env.GITHUB_PAGES_BASE ?? "./";

export default defineConfig({
  base: pagesBase,
  build: {
    chunkSizeWarningLimit: 1800
  },
  test: {
    environment: "node",
    clearMocks: true
  }
});
