CREATE TABLE "login_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_type" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "login_rate_limits_key_window_unique" UNIQUE("key_type","key_hash","window_start"),
	CONSTRAINT "login_rate_limits_key_type_check" CHECK ("login_rate_limits"."key_type" in ('email', 'terminal')),
	CONSTRAINT "login_rate_limits_key_hash_length_check" CHECK (length("login_rate_limits"."key_hash") = 64),
	CONSTRAINT "login_rate_limits_failure_count_nonnegative_check" CHECK ("login_rate_limits"."failure_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "login_rate_limits_window_start_idx" ON "login_rate_limits" USING btree ("window_start");