import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("SQLSTATE=unavailable");
  process.exit(1);
}

let connectionUrl;

try {
  connectionUrl = new URL(connectionString);
} catch {
  console.error("SQLSTATE=unavailable");
  process.exit(1);
}

const database = decodeURIComponent(connectionUrl.pathname.slice(1));
const user = decodeURIComponent(connectionUrl.username);

console.log(
  `host=${connectionUrl.hostname} port=${connectionUrl.port || "5432"} database=${database} user=${user}`,
);

const pool = new Pool({ connectionString });

try {
  await pool.query("select 1");
} catch (error) {
  const code =
    typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
      ? error.code
      : "unavailable";
  console.error(`SQLSTATE=${code}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
