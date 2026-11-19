import { config } from "dotenv";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const branchId = args[args.indexOf("--branch-id") + 1];
const rawName = args[args.indexOf("--name") + 1];
const branchIdResult = z.string().uuid().safeParse(branchId);
const nameResult = z.string().trim().min(1).safeParse(rawName);

if (!branchIdResult.success || !nameResult.success) {
  console.error("unavailable");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("unavailable");
  process.exit(1);
}

function getSqlstate(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[0-9A-Z]{5}$/.test(error.code)
  ) {
    return error.code;
  }

  return "unavailable";
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const registrationCode = Array.from(randomBytes(10), (byte) => alphabet[byte & 31]).join("");
const codeHash = createHash("sha256").update(registrationCode).digest("hex");
const pool = new Pool({ connectionString: databaseUrl });

pool.on("error", (error) => {
  const sqlstate = getSqlstate(error);
  console.error(sqlstate);
});

try {
  const result = await pool.query(
    `INSERT INTO terminal_registration_codes
      (organization_id, branch_id, name, code_hash, expires_at)
     SELECT organization_id, id, $2, $3, now() + interval '15 minutes'
     FROM branches
     WHERE id = $1::uuid
     RETURNING id`,
    [branchIdResult.data, nameResult.data, codeHash],
  );

  if (result.rowCount !== 1) {
    throw new Error("Branch not found.");
  }

  console.log("Registration code (shown once):", registrationCode);
} catch (error) {
  const sqlstate = getSqlstate(error);
  console.error(sqlstate);
  process.exitCode = 1;
} finally {
  await pool.end();
}
