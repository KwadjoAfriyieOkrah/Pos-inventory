CREATE TABLE "branch_sale_counters" (
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "branch_sale_counters_branch_id_business_date_pk" PRIMARY KEY("branch_id","business_date")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "branch_code" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "sale_number" text;--> statement-breakpoint
ALTER TABLE "branch_sale_counters" ADD CONSTRAINT "branch_sale_counters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_branch_code_unique" UNIQUE("organization_id","branch_code");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_sale_number_unique" UNIQUE("branch_id","sale_number");