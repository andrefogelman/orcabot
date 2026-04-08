# Design: Importação de Propostas de Fornecedores

**Data:** 2026-04-08
**Status:** Aprovado

## Objetivo

Permitir upload de PDFs de propostas comerciais de fornecedores, extrair automaticamente os itens de fornecimento (descrição, quantidade, unidade, preço unitário, total) via pipeline dedicado, revisar/editar os itens extraídos, e importar para a planilha de orçamento como uma etapa (L1).

## Escopo

Apenas o escopo de fornecimento: lista de itens com descrição, quantidade, unidade, preço unitário e total. Fora de escopo: condições de pagamento, prazo de entrega, observações, dados do fornecedor além do nome.

## Decisões de Design

| Decisão | Escolha |
|---------|---------|
| Estrutura na planilha | Cada proposta vira uma etapa L1, itens como L3 |
| Mapeamento de preços | `preco_unitario` → `custo_unitario`, `fonte = "cotacao"` |
| Revisão de itens | Aba "Propostas" com tabela editável antes de importar |
| Método de extração | Pipeline dedicado em container (`proposal-pipeline`) |
| Import para planilha | Botão separado "Importar Proposta" na toolbar da planilha |

## Arquitetura

### Dois Fluxos Independentes

**Fluxo 1 — Upload & Extração (Aba Propostas):**
```
Upload PDF → proposal-pipeline (container) → ob_propostas + ob_proposta_items → Revisar/Editar
```
- Upload de PDF com tipo `proposta`
- Pipeline extrai texto + visão → identifica itens tabulares → structured output
- Itens salvos em `ob_proposta_items` com confidence e needs_review
- Usuário revisa e corrige na aba Propostas (tabela editável)
- Status: `pending` → `extracted` → `reviewed`

**Fluxo 2 — Importação (Aba Planilha):**
```
Botão "Importar Proposta" → Dialog (selecionar proposta → preview → destino) → Cria L1 → L2 → L3
```
- Botão na toolbar da planilha, ao lado de "Importar Quantitativos"
- Dialog lista propostas com status `reviewed` (ou `extracted`)
- Preview dos itens selecionados
- Escolha de destino: nova etapa L1 ou etapa existente
- Import cria hierarquia L1 → L2 "Itens da Proposta" → L3 itens com custos preenchidos

### Database Schema

**ob_propostas:**
```sql
CREATE TABLE ob_propostas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES ob_projects(id) ON DELETE CASCADE NOT NULL,
  file_id uuid REFERENCES ob_project_files(id) ON DELETE SET NULL,
  fornecedor text NOT NULL,
  valor_total numeric(14,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'extracted', 'reviewed')),
  created_at timestamptz DEFAULT now() NOT NULL
);
```

**ob_proposta_items:**
```sql
CREATE TABLE ob_proposta_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  proposta_id uuid REFERENCES ob_propostas(id) ON DELETE CASCADE NOT NULL,
  descricao text NOT NULL,
  unidade text,
  quantidade numeric(14,4),
  preco_unitario numeric(14,2),
  preco_total numeric(14,2),
  confidence numeric(3,2) DEFAULT 0,
  needs_review boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);
```

**RLS:** Ambas as tabelas seguem o mesmo padrão das demais — acesso via `project_id` → `ob_projects.org_id` matchando o org do usuário autenticado.

**ob_project_files:** Adicionar `'proposta'` como valor válido para `disciplina` (ou `file_type`).

### Mapeamento: ob_proposta_items → ob_orcamento_items

| Proposta | → | Planilha |
|----------|---|---------|
| `fornecedor` | → | L1 etapa descricao (ex: "Prop. Esquadrias - Alumifort") |
| — | → | L2 descricao = "Itens da Proposta" |
| `descricao` | → | L3 descricao |
| `unidade` | → | L3 unidade |
| `quantidade` | → | L3 quantidade |
| `preco_unitario` | → | L3 custo_unitario |
| `preco_total` | → | L3 custo_total |
| — | → | L3 fonte = "cotacao" |

### Componentes Frontend

**Novos:**
- `frontend/src/components/workspace/PropostasTab.tsx` — aba nova no WorkspaceTabs
- `frontend/src/components/propostas/PropostaUploader.tsx` — upload de PDF de proposta
- `frontend/src/components/propostas/PropostaList.tsx` — lista de propostas do projeto
- `frontend/src/components/propostas/PropostaItemsTable.tsx` — tabela editável de itens extraídos
- `frontend/src/components/planilha/ImportPropostas.tsx` — dialog de importação (na planilha)
- `frontend/src/hooks/usePropostas.ts` — hooks CRUD para propostas e itens

**Modificados:**
- `frontend/src/components/workspace/WorkspaceTabs.tsx` — adicionar aba "Propostas"
- `frontend/src/components/planilha/BudgetToolbar.tsx` — adicionar botão "Importar Proposta"
- `frontend/src/types/orcamento.ts` — tipos Proposta e PropostaItem

### Pipeline (Container)

**Localização:** `container/skills/proposal-pipeline/src/`

**Stages:**
1. `ingestion` (10%) — Upload PDF, extrair texto nativo + imagens das páginas
2. `extraction` (40%) — LLM com visão analisa páginas, identifica tabelas de itens
3. `structured_output` (80%) — Converte para JSON estruturado (fornecedor, itens[])
4. `done` (100%) — Upsert em ob_propostas + ob_proposta_items

**Prompt de extração:** Focado em identificar tabelas de fornecimento com colunas: descrição/item, quantidade, unidade, preço unitário, preço total. Deve lidar com formatos variados (tabelas formais, texto semi-estruturado, layouts de orçamento).

**Output schema:**
```typescript
interface ProposalOutput {
  fornecedor: string;
  items: {
    descricao: string;
    unidade: string | null;
    quantidade: number | null;
    preco_unitario: number | null;
    preco_total: number | null;
    confidence: number; // 0-1
    needs_review: boolean;
  }[];
}
```

### Job Tracking

Reutilizar `ob_pdf_jobs` com o file_id da proposta. O pipeline de propostas é ativado quando `ob_project_files.disciplina = 'proposta'`. O poller existente detecta o job pendente e despacha para o pipeline correto baseado no tipo do arquivo.

## Fluxo do Usuário

1. Usuário vai na aba **Propostas**
2. Faz upload de um PDF de proposta de fornecedor
3. Pipeline extrai automaticamente os itens
4. Usuário revisa itens na tabela editável, corrige se necessário, marca como "reviewed"
5. Quando quiser adicionar ao orçamento, vai na aba **Planilha**
6. Clica em **"Importar Proposta"** na toolbar
7. Seleciona a proposta desejada no dialog
8. Vê preview dos itens
9. Escolhe destino (nova etapa ou existente)
10. Confirma → itens importados como L1 → L2 → L3 com custos preenchidos

## Considerações

- Propostas podem ter formatos muito variados — o pipeline deve usar visão (imagem das páginas) além de texto para lidar com tabelas em PDF
- Confidence scoring ajuda o usuário a focar na revisão dos itens com menor certeza
- O status `reviewed` serve como gate — só propostas revisadas aparecem no dialog de import (mas extracted também pode aparecer com indicador visual)
