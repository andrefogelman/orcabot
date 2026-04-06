# Fix Completo: Pipeline de Extração DXF + PDF

**Date:** 2026-04-06
**Status:** Approved
**Goal:** Corrigir erros de 40%+ nas áreas extraídas de plantas. Tornar o levantamento confiável para uso profissional em orçamentação de obras.

---

## Problema

As áreas extraídas pelo pipeline de levantamento (DXF e PDF) têm erro médio acima de 40%, tornando a ferramenta inútil. Root causes identificados:

1. Hatches (principal fonte de áreas em DXF) são extraídos pelo Python mas descartados pelo schema TypeScript
2. Detecção de unidades assume mm quando `$INSUNITS=0` (unitless), mas muitos DXFs BR usam cm ou m
3. Thresholds de área inconsistentes entre layer-classifier (1m²) e structured-output (0.5m²)
4. PDF pipeline delega cálculo de área inteiramente à LLM sem pré-processamento
5. Nenhuma validação de sanidade nas áreas calculadas
6. PDF pipeline usa Haiku hardcoded e fetch direto ao proxy Anthropic (não usa provider unificado)

## Estrutura: 3 Sub-Projetos

```
Sub-Projeto A: DXF Pipeline — Precisão Geométrica (Fixes 1-5)
Sub-Projeto B: PDF Pipeline — Extração Precisa (Fixes 6-9)
Sub-Projeto C: Validação Cross-Pipeline (Fixes 10-11)
```

Execução sequencial: A → B → C. Cada sub-projeto é testável e deployável independentemente.

---

## Sub-Projeto A: DXF Pipeline — Precisão Geométrica

### Fix 1: Hatches no schema TypeScript

**Problema:** `container/skills/dwg-pipeline/python/dwg_extractor.py` extrai hatches (linhas 324-366) com layer, pattern, area e vertices. O output JSON inclui `hatches` e `stats.total_hatches`. Porém `container/skills/dwg-pipeline/src/types.ts` (linhas 145-160) define `ExtractedDxfDataSchema` sem campo `hatches` — o Zod `.parse()` descarta silenciosamente.

**Solução:**

Em `types.ts`, adicionar ao `ExtractedDxfDataSchema`:

```typescript
export const DxfHatchSchema = z.object({
  layer: z.string(),
  pattern: z.string(),
  area: z.number(),
  vertices: z.array(z.array(z.number()).length(2)).optional(),
});
export type DxfHatch = z.infer<typeof DxfHatchSchema>;
```

E no schema principal:

```typescript
export const ExtractedDxfDataSchema = z.object({
  // ... existing fields ...
  hatches: z.array(DxfHatchSchema),
  stats: z.object({
    // ... existing fields ...
    total_hatches: z.number(),
  }),
});
```

**Impacto:** Recupera 30-40% dos dados de área que estavam sendo perdidos.

### Fix 2: Detecção de unidades inteligente

**Problema:** `dwg_extractor.py:369-383` — quando `$INSUNITS=0` (unitless), assume mm. Muitos arquitetos BR configuram `$INSUNITS=0` mas desenham em cm ou m. Resultado: erro de 10× ou 100× na área.

**Solução:** Adicionar heurística baseada no bounding box de todas as entidades:

```python
def detect_units(doc: ezdxf.document.Drawing, msp: Any) -> str:
    """Detect drawing units from DXF header, with bbox fallback for unitless."""
    try:
        insunits = doc.header.get("$INSUNITS", 0)
        unit_map = {
            1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m",
        }
        if insunits in unit_map:
            return unit_map[insunits]
    except Exception:
        pass

    # Unitless or unknown — infer from bounding box
    return _infer_units_from_bbox(msp)


def _infer_units_from_bbox(msp: Any) -> str:
    """Infer units by analyzing the bounding box of all entities.
    
    Typical residential building footprints:
    - In meters: bbox ~ 5-50 (both axes)
    - In centimeters: bbox ~ 500-5000
    - In millimeters: bbox ~ 5000-50000
    """
    min_x, min_y = float('inf'), float('inf')
    max_x, max_y = float('-inf'), float('-inf')
    count = 0

    for entity in msp:
        etype = entity.dxftype()
        try:
            if etype == "LINE":
                for pt in [entity.dxf.start, entity.dxf.end]:
                    min_x, min_y = min(min_x, pt.x), min(min_y, pt.y)
                    max_x, max_y = max(max_x, pt.x), max(max_y, pt.y)
                    count += 1
            elif etype == "LWPOLYLINE":
                for v in entity.get_points(format="xy"):
                    min_x, min_y = min(min_x, v[0]), min(min_y, v[1])
                    max_x, max_y = max(max_x, v[0]), max(max_y, v[1])
                    count += 1
            elif etype == "CIRCLE":
                c = entity.dxf.center
                r = entity.dxf.radius
                min_x, min_y = min(min_x, c.x - r), min(min_y, c.y - r)
                max_x, max_y = max(max_x, c.x + r), max(max_y, c.y + r)
                count += 1
        except Exception:
            continue

    if count < 10:
        return "mm"  # Not enough data, safe default

    width = max_x - min_x
    height = max_y - min_y
    max_dim = max(width, height)

    if max_dim < 1:
        return "m"  # Suspiciously small, probably not a building
    elif max_dim <= 100:
        return "m"
    elif max_dim <= 10_000:
        return "cm"
    else:
        return "mm"
```

A assinatura de `detect_units` muda para receber `msp` além de `doc`. Atualizar a chamada em `main()`.

**Impacto:** Elimina erros de 10×-100× em DXFs com `$INSUNITS=0`.

### Fix 3: Threshold de área unificado

**Problema:** `layer-classifier.ts:99` usa `area > 1_000_000` (>1m² em mm²) para detectar layers arquitetônicos. `structured-output.ts:134` usa `area > 500_000` (>0.5m²). Um ambiente de 0.7m² (lavabo pequeno) é detectado como arq mas depois filtrado.

**Solução:** Unificar em `500_000` (0.5m² em mm²) em ambos os arquivos. Extrair como constante compartilhada:

Em `types.ts`:
```typescript
/** Minimum area in mm² to consider a closed polyline as a room boundary */
export const MIN_ROOM_AREA_MM2 = 500_000; // 0.5 m²
```

Usar `MIN_ROOM_AREA_MM2` em `layer-classifier.ts:99` e `structured-output.ts:134`.

### Fix 4: Validação cruzada de áreas (DXF)

**Problema:** Nenhuma validação de sanidade. Áreas absurdas (0.001m² ou 50.000m²) passam sem flag.

**Solução:** Após calcular `area_m2` e `perimetro_m` em `structured-output.ts`, aplicar validação:

```typescript
interface AreaValidation {
  valid: boolean;
  flags: string[];
  adjusted_confidence: number;
}

function validateArea(
  area_m2: number,
  perimetro_m: number,
  nome: string,
  base_confidence: number,
): AreaValidation {
  const flags: string[] = [];
  let confidence = base_confidence;

  // 1. Área zero ou negativa
  if (area_m2 <= 0) {
    return { valid: false, flags: ['area_zero'], adjusted_confidence: 0 };
  }

  // 2. Área fora de range realista (ambientes residenciais/comerciais BR)
  if (area_m2 < 1.0) {
    flags.push('area_muito_pequena');
    confidence *= 0.5;
  }
  if (area_m2 > 500) {
    flags.push('area_muito_grande_ambiente_unico');
    confidence *= 0.3;
  }

  // 3. Isoperimetric ratio: 4π × area / perimeter²
  // Círculo = 1.0, quadrado ≈ 0.785, retângulo 2:1 ≈ 0.698
  // Abaixo de 0.1 = polígono muito irregular/degenerado
  if (perimetro_m > 0) {
    const ratio = (4 * Math.PI * area_m2) / (perimetro_m * perimetro_m);
    if (ratio < 0.05) {
      flags.push('poligono_degenerado');
      confidence *= 0.2;
    } else if (ratio > 1.1) {
      flags.push('inconsistencia_perimetro_area');
      confidence *= 0.3;
    }
  }

  // 4. Ranges por tipo de ambiente (heurística BR)
  const ranges: Record<string, [number, number]> = {
    'banheiro': [1.5, 15],
    'wc': [1.0, 6],
    'lavabo': [1.0, 6],
    'cozinha': [4, 40],
    'sala': [8, 100],
    'quarto': [6, 40],
    'suite': [8, 50],
    'varanda': [2, 40],
    'garagem': [10, 80],
    'area de servico': [2, 15],
    'circulacao': [1, 30],
    'hall': [2, 30],
    'deposito': [1, 20],
    'despensa': [1, 10],
  };

  const nomeLower = nome.toLowerCase();
  for (const [tipo, [min, max]] of Object.entries(ranges)) {
    if (nomeLower.includes(tipo)) {
      if (area_m2 < min * 0.5 || area_m2 > max * 2) {
        flags.push(`area_fora_range_${tipo}`);
        confidence *= 0.5;
      }
      break;
    }
  }

  return {
    valid: flags.length === 0 || confidence > 0.3,
    flags,
    adjusted_confidence: Math.max(0, Math.min(1, confidence)),
  };
}
```

Integrar na `buildAmbientes()`: após calcular `area_m2`, rodar `validateArea()`. Se `valid=false`, ainda incluir o ambiente mas com `confidence` ajustado e flags em `needs_review`.

### Fix 5: Hierarquia de fontes de área (Hatches como primários)

**Problema:** O pipeline só usa LWPOLYLINE para áreas. Hatches (preenchimentos de piso) são a fonte mais confiável porque o projetista preencheu intencionalmente.

**Solução:** Em `buildAmbientes()`, após coletar `roomPolylines`, também coletar hatches de layers arquitetônicos:

```typescript
// 1. Collect hatches on architectural layers
const roomHatches = data.hatches.filter(
  (h) => arqLayers.has(h.layer) && toSquareMeters(h.area, data.units) > 0.5
);

// 2. For each hatch, check if it overlaps with a polyline room
// If yes: use hatch area (more precise, intentional fill)
// If no: create ambiente from hatch alone (room without explicit boundary)
```

Lógica de merge:
- Para cada polyline room, buscar hatches cujos vértices estão dentro do polyline (ou cujo centróide está dentro)
- Se encontrar hatch correspondente: `area_m2 = hatch.area` (sobrescreve polyline area)
- Hatches órfãos (sem polyline correspondente): criar ambiente novo com área do hatch
- Flag `area_source: 'hatch' | 'polyline' | 'hatch+polyline'` para rastreabilidade

O centróide do hatch é calculado como média dos vértices. O teste point-in-polygon já existe em `extractor.ts` (via `associateTextsToRooms`).

---

## Sub-Projeto B: PDF Pipeline — Extração Precisa

### Fix 6: Prompt de interpretação reescrito

**Problema:** `prompts.ts:51-116` — prompt genérico, sem regras para notação BR, sem exemplos, permite adivinhação.

**Solução:** Reescrever `INTERPRETATION_SYSTEM_PROMPT`:

```typescript
export const INTERPRETATION_SYSTEM_PROMPT = `Você é um especialista em leitura de projetos de construção civil brasileira.

Você recebe:
1. Uma IMAGEM de uma prancha de projeto
2. O TEXTO extraído dessa prancha
3. A CLASSIFICAÇÃO da prancha (tipo, ID, pavimento)
4. COTAS DETECTADAS automaticamente (se houver)

REGRAS CRÍTICAS DE EXTRAÇÃO:

1. NOTAÇÃO BRASILEIRA:
   - Vírgula é separador decimal: "5,50" = 5.50 metros
   - Ponto pode ser separador de milhar: "1.250" = 1250
   - Símbolo de área: m², M2, m2
   - Cotas em metros por padrão em plantas baixas

2. CÁLCULO DE ÁREAS:
   - Se encontrar cotas de largura × comprimento: calcular área = largura × comprimento
   - Se encontrar área explícita (ex: "A=25,50m²"): usar diretamente
   - Se encontrar apenas uma dimensão: NÃO calcular, marcar confidence 0.0
   - NUNCA inventar ou estimar áreas — se não encontrar dados, confidence = 0.0

3. COMO LER COTAS EM PLANTAS BAIXAS:
   - Cotas são linhas com valores numéricos nas extremidades
   - Cotas externas dão dimensões totais do ambiente
   - Cotas internas subdividem o ambiente
   - A largura total de um cômodo é a soma das cotas parciais naquela direção

4. PERÍMETRO:
   - Somar todas as cotas que formam o contorno do ambiente
   - Se não encontrar todas as cotas: perimetro_m = 0, confidence reduzido

5. CONFIDENCE:
   - 0.90-1.00: cotas claramente legíveis, cálculo direto
   - 0.70-0.89: cotas legíveis mas alguma inferência necessária
   - 0.50-0.69: parcialmente legível, incerto
   - 0.00-0.49: dados insuficientes para calcular

EXEMPLO:
Uma planta baixa mostra:
- "SALA" com cotas 4,20 e 5,50
- area_m2 = 4.20 × 5.50 = 23.10
- perimetro_m = 2 × (4.20 + 5.50) = 19.40
- confidence = 0.95

Responda APENAS com um JSON:
{
  "ambientes": [
    {
      "nome": "string",
      "area_m2": number,
      "perimetro_m": number,
      "pe_direito_m": number,
      "acabamentos": {
        "piso": "string",
        "parede": "string",
        "forro": "string",
        "rodape": "string (optional)",
        "soleira": "string (optional)"
      },
      "aberturas": [
        { "tipo": "porta|janela|portao|basculante|maxim-ar|outro", "dim": "LxA", "qtd": number, "codigo": "P1 (optional)" }
      ],
      "confidence": number
    }
  ],
  "needs_review": [
    {
      "ambiente": "nome do ambiente",
      "campo": "campo incerto",
      "motivo": "explicação em português",
      "confidence": number
    }
  ]
}`;
```

### Fix 7: Regex de cotas pré-LLM

**Problema:** A LLM recebe texto bruto e precisa encontrar dimensões sozinha. Muitas vezes erra.

**Solução:** Em `interpretation.ts`, adicionar pré-processamento antes de chamar a LLM:

```typescript
interface DetectedCota {
  raw: string;
  value1_m: number;
  value2_m?: number;
  area_m2?: number;
  type: 'dimension' | 'area_direct' | 'pair';
}

function detectCotas(text: string): DetectedCota[] {
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

  // Pattern 2: "A=25,50m²" or "25,50 m²" or "25.50m2" (direct area)
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

  // Pattern 3: standalone dimensions "4,20" near meter context
  const dimPattern = /\b(\d{1,3}[.,]\d{2})\b/g;
  while ((match = dimPattern.exec(text)) !== null) {
    const val = parseFloat(match[1].replace(',', '.'));
    if (val >= 0.3 && val <= 50) { // reasonable room dimension range
      cotas.push({
        raw: match[0],
        value1_m: val,
        type: 'dimension',
      });
    }
  }

  return cotas;
}
```

Integrar no `buildInterpretationPrompt()`:

```typescript
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
```

### Fix 8: Confidence real (mínimo, não média)

**Problema:** `confidence.ts:7-11` — confidence da página é média dos ambientes. Uma página com 5 ambientes a 0.95 e 1 a 0.20 resulta em 0.82 (engana).

**Solução:** Em `confidence.ts`:

```typescript
export function computePageConfidence(ambientes: Ambiente[]): number {
  if (ambientes.length === 0) return 0;
  return Math.min(...ambientes.map((amb) => amb.confidence));
}
```

### Fix 9: PDF pipeline usa provider unificado

**Problema:** `interpretation.ts:82-125` faz fetch direto ao proxy Anthropic com Haiku hardcoded. Não usa o provider unificado criado no Sub-Projeto anterior (LLM hybrid provider). Quando `LLM_PROVIDER=gemini`, o PDF pipeline continua chamando Anthropic.

**Solução:** Este fix tem uma complicação: o PDF pipeline roda dentro do container Docker, não no processo principal. O container não tem acesso ao `src/llm/` do host. Duas opções:

**Opção escolhida: Proxy via api-channel**
O container já se comunica com o host via IPC. Adicionar um endpoint interno no api-channel que o container pode chamar para fazer LLM requests via provider unificado. Assim o container não precisa saber qual provider está ativo.

Alternativamente, para simplificar a primeira iteração: mudar o fetch no `interpretation.ts` para ler `LLM_MODEL` e `LLM_PROVIDER` de env vars do container, e incluir um client Gemini inline. Isso é mais pragmático e não depende de mudanças no IPC.

**Decisão: opção pragmática** — adicionar suporte a Gemini direto no `interpretation.ts` do container, lendo env vars. O container recebe `GOOGLE_API_KEY` e `LLM_PROVIDER` como env vars na criação.

Nota: Gemini 2.5 Pro suporta visão (imagem + texto) via a mesma API `generateContent`, então a migração é direta. O formato muda de Anthropic image blocks para Gemini inline_data.

---

## Sub-Projeto C: Validação Cross-Pipeline

### Fix 10: Validador de sanidade compartilhado

**Problema:** Nenhum dos pipelines valida se as áreas calculadas fazem sentido.

**Solução:** Criar módulo compartilhado usado por ambos os pipelines. A função `validateArea()` descrita no Fix 4 é extraída para um módulo próprio que pode ser importado tanto pelo DXF pipeline quanto pelo PDF pipeline:

Arquivo: `container/skills/shared/area-validator.ts`

```typescript
export interface AreaValidation {
  valid: boolean;
  flags: string[];
  adjusted_confidence: number;
}

export function validateArea(
  area_m2: number,
  perimetro_m: number,
  nome: string,
  base_confidence: number,
): AreaValidation {
  // ... (mesma implementação do Fix 4)
}
```

Este módulo é importado por:
- `container/skills/dwg-pipeline/src/structured-output.ts`
- `container/skills/pdf-pipeline/src/interpretation.ts` (pós-parse)

### Fix 11: Relatório de qualidade por prancha

**Problema:** Não há como saber se uma extração foi confiável sem inspecionar manualmente.

**Solução:** Após extração (DXF ou PDF), gerar um score de qualidade:

```typescript
interface QualityReport {
  total_ambientes: number;
  valid_ambientes: number;
  flagged_ambientes: number;
  rejected_ambientes: number;
  flags_summary: Record<string, number>; // contagem por tipo de flag
  quality_score: number; // 0.0-1.0
  area_source: 'hatch' | 'polyline' | 'llm_text' | 'mixed';
}
```

O `quality_score` é salvo em `ob_pdf_pages.quality_score` (adicionar coluna se não existir). O frontend pode mostrar um indicador visual de confiança.

---

## Arquivos Modificados

### Sub-Projeto A (DXF):
| Arquivo | Ação |
|---------|------|
| `container/skills/dwg-pipeline/src/types.ts` | Add DxfHatchSchema, MIN_ROOM_AREA_MM2, update ExtractedDxfDataSchema |
| `container/skills/dwg-pipeline/python/dwg_extractor.py` | Fix detect_units com bbox heuristic |
| `container/skills/dwg-pipeline/src/layer-classifier.ts` | Use MIN_ROOM_AREA_MM2 |
| `container/skills/dwg-pipeline/src/structured-output.ts` | Use MIN_ROOM_AREA_MM2, add hatch integration, add area validation |

### Sub-Projeto B (PDF):
| Arquivo | Ação |
|---------|------|
| `container/skills/pdf-pipeline/src/prompts.ts` | Rewrite INTERPRETATION_SYSTEM_PROMPT |
| `container/skills/pdf-pipeline/src/interpretation.ts` | Add detectCotas, update prompt builder, add Gemini support |
| `container/skills/pdf-pipeline/src/confidence.ts` | Change average to minimum |

### Sub-Projeto C (Validação):
| Arquivo | Ação |
|---------|------|
| `container/skills/shared/area-validator.ts` | Create — shared validation logic |
| `container/skills/dwg-pipeline/src/structured-output.ts` | Import and use area-validator |
| `container/skills/pdf-pipeline/src/interpretation.ts` | Import and use area-validator post-parse |

---

## Testes

Cada fix deve ter testes unitários:

- **Fix 1:** Test que hatches passam pelo schema Zod
- **Fix 2:** Test `_infer_units_from_bbox` com bboxes típicos (m, cm, mm)
- **Fix 3:** Test que ambientes de 0.7m² não são filtrados
- **Fix 4:** Test `validateArea` com casos: normal, degenerado, fora de range, banheiro 50m²
- **Fix 5:** Test merge hatch+polyline: hatch area sobrescreve polyline area
- **Fix 6:** Snapshot test do novo prompt
- **Fix 7:** Test `detectCotas` com "4,20 x 5,50", "A=25,50m²", "3.50"
- **Fix 8:** Test que min confidence é usado, não média
- **Fix 9:** Test que Gemini é chamado quando LLM_PROVIDER=gemini
- **Fix 10:** Test `validateArea` (mesmos do Fix 4, exportado)
- **Fix 11:** Test `QualityReport` computation

## Impacto Esperado

| Fix | Impacto estimado na precisão |
|-----|------------------------------|
| Fix 1 (Hatches) | +30-40% — recupera dados primários |
| Fix 2 (Unidades) | +20% — elimina erros de 10×-100× |
| Fix 3 (Threshold) | +5% — para de perder lavabos/banheiros pequenos |
| Fix 4+10 (Validação) | +10% — rejeita absurdos |
| Fix 5 (Hierarquia) | +10% — usa fonte mais precisa |
| Fix 6+7 (Prompt+Regex) | +15% — LLM erra menos com dados pré-processados |
| Fix 8 (Confidence) | Qualitativo — mostra ao usuário quando revisar |
| Fix 9 (Provider) | Qualitativo — Gemini 2.5 Pro melhor que Haiku em visão |
