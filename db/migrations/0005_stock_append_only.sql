CREATE FUNCTION stock_movements_block_change()
RETURNS trigger
LANGUAGE plpgsql
AS $stock_movements_block_change$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$stock_movements_block_change$;
--> statement-breakpoint
CREATE TRIGGER stock_movements_block_update_or_delete
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION stock_movements_block_change();
--> statement-breakpoint
CREATE TRIGGER stock_movements_block_truncate
BEFORE TRUNCATE ON stock_movements
FOR EACH STATEMENT
EXECUTE FUNCTION stock_movements_block_change();