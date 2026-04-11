-- Unique constraint em (project_id, eap_code) ---------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ob_orcamento_items_project_eap_unique'
  ) THEN
    ALTER TABLE ob_orcamento_items
      ADD CONSTRAINT ob_orcamento_items_project_eap_unique
      UNIQUE (project_id, eap_code);
  END IF;
END $$;

-- RPC: aplica um lote de mudancas de eap_code atomicamente --------------------
CREATE OR REPLACE FUNCTION renumber_eap_items(
  p_project_id uuid,
  p_patches jsonb  -- [{"id": "...", "eap_code": "..."}, ...]
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  patch jsonb;
BEGIN
  -- Validacao: todos os IDs devem pertencer ao projeto
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_patches) p
    WHERE NOT EXISTS (
      SELECT 1 FROM ob_orcamento_items i
      WHERE i.id = (p->>'id')::uuid
        AND i.project_id = p_project_id
    )
  ) THEN
    RAISE EXCEPTION 'renumber_eap_items: item(s) nao pertencem ao projeto %', p_project_id;
  END IF;

  -- 2-step para evitar colisao da unique constraint (project_id, eap_code):
  -- passo 1: mover afetados para prefixo temporario
  FOR patch IN SELECT * FROM jsonb_array_elements(p_patches) LOOP
    UPDATE ob_orcamento_items
       SET eap_code = '__tmp__' || (patch->>'id')
     WHERE id = (patch->>'id')::uuid
       AND project_id = p_project_id;
  END LOOP;

  -- passo 2: aplicar os codigos finais
  FOR patch IN SELECT * FROM jsonb_array_elements(p_patches) LOOP
    UPDATE ob_orcamento_items
       SET eap_code = patch->>'eap_code',
           updated_at = now()
     WHERE id = (patch->>'id')::uuid
       AND project_id = p_project_id;
  END LOOP;
END;
$$;

-- RPC: reverte um snapshot (usado pelo undo) ----------------------------------
CREATE OR REPLACE FUNCTION revert_renumber(
  p_project_id uuid,
  p_snapshot jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  PERFORM renumber_eap_items(p_project_id, p_snapshot);
END;
$$;

-- Grants ----------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION renumber_eap_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION revert_renumber(uuid, jsonb) TO authenticated;
