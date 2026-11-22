import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DEFAULT_ROLE_PERMISSIONS } from "../db/seed/default-role-permissions";
import {
  branches,
  batches,
  medicines,
  organizations,
  payments,
  rolePermissions,
  roles,
  sales,
  saleLines,
  stockMovements,
  userBranchAssignments,
  users,
} from "../db/schema";
import { DEMO_CATALOG } from "../src/features/demo/catalog";
import { DEMO_STOCK_BATCHES } from "../src/features/demo/stock";
import { DEMO_BRANCHES } from "../src/features/demo/dashboard";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.env.DEMO_SEED !== "yes") {
    refuse("Set DEMO_SEED=yes to run the demo seed.");
  }

  const ownerPassword = process.env.DEMO_OWNER_PASSWORD;
  if (!ownerPassword || ownerPassword.length < 12) {
    refuse("DEMO_OWNER_PASSWORD is missing or shorter than 12 characters.");
  }

  const cashierPassword = process.env.DEMO_CASHIER_PASSWORD;
  if (!cashierPassword || cashierPassword.length < 12) {
    refuse("DEMO_CASHIER_PASSWORD is missing or shorter than 12 characters.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  let databaseName = "";
  try {
    if (!databaseUrl) throw new Error();
    const parsedUrl = new URL(databaseUrl);
    databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
  } catch {
    databaseName = "";
  }

  if (databaseName !== "pos_dev" && databaseName !== "pos_demo") {
    refuse("Refusing: database name not on the demo allow-list.");
  }

  const hashOutput = execFileSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--conditions=react-server",
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { hashPassword } = await import(pathToFileURL(resolve(process.cwd(), "src/server/auth/password.ts")).href);
console.log(await hashPassword(process.env.DEMO_OWNER_PASSWORD ?? ""));
console.log(await hashPassword(process.env.DEMO_CASHIER_PASSWORD ?? ""));`,
    ],
    {
      encoding: "utf8",
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "development",
        DEMO_OWNER_PASSWORD: ownerPassword,
        DEMO_CASHIER_PASSWORD: cashierPassword,
      },
    },
  );
  const [ownerPasswordHash, cashierPasswordHash] = hashOutput
    .trimEnd()
    .split(/\r?\n/);
  if (!ownerPasswordHash || !cashierPasswordHash) {
    throw new Error("Demo passwords could not be hashed");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", (error) => {
 const sqlstate =
  error && typeof error === "object" && "code" in error
    ? error.code
    : "unknown";
console.error(`Demo seed database error: ${sqlstate}`);
  });

  type BranchResult = { id: string; name: string };

  try {
    const db = drizzle(pool);
    const seeded = await db.transaction(async (tx) => {
      await tx.execute(
        // Serialize runs because organizations do not have a unique name constraint.
        sql`SELECT pg_advisory_xact_lock(hashtext('pharmacy-pos-demo-seed'))`,
      );

      let [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.name, "Demo Pharmacy Group"))
        .limit(1);

      if (!organization) {
        [organization] = await tx
          .insert(organizations)
          .values({ name: "Demo Pharmacy Group" })
          .onConflictDoNothing()
          .returning({ id: organizations.id });
      }

      if (!organization) throw new Error("Demo organization unavailable");

      const getOrCreateBranch = async (
        name: string,
        licenceNumber: string,
      ): Promise<BranchResult> => {
        await tx
          .insert(branches)
          .values({
            organizationId: organization.id,
            name,
            digitalAddress: "GA-000-0000",
            licenceNumber,
            licenceExpiresOn: "2030-12-31",
          })
          .onConflictDoNothing({ target: branches.licenceNumber });

        const [branch] = await tx
          .select({
            id: branches.id,
            name: branches.name,
            organizationId: branches.organizationId,
          })
          .from(branches)
          .where(eq(branches.licenceNumber, licenceNumber))
          .limit(1);

        if (!branch || branch.organizationId !== organization.id) {
          throw new Error("Demo branch unavailable");
        }

        return { id: branch.id, name: branch.name };
      };

      const branchA = await getOrCreateBranch("Demo Branch A", "DEMO-LIC-A");
      const branchB = await getOrCreateBranch("Demo Branch B", "DEMO-LIC-B");

      const getOrCreateRole = async (
        code: "owner" | "cashier",
      ): Promise<string> => {
        await tx
          .insert(roles)
          .values({
            organizationId: organization.id,
            code,
            name: code,
          })
          .onConflictDoNothing({
            target: [roles.organizationId, roles.code],
          });

        const [role] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(
            and(
              eq(roles.organizationId, organization.id),
              eq(roles.code, code),
            ),
          )
          .limit(1);

        if (!role) throw new Error("Demo role unavailable");

        await tx
          .insert(rolePermissions)
          .values(
            DEFAULT_ROLE_PERMISSIONS[code].map((permission) => ({
              roleId: role.id,
              permission,
            })),
          )
          .onConflictDoNothing();

        return role.id;
      };

      const ownerRoleId = await getOrCreateRole("owner");
      const cashierRoleId = await getOrCreateRole("cashier");

      const getOrCreateUser = async (
        email: string,
        fullName: string,
        passwordHash: string,
      ): Promise<string> => {
        await tx
          .insert(users)
          .values({
            organizationId: organization.id,
            email,
            fullName,
            passwordHash,
          })
          .onConflictDoNothing({
            target: [users.organizationId, users.email],
          });

        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organizationId, organization.id),
              eq(users.email, email),
            ),
          )
          .limit(1);

        if (!user) throw new Error("Demo user unavailable");
        return user.id;
      };

      const ownerId = await getOrCreateUser(
        "demo.owner@example.com",
        "Demo Owner",
        ownerPasswordHash,
      );
      const cashierId = await getOrCreateUser(
        "demo.cashier@example.com",
        "Demo Cashier",
        cashierPasswordHash,
      );

      await tx
        .insert(userBranchAssignments)
        .values([
          {
            userId: ownerId,
            branchId: branchA.id,
            roleId: ownerRoleId,
            organizationId: organization.id,
          },
          {
            userId: ownerId,
            branchId: branchB.id,
            roleId: ownerRoleId,
            organizationId: organization.id,
          },
          {
            userId: cashierId,
            branchId: branchA.id,
            roleId: cashierRoleId,
            organizationId: organization.id,
          },
          {
            userId: cashierId,
            branchId: branchB.id,
            roleId: cashierRoleId,
            organizationId: organization.id,
          },
        ])
        .onConflictDoNothing();

      const insertedMedicines = await tx
        .insert(medicines)
        .values(
          DEMO_CATALOG.map((medicine) => ({
            organizationId: organization.id,
            name: medicine.name,
            dosageForm: medicine.dosageForm,
            unitPricePesewas: medicine.unitPricePesewas,
          })),
        )
        .onConflictDoNothing({
          target: [medicines.organizationId, medicines.name],
        })
        .returning({ id: medicines.id });

      const medicineRows = await tx
        .select({
          id: medicines.id,
          name: medicines.name,
        })
        .from(medicines)
        .where(eq(medicines.organizationId, organization.id));
      const medicineIdByName = new Map(
        medicineRows.map((medicine) => [medicine.name, medicine.id]),
      );
      const demoBranches = [
        { id: branchA.id, name: branchA.name, figure: DEMO_BRANCHES[0] },
        { id: branchB.id, name: branchB.name, figure: DEMO_BRANCHES[1] },
      ];

      const medicineCount = insertedMedicines.length;
      let batchCount = 0;
      let movementCount = 0;
      let saleCount = 0;
      let saleLineCount = 0;
      let paymentCount = 0;

      const accraDate = (() => {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Accra",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date());
        const values = Object.fromEntries(
          parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
        );
        return `${values.year}-${values.month}-${values.day}`;
      })();

      for (const demoBranch of demoBranches) {
        for (const demoBatch of DEMO_STOCK_BATCHES) {
          const medicine = DEMO_CATALOG.find(
            (item) => item.id === demoBatch.medicineId,
          );
          if (!medicine) throw new Error("Demo medicine unavailable");
          const medicineId = medicineIdByName.get(medicine.name);
          if (!medicineId) throw new Error("Demo medicine row unavailable");

          const demoBatchNumber = `DEMO-${demoBatch.batchNumber}`;
          const insertedBatches = await tx
            .insert(batches)
            .values({
              organizationId: organization.id,
              branchId: demoBranch.id,
              medicineId,
              batchNumber: demoBatchNumber,
              expiryDate: demoBatch.expiryDate,
              unitCostPesewas: demoBatch.unitCostPesewas,
              quantityOnHand: demoBatch.quantityOnHand,
            })
            .onConflictDoNothing({
              target: [
                batches.branchId,
                batches.medicineId,
                batches.batchNumber,
              ],
            })
            .returning({ id: batches.id });
          if (insertedBatches.length > 0) batchCount += 1;

          const [batch] = await tx
            .select({
              id: batches.id,
              quantityOnHand: batches.quantityOnHand,
            })
            .from(batches)
            .where(
              and(
                eq(batches.organizationId, organization.id),
                eq(batches.branchId, demoBranch.id),
                eq(batches.medicineId, medicineId),
                eq(batches.batchNumber, demoBatchNumber),
              ),
            )
            .limit(1);
          if (!batch) throw new Error("Demo batch unavailable");

          const [existingMovement] = await tx
            .select({ id: stockMovements.id })
            .from(stockMovements)
            .where(eq(stockMovements.referenceId, batch.id))
            .limit(1);

          if (!existingMovement) {
            await tx.insert(stockMovements).values({
              organizationId: organization.id,
              branchId: demoBranch.id,
              batchId: batch.id,
              movementType: "receipt",
              quantityDelta: batch.quantityOnHand,
              referenceId: batch.id,
              createdBy: ownerId,
            });
            movementCount += 1;
          }
        }

        const salesTarget = demoBranch.figure.salesTodayCount;
        const targetPesewas = demoBranch.figure.salesTodayTotalPesewas;
        const baseTotal = Math.floor(targetPesewas / salesTarget);
        const remainder = targetPesewas - baseTotal * salesTarget;

        for (let index = 0; index < salesTarget; index += 1) {
          const saleTotal = baseTotal + (index < remainder ? 1 : 0);
          const key = `demo-seed-${demoBranch.figure.id}-${index + 1}`;
          const [existingSale] = await tx
            .select({ id: sales.id })
            .from(sales)
            .where(
              and(
                eq(sales.branchId, demoBranch.id),
                eq(sales.idempotencyKey, key),
              ),
            )
            .limit(1);

          let saleId = existingSale?.id;
          if (!saleId) {
            const [insertedSale] = await tx
              .insert(sales)
              .values({
                organizationId: organization.id,
                branchId: demoBranch.id,
                cashierId: cashierId,
                idempotencyKey: key,
                totalPesewas: saleTotal,
                paymentMethod: index % 5 === 4 ? "momo" : "cash",
                createdAt: new Date(`${accraDate}T12:00:00.000Z`),
              })
              .onConflictDoNothing({
                target: [sales.branchId, sales.idempotencyKey],
              })
              .returning({ id: sales.id });
            saleId = insertedSale?.id;
            if (saleId) saleCount += 1;
          }

          if (!saleId) {
            const [sale] = await tx
              .select({ id: sales.id })
              .from(sales)
              .where(
                and(
                  eq(sales.branchId, demoBranch.id),
                  eq(sales.idempotencyKey, key),
                ),
              )
              .limit(1);
            saleId = sale?.id;
          }
          if (!saleId) throw new Error("Demo sale unavailable");

          const topItem =
            demoBranch.figure.topMedicinesThisWeek[
              index % demoBranch.figure.topMedicinesThisWeek.length
            ];
          const catalogMedicine = DEMO_CATALOG.find(
            (item) => item.id === topItem.medicineId,
          );
          if (!catalogMedicine) throw new Error("Demo catalog item unavailable");
          const medicineId = medicineIdByName.get(catalogMedicine.name);
          if (!medicineId) throw new Error("Demo medicine unavailable");

          const [batch] = await tx
            .select({ id: batches.id })
            .from(batches)
            .where(
              and(
                eq(batches.organizationId, organization.id),
                eq(batches.branchId, demoBranch.id),
                eq(batches.medicineId, medicineId),
              ),
            )
            .limit(1);
          if (!batch) throw new Error("Demo sale batch unavailable");

          const [existingLine] = await tx
            .select({ id: saleLines.id })
            .from(saleLines)
            .where(eq(saleLines.saleId, saleId))
            .limit(1);
          if (!existingLine) {
            await tx.insert(saleLines).values({
              saleId,
              medicineId,
              batchId: batch.id,
              quantity: 1,
              unitPricePesewas: saleTotal,
              lineTotalPesewas: saleTotal,
            });
            saleLineCount += 1;
          }

          const [existingPayment] = await tx
            .select({ id: payments.id })
            .from(payments)
            .where(eq(payments.saleId, saleId))
            .limit(1);
          if (!existingPayment) {
            const isMomo = index % 5 === 4;
            await tx.insert(payments).values({
              saleId,
              amountPesewas: saleTotal,
              method: isMomo ? "momo" : "cash",
              reference: isMomo
                ? `DEMO-MOMO-${demoBranch.figure.id}-${index + 1}`
                : null,
            });
            paymentCount += 1;
          }
        }
      }

      return {
        branches: [branchA, branchB],
        counts: {
          organizations: 1,
          branches: 2,
          roles: 2,
          users: 2,
          assignments: 4,
          permissions:
            DEFAULT_ROLE_PERMISSIONS.owner.length +
            DEFAULT_ROLE_PERMISSIONS.cashier.length,
          medicines: medicineCount,
          batches: batchCount,
          movements: movementCount,
          sales: saleCount,
          saleLines: saleLineCount,
          payments: paymentCount,
        },
      };
    });

    console.log(databaseName);
    for (const branch of seeded.branches) {
      console.log(`${branch.name}: ${branch.id}`);
    }
    const { counts } = seeded;
    console.log(
      `Inserted counts: medicines=${counts.medicines} batches=${counts.batches} movements=${counts.movements} sales=${counts.sales} saleLines=${counts.saleLines} payments=${counts.payments}`,
    );
    console.log("demo seed complete");
  } catch {
    console.error("Demo seed failed.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  console.error("Demo seed failed.");
  process.exitCode = 1;
});
