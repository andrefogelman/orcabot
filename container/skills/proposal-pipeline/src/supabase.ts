import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PdfJob, ProposalItem } from "./types.js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  client = createClient(url, key);
  return client;
}

export function setSupabase(sb: SupabaseClient): void {
  client = sb;
}

export async function getJob(jobId: string): Promise<PdfJob> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_pdf_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(`Failed to fetch job ${jobId}: ${error.message}`);
  return data as PdfJob;
}

export async function updateJob(
  jobId: string,
  updates: Partial<Pick<PdfJob, "status" | "stage" | "progress" | "error_message" | "started_at" | "completed_at">>
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("ob_pdf_jobs").update(updates).eq("id", jobId);
  if (error) throw new Error(`Failed to update job ${jobId}: ${error.message}`);
}

export async function getFileStoragePath(fileId: string): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_project_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();
  if (error) throw new Error(`Failed to fetch file ${fileId}: ${error.message}`);
  return data.storage_path;
}

export async function downloadPdf(storagePath: string, localPath: string): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from("project-pdfs")
    .download(storagePath);
  if (error) throw new Error(`Failed to download ${storagePath}: ${error.message}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  const { writeFile } = await import("node:fs/promises");
  await writeFile(localPath, buffer);
}

export async function getOrCreatePropostaByFileId(fileId: string): Promise<{ id: string; project_id: string }> {
  const sb = getSupabase();

  // Try to find existing proposta
  const { data: existing } = await sb
    .from("ob_propostas")
    .select("id, project_id")
    .eq("file_id", fileId)
    .limit(1);

  if (existing && existing.length > 0) return existing[0];

  // No proposta exists — create one from the file record
  const { data: fileData, error: fileErr } = await sb
    .from("ob_project_files")
    .select("project_id, filename")
    .eq("id", fileId)
    .single();
  if (fileErr) throw new Error(`File not found ${fileId}: ${fileErr.message}`);

  const { data: created, error: createErr } = await sb
    .from("ob_propostas")
    .insert({
      project_id: fileData.project_id,
      file_id: fileId,
      fornecedor: fileData.filename.replace(/\.pdf$/i, ""),
      status: "pending",
    })
    .select("id, project_id")
    .single();
  if (createErr) throw new Error(`Failed to create proposta: ${createErr.message}`);

  return created;
}

export async function upsertPropostaItems(
  propostaId: string,
  items: ProposalItem[]
): Promise<void> {
  const sb = getSupabase();

  await sb.from("ob_proposta_items").delete().eq("proposta_id", propostaId);

  if (items.length === 0) return;

  const rows = items.map((item) => ({
    proposta_id: propostaId,
    descricao: item.descricao,
    unidade: item.unidade,
    quantidade: item.quantidade,
    preco_unitario: item.preco_unitario,
    preco_total: item.preco_total,
    confidence: item.confidence,
    needs_review: item.needs_review,
  }));

  const { error } = await sb.from("ob_proposta_items").insert(rows);
  if (error) throw new Error(`Failed to insert proposta items: ${error.message}`);
}

export async function updatePropostaAfterExtraction(
  propostaId: string,
  fornecedor: string,
  valorTotal: number
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("ob_propostas")
    .update({
      fornecedor,
      valor_total: valorTotal,
      status: "extracted",
    })
    .eq("id", propostaId);
  if (error) throw new Error(`Failed to update proposta: ${error.message}`);
}
