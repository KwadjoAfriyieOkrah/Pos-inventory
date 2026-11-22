import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: resolve(process.cwd(), "tests/.env.test"), quiet: true });

const refusalMessage =
  "Refusing to reset: database name must end with _test on localhost";
class ResetRefusedError extends Error {}

export async function setup(): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  let databaseName: string;

  try {
    if (!connectionString) throw new ResetRefusedError();
    const parsedUrl = new URL(connectionString);
    databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
    if (
      !databaseName.endsWith("_test") ||
      !["localhost", "127.0.0.1"].includes(parsedUrl.hostname)
    ) {
      throw new ResetRefusedError();
    }
  } catch {
    console.error(refusalMessage);
    throw new ResetRefusedError();
  }

  const pool = new Pool({ connectionString });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("CREATE SCHEMA public");
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(process.cwd(), "db/migrations"),
    });
    await pool.end();
    console.log(`${databaseName} reset complete`);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  setup().catch((error: unknown) => {
    if (!(error instanceof ResetRefusedError)) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "unavailable";
      console.error(`Test database reset failed (${code})`);
    }
    process.exitCode = 1;
  });
}
