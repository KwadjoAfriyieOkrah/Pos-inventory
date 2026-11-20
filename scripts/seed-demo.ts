import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DEFAULT_ROLE_PERMISSIONS } from "../db/seed/default-role-permissions";
import {
  branches,
  organizations,
  rolePermissions,
  roles,
  userBranchAssignments,
  users,
} from "../db/schema";

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
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "unknown";
    console.error(code);
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
        ])
        .onConflictDoNothing();

      return {
        branches: [branchA, branchB],
        counts: {
          organizations: 1,
          branches: 2,
          roles: 2,
          users: 2,
          assignments: 3,
          permissions:
            DEFAULT_ROLE_PERMISSIONS.owner.length +
            DEFAULT_ROLE_PERMISSIONS.cashier.length,
        },
      };
    });

    console.log(databaseName);
    for (const branch of seeded.branches) {
      console.log(`${branch.name}: ${branch.id}`);
    }
    const { counts } = seeded;
    console.log(
      `Counts: organizations=${counts.organizations} branches=${counts.branches} roles=${counts.roles} users=${counts.users} assignments=${counts.assignments} permissions=${counts.permissions}`,
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
