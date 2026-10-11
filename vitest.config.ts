import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      // Only resolvable inside the real Workers runtime; stubbed here so
      // plain-Node vitest can import src/worker/index.ts for the Worker
      // fetch-handler tests (tests/worker/*.test.ts). See the stub file's
      // own comment for why this is safe.
      "cloudflare:workers": path.resolve(__dirname, "tests/helpers/cloudflareWorkersStub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      SESSION_SECRET: "test-only-session-secret-0123456789",
      PLANBUDDY_DATA_DIR: ":memory:",
    },
  },
});
