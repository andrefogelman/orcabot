-- Fix ob_pdf_jobs: add project_id column and expand status CHECK to include 'queued'

-- 1. Add project_id column (nullable for existing rows)
ALTER TABLE ob_pdf_jobs
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES ob_projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ob_pdf_jobs_project ON ob_pdf_jobs(project_id);

-- 2. Expand status CHECK to include 'queued'
ALTER TABLE ob_pdf_jobs
  DROP CONSTRAINT IF EXISTS ob_pdf_jobs_status_check;

ALTER TABLE ob_pdf_jobs
  ADD CONSTRAINT ob_pdf_jobs_status_check
  CHECK (status IN ('pending', 'queued', 'processing', 'done', 'error'));
