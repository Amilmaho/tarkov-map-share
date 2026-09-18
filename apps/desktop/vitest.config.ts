import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e 目录由 Playwright 运行，不能被 Vitest 收集
    include: ["tests/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "out/**"],
  },
});
