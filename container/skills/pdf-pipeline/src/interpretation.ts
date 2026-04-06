// container/skills/pdf-pipeline/src/interpretation.ts
import { readFile } from "node:fs/promises";
import type { ClassifiedPage, Ambiente, ReviewItem, InterpretedPage } from "./types.js";
import { AmbienteSchema, ReviewItemSchema } from "./types.js";
import { INTERPRETATION_SYSTEM_PROMPT } from "./prompts.js";

interface InterpretationResult {
  ambientes: Ambiente[];
  needs_review: ReviewItem[];
}

export interface DetectedCota {
  raw: string;
  value1_m: number;
  value2_m?: number;
  area_m2?: number;
  type: 'dimension' | 'area_direct' | 'pair';
}

export function detectCotas(text: string): DetectedCota[] {
  const cotas: DetectedCota[] = [];

  // Pattern 1: "4,20 x 5,50" or "4.20 x 5.50" (pair of dimensions)
  const pairPattern = /(\d+[.,]\d+)\s*[xX×]\s*(\d+[.,]\d+)/g;
  let match;
  while ((match = pairPattern.exec(text)) !== null) {
    const v1 = parseFloat(match[1].replace(',', '.'));
    const v2 = parseFloat(match[2].replace(',', '.'));
    cotas.push({
      raw: match[0],
      value1_m: v1,
      value2_m: v2,
      area_m2: v1 * v2,
      type: 'pair',
    });
  }

  // Pattern 2: "A=25,50m²" or "25,50 m²" (direct area)
  const areaPattern = /(?:A\s*=\s*)?(\d+[.,]\d+)\s*(?:m²|m2|M2|M²)/g;
  while ((match = areaPattern.exec(text)) !== null) {
    const area = parseFloat(match[1].replace(',', '.'));
    cotas.push({
      raw: match[0],
      value1_m: area,
      area_m2: area,
      type: 'area_direct',
    });
  }

  // Pattern 3: standalone dimensions "4,20" (reasonable room dimension range 0.3-50m)
  const dimPattern = /\b(\d{1,3}[.,]\d{2})\b/g;
  while ((match = dimPattern.exec(text)) !== null) {
    const val = parseFloat(match[1].replace(',', '.'));
    // Skip if already captured as part of a pair or area
    const alreadyCaptured = cotas.some((c) => c.raw.includes(match![1]));
    if (!alreadyCaptured && val >= 0.3 && val <= 50) {
      cotas.push({
        raw: match[0],
        value1_m: val,
        type: 'dimension',
      });
    }
  }

  return cotas;
}

/**
 * Build the user prompt for interpretation, including classification context.
 */
export function buildInterpretationPrompt(page: ClassifiedPage): string {
  const cotas = detectCotas(page.text_content);
  const cotasSection = cotas.length > 0
    ? `\n--- COTAS DETECTADAS AUTOMATICAMENTE ---\n${cotas.map(c =>
        c.type === 'pair' ? `Dimensão: ${c.raw} → área = ${c.area_m2?.toFixed(2)}m²`
        : c.type === 'area_direct' ? `Área explícita: ${c.raw}`
        : `Cota: ${c.raw} = ${c.value1_m}m`
      ).join('\n')}\n--- FIM COTAS ---\n`
    : '\n--- NENHUMA COTA DETECTADA NO TEXTO ---\n';

  return `Interprete esta prancha de construção e extraia dados estruturados.

CLASSIFICAÇÃO:
- Tipo: ${page.tipo}
- Prancha: ${page.prancha}
- Pavimento: ${page.pavimento}
- Confiança classificação: ${page.classification_confidence}
${cotasSection}
--- TEXTO EXTRAÍDO ---
${page.text_content}
--- FIM TEXTO ---

Analise a imagem E o texto acima. Extraia todos os ambientes com dimensões, acabamentos e aberturas. Use as cotas detectadas automaticamente como referência. Marque itens incertos em needs_review.`;
}

/**
 * Parse the LLM interpretation response.
 */
export function parseInterpretationResponse(response: string): InterpretationResult {
  const empty: InterpretationResult = { ambientes: [], needs_review: [] };

  try {
    let jsonStr = response.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate each ambiente individually — keep valid ones, skip invalid
    const ambientes: Ambiente[] = [];
    if (Array.isArray(parsed.ambientes)) {
      for (const amb of parsed.ambientes) {
        const result = AmbienteSchema.safeParse(amb);
        if (result.success) {
          ambientes.push(result.data);
        }
      }
    }

    // Validate review items
    const needs_review: ReviewItem[] = [];
    if (Array.isArray(parsed.needs_review)) {
      for (const item of parsed.needs_review) {
        const result = ReviewItemSchema.safeParse(item);
        if (result.success) {
          needs_review.push(result.data);
        }
      }
    }

    return { ambientes, needs_review };
  } catch {
    return empty;
  }
}

/**
 * Interpret a single classified page using Claude Vision.
 * Sends both the page image and extracted text to the LLM.
 */
export async function interpretPage(
  page: ClassifiedPage,
  imagePath: string
): Promise<InterpretedPage> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "http://localhost:8100";
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN ?? "";

  // Read image as base64
  const imageBuffer = await readFile(imagePath);
  const imageBase64 = imageBuffer.toString("base64");

  // Determine media type from extension
  const mediaType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const userPrompt = buildInterpretationPrompt(page);

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": authToken,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: INTERPRETATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Interpretation API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as any;
  const text = data.content?.[0]?.text ?? "";
  const result = parseInterpretationResponse(text);

  return {
    ...page,
    ambientes: result.ambientes,
    needs_review: result.needs_review,
    image_path: imagePath,
  };
}

/**
 * Interpret all classified pages that have relevant types.
 * Skip cover pages, legends (unless quadro-acabamentos), and unclassifiable pages.
 */
export async function interpretAllPages(
  pages: ClassifiedPage[],
  renderedImages: Map<number, string>
): Promise<InterpretedPage[]> {
  const INTERPRETABLE_TYPES = new Set([
    "arquitetonico-planta-baixa",
    "arquitetonico-corte",
    "quadro-acabamentos",
    "quadro-areas",
  ]);

  const results: InterpretedPage[] = [];

  for (const page of pages) {
    const imagePath = renderedImages.get(page.page_number);
    if (!imagePath) continue;

    if (INTERPRETABLE_TYPES.has(page.tipo)) {
      const interpreted = await interpretPage(page, imagePath);
      results.push(interpreted);
    } else {
      // Non-interpretable pages still get stored with empty ambientes
      results.push({
        ...page,
        ambientes: [],
        needs_review: [],
        image_path: imagePath,
      });
    }
  }

  return results;
}
