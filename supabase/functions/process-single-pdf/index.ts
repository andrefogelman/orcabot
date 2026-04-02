// supabase/functions/process-single-pdf/index.ts
// Edge Function: processes a single PDF file with a user-provided prompt.
// The user tells the AI what to extract from this specific PDF.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getDocument, GlobalWorkerOptions } from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LLM_BASE_URL = Deno.env.get("ANTHROPIC_BASE_URL") || "http://100.91.255.19:8100";
const LLM_AUTH_TOKEN = Deno.env.get("ANTHROPIC_AUTH_TOKEN") || "sk-proxy-passthrough";
const LLM_MODEL = Deno.env.get("LLM_MODEL") || "claude-haiku-4-5-20251001";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

async function callClaude(system: string, userContent: string): Promise<string> {
  const MAX_RETRIES = 3;
  const DELAYS = [10_000, 30_000, 60_000];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${LLM_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": LLM_AUTH_TOKEN,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      console.log(`Rate limited, retrying in ${DELAYS[attempt] / 1000}s...`);
      await new Promise((r) => setTimeout(r, DELAYS[attempt]));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }
  throw new Error("Max retries exceeded");
}

function parseJsonSafe(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* ignore */ }
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1]); } catch { /* ignore */ }
  }
  return null;
}

async function extractTextFromPdf(pdfBuffer: ArrayBuffer): Promise<Array<{ page: number; text: string }>> {
  const doc = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const pages: Array<{ page: number; text: string }> = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item: any) => "str" in item)
      .map((item: any) => item.str)
      .join(" ");
    pages.push({ page: i, text });
    page.cleanup();
  }
  doc.destroy();
  return pages;
}

const SYSTEM_PROMPT = `Você é um engenheiro civil orçamentista especialista em levantamento de quantitativos a partir de projetos de construção civil brasileiros.

Você recebe o texto extraído de um PDF de projeto e uma instrução do usuário sobre o que levantar.

REGRAS:
- Analise o texto cuidadosamente para encontrar as informações solicitadas
- Extraia quantidades com unidades corretas (m², m³, m, kg, un, pt, vb)
- Inclua memorial de cálculo quando possível (ex: "Sala 3,50 x 4,20 = 14,70 m²")
- Identifique a prancha/folha (ex: ARQ-01, HID-02)
- Classifique cada item por disciplina (arquitetonico, estrutural, hidraulico, eletrico)
- Se não conseguir extrair algo com certeza, indique como "needs_review" com motivo
- Responda SEMPRE em português brasileiro

FORMATO DE RESPOSTA (JSON):
{
  "classificacao": {
    "tipo": "<tipo da prancha>",
    "prancha": "<ID da prancha>",
    "pavimento": "<pavimento>"
  },
  "itens": [
    {
      "descricao": "string",
      "quantidade": number,
      "unidade": "string",
      "memorial_calculo": "string",
      "ambiente": "string",
      "disciplina": "string",
      "confidence": number
    }
  ],
  "needs_review": [
    {
      "item": "string",
      "motivo": "string"
    }
  ],
  "resumo": "Resumo textual do levantamento em português"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const { project_id, file_id, prompt } = await req.json();

    if (!project_id || !file_id || !prompt) {
      return new Response(
        JSON.stringify({ error: "project_id, file_id, and prompt are required" }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Get file info
    const { data: fileData, error: fileErr } = await supabase
      .from("ob_project_files")
      .select("storage_path, filename, disciplina")
      .eq("id", file_id)
      .single();

    if (fileErr || !fileData) {
      return new Response(
        JSON.stringify({ error: `File not found: ${fileErr?.message}` }),
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Update file status
    await supabase
      .from("ob_project_files")
      .update({ status: "processing" })
      .eq("id", file_id);

    // Ensure job exists
    const { data: existingJob } = await supabase
      .from("ob_pdf_jobs")
      .select("id")
      .eq("file_id", file_id)
      .single();

    const jobId = existingJob?.id;
    if (jobId) {
      await supabase.from("ob_pdf_jobs").update({
        status: "processing",
        stage: "ingestion",
        progress: 10,
        started_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", jobId);
    }

    // Download PDF
    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from("project-pdfs")
      .download(fileData.storage_path);

    if (dlErr || !pdfBlob) {
      throw new Error(`Download failed: ${dlErr?.message}`);
    }

    // Extract text
    if (jobId) {
      await supabase.from("ob_pdf_jobs").update({ stage: "extraction", progress: 30 }).eq("id", jobId);
    }

    const pdfBuffer = await pdfBlob.arrayBuffer();
    const pages = await extractTextFromPdf(pdfBuffer);
    const allText = pages.map((p) => `--- PÁGINA ${p.page} ---\n${p.text}`).join("\n\n");

    console.log(`[${file_id}] Extracted ${pages.length} pages, ${allText.length} chars`);

    // Process with Claude using the user's prompt
    if (jobId) {
      await supabase.from("ob_pdf_jobs").update({ stage: "interpretation", progress: 60 }).eq("id", jobId);
    }

    const userMessage = `ARQUIVO: ${fileData.filename}
DISCIPLINA: ${fileData.disciplina || "auto-detectar"}
PÁGINAS: ${pages.length}

INSTRUÇÃO DO USUÁRIO:
${prompt}

TEXTO EXTRAÍDO DO PDF:
${allText.slice(0, 8000)}`;

    const response = await callClaude(SYSTEM_PROMPT, userMessage);
    const parsed = parseJsonSafe(response);

    // Save results to db
    if (jobId) {
      await supabase.from("ob_pdf_jobs").update({ stage: "structured_output", progress: 90 }).eq("id", jobId);
    }

    for (const { page, text } of pages) {
      const tipo = (parsed?.classificacao as any)?.tipo || "outro";
      const prancha = (parsed?.classificacao as any)?.prancha || "UNKNOWN";
      const confidence = parsed?.itens
        ? ((parsed.itens as any[]).reduce((s: number, i: any) => s + (i.confidence ?? 0.5), 0) /
            (parsed.itens as any[]).length) || 0.5
        : 0.5;
      const needsReview = parsed?.needs_review
        ? (parsed.needs_review as any[]).length > 0
        : false;
      const reviewNotes = parsed?.needs_review
        ? (parsed.needs_review as any[])
            .map((r: any) => `${r.item}: ${r.motivo}`)
            .join("; ")
        : null;

      await supabase.from("ob_pdf_pages").upsert(
        {
          file_id,
          page_number: page,
          prancha_id: prancha,
          tipo,
          text_content: text,
          ocr_used: false,
          image_path: "",
          structured_data: parsed || {},
          confidence,
          needs_review: needsReview,
          review_notes: reviewNotes,
        },
        { onConflict: "file_id,page_number" }
      );
    }

    // Mark complete
    if (jobId) {
      await supabase.from("ob_pdf_jobs").update({
        status: "done",
        stage: "done",
        progress: 100,
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
    }

    await supabase
      .from("ob_project_files")
      .update({ status: "done" })
      .eq("id", file_id);

    // Build summary for the user
    const summary = parsed?.resumo
      || (parsed?.itens
        ? `Encontrados ${(parsed.itens as any[]).length} itens:\n${(parsed.itens as any[])
            .map((i: any) => `• ${i.descricao}: ${i.quantidade} ${i.unidade}`)
            .join("\n")}`
        : response);

    const reviewCount = parsed?.needs_review ? (parsed.needs_review as any[]).length : 0;

    return new Response(
      JSON.stringify({
        success: true,
        summary: typeof summary === "string"
          ? summary
          : JSON.stringify(summary),
        items_count: parsed?.itens ? (parsed.itens as any[]).length : 0,
        review_count: reviewCount,
        pages_processed: pages.length,
        structured_data: parsed,
      }),
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
