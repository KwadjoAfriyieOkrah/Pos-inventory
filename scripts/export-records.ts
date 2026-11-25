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

const salesColumns = [
  "id",
  "organization_id",
  "branch_id",
  "cashier_id",
  "idempotency_key",
  "sale_number",
  "total_pesewas",
  "payment_method",
  "created_at",
] as const;

const saleLinesColumns = [
  "id",
  "sale_id",
  "medicine_id",
  "batch_id",
  "quantity",
  "unit_price_pesewas",
  "line_total_pesewas",
] as const;

const paymentsColumns = [
  "id",
  "sale_id",
  "amount_pesewas",
  "method",
  "reference",
] as const;

const moneyColumns = new Set([
  "total_pesewas",
  "unit_price_pesewas",
  "line_total_pesewas",
  "amount_pesewas",
]);

const salesComputedColumns = {
  business_date: "(created_at at time zone 'Africa/Accra')::date::text",
} as const;

const salesCsvColumns = [...salesColumns, "business_date"] as const;

const salesComputedSelectList =
  `${salesComputedColumns.business_date} as business_date`;

function selectList(table: string, columns: readonly string[]): string {
  return columns
    .map((column) =>
      moneyColumns.has(column)
        ? `${table}.${column}::text as ${column}`
        : `${table}.${column}`,
    )
    .join(",\n         ");
}

function rowValues(
  row: Record<string, unknown>,
  columns: readonly string[],
): unknown[] {
  return columns.map((column) =>
    column === "created_at"
      ? new Date(row.created_at as Date).toISOString()
      : row[column],
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const branchId = args[args.indexOf("--branch-id") + 1];
  const branchIdResult = z.string().uuid().safeParse(branchId);
  if (!branchIdResult.success) {
    console.error("Usage: npm run records:export -- --branch-id <uuid>");
    process.exit(2);
  }

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
         ${selectList("sales", salesColumns)},
         ${salesComputedSelectList}
       from sales
       where sales.branch_id = $1::uuid
       order by sales.created_at asc, sales.id asc`,
      [branchIdResult.data],
    );
    const linesResult = await pool.query(
      `select
         ${selectList("sale_lines", saleLinesColumns)}
       from sale_lines
       inner join sales on sales.id = sale_lines.sale_id
       where sales.branch_id = $1::uuid
       order by sale_lines.sale_id asc, sale_lines.id asc`,
      [branchIdResult.data],
    );
    const paymentsResult = await pool.query(
      `select
         ${selectList("payments", paymentsColumns)}
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
        [...salesCsvColumns],
        salesResult.rows.map((row) => rowValues(row, salesCsvColumns)),
      ),
    );
    writeFileSync(
      join(targetDirectory, "sale_lines.csv"),
      csv(
        [...saleLinesColumns],
        linesResult.rows.map((row) => rowValues(row, saleLinesColumns)),
      ),
    );
    writeFileSync(
      join(targetDirectory, "payments.csv"),
      csv(
        [...paymentsColumns],
        paymentsResult.rows.map((row) => rowValues(row, paymentsColumns)),
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
