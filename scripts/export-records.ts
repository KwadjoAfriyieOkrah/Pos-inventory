import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";
import { z } from "zod";

config({ path: ".env.local", quiet: true });

function fail(): never {
  console.error("unavailable");
  process.exit(1);
}

function accraTimestamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}T${values.hour}-${values.minute}-${values.second}`;
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvValue).join(",")).join("\n") + "\n";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const branchId = args[args.indexOf("--branch-id") + 1];
  const branchIdResult = z.string().uuid().safeParse(branchId);
  if (!branchIdResult.success) fail();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail();

  let databaseName: string;
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");
  } catch {
    fail();
  }

  if (databaseName !== "pos_dev" && databaseName !== "pos_demo") fail();

  const timestamp = accraTimestamp(new Date());
  const targetDirectory = join("exports", databaseName, timestamp);
  if (existsSync(targetDirectory)) fail();

  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", () => console.error("unavailable"));

  try {
    const salesResult = await pool.query(
      `select
         id,
         sale_number,
         branch_id,
         (created_at at time zone 'Africa/Accra')::date::text as business_date,
         created_at,
         total_pesewas::text as total_pesewas,
         payment_method
       from sales
       where branch_id = $1::uuid
       order by created_at asc, id asc`,
      [branchIdResult.data],
    );
    const linesResult = await pool.query(
      `select
         sale_lines.sale_id,
         sale_lines.medicine_id,
         sale_lines.quantity,
         sale_lines.unit_price_pesewas::text as unit_price_pesewas,
         sale_lines.line_total_pesewas::text as line_total_pesewas
       from sale_lines
       inner join sales on sales.id = sale_lines.sale_id
       where sales.branch_id = $1::uuid
       order by sale_lines.sale_id asc, sale_lines.id asc`,
      [branchIdResult.data],
    );
    const paymentsResult = await pool.query(
      `select
         payments.id,
         payments.sale_id,
         payments.amount_pesewas::text as amount_pesewas,
         payments.method,
         payments.reference
       from payments
       inner join sales on sales.id = payments.sale_id
       where sales.branch_id = $1::uuid
       order by payments.sale_id asc, payments.id asc`,
      [branchIdResult.data],
    );

    mkdirSync(join("exports", databaseName), { recursive: true });
    mkdirSync(targetDirectory);

    writeFileSync(
      join(targetDirectory, "sales.csv"),
      csv(
        [
          "id",
          "sale_number",
          "branch_id",
          "business_date",
          "created_at",
          "total_pesewas",
          "payment_method",
        ],
        salesResult.rows.map((row) => [
          row.id,
          row.sale_number,
          row.branch_id,
          row.business_date,
          new Date(row.created_at).toISOString(),
          row.total_pesewas,
          row.payment_method,
        ]),
      ),
    );
    writeFileSync(
      join(targetDirectory, "sale_lines.csv"),
      csv(
        [
          "sale_id",
          "medicine_id",
          "quantity",
          "unit_price_pesewas",
          "line_total_pesewas",
        ],
        linesResult.rows.map((row) => [
          row.sale_id,
          row.medicine_id,
          row.quantity,
          row.unit_price_pesewas,
          row.line_total_pesewas,
        ]),
      ),
    );
    writeFileSync(
      join(targetDirectory, "payments.csv"),
      csv(
        ["id", "sale_id", "amount_pesewas", "method", "reference"],
        paymentsResult.rows.map((row) => [
          row.id,
          row.sale_id,
          row.amount_pesewas,
          row.method,
          row.reference,
        ]),
      ),
    );

    console.log(databaseName);
    console.log(`sales: ${salesResult.rowCount ?? salesResult.rows.length}`);
    console.log(`sale_lines: ${linesResult.rowCount ?? linesResult.rows.length}`);
    console.log(`payments: ${paymentsResult.rowCount ?? paymentsResult.rows.length}`);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("unavailable");
  process.exit(1);
});
