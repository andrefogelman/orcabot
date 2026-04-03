// supabase/functions/process-single-dwg/index.ts
// Processes a single DWG/DXF file with user-provided instructions.
// Downloads the file, extracts metadata, sends to LLM for quantity takeoff.
// For DWG files: binary header is read for metadata; full geometric extraction
// happens in the NanoClaw container skill (dwg-pipeline).
// For DXF files: text-based format, we extract entities directly.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LLM_BASE_URL = Deno.env.get("ANTHROPIC_BASE_URL") || "https://king.taile4c10f.ts.net";
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
        max_tokens: 8192,
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
  if (match) { try { return JSON.parse(match[1]); } catch { /* ignore */ } }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch { /* ignore */ } }
  return null;
}

// --- DXF Text Parser ---
// DXF files are text-based. We extract key information:
// - LAYER names
// - TEXT/MTEXT entities (room names, dimensions, annotations)
// - DIMENSION entities (actual measurements)
// - INSERT entities (block references — doors, windows, electrical points)
// - LINE/LWPOLYLINE metadata (counts, layers)

interface DxfExtraction {
  layers: string[];
  texts: Array<{ content: string; layer: string }>;
  dimensions: Array<{ value: string; layer: string }>;
  blocks: Array<{ name: string; count: number; layer: string }>;
  entityCounts: Record<string, number>;
  totalEntities: number;
}

function extractFromDxf(dxfContent: string): DxfExtraction {
  const lines = dxfContent.split("\n").map(l => l.trim());
  const layers: Set<string> = new Set();
  const texts: Array<{ content: string; layer: string }> = [];
  const dimensions: Array<{ value: string; layer: string }> = [];
  const blockInserts: Map<string, { count: number; layer: string }> = new Map();
  const entityCounts: Record<string, number> = {};
  let currentLayer = "0";
  let inEntities = false;
  let currentEntityType = "";

  for (let i = 0; i < lines.length; i++) {
    const code = lines[i];
    const value = lines[i + 1] || "";

    // Track section
    if (code === "2" && value === "ENTITIES") inEntities = true;
    if (code === "0" && value === "ENDSEC") inEntities = false;

    // Layer definitions
    if (code === "0" && value === "LAYER") {
      // Next "2" code is layer name
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        if (lines[j] === "2" && lines[j + 1]) {
          layers.add(lines[j + 1]);
          break;
        }
      }
    }

    if (!inEntities) continue;

    // Entity type
    if (code === "0") {
      currentEntityType = value;
      entityCounts[value] = (entityCounts[value] || 0) + 1;
    }

    // Current layer (group code 8)
    if (code === "8") {
      currentLayer = value;
      layers.add(value);
    }

    // TEXT content (group code 1)
    if (code === "1" && (currentEntityType === "TEXT" || currentEntityType === "MTEXT")) {
      texts.push({ content: value, layer: currentLayer });
    }

    // DIMENSION measurement text (group code 1 or 42)
    if (currentEntityType === "DIMENSION") {
      if (code === "1" && value) {
        dimensions.push({ value, layer: currentLayer });
      }
      if (code === "42") {
        dimensions.push({ value: `${parseFloat(value).toFixed(3)}`, layer: currentLayer });
      }
    }

    // INSERT (block reference) — group code 2 is block name
    if (code === "2" && currentEntityType === "INSERT") {
      const existing = blockInserts.get(value);
      if (existing) {
        existing.count++;
      } else {
        blockInserts.set(value, { count: 1, layer: currentLayer });
      }
    }
  }

  const blocks = Array.from(blockInserts.entries()).map(([name, info]) => ({
    name,
    count: info.count,
    layer: info.layer,
  }));

  return {
    layers: Array.from(layers),
    texts,
    dimensions,
    blocks,
    entityCounts,
    totalEntities: Object.values(entityCounts).reduce((a, b) => a + b, 0),
  };
}

function extractFromDwgBinary(buffer: ArrayBuffer): { version: string; isDwg: boolean } {
  const bytes = new Uint8Array(buffer);
  // DWG files start with "AC10" followed by version number
  const header = String.fromCharCode(...bytes.slice(0, 6));
  const isDwg = header.startsWith("AC10") || header.startsWith("AC10");
  return { version: header, isDwg };
}

const SYSTEM_PROMPT = `Você é um engenheiro civil orçamentista senior especialista em levantamento de quantitativos para construção civil brasileira.

Você recebe dados extraídos de um arquivo DWG/DXF de projeto de construção (formato CAD) e uma instrução do usuário dizendo o que levantar.

Os dados incluem:
- LAYERS: nomes dos layers do CAD (indicam disciplinas e tipos de elementos)
- TEXTOS: textos encontrados no desenho (nomes de ambientes, cotas, anotações)
- DIMENSÕES: cotas numéricas do projeto
- BLOCOS: blocos inseridos (portas, janelas, pontos elétricos, conexões) com contagem
- ENTIDADES: contagem de linhas, polylines, círculos etc.

## REGRAS FUNDAMENTAIS

1. SEMPRE produza itens com quantidades numéricas. Nunca retorne lista vazia.
2. Use os TEXTOS para identificar ambientes e anotações.
3. Use as DIMENSÕES para valores de cotas.
4. Use os BLOCOS para contagem de componentes (portas, janelas, pontos elétricos, conexões hidráulicas).
5. Use os LAYERS para classificar a disciplina de cada item.
6. Para cada item, SEMPRE inclua:
   - descricao clara e específica
   - quantidade numérica > 0 (OBRIGATÓRIO)
   - unidade correta (m², m³, m, kg, un, vb, pt, cx, pç)
   - memorial_calculo mostrando como chegou no número
   - ambiente de onde veio a medição

7. Classificação de layers típicos:
   - Layers com "PAR", "ALV", "WALL" → alvenaria/paredes
   - Layers com "HID", "TUB", "AGUA", "ESG" → hidráulica
   - Layers com "ELE", "ILU", "TOM", "COND" → elétrica
   - Layers com "EST", "PIL", "VIG", "LAJ" → estrutural
   - Layers com "COT", "DIM" → cotas/dimensões
   - Layers com "TEXT", "ANOT" → anotações

8. Blocos típicos:
   - "TOMADA", "TUG", "TUE" → pontos de tomada (contar unidades)
   - "PONTO_LUZ", "ILUM", "LUM" → pontos de iluminação
   - "INTERR", "SWITCH" → interruptores
   - "P1", "P2", "PORTA" → portas (contar unidades)
   - "J1", "J2", "JANELA" → janelas
   - "REGISTRO", "REG" → registros hidráulicos

## FORMATO DE RESPOSTA (JSON OBRIGATÓRIO)

Responda EXCLUSIVAMENTE com JSON:

{
  "classificacao": {
    "tipo": "arquitetonico-planta-baixa | estrutural-forma | hidraulico-agua-fria | eletrico-pontos | outro",
    "prancha": "identificada dos textos ou UNKNOWN",
    "pavimento": "terreo | superior | subsolo | cobertura | indefinido"
  },
  "itens": [
    {
      "descricao": "Ponto de tomada TUG",
      "quantidade": 15,
      "unidade": "pt",
      "memorial_calculo": "Bloco TOMADA_2P inserido 15 vezes no layer ELE-TOM",
      "ambiente": "Diversos",
      "disciplina": "eletrico",
      "confidence": 0.95
    }
  ],
  "needs_review": [
    {
      "item": "descrição do item",
      "motivo": "motivo da revisão"
    }
  ],
  "resumo": "Resumo do levantamento em português"
}

IMPORTANTE: O array "itens" NUNCA pode estar vazio.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: CORS_HEADERS,
    });
  }

  let runId: string | null = null;

  try {
    const { project_id, file_id, prompt, file_type } = await req.json();

    if (!project_id || !file_id || !prompt) {
      return new Response(
        JSON.stringify({ error: "project_id, file_id, and prompt are required" }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Create processing run record
    const { data: run, error: runErr } = await supabase
      .from("ob_processing_runs")
      .insert({
        project_id,
        file_id,
        prompt,
        status: "processing",
      })
      .select("id")
      .single();

    if (runErr) {
      console.error("Failed to create run:", runErr);
    } else {
      runId = run.id;
    }

    // Get file info
    const { data: fileData, error: fileErr } = await supabase
      .from("ob_project_files")
      .select("storage_path, filename, disciplina, file_type")
      .eq("id", file_id)
      .single();

    if (fileErr || !fileData) {
      throw new Error(`File not found: ${fileErr?.message}`);
    }

    const actualFileType = file_type || fileData.file_type || "dwg";

    // Download file
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("project-pdfs")
      .download(fileData.storage_path);

    if (dlErr || !fileBlob) {
      throw new Error(`Download failed: ${dlErr?.message}`);
    }

    const buffer = await fileBlob.arrayBuffer();
    let extraction: DxfExtraction;
    let fileInfo: string;

    if (actualFileType === "dxf") {
      // DXF is text — parse directly
      const decoder = new TextDecoder("utf-8");
      const dxfText = decoder.decode(buffer);
      extraction = extractFromDxf(dxfText);
      fileInfo = `Tipo: DXF (texto, parseado diretamente)`;
    } else {
      // DWG is binary — extract what we can from header, then try to find
      // embedded text. Full geometric extraction requires the container skill.
      const dwgInfo = extractFromDwgBinary(buffer);

      if (!dwgInfo.isDwg) {
        // Maybe it's actually a DXF saved with .dwg extension
        try {
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(buffer);
          if (text.includes("SECTION") && text.includes("ENTITIES")) {
            extraction = extractFromDxf(text);
            fileInfo = `Tipo: DXF salvo como .dwg (texto, parseado)`;
          } else {
            throw new Error("not text");
          }
        } catch {
          // True binary DWG — limited extraction
          extraction = {
            layers: [],
            texts: [],
            dimensions: [],
            blocks: [],
            entityCounts: {},
            totalEntities: 0,
          };
          fileInfo = `Tipo: DWG binário (versão ${dwgInfo.version}). Extração geométrica limitada — para extração completa, use o pipeline DWG do NanoClaw.`;
        }
      } else {
        // Try text extraction from binary (some DWG files have readable strings)
        const decoder = new TextDecoder("utf-8", { fatal: false });
        const roughText = decoder.decode(buffer);
        // Extract readable strings (at least 3 chars, alphanumeric)
        const strings = roughText.match(/[\x20-\x7E]{4,}/g) || [];
        extraction = {
          layers: strings.filter(s => s.match(/^(ARQ|EST|HID|ELE|COT|PAR|TUB|ILU)/i)).slice(0, 50),
          texts: strings.filter(s => s.match(/[A-Za-z]{2,}/) && s.length > 3 && s.length < 100)
            .slice(0, 100)
            .map(s => ({ content: s, layer: "unknown" })),
          dimensions: strings.filter(s => s.match(/^\d+[\.,]\d+$/))
            .slice(0, 50)
            .map(s => ({ value: s, layer: "unknown" })),
          blocks: [],
          entityCounts: {},
          totalEntities: 0,
        };
        fileInfo = `Tipo: DWG binário (versão ${dwgInfo.version}). Extração parcial de strings.`;
      }
    }

    console.log(`[${file_id}] ${fileInfo} — ${extraction.layers.length} layers, ${extraction.texts.length} texts, ${extraction.blocks.length} blocks`);

    // Build context for Claude
    const layersList = extraction.layers.length > 0
      ? extraction.layers.join(", ")
      : "Nenhum layer identificado";

    const textsList = extraction.texts.length > 0
      ? extraction.texts.slice(0, 80).map(t => `[${t.layer}] ${t.content}`).join("\n")
      : "Nenhum texto extraído";

    const dimsList = extraction.dimensions.length > 0
      ? extraction.dimensions.slice(0, 50).map(d => `[${d.layer}] ${d.value}`).join("\n")
      : "Nenhuma cota encontrada";

    const blocksList = extraction.blocks.length > 0
      ? extraction.blocks
          .sort((a, b) => b.count - a.count)
          .slice(0, 40)
          .map(b => `${b.name}: ${b.count}x [layer: ${b.layer}]`)
          .join("\n")
      : "Nenhum bloco encontrado";

    const entitySummary = Object.entries(extraction.entityCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ");

    const userMessage = `ARQUIVO: ${fileData.filename}
${fileInfo}
DISCIPLINA: ${fileData.disciplina || "auto-detectar"}
TOTAL ENTIDADES: ${extraction.totalEntities}

LAYERS (${extraction.layers.length}):
${layersList}

TEXTOS (${extraction.texts.length}):
${textsList}

DIMENSÕES/COTAS (${extraction.dimensions.length}):
${dimsList}

BLOCOS INSERIDOS (${extraction.blocks.length}):
${blocksList}

ENTIDADES POR TIPO:
${entitySummary || "Não disponível"}

INSTRUÇÃO DO USUÁRIO:
${prompt}`;

    const response = await callClaude(SYSTEM_PROMPT, userMessage);
    const parsed = parseJsonSafe(response);

    const items = (parsed?.itens as any[]) || [];
    const needsReview = (parsed?.needs_review as any[]) || [];
    const summary = (parsed?.resumo as string) || response;

    // Save processing run
    if (runId) {
      await supabase.from("ob_processing_runs").update({
        status: "done",
        summary,
        items,
        needs_review: needsReview,
        raw_response: parsed || { raw_text: response },
        pages_processed: 1,
      }).eq("id", runId);
    }

    // Update file status
    await supabase
      .from("ob_project_files")
      .update({ status: "done" })
      .eq("id", file_id);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        summary,
        items_count: items.length,
        review_count: needsReview.length,
        file_type: actualFileType,
        extraction_stats: {
          layers: extraction.layers.length,
          texts: extraction.texts.length,
          dimensions: extraction.dimensions.length,
          blocks: extraction.blocks.length,
          total_entities: extraction.totalEntities,
        },
        structured_data: parsed,
      }),
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error("Edge function error:", err);

    if (runId) {
      await supabase.from("ob_processing_runs").update({
        status: "error",
        error_message: (err as Error).message,
      }).eq("id", runId);
    }

    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
