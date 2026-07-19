import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
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
