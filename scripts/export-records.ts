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

const organizationsColumns = [
  "id",
  "name",
  "created_at",
] as const;

const branchesColumns = [
  "id",
  "organization_id",
  "name",
  "branch_code",
  "digital_address",
  "phone",
  "licence_number",
  "licence_expires_on",
  "created_at",
] as const;

const rolesColumns = [
  "id",
  "organization_id",
  "code",
  "name",
  "created_at",
] as const;

const rolePermissionsColumns = [
  "role_id",
  "permission",
] as const;

const usersColumns = [
  "id",
  "organization_id",
  "email",
  "full_name",
  "is_active",
  "created_at",
] as const;

const medicinesColumns = [
  "id",
  "organization_id",
  "name",
  "dosage_form",
  "status",
  "classification",
  "unit_price_pesewas",
] as const;

const batchesColumns = [
  "id",
  "organization_id",
  "branch_id",
  "medicine_id",
  "batch_number",
  "expiry_date",
  "unit_cost_pesewas",
  "quantity_on_hand",
] as const;

const branchSettingsColumns = [
  "branch_id",
  "organization_id",
  "void_auto_approve_limit_pesewas",
] as const;

const branchSaleCountersColumns = [
  "branch_id",
  "business_date",
  "last_value",
] as const;

const userBranchAssignmentsColumns = [
  "user_id",
  "branch_id",
  "role_id",
  "organization_id",
] as const;

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

const saleVoidsColumns = [
  "id",
  "organization_id",
  "branch_id",
  "sale_id",
  "status",
  "reason",
  "requested_by",
  "approved_by",
  "requested_at",
  "decided_at",
  "business_date",
  "decision_for",
] as const;

const moneyColumns = new Set([
  "unit_price_pesewas",
  "unit_cost_pesewas",
  "void_auto_approve_limit_pesewas",
  "total_pesewas",
  "line_total_pesewas",
  "amount_pesewas",
]);

const dateColumns = new Set([
  "expiry_date",
  "licence_expires_on",
  "business_date",
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
      moneyColumns.has(column) || dateColumns.has(column)
        ? `${table}.${column}::text as ${column}`
        : `${table}.${column}`,
    )
    .join(",\n         ");
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value as Date).toISOString();
}

function rowValues(
  row: Record<string, unknown>,
  columns: readonly string[],
): unknown[] {
  return columns.map((column) =>
    column === "created_at" ||
    column === "requested_at" ||
    column === "decided_at"
      ? toIsoOrNull(row[column])
      : row[column],
  );
}

function exportCsv(
  targetDirectory: string,
  fileName: string,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): void {
  writeFileSync(
    join(targetDirectory, fileName),
    csv([...columns], rows.map((row) => rowValues(row, columns))),
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
    const branchResult = await pool.query(
      `select
         ${selectList("branches", branchesColumns)}
       from branches
       where branches.id = $1::uuid`,
      [branchIdResult.data],
    );
    const branch = branchResult.rows[0];
    if (!branch) fail();
    const organizationId = branch.organization_id as string;

    const exportSpecs = [
      {
        fileName: "organizations.csv",
        table: "organizations",
        columns: organizationsColumns,
        sql: `select
         ${selectList("organizations", organizationsColumns)}
       from organizations
       where organizations.id = $1::uuid`,
        params: [organizationId],
      },
      {
        fileName: "branches.csv",
        table: "branches",
        columns: branchesColumns,
        sql: `select
         ${selectList("branches", branchesColumns)}
       from branches
       where branches.id = $1::uuid`,
        params: [branchIdResult.data],
      },
      {
        fileName: "roles.csv",
        table: "roles",
        columns: rolesColumns,
        sql: `select
         ${selectList("roles", rolesColumns)}
       from roles
       where roles.organization_id = $1::uuid
       order by roles.code asc, roles.id asc`,
        params: [organizationId],
      },
      {
        fileName: "role_permissions.csv",
        table: "role_permissions",
        columns: rolePermissionsColumns,
        sql: `select
         ${selectList("role_permissions", rolePermissionsColumns)}
       from role_permissions
       inner join roles on roles.id = role_permissions.role_id
       where roles.organization_id = $1::uuid
       order by role_permissions.role_id asc, role_permissions.permission asc`,
        params: [organizationId],
      },
      {
        fileName: "users.csv",
        table: "users",
        columns: usersColumns,
        sql: `select
         ${selectList("users", usersColumns)}
       from users
       where users.organization_id = $1::uuid
       order by users.email asc, users.id asc`,
        params: [organizationId],
      },
      {
        fileName: "medicines.csv",
        table: "medicines",
        columns: medicinesColumns,
        sql: `select
         ${selectList("medicines", medicinesColumns)}
       from medicines
       where medicines.organization_id = $1::uuid
       order by medicines.name asc, medicines.id asc`,
        params: [organizationId],
      },
      {
        fileName: "batches.csv",
        table: "batches",
        columns: batchesColumns,
        sql: `select
         ${selectList("batches", batchesColumns)}
       from batches
       where batches.branch_id = $1::uuid
       order by batches.id asc`,
        params: [branchIdResult.data],
      },
      {
        fileName: "branch_settings.csv",
        table: "branch_settings",
        columns: branchSettingsColumns,
        sql: `select
         ${selectList("branch_settings", branchSettingsColumns)}
       from branch_settings
       where branch_settings.branch_id = $1::uuid`,
        params: [branchIdResult.data],
      },
      {
        fileName: "branch_sale_counters.csv",
        table: "branch_sale_counters",
        columns: branchSaleCountersColumns,
        sql: `select
         ${selectList("branch_sale_counters", branchSaleCountersColumns)}
       from branch_sale_counters
       where branch_sale_counters.branch_id = $1::uuid
       order by branch_sale_counters.business_date asc`,
        params: [branchIdResult.data],
      },
      {
        fileName: "user_branch_assignments.csv",
        table: "user_branch_assignments",
        columns: userBranchAssignmentsColumns,
        sql: `select
         ${selectList("user_branch_assignments", userBranchAssignmentsColumns)}
       from user_branch_assignments
       where user_branch_assignments.branch_id = $1::uuid
       order by user_branch_assignments.user_id asc, user_branch_assignments.role_id asc`,
        params: [branchIdResult.data],
      },
      {
        fileName: "sales.csv",
        table: "sales",
        columns: salesCsvColumns,
        sql: `select
         ${selectList("sales", salesColumns)},
         ${salesComputedSelectList}
       from sales
       where sales.branch_id = $1::uuid
       order by sales.created_at asc, sales.id asc`,
        params: [branchIdResult.data],
      },
      {
        fileName: "sale_lines.csv",
        table: "sale_lines",
        columns: saleLinesColumns,
        sql: `select
         ${selectList("sale_lines", saleLinesColumns)}
       from sale_lines
       inner join sales on sales.id = sale_lines.sale_id
       where sales.branch_id = $1::uuid
       order by sale_lines.sale_id asc, sale_lines.id asc`,
        params: [branchIdResult.data],
      },
      {
        fileName: "payments.csv",
        table: "payments",
        columns: paymentsColumns,
        sql: `select
         ${selectList("payments", paymentsColumns)}
       from payments
       inner join sales on sales.id = payments.sale_id
       where sales.branch_id = $1::uuid
       order by payments.sale_id asc, payments.id asc`,
        params: [branchIdResult.data],
      },
      {
        fileName: "sale_voids.csv",
        table: "sale_voids",
        columns: saleVoidsColumns,
        sql: `select
         ${selectList("sale_voids", saleVoidsColumns)}
       from sale_voids
       where sale_voids.branch_id = $1::uuid
       order by (sale_voids.decision_for is not null), sale_voids.requested_at asc, sale_voids.id asc`,
        params: [branchIdResult.data],
      },
    ];

    mkdirSync(join("exports", databaseName), { recursive: true });
    mkdirSync(targetDirectory);

    for (const spec of exportSpecs) {
      const result = await pool.query(spec.sql, spec.params);
      exportCsv(targetDirectory, spec.fileName, spec.columns, result.rows);
    }
    writeFileSync(
      join(targetDirectory, "restore-order.txt"),
      exportSpecs.map((spec) => spec.fileName).join("\n") + "\n",
    );

    console.log(databaseName);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("unavailable");
  process.exit(1);
});
