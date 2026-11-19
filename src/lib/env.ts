import { z } from "zod";

// Fails at startup if a required variable is missing, instead of failing later during a sale.
const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  APP_TIMEZONE: z.literal("Africa/Accra"),
});

export const env = schema.parse(process.env);