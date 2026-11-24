-- Backfill branch codes from the final A/B letter of each branch name.
UPDATE branches
SET branch_code = upper(right(btrim(name), 1))
WHERE branch_code IS NULL;

-- Backfill sale numbers in Accra creation order and prime the daily counters.
WITH numbered AS (
  SELECT
    s.id,
    b.branch_code,
    (s.created_at AT TIME ZONE 'Africa/Accra')::date AS business_date,
    row_number() OVER (
      PARTITION BY s.branch_id, (s.created_at AT TIME ZONE 'Africa/Accra')::date
      ORDER BY s.created_at, s.id
    ) AS sequence_value
  FROM sales s
  INNER JOIN branches b
    ON b.id = s.branch_id
   AND b.organization_id = s.organization_id
  WHERE s.sale_number IS NULL
),
updated AS (
  UPDATE sales s
  SET sale_number =
      numbered.branch_code || '-' ||
      to_char(numbered.business_date, 'YYYYMMDD') || '-' ||
      lpad(numbered.sequence_value::text, 4, '0')
  FROM numbered
  WHERE s.id = numbered.id
  RETURNING s.branch_id, numbered.business_date, numbered.sequence_value
)
INSERT INTO branch_sale_counters (branch_id, business_date, last_value)
SELECT branch_id, business_date, max(sequence_value)::integer
FROM updated
GROUP BY branch_id, business_date
ON CONFLICT (branch_id, business_date) DO UPDATE
SET last_value = greatest(branch_sale_counters.last_value, excluded.last_value);

-- Enforce the backfilled columns after every existing row has a value.
ALTER TABLE "branches" ALTER COLUMN "branch_code" SET NOT NULL;
ALTER TABLE "sales" ALTER COLUMN "sale_number" SET NOT NULL;
