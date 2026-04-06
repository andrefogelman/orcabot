import { describe, it, expect, vi } from "vitest";
import {
  buildInterpretationPrompt,
  parseInterpretationResponse,
  detectCotas,
} from "../src/interpretation.js";
import type { ClassifiedPage } from "../src/types.js";
import { INTERPRETATION_SYSTEM_PROMPT } from "../src/prompts.js";

describe("detectCotas", () => {
  it("detects pair dimensions with comma decimal (BR)", () => {
    const cotas = detectCotas("SALA 4,20 x 5,50");
    const pairs = cotas.filter((c) => c.type === "pair");
    expect(pairs.length).toBe(1);
    expect(pairs[0].value1_m).toBeCloseTo(4.2);
    expect(pairs[0].value2_m).toBeCloseTo(5.5);
    expect(pairs[0].area_m2).toBeCloseTo(23.1);
  });

  it("detects pair dimensions with dot decimal", () => {
    const cotas = detectCotas("QUARTO 3.50 x 4.00");
    const pairs = cotas.filter((c) => c.type === "pair");
    expect(pairs.length).toBe(1);
    expect(pairs[0].area_m2).toBeCloseTo(14.0);
  });

  it("detects direct area with m²", () => {
    const cotas = detectCotas("Area total: 25,50 m²");
    const areas = cotas.filter((c) => c.type === "area_direct");
    expect(areas.length).toBe(1);
    expect(areas[0].area_m2).toBeCloseTo(25.5);
  });

  it("detects A= pattern", () => {
    const cotas = detectCotas("A = 12,80m²");
    const areas = cotas.filter((c) => c.type === "area_direct");
    expect(areas.length).toBe(1);
    expect(areas[0].area_m2).toBeCloseTo(12.8);
  });

  it("detects standalone dimensions", () => {
    const cotas = detectCotas("3,50  cota  4,20");
    const dims = cotas.filter((c) => c.type === "dimension");
    expect(dims.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty for text without dimensions", () => {
    const cotas = detectCotas("PLANTA BAIXA - PAVIMENTO TERREO");
    expect(cotas.length).toBe(0);
  });
});

describe("buildInterpretationPrompt with cotas", () => {
  it("includes detected cotas section when cotas found", () => {
    const page = {
      page_number: 1,
      text_content: "SALA 4,20 x 5,50",
      tipo: "arquitetonico-planta-baixa",
      prancha: "ARQ-01",
      pavimento: "terreo",
      classification_confidence: 0.95,
      ocr_used: false,
      char_count: 100,
    };
    const prompt = buildInterpretationPrompt(page as any);
    expect(prompt).toContain("COTAS DETECTADAS AUTOMATICAMENTE");
    expect(prompt).toContain("23.10");
  });

  it("shows no cotas message when none found", () => {
    const page = {
      page_number: 1,
      text_content: "PLANTA BAIXA",
      tipo: "arquitetonico-planta-baixa",
      prancha: "ARQ-01",
      pavimento: "terreo",
      classification_confidence: 0.95,
      ocr_used: false,
      char_count: 50,
    };
    const prompt = buildInterpretationPrompt(page as any);
    expect(prompt).toContain("NENHUMA COTA DETECTADA");
  });
});

describe("INTERPRETATION_SYSTEM_PROMPT", () => {
  it("includes Brazilian notation rules", () => {
    expect(INTERPRETATION_SYSTEM_PROMPT).toContain("NOTAÇÃO BRASILEIRA");
    expect(INTERPRETATION_SYSTEM_PROMPT).toContain("Vírgula é separador decimal");
  });
  it("includes calculation rules", () => {
    expect(INTERPRETATION_SYSTEM_PROMPT).toContain("CÁLCULO DE ÁREAS");
    expect(INTERPRETATION_SYSTEM_PROMPT).toContain("NUNCA inventar ou estimar");
  });
  it("includes confidence scale", () => {
    expect(INTERPRETATION_SYSTEM_PROMPT).toContain("0.90-1.00");
    expect(INTERPRETATION_SYSTEM_PROMPT).toContain("0.00-0.49");
  });
  it("includes example calculation", () => {
    expect(INTERPRETATION_SYSTEM_PROMPT).toContain("4.20 × 5.50 = 23.10");
  });
});

describe("buildInterpretationPrompt", () => {
  it("includes classification context in the prompt", () => {
    const page: ClassifiedPage = {
      page_number: 1,
      text_content: "SALA 18.50m\u00B2 COZINHA 12.30m\u00B2",
      ocr_used: false,
      char_count: 30,
      tipo: "arquitetonico-planta-baixa",
      prancha: "ARQ-01",
      pavimento: "terreo",
      classification_confidence: 0.95,
    };
    const prompt = buildInterpretationPrompt(page);
    expect(prompt).toContain("arquitetonico-planta-baixa");
    expect(prompt).toContain("ARQ-01");
    expect(prompt).toContain("terreo");
    expect(prompt).toContain("SALA 18.50m\u00B2");
  });
});

describe("interpretPage provider selection", () => {
  it("uses Gemini when LLM_PROVIDER=gemini", async () => {
    // This is a structural test — verify the function reads LLM_PROVIDER
    // We can't easily integration test without a real API, so test the provider detection
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("GOOGLE_API_KEY", "test-key");
    vi.stubEnv("LLM_MODEL", "gemini-2.5-pro");

    // The function should attempt Gemini API, not Anthropic
    // We mock fetch to verify the correct URL is called
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: '{"ambientes":[],"needs_review":[]}' }] } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { interpretPage } = await import("../src/interpretation.js");

    const page = {
      page_number: 1,
      text_content: "SALA 4,20 x 5,50",
      tipo: "arquitetonico-planta-baixa" as const,
      prancha: "ARQ-01",
      pavimento: "terreo",
      classification_confidence: 0.95,
      ocr_used: false,
      char_count: 100,
    };

    // Create a minimal test image file
    const fs = await import("node:fs/promises");
    const tmpImage = "/tmp/test-page.png";
    await fs.writeFile(tmpImage, Buffer.from("fake-png-data"));

    await interpretPage(page as any, tmpImage);

    // Verify Gemini API was called (generativelanguage.googleapis.com), not Anthropic
    expect(mockFetch).toHaveBeenCalled();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("generativelanguage.googleapis.com");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fs.unlink(tmpImage).catch(() => {});
  });
});

describe("parseInterpretationResponse", () => {
  it("parses valid interpretation JSON", () => {
    const response = JSON.stringify({
      ambientes: [
        {
          nome: "Sala",
          area_m2: 18.5,
          perimetro_m: 17.4,
          pe_direito_m: 2.8,
          acabamentos: {
            piso: "porcelanato 60x60 retificado",
            parede: "pintura latex branco",
            forro: "gesso liso",
          },
          aberturas: [
            { tipo: "porta", dim: "0.80x2.10", qtd: 1 },
            { tipo: "janela", dim: "1.50x1.20", qtd: 2 },
          ],
          confidence: 0.92,
        },
      ],
      needs_review: [],
    });
    const result = parseInterpretationResponse(response);
    expect(result.ambientes).toHaveLength(1);
    expect(result.ambientes[0].nome).toBe("Sala");
    expect(result.ambientes[0].area_m2).toBe(18.5);
    expect(result.needs_review).toHaveLength(0);
  });

  it("returns empty result for unparseable response", () => {
    const result = parseInterpretationResponse("garbage");
    expect(result.ambientes).toHaveLength(0);
    expect(result.needs_review).toHaveLength(0);
  });

  it("extracts JSON from markdown code blocks", () => {
    const response = '```json\n{"ambientes":[],"needs_review":[]}\n```';
    const result = parseInterpretationResponse(response);
    expect(result.ambientes).toHaveLength(0);
  });
});
