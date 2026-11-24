import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";

export const authPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 8,
  connectionTimeoutMillis: 1000,
});

authPool.on("error", (error) => {
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "unknown";
  console.error(code);
});

export const authDb = drizzle(authPool);
