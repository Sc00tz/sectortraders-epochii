import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@st/shared": path.resolve(__dirname, "packages/shared/src/index.ts") } },
  test: { include: ["packages/**/*.test.ts", "apps/server/src/**/*.test.ts"] },
});
