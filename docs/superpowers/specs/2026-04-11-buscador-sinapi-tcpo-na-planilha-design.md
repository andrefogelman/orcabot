# Buscador SINAPI/TCPO na Planilha — Preencher Custos por Linha

**Data:** 2026-04-11
**Status:** Design aprovado
**Projeto:** OrcaBot — frontend + Supabase (v1 sem migration)

## Contexto

Na planilha do OrcaBot (`BudgetTable.tsx`), cada linha representa um item do orçamento (etapa/item/subitem). O usuário cria linhas manualmente ou via importação, mas os campos de custo ficam zerados (`custo_unitario`, `custo_material`, `custo_mao_obra`, `custo_total` = 0) até serem preenchidos.

A infraestrutura das bases de referência **já existe**:
- `ob_sinapi_composicoes` (12.668 itens) — `useSinapiSearch(query, tipo, classe, page, pageSize)`
- `ob_tcpo_composicoes` (1.272 itens) — `useTcpoSearch(query, category)`
- `ob_tcpo_insumos` — detalhamento por composição com `classe: "MOD" | "MAT" | "EQH"`
- `ob_sinapi_composicao_insumos` — **schema criado, 0 linhas** (não populado; tratado em plano separado)

O usuário quer um botão por linha que abre um modal de busca nas duas bases e, ao selecionar uma composição, preenche os custos da linha com referência à fonte original.

### Escopo v1 (esta spec)

TCPO sempre detalhado via `ob_tcpo_insumos` (já populado). SINAPI simplificado: usa `custo_sem_desoneracao` inteiro em `custo_unitario`, deixa `custo_material` e `custo_mao_obra` zerados. Quando a tabela `ob_sinapi_composicao_insumos` for populada por um importer futuro, um plano separado fará o upgrade do branch SINAPI para detalhamento equivalente ao TCPO — a feature atual continua funcionando inalterada.

## Objetivos

1. Botão discreto em cada linha da planilha (todos os níveis 1/2/3)
2. Click abre um modal (shadcn `Dialog`) com tabs `[SINAPI | TCPO]`
3. O campo de busca vem pré-preenchido com a descrição do item e dispara busca automática
4. Resultados com unidade igual à da linha aparecem destacados e no topo da lista (normalização: `m²` ≡ `m2`, `und` ≡ `un`, etc.)
5. Selecionar uma composição preenche a linha: `custo_unitario`, `custo_material`, `custo_mao_obra`, `custo_total = custo_unitario × quantidade`, `fonte`, `fonte_codigo`, `fonte_data_base`
6. A operação é revertível em 1 clique pelo `⟲` existente (entrada `update` com snapshot dos campos alterados)

## Não-Objetivos (YAGNI)

- Importer de insumos SINAPI (plano separado, feature v2)
- Busca semântica / vector search (SINAPI tem infra mas v1 usa ILIKE que já existe)
- Toggle dinâmico entre SINAPI com/sem desoneração ou TCPO com/sem taxas — v1 fixa em `sem_desoneracao` (SINAPI) e `com_taxas` (TCPO). Se quiser flexibilizar depois, vira campo em Premissas do projeto
- Aplicar composição em várias linhas de uma vez
- Memorizar última busca ou pesquisas frequentes
- Busca inline sem modal
- Detalhamento de SINAPI em v1

## Arquitetura

```
┌───────────────────────────────────────────────────────────────┐
│ UI (React)                                                    │
│                                                               │
│  BudgetRow ──[click botão]──> PriceSourceDialog               │
│                                   │                           │
│                                   ├── Tab SINAPI              │
│                                   │    └── useSinapiSearch    │
│                                   │                           │
│                                   └── Tab TCPO                │
│                                        └── useTcpoSearch      │
│                                                               │
│                     [select + Aplicar]                        │
│                             │                                 │
│                             ▼                                 │
│                     useApplyPriceSource                       │
│                     (+ fetch ob_tcpo_insumos se TCPO)        │
│                             │                                 │
│                             ▼                                 │
│                     updateItem (existing hook)                │
│                     + undoStack.push({ type: "update" })      │
└───────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────┐
│ Supabase                                                      │
│   ob_sinapi_composicoes (read)                                │
│   ob_tcpo_composicoes (read)                                  │
│   ob_tcpo_insumos (read — só quando seleciona TCPO)          │
│   ob_orcamento_items (update)                                 │
└───────────────────────────────────────────────────────────────┘
```

Sem mudança no backend (W5) e sem nova migration.

## Componentes

### 1. `frontend/src/lib/unit.ts` (novo)

Utilitário puro de normalização de unidades. Testável.

```ts
/**
 * Normaliza grafia de unidade para comparação.
 * Ex: "m²" → "m2", "M2" → "m2", "und" → "un", "kg " → "kg"
 */
export function normalizeUnit(u: string | null | undefined): string {
  if (!u) return "";
  return u
    .trim()
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/^und$/, "un")
    .replace(/^unid$/, "un");
}

/** Compara duas unidades depois de normalizar. */
export function unitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeUnit(a) === normalizeUnit(b);
}
```

### 2. `frontend/src/lib/price-source.ts` (novo)

Função pura de cálculo do split MOD/MAT+EQH para TCPO. Isolada para ficar testável sem mock do supabase.

```ts
export type TcpoInsumoLite = {
  classe: "MOD" | "MAT" | "EQH";
  total: number | null;
};

export type PriceSplit = {
  custo_unitario: number;
  custo_material: number;
  custo_mao_obra: number;
};

/**
 * Dado o custo_unitario final da composição TCPO (já com taxas)
 * e a lista de insumos, calcula a divisão entre material e mão de obra
 * proporcionalmente à soma dos totais dos insumos.
 *
 * Regras:
 * - MOD → mão de obra
 * - MAT + EQH → material
 * - Se insumos somam 0 (ou vazios), fallback: tudo em material
 */
export function computeTcpoSplit(
  custoUnitario: number,
  insumos: TcpoInsumoLite[]
): PriceSplit {
  const mod = insumos
    .filter((i) => i.classe === "MOD")
    .reduce((s, i) => s + (i.total ?? 0), 0);
  const matEqh = insumos
    .filter((i) => i.classe === "MAT" || i.classe === "EQH")
    .reduce((s, i) => s + (i.total ?? 0), 0);
  const soma = mod + matEqh;

  if (soma <= 0) {
    return {
      custo_unitario: custoUnitario,
      custo_material: custoUnitario,
      custo_mao_obra: 0,
    };
  }

  const fracMod = mod / soma;
  return {
    custo_unitario: custoUnitario,
    custo_mao_obra: custoUnitario * fracMod,
    custo_material: custoUnitario * (1 - fracMod),
  };
}
```

### 3. `frontend/src/components/planilha/PriceSourceDialog.tsx` (novo)

Componente principal da feature.

**Props:**
```ts
interface PriceSourceDialogProps {
  item: OrcamentoItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;  // callback após aplicar (usado pelo undoStack push)
}
```

**Layout (shadcn `Dialog` com `max-w-4xl`):**

```
┌─────────────────────────────────────────────────────────────┐
│ Buscar preço de referência                             [X] │
├─────────────────────────────────────────────────────────────┤
│ Item: 03.01 — Demolição de alvenaria de vedação             │
│ Unidade: m2 · Quantidade: 16,94                             │
│                                                             │
│ 🔍 [Demolição de alvenaria de vedação           ] [×Limpar] │
│                                                             │
│ ┌─────────┬────────┐                                        │
│ │ SINAPI  │ TCPO   │                                        │
│ ├─────────┴────────┴─────────────────────────────────────┐  │
│ │                                                        │  │
│ │  Código  Descrição                Unid   Custo        │  │
│ │ ─────────────────────────────────────────────────     │  │
│ │ ● 97644  Demolição alvenaria...    m2 ✓  R$ 23,87 ◄ selected │
│ │   97645  Demolição alvenaria...    m3    R$ 56,12     │  │
│ │   ...                                                  │  │
│ │                                          [ < 1/5 > ]  │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                             │
│                              [ Cancelar ] [ Aplicar ]       │
└─────────────────────────────────────────────────────────────┘
```

**Comportamento:**
- Ao abrir: `query = item.descricao`, dispara busca imediatamente em ambas as tabs (cada uma tem seu `useQuery` próprio)
- Tab default: **SINAPI** (base maior, default de mercado)
- Lista ordenada client-side: items com `unitsMatch(composicao.unidade, item.unidade)` aparecem primeiro, com badge visual "✓ unidade"
- Paginação SINAPI: 50/página, reusa estado interno do componente
- TCPO: limit 100 do hook existente, sem paginação (suficiente para 1.272 total)
- Seleção: radio/highlight no clique; dupla-click aplica diretamente
- Botão "Aplicar": disabled até ter seleção; click chama `useApplyPriceSource`, fecha dialog no sucesso
- Loading states: skeleton enquanto busca; erro: toast + dialog continua aberto
- ESC fecha (comportamento default do Dialog)

**Estado interno:**
```ts
const [query, setQuery] = useState(item.descricao);
const [tab, setTab] = useState<"sinapi" | "tcpo">("sinapi");
const [sinapiPage, setSinapiPage] = useState(1);
const [selected, setSelected] = useState<PriceSelection | null>(null);
```

### 4. `frontend/src/hooks/useApplyPriceSource.ts` (novo)

Hook que encapsula o fluxo de aplicação (fetch TCPO insumos + update + retorno de snapshot para undo).

```ts
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUpdateOrcamentoItem } from "./useOrcamento";
import { computeTcpoSplit } from "@/lib/price-source";
import type { OrcamentoItem } from "@/types/orcamento";
import type { SinapiComposicao } from "./useSinapi";
import type { TcpoComposicao } from "./useTcpo";

export type PriceSelection =
  | { kind: "sinapi"; composicao: SinapiComposicao }
  | { kind: "tcpo"; composicao: TcpoComposicao };

export type ApplyResult = {
  previousData: {
    custo_unitario: number | null;
    custo_material: number | null;
    custo_mao_obra: number | null;
    custo_total: number | null;
    fonte: string | null;
    fonte_codigo: string | null;
    fonte_data_base: string | null;
  };
};

export function useApplyPriceSource() {
  const updateItem = useUpdateOrcamentoItem();

  return useMutation<ApplyResult, Error, { item: OrcamentoItem; selection: PriceSelection }>({
    mutationFn: async ({ item, selection }) => {
      const qty = item.quantidade ?? 0;

      let custo_unitario: number;
      let custo_material: number;
      let custo_mao_obra: number;
      let fonte: "sinapi" | "tcpo";
      let fonte_codigo: string;
      let fonte_data_base: string;

      if (selection.kind === "sinapi") {
        custo_unitario = selection.composicao.custo_sem_desoneracao ?? 0;
        custo_material = 0;
        custo_mao_obra = 0;
        fonte = "sinapi";
        fonte_codigo = selection.composicao.codigo;
        fonte_data_base = selection.composicao.data_base;
      } else {
        const { data: insumos, error } = await supabase
          .from("ob_tcpo_insumos")
          .select("classe, total")
          .eq("composicao_id", selection.composicao.id);
        if (error) throw error;

        const split = computeTcpoSplit(
          selection.composicao.custo_com_taxas ?? 0,
          (insumos ?? []) as { classe: "MOD" | "MAT" | "EQH"; total: number | null }[]
        );
        custo_unitario = split.custo_unitario;
        custo_material = split.custo_material;
        custo_mao_obra = split.custo_mao_obra;
        fonte = "tcpo";
        fonte_codigo = selection.composicao.codigo;
        fonte_data_base = selection.composicao.data_precos;
      }

      const custo_total = custo_unitario * qty;

      const previousData: ApplyResult["previousData"] = {
        custo_unitario: item.custo_unitario,
        custo_material: item.custo_material,
        custo_mao_obra: item.custo_mao_obra,
        custo_total: item.custo_total,
        fonte: item.fonte,
        fonte_codigo: item.fonte_codigo,
        fonte_data_base: item.fonte_data_base,
      };

      await updateItem.mutateAsync({
        id: item.id,
        projectId: item.project_id,
        custo_unitario,
        custo_material,
        custo_mao_obra,
        custo_total,
        fonte,
        fonte_codigo,
        fonte_data_base,
      });

      return { previousData };
    },
  });
}
```

### 5. Integração em `BudgetRow.tsx`

Adicionar um botão pequeno (ícone `BookOpen` ou `Search` do lucide) visível em cada linha. Posição: à esquerda do ícone de exclusão, numa coluna dedicada ou colado ao trash.

Ao clicar, seta estado local `priceSourceOpen = true` e renderiza o `<PriceSourceDialog>`.

Após sucesso, o dialog fecha e um `undoStack.push({ type: "update", table: "ob_orcamento_items", itemId: item.id, projectId, previousData })` é empurrado usando os dados retornados por `useApplyPriceSource`.

Nota: `BudgetRow` hoje já tem acesso ao `undoStack` via prop ou contexto. Se não tiver, passamos via prop.

### 6. Comportamento de undo

Reuso total do tipo `"update"` existente em `useUndoStack.ts`. Nenhuma mudança no hook.

```ts
{
  type: "update",
  table: "ob_orcamento_items",
  itemId: item.id,
  projectId: item.project_id,
  previousData: { /* 7 campos */ },
}
```

Ao fazer `⟲`, o handler existente reaplica o `previousData` via `supabase.from(table).update(previousData).eq("id", itemId)`. Funciona out-of-the-box.

## Fluxo de Dados

### Fluxo normal (feliz)

```
1. User clica botão 🔍 na linha "03.01 — Demolição de alvenaria de vedação"
2. BudgetRow abre <PriceSourceDialog item={...} open={true} />
3. Dialog inicializa: query = "Demolição de alvenaria de vedação", tab = "sinapi"
4. useSinapiSearch dispara: retorna items paginados
5. Dialog ordena client-side: unidade m2 primeiro
6. User clica num resultado → selected = { kind: "sinapi", composicao: {...} }
7. User clica "Aplicar"
8. useApplyPriceSource.mutate():
   - branch sinapi: custo_unitario = custo_sem_desoneracao, material/mao_obra = 0
   - updateItem.mutateAsync(...)
   - retorna { previousData }
9. Dialog fecha (onOpenChange(false))
10. BudgetRow push no undoStack com previousData
11. Toast "Preço aplicado" (sonner)
12. Planilha invalidada e re-renderiza com novos valores
```

### Fluxo TCPO (com split de insumos)

```
6. User seleciona composição TCPO
7. User clica "Aplicar"
8. useApplyPriceSource.mutate():
   - fetch ob_tcpo_insumos WHERE composicao_id = selection.composicao.id
   - computeTcpoSplit(custo_com_taxas, insumos) → { custo_unitario, custo_material, custo_mao_obra }
   - updateItem.mutateAsync(...)
```

### Undo

```
1. User tecla Ctrl+Z (ou clica ⟲)
2. useUndoStack.undo() pop entry tipo "update"
3. supabase.from("ob_orcamento_items").update(previousData).eq("id", itemId)
4. Query invalidada, planilha re-renderiza com custos anteriores
5. Toast "Ação desfeita"
```

## Tratamento de Erros

| Situação | Comportamento |
|---|---|
| `useSinapiSearch` falha | Tab mostra estado de erro com botão "Tentar novamente" |
| `useTcpoSearch` falha | Idem |
| `fetch ob_tcpo_insumos` falha (durante Apply) | Mutation rejeita, toast erro, dialog permanece aberto |
| `updateItem` falha | Mutation rejeita, toast erro, dialog permanece aberto, previousData não é retornado |
| Item com `quantidade = null` | `custo_total = custo_unitario × 0 = 0`. Usuário pode editar quantidade e re-aplicar, ou editar custo_total manualmente depois |
| Composição TCPO sem insumos registrados | `computeTcpoSplit` fallback: tudo em `custo_material`, `custo_mao_obra = 0` |
| Composição com `custo_sem_desoneracao/custo_com_taxas = null` | Usa `?? 0` — aplica zeros. Usuário vê linha zerada e pode tentar outra composição |

## Testes

### Unit tests (`bun test`)

**`frontend/src/lib/unit.test.ts`:**
- `normalizeUnit`: null/undefined → ""
- `normalizeUnit`: "m²" → "m2"
- `normalizeUnit`: "M²" → "m2"
- `normalizeUnit`: "m2" → "m2" (idempotente)
- `normalizeUnit`: " kg " → "kg" (trim)
- `normalizeUnit`: "und" → "un"
- `normalizeUnit`: "UNID" → "un"
- `unitsMatch`: pares iguais/diferentes/com grafias variadas

**`frontend/src/lib/price-source.test.ts`:**
- `computeTcpoSplit`: insumos vazios → tudo em material
- `computeTcpoSplit`: só MOD → tudo em mão de obra
- `computeTcpoSplit`: só MAT → tudo em material
- `computeTcpoSplit`: só EQH → tudo em material
- `computeTcpoSplit`: 50/50 MOD/MAT → 50/50 split do custo_unitario
- `computeTcpoSplit`: 30/70 MOD/(MAT+EQH) → 30/70 split
- `computeTcpoSplit`: soma dos insumos ≠ custo_unitario (taxas/BDI) → split respeita proporção, soma = custo_unitario
- `computeTcpoSplit`: totais null tratados como 0

### Manuais (após deploy)

- [ ] Botão aparece em cada linha
- [ ] Click abre modal com descrição pré-preenchida
- [ ] Tab SINAPI lista resultados e destaca unidade m2 no topo
- [ ] Tab TCPO idem
- [ ] Selecionar SINAPI e aplicar preenche `custo_unitario` e `custo_total`, deixa material/mão de obra zero
- [ ] Selecionar TCPO e aplicar preenche os 4 custos com split correto
- [ ] Ctrl+Z desfaz a aplicação e volta os campos ao estado anterior
- [ ] Aplicar segunda vez substitui valores sem problema
- [ ] Fonte e fonte_codigo são gravados corretamente (checar via DB ou UI de detalhe)
- [ ] ESC fecha o modal sem aplicar

## Arquivos Impactados

**Novos:**
- `frontend/src/lib/unit.ts`
- `frontend/src/lib/unit.test.ts`
- `frontend/src/lib/price-source.ts`
- `frontend/src/lib/price-source.test.ts`
- `frontend/src/hooks/useApplyPriceSource.ts`
- `frontend/src/components/planilha/PriceSourceDialog.tsx`

**Modificados:**
- `frontend/src/components/planilha/BudgetRow.tsx` — novo botão + handler que abre o dialog + push no undoStack no sucesso

**Possivelmente modificados (dependendo da interface atual do BudgetRow):**
- `frontend/src/components/planilha/BudgetTable.tsx` — se `undoStack` não está disponível no `BudgetRow`, passar via prop

Sem migration, sem backend.

## Deploy

1. Frontend: `cd frontend && npx vercel --prod --yes` (projeto Vercel correto: ver `.vercel/project.json` — se estiver linkado em "frontend" ao invés de "orcabot", o `git push` dispara deploy automático via git integration no projeto "orcabot" que serve `anfconstrucoes.com.br`)
2. Sem migrations.
3. Sem backend W5.

## Riscos & Mitigações

| Risco | Mitigação |
|---|---|
| `useSinapiSearch` retorna muitos resultados com ILIKE (ruim) | v1 usa ILIKE. Se ficar ruim na prática, v2 troca por vector search (migration já criou infra) |
| Busca pré-preenchida com descrição muito genérica → ruído | User pode limpar e refinar. Limit/paginação limitam dano |
| Composição TCPO sem insumos cadastrados → tudo em material | Fallback intencional; user pode editar manualmente depois |
| `custo_com_taxas` ou `custo_sem_desoneracao` null na composição selecionada | Fallback `?? 0` — user vê zero e escolhe outra |
| Undo de aplicação dupla: user aplica SINAPI, depois aplica TCPO na mesma linha, depois Ctrl+Z | Cada apply faz 1 push no undoStack → 2 ctrl+z voltam ao estado original zerado |
| User clicar "Aplicar" 2x rapidamente | Button disabled durante `updateItem.isPending` |
| Comparação de unidade falha por acentos/abreviações exóticas | `normalizeUnit` cobre os casos comuns; desconhecidos caem no grupo "outros" (não destacados). Não é quebra, só ausência de destaque |

## Plano v2 (documentado, não agora)

Quando o importer de insumos SINAPI rodar e `ob_sinapi_composicao_insumos` tiver dados:

1. Nova query `ob_sinapi_composicao_insumos JOIN ob_sinapi_composicoes` retorna insumos filhos com `classe` e `custo_sem_desoneracao × coeficiente = total`
2. Adicionar função `computeSinapiSplit` em `lib/price-source.ts` (mesma forma de `computeTcpoSplit`)
3. Atualizar branch SINAPI em `useApplyPriceSource` para usar o split
4. Tests correspondentes

Nenhuma mudança no modal ou fluxo de undo — só o cálculo interno.
