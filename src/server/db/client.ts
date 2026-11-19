import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";

export const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.on("error", (error) => {
  const message = error.message
    .replace(env.DATABASE_URL, "[redacted connection string]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted connection string]");

  console.error("Unexpected PostgreSQL pool error:", error.name, message);
});

export const db = drizzle(pool);