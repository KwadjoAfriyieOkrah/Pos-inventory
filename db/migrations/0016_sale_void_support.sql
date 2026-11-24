ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type in ('receipt', 'sale', 'adjustment', 'reversal'));
--> statement-breakpoint
CREATE FUNCTION sale_voids_block_change()
RETURNS trigger
LANGUAGE plpgsql
AS $sale_voids_block_change$
BEGIN
  RAISE EXCEPTION 'sale_voids is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$sale_voids_block_change$;
--> statement-breakpoint
CREATE TRIGGER sale_voids_block_update_or_delete
BEFORE UPDATE OR DELETE ON sale_voids
FOR EACH ROW
EXECUTE FUNCTION sale_voids_block_change();
--> statement-breakpoint
CREATE TRIGGER sale_voids_block_truncate
BEFORE TRUNCATE ON sale_voids
FOR EACH STATEMENT
EXECUTE FUNCTION sale_voids_block_change();
