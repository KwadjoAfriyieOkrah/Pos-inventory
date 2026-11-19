CREATE TABLE "terminal_registration_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "terminal_registration_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "terminal_registration_codes_code_hash_length_check" CHECK (char_length("terminal_registration_codes"."code_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "terminals_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "terminals_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "terminals_token_hash_length_check" CHECK (char_length("terminals"."token_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "terminal_id" uuid;--> statement-breakpoint
ALTER TABLE "terminal_registration_codes" ADD CONSTRAINT "terminal_registration_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_registration_codes" ADD CONSTRAINT "terminal_registration_codes_branch_organization_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_branch_organization_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terminals_branch_id_idx" ON "terminals" USING btree ("branch_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_terminal_organization_fk" FOREIGN KEY ("terminal_id","organization_id") REFERENCES "public"."terminals"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_terminal_id_created_at_idx" ON "audit_events" USING btree ("terminal_id","created_at");