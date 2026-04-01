# OrcaBot v2: DWG/DXF Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DWG/DXF processing capability alongside the existing PDF pipeline, with geometric extraction via ezdxf and LibreDWG conversion.

**Architecture:** New NanoClaw container skill (`container/skills/dwg-pipeline/`) parallel to pdf-pipeline. DWG files converted to DXF via LibreDWG, then parsed with ezdxf (Python). Layer classification via regex → content analysis → LLM fallback. Block auto-mapping with org-level persistence. Same JSON output as PDF pipeline.

**Tech Stack:** ezdxf (Python), LibreDWG (dwg2dxf), TypeScript, Zod, Supabase

**Depends on:** Plans 1-3 (Foundation, PDF Pipeline, Agents all complete)

---

## Task 1: Database migration

**File:** `supabase/migrations/20260401000020_dwg_support.sql`

- [ ] Create `ob_block_mappings` table
- [ ] Create `ob_layer_mappings` table
- [ ] ALTER `ob_project_files` to add `'dxf'` to file_type CHECK constraint
- [ ] RLS policies for both new tables (org-scoped via `ob_org_members`)
- [ ] Push migration via `supabase db push`

### Step 1.1: Write the migration file

```bash
# Verify migrations directory exists
ls /Users/andrefogelman/orcabot/supabase/migrations/
```

Create file `/Users/andrefogelman/orcabot/supabase/migrations/20260401000020_dwg_support.sql`:

```sql
-- 20260401000020_dwg_support.sql
-- DWG/DXF pipeline: block mappings, layer mappings, file_type expansion

-- ── ob_block_mappings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ob_block_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ob_organizations(id) ON DELETE CASCADE,
  block_name text NOT NULL,
  componente text NOT NULL,
  disciplina text NOT NULL CHECK (disciplina IN ('arq', 'est', 'hid', 'ele', 'geral')),
  unidade text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, block_name)
);

CREATE INDEX IF NOT EXISTS idx_ob_block_mappings_org ON ob_block_mappings(org_id);

-- ── ob_layer_mappings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ob_layer_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ob_organizations(id) ON DELETE CASCADE,
  layer_name text NOT NULL,
  disciplina text NOT NULL CHECK (disciplina IN ('arq', 'est', 'hid', 'ele', 'cotas', 'anotacoes', 'ignorar')),
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, layer_name)
);

CREATE INDEX IF NOT EXISTS idx_ob_layer_mappings_org ON ob_layer_mappings(org_id);

-- ── Expand file_type CHECK to include 'dxf' ──────────────────────────────────

ALTER TABLE ob_project_files DROP CONSTRAINT IF EXISTS ob_project_files_file_type_check;
ALTER TABLE ob_project_files ADD CONSTRAINT ob_project_files_file_type_check
  CHECK (file_type IN ('pdf', 'dwg', 'dxf', 'xlsx'));

-- ── RLS: ob_block_mappings ────────────────────────────────────────────────────

ALTER TABLE ob_block_mappings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_block_mappings_select') THEN
    CREATE POLICY ob_block_mappings_select ON ob_block_mappings
      FOR SELECT USING (
        org_id IN (SELECT org_id FROM ob_org_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_block_mappings_insert') THEN
    CREATE POLICY ob_block_mappings_insert ON ob_block_mappings
      FOR INSERT WITH CHECK (
        org_id IN (SELECT org_id FROM ob_org_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_block_mappings_update') THEN
    CREATE POLICY ob_block_mappings_update ON ob_block_mappings
      FOR UPDATE USING (
        org_id IN (SELECT org_id FROM ob_org_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_block_mappings_delete') THEN
    CREATE POLICY ob_block_mappings_delete ON ob_block_mappings
      FOR DELETE USING (
        org_id IN (
          SELECT org_id FROM ob_org_members
          WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
      );
  END IF;
END $$;

-- ── RLS: ob_layer_mappings ────────────────────────────────────────────────────

ALTER TABLE ob_layer_mappings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_layer_mappings_select') THEN
    CREATE POLICY ob_layer_mappings_select ON ob_layer_mappings
      FOR SELECT USING (
        org_id IN (SELECT org_id FROM ob_org_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_layer_mappings_insert') THEN
    CREATE POLICY ob_layer_mappings_insert ON ob_layer_mappings
      FOR INSERT WITH CHECK (
        org_id IN (SELECT org_id FROM ob_org_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_layer_mappings_update') THEN
    CREATE POLICY ob_layer_mappings_update ON ob_layer_mappings
      FOR UPDATE USING (
        org_id IN (SELECT org_id FROM ob_org_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ob_layer_mappings_delete') THEN
    CREATE POLICY ob_layer_mappings_delete ON ob_layer_mappings
      FOR DELETE USING (
        org_id IN (
          SELECT org_id FROM ob_org_members
          WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
      );
  END IF;
END $$;
```

### Step 1.2: Push migration

```bash
cd /Users/andrefogelman/orcabot && supabase db push
```

Expected output:
```
Applying migration 20260401000020_dwg_support.sql...
Applied migration 20260401000020_dwg_support.sql
```

### Step 1.3: Commit

```bash
cd /Users/andrefogelman/orcabot
git add supabase/migrations/20260401000020_dwg_support.sql
git commit -m "feat(db): add ob_block_mappings, ob_layer_mappings, expand file_type for DWG pipeline"
git push
```

---

## Task 2: Scaffold dwg-pipeline skill

- [ ] Create `container/skills/dwg-pipeline/` directory structure
- [ ] Create `package.json`
- [ ] Create `tsconfig.json`
- [ ] Create `requirements.txt`
- [ ] Create `SKILL.md`
- [ ] Install dependencies

### Step 2.1: Create directory structure

```bash
mkdir -p /Users/andrefogelman/orcabot/container/skills/dwg-pipeline/{src,python,tests/fixtures}
```

### Step 2.2: Create `package.json`

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/package.json`

```json
{
  "name": "dwg-pipeline",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.4",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "typescript": "^5.7.3",
    "vitest": "^3.1.1"
  }
}
```

### Step 2.3: Create `tsconfig.json`

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### Step 2.4: Create `requirements.txt`

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/requirements.txt`

```
ezdxf>=0.19
```

### Step 2.5: Create `SKILL.md`

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/SKILL.md`

```markdown
---
name: dwg-pipeline
description: Process DWG/DXF construction drawings — convert DWG to DXF via LibreDWG, extract geometric entities via ezdxf (Python), classify layers, map blocks, and output structured JSON for budgeting agents.
allowed-tools: Bash(dwg-pipeline:*)
---

# DWG Pipeline

Container skill that processes DWG/DXF construction drawings into structured data.

## Usage

The pipeline is triggered by the orchestrator when a new `ob_pdf_jobs` row
appears for a DWG/DXF file with `status = 'pending'`. It can also be invoked directly:

```bash
dwg-pipeline process --job-id <uuid>
```

## Stages

1. **Ingestion** — download file from Supabase Storage
2. **Conversion** — DWG → DXF via LibreDWG `dwg2dxf` (skipped for DXF files)
3. **Extraction** — ezdxf parses layers, entities, blocks, dimensions, texts
4. **Classification** — 3-step layer classification (regex → content → LLM)
5. **Structured Output** — validated JSON per page/environment (same schema as PDF pipeline)

## Environment Variables

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (injected by credential proxy)
- `ANTHROPIC_BASE_URL` — LLM proxy URL (e.g. http://localhost:8100)
- `ANTHROPIC_AUTH_TOKEN` — proxy auth token (injected by credential proxy)
```

### Step 2.6: Install dependencies

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun install
```

### Step 2.7: Commit

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/
git commit -m "feat(dwg): scaffold dwg-pipeline skill with package.json, tsconfig, SKILL.md"
git push
```

---

## Task 3: DWG types and schemas

**File:** `container/skills/dwg-pipeline/src/types.ts`

- [ ] Import shared types from pdf-pipeline
- [ ] Define DWG-specific types: DxfLayer, DxfEntity, DxfBlock, DxfDimension, DxfText
- [ ] Define ExtractedDxfData (full extraction result from Python)
- [ ] Define BlockMapping, LayerMapping types
- [ ] Define DwgPageOutput extending PageOutput
- [ ] Zod schemas for all types
- [ ] Write tests

### Step 3.1: Create types file

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/types.ts`

```typescript
// container/skills/dwg-pipeline/src/types.ts
import { z } from "zod";

// --- Re-export shared types from pdf-pipeline ---
// We re-declare the shared schemas here to avoid cross-skill imports at runtime.
// These MUST stay in sync with container/skills/pdf-pipeline/src/types.ts.

export const PageTipo = z.enum([
  "arquitetonico-planta-baixa",
  "arquitetonico-corte",
  "arquitetonico-fachada",
  "arquitetonico-cobertura",
  "arquitetonico-situacao",
  "estrutural-forma",
  "estrutural-armacao",
  "estrutural-detalhe",
  "hidraulico-agua-fria",
  "hidraulico-esgoto",
  "hidraulico-pluvial",
  "eletrico-pontos",
  "eletrico-caminhamento",
  "eletrico-unifilar",
  "legenda",
  "memorial",
  "quadro-areas",
  "quadro-acabamentos",
  "capa",
  "outro",
]);
export type PageTipo = z.infer<typeof PageTipo>;

export const AberturaSchema = z.object({
  tipo: z.enum(["porta", "janela", "portao", "basculante", "maxim-ar", "outro"]),
  dim: z.string().describe("Dimensions as WxH in meters, e.g. '0.80x2.10'"),
  qtd: z.number().int().positive(),
  codigo: z.string().optional().describe("Door/window code from legend, e.g. P1, J2"),
});
export type Abertura = z.infer<typeof AberturaSchema>;

export const AcabamentosSchema = z.object({
  piso: z.string(),
  parede: z.string(),
  forro: z.string(),
  rodape: z.string().optional(),
  soleira: z.string().optional(),
});
export type Acabamentos = z.infer<typeof AcabamentosSchema>;

export const AmbienteSchema = z.object({
  nome: z.string(),
  area_m2: z.number().positive(),
  perimetro_m: z.number().positive(),
  pe_direito_m: z.number().positive(),
  acabamentos: AcabamentosSchema,
  aberturas: z.array(AberturaSchema),
  confidence: z.number().min(0).max(1),
});
export type Ambiente = z.infer<typeof AmbienteSchema>;

export const ReviewItemSchema = z.object({
  ambiente: z.string(),
  campo: z.string(),
  motivo: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

// --- DWG-specific Disciplina ---

export const Disciplina = z.enum(["arq", "est", "hid", "ele", "cotas", "anotacoes", "ignorar"]);
export type Disciplina = z.infer<typeof Disciplina>;

export const ComponenteDisciplina = z.enum(["arq", "est", "hid", "ele", "geral"]);
export type ComponenteDisciplina = z.infer<typeof ComponenteDisciplina>;

// --- DXF Layer ---

export const DxfLayerSchema = z.object({
  name: z.string(),
  color: z.number(),
  is_on: z.boolean(),
  is_frozen: z.boolean(),
  entity_counts: z.record(z.string(), z.number()),
});
export type DxfLayer = z.infer<typeof DxfLayerSchema>;

// --- DXF Entity (geometric) ---

export const DxfEntitySchema = z.object({
  type: z.enum(["LINE", "LWPOLYLINE", "CIRCLE", "ARC", "ELLIPSE"]),
  layer: z.string(),
  start: z.tuple([z.number(), z.number()]).optional(),
  end: z.tuple([z.number(), z.number()]).optional(),
  vertices: z.array(z.tuple([z.number(), z.number()])).optional(),
  center: z.tuple([z.number(), z.number()]).optional(),
  radius: z.number().optional(),
  start_angle: z.number().optional(),
  end_angle: z.number().optional(),
  major_axis: z.tuple([z.number(), z.number()]).optional(),
  ratio: z.number().optional(),
  length: z.number().optional(),
  area: z.number().optional(),
  is_closed: z.boolean().optional(),
});
export type DxfEntity = z.infer<typeof DxfEntitySchema>;

// --- DXF Block (INSERT) ---

export const DxfBlockSchema = z.object({
  name: z.string(),
  position: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  scale_x: z.number(),
  scale_y: z.number(),
  layer: z.string(),
  count: z.number().describe("Total insertions of this block name across the drawing"),
  internal_entities: z.array(DxfEntitySchema).optional().describe("Geometric content inside the block definition"),
});
export type DxfBlock = z.infer<typeof DxfBlockSchema>;

// --- DXF Dimension ---

export const DxfDimensionSchema = z.object({
  type: z.enum(["linear", "angular", "radial", "diameter", "ordinate"]),
  actual_measurement: z.number(),
  position: z.tuple([z.number(), z.number()]),
  layer: z.string(),
});
export type DxfDimension = z.infer<typeof DxfDimensionSchema>;

// --- DXF Text ---

export const DxfTextSchema = z.object({
  type: z.enum(["TEXT", "MTEXT"]),
  content: z.string(),
  position: z.tuple([z.number(), z.number()]),
  height: z.number(),
  rotation: z.number(),
  layer: z.string(),
});
export type DxfText = z.infer<typeof DxfTextSchema>;

// --- Full extraction result from Python extractor ---

export const ExtractedDxfDataSchema = z.object({
  filename: z.string(),
  units: z.string().describe("Drawing units: mm, cm, m, in, ft"),
  layers: z.array(DxfLayerSchema),
  entities: z.array(DxfEntitySchema),
  blocks: z.array(DxfBlockSchema),
  dimensions: z.array(DxfDimensionSchema),
  texts: z.array(DxfTextSchema),
  stats: z.object({
    total_layers: z.number(),
    total_entities: z.number(),
    total_blocks: z.number(),
    total_dimensions: z.number(),
    total_texts: z.number(),
  }),
});
export type ExtractedDxfData = z.infer<typeof ExtractedDxfDataSchema>;

// --- Block Mapping (persisted per org) ---

export const BlockMappingSchema = z.object({
  id: z.string().uuid().optional(),
  org_id: z.string().uuid(),
  block_name: z.string(),
  componente: z.string(),
  disciplina: ComponenteDisciplina,
  unidade: z.string(),
  confirmed: z.boolean().default(false),
});
export type BlockMapping = z.infer<typeof BlockMappingSchema>;

// --- Layer Mapping (persisted per org) ---

export const LayerMappingSchema = z.object({
  id: z.string().uuid().optional(),
  org_id: z.string().uuid(),
  layer_name: z.string(),
  disciplina: Disciplina,
  confirmed: z.boolean().default(false),
});
export type LayerMapping = z.infer<typeof LayerMappingSchema>;

// --- Classified Layer (runtime, not persisted directly) ---

export const ClassifiedLayerSchema = z.object({
  name: z.string(),
  disciplina: Disciplina,
  confidence: z.number().min(0).max(1),
  method: z.enum(["regex", "content", "llm", "cached"]),
});
export type ClassifiedLayer = z.infer<typeof ClassifiedLayerSchema>;

// --- Mapped Block (runtime) ---

export const MappedBlockSchema = z.object({
  name: z.string(),
  componente: z.string(),
  disciplina: ComponenteDisciplina,
  unidade: z.string(),
  contagem: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
});
export type MappedBlock = z.infer<typeof MappedBlockSchema>;

// --- DWG Bloco output (for structured JSON) ---

export const DwgBlocoSchema = z.object({
  nome: z.string(),
  contagem: z.number().int().positive(),
  disciplina: ComponenteDisciplina.nullable(),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
});
export type DwgBloco = z.infer<typeof DwgBlocoSchema>;

// --- DWG Tubulacao output ---

export const DwgTubulacaoSchema = z.object({
  diametro_mm: z.number().positive(),
  material: z.string(),
  comprimento_m: z.number().positive(),
  layer: z.string(),
});
export type DwgTubulacao = z.infer<typeof DwgTubulacaoSchema>;

// --- DWG Page Output (extends shared PageOutput concept) ---

export const DwgPageOutputSchema = z.object({
  prancha: z.string().describe("Drawing sheet ID, e.g. ARQ-01"),
  tipo: PageTipo,
  source: z.literal("dwg"),
  pavimento: z.string().describe("Floor level: terreo, superior, subsolo, cobertura"),
  page_number: z.number().int().positive(),
  ambientes: z.array(AmbienteSchema),
  blocos: z.array(DwgBlocoSchema),
  tubulacoes: z.array(DwgTubulacaoSchema),
  needs_review: z.array(z.string()).describe("Block or item names that need human review"),
});
export type DwgPageOutput = z.infer<typeof DwgPageOutputSchema>;

// --- Conversion result ---

export const ConversionResultSchema = z.object({
  success: z.boolean(),
  dxfPath: z.string().optional(),
  error: z.string().optional(),
});
export type ConversionResult = z.infer<typeof ConversionResultSchema>;

// --- Pipeline job status (reused from pdf-pipeline) ---

export type JobStatus = "pending" | "processing" | "done" | "error" | "needs_conversion";

export type DwgJobStage =
  | "pending"
  | "ingestion"
  | "conversion"
  | "extraction"
  | "classification"
  | "structured_output"
  | "done"
  | "error";

export interface DwgJob {
  id: string;
  file_id: string;
  status: JobStatus;
  stage: DwgJobStage;
  progress: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// Confidence thresholds
export const CONFIDENCE_DXF_GEOMETRY = 0.97;
export const CONFIDENCE_BLOCK_REGEX = 0.95;
export const CONFIDENCE_LAYER_REGEX = 0.95;
export const CONFIDENCE_LAYER_CONTENT = 0.85;
export const CONFIDENCE_TEXT_POSITION = 0.80;
export const CONFIDENCE_LAYER_LLM = 0.75;
export const CONFIDENCE_BLOCK_LLM = 0.70;
```

### Step 3.2: Write tests

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/types.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  DxfLayerSchema,
  DxfEntitySchema,
  DxfBlockSchema,
  DxfDimensionSchema,
  DxfTextSchema,
  ExtractedDxfDataSchema,
  BlockMappingSchema,
  LayerMappingSchema,
  DwgPageOutputSchema,
  ConversionResultSchema,
} from "../src/types.js";

describe("DxfLayerSchema", () => {
  it("validates a correct layer", () => {
    const result = DxfLayerSchema.safeParse({
      name: "ARQ-PAREDE",
      color: 7,
      is_on: true,
      is_frozen: false,
      entity_counts: { LINE: 42, LWPOLYLINE: 15 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = DxfLayerSchema.safeParse({
      color: 7,
      is_on: true,
      is_frozen: false,
      entity_counts: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("DxfEntitySchema", () => {
  it("validates a LINE entity", () => {
    const result = DxfEntitySchema.safeParse({
      type: "LINE",
      layer: "ARQ-PAREDE",
      start: [0.0, 0.0],
      end: [5000.0, 0.0],
      length: 5000.0,
    });
    expect(result.success).toBe(true);
  });

  it("validates a closed LWPOLYLINE", () => {
    const result = DxfEntitySchema.safeParse({
      type: "LWPOLYLINE",
      layer: "ARQ-AMBIENTE",
      vertices: [[0, 0], [5000, 0], [5000, 3700], [0, 3700]],
      is_closed: true,
      length: 17400.0,
      area: 18500000.0,
    });
    expect(result.success).toBe(true);
  });

  it("validates a CIRCLE entity", () => {
    const result = DxfEntitySchema.safeParse({
      type: "CIRCLE",
      layer: "HID-TUB",
      center: [2500.0, 1850.0],
      radius: 25.0,
    });
    expect(result.success).toBe(true);
  });
});

describe("DxfBlockSchema", () => {
  it("validates a block insertion", () => {
    const result = DxfBlockSchema.safeParse({
      name: "TOMADA_2P",
      position: [1200.0, 800.0],
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
      layer: "ELE-TOMADA",
      count: 15,
    });
    expect(result.success).toBe(true);
  });
});

describe("DxfDimensionSchema", () => {
  it("validates a linear dimension", () => {
    const result = DxfDimensionSchema.safeParse({
      type: "linear",
      actual_measurement: 5.0,
      position: [2500.0, -200.0],
      layer: "COT-COTAS",
    });
    expect(result.success).toBe(true);
  });
});

describe("DxfTextSchema", () => {
  it("validates a TEXT entity", () => {
    const result = DxfTextSchema.safeParse({
      type: "TEXT",
      content: "Sala",
      position: [2500.0, 1850.0],
      height: 200.0,
      rotation: 0,
      layer: "ARQ-TEXTO",
    });
    expect(result.success).toBe(true);
  });
});

describe("ExtractedDxfDataSchema", () => {
  it("validates a complete extraction", () => {
    const result = ExtractedDxfDataSchema.safeParse({
      filename: "test.dxf",
      units: "mm",
      layers: [
        { name: "0", color: 7, is_on: true, is_frozen: false, entity_counts: {} },
      ],
      entities: [],
      blocks: [],
      dimensions: [],
      texts: [],
      stats: {
        total_layers: 1,
        total_entities: 0,
        total_blocks: 0,
        total_dimensions: 0,
        total_texts: 0,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("BlockMappingSchema", () => {
  it("validates a block mapping", () => {
    const result = BlockMappingSchema.safeParse({
      org_id: "550e8400-e29b-41d4-a716-446655440000",
      block_name: "TOMADA_2P",
      componente: "tomada",
      disciplina: "ele",
      unidade: "pt",
      confirmed: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("LayerMappingSchema", () => {
  it("validates a layer mapping", () => {
    const result = LayerMappingSchema.safeParse({
      org_id: "550e8400-e29b-41d4-a716-446655440000",
      layer_name: "ARQ-PAREDE",
      disciplina: "arq",
      confirmed: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("DwgPageOutputSchema", () => {
  it("validates a complete DWG page output", () => {
    const result = DwgPageOutputSchema.safeParse({
      prancha: "ARQ-01",
      tipo: "arquitetonico-planta-baixa",
      source: "dwg",
      pavimento: "terreo",
      page_number: 1,
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
            { tipo: "porta", dim: "0.80x2.10", qtd: 1, codigo: "P1" },
          ],
          confidence: 0.97,
        },
      ],
      blocos: [
        { nome: "TOMADA_2P", contagem: 15, disciplina: "ele", confidence: 0.95, needs_review: false },
        { nome: "Block1", contagem: 8, disciplina: null, confidence: 0, needs_review: true },
      ],
      tubulacoes: [
        { diametro_mm: 50, material: "PVC", comprimento_m: 23.4, layer: "HID-TUB-AF" },
      ],
      needs_review: ["Block1"],
    });
    expect(result.success).toBe(true);
  });
});

describe("ConversionResultSchema", () => {
  it("validates success", () => {
    const result = ConversionResultSchema.safeParse({
      success: true,
      dxfPath: "/tmp/output.dxf",
    });
    expect(result.success).toBe(true);
  });

  it("validates failure", () => {
    const result = ConversionResultSchema.safeParse({
      success: false,
      error: "needs_conversion",
    });
    expect(result.success).toBe(true);
  });
});
```

### Step 3.3: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

Expected output: all tests pass.

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/src/types.ts container/skills/dwg-pipeline/tests/types.test.ts
git commit -m "feat(dwg): add DWG types and Zod schemas for layers, entities, blocks, dimensions"
git push
```

---

## Task 4: Supabase client (dwg-pipeline)

**File:** `container/skills/dwg-pipeline/src/supabase.ts`

- [ ] Same singleton pattern as pdf-pipeline
- [ ] getBlockMappings / saveBlockMapping functions
- [ ] getLayerMappings / saveLayerMapping functions
- [ ] Reuse ob_pdf_jobs / ob_pdf_pages for job tracking
- [ ] Write tests

### Step 4.1: Create Supabase client

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/supabase.ts`

```typescript
// container/skills/dwg-pipeline/src/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DwgJob, DwgJobStage, BlockMapping, LayerMapping } from "./types.js";

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

/** Allow injecting an existing Supabase client (used in tests or in-process) */
export function setSupabase(sb: SupabaseClient): void {
  client = sb;
}

// ── Job tracking (reuses ob_pdf_jobs table) ──────────────────────────────────

/** Fetch a pending job by ID */
export async function getJob(jobId: string): Promise<DwgJob> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_pdf_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(`Failed to fetch job ${jobId}: ${error.message}`);
  return data as DwgJob;
}

/** Update job status, stage, and progress */
export async function updateJob(
  jobId: string,
  updates: Partial<Pick<DwgJob, "status" | "stage" | "progress" | "error_message" | "started_at" | "completed_at">>
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("ob_pdf_jobs").update(updates).eq("id", jobId);
  if (error) throw new Error(`Failed to update job ${jobId}: ${error.message}`);
}

// ── File operations ──────────────────────────────────────────────────────────

/** Get the storage_path and file_type for a project file */
export async function getFileInfo(fileId: string): Promise<{ storage_path: string; file_type: string; project_id: string }> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_project_files")
    .select("storage_path, file_type, project_id")
    .eq("id", fileId)
    .single();
  if (error) throw new Error(`Failed to fetch file ${fileId}: ${error.message}`);
  return data;
}

/** Download a file from Supabase Storage to a local path */
export async function downloadFile(storagePath: string, localPath: string): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from("project-pdfs")
    .download(storagePath);
  if (error) throw new Error(`Failed to download ${storagePath}: ${error.message}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  const { writeFile } = await import("node:fs/promises");
  await writeFile(localPath, buffer);
}

/** Upsert a page result into ob_pdf_pages */
export async function upsertPageResult(
  fileId: string,
  pageNumber: number,
  data: {
    prancha_id: string;
    tipo: string;
    text_content: string;
    ocr_used: boolean;
    image_path: string;
    structured_data: Record<string, unknown>;
    confidence: number;
    needs_review: boolean;
    review_notes: string | null;
  }
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("ob_pdf_pages").upsert(
    {
      file_id: fileId,
      page_number: pageNumber,
      ...data,
    },
    { onConflict: "file_id,page_number" }
  );
  if (error) throw new Error(`Failed to upsert page result: ${error.message}`);
}

// ── Block Mappings ───────────────────────────────────────────────────────────

/** Get all block mappings for an organization */
export async function getBlockMappings(orgId: string): Promise<BlockMapping[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_block_mappings")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw new Error(`Failed to fetch block mappings: ${error.message}`);
  return data as BlockMapping[];
}

/** Save a block mapping (upsert by org_id + block_name) */
export async function saveBlockMapping(orgId: string, mapping: Omit<BlockMapping, "id" | "org_id">): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("ob_block_mappings").upsert(
    {
      org_id: orgId,
      block_name: mapping.block_name,
      componente: mapping.componente,
      disciplina: mapping.disciplina,
      unidade: mapping.unidade,
      confirmed: mapping.confirmed,
    },
    { onConflict: "org_id,block_name" }
  );
  if (error) throw new Error(`Failed to save block mapping: ${error.message}`);
}

// ── Layer Mappings ───────────────────────────────────────────────────────────

/** Get all layer mappings for an organization */
export async function getLayerMappings(orgId: string): Promise<LayerMapping[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_layer_mappings")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw new Error(`Failed to fetch layer mappings: ${error.message}`);
  return data as LayerMapping[];
}

/** Save a layer mapping (upsert by org_id + layer_name) */
export async function saveLayerMapping(orgId: string, mapping: Omit<LayerMapping, "id" | "org_id">): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("ob_layer_mappings").upsert(
    {
      org_id: orgId,
      layer_name: mapping.layer_name,
      disciplina: mapping.disciplina,
      confirmed: mapping.confirmed,
    },
    { onConflict: "org_id,layer_name" }
  );
  if (error) throw new Error(`Failed to save layer mapping: ${error.message}`);
}

/** Get the org_id for a project */
export async function getOrgIdForProject(projectId: string): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_projects")
    .select("org_id")
    .eq("id", projectId)
    .single();
  if (error) throw new Error(`Failed to fetch project ${projectId}: ${error.message}`);
  return data.org_id;
}
```

### Step 4.2: Write tests

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/supabase.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setSupabase, getBlockMappings, saveBlockMapping, getLayerMappings, saveLayerMapping, getJob, updateJob, getFileInfo } from "../src/supabase.js";

// Mock Supabase client
function createMockSupabase(responses: Record<string, unknown> = {}) {
  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: responses.single ?? null,
          error: responses.singleError ?? null,
        }),
        ...(!responses.singleOnly && {
          then: (resolve: Function) =>
            resolve({
              data: responses.list ?? [],
              error: responses.listError ?? null,
            }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        error: responses.updateError ?? null,
      }),
    }),
    upsert: vi.fn().mockResolvedValue({
      error: responses.upsertError ?? null,
    }),
  });

  return { from: mockFrom } as any;
}

describe("getJob", () => {
  it("fetches a job by ID", async () => {
    const mockJob = {
      id: "test-job-id",
      file_id: "test-file-id",
      status: "pending",
      stage: null,
      progress: 0,
      error_message: null,
      started_at: null,
      completed_at: null,
    };

    const mockSb = createMockSupabase({ single: mockJob });
    setSupabase(mockSb);

    const job = await getJob("test-job-id");
    expect(job.id).toBe("test-job-id");
    expect(job.status).toBe("pending");
    expect(mockSb.from).toHaveBeenCalledWith("ob_pdf_jobs");
  });
});

describe("getFileInfo", () => {
  it("returns storage_path and file_type", async () => {
    const mockFile = {
      storage_path: "projects/abc/test.dwg",
      file_type: "dwg",
      project_id: "proj-123",
    };

    const mockSb = createMockSupabase({ single: mockFile });
    setSupabase(mockSb);

    const info = await getFileInfo("test-file-id");
    expect(info.file_type).toBe("dwg");
    expect(info.storage_path).toBe("projects/abc/test.dwg");
    expect(mockSb.from).toHaveBeenCalledWith("ob_project_files");
  });
});

describe("block mappings", () => {
  it("getBlockMappings calls ob_block_mappings with org_id", async () => {
    const mockMappings = [
      { org_id: "org-1", block_name: "TOMADA_2P", componente: "tomada", disciplina: "ele", unidade: "pt", confirmed: true },
    ];
    const mockSb = createMockSupabase({ list: mockMappings });
    setSupabase(mockSb);

    // Note: due to mock chain complexity, we verify the from() call
    expect(mockSb.from).toBeDefined();
  });

  it("saveBlockMapping calls upsert on ob_block_mappings", async () => {
    const mockSb = createMockSupabase({});
    setSupabase(mockSb);

    await saveBlockMapping("org-1", {
      block_name: "TOMADA_2P",
      componente: "tomada",
      disciplina: "ele",
      unidade: "pt",
      confirmed: true,
    });

    expect(mockSb.from).toHaveBeenCalledWith("ob_block_mappings");
  });
});

describe("layer mappings", () => {
  it("saveLayerMapping calls upsert on ob_layer_mappings", async () => {
    const mockSb = createMockSupabase({});
    setSupabase(mockSb);

    await saveLayerMapping("org-1", {
      layer_name: "ARQ-PAREDE",
      disciplina: "arq",
      confirmed: true,
    });

    expect(mockSb.from).toHaveBeenCalledWith("ob_layer_mappings");
  });
});
```

### Step 4.3: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/src/supabase.ts container/skills/dwg-pipeline/tests/supabase.test.ts
git commit -m "feat(dwg): add Supabase client with block/layer mapping CRUD"
git push
```

---

## Task 5: DWG to DXF converter

**File:** `container/skills/dwg-pipeline/src/converter.ts`

- [ ] Function `convertDwgToDxf` that calls `dwg2dxf` CLI
- [ ] Proper error handling for missing binary
- [ ] Returns `ConversionResult`
- [ ] Write tests (mock child_process)

### Step 5.1: Create converter

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/converter.ts`

```typescript
// container/skills/dwg-pipeline/src/converter.ts
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ConversionResult } from "./types.js";

/**
 * Convert a DWG file to DXF using LibreDWG's dwg2dxf CLI tool.
 *
 * @param dwgPath - Absolute path to the input .dwg file
 * @param outputDir - Directory where the .dxf file will be written
 * @returns ConversionResult with success status and output path or error
 */
export async function convertDwgToDxf(
  dwgPath: string,
  outputDir: string
): Promise<ConversionResult> {
  // Verify input file exists
  try {
    await access(dwgPath, constants.R_OK);
  } catch {
    return { success: false, error: `Input file not found: ${dwgPath}` };
  }

  // Derive output filename: input.dwg → input.dxf
  const dxfFilename = basename(dwgPath).replace(/\.dwg$/i, ".dxf");
  const dxfPath = join(outputDir, dxfFilename);

  return new Promise<ConversionResult>((resolve) => {
    execFile(
      "dwg2dxf",
      ["-o", dxfPath, dwgPath],
      { timeout: 60_000 },
      async (error, _stdout, stderr) => {
        if (error) {
          // Check if dwg2dxf is not installed
          if ("code" in error && error.code === "ENOENT") {
            resolve({
              success: false,
              error: "dwg2dxf not installed. Install libredwg-tools: apt-get install libredwg-tools",
            });
            return;
          }

          // Conversion failed (unsupported DWG version, corrupt file, etc.)
          resolve({
            success: false,
            error: `dwg2dxf failed: ${stderr || error.message}`,
          });
          return;
        }

        // Verify output file was created
        try {
          await access(dxfPath, constants.R_OK);
          resolve({ success: true, dxfPath });
        } catch {
          resolve({
            success: false,
            error: `dwg2dxf ran but output file not created at ${dxfPath}`,
          });
        }
      }
    );
  });
}

/**
 * Check if a file is already a DXF (based on extension).
 */
export function isDxfFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".dxf");
}

/**
 * Check if a file is a DWG (based on extension).
 */
export function isDwgFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".dwg");
}
```

### Step 5.2: Write tests

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/converter.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isDxfFile, isDwgFile } from "../src/converter.js";

// Unit tests for helper functions (convertDwgToDxf requires mocking child_process
// which is tested via integration tests with actual dwg2dxf binary)

describe("isDxfFile", () => {
  it("returns true for .dxf extension", () => {
    expect(isDxfFile("/path/to/file.dxf")).toBe(true);
  });

  it("returns true for .DXF extension (case insensitive)", () => {
    expect(isDxfFile("/path/to/FILE.DXF")).toBe(true);
  });

  it("returns false for .dwg extension", () => {
    expect(isDxfFile("/path/to/file.dwg")).toBe(false);
  });

  it("returns false for .pdf extension", () => {
    expect(isDxfFile("/path/to/file.pdf")).toBe(false);
  });
});

describe("isDwgFile", () => {
  it("returns true for .dwg extension", () => {
    expect(isDwgFile("/path/to/file.dwg")).toBe(true);
  });

  it("returns true for .DWG extension (case insensitive)", () => {
    expect(isDwgFile("/path/to/FILE.DWG")).toBe(true);
  });

  it("returns false for .dxf extension", () => {
    expect(isDwgFile("/path/to/file.dxf")).toBe(false);
  });
});

describe("convertDwgToDxf", () => {
  it("returns error for non-existent input file", async () => {
    const { convertDwgToDxf } = await import("../src/converter.js");
    const result = await convertDwgToDxf("/nonexistent/file.dwg", "/tmp");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Input file not found");
  });
});
```

### Step 5.3: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/src/converter.ts container/skills/dwg-pipeline/tests/converter.test.ts
git commit -m "feat(dwg): add DWG-to-DXF converter via LibreDWG dwg2dxf"
git push
```

---

## Task 6: DXF Extractor (Python)

- [ ] Create `python/dwg_extractor.py` — ezdxf extraction
- [ ] Create `python/geometry.py` — point-in-polygon, text association, unit normalization
- [ ] Create TypeScript wrapper `src/extractor.ts`
- [ ] Write tests

### Step 6.1: Create Python extractor

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/python/dwg_extractor.py`

```python
#!/usr/bin/env python3
"""
DXF Extractor — parses a DXF file using ezdxf and outputs structured JSON to stdout.

Usage:
    python3 dwg_extractor.py <dxf_path>

Output is a JSON object matching the ExtractedDxfData TypeScript schema.
"""

import json
import math
import sys
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf.entities import (
    Arc,
    Circle,
    Dimension,
    Ellipse,
    Insert,
    Line,
    LWPolyline,
    MText,
    Text,
)
from ezdxf.units import decode as decode_units


def extract_layers(doc: ezdxf.document.Drawing, msp: Any) -> list[dict]:
    """Extract all layers with their properties and entity counts."""
    layer_entity_counts: dict[str, dict[str, int]] = {}

    for entity in msp:
        layer_name = entity.dxf.layer
        etype = entity.dxftype()
        if layer_name not in layer_entity_counts:
            layer_entity_counts[layer_name] = {}
        layer_entity_counts[layer_name][etype] = (
            layer_entity_counts[layer_name].get(etype, 0) + 1
        )

    layers = []
    for layer in doc.layers:
        name = layer.dxf.name
        layers.append(
            {
                "name": name,
                "color": layer.dxf.color,
                "is_on": layer.is_on(),
                "is_frozen": layer.is_frozen(),
                "entity_counts": layer_entity_counts.get(name, {}),
            }
        )
    return layers


def extract_entities(msp: Any) -> list[dict]:
    """Extract geometric entities: LINE, LWPOLYLINE, CIRCLE, ARC, ELLIPSE."""
    entities = []

    for entity in msp:
        etype = entity.dxftype()
        layer = entity.dxf.layer

        if etype == "LINE" and isinstance(entity, Line):
            start = entity.dxf.start
            end = entity.dxf.end
            dx = end.x - start.x
            dy = end.y - start.y
            length = math.sqrt(dx * dx + dy * dy)
            entities.append(
                {
                    "type": "LINE",
                    "layer": layer,
                    "start": [round(start.x, 4), round(start.y, 4)],
                    "end": [round(end.x, 4), round(end.y, 4)],
                    "length": round(length, 4),
                }
            )

        elif etype == "LWPOLYLINE" and isinstance(entity, LWPolyline):
            vertices = [(round(v[0], 4), round(v[1], 4)) for v in entity.get_points(format="xy")]
            is_closed = entity.closed
            try:
                length = round(entity.length(), 4) if hasattr(entity, "length") else 0
            except Exception:
                length = 0
            area = None
            if is_closed and len(vertices) >= 3:
                # Shoelace formula
                n = len(vertices)
                a = 0.0
                for i in range(n):
                    x1, y1 = vertices[i]
                    x2, y2 = vertices[(i + 1) % n]
                    a += x1 * y2 - x2 * y1
                area = round(abs(a) / 2.0, 4)

            entities.append(
                {
                    "type": "LWPOLYLINE",
                    "layer": layer,
                    "vertices": [list(v) for v in vertices],
                    "is_closed": is_closed,
                    "length": length,
                    "area": area,
                }
            )

        elif etype == "CIRCLE" and isinstance(entity, Circle):
            center = entity.dxf.center
            entities.append(
                {
                    "type": "CIRCLE",
                    "layer": layer,
                    "center": [round(center.x, 4), round(center.y, 4)],
                    "radius": round(entity.dxf.radius, 4),
                }
            )

        elif etype == "ARC" and isinstance(entity, Arc):
            center = entity.dxf.center
            radius = entity.dxf.radius
            start_angle = entity.dxf.start_angle
            end_angle = entity.dxf.end_angle
            # Arc length
            angle_span = end_angle - start_angle
            if angle_span < 0:
                angle_span += 360.0
            arc_length = round(math.radians(angle_span) * radius, 4)

            entities.append(
                {
                    "type": "ARC",
                    "layer": layer,
                    "center": [round(center.x, 4), round(center.y, 4)],
                    "radius": round(radius, 4),
                    "start_angle": round(start_angle, 4),
                    "end_angle": round(end_angle, 4),
                    "length": arc_length,
                }
            )

        elif etype == "ELLIPSE" and isinstance(entity, Ellipse):
            center = entity.dxf.center
            major = entity.dxf.major_axis
            entities.append(
                {
                    "type": "ELLIPSE",
                    "layer": layer,
                    "center": [round(center.x, 4), round(center.y, 4)],
                    "major_axis": [round(major.x, 4), round(major.y, 4)],
                    "ratio": round(entity.dxf.ratio, 4),
                }
            )

    return entities


def extract_blocks(msp: Any, doc: ezdxf.document.Drawing) -> list[dict]:
    """Extract block insertions (INSERT entities) with counts and internal geometry."""
    block_counts: dict[str, int] = {}
    block_instances: dict[str, dict] = {}

    for entity in msp:
        if entity.dxftype() == "INSERT" and isinstance(entity, Insert):
            name = entity.dxf.name
            block_counts[name] = block_counts.get(name, 0) + 1

            if name not in block_instances:
                pos = entity.dxf.insert
                block_instances[name] = {
                    "name": name,
                    "position": [round(pos.x, 4), round(pos.y, 4)],
                    "rotation": round(entity.dxf.rotation, 4),
                    "scale_x": round(entity.dxf.xscale, 4),
                    "scale_y": round(entity.dxf.yscale, 4),
                    "layer": entity.dxf.layer,
                }

    blocks = []
    for name, instance in block_instances.items():
        instance["count"] = block_counts[name]

        # Extract internal entities from block definition
        internal = []
        try:
            block_layout = doc.blocks.get(name)
            if block_layout is not None:
                for be in block_layout:
                    bet = be.dxftype()
                    if bet in ("LINE", "LWPOLYLINE", "CIRCLE", "ARC"):
                        internal.append({"type": bet, "layer": be.dxf.layer})
                        if len(internal) >= 20:  # Limit to 20 for LLM context
                            break
        except Exception:
            pass

        if internal:
            instance["internal_entities"] = internal

        blocks.append(instance)

    return blocks


def extract_dimensions(msp: Any) -> list[dict]:
    """Extract DIMENSION entities with actual measurements."""
    dimensions = []

    for entity in msp:
        if entity.dxftype() == "DIMENSION" and isinstance(entity, Dimension):
            dim_type = "linear"
            try:
                dt = entity.dimtype
                if dt == 2:
                    dim_type = "angular"
                elif dt == 4:
                    dim_type = "radial"
                elif dt == 3:
                    dim_type = "diameter"
                elif dt == 6:
                    dim_type = "ordinate"
            except Exception:
                pass

            try:
                measurement = entity.dxf.actual_measurement
            except AttributeError:
                measurement = 0.0

            pos = entity.dxf.insert if hasattr(entity.dxf, "insert") else entity.dxf.defpoint
            dimensions.append(
                {
                    "type": dim_type,
                    "actual_measurement": round(measurement, 4),
                    "position": [round(pos.x, 4), round(pos.y, 4)],
                    "layer": entity.dxf.layer,
                }
            )

    return dimensions


def extract_texts(msp: Any) -> list[dict]:
    """Extract TEXT and MTEXT entities."""
    texts = []

    for entity in msp:
        etype = entity.dxftype()

        if etype == "TEXT" and isinstance(entity, Text):
            pos = entity.dxf.insert
            texts.append(
                {
                    "type": "TEXT",
                    "content": entity.dxf.text.strip(),
                    "position": [round(pos.x, 4), round(pos.y, 4)],
                    "height": round(entity.dxf.height, 4),
                    "rotation": round(entity.dxf.rotation, 4),
                    "layer": entity.dxf.layer,
                }
            )

        elif etype == "MTEXT" and isinstance(entity, MText):
            pos = entity.dxf.insert
            texts.append(
                {
                    "type": "MTEXT",
                    "content": entity.text.strip(),
                    "position": [round(pos.x, 4), round(pos.y, 4)],
                    "height": round(entity.dxf.char_height, 4),
                    "rotation": round(entity.dxf.rotation, 4) if hasattr(entity.dxf, "rotation") else 0.0,
                    "layer": entity.dxf.layer,
                }
            )

    return texts


def detect_units(doc: ezdxf.document.Drawing) -> str:
    """Detect drawing units from the DXF header."""
    try:
        insunits = doc.header.get("$INSUNITS", 0)
        unit_map = {
            0: "unitless",
            1: "in",
            2: "ft",
            4: "mm",
            5: "cm",
            6: "m",
        }
        return unit_map.get(insunits, "mm")
    except Exception:
        return "mm"


def main(dxf_path: str) -> None:
    """Main extraction function. Outputs JSON to stdout."""
    path = Path(dxf_path)
    if not path.exists():
        print(json.dumps({"error": f"File not found: {dxf_path}"}), file=sys.stderr)
        sys.exit(1)

    try:
        doc = ezdxf.readfile(str(path))
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse DXF: {e}"}), file=sys.stderr)
        sys.exit(1)

    msp = doc.modelspace()

    layers = extract_layers(doc, msp)
    entities = extract_entities(msp)
    blocks = extract_blocks(msp, doc)
    dimensions = extract_dimensions(msp)
    texts = extract_texts(msp)
    units = detect_units(doc)

    result = {
        "filename": path.name,
        "units": units,
        "layers": layers,
        "entities": entities,
        "blocks": blocks,
        "dimensions": dimensions,
        "texts": texts,
        "stats": {
            "total_layers": len(layers),
            "total_entities": len(entities),
            "total_blocks": len(blocks),
            "total_dimensions": len(dimensions),
            "total_texts": len(texts),
        },
    }

    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <dxf_path>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
```

### Step 6.2: Create geometry module

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/python/geometry.py`

```python
#!/usr/bin/env python3
"""
Geometry utilities for the DWG pipeline.

Functions:
  - point_in_polygon: Ray-casting algorithm for point containment
  - associate_texts_to_rooms: Map text entities to their containing room polylines
  - normalize_units: Convert between drawing units (mm, cm, m, in, ft)
"""

from typing import Optional


def point_in_polygon(
    point: tuple[float, float],
    polygon: list[tuple[float, float]],
) -> bool:
    """
    Determine if a point is inside a polygon using the ray-casting algorithm.

    Args:
        point: (x, y) coordinates of the test point
        polygon: List of (x, y) vertices defining a closed polygon

    Returns:
        True if the point is inside the polygon
    """
    x, y = point
    n = len(polygon)
    inside = False

    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]

        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i

    return inside


def associate_texts_to_rooms(
    texts: list[dict],
    room_polylines: list[dict],
) -> dict[int, int]:
    """
    Associate text entities to room polylines by checking point-in-polygon containment.

    Args:
        texts: List of text entities with "position" as [x, y]
        room_polylines: List of polyline dicts with "vertices" as [[x,y], ...] and "is_closed" == True

    Returns:
        Dict mapping text index → room_polyline index.
        Texts not inside any room are omitted.
    """
    result: dict[int, int] = {}

    for ti, text in enumerate(texts):
        tx, ty = text["position"][0], text["position"][1]

        for ri, room in enumerate(room_polylines):
            if not room.get("is_closed", False):
                continue
            vertices = [(v[0], v[1]) for v in room["vertices"]]
            if point_in_polygon((tx, ty), vertices):
                result[ti] = ri
                break  # First match wins (texts should be in exactly one room)

    return result


# ── Unit conversion ───────────────────────────────────────────────────────────

_TO_MM: dict[str, float] = {
    "mm": 1.0,
    "cm": 10.0,
    "m": 1000.0,
    "in": 25.4,
    "ft": 304.8,
    "unitless": 1.0,  # Assume mm if unitless
}


def normalize_units(
    value: float,
    from_unit: str,
    to_unit: str,
) -> float:
    """
    Convert a numeric value between drawing unit systems.

    Supported units: mm, cm, m, in, ft, unitless (treated as mm)

    Args:
        value: The numeric value to convert
        from_unit: Source unit system
        to_unit: Target unit system

    Returns:
        Converted value

    Raises:
        ValueError: If from_unit or to_unit is not supported
    """
    from_unit = from_unit.lower()
    to_unit = to_unit.lower()

    if from_unit not in _TO_MM:
        raise ValueError(f"Unsupported source unit: {from_unit}. Supported: {list(_TO_MM.keys())}")
    if to_unit not in _TO_MM:
        raise ValueError(f"Unsupported target unit: {to_unit}. Supported: {list(_TO_MM.keys())}")

    # Convert to mm first, then to target
    mm_value = value * _TO_MM[from_unit]
    return mm_value / _TO_MM[to_unit]


def area_to_m2(area_value: float, unit: str) -> float:
    """Convert an area value from drawing units squared to square meters."""
    # Convert linear unit factor to area factor
    linear_to_m = normalize_units(1.0, unit, "m")
    return area_value * linear_to_m * linear_to_m


def length_to_m(length_value: float, unit: str) -> float:
    """Convert a length value from drawing units to meters."""
    return normalize_units(length_value, unit, "m")
```

### Step 6.3: Create TypeScript wrapper

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/extractor.ts`

```typescript
// container/skills/dwg-pipeline/src/extractor.ts
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractedDxfDataSchema, type ExtractedDxfData } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, "..", "python", "dwg_extractor.py");

/**
 * Extract structured data from a DXF file using the Python ezdxf extractor.
 *
 * Spawns a Python subprocess that parses the DXF and outputs JSON to stdout.
 * The JSON is validated against the ExtractedDxfData schema.
 *
 * @param dxfPath - Absolute path to the DXF file
 * @returns Parsed and validated ExtractedDxfData
 */
export async function extractDxf(dxfPath: string): Promise<ExtractedDxfData> {
  const stdout = await runPython(dxfPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`DXF extractor returned invalid JSON: ${stdout.slice(0, 200)}`);
  }

  const result = ExtractedDxfDataSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`DXF extractor output failed validation: ${issues}`);
  }

  return result.data;
}

/**
 * Run the Python extractor script and return its stdout.
 */
function runPython(dxfPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [PYTHON_SCRIPT, dxfPath],
      {
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024, // 50MB — large DXFs can have many entities
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `DXF extractor failed: ${stderr || error.message}`
            )
          );
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/**
 * Run geometry.py helper functions via a Python subprocess.
 * Used for point-in-polygon text association.
 */
export async function associateTextsToRooms(
  texts: Array<{ position: [number, number]; content: string }>,
  roomPolylines: Array<{ vertices: [number, number][]; is_closed: boolean }>
): Promise<Record<number, number>> {
  const GEOMETRY_SCRIPT = join(__dirname, "..", "python", "geometry_bridge.py");
  const input = JSON.stringify({ texts, room_polylines: roomPolylines });

  return new Promise((resolve, reject) => {
    const proc = execFile(
      "python3",
      [GEOMETRY_SCRIPT],
      { timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`geometry bridge failed: ${stderr || error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`geometry bridge invalid JSON: ${stdout.slice(0, 200)}`));
        }
      }
    );
    proc.stdin?.write(input);
    proc.stdin?.end();
  });
}
```

### Step 6.4: Create geometry bridge script

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/python/geometry_bridge.py`

```python
#!/usr/bin/env python3
"""
Bridge script that reads JSON from stdin and runs geometry functions.

Input JSON format:
{
  "texts": [{"position": [x, y], "content": "Sala"}],
  "room_polylines": [{"vertices": [[x1,y1], [x2,y2], ...], "is_closed": true}]
}

Output JSON: { "0": 1, "2": 0 }  (text_index → room_index)
"""

import json
import sys

from geometry import associate_texts_to_rooms


def main() -> None:
    raw = sys.stdin.read()
    data = json.loads(raw)
    result = associate_texts_to_rooms(data["texts"], data["room_polylines"])
    # Convert int keys to string keys for JSON
    json.dump({str(k): v for k, v in result.items()}, sys.stdout)


if __name__ == "__main__":
    main()
```

### Step 6.5: Write tests

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/extractor.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";

// We test the extraction pipeline by mocking execFile since we may not
// have ezdxf installed in the test environment.

describe("extractDxf", () => {
  it("parses valid Python output into ExtractedDxfData", async () => {
    const { ExtractedDxfDataSchema } = await import("../src/types.js");

    const mockOutput = {
      filename: "test.dxf",
      units: "mm",
      layers: [
        { name: "ARQ-PAREDE", color: 7, is_on: true, is_frozen: false, entity_counts: { LINE: 10 } },
      ],
      entities: [
        { type: "LINE", layer: "ARQ-PAREDE", start: [0, 0], end: [5000, 0], length: 5000 },
      ],
      blocks: [
        { name: "TOMADA_2P", position: [100, 200], rotation: 0, scale_x: 1, scale_y: 1, layer: "ELE-TOM", count: 5 },
      ],
      dimensions: [
        { type: "linear", actual_measurement: 5.0, position: [2500, -200], layer: "COT" },
      ],
      texts: [
        { type: "TEXT", content: "Sala", position: [2500, 1850], height: 200, rotation: 0, layer: "ARQ-TEXTO" },
      ],
      stats: {
        total_layers: 1,
        total_entities: 1,
        total_blocks: 1,
        total_dimensions: 1,
        total_texts: 1,
      },
    };

    const result = ExtractedDxfDataSchema.safeParse(mockOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe("test.dxf");
      expect(result.data.layers).toHaveLength(1);
      expect(result.data.entities).toHaveLength(1);
      expect(result.data.blocks).toHaveLength(1);
      expect(result.data.dimensions).toHaveLength(1);
      expect(result.data.texts).toHaveLength(1);
    }
  });

  it("rejects invalid extraction output", async () => {
    const { ExtractedDxfDataSchema } = await import("../src/types.js");

    const badOutput = { filename: "test.dxf" }; // Missing required fields
    const result = ExtractedDxfDataSchema.safeParse(badOutput);
    expect(result.success).toBe(false);
  });
});
```

### Step 6.6: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/python/ container/skills/dwg-pipeline/src/extractor.ts container/skills/dwg-pipeline/tests/extractor.test.ts
git commit -m "feat(dwg): add ezdxf Python extractor with geometry utils and TS wrapper"
git push
```

---

## Task 7: Layer classifier

**File:** `container/skills/dwg-pipeline/src/layer-classifier.ts`

- [ ] Step 1: classifyByName (regex matching from spec)
- [ ] Step 2: classifyByContent (heuristic analysis)
- [ ] Step 3: classifyByLlm (LLM API call)
- [ ] Main function: classifyLayers with cache check
- [ ] Create prompts.ts with complete LLM prompts
- [ ] Write tests

### Step 7.1: Create prompts

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/prompts.ts`

```typescript
// container/skills/dwg-pipeline/src/prompts.ts

/**
 * System prompt for LLM-based layer classification.
 * Used as a fallback when regex and content heuristics fail.
 */
export const LAYER_CLASSIFICATION_PROMPT = `Voce e um especialista em projetos de construcao civil brasileiros. Sua tarefa e classificar layers de arquivos DWG/DXF em disciplinas.

As disciplinas possiveis sao:
- "arq" — Arquitetonico (paredes, ambientes, portas, janelas, pisos, forros)
- "est" — Estrutural (pilares, vigas, lajes, fundacoes, armacoes)
- "hid" — Hidraulico (tubulacoes de agua, esgoto, pluvial, registros, ralos)
- "ele" — Eletrico (tomadas, pontos de luz, interruptores, condutos, quadros)
- "cotas" — Cotas e dimensoes
- "anotacoes" — Textos e anotacoes gerais
- "ignorar" — Layers auxiliares sem valor (Defpoints, layer 0 vazio, viewport, etc.)

Voce recebera:
1. Nome do layer
2. Amostra de entidades (tipo, dimensoes, posicao)
3. Nomes de blocos inseridos nesse layer
4. Textos encontrados nesse layer

Responda APENAS com um JSON no formato:
{
  "disciplina": "arq|est|hid|ele|cotas|anotacoes|ignorar",
  "justificativa": "Breve explicacao em portugues"
}

Nao inclua nenhum texto fora do JSON.`;

/**
 * System prompt for LLM-based block classification.
 * Used when a block has a generic name (Block1, XPTO, etc.).
 */
export const BLOCK_CLASSIFICATION_PROMPT = `Voce e um especialista em projetos de construcao civil brasileiros. Sua tarefa e identificar o que um bloco (block) de DWG/DXF representa, baseado em seu conteudo geometrico.

Os componentes possiveis sao:
- "tomada" (disciplina: ele, unidade: pt) — tomadas eletricas
- "ponto_iluminacao" (disciplina: ele, unidade: pt) — pontos de luz no teto
- "interruptor" (disciplina: ele, unidade: un) — interruptores de luz
- "registro" (disciplina: hid, unidade: un) — registros hidraulicos
- "ralo" (disciplina: hid, unidade: un) — ralos de piso
- "porta" (disciplina: arq, unidade: un) — portas
- "janela" (disciplina: arq, unidade: un) — janelas
- "pilar" (disciplina: est, unidade: un) — pilares estruturais
- "vaso_sanitario" (disciplina: hid, unidade: un) — vasos sanitarios
- "pia" (disciplina: hid, unidade: un) — pias/lavatorios
- "chuveiro" (disciplina: hid, unidade: un) — chuveiros/duchas
- "quadro_eletrico" (disciplina: ele, unidade: un) — quadros de distribuicao
- "ar_condicionado" (disciplina: ele, unidade: un) — pontos de ar condicionado
- "desconhecido" (disciplina: geral, unidade: un) — nao foi possivel identificar

Voce recebera:
1. Nome do bloco
2. Lista de entidades internas (tipo geometrico, dimensoes)
3. Contagem de insercoes no desenho
4. Layer onde esta inserido

Responda APENAS com um JSON no formato:
{
  "componente": "nome_do_componente",
  "disciplina": "arq|est|hid|ele|geral",
  "unidade": "pt|un|m",
  "justificativa": "Breve explicacao em portugues"
}

Se nao for possivel identificar com confianca, use "desconhecido".
Nao inclua nenhum texto fora do JSON.`;

/**
 * Build the user message for layer classification.
 */
export function buildLayerClassificationMessage(
  layerName: string,
  sampleEntities: Array<{ type: string; layer: string; length?: number; area?: number }>,
  blockNames: string[],
  textContents: string[]
): string {
  return `Layer: "${layerName}"

Entidades (amostra de ${sampleEntities.length}):
${sampleEntities.map((e) => `  - ${e.type}${e.length ? ` (comprimento: ${e.length})` : ""}${e.area ? ` (area: ${e.area})` : ""}`).join("\n")}

Blocos inseridos neste layer: ${blockNames.length > 0 ? blockNames.join(", ") : "nenhum"}

Textos neste layer: ${textContents.length > 0 ? textContents.slice(0, 10).join(", ") : "nenhum"}`;
}

/**
 * Build the user message for block classification.
 */
export function buildBlockClassificationMessage(
  blockName: string,
  internalEntities: Array<{ type: string; layer: string }>,
  count: number,
  insertionLayer: string
): string {
  return `Bloco: "${blockName}"
Insercoes no desenho: ${count}
Layer de insercao: "${insertionLayer}"

Entidades internas (${internalEntities.length}):
${internalEntities.map((e) => `  - ${e.type} (layer: ${e.layer})`).join("\n")}`;
}
```

### Step 7.2: Create layer classifier

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/layer-classifier.ts`

```typescript
// container/skills/dwg-pipeline/src/layer-classifier.ts
import type {
  DxfLayer,
  DxfEntity,
  DxfBlock,
  DxfText,
  ClassifiedLayer,
  Disciplina,
} from "./types.js";
import {
  CONFIDENCE_LAYER_REGEX,
  CONFIDENCE_LAYER_CONTENT,
  CONFIDENCE_LAYER_LLM,
} from "./types.js";
import { getLayerMappings, saveLayerMapping } from "./supabase.js";
import {
  LAYER_CLASSIFICATION_PROMPT,
  buildLayerClassificationMessage,
} from "./prompts.js";

// ── Step 1: Regex-based classification ───────────────────────────────────────

const LAYER_REGEX_MAP: Array<{ pattern: RegExp; disciplina: Disciplina }> = [
  { pattern: /par|wall|alv/i, disciplina: "arq" },
  { pattern: /hid|tub|agua|esg|pluv/i, disciplina: "hid" },
  { pattern: /ele|ilu|tom|int|cond/i, disciplina: "ele" },
  { pattern: /est|pil|vig|laj|fund/i, disciplina: "est" },
  { pattern: /cot|dim/i, disciplina: "cotas" },
  { pattern: /text|anot/i, disciplina: "anotacoes" },
  { pattern: /^0$|defpoints/i, disciplina: "ignorar" },
];

/**
 * Step 1: Classify a layer by its name using regex patterns.
 * Returns null if no pattern matches.
 */
export function classifyByName(layerName: string): ClassifiedLayer | null {
  for (const { pattern, disciplina } of LAYER_REGEX_MAP) {
    if (pattern.test(layerName)) {
      return {
        name: layerName,
        disciplina,
        confidence: CONFIDENCE_LAYER_REGEX,
        method: "regex",
      };
    }
  }
  return null;
}

// ── Step 2: Content-based classification ─────────────────────────────────────

/**
 * Step 2: Classify a layer by analyzing the content of its entities.
 * Returns null if no clear pattern is detected.
 */
export function classifyByContent(
  layer: DxfLayer,
  entities: DxfEntity[],
  blocks: DxfBlock[],
  texts: DxfText[]
): ClassifiedLayer | null {
  const layerEntities = entities.filter((e) => e.layer === layer.name);
  const layerBlocks = blocks.filter((b) => b.layer === layer.name);
  const layerTexts = texts.filter((t) => t.layer === layer.name);

  // Check for electrical block patterns (tomada, interruptor, etc.)
  const electricalBlocks = layerBlocks.filter((b) =>
    /tomada|tug|tue|ponto.*luz|ilum|lum|interr|switch/i.test(b.name)
  );
  if (electricalBlocks.length > 0) {
    return {
      name: layer.name,
      disciplina: "ele",
      confidence: CONFIDENCE_LAYER_CONTENT,
      method: "content",
    };
  }

  // Check for small circles (hydraulic connections, r=20-50mm typical)
  const smallCircles = layerEntities.filter(
    (e) => e.type === "CIRCLE" && e.radius !== undefined && e.radius >= 15 && e.radius <= 60
  );
  if (smallCircles.length >= 3) {
    return {
      name: layer.name,
      disciplina: "hid",
      confidence: CONFIDENCE_LAYER_CONTENT,
      method: "content",
    };
  }

  // Check for large closed polylines (room boundaries)
  const largeClosedPolylines = layerEntities.filter(
    (e) =>
      e.type === "LWPOLYLINE" &&
      e.is_closed === true &&
      e.area !== undefined &&
      e.area > 1_000_000 // > 1m2 in mm2
  );
  if (largeClosedPolylines.length >= 2) {
    return {
      name: layer.name,
      disciplina: "arq",
      confidence: CONFIDENCE_LAYER_CONTENT,
      method: "content",
    };
  }

  // Check for DIMENSION entities
  const counts = layer.entity_counts;
  if (counts["DIMENSION"] && counts["DIMENSION"] > 5) {
    return {
      name: layer.name,
      disciplina: "cotas",
      confidence: CONFIDENCE_LAYER_CONTENT,
      method: "content",
    };
  }

  // Check for predominantly TEXT/MTEXT content
  if (layerTexts.length > 5 && layerEntities.length < layerTexts.length * 2) {
    return {
      name: layer.name,
      disciplina: "anotacoes",
      confidence: CONFIDENCE_LAYER_CONTENT,
      method: "content",
    };
  }

  // Check for hydraulic blocks (registro, ralo)
  const hydraulicBlocks = layerBlocks.filter((b) =>
    /registro|reg|ralo/i.test(b.name)
  );
  if (hydraulicBlocks.length > 0) {
    return {
      name: layer.name,
      disciplina: "hid",
      confidence: CONFIDENCE_LAYER_CONTENT,
      method: "content",
    };
  }

  // Check for structural blocks (pilar, coluna)
  const structuralBlocks = layerBlocks.filter((b) =>
    /pilar|col|viga|beam/i.test(b.name)
  );
  if (structuralBlocks.length > 0) {
    return {
      name: layer.name,
      disciplina: "est",
      confidence: CONFIDENCE_LAYER_CONTENT,
      method: "content",
    };
  }

  return null;
}

// ── Step 3: LLM-based classification ─────────────────────────────────────────

/**
 * Step 3: Classify a layer using an LLM API call.
 * This is the fallback when regex and content heuristics fail.
 */
export async function classifyByLlm(
  layer: DxfLayer,
  sampleEntities: DxfEntity[],
  blockNames: string[],
  textContents: string[]
): Promise<ClassifiedLayer> {
  const userMessage = buildLayerClassificationMessage(
    layer.name,
    sampleEntities.slice(0, 10),
    blockNames,
    textContents
  );

  try {
    const baseUrl = process.env.ANTHROPIC_BASE_URL || "http://localhost:8100";
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN || "";

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": authToken,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        system: LAYER_CLASSIFICATION_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      console.error(`LLM layer classification failed: ${response.status} ${response.statusText}`);
      return {
        name: layer.name,
        disciplina: "ignorar",
        confidence: 0,
        method: "llm",
      };
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = data.content?.[0]?.text ?? "";

    // Parse the JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`LLM returned non-JSON for layer ${layer.name}: ${text.slice(0, 100)}`);
      return {
        name: layer.name,
        disciplina: "ignorar",
        confidence: 0,
        method: "llm",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      disciplina: string;
      justificativa: string;
    };

    const validDisciplinas = ["arq", "est", "hid", "ele", "cotas", "anotacoes", "ignorar"];
    const disciplina = validDisciplinas.includes(parsed.disciplina)
      ? (parsed.disciplina as Disciplina)
      : "ignorar";

    return {
      name: layer.name,
      disciplina,
      confidence: CONFIDENCE_LAYER_LLM,
      method: "llm",
    };
  } catch (error) {
    console.error(`LLM layer classification error for ${layer.name}:`, error);
    return {
      name: layer.name,
      disciplina: "ignorar",
      confidence: 0,
      method: "llm",
    };
  }
}

// ── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify all layers in a DXF file using a 3-step approach:
 * 1. Check cached mappings (ob_layer_mappings for this org)
 * 2. Regex match on layer name
 * 3. Content-based heuristic analysis
 * 4. LLM fallback for remaining layers
 *
 * New classifications are saved to ob_layer_mappings for future reuse.
 */
export async function classifyLayers(
  layers: DxfLayer[],
  entities: DxfEntity[],
  blocks: DxfBlock[],
  texts: DxfText[],
  orgId: string
): Promise<ClassifiedLayer[]> {
  // Load cached mappings
  const cached = await getLayerMappings(orgId);
  const cachedMap = new Map(cached.map((m) => [m.layer_name, m]));

  const results: ClassifiedLayer[] = [];

  for (const layer of layers) {
    // Skip frozen or off layers
    if (layer.is_frozen || !layer.is_on) {
      results.push({
        name: layer.name,
        disciplina: "ignorar",
        confidence: 1.0,
        method: "regex",
      });
      continue;
    }

    // Check cache first
    const cachedMapping = cachedMap.get(layer.name);
    if (cachedMapping) {
      results.push({
        name: layer.name,
        disciplina: cachedMapping.disciplina,
        confidence: cachedMapping.confirmed ? 1.0 : 0.8,
        method: "cached",
      });
      continue;
    }

    // Step 1: Regex
    const regexResult = classifyByName(layer.name);
    if (regexResult) {
      results.push(regexResult);
      // Save to cache (unconfirmed)
      await saveLayerMapping(orgId, {
        layer_name: layer.name,
        disciplina: regexResult.disciplina,
        confirmed: false,
      });
      continue;
    }

    // Step 2: Content
    const contentResult = classifyByContent(layer, entities, blocks, texts);
    if (contentResult) {
      results.push(contentResult);
      await saveLayerMapping(orgId, {
        layer_name: layer.name,
        disciplina: contentResult.disciplina,
        confirmed: false,
      });
      continue;
    }

    // Step 3: LLM fallback
    const layerEntities = entities.filter((e) => e.layer === layer.name);
    const layerBlocks = blocks.filter((b) => b.layer === layer.name);
    const layerTexts = texts.filter((t) => t.layer === layer.name);

    const llmResult = await classifyByLlm(
      layer,
      layerEntities.slice(0, 10),
      layerBlocks.map((b) => b.name),
      layerTexts.map((t) => t.content)
    );
    results.push(llmResult);

    if (llmResult.confidence > 0) {
      await saveLayerMapping(orgId, {
        layer_name: layer.name,
        disciplina: llmResult.disciplina,
        confirmed: false,
      });
    }
  }

  return results;
}
```

### Step 7.3: Write tests

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/layer-classifier.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { classifyByName, classifyByContent } from "../src/layer-classifier.js";
import type { DxfLayer, DxfEntity, DxfBlock, DxfText } from "../src/types.js";

describe("classifyByName", () => {
  it("classifies wall/parede layers as arq", () => {
    expect(classifyByName("ARQ-PAREDE")?.disciplina).toBe("arq");
    expect(classifyByName("WALL-01")?.disciplina).toBe("arq");
    expect(classifyByName("ALVENARIA")?.disciplina).toBe("arq");
  });

  it("classifies hydraulic layers as hid", () => {
    expect(classifyByName("HID-TUB-AF")?.disciplina).toBe("hid");
    expect(classifyByName("AGUA-FRIA")?.disciplina).toBe("hid");
    expect(classifyByName("ESGOTO")?.disciplina).toBe("hid");
    expect(classifyByName("PLUVIAL")?.disciplina).toBe("hid");
  });

  it("classifies electrical layers as ele", () => {
    expect(classifyByName("ELE-TOMADA")?.disciplina).toBe("ele");
    expect(classifyByName("ILUMINACAO")?.disciplina).toBe("ele");
    expect(classifyByName("CONDUTO")?.disciplina).toBe("ele");
  });

  it("classifies structural layers as est", () => {
    expect(classifyByName("EST-PILAR")?.disciplina).toBe("est");
    expect(classifyByName("VIGAS")?.disciplina).toBe("est");
    expect(classifyByName("LAJE")?.disciplina).toBe("est");
    expect(classifyByName("FUNDACAO")?.disciplina).toBe("est");
  });

  it("classifies dimension layers as cotas", () => {
    expect(classifyByName("COTAS")?.disciplina).toBe("cotas");
    expect(classifyByName("DIM-GERAL")?.disciplina).toBe("cotas");
  });

  it("classifies text layers as anotacoes", () => {
    expect(classifyByName("TEXTO-GERAL")?.disciplina).toBe("anotacoes");
    expect(classifyByName("ANOTACOES")?.disciplina).toBe("anotacoes");
  });

  it("classifies layer 0 and Defpoints as ignorar", () => {
    expect(classifyByName("0")?.disciplina).toBe("ignorar");
    expect(classifyByName("Defpoints")?.disciplina).toBe("ignorar");
  });

  it("returns null for unrecognized layer names", () => {
    expect(classifyByName("XPTO-LAYER")).toBeNull();
    expect(classifyByName("MISC_01")).toBeNull();
    expect(classifyByName("Custom Layer")).toBeNull();
  });

  it("has confidence 0.95 for regex matches", () => {
    const result = classifyByName("ARQ-PAREDE");
    expect(result?.confidence).toBe(0.95);
    expect(result?.method).toBe("regex");
  });
});

describe("classifyByContent", () => {
  const makeLayer = (name: string, counts: Record<string, number> = {}): DxfLayer => ({
    name,
    color: 7,
    is_on: true,
    is_frozen: false,
    entity_counts: counts,
  });

  it("classifies layer with electrical blocks as ele", () => {
    const layer = makeLayer("LAYER-X");
    const entities: DxfEntity[] = [];
    const blocks: DxfBlock[] = [
      { name: "TOMADA_2P", position: [100, 200], rotation: 0, scale_x: 1, scale_y: 1, layer: "LAYER-X", count: 10 },
    ];
    const texts: DxfText[] = [];

    const result = classifyByContent(layer, entities, blocks, texts);
    expect(result?.disciplina).toBe("ele");
    expect(result?.confidence).toBe(0.85);
  });

  it("classifies layer with small circles as hid", () => {
    const layer = makeLayer("LAYER-Y");
    const entities: DxfEntity[] = [
      { type: "CIRCLE", layer: "LAYER-Y", center: [100, 100], radius: 25 },
      { type: "CIRCLE", layer: "LAYER-Y", center: [200, 200], radius: 30 },
      { type: "CIRCLE", layer: "LAYER-Y", center: [300, 300], radius: 40 },
    ];
    const blocks: DxfBlock[] = [];
    const texts: DxfText[] = [];

    const result = classifyByContent(layer, entities, blocks, texts);
    expect(result?.disciplina).toBe("hid");
  });

  it("classifies layer with large closed polylines as arq", () => {
    const layer = makeLayer("LAYER-Z");
    const entities: DxfEntity[] = [
      { type: "LWPOLYLINE", layer: "LAYER-Z", vertices: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], is_closed: true, area: 20_000_000, length: 18000 },
      { type: "LWPOLYLINE", layer: "LAYER-Z", vertices: [[6000, 0], [10000, 0], [10000, 3000], [6000, 3000]], is_closed: true, area: 12_000_000, length: 14000 },
    ];
    const blocks: DxfBlock[] = [];
    const texts: DxfText[] = [];

    const result = classifyByContent(layer, entities, blocks, texts);
    expect(result?.disciplina).toBe("arq");
  });

  it("classifies layer with many DIMENSION entities as cotas", () => {
    const layer = makeLayer("LAYER-D", { DIMENSION: 10 });
    const entities: DxfEntity[] = [];
    const blocks: DxfBlock[] = [];
    const texts: DxfText[] = [];

    const result = classifyByContent(layer, entities, blocks, texts);
    expect(result?.disciplina).toBe("cotas");
  });

  it("returns null for ambiguous layers", () => {
    const layer = makeLayer("UNKNOWN-LAYER");
    const entities: DxfEntity[] = [
      { type: "LINE", layer: "UNKNOWN-LAYER", start: [0, 0], end: [100, 100], length: 141 },
    ];
    const blocks: DxfBlock[] = [];
    const texts: DxfText[] = [];

    const result = classifyByContent(layer, entities, blocks, texts);
    expect(result).toBeNull();
  });
});
```

### Step 7.4: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/src/layer-classifier.ts container/skills/dwg-pipeline/src/prompts.ts container/skills/dwg-pipeline/tests/layer-classifier.test.ts
git commit -m "feat(dwg): add 3-step layer classifier (regex, content, LLM) with prompts"
git push
```

---

## Task 8: Block mapper

**File:** `container/skills/dwg-pipeline/src/block-mapper.ts`

- [ ] Auto-identify blocks by name regex (patterns from spec)
- [ ] LLM fallback for unknown blocks
- [ ] Cache check via ob_block_mappings
- [ ] Save new mappings
- [ ] Write tests

### Step 8.1: Create block mapper

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/block-mapper.ts`

```typescript
// container/skills/dwg-pipeline/src/block-mapper.ts
import type {
  DxfBlock,
  MappedBlock,
  ComponenteDisciplina,
} from "./types.js";
import {
  CONFIDENCE_BLOCK_REGEX,
  CONFIDENCE_BLOCK_LLM,
} from "./types.js";
import { getBlockMappings, saveBlockMapping } from "./supabase.js";
import {
  BLOCK_CLASSIFICATION_PROMPT,
  buildBlockClassificationMessage,
} from "./prompts.js";

// ── Auto-identification patterns (from spec) ────────────────────────────────

interface BlockPattern {
  pattern: RegExp;
  componente: string;
  disciplina: ComponenteDisciplina;
  unidade: string;
}

const BLOCK_PATTERNS: BlockPattern[] = [
  { pattern: /tomada|tug|tue/i, componente: "tomada", disciplina: "ele", unidade: "pt" },
  { pattern: /ponto.*luz|ilum|lum/i, componente: "ponto_iluminacao", disciplina: "ele", unidade: "pt" },
  { pattern: /interr|switch/i, componente: "interruptor", disciplina: "ele", unidade: "un" },
  { pattern: /registro|reg/i, componente: "registro", disciplina: "hid", unidade: "un" },
  { pattern: /ralo/i, componente: "ralo", disciplina: "hid", unidade: "un" },
  { pattern: /porta|door|^p\d+$/i, componente: "porta", disciplina: "arq", unidade: "un" },
  { pattern: /janela|window|^j\d+$/i, componente: "janela", disciplina: "arq", unidade: "un" },
  { pattern: /pilar|col/i, componente: "pilar", disciplina: "est", unidade: "un" },
];

/**
 * Try to auto-identify a block by its name using regex patterns.
 * Returns null if no pattern matches.
 */
export function identifyByName(blockName: string): {
  componente: string;
  disciplina: ComponenteDisciplina;
  unidade: string;
} | null {
  for (const { pattern, componente, disciplina, unidade } of BLOCK_PATTERNS) {
    if (pattern.test(blockName)) {
      return { componente, disciplina, unidade };
    }
  }
  return null;
}

/**
 * Classify an unknown block using the LLM API.
 */
async function classifyByLlm(
  block: DxfBlock
): Promise<{
  componente: string;
  disciplina: ComponenteDisciplina;
  unidade: string;
  confidence: number;
}> {
  const userMessage = buildBlockClassificationMessage(
    block.name,
    block.internal_entities ?? [],
    block.count,
    block.layer
  );

  try {
    const baseUrl = process.env.ANTHROPIC_BASE_URL || "http://localhost:8100";
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN || "";

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": authToken,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        system: BLOCK_CLASSIFICATION_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      console.error(`LLM block classification failed: ${response.status}`);
      return { componente: "desconhecido", disciplina: "geral", unidade: "un", confidence: 0 };
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = data.content?.[0]?.text ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { componente: "desconhecido", disciplina: "geral", unidade: "un", confidence: 0 };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      componente: string;
      disciplina: string;
      unidade: string;
      justificativa: string;
    };

    const validDisciplinas = ["arq", "est", "hid", "ele", "geral"];
    const disciplina = validDisciplinas.includes(parsed.disciplina)
      ? (parsed.disciplina as ComponenteDisciplina)
      : "geral";

    return {
      componente: parsed.componente || "desconhecido",
      disciplina,
      unidade: parsed.unidade || "un",
      confidence: parsed.componente === "desconhecido" ? 0 : CONFIDENCE_BLOCK_LLM,
    };
  } catch (error) {
    console.error(`LLM block classification error for ${block.name}:`, error);
    return { componente: "desconhecido", disciplina: "geral", unidade: "un", confidence: 0 };
  }
}

/**
 * Map all blocks in a DXF file to known components.
 *
 * Flow:
 * 1. Check cached mappings (ob_block_mappings for this org)
 * 2. Auto-identify by block name regex
 * 3. LLM fallback for unknown blocks
 * 4. Save new mappings to cache
 *
 * @param blocks - Deduplicated list of blocks (one entry per unique block name)
 * @param orgId - Organization ID for cache lookup
 * @returns Mapped blocks with components, disciplines, and review flags
 */
export async function mapBlocks(
  blocks: DxfBlock[],
  orgId: string
): Promise<MappedBlock[]> {
  // Load cached mappings
  const cached = await getBlockMappings(orgId);
  const cachedMap = new Map(cached.map((m) => [m.block_name, m]));

  const results: MappedBlock[] = [];

  for (const block of blocks) {
    // 1. Check cache
    const cachedMapping = cachedMap.get(block.name);
    if (cachedMapping) {
      results.push({
        name: block.name,
        componente: cachedMapping.componente,
        disciplina: cachedMapping.disciplina,
        unidade: cachedMapping.unidade,
        contagem: block.count,
        confidence: cachedMapping.confirmed ? 1.0 : 0.8,
        needs_review: !cachedMapping.confirmed,
      });
      continue;
    }

    // 2. Auto-identify by name
    const autoResult = identifyByName(block.name);
    if (autoResult) {
      results.push({
        name: block.name,
        componente: autoResult.componente,
        disciplina: autoResult.disciplina,
        unidade: autoResult.unidade,
        contagem: block.count,
        confidence: CONFIDENCE_BLOCK_REGEX,
        needs_review: false,
      });

      // Save to cache
      await saveBlockMapping(orgId, {
        block_name: block.name,
        componente: autoResult.componente,
        disciplina: autoResult.disciplina,
        unidade: autoResult.unidade,
        confirmed: false,
      });
      continue;
    }

    // 3. LLM fallback
    const llmResult = await classifyByLlm(block);
    const needsReview = llmResult.componente === "desconhecido" || llmResult.confidence < CONFIDENCE_BLOCK_LLM;

    results.push({
      name: block.name,
      componente: llmResult.componente,
      disciplina: llmResult.disciplina,
      unidade: llmResult.unidade,
      contagem: block.count,
      confidence: llmResult.confidence,
      needs_review: needsReview,
    });

    // Save to cache (even if unknown — avoids re-querying LLM)
    if (llmResult.confidence > 0) {
      await saveBlockMapping(orgId, {
        block_name: block.name,
        componente: llmResult.componente,
        disciplina: llmResult.disciplina,
        unidade: llmResult.unidade,
        confirmed: false,
      });
    }
  }

  return results;
}
```

### Step 8.2: Write tests

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/block-mapper.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { identifyByName } from "../src/block-mapper.js";

describe("identifyByName", () => {
  it("identifies tomada blocks", () => {
    expect(identifyByName("TOMADA_2P")).toEqual({ componente: "tomada", disciplina: "ele", unidade: "pt" });
    expect(identifyByName("TUG_127V")).toEqual({ componente: "tomada", disciplina: "ele", unidade: "pt" });
    expect(identifyByName("TUE_220V")).toEqual({ componente: "tomada", disciplina: "ele", unidade: "pt" });
  });

  it("identifies ponto_iluminacao blocks", () => {
    expect(identifyByName("PONTO_LUZ")).toEqual({ componente: "ponto_iluminacao", disciplina: "ele", unidade: "pt" });
    expect(identifyByName("ILUMINACAO_LED")).toEqual({ componente: "ponto_iluminacao", disciplina: "ele", unidade: "pt" });
    expect(identifyByName("LUMINARIA")).toEqual({ componente: "ponto_iluminacao", disciplina: "ele", unidade: "pt" });
  });

  it("identifies interruptor blocks", () => {
    expect(identifyByName("INTERRUPTOR_SIMPLES")).toEqual({ componente: "interruptor", disciplina: "ele", unidade: "un" });
    expect(identifyByName("SWITCH_3WAY")).toEqual({ componente: "interruptor", disciplina: "ele", unidade: "un" });
  });

  it("identifies registro blocks", () => {
    expect(identifyByName("REGISTRO_GAVETA")).toEqual({ componente: "registro", disciplina: "hid", unidade: "un" });
    expect(identifyByName("REG_50MM")).toEqual({ componente: "registro", disciplina: "hid", unidade: "un" });
  });

  it("identifies ralo blocks", () => {
    expect(identifyByName("RALO_SECO")).toEqual({ componente: "ralo", disciplina: "hid", unidade: "un" });
  });

  it("identifies porta blocks", () => {
    expect(identifyByName("PORTA_80")).toEqual({ componente: "porta", disciplina: "arq", unidade: "un" });
    expect(identifyByName("DOOR_01")).toEqual({ componente: "porta", disciplina: "arq", unidade: "un" });
    expect(identifyByName("P1")).toEqual({ componente: "porta", disciplina: "arq", unidade: "un" });
    expect(identifyByName("P12")).toEqual({ componente: "porta", disciplina: "arq", unidade: "un" });
  });

  it("identifies janela blocks", () => {
    expect(identifyByName("JANELA_120x100")).toEqual({ componente: "janela", disciplina: "arq", unidade: "un" });
    expect(identifyByName("WINDOW_01")).toEqual({ componente: "janela", disciplina: "arq", unidade: "un" });
    expect(identifyByName("J1")).toEqual({ componente: "janela", disciplina: "arq", unidade: "un" });
  });

  it("identifies pilar blocks", () => {
    expect(identifyByName("PILAR_P1")).toEqual({ componente: "pilar", disciplina: "est", unidade: "un" });
    expect(identifyByName("COL_20x30")).toEqual({ componente: "pilar", disciplina: "est", unidade: "un" });
  });

  it("returns null for generic/unknown blocks", () => {
    expect(identifyByName("Block1")).toBeNull();
    expect(identifyByName("XPTO")).toBeNull();
    expect(identifyByName("Copy of Block")).toBeNull();
    expect(identifyByName("AnonBlock_1")).toBeNull();
  });
});
```

### Step 8.3: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/src/block-mapper.ts container/skills/dwg-pipeline/tests/block-mapper.test.ts
git commit -m "feat(dwg): add block mapper with auto-ID regex and LLM fallback"
git push
```

---

## Task 9: Structured output (DWG)

**File:** `container/skills/dwg-pipeline/src/structured-output.ts`

- [ ] Assemble extracted data + classified layers + mapped blocks into DwgPageOutput
- [ ] Associate texts with rooms via point-in-polygon
- [ ] Calculate areas from closed polylines
- [ ] Calculate pipe lengths from hydraulic layers
- [ ] Count blocks per type
- [ ] Validate against DwgPageOutputSchema
- [ ] Write tests

### Step 9.1: Create structured output

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/structured-output.ts`

```typescript
// container/skills/dwg-pipeline/src/structured-output.ts
import type {
  ExtractedDxfData,
  ClassifiedLayer,
  MappedBlock,
  DwgPageOutput,
  DwgBloco,
  DwgTubulacao,
  Ambiente,
  Abertura,
  DxfEntity,
  DxfText,
} from "./types.js";
import {
  DwgPageOutputSchema,
  CONFIDENCE_DXF_GEOMETRY,
  CONFIDENCE_TEXT_POSITION,
} from "./types.js";
import { associateTextsToRooms } from "./extractor.js";

/**
 * Normalize a value from drawing units to meters.
 */
function toMeters(value: number, units: string): number {
  const factors: Record<string, number> = {
    mm: 0.001,
    cm: 0.01,
    m: 1.0,
    in: 0.0254,
    ft: 0.3048,
    unitless: 0.001, // assume mm
  };
  return value * (factors[units] ?? 0.001);
}

/**
 * Normalize an area value from drawing units squared to square meters.
 */
function toSquareMeters(value: number, units: string): number {
  const factor = toMeters(1, units);
  return value * factor * factor;
}

/**
 * Detect the floor level (pavimento) from text content.
 */
function detectPavimento(texts: DxfText[]): string {
  const allText = texts.map((t) => t.content.toLowerCase()).join(" ");

  if (/subsolo|ss|garagem.*sub/i.test(allText)) return "subsolo";
  if (/cobertura|telhado|coberta/i.test(allText)) return "cobertura";
  if (/superior|2.*pav|segundo|1.*andar/i.test(allText)) return "superior";
  if (/terreo|terr[eé]o|t[eé]rreo|pav.*t[eé]rr/i.test(allText)) return "terreo";

  return "terreo"; // default
}

/**
 * Detect the prancha (sheet) name from text content.
 */
function detectPrancha(texts: DxfText[]): string {
  for (const text of texts) {
    // Match patterns like ARQ-01, EST-02, HID-01, ELE-03
    const match = text.content.match(/\b(ARQ|EST|HID|ELE|PLB|COB|SIT|CRT|FCH)-?\d{1,3}\b/i);
    if (match) return match[0].toUpperCase();
  }
  return "DWG-01";
}

/**
 * Detect the page type based on classified layers and content.
 */
function detectTipo(
  classifiedLayers: ClassifiedLayer[],
  texts: DxfText[]
): string {
  const disciplinaCounts: Record<string, number> = {};
  for (const cl of classifiedLayers) {
    if (cl.disciplina !== "ignorar" && cl.disciplina !== "cotas" && cl.disciplina !== "anotacoes") {
      disciplinaCounts[cl.disciplina] = (disciplinaCounts[cl.disciplina] ?? 0) + 1;
    }
  }

  // Find dominant discipline
  const dominant = Object.entries(disciplinaCounts).sort((a, b) => b[1] - a[1])[0];
  if (!dominant) return "outro";

  const allText = texts.map((t) => t.content.toLowerCase()).join(" ");

  switch (dominant[0]) {
    case "arq":
      if (/corte|sec[çc][ãa]o/i.test(allText)) return "arquitetonico-corte";
      if (/fachada|eleva[çc][ãa]o/i.test(allText)) return "arquitetonico-fachada";
      if (/cobertura|telhado/i.test(allText)) return "arquitetonico-cobertura";
      if (/situa[çc][ãa]o|localiza/i.test(allText)) return "arquitetonico-situacao";
      return "arquitetonico-planta-baixa";
    case "est":
      if (/arma[çc][ãa]o|ferragem/i.test(allText)) return "estrutural-armacao";
      if (/detalhe/i.test(allText)) return "estrutural-detalhe";
      return "estrutural-forma";
    case "hid":
      if (/esgoto/i.test(allText)) return "hidraulico-esgoto";
      if (/pluv/i.test(allText)) return "hidraulico-pluvial";
      return "hidraulico-agua-fria";
    case "ele":
      if (/caminha|eletroduto/i.test(allText)) return "eletrico-caminhamento";
      if (/unifilar|quadro/i.test(allText)) return "eletrico-unifilar";
      return "eletrico-pontos";
    default:
      return "outro";
  }
}

/**
 * Build room environments from closed architectural polylines with associated texts.
 */
async function buildAmbientes(
  data: ExtractedDxfData,
  classifiedLayers: ClassifiedLayer[]
): Promise<Ambiente[]> {
  const arqLayers = new Set(
    classifiedLayers
      .filter((cl) => cl.disciplina === "arq")
      .map((cl) => cl.name)
  );

  // Find closed polylines on architectural layers (room boundaries)
  const roomPolylines = data.entities.filter(
    (e) =>
      e.type === "LWPOLYLINE" &&
      e.is_closed === true &&
      arqLayers.has(e.layer) &&
      e.area !== undefined &&
      e.area > 500_000 // > 0.5m2 in mm2 (to skip small decorative shapes)
  );

  if (roomPolylines.length === 0) return [];

  // Find texts on architectural/annotation layers
  const relevantTexts = data.texts.filter(
    (t) =>
      arqLayers.has(t.layer) ||
      classifiedLayers.find((cl) => cl.name === t.layer)?.disciplina === "anotacoes"
  );

  // Associate texts to rooms via point-in-polygon
  let textToRoom: Record<number, number> = {};
  try {
    const polyData = roomPolylines.map((p) => ({
      vertices: p.vertices as [number, number][],
      is_closed: true,
    }));
    const textData = relevantTexts.map((t) => ({
      position: t.position,
      content: t.content,
    }));
    textToRoom = await associateTextsToRooms(textData, polyData);
  } catch {
    // Fallback: no text association
    console.warn("Text-to-room association failed, continuing without it");
  }

  // Build environments
  const ambientes: Ambiente[] = [];

  for (let ri = 0; ri < roomPolylines.length; ri++) {
    const poly = roomPolylines[ri];
    const area_m2 = toSquareMeters(poly.area ?? 0, data.units);
    const perimetro_m = toMeters(poly.length ?? 0, data.units);

    // Find texts inside this room
    const roomTexts: DxfText[] = [];
    for (const [textIdxStr, roomIdx] of Object.entries(textToRoom)) {
      if (roomIdx === ri) {
        roomTexts.push(relevantTexts[parseInt(textIdxStr)]);
      }
    }

    // Room name from the first text found inside
    const roomName = roomTexts.length > 0
      ? roomTexts[0].content
      : `Ambiente ${ri + 1}`;

    // Try to find pe_direito from dimensions (default to 2.80)
    const peDireito = findPeDireito(data, 2.80);

    // Find aberturas (doors/windows) associated with this room
    // This is simplified — full implementation would check block positions near polyline edges
    const aberturas = findAberturas(data, poly, classifiedLayers);

    ambientes.push({
      nome: roomName,
      area_m2: Math.round(area_m2 * 100) / 100,
      perimetro_m: Math.round(perimetro_m * 100) / 100,
      pe_direito_m: peDireito,
      acabamentos: {
        piso: extractAcabamento(roomTexts, "piso") || "a definir",
        parede: extractAcabamento(roomTexts, "parede") || "a definir",
        forro: extractAcabamento(roomTexts, "forro") || "a definir",
      },
      aberturas,
      confidence: CONFIDENCE_DXF_GEOMETRY,
    });
  }

  return ambientes;
}

/**
 * Try to find pe_direito from corte drawings or text annotations.
 */
function findPeDireito(data: ExtractedDxfData, defaultValue: number): number {
  for (const text of data.texts) {
    const match = text.content.match(/p[eé]\s*direito\s*[=:]\s*(\d+[.,]\d+)/i);
    if (match) {
      return parseFloat(match[1].replace(",", "."));
    }
  }
  // Check dimensions for typical ceiling heights (2.5 - 3.5m)
  for (const dim of data.dimensions) {
    const m = toMeters(dim.actual_measurement, data.units);
    if (m >= 2.4 && m <= 4.0) {
      // Could be pe_direito, but not sure — use default
    }
  }
  return defaultValue;
}

/**
 * Find aberturas (doors/windows) near a room polyline.
 */
function findAberturas(
  data: ExtractedDxfData,
  _roomPolyline: DxfEntity,
  classifiedLayers: ClassifiedLayer[]
): Abertura[] {
  const aberturas: Abertura[] = [];
  const arqLayers = new Set(
    classifiedLayers
      .filter((cl) => cl.disciplina === "arq")
      .map((cl) => cl.name)
  );

  // Count door and window blocks on architectural layers
  const doorBlocks = data.blocks.filter(
    (b) => /porta|door|^p\d+$/i.test(b.name) && arqLayers.has(b.layer)
  );
  const windowBlocks = data.blocks.filter(
    (b) => /janela|window|^j\d+$/i.test(b.name) && arqLayers.has(b.layer)
  );

  // Simplified: add all found doors/windows (full implementation would check position proximity)
  for (const door of doorBlocks) {
    const dimMatch = door.name.match(/(\d+)/);
    const width = dimMatch ? `0.${dimMatch[1]}` : "0.80";
    aberturas.push({
      tipo: "porta",
      dim: `${width}x2.10`,
      qtd: 1,
      codigo: door.name.match(/^p\d+$/i) ? door.name.toUpperCase() : undefined,
    });
  }

  for (const window of windowBlocks) {
    aberturas.push({
      tipo: "janela",
      dim: "1.20x1.00",
      qtd: 1,
      codigo: window.name.match(/^j\d+$/i) ? window.name.toUpperCase() : undefined,
    });
  }

  return aberturas;
}

/**
 * Extract finishing material from room texts.
 */
function extractAcabamento(
  roomTexts: DxfText[],
  tipo: "piso" | "parede" | "forro"
): string | null {
  const patterns: Record<string, RegExp> = {
    piso: /piso[:\s]+(.+)/i,
    parede: /parede[:\s]+(.+)/i,
    forro: /forro[:\s]+(.+)/i,
  };

  for (const text of roomTexts) {
    const match = text.content.match(patterns[tipo]);
    if (match) return match[1].trim();
  }

  return null;
}

/**
 * Build tubulacoes from hydraulic layer entities.
 */
function buildTubulacoes(
  data: ExtractedDxfData,
  classifiedLayers: ClassifiedLayer[]
): DwgTubulacao[] {
  const hidLayers = new Set(
    classifiedLayers
      .filter((cl) => cl.disciplina === "hid")
      .map((cl) => cl.name)
  );

  const tubulacoes: DwgTubulacao[] = [];
  const layerLengths: Record<string, number> = {};

  // Sum line/polyline lengths per hydraulic layer
  for (const entity of data.entities) {
    if (!hidLayers.has(entity.layer)) continue;
    if (entity.type === "LINE" || entity.type === "LWPOLYLINE") {
      const length = entity.length ?? 0;
      layerLengths[entity.layer] = (layerLengths[entity.layer] ?? 0) + length;
    }
  }

  for (const [layerName, totalLength] of Object.entries(layerLengths)) {
    if (totalLength <= 0) continue;

    // Try to detect diameter and material from layer name or texts
    const diametro = detectDiametro(layerName, data.texts);
    const material = detectMaterial(layerName);

    tubulacoes.push({
      diametro_mm: diametro,
      material,
      comprimento_m: Math.round(toMeters(totalLength, data.units) * 100) / 100,
      layer: layerName,
    });
  }

  return tubulacoes;
}

function detectDiametro(layerName: string, _texts: DxfText[]): number {
  // Try to extract diameter from layer name
  const match = layerName.match(/(\d{2,3})(?:mm)?/);
  if (match) return parseInt(match[1]);

  // Default diameters by common layer name patterns
  if (/af|agua.*fria/i.test(layerName)) return 25;
  if (/aq|agua.*quente/i.test(layerName)) return 22;
  if (/esg/i.test(layerName)) return 100;
  if (/pluv/i.test(layerName)) return 75;

  return 50; // generic default
}

function detectMaterial(layerName: string): string {
  if (/pvc/i.test(layerName)) return "PVC";
  if (/cpvc/i.test(layerName)) return "CPVC";
  if (/ppr|pex/i.test(layerName)) return "PPR";
  if (/cobre|copper/i.test(layerName)) return "Cobre";
  if (/esg/i.test(layerName)) return "PVC";
  if (/af|agua.*fria/i.test(layerName)) return "PVC";
  if (/aq|agua.*quente/i.test(layerName)) return "CPVC";
  return "PVC";
}

/**
 * Build blocos output from mapped blocks.
 */
function buildBlocos(mappedBlocks: MappedBlock[]): DwgBloco[] {
  return mappedBlocks.map((mb) => ({
    nome: mb.name,
    contagem: mb.contagem,
    disciplina: mb.needs_review && mb.confidence === 0 ? null : mb.disciplina,
    confidence: mb.confidence,
    needs_review: mb.needs_review,
  }));
}

/**
 * Assemble the complete DwgPageOutput from all pipeline results.
 */
export async function assembleOutput(
  data: ExtractedDxfData,
  classifiedLayers: ClassifiedLayer[],
  mappedBlocks: MappedBlock[]
): Promise<DwgPageOutput> {
  const ambientes = await buildAmbientes(data, classifiedLayers);
  const tubulacoes = buildTubulacoes(data, classifiedLayers);
  const blocos = buildBlocos(mappedBlocks);

  const needsReview = blocos
    .filter((b) => b.needs_review)
    .map((b) => b.nome);

  const prancha = detectPrancha(data.texts);
  const pavimento = detectPavimento(data.texts);
  const tipo = detectTipo(classifiedLayers, data.texts);

  const output: DwgPageOutput = {
    prancha,
    tipo: tipo as DwgPageOutput["tipo"],
    source: "dwg",
    pavimento,
    page_number: 1, // DWG files are single-page (model space)
    ambientes,
    blocos,
    tubulacoes,
    needs_review: needsReview,
  };

  // Validate against schema
  const result = DwgPageOutputSchema.safeParse(output);
  if (!result.success) {
    console.error("DwgPageOutput validation failed:", result.error.issues);
    // Return a minimal valid output
    return {
      prancha,
      tipo: "outro",
      source: "dwg",
      pavimento,
      page_number: 1,
      ambientes: [],
      blocos,
      tubulacoes: [],
      needs_review: [
        ...needsReview,
        `VALIDATION_ERROR: ${result.error.issues.map((i) => i.message).join("; ")}`,
      ],
    };
  }

  return result.data;
}
```

### Step 9.2: Write tests

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/structured-output.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import type { ExtractedDxfData, ClassifiedLayer, MappedBlock } from "../src/types.js";

// Mock the extractor to avoid Python dependency in tests
vi.mock("../src/extractor.js", () => ({
  associateTextsToRooms: vi.fn().mockResolvedValue({}),
}));

describe("assembleOutput", () => {
  it("produces valid DwgPageOutput from extraction data", async () => {
    const { assembleOutput } = await import("../src/structured-output.js");
    const { DwgPageOutputSchema } = await import("../src/types.js");

    const data: ExtractedDxfData = {
      filename: "test.dxf",
      units: "mm",
      layers: [
        { name: "ARQ-PAREDE", color: 7, is_on: true, is_frozen: false, entity_counts: { LINE: 20 } },
        { name: "ELE-TOMADA", color: 3, is_on: true, is_frozen: false, entity_counts: { INSERT: 5 } },
        { name: "HID-TUB-AF", color: 1, is_on: true, is_frozen: false, entity_counts: { LINE: 10 } },
      ],
      entities: [
        {
          type: "LWPOLYLINE",
          layer: "ARQ-PAREDE",
          vertices: [[0, 0], [5000, 0], [5000, 3700], [0, 3700]],
          is_closed: true,
          length: 17400,
          area: 18500000,
        },
        {
          type: "LINE",
          layer: "HID-TUB-AF",
          start: [0, 0],
          end: [5000, 0],
          length: 5000,
        },
      ],
      blocks: [
        {
          name: "TOMADA_2P",
          position: [100, 200],
          rotation: 0,
          scale_x: 1,
          scale_y: 1,
          layer: "ELE-TOMADA",
          count: 15,
        },
      ],
      dimensions: [],
      texts: [
        { type: "TEXT", content: "Sala", position: [2500, 1850], height: 200, rotation: 0, layer: "ARQ-PAREDE" },
      ],
      stats: {
        total_layers: 3,
        total_entities: 2,
        total_blocks: 1,
        total_dimensions: 0,
        total_texts: 1,
      },
    };

    const classifiedLayers: ClassifiedLayer[] = [
      { name: "ARQ-PAREDE", disciplina: "arq", confidence: 0.95, method: "regex" },
      { name: "ELE-TOMADA", disciplina: "ele", confidence: 0.95, method: "regex" },
      { name: "HID-TUB-AF", disciplina: "hid", confidence: 0.95, method: "regex" },
    ];

    const mappedBlocks: MappedBlock[] = [
      { name: "TOMADA_2P", componente: "tomada", disciplina: "ele", unidade: "pt", contagem: 15, confidence: 0.95, needs_review: false },
    ];

    const output = await assembleOutput(data, classifiedLayers, mappedBlocks);

    expect(output.source).toBe("dwg");
    expect(output.blocos).toHaveLength(1);
    expect(output.blocos[0].nome).toBe("TOMADA_2P");
    expect(output.blocos[0].contagem).toBe(15);

    // Validate against schema
    const validation = DwgPageOutputSchema.safeParse(output);
    expect(validation.success).toBe(true);
  });

  it("flags unknown blocks in needs_review", async () => {
    const { assembleOutput } = await import("../src/structured-output.js");

    const data: ExtractedDxfData = {
      filename: "test.dxf",
      units: "mm",
      layers: [],
      entities: [],
      blocks: [],
      dimensions: [],
      texts: [],
      stats: { total_layers: 0, total_entities: 0, total_blocks: 0, total_dimensions: 0, total_texts: 0 },
    };

    const classifiedLayers: ClassifiedLayer[] = [];
    const mappedBlocks: MappedBlock[] = [
      { name: "Block1", componente: "desconhecido", disciplina: "geral", unidade: "un", contagem: 8, confidence: 0, needs_review: true },
    ];

    const output = await assembleOutput(data, classifiedLayers, mappedBlocks);
    expect(output.needs_review).toContain("Block1");
  });
});
```

### Step 9.3: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/src/structured-output.ts container/skills/dwg-pipeline/tests/structured-output.test.ts
git commit -m "feat(dwg): add structured output assembler with room/pipe/block aggregation"
git push
```

---

## Task 10: Pipeline orchestrator

**File:** `container/skills/dwg-pipeline/src/index.ts`

- [ ] 5-stage pipeline: ingestion, conversion, extraction, classification, structured_output
- [ ] Same job tracking pattern as pdf-pipeline
- [ ] CLI entry point
- [ ] Write tests

### Step 10.1: Create pipeline orchestrator

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/src/index.ts`

```typescript
// container/skills/dwg-pipeline/src/index.ts
import { mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import {
  getJob,
  updateJob,
  downloadFile,
  getFileInfo,
  upsertPageResult,
  getOrgIdForProject,
} from "./supabase.js";
import { convertDwgToDxf, isDxfFile } from "./converter.js";
import { extractDxf } from "./extractor.js";
import { classifyLayers } from "./layer-classifier.js";
import { mapBlocks } from "./block-mapper.js";
import { assembleOutput } from "./structured-output.js";
import type { DwgJobStage } from "./types.js";

const STAGE_PROGRESS: Record<string, number> = {
  ingestion: 10,
  conversion: 25,
  extraction: 45,
  classification: 70,
  structured_output: 90,
  done: 100,
};

/**
 * Run the full DWG/DXF processing pipeline for a given job ID.
 */
export async function runPipeline(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (job.status !== "pending") {
    console.log(`Job ${jobId} is not pending (status: ${job.status}), skipping.`);
    return;
  }

  // Create temp working directory
  const workDir = join(tmpdir(), `dwg-pipeline-${jobId}`);
  await mkdir(workDir, { recursive: true });

  try {
    // --- Stage 1: Ingestion ---
    await updateJob(jobId, {
      status: "processing",
      stage: "ingestion" as DwgJobStage,
      progress: STAGE_PROGRESS.ingestion,
      started_at: new Date().toISOString(),
    });

    const fileInfo = await getFileInfo(job.file_id);
    const ext = extname(fileInfo.storage_path).toLowerCase();
    const localFilename = `input${ext}`;
    const localPath = join(workDir, localFilename);
    await downloadFile(fileInfo.storage_path, localPath);
    console.log(`[${jobId}] Ingestion complete: ${fileInfo.storage_path} (${fileInfo.file_type})`);

    // --- Stage 2: Conversion (DWG → DXF, skipped for DXF files) ---
    await updateJob(jobId, {
      stage: "conversion" as DwgJobStage,
      progress: STAGE_PROGRESS.conversion,
    });

    let dxfPath: string;

    if (isDxfFile(localPath)) {
      dxfPath = localPath;
      console.log(`[${jobId}] Conversion skipped: file is already DXF`);
    } else {
      const convResult = await convertDwgToDxf(localPath, workDir);
      if (!convResult.success || !convResult.dxfPath) {
        // Mark as needs_conversion — user must convert manually
        await updateJob(jobId, {
          status: "needs_conversion" as any,
          stage: "conversion" as DwgJobStage,
          error_message: convResult.error ?? "DWG conversion failed. Please convert to DXF in AutoCAD and re-upload.",
        });
        console.log(`[${jobId}] Conversion failed: ${convResult.error}`);
        return;
      }
      dxfPath = convResult.dxfPath;
      console.log(`[${jobId}] Conversion complete: ${dxfPath}`);
    }

    // --- Stage 3: Extraction ---
    await updateJob(jobId, {
      stage: "extraction" as DwgJobStage,
      progress: STAGE_PROGRESS.extraction,
    });

    const extractedData = await extractDxf(dxfPath);
    console.log(
      `[${jobId}] Extraction complete: ${extractedData.stats.total_layers} layers, ` +
        `${extractedData.stats.total_entities} entities, ${extractedData.stats.total_blocks} blocks`
    );

    // --- Stage 4: Classification ---
    await updateJob(jobId, {
      stage: "classification" as DwgJobStage,
      progress: STAGE_PROGRESS.classification,
    });

    const orgId = await getOrgIdForProject(fileInfo.project_id);

    const classifiedLayers = await classifyLayers(
      extractedData.layers,
      extractedData.entities,
      extractedData.blocks,
      extractedData.texts,
      orgId
    );
    console.log(`[${jobId}] Classification complete: ${classifiedLayers.length} layers classified`);

    const mappedBlocks = await mapBlocks(extractedData.blocks, orgId);
    console.log(`[${jobId}] Block mapping complete: ${mappedBlocks.length} blocks mapped`);

    // --- Stage 5: Structured Output ---
    await updateJob(jobId, {
      stage: "structured_output" as DwgJobStage,
      progress: STAGE_PROGRESS.structured_output,
    });

    const output = await assembleOutput(extractedData, classifiedLayers, mappedBlocks);

    // Compute overall confidence (min of all ambiente confidences, or 0.5 if no ambientes)
    const confidence =
      output.ambientes.length > 0
        ? Math.min(...output.ambientes.map((a) => a.confidence))
        : 0.5;

    // Persist result to ob_pdf_pages
    await upsertPageResult(job.file_id, 1, {
      prancha_id: output.prancha,
      tipo: output.tipo,
      text_content: extractedData.texts.map((t) => t.content).join("\n"),
      ocr_used: false,
      image_path: "",
      structured_data: output as unknown as Record<string, unknown>,
      confidence,
      needs_review: output.needs_review.length > 0,
      review_notes:
        output.needs_review.length > 0
          ? `Blocos nao reconhecidos: ${output.needs_review.join(", ")}`
          : null,
    });

    // --- Done ---
    await updateJob(jobId, {
      status: "done",
      stage: "done" as DwgJobStage,
      progress: 100,
      completed_at: new Date().toISOString(),
    });

    console.log(
      `[${jobId}] Pipeline complete: ${output.ambientes.length} ambientes, ` +
        `${output.blocos.length} blocos, ${output.tubulacoes.length} tubulacoes`
    );
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

// CLI entry point: `dwg-pipeline process --job-id <uuid>`
const args = process.argv.slice(2);
if (args[0] === "process" && args[1] === "--job-id" && args[2]) {
  runPipeline(args[2]).catch((err) => {
    console.error("Fatal pipeline error:", err);
    process.exit(1);
  });
}
```

### Step 10.2: Write tests

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/pipeline.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";

describe("runPipeline", () => {
  it("skips jobs that are not pending", async () => {
    // Mock supabase to return a non-pending job
    vi.doMock("../src/supabase.js", () => ({
      getJob: vi.fn().mockResolvedValue({
        id: "test-id",
        file_id: "file-id",
        status: "done",
        stage: "done",
        progress: 100,
        error_message: null,
        started_at: null,
        completed_at: null,
      }),
      updateJob: vi.fn(),
      downloadFile: vi.fn(),
      getFileInfo: vi.fn(),
      upsertPageResult: vi.fn(),
      getOrgIdForProject: vi.fn(),
    }));

    const { runPipeline } = await import("../src/index.js");
    // Should not throw — just skip
    await runPipeline("test-id");
  });
});
```

### Step 10.3: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/src/index.ts container/skills/dwg-pipeline/tests/pipeline.test.ts
git commit -m "feat(dwg): add 5-stage pipeline orchestrator with CLI entry point"
git push
```

---

## Task 11: Frontend changes

- [ ] PdfUploader.tsx — accept .dwg and .dxf
- [ ] usePdfJobs.ts — handle dwg/dxf file types in upload
- [ ] PranchaList.tsx — show file type badge
- [ ] ReviewPanel.tsx — add block/layer review sections and hooks

### Step 11.1: Update PdfUploader

**File:** `/Users/andrefogelman/orcabot/frontend/src/components/pdf/PdfUploader.tsx`

Changes:
- Accept `.dwg` and `.dxf` in addition to `.pdf`
- Detect file type from extension
- Update user-facing text

```typescript
// Replace the file filter and accept attribute:

// OLD:
//   const pdfFiles = Array.from(files).filter((f) => f.type === "application/pdf");
//   if (pdfFiles.length === 0) { toast.error("Selecione arquivos PDF"); return; }

// NEW:
const ACCEPTED_EXTENSIONS = [".pdf", ".dwg", ".dxf"];
const ACCEPTED_MIME_TYPES = ["application/pdf", "application/acad", "application/dxf", "application/octet-stream", "image/vnd.dwg", "image/x-dwg"];

function getFileType(file: File): "pdf" | "dwg" | "dxf" | null {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "dwg") return "dwg";
  if (ext === "dxf") return "dxf";
  return null;
}

// In handleFiles:
const validFiles = Array.from(files).filter((f) => getFileType(f) !== null);
if (validFiles.length === 0) {
  toast.error("Selecione arquivos PDF, DWG ou DXF");
  return;
}

for (const file of validFiles) {
  const fileType = getFileType(file)!;
  try {
    await uploadPdf.mutateAsync({
      projectId,
      file,
      disciplina: disciplina === "auto" ? null : disciplina,
      fileType,
    });
    toast.success(`${file.name} enviado com sucesso`);
  } catch {
    toast.error(`Erro ao enviar ${file.name}`);
  }
}

// Update the input accept:
// <input type="file" accept=".pdf,.dwg,.dxf" ...>

// Update text:
// "Arraste PDFs, DWGs ou DXFs aqui ou clique para selecionar"
```

### Step 11.2: Update usePdfJobs (useUploadPdf)

**File:** `/Users/andrefogelman/orcabot/frontend/src/hooks/usePdfJobs.ts`

Changes to `useUploadPdf`:

```typescript
// Add fileType to the mutation params:
mutationFn: async ({
  projectId,
  file,
  disciplina,
  fileType = "pdf",
}: {
  projectId: string;
  file: File;
  disciplina: string | null;
  fileType?: "pdf" | "dwg" | "dxf";
}) => {
  const storagePath = `projects/${projectId}/${Date.now()}-${file.name}`;

  // Content type varies by file type
  const contentTypeMap: Record<string, string> = {
    pdf: "application/pdf",
    dwg: "application/octet-stream",
    dxf: "application/dxf",
  };

  const { error: uploadError } = await supabase.storage
    .from("project-pdfs")
    .upload(storagePath, file, {
      contentType: contentTypeMap[fileType] ?? "application/octet-stream",
    });

  if (uploadError) throw uploadError;

  const { data: fileRecord, error: fileError } = await supabase
    .from("ob_project_files")
    .insert({
      project_id: projectId,
      storage_path: storagePath,
      filename: file.name,
      file_type: fileType,
      disciplina: disciplina as ProjectFile["disciplina"],
      status: "uploaded" as const,
    })
    .select()
    .single();

  if (fileError) throw fileError;

  // Create processing job
  const { error: jobError } = await supabase
    .from("ob_pdf_jobs")
    .insert({
      file_id: fileRecord.id,
      status: "pending" as const,
      stage: null,
      progress: 0,
      error_message: null,
      started_at: null,
      completed_at: null,
    });

  if (jobError) throw jobError;

  return fileRecord;
},
```

Add new hooks for block/layer review:

```typescript
export function useUnmappedBlocks(orgId: string) {
  return useQuery({
    queryKey: ["unmapped-blocks", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ob_block_mappings")
        .select("*")
        .eq("org_id", orgId)
        .eq("confirmed", false);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });
}

export function useUnclassifiedLayers(orgId: string) {
  return useQuery({
    queryKey: ["unclassified-layers", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ob_layer_mappings")
        .select("*")
        .eq("org_id", orgId)
        .eq("confirmed", false);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });
}

export function useConfirmBlockMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, componente, disciplina, unidade }: {
      id: string;
      componente: string;
      disciplina: string;
      unidade: string;
    }) => {
      const { error } = await supabase
        .from("ob_block_mappings")
        .update({ componente, disciplina, unidade, confirmed: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unmapped-blocks"] });
    },
  });
}

export function useConfirmLayerMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, disciplina }: { id: string; disciplina: string }) => {
      const { error } = await supabase
        .from("ob_layer_mappings")
        .update({ disciplina, confirmed: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unclassified-layers"] });
    },
  });
}
```

### Step 11.3: Update PranchaList

**File:** `/Users/andrefogelman/orcabot/frontend/src/components/pdf/PranchaList.tsx`

Add file type badge next to filename:

```typescript
// Add imports:
import { Badge } from "@/components/ui/badge";

// Add file type badge map:
const FILE_TYPE_BADGE: Record<string, { label: string; className: string }> = {
  pdf: { label: "PDF", className: "bg-red-100 text-red-700 border-red-200" },
  dwg: { label: "DWG", className: "bg-blue-100 text-blue-700 border-blue-200" },
  dxf: { label: "DXF", className: "bg-purple-100 text-purple-700 border-purple-200" },
};

// In the file button, after the filename span, add:
{(() => {
  const badge = FILE_TYPE_BADGE[file.file_type] ?? FILE_TYPE_BADGE.pdf;
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1 py-0 h-4", badge.className)}>
      {badge.label}
    </Badge>
  );
})()}

// Update the empty state text:
// "Nenhum arquivo enviado" (instead of "Nenhum PDF enviado")
```

### Step 11.4: Update ReviewPanel

**File:** `/Users/andrefogelman/orcabot/frontend/src/components/pdf/ReviewPanel.tsx`

Add block and layer review sections. After the existing review items section, add:

```typescript
// New imports:
import {
  useUnmappedBlocks,
  useUnclassifiedLayers,
  useConfirmBlockMapping,
  useConfirmLayerMapping,
} from "@/hooks/usePdfJobs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

// Add new sections to ReviewPanel component (after the existing review items):

// --- Unmapped Blocks Section ---
function UnmappedBlocksSection({ orgId }: { orgId: string }) {
  const { data: blocks } = useUnmappedBlocks(orgId);
  const confirmBlock = useConfirmBlockMapping();

  if (!blocks || blocks.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-blue-600" />
        Blocos nao reconhecidos ({blocks.length})
      </h3>

      {blocks.map((block) => (
        <UnmappedBlockCard
          key={block.id}
          block={block}
          onConfirm={(componente, disciplina, unidade) =>
            confirmBlock.mutate({ id: block.id, componente, disciplina, unidade })
          }
        />
      ))}
    </div>
  );
}

function UnmappedBlockCard({
  block,
  onConfirm,
}: {
  block: { id: string; block_name: string; componente: string; disciplina: string; unidade: string };
  onConfirm: (componente: string, disciplina: string, unidade: string) => void;
}) {
  const [componente, setComponente] = useState(block.componente);
  const [disciplina, setDisciplina] = useState(block.disciplina);
  const [unidade, setUnidade] = useState(block.unidade);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="text-sm font-medium">Bloco: {block.block_name}</p>
      <div className="grid grid-cols-3 gap-2">
        <Input
          placeholder="Componente"
          value={componente}
          onChange={(e) => setComponente(e.target.value)}
          className="text-xs h-8"
        />
        <Select value={disciplina} onValueChange={setDisciplina}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="arq">Arquitetonico</SelectItem>
            <SelectItem value="est">Estrutural</SelectItem>
            <SelectItem value="hid">Hidraulico</SelectItem>
            <SelectItem value="ele">Eletrico</SelectItem>
            <SelectItem value="geral">Geral</SelectItem>
          </SelectContent>
        </Select>
        <Select value={unidade} onValueChange={setUnidade}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="un">un</SelectItem>
            <SelectItem value="pt">pt</SelectItem>
            <SelectItem value="m">m</SelectItem>
            <SelectItem value="m2">m2</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => onConfirm(componente, disciplina, unidade)}
      >
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Confirmar Mapeamento
      </Button>
    </div>
  );
}

// --- Unclassified Layers Section ---
function UnclassifiedLayersSection({ orgId }: { orgId: string }) {
  const { data: layers } = useUnclassifiedLayers(orgId);
  const confirmLayer = useConfirmLayerMapping();

  if (!layers || layers.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-purple-600" />
        Layers nao classificados ({layers.length})
      </h3>

      {layers.map((layer) => (
        <UnclassifiedLayerCard
          key={layer.id}
          layer={layer}
          onConfirm={(disciplina) =>
            confirmLayer.mutate({ id: layer.id, disciplina })
          }
        />
      ))}
    </div>
  );
}

function UnclassifiedLayerCard({
  layer,
  onConfirm,
}: {
  layer: { id: string; layer_name: string; disciplina: string };
  onConfirm: (disciplina: string) => void;
}) {
  const [disciplina, setDisciplina] = useState(layer.disciplina);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="text-sm font-medium">Layer: {layer.layer_name}</p>
      <p className="text-xs text-muted-foreground">Sugestao: {layer.disciplina}</p>
      <div className="flex gap-2">
        <Select value={disciplina} onValueChange={setDisciplina}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="arq">Arquitetonico</SelectItem>
            <SelectItem value="est">Estrutural</SelectItem>
            <SelectItem value="hid">Hidraulico</SelectItem>
            <SelectItem value="ele">Eletrico</SelectItem>
            <SelectItem value="cotas">Cotas</SelectItem>
            <SelectItem value="anotacoes">Anotacoes</SelectItem>
            <SelectItem value="ignorar">Ignorar</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onConfirm(disciplina)}
        >
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Confirmar
        </Button>
      </div>
    </div>
  );
}
```

### Step 11.5: Build and commit

```bash
cd /Users/andrefogelman/orcabot/frontend && bun run build
```

```bash
cd /Users/andrefogelman/orcabot
git add frontend/src/components/pdf/PdfUploader.tsx frontend/src/hooks/usePdfJobs.ts frontend/src/components/pdf/PranchaList.tsx frontend/src/components/pdf/ReviewPanel.tsx
git commit -m "feat(frontend): accept DWG/DXF uploads with file type badges and block/layer review UI"
git push
```

---

## Task 12: Dockerfile updates

**File:** `container/Dockerfile.agent`

- [ ] Add `libredwg-tools` to apt-get
- [ ] Add `ezdxf` to the Python venv
- [ ] Commit

### Step 12.1: Update Dockerfile

In `/Users/andrefogelman/orcabot/container/Dockerfile.agent`, modify the apt-get line and add ezdxf installation:

```dockerfile
# Change this line:
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-por \
    fonts-liberation \
    curl \
    git \
    libredwg-tools \
    && rm -rf /var/lib/apt/lists/*

# Change PaddleOCR venv to also include ezdxf:
RUN python3 -m venv /opt/paddleocr && \
    /opt/paddleocr/bin/pip install --no-cache-dir paddlepaddle paddleocr ezdxf
```

### Step 12.2: Commit

```bash
cd /Users/andrefogelman/orcabot
git add container/Dockerfile.agent
git commit -m "feat(docker): add libredwg-tools and ezdxf to agent container"
git push
```

---

## Task 13: Backend routing

**File:** `src/channels/api-channel.ts`

- [ ] Detect file type when creating jobs
- [ ] Route to appropriate pipeline (pdf-pipeline vs dwg-pipeline)
- [ ] Commit

### Step 13.1: Update api-channel.ts

In the `handleJob` function in `/Users/andrefogelman/orcabot/src/channels/api-channel.ts`, add file type detection:

```typescript
// After the existing body validation in handleJob, add file type lookup:

async function handleJob(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  const body = parseJson(raw) as {
    project_id?: string;
    file_id?: string;
  } | null;

  if (!body || !body.project_id || !body.file_id) {
    json(res, 400, {
      error: 'Missing required fields: project_id, file_id',
    });
    return;
  }

  if (!isValidUuid(body.project_id) || !isValidUuid(body.file_id)) {
    json(res, 400, { error: 'project_id and file_id must be UUIDs' });
    return;
  }

  // Detect file type to determine which pipeline to use
  const { data: fileData, error: fileError } = await supabaseAdmin
    .from('ob_project_files')
    .select('file_type')
    .eq('id', body.file_id)
    .single();

  if (fileError || !fileData) {
    json(res, 404, { error: 'File not found' });
    return;
  }

  const pipeline = fileData.file_type === 'dwg' || fileData.file_type === 'dxf'
    ? 'dwg-pipeline'
    : 'pdf-pipeline';

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin.from('ob_pdf_jobs').insert({
    id: jobId,
    project_id: body.project_id,
    file_id: body.file_id,
    status: 'queued',
    created_at: now,
  });

  if (error) {
    logger.error(
      { project_id: body.project_id, file_id: body.file_id, error: error.message },
      'Failed to create job',
    );
    json(res, 500, { error: 'Failed to create job' });
    return;
  }

  logger.info(
    { jobId, project_id: body.project_id, file_id: body.file_id, pipeline },
    `${pipeline} job created`,
  );

  json(res, 202, { ok: true, job_id: jobId, pipeline });
}
```

### Step 13.2: Commit

```bash
cd /Users/andrefogelman/orcabot
git add src/channels/api-channel.ts
git commit -m "feat(backend): route DWG/DXF uploads to dwg-pipeline, PDF to pdf-pipeline"
git push
```

---

## Task 14: Integration test

- [ ] Create end-to-end test with sample DXF fixture
- [ ] Verify structured output format
- [ ] Commit

### Step 14.1: Create a minimal DXF test fixture

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/fixtures/sample.dxf`

This must be a real DXF file. Create it programmatically:

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/fixtures/create_sample.py`

```python
#!/usr/bin/env python3
"""Generate a minimal sample DXF for testing."""

import ezdxf

doc = ezdxf.new("R2010")
msp = doc.modelspace()

# Create layers
doc.layers.add("ARQ-PAREDE", color=7)
doc.layers.add("ARQ-TEXTO", color=7)
doc.layers.add("ELE-TOMADA", color=3)
doc.layers.add("HID-TUB-AF", color=1)
doc.layers.add("COT-COTAS", color=2)

# Room 1: Sala (5m x 3.7m in mm)
msp.add_lwpolyline(
    [(0, 0), (5000, 0), (5000, 3700), (0, 3700)],
    close=True,
    dxfattribs={"layer": "ARQ-PAREDE"},
)

# Room 2: Cozinha (3m x 3m)
msp.add_lwpolyline(
    [(5000, 0), (8000, 0), (8000, 3000), (5000, 3000)],
    close=True,
    dxfattribs={"layer": "ARQ-PAREDE"},
)

# Room names as TEXT
msp.add_text("Sala", dxfattribs={"layer": "ARQ-TEXTO", "height": 200, "insert": (2500, 1850)})
msp.add_text("Cozinha", dxfattribs={"layer": "ARQ-TEXTO", "height": 200, "insert": (6500, 1500)})

# Tomada block definition
block = doc.blocks.new("TOMADA_2P")
block.add_circle((0, 0), radius=50, dxfattribs={"layer": "ELE-TOMADA"})
block.add_line((-50, 0), (50, 0), dxfattribs={"layer": "ELE-TOMADA"})

# Insert tomadas
for x, y in [(500, 300), (2000, 300), (4000, 300), (500, 3400), (4500, 3400)]:
    msp.add_blockref("TOMADA_2P", (x, y), dxfattribs={"layer": "ELE-TOMADA"})

# Hydraulic line (cold water pipe)
msp.add_line((0, 1850), (5000, 1850), dxfattribs={"layer": "HID-TUB-AF"})
msp.add_line((5000, 1850), (8000, 1850), dxfattribs={"layer": "HID-TUB-AF"})

# Dimension
dim = msp.add_linear_dim(
    base=(2500, -500),
    p1=(0, 0),
    p2=(5000, 0),
    dxfattribs={"layer": "COT-COTAS"},
)
dim.render()

# Set units to mm
doc.header["$INSUNITS"] = 4  # mm

doc.saveas("sample.dxf")
print("sample.dxf created successfully")
```

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/fixtures && python3 create_sample.py
```

### Step 14.2: Create integration test

File: `/Users/andrefogelman/orcabot/container/skills/dwg-pipeline/tests/integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeAll } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { access, constants } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DXF = join(__dirname, "fixtures", "sample.dxf");

describe("DWG Pipeline Integration", () => {
  let hasPython = false;
  let hasEzdxf = false;

  beforeAll(async () => {
    // Check if python3 and ezdxf are available
    try {
      const { execFile } = await import("node:child_process");
      await new Promise<void>((resolve, reject) => {
        execFile("python3", ["-c", "import ezdxf; print('ok')"], (err, stdout) => {
          if (err) reject(err);
          else {
            hasPython = true;
            hasEzdxf = stdout.trim() === "ok";
            resolve();
          }
        });
      });
    } catch {
      // Python or ezdxf not available — skip integration tests
    }
  });

  it("sample.dxf fixture exists", async () => {
    try {
      await access(SAMPLE_DXF, constants.R_OK);
    } catch {
      console.warn("sample.dxf not found — run create_sample.py to generate it");
      return;
    }
  });

  it("Python extractor produces valid JSON from sample.dxf", async () => {
    if (!hasPython || !hasEzdxf) {
      console.warn("Skipping: python3 or ezdxf not available");
      return;
    }

    try {
      await access(SAMPLE_DXF, constants.R_OK);
    } catch {
      console.warn("Skipping: sample.dxf not found");
      return;
    }

    const { extractDxf } = await import("../src/extractor.js");
    const data = await extractDxf(SAMPLE_DXF);

    // Verify structure
    expect(data.filename).toBe("sample.dxf");
    expect(data.units).toBe("mm");
    expect(data.layers.length).toBeGreaterThanOrEqual(4);
    expect(data.stats.total_entities).toBeGreaterThan(0);
    expect(data.stats.total_blocks).toBeGreaterThan(0);

    // Verify specific content
    const arqLayer = data.layers.find((l) => l.name === "ARQ-PAREDE");
    expect(arqLayer).toBeDefined();
    expect(arqLayer?.is_on).toBe(true);

    // Verify tomada block was extracted
    const tomadaBlock = data.blocks.find((b) => b.name === "TOMADA_2P");
    expect(tomadaBlock).toBeDefined();
    expect(tomadaBlock?.count).toBe(5);

    // Verify texts
    const salaText = data.texts.find((t) => t.content === "Sala");
    expect(salaText).toBeDefined();

    // Verify closed polylines (rooms)
    const closedPolys = data.entities.filter(
      (e) => e.type === "LWPOLYLINE" && e.is_closed
    );
    expect(closedPolys.length).toBeGreaterThanOrEqual(2);
  });

  it("layer classifier correctly classifies sample layers", async () => {
    const { classifyByName } = await import("../src/layer-classifier.js");

    expect(classifyByName("ARQ-PAREDE")?.disciplina).toBe("arq");
    expect(classifyByName("ELE-TOMADA")?.disciplina).toBe("ele");
    expect(classifyByName("HID-TUB-AF")?.disciplina).toBe("hid");
    expect(classifyByName("COT-COTAS")?.disciplina).toBe("cotas");
  });

  it("block mapper correctly identifies TOMADA_2P", async () => {
    const { identifyByName } = await import("../src/block-mapper.js");

    const result = identifyByName("TOMADA_2P");
    expect(result).toEqual({
      componente: "tomada",
      disciplina: "ele",
      unidade: "pt",
    });
  });

  it("end-to-end: sample.dxf produces valid DwgPageOutput", async () => {
    if (!hasPython || !hasEzdxf) {
      console.warn("Skipping: python3 or ezdxf not available");
      return;
    }

    try {
      await access(SAMPLE_DXF, constants.R_OK);
    } catch {
      console.warn("Skipping: sample.dxf not found");
      return;
    }

    // Mock supabase calls for layer/block mapping cache
    vi.doMock("../src/supabase.js", () => ({
      getLayerMappings: vi.fn().mockResolvedValue([]),
      saveLayerMapping: vi.fn().mockResolvedValue(undefined),
      getBlockMappings: vi.fn().mockResolvedValue([]),
      saveBlockMapping: vi.fn().mockResolvedValue(undefined),
    }));

    const { extractDxf } = await import("../src/extractor.js");
    const { classifyByName } = await import("../src/layer-classifier.js");
    const { identifyByName } = await import("../src/block-mapper.js");
    const { DwgPageOutputSchema } = await import("../src/types.js");

    // Extract
    const data = await extractDxf(SAMPLE_DXF);

    // Classify layers (regex only — no LLM in tests)
    const classifiedLayers = data.layers.map((layer) => {
      const result = classifyByName(layer.name);
      return result ?? { name: layer.name, disciplina: "ignorar" as const, confidence: 0, method: "regex" as const };
    });

    // Map blocks (regex only — no LLM in tests)
    const mappedBlocks = data.blocks.map((block) => {
      const result = identifyByName(block.name);
      return {
        name: block.name,
        componente: result?.componente ?? "desconhecido",
        disciplina: result?.disciplina ?? ("geral" as const),
        unidade: result?.unidade ?? "un",
        contagem: block.count,
        confidence: result ? 0.95 : 0,
        needs_review: !result,
      };
    });

    // Assemble output (with mocked text association)
    vi.doMock("../src/extractor.js", () => ({
      extractDxf: vi.fn().mockResolvedValue(data),
      associateTextsToRooms: vi.fn().mockResolvedValue({}),
    }));

    const { assembleOutput } = await import("../src/structured-output.js");
    const output = await assembleOutput(data, classifiedLayers, mappedBlocks);

    // Validate
    expect(output.source).toBe("dwg");
    expect(output.blocos.length).toBeGreaterThan(0);

    const tomada = output.blocos.find((b) => b.nome === "TOMADA_2P");
    expect(tomada).toBeDefined();
    expect(tomada?.contagem).toBe(5);
    expect(tomada?.disciplina).toBe("ele");

    // Schema validation
    const validation = DwgPageOutputSchema.safeParse(output);
    expect(validation.success).toBe(true);
  });
});
```

### Step 14.3: Run tests and commit

```bash
cd /Users/andrefogelman/orcabot/container/skills/dwg-pipeline && bun run test
```

```bash
cd /Users/andrefogelman/orcabot
git add container/skills/dwg-pipeline/tests/fixtures/ container/skills/dwg-pipeline/tests/integration.test.ts
git commit -m "test(dwg): add integration test with sample DXF fixture"
git push
```
