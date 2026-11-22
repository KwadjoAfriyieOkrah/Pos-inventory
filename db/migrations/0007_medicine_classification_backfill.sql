UPDATE "medicines"
SET "classification" = 'OTC'
WHERE "status" = 'active'
  AND "classification" IS NULL
  AND "unit_price_pesewas" IS NOT NULL;