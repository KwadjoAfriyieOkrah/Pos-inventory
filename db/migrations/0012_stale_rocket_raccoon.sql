CREATE TABLE "login_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_type" text NOT NULL,
	"key_hash" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'failed' NOT NULL,
	CONSTRAINT "login_failures_key_type_check" CHECK ("login_failures"."key_type" in ('email', 'terminal')),
	CONSTRAINT "login_failures_key_hash_length_check" CHECK (length("login_failures"."key_hash") = 64),
	CONSTRAINT "login_failures_status_check" CHECK ("login_failures"."status" in ('pending', 'failed', 'succeeded'))
);
--> statement-breakpoint
CREATE INDEX "login_failures_key_type_key_hash_failed_at_idx" ON "login_failures" USING btree ("key_type","key_hash","failed_at");