CREATE FUNCTION audit_events_block_change()
RETURNS trigger
LANGUAGE plpgsql
AS $audit_events_block_change$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$audit_events_block_change$;
--> statement-breakpoint
CREATE TRIGGER audit_events_block_update_or_delete
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_block_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_block_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION audit_events_block_change();