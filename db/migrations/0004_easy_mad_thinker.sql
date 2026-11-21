CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"expiry_date" date NOT NULL,
	"unit_cost_pesewas" bigint NOT NULL,
	"quantity_on_hand" integer NOT NULL,
	CONSTRAINT "batches_branch_medicine_batch_number_unique" UNIQUE("branch_id","medicine_id","batch_number"),
	CONSTRAINT "batches_id_branch_id_unique" UNIQUE("id","branch_id"),
	CONSTRAINT "batches_unit_cost_pesewas_check" CHECK ("batches"."unit_cost_pesewas" >= 0),
	CONSTRAINT "batches_quantity_on_hand_check" CHECK ("batches"."quantity_on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dosage_form" text NOT NULL,
	"unit_price_pesewas" bigint NOT NULL,
	CONSTRAINT "medicines_organization_id_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "medicines_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "medicines_unit_price_pesewas_check" CHECK ("medicines"."unit_price_pesewas" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount_pesewas" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	CONSTRAINT "payments_sale_id_unique" UNIQUE("sale_id"),
	CONSTRAINT "payments_amount_pesewas_check" CHECK ("payments"."amount_pesewas" > 0),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('cash', 'momo')),
	CONSTRAINT "payments_momo_reference_check" CHECK (("payments"."method" = 'momo' and "payments"."reference" is not null) or "payments"."method" = 'cash')
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_pesewas" bigint NOT NULL,
	"line_total_pesewas" bigint NOT NULL,
	CONSTRAINT "sale_lines_quantity_check" CHECK ("sale_lines"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"total_pesewas" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_branch_idempotency_key_unique" UNIQUE("branch_id","idempotency_key"),
	CONSTRAINT "sales_total_pesewas_check" CHECK ("sales"."total_pesewas" >= 0),
	CONSTRAINT "sales_payment_method_check" CHECK ("sales"."payment_method" in ('cash', 'momo'))
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"quantity_delta" integer NOT NULL,
	"reference_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_movement_type_check" CHECK ("stock_movements"."movement_type" in ('receipt', 'sale', 'adjustment')),
	CONSTRAINT "stock_movements_quantity_delta_check" CHECK ("stock_movements"."quantity_delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_branch_organization_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_medicine_organization_fk" FOREIGN KEY ("medicine_id","organization_id") REFERENCES "public"."medicines"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_organization_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_organization_fk" FOREIGN KEY ("cashier_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_organization_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_branch_fk" FOREIGN KEY ("batch_id","branch_id") REFERENCES "public"."batches"("id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_branch_medicine_expiry_date_idx" ON "batches" USING btree ("branch_id","medicine_id","expiry_date");--> statement-breakpoint
CREATE INDEX "stock_movements_batch_created_at_idx" ON "stock_movements" USING btree ("batch_id","created_at");