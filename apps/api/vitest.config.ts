import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    env: {
      NODE_ENV: "test",
    },
  },
});
