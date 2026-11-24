CREATE TABLE "branch_settings" (
	"branch_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"void_auto_approve_limit_pesewas" bigint,
	CONSTRAINT "branch_settings_void_auto_approve_limit_pesewas_check" CHECK ("branch_settings"."void_auto_approve_limit_pesewas" is null or "branch_settings"."void_auto_approve_limit_pesewas" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"business_date" date NOT NULL,
	CONSTRAINT "sale_voids_sale_id_unique" UNIQUE("sale_id"),
	CONSTRAINT "sale_voids_status_check" CHECK ("sale_voids"."status" in ('pending_approval', 'approved', 'rejected', 'completed')),
	CONSTRAINT "sale_voids_reason_length_check" CHECK (length("sale_voids"."reason") between 5 and 200)
);
--> statement-breakpoint
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_branch_organization_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_branch_organization_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_requested_by_organization_fk" FOREIGN KEY ("requested_by","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_approved_by_organization_fk" FOREIGN KEY ("approved_by","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;