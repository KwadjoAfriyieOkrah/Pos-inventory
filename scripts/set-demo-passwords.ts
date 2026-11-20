import { config } from "dotenv";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";

config({ path: ".env.local" });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  if (process.env.DEMO_SEED !== "yes") {
    fail("Set DEMO_SEED=yes to run this script.");
  }

  const ownerPassword = process.env.DEMO_OWNER_PASSWORD ?? "";
  const cashierPassword = process.env.DEMO_CASHIER_PASSWORD ?? "";

  if (ownerPassword.length < 12) {
    fail("DEMO_OWNER_PASSWORD is missing or shorter than 12 characters.");
  }
  if (cashierPassword.length < 12) {
    fail("DEMO_CASHIER_PASSWORD is missing or shorter than 12 characters.");
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    fail("DATABASE_URL is not set.");
  }

  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (dbName !== "pos_dev" && dbName !== "pos_demo") {
    fail(`Refusing: database name "${dbName}" is not on the demo allow-list.`);
  }

  const pool = new Pool({ connectionString: url });
  try {
    const ownerHash = await hash(ownerPassword);
    const cashierHash = await hash(cashierPassword);

    const owner = await pool.query(
      "update users set password_hash = $1 where email = $2",
      [ownerHash, "demo.owner@example.com"],
    );
    const cashier = await pool.query(
      "update users set password_hash = $1 where email = $2",
      [cashierHash, "demo.cashier@example.com"],
    );

    if (owner.rowCount !== 1) fail("demo.owner@example.com not found.");
    if (cashier.rowCount !== 1) fail("demo.cashier@example.com not found.");

    console.log("demo.owner@example.com updated");
    console.log("demo.cashier@example.com updated");
    console.log("password reset complete");
  } finally {
    await pool.end();
  }
}

main().catch((error: { code?: string }) => {
  console.error(`Password reset failed: ${error.code ?? "unavailable"}`);
  process.exit(1);
});