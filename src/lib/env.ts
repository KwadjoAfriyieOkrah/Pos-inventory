import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  APP_TIMEZONE: z.literal("Africa/Accra"),
});

const rules: Record<keyof typeof schema.shape, string> = {
  DATABASE_URL: "must be a valid URL",
  AUTH_SECRET: "must be at least 32 characters",
  APP_URL: "must be a valid URL",
  APP_TIMEZONE: 'must equal exactly "Africa/Accra"',
};

const result = schema.safeParse(process.env);

if (!result.success) {
  const invalidVariables = [
    ...new Set(
      result.error.issues
        .map((issue) => issue.path[0])
        .filter(
          (variable): variable is keyof typeof rules =>
            typeof variable === "string" && variable in rules,
        ),
    ),
  ];

  throw new Error(
    `Invalid environment variables: ${invalidVariables
      .map((variable) => `${variable} (${rules[variable]})`)
      .join(", ")}`,
  );
}

export const env = result.data;