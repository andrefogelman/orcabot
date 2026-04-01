-- Delegation tasks table for IPC between Orcamentista and specialist agents
CREATE TABLE IF NOT EXISTS ob_delegation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES ob_projects(id) ON DELETE CASCADE,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  pranchas JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ob_delegation_tasks_status ON ob_delegation_tasks(status) WHERE status = 'pending';
CREATE INDEX idx_ob_delegation_tasks_project ON ob_delegation_tasks(project_id);

-- RLS: service_role only (agents use service key)
ALTER TABLE ob_delegation_tasks ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_ob_delegation_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ob_delegation_tasks_updated_at
  BEFORE UPDATE ON ob_delegation_tasks
  FOR EACH ROW EXECUTE FUNCTION update_ob_delegation_tasks_updated_at();
