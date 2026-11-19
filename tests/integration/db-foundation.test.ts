import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

loadDotenv({ path: join(process.cwd(), "tests", ".env.test"), quiet: true });

const ENV_KEYS = ["DATABASE_URL", "AUTH_SECRET", "APP_URL", "APP_TIMEZONE"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://pos:pos_dev_only@localhost:5432/pos_dev";

const VALID_ENV: Record<EnvKey, string> = {
  DATABASE_URL: TEST_DATABASE_URL,
  AUTH_SECRET: "a".repeat(32),
  APP_URL: "http://localhost:3000",
  APP_TIMEZONE: "Africa/Accra",
};

const ORIGINAL_ENV = new Map<EnvKey, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const PRISMA_SCOPE = "@" + "prisma";
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

let dbPool: Pool | undefined;

function setEnv(overrides: Partial<Record<EnvKey, string | null>> = {}): void {
  for (const key of ENV_KEYS) {
    const value = key in overrides ? overrides[key] : VALID_ENV[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function redact(value: string): string {
  return value
    .replaceAll(TEST_DATABASE_URL, "[redacted url]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted url]");
}

function collectTextFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTextFiles(fullPath));
    } else if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});

afterEach(() => {
  restoreEnv();
});

describe("environment validation", () => {
  it("throws and names DATABASE_URL when DATABASE_URL is unset", async () => {
    vi.resetModules();
    setEnv({ DATABASE_URL: null });

    await expect(import("../../src/lib/env")).rejects.toThrow(/DATABASE_URL/);
  });

  it("names a short AUTH_SECRET without echoing the supplied value", async () => {
    vi.resetModules();
    const shortSecret = "sh0rt";
    setEnv({ AUTH_SECRET: shortSecret });

    let caught: unknown;
    try {
      await import("../../src/lib/env");
      throw new Error("expected env import to reject");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("AUTH_SECRET");
    expect(message).not.toContain(shortSecret);
    expect(String(caught)).not.toContain(shortSecret);
  });

  it("rejects APP_TIMEZONE set to Europe/London", async () => {
    vi.resetModules();
    setEnv({ APP_TIMEZONE: "Europe/London" });

    await expect(import("../../src/lib/env")).rejects.toThrow(/APP_TIMEZONE/);
  });
});

describe("database connectivity", () => {
  it("returns 1 from select 1 through the exported db with a valid environment", async () => {
    vi.resetModules();
    setEnv();

    const { db, pool } = await import("../../src/server/db/client");
    dbPool = pool;

    const result = await db.execute<{ value: number }>(sql`select 1 as value`);
    expect(result.rows[0]?.value).toBe(1);
  });

  afterAll(async () => {
    if (dbPool) await dbPool.end();
  });
});

it("pool.end() in afterAll released all connections", () => {
  expect(dbPool).toBeDefined();
  expect(dbPool?.ended).toBe(true);
  expect(dbPool?.idleCount).toBe(0);
  expect(dbPool?.totalCount).toBe(0);
});

describe("dependency hygiene", () => {
  it("package.json has no dependency starting with prisma or the Prisma scope", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const allDependencies = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    };
    const pattern = new RegExp("^(" + "prisma" + "|" + PRISMA_SCOPE + ")", "i");
    const offenders = Object.keys(allDependencies).filter((name) => pattern.test(name));

    expect(offenders).toEqual([]);
  });

  it("no file under src/, db/ or tests/ imports the Prisma scope", () => {
    const files = ["src", "db", "tests"].flatMap((dir) =>
      collectTextFiles(join(process.cwd(), dir)),
    );
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes(PRISMA_SCOPE),
    );

    expect(offenders).toEqual([]);
  });
});

describe("migrations", () => {
  it.skip(
    "npm run db:migrate succeeds twice in a row with no errors — no migrations exist until Task 1.2",
    () => {
      const run = () =>
        spawnSync("npm run db:migrate", {
          cwd: process.cwd(),
          env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
          encoding: "utf8",
          shell: true,
        });

      const first = run();
      const second = run();

      expect(
        first.status,
        `first run: status=${first.status} output=${redact((first.stdout ?? "") + (first.stderr ?? ""))}`,
      ).toBe(0);
      expect(
        second.status,
        `second run: status=${second.status} output=${redact((second.stdout ?? "") + (second.stderr ?? ""))}`,
      ).toBe(0);
    },
  );
});
