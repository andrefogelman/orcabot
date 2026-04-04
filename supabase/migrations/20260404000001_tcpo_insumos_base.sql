-- TCPO insumos base table (materials, labor, equipment)
CREATE TABLE IF NOT EXISTS ob_tcpo_insumos_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  descricao text NOT NULL,
  unidade text,
  categoria text NOT NULL, -- Materiais, Mão de obra, Equipamentos
  regiao text DEFAULT 'São Paulo',
  preco numeric(14,4) DEFAULT 0,
  search_term text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ob_tcpo_insumos_base_cat ON ob_tcpo_insumos_base(categoria);
CREATE INDEX IF NOT EXISTS idx_ob_tcpo_insumos_base_desc ON ob_tcpo_insumos_base USING gin (descricao gin_trgm_ops);

ALTER TABLE ob_tcpo_insumos_base ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_tcpo_insumos_base_read') THEN
    CREATE POLICY ob_tcpo_insumos_base_read ON ob_tcpo_insumos_base FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_tcpo_insumos_base_write') THEN
    CREATE POLICY ob_tcpo_insumos_base_write ON ob_tcpo_insumos_base FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
