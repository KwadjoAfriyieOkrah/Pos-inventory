import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: resolve(process.cwd(), "tests/.env.test"), quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let isLocalTestDatabase = false;

try {
  if (!testDatabaseUrl) throw new Error();

  const parsedUrl = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  isLocalTestDatabase =
    databaseName.endsWith("_test") &&
    ["localhost", "127.0.0.1"].includes(parsedUrl.hostname);
} catch {
  isLocalTestDatabase = false;
}

if (!isLocalTestDatabase || !testDatabaseUrl) {
  throw new Error(
    "Refusing to run tests: TEST_DATABASE_URL must point at a *_test database on localhost.",
  );
}

export default defineConfig({
  test: {
    env: { DATABASE_URL: testDatabaseUrl },
    globalSetup: ["./scripts/reset-test-db.ts"],
  },
});
