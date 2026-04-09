-- Add missing DELETE policy for ob_quantitativos
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_quantitativos_delete') THEN
    CREATE POLICY ob_quantitativos_delete ON ob_quantitativos
      FOR DELETE USING (
        project_id IN (
          SELECT p.id FROM ob_projects p
          JOIN ob_org_members om ON om.org_id = p.org_id
          WHERE om.user_id = auth.uid()
        )
      );
  END IF;
END $$;
