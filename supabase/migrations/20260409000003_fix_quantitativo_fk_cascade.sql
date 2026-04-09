-- Fix FK on ob_orcamento_items.quantitativo_id to SET NULL on delete
-- so deleting quantitativos doesn't fail due to FK constraint
ALTER TABLE ob_orcamento_items
  DROP CONSTRAINT IF EXISTS ob_orcamento_items_quantitativo_id_fkey;

ALTER TABLE ob_orcamento_items
  ADD CONSTRAINT ob_orcamento_items_quantitativo_id_fkey
  FOREIGN KEY (quantitativo_id) REFERENCES ob_quantitativos(id) ON DELETE SET NULL;
