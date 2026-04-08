import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getJob,
  updateJob,
  downloadPdf,
  getFileStoragePath,
  getPropostaByFileId,
  upsertPropostaItems,
  updatePropostaAfterExtraction,
} from "./supabase.js";
import { extractProposalItems } from "./extraction.js";
import type { JobStage } from "./types.js";

const STAGE_PROGRESS: Record<string, number> = {
  ingestion: 10,
  extraction: 50,
  structured_output: 90,
  done: 100,
};

export async function runPipeline(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (job.status !== "pending") {
    console.log(`Job ${jobId} is not pending (status: ${job.status}), skipping.`);
    return;
  }

  const workDir = join(tmpdir(), `proposal-pipeline-${jobId}`);
  await mkdir(workDir, { recursive: true });

  try {
    // --- Stage 1: Ingestion ---
    await updateJob(jobId, {
      status: "processing",
      stage: "ingestion" as JobStage,
      progress: STAGE_PROGRESS.ingestion,
      started_at: new Date().toISOString(),
    });

    const storagePath = await getFileStoragePath(job.file_id);
    const pdfPath = join(workDir, "input.pdf");
    await downloadPdf(storagePath, pdfPath);
    console.log(`[${jobId}] Ingestion complete: ${storagePath}`);

    // --- Stage 2: Extraction (LLM Vision) ---
    await updateJob(jobId, {
      stage: "extraction" as JobStage,
      progress: STAGE_PROGRESS.extraction,
    });

    const output = await extractProposalItems(pdfPath, "");
    console.log(`[${jobId}] Extraction complete: ${output.items.length} items, fornecedor: ${output.fornecedor}`);

    // --- Stage 3: Structured Output (persist) ---
    await updateJob(jobId, {
      stage: "structured_output" as JobStage,
      progress: STAGE_PROGRESS.structured_output,
    });

    const proposta = await getPropostaByFileId(job.file_id);
    await upsertPropostaItems(proposta.id, output.items);

    const valorTotal = output.items.reduce(
      (sum, item) => sum + (item.preco_total ?? 0),
      0
    );
    await updatePropostaAfterExtraction(proposta.id, output.fornecedor, valorTotal);

    console.log(`[${jobId}] Persisted ${output.items.length} items to proposta ${proposta.id}`);

    // --- Done ---
    await updateJob(jobId, {
      status: "done",
      stage: "done" as JobStage,
      progress: 100,
      completed_at: new Date().toISOString(),
    });

    console.log(`[${jobId}] Pipeline complete`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${jobId}] Pipeline error:`, message);
    await updateJob(jobId, {
      status: "error",
      error_message: message.slice(0, 1000),
    });
    throw error;
  }
}

// CLI entry point: `proposal-pipeline process --job-id <uuid>`
const args = process.argv.slice(2);
if (args[0] === "process" && args[1] === "--job-id" && args[2]) {
  runPipeline(args[2]).catch((err) => {
    console.error("Fatal pipeline error:", err);
    process.exit(1);
  });
}
