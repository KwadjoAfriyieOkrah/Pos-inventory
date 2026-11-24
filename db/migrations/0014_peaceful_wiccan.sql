ALTER TABLE "sale_voids" ALTER COLUMN "reason" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_id_branch_id_unique" UNIQUE("id","branch_id");