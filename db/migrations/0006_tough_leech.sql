CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"expiry_date" date NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_pesewas" bigint NOT NULL,
	CONSTRAINT "goods_receipt_lines_quantity_check" CHECK ("goods_receipt_lines"."quantity" > 0),
	CONSTRAINT "goods_receipt_lines_unit_cost_pesewas_check" CHECK ("goods_receipt_lines"."unit_cost_pesewas" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_invoice" text,
	"received_by" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_branch_idempotency_key_unique" UNIQUE("branch_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "medicines" ALTER COLUMN "unit_price_pesewas" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "classification" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_medicine_organization_fk" FOREIGN KEY ("medicine_id","organization_id") REFERENCES "public"."medicines"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_organization_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_user_organization_fk" FOREIGN KEY ("received_by","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;