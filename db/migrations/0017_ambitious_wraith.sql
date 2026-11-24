ALTER TABLE "sale_voids" DROP CONSTRAINT "sale_voids_sale_id_unique";--> statement-breakpoint
ALTER TABLE "sale_voids" ADD COLUMN "decision_for" uuid;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_id_branch_id_unique" UNIQUE("id","branch_id");--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_decision_for_branch_fk" FOREIGN KEY ("decision_for","branch_id") REFERENCES "public"."sale_voids"("id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_voids_sale_id_request_only_unique" ON "sale_voids" USING btree ("sale_id") WHERE "sale_voids"."decision_for" is null;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_decision_for_unique" UNIQUE("decision_for");