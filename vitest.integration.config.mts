import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://joshy@localhost:5432/omni_ai_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      ENCRYPTION_KEY: "integration-test-encryption-secret-0123456789",
      OPENROUTER_BASE_URL: "https://openrouter.test/api/v1",
      OPENROUTER_API_KEY: "",
    },
  },
});
