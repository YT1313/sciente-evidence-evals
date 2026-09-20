import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Run tests against sources, so `pnpm test` does not require a build.
      "@sciente/data-block": resolve("./packages/data-block/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
  },
});
