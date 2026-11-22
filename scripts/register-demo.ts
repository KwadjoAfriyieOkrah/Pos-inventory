import { config } from "dotenv";
import { spawnSync } from "node:child_process";

config({ path: ".env.local" });

const source = process.env.NEON_DEMO_URL;
if (!source) {
  console.error("NEON_DEMO_URL is missing from .env.local.");
  process.exit(1);
}

// Point the connection at pos_demo and keep the rest of the string unchanged.
const url = new URL(source);
url.pathname = "/pos_demo";

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "scripts/register-terminal.ts", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url.toString() },
  },
);

process.exit(result.status ?? 1);