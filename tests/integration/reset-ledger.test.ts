import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

loadDotenv({ path: ".env.local", quiet: true });

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});

type DbClient = typeof import("../../src/server/db/client")["db"];

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
});

afterAll(async () => {
  if (pool) await pool.end();
});

function migrationFileCount(): number {
  return readdirSync(join(process.cwd(), "db", "migrations")).filter((name) =>
    name.endsWith(".sql"),
  ).length;
}

describe("test database reset ledger", () => {
  it("has the drizzle schema, one ledger row per migration, and no duplicate hashes", async () => {
    const schemaResult = await db.execute(
      sql`SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle') AS exists`,
    );
    const schemaRow = schemaResult.rows[0] as { exists: boolean };

    const countResult = await db.execute(
      sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
    );
    const countRow = countResult.rows[0] as { count: number };

    const duplicatesResult = await db.execute(
      sql`SELECT hash FROM drizzle.__drizzle_migrations GROUP BY hash HAVING count(*) > 1`,
    );

    expect(schemaRow.exists).toBe(true);
    expect(countRow.count).toBe(migrationFileCount());
    expect(duplicatesResult.rows).toHaveLength(0);
  });
});
