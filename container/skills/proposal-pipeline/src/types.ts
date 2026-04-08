import { z } from "zod";

export const ProposalItemSchema = z.object({
  descricao: z.string(),
  unidade: z.string().nullable(),
  quantidade: z.number().nullable(),
  preco_unitario: z.number().nullable(),
  preco_total: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
});
export type ProposalItem = z.infer<typeof ProposalItemSchema>;

export const ProposalOutputSchema = z.object({
  fornecedor: z.string(),
  items: z.array(ProposalItemSchema),
});
export type ProposalOutput = z.infer<typeof ProposalOutputSchema>;

export type JobStatus = "pending" | "processing" | "done" | "error";

export type JobStage =
  | "pending"
  | "ingestion"
  | "extraction"
  | "structured_output"
  | "done"
  | "error";

export interface PdfJob {
  id: string;
  file_id: string;
  project_id: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export const CONFIDENCE_THRESHOLD = 0.7;
