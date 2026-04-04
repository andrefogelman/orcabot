// src/pdf-job-poller.ts
// Polls ob_pdf_jobs for pending jobs and runs the appropriate pipeline sequentially.

import { supabaseAdmin } from './supabase-client.js';
import { setSupabase as setPdfSupabase } from '../container/skills/pdf-pipeline/src/supabase.js';
import { runPipeline as runPdfPipeline } from '../container/skills/pdf-pipeline/src/index.js';
import { setSupabase as setDwgSupabase } from '../container/skills/dwg-pipeline/src/supabase.js';
import { runPipeline as runDwgPipeline } from '../container/skills/dwg-pipeline/src/index.js';

const POLL_INTERVAL_MS = 10000;
const COOLDOWN_BETWEEN_JOBS_MS = 5000;

let processing = false;

/**
 * Process one pending job at a time (sequential to avoid rate limits).
 */
async function processNextJob(): Promise<boolean> {
  if (processing) return false;

  const { data, error } = await supabaseAdmin
    .from('ob_pdf_jobs')
    .select('id, file_id, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('[pdf-job-poller] Failed to fetch jobs:', error.message);
    return false;
  }

  const job = data?.[0];
  if (!job) return false;

  processing = true;

  // Determine file type to route to correct pipeline
  const { data: fileData } = await supabaseAdmin
    .from('ob_project_files')
    .select('file_type')
    .eq('id', job.file_id)
    .single();

  const fileType = fileData?.file_type || 'pdf';
  const isDwg = fileType === 'dwg' || fileType === 'dxf';

  console.log(
    `[pdf-job-poller] Starting ${isDwg ? 'dwg' : 'pdf'}-pipeline for job ${job.id} (file_type: ${fileType})`,
  );

  try {
    if (isDwg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setDwgSupabase(supabaseAdmin as any);
      await runDwgPipeline(job.id);
    } else {
      setPdfSupabase(supabaseAdmin);
      await runPdfPipeline(job.id);
    }

    console.log(`[pdf-job-poller] Job ${job.id} completed successfully`);

    // Update file status to done
    await supabaseAdmin
      .from('ob_project_files')
      .update({ status: 'done' })
      .eq('id', job.file_id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pdf-job-poller] Job ${job.id} failed:`, msg);

    // Update file status to error
    await supabaseAdmin
      .from('ob_project_files')
      .update({ status: 'error' })
      .eq('id', job.file_id);
  } finally {
    processing = false;
  }

  // Cooldown between jobs to avoid rate limits
  await new Promise((r) => setTimeout(r, COOLDOWN_BETWEEN_JOBS_MS));
  return true;
}

/**
 * Start the PDF/DWG job poller. Runs every POLL_INTERVAL_MS.
 */
export function startPdfJobPoller(): NodeJS.Timeout {
  console.log(
    `[pdf-job-poller] Poller started (interval: ${POLL_INTERVAL_MS}ms, sequential mode)`,
  );

  return setInterval(async () => {
    try {
      const processed = await processNextJob();
      if (processed) {
        console.log('[pdf-job-poller] Job processed, checking for more...');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[pdf-job-poller] Poller error:', msg);
    }
  }, POLL_INTERVAL_MS);
}
