-- Enable RLS if not already (it may be enabled without policies for DELETE)
ALTER TABLE ob_processing_runs ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to SELECT
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_processing_runs_select') THEN
    CREATE POLICY ob_processing_runs_select ON ob_processing_runs FOR SELECT USING (true);
  END IF;
END $$;

-- Allow all authenticated users to INSERT
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_processing_runs_insert') THEN
    CREATE POLICY ob_processing_runs_insert ON ob_processing_runs FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- Allow all authenticated users to DELETE
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_processing_runs_delete') THEN
    CREATE POLICY ob_processing_runs_delete ON ob_processing_runs FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- Allow all authenticated users to UPDATE
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_processing_runs_update') THEN
    CREATE POLICY ob_processing_runs_update ON ob_processing_runs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
