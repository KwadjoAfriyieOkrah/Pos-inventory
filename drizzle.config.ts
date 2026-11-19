import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" }); // drizzle-kit doesn't read .env.local on its own

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
});