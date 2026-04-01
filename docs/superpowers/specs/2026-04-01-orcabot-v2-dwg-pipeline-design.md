# OrcaBot v2 — DWG/DXF Pipeline Design Spec

Módulo adicional ao OrcaBot para leitura e levantamento quantitativo a partir de arquivos DWG e DXF, com extração 100% geométrica.

## Contexto

- **v1 (existente)**: pipeline PDF com OCR + Claude Vision — confiança 70-85%, fallback humano frequente
- **v2 (este spec)**: pipeline DWG/DXF com extração geométrica exata — confiança 95-99%
- O pipeline PDF continua 100% intacto. DWG é um módulo **paralelo**, não substituto
- Os agentes (orçamentista, estrutural, hidráulico, eletricista) recebem o mesmo JSON — não sabem se veio de PDF ou DWG

## Decisões de Design

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Parsing DXF | ezdxf (Python) | Maduro, suporta todas as versões, API rica |
| Conversão DWG→DXF | LibreDWG (dwg2dxf) | Open source, suporta até DWG 2018 |
| Fallback conversão | Pedir ao usuário | Se LibreDWG falhar em DWGs recentes |
| Classificação layers | 3 etapas (regex → conteúdo → LLM) | Lida com padrão e bagunça |
| Blocos | Auto-ID + LLM fallback + confirmação humana | Cobertura ampla sem falsos positivos |
| Mapeamentos | Salvos por organização | Reutilizáveis entre projetos do mesmo escritório |
| Output | Mesmo JSON do PDF pipeline | Zero mudanças nos agentes |

## Roteamento por Tipo de Arquivo

```
Upload → detecta extensão
       → .pdf  → pdf-pipeline (existente, sem alterações)
       → .dxf  → dwg-pipeline (novo) → parsear direto com ezdxf
       → .dwg  → dwg-pipeline → LibreDWG converte → DXF → parsear
                                  ↓ (se falhar)
                               marca needs_conversion, pede ao usuário
```

## Pipeline DWG/DXF — 5 Estágios

### 1. Ingestion
- Download do Supabase Storage
- Detectar formato (DWG vs DXF) pelo header/extensão
- Criar job em `ob_pdf_jobs` (reutiliza mesma tabela)

### 2. Conversion (só para DWG)
- LibreDWG `dwg2dxf input.dwg` → gera `input.dxf`
- Se LibreDWG falhar (DWG muito recente ou corrompido):
  - Marcar job como `needs_conversion`
  - Frontend exibe mensagem pedindo ao usuário para converter no AutoCAD e subir como DXF
- Se DXF → pula este estágio

### 3. Extraction (ezdxf)
Python script `dwg_extractor.py` parseia o DXF e extrai:

**Layers:**
- Nome, cor, estado (on/off/frozen)
- Contagem de entidades por tipo

**Entidades geométricas por layer:**
- `LINE` → ponto inicial, ponto final, comprimento
- `LWPOLYLINE` → vértices, comprimento, área (se fechada), is_closed
- `CIRCLE` → centro, raio
- `ARC` → centro, raio, ângulos, comprimento
- `ELLIPSE` → centro, eixos

**Blocos (INSERT):**
- Nome do bloco, posição (x, y), rotação, escala
- Contagem de ocorrências por nome
- Conteúdo geométrico do bloco (entidades internas)

**Dimensões (DIMENSION):**
- Valor numérico exato (`actual_measurement`)
- Tipo (linear, angular, radial)
- Posição

**Textos (TEXT, MTEXT):**
- Conteúdo, posição (x, y), altura, rotação
- Associação posicional com polylines fechadas (textos dentro de ambientes)

### 4. Classification

**Etapa 1 — Match por nome do layer (regex):**
```
/par|wall|alv/i           → arquitetonico
/hid|tub|agua|esg|pluv/i  → hidraulico
/ele|ilu|tom|int|cond/i   → eletrico
/est|pil|vig|laj|fund/i   → estrutural
/cot|dim/i                → cotas
/text|anot/i              → anotacoes
/^0$|defpoints/i          → ignorar
```
Match → confiança 0.95, sem LLM.

**Etapa 2 — Análise de conteúdo (sem LLM):**
Se nome não deu match, analisar entidades do layer:
- Muitos INSERT de blocos tipo "TOMADA"? → elétrico
- CIRCLE com raios pequenos (20-50mm)? → conexões hidráulicas
- LWPOLYLINE fechadas grandes? → ambientes arquitetônicos
- DIMENSION entities? → cotas

Padrão claro → confiança 0.85, sem LLM.

**Etapa 3 — LLM fallback:**
Só para layers não classificados nas etapas 1 e 2. Envia ao LLM:
- Nome do layer
- Amostra de 10 entidades (tipo, dimensões, posição)
- Nomes de blocos inseridos nesse layer
- Textos encontrados nesse layer

LLM retorna: disciplina + justificativa. Confiança 0.75.

**Classificações confirmadas pelo usuário são salvas** em `ob_layer_mappings` por organização — reutilizáveis.

### 5. Structured Output
Monta o mesmo JSON do PDF pipeline:

```json
{
  "prancha": "ARQ-01",
  "tipo": "arquitetonico-planta-baixa",
  "source": "dwg",
  "ambientes": [
    {
      "nome": "Sala",
      "area_m2": 18.50,
      "perimetro_m": 17.40,
      "pe_direito_m": 2.80,
      "acabamentos": {
        "piso": "porcelanato 60x60 retificado",
        "parede": "pintura latex branco",
        "forro": "gesso liso"
      },
      "aberturas": [
        { "tipo": "porta", "dim": "0.80x2.10", "qtd": 1, "codigo": "P1" }
      ],
      "confidence": 0.97
    }
  ],
  "blocos": [
    { "nome": "TOMADA_2P", "contagem": 15, "disciplina": "ele", "confidence": 0.95 },
    { "nome": "Block1", "contagem": 8, "disciplina": null, "confidence": 0, "needs_review": true }
  ],
  "tubulacoes": [
    { "diametro_mm": 50, "material": "PVC", "comprimento_m": 23.4, "layer": "HID-TUB-AF" }
  ],
  "needs_review": ["Block1"]
}
```

Campo `source: "dwg"` diferencia a origem. Agentes recebem o mesmo schema.

## Mapeamento de Blocos (block-mapper)

### Auto-identificação
Nomes padrão reconhecidos automaticamente:

| Pattern | Componente | Disciplina | Unidade |
|---------|-----------|------------|---------|
| `/tomada|tug|tue/i` | tomada | ele | pt |
| `/ponto.*luz|ilum|lum/i` | ponto_iluminacao | ele | pt |
| `/interr|switch/i` | interruptor | ele | un |
| `/registro|reg/i` | registro | hid | un |
| `/ralo/i` | ralo | hid | un |
| `/porta|door|^p\d+$/i` | porta | arq | un |
| `/janela|window|^j\d+$/i` | janela | arq | un |
| `/pilar|col/i` | pilar | est | un |

### Blocos genéricos
- Nomes tipo `Block1`, `XPTO`, `Copy of...` → LLM analisa conteúdo geométrico do bloco
- LLM sugere classificação → usuário confirma/corrige no ReviewPanel
- Mapeamento confirmado salvo em `ob_block_mappings` (por org_id) → reutilizável

## Modelo de Dados — Novas Tabelas

### ob_block_mappings
```sql
CREATE TABLE ob_block_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ob_organizations(id),
  block_name text NOT NULL,
  componente text NOT NULL,
  disciplina text NOT NULL CHECK (disciplina IN ('arq', 'est', 'hid', 'ele', 'geral')),
  unidade text NOT NULL,
  confirmed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, block_name)
);
```

### ob_layer_mappings
```sql
CREATE TABLE ob_layer_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ob_organizations(id),
  layer_name text NOT NULL,
  disciplina text NOT NULL CHECK (disciplina IN ('arq', 'est', 'hid', 'ele', 'cotas', 'anotacoes', 'ignorar')),
  confirmed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, layer_name)
);
```

### Alteração existente
```sql
ALTER TABLE ob_project_files DROP CONSTRAINT IF EXISTS ob_project_files_file_type_check;
ALTER TABLE ob_project_files ADD CONSTRAINT ob_project_files_file_type_check
  CHECK (file_type IN ('pdf', 'dwg', 'dxf', 'xlsx'));
```

Tabelas `ob_pdf_jobs` e `ob_pdf_pages` reutilizadas sem alteração (jsonb genérico).

## Estrutura de Arquivos

```
container/skills/dwg-pipeline/
├── SKILL.md
├── package.json
├── requirements.txt              # ezdxf, LibreDWG
├── src/
│   ├── index.ts                  # Orquestrador (5 estágios)
│   ├── types.ts                  # Importa tipos do pdf-pipeline + tipos DWG
│   ├── converter.ts              # DWG → DXF via LibreDWG (dwg2dxf)
│   ├── layer-classifier.ts      # 3 etapas: regex → conteúdo → LLM
│   ├── block-mapper.ts           # Mapeia blocos → componentes
│   ├── structured-output.ts     # Monta JSON no schema compartilhado
│   ├── supabase.ts              # Mesmo padrão do pdf-pipeline
│   └── prompts.ts               # Prompts para classificação de layers e blocos
├── python/
│   ├── dwg_extractor.py          # ezdxf: extrai entidades, layers, blocos, textos
│   └── geometry.py               # Cálculos: áreas polylines, comprimentos, point-in-polygon
└── tests/
    ├── fixtures/
    │   └── sample.dxf            # DXF de teste
    ├── extractor.test.ts
    ├── layer-classifier.test.ts
    ├── block-mapper.test.ts
    ├── converter.test.ts
    └── pipeline.test.ts
```

## Mudanças no Código Existente

### Backend (mínimas)
- `src/channels/api-channel.ts` — aceitar `.dwg` e `.dxf` no endpoint de upload (já aceita `.pdf`)
- Roteamento no orchestrador: detectar file_type e chamar dwg-pipeline ou pdf-pipeline

### Frontend (3 mudanças)
1. **PdfUpload.tsx** — aceitar `.dwg` e `.dxf` no drag-and-drop (`accept` attribute)
2. **ReviewPanel.tsx** — nova seção "Blocos não reconhecidos" e "Layers não classificados" com UI para confirmar/corrigir mapeamentos
3. **PranchaList.tsx** — badge visual indicando origem (PDF vs DWG/DXF)

### Sem mudanças
- Planilha orçamentária, chat, export Excel, agentes, curva ABC — todos consomem o mesmo JSON

## Confidence Scores

| Fonte | Confiança |
|-------|-----------|
| Geometria DXF (áreas, comprimentos) | 0.95-0.99 |
| Blocos com nome padrão | 0.95 |
| Textos associados por posição | 0.80 |
| Layers classificados por nome | 0.95 |
| Layers classificados por conteúdo | 0.85 |
| Layers classificados por LLM | 0.75 |
| Blocos genéricos classificados por LLM | 0.70 |

Significativamente superior ao PDF pipeline (0.70-0.85).

## Limitações

- **LibreDWG** suporta até DWG 2018. DWGs mais recentes (2024+) podem falhar na conversão → fallback para o usuário converter
- **XREFs** (referências externas em DWG) não são resolvidos automaticamente — o usuário precisa subir todos os arquivos referenciados ou usar "bind" no AutoCAD antes
- **Escala** — DXFs podem estar em unidades diferentes (mm, cm, m). O extrator precisa detectar e normalizar
- **3D** — DWGs 3D não são suportados na v2. Foco em plantas 2D

## Dependências

- `ezdxf` >= 0.19 (Python)
- `LibreDWG` (compilado no container, ou via `apt install libredwg-tools`)
- Tipos compartilhados com `container/skills/pdf-pipeline/src/types.ts`
