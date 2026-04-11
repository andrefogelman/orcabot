# Inserir e Excluir Etapa/Item/Subitem com Renumeração Automática

**Data:** 2026-04-10
**Status:** Design aprovado
**Projeto:** OrcaBot — frontend + Supabase

## Contexto

Na tela **Planilha** do OrcaBot, o toolbar expõe três botões de criação (`+ Etapa`, `+ Item`, `+ Subitem`) que hoje sempre inserem no final da lista/subárvore correspondente. O usuário pediu que a inserção pergunte **onde** inserir, permitindo por exemplo criar uma nova etapa entre a etapa 2 e a etapa 3, com renumeração automática das etapas subsequentes (`03 → 04`, `04 → 05`, …).

O mesmo critério deve valer para **exclusão**: ao remover uma etapa/item/subitem, as subsequentes são renumeradas para eliminar o gap (`delete 02` → `03 → 02`, `04 → 03`).

### Bug latente descoberto

Durante a análise descobrimos que a função existente `insertRelative` em `frontend/src/components/planilha/BudgetTable.tsx:342` (usada pelo menu de contexto "Inserir acima/abaixo") **tem um bug**: ela renumera apenas os irmãos no mesmo nível, mas não cascateia a renumeração aos descendentes.

A tabela `ob_orcamento_items` (`supabase/migrations/20260331000004_quantitativos_orcamento.sql:27`) não tem `parent_id` — toda a hierarquia é derivada do `eap_code` por prefix matching (`02.01` é filho de `02`). Consequência: quando `02` vira `03` via `insertRelative`, os filhos `02.01`, `02.02` ficam com prefixo desalinhado e **viram órfãos**.

O fix desse bug é pré-requisito para a feature pedida e será entregue como parte deste design.

## Objetivos

1. Ao clicar em `+ Etapa`, `+ Item` ou `+ Subitem`, exibir um popover perguntando **onde inserir** o novo item.
2. Após inserção, renumerar automaticamente todos os irmãos posteriores e seus descendentes.
3. Ao excluir qualquer item, renumerar automaticamente todos os irmãos posteriores e seus descendentes para eliminar o gap.
4. Corrigir o bug latente do `insertRelative` cascateando a renumeração aos descendentes.
5. Preservar a funcionalidade de undo (`⟲`) — uma operação de inserção/exclusão com renumeração deve ser revertida em **um único clique**.
6. Operações devem ser **atômicas no banco** — se o browser fechar no meio, o estado fica consistente.

## Não-Objetivos (YAGNI)

- Drag-and-drop para reordenar etapas/items/subitems (escopo futuro).
- Confirmação extra antes da renumeração (a operação é reversível pelo undo).
- Animação de highlight nas linhas renumeradas.
- Permitir ao usuário editar manualmente o `eap_code` e disparar renumeração inteligente.

## Arquitetura

A feature atravessa três camadas:

```
┌─────────────────────────────────────────────────────┐
│ UI (React)                                          │
│  ┌──────────────────┐   ┌────────────────────────┐  │
│  │ BudgetToolbar    │──▶│ InsertPositionPopover  │  │
│  └──────────────────┘   └────────────────────────┘  │
│           │                       │                 │
│           ▼                       ▼                 │
│  ┌─────────────────────────────────────────────┐   │
│  │ BudgetTable (handleInsertAt / Delete)       │   │
│  └─────────────────────────────────────────────┘   │
│           │                                         │
│           ▼                                         │
│  ┌─────────────────────────────────────────────┐   │
│  │ lib/eap.ts (lógica pura, testável)          │   │
│  └─────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Supabase (Postgres)                                 │
│  ┌─────────────────────────────────────────────┐   │
│  │ RPC renumber_eap_items(project_id, patches) │   │
│  │ RPC revert_renumber(project_id, snapshot)   │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Componentes

### 1. `frontend/src/lib/eap.ts` (novo)

Lógica pura sobre arrays de items, 100% testável.

```ts
import type { OrcamentoItem } from '@/types/orcamento';

export type InsertOperation = {
  kind: 'insert';
  level: 1 | 2 | 3;
  parentPrefix: string;  // '' para level 1, '01' para level 2, '01.02' para level 3
  atPosition: number;    // 1-based; se já existe item com esse número, ele é empurrado
};

export type DeleteOperation = {
  kind: 'delete';
  deletedCode: string;   // eap_code completo do item deletado
  level: 1 | 2 | 3;
};

export type EapPatch = { id: string; eap_code: string };

/**
 * Retorna o patch completo de renumeração para aplicar a operação,
 * incluindo atualização de prefixo em todos os descendentes.
 *
 * Para insert:
 *  - shift +1 em irmãos com last-segment >= atPosition
 *  - reescrita de prefixo em todos os descendentes dos irmãos afetados
 *
 * Para delete:
 *  - shift -1 em irmãos com last-segment > deletedLastSegment
 *  - reescrita de prefixo em todos os descendentes dos irmãos afetados
 *  - NÃO inclui o item deletado nem seus descendentes (são removidos
 *    pelo caller via bulkDelete)
 */
export function computeRenumberPatch(
  items: OrcamentoItem[],
  operation: InsertOperation | DeleteOperation
): EapPatch[];

/**
 * Gera a lista de opções para o popover "Onde inserir?".
 *
 * Level 1: lista plana das etapas + "No início" + "No final"
 * Level 2: árvore achatada agrupada por etapa
 * Level 3: árvore achatada agrupada por etapa > item
 */
export type InsertPositionOption = {
  id: string;                  // key único p/ react
  label: string;               // "Depois de 02 — Despesas Gerais"
  group?: string;              // para níveis 2/3: "01 — Instalação"
  subgroup?: string;           // só nível 3: "01.02 — Subitem X"
  parentPrefix: string;
  atPosition: number;
  highlighted?: boolean;       // default de destaque (normalmente "No final")
};

export function buildInsertPositionOptions(
  items: OrcamentoItem[],
  level: 1 | 2 | 3
): InsertPositionOption[];

/**
 * Snapshot dos eap_codes atuais dos items que serão afetados por um patch.
 * Usado para undo: reverter um patch = aplicar o snapshot.
 */
export function snapshotAffected(
  items: OrcamentoItem[],
  patch: EapPatch[]
): EapPatch[];
```

**Regras de padding** (já convencionadas no código atual):
- Level 1: 2 dígitos (`01`, `02`, …)
- Level 2: 2 dígitos (`01.01`, `01.02`, …)
- Level 3: 3 dígitos (`01.01.001`, `01.01.002`, …)

### 2. `frontend/src/components/planilha/InsertPositionPopover.tsx` (novo)

```tsx
type Props = {
  level: 1 | 2 | 3;
  items: OrcamentoItem[];
  onSelect: (parentPrefix: string, atPosition: number) => void;
  children: React.ReactNode;  // trigger (o botão do toolbar)
  disabled?: boolean;
};
```

Usa `Popover` + `Command` do shadcn (já instalados no projeto).

**Comportamento:**
- Se `items` estiver vazio (ou sem irmãos candidatos), o popover não abre — dispara `onSelect('', 1)` direto (equivalente a "adicionar primeiro").
- Layout da lista:
  - **Level 1:** plano. Itens: "No início", "Depois de 01 — …", …, "No final".
  - **Level 2:** agrupado por etapa. Dentro de cada etapa: "No início da etapa", "Depois de 01.01 — …", …, "No final da etapa".
  - **Level 3:** agrupado por etapa › item (dois níveis de grupo).
- Default highlight: "No final" (level 1) ou "No final da última etapa/item" (níveis 2/3).
- Click em opção → fecha popover → chama `onSelect`.
- ESC / click fora → fecha sem chamar.
- Com muitas opções, `Command` provê scroll interno + busca fuzzy por default.

### 3. `frontend/src/components/planilha/BudgetToolbar.tsx` (modificado)

Os três botões `+ Etapa`, `+ Item`, `+ Subitem` deixam de chamar `onAddItem(level)` diretamente. Passam a ser wrapped pelo `InsertPositionPopover` que, ao escolher uma posição, chama:

```ts
onInsertAt(level: 1 | 2 | 3, parentPrefix: string, atPosition: number)
```

Novo prop substitui `onAddItem`. O pai (`BudgetTable`) passa o handler correspondente.

### 4. `frontend/src/components/planilha/BudgetTable.tsx` (modificado)

**Removido:** `handleAddItem(level)` — substituído.

**Novo:** `handleInsertAt(level, parentPrefix, atPosition)`

```ts
const handleInsertAt = useCallback(
  async (level, parentPrefix, atPosition) => {
    if (!items) return;

    // 1. Calcular patch + snapshot
    const patch = computeRenumberPatch(items, {
      kind: 'insert', level, parentPrefix, atPosition,
    });
    const snapshot = snapshotAffected(items, patch);

    // 2. Aplicar renumeração atomicamente (se houver)
    if (patch.length > 0) {
      await supabase.rpc('renumber_eap_items', {
        p_project_id: projectId,
        p_patches: patch,
      });
    }

    // 3. Criar o novo item com o eap_code que ficou livre
    const newCode = formatEapCode(parentPrefix, atPosition, level);
    const created = await createItem.mutateAsync({
      project_id: projectId,
      eap_code: newCode,
      eap_level: level,
      descricao: level === 1 ? 'NOVA ETAPA' : 'Novo item',
      // ... demais defaults como hoje
    });

    // 4. Push entrada composta no undoStack
    undoStack.push({
      type: 'insert-with-renumber',
      projectId,
      createdItemId: created.id,
      snapshot,
    });
  },
  [items, projectId, createItem, undoStack],
);
```

**Modificado:** `handleDeleteRequest`

```ts
const handleDeleteRequest = useCallback(
  async (item) => {
    if (!items) return;

    // 1. Determinar itens a remover (self + descendentes para level 1)
    const toDelete = item.eap_level === 1
      ? items.filter(i => i.id === item.id || i.eap_code.startsWith(item.eap_code + '.'))
      : [item];

    // 2. Calcular patch de renumeração dos IRMÃOS posteriores
    const patch = computeRenumberPatch(items, {
      kind: 'delete',
      deletedCode: item.eap_code,
      level: item.eap_level,
    });
    const snapshot = snapshotAffected(items, patch);

    // 3. Bulk delete (já existe)
    await bulkDelete.mutateAsync({ ids: toDelete.map(i => i.id), projectId });

    // 4. Renumerar
    if (patch.length > 0) {
      await supabase.rpc('renumber_eap_items', {
        p_project_id: projectId,
        p_patches: patch,
      });
    }

    // 5. Push entrada composta no undoStack
    undoStack.push({
      type: 'delete-with-renumber',
      projectId,
      deletedItems: toDelete,
      snapshot,
    });

    toast.success(`${toDelete.length} item(ns) excluído(s)`);
  },
  [items, projectId, bulkDelete, undoStack],
);
```

**Modificado:** `insertRelative` (menu de contexto) — migrado para usar a mesma infraestrutura (`computeRenumberPatch` + RPC), eliminando o bug latente de descendentes órfãos. A assinatura pública (`target: OrcamentoItem, position: 'above' | 'below'`) é preservada; internamente calcula `level`, `parentPrefix` e `atPosition` a partir do target e delega para `handleInsertAt`.

### 5. `frontend/src/hooks/useUndoStack.ts` (modificado)

Novos tipos de entrada no discriminated union:

```ts
type UndoEntry =
  | { type: 'update'; ... }                  // existente
  | { type: 'create'; ... }                  // existente
  | { type: 'delete'; ... }                  // existente
  | {
      type: 'insert-with-renumber';
      projectId: string;
      createdItemId: string;
      snapshot: EapPatch[];
    }
  | {
      type: 'delete-with-renumber';
      projectId: string;
      deletedItems: OrcamentoItem[];
      snapshot: EapPatch[];
    };
```

**Revert `insert-with-renumber`:**
1. `deleteItem(createdItemId)`
2. `supabase.rpc('revert_renumber', { p_project_id, p_snapshot })`

**Revert `delete-with-renumber`:**
1. `supabase.rpc('revert_renumber', { p_project_id, p_snapshot })`
2. Bulk insert dos `deletedItems` preservando os IDs originais (para que outras referências continuem válidas)

### 6. `supabase/migrations/20260410000001_renumber_eap_rpc.sql` (novo)

```sql
-- ─── Unique constraint em (project_id, eap_code) ───────────────────
-- Pré-requisito: garantir que não é possível ter dois items com mesmo
-- eap_code no mesmo projeto. Se a constraint já existir, o bloco DO é no-op.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ob_orcamento_items_project_eap_unique'
  ) THEN
    ALTER TABLE ob_orcamento_items
      ADD CONSTRAINT ob_orcamento_items_project_eap_unique
      UNIQUE (project_id, eap_code);
  END IF;
END $$;

-- ─── RPC: aplica um lote de mudanças de eap_code atomicamente ──────
CREATE OR REPLACE FUNCTION renumber_eap_items(
  p_project_id uuid,
  p_patches jsonb  -- [{"id": "...", "eap_code": "..."}, ...]
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER  -- RLS aplica: usuário precisa ter acesso ao project
AS $$
DECLARE
  patch jsonb;
BEGIN
  -- Validação: todos os IDs devem pertencer ao projeto
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_patches) p
    WHERE NOT EXISTS (
      SELECT 1 FROM ob_orcamento_items i
      WHERE i.id = (p->>'id')::uuid
        AND i.project_id = p_project_id
    )
  ) THEN
    RAISE EXCEPTION 'renumber_eap_items: item(s) não pertencem ao projeto %', p_project_id;
  END IF;

  -- 2-step para evitar colisão da unique constraint (project_id, eap_code):
  -- passo 1: mover afetados para prefixo temporário
  FOR patch IN SELECT * FROM jsonb_array_elements(p_patches) LOOP
    UPDATE ob_orcamento_items
       SET eap_code = '__tmp__' || (patch->>'id')
     WHERE id = (patch->>'id')::uuid
       AND project_id = p_project_id;
  END LOOP;

  -- passo 2: aplicar os códigos finais
  FOR patch IN SELECT * FROM jsonb_array_elements(p_patches) LOOP
    UPDATE ob_orcamento_items
       SET eap_code = patch->>'eap_code',
           updated_at = now()
     WHERE id = (patch->>'id')::uuid
       AND project_id = p_project_id;
  END LOOP;
END;
$$;

-- ─── RPC: reverte um snapshot (usado pelo undo) ────────────────────
CREATE OR REPLACE FUNCTION revert_renumber(
  p_project_id uuid,
  p_snapshot jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  PERFORM renumber_eap_items(p_project_id, p_snapshot);
END;
$$;

-- ─── Grants ────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION renumber_eap_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION revert_renumber(uuid, jsonb) TO authenticated;
```

**Notas sobre a migration:**
- `SECURITY INVOKER` garante que o RLS da tabela aplica (usuário precisa ter acesso ao projeto).
- O 2-step (`__tmp__` intermediário) é necessário porque a renumeração pode tentar atribuir `eap_code = '03'` a um item enquanto outro ainda tem `'03'`, violando a unique constraint.
- A constraint unique é adicionada aqui mesmo se não existia antes — é um invariante que já deveria existir e cuja ausência é outro bug latente.

## Fluxo de Dados

### Insert (exemplo: inserir nova etapa entre 02 e 03)

```
User clicks "+ Etapa"
  → BudgetToolbar abre InsertPositionPopover(level=1, items)
  → User clicks "Depois de 02 — Despesas Gerais"
    → popover chama onInsertAt(level=1, parentPrefix='', atPosition=3)
      → BudgetTable.handleInsertAt:
        1. computeRenumberPatch → patch = [
             {id: 03.id, eap_code: '04'},
             {id: 03.01.id, eap_code: '04.01'},  ← descendente
             {id: 04.id, eap_code: '05'},
             {id: 04.01.id, eap_code: '05.01'},  ← descendente
             ...
           ]
        2. snapshot = [{id: 03.id, eap_code: '03'}, {id: 03.01.id, eap_code: '03.01'}, ...]
        3. RPC renumber_eap_items(projectId, patch)
        4. createItem({eap_code: '03', eap_level: 1, descricao: 'NOVA ETAPA', ...})
        5. undoStack.push({type: 'insert-with-renumber', createdItemId, snapshot})
```

### Delete (exemplo: excluir etapa 02)

```
User clicks 🗑 em 02 → BudgetRow mostra Sim/Não inline → Sim
  → BudgetTable.handleDeleteRequest(item=02):
    1. toDelete = [02, 02.01, 02.02, ...]  (self + descendentes)
    2. computeRenumberPatch({kind: 'delete', deletedCode: '02', level: 1}) → patch = [
         {id: 03.id, eap_code: '02'},
         {id: 03.01.id, eap_code: '02.01'},
         {id: 04.id, eap_code: '03'},
         ...
       ]
    3. snapshot = [{id: 03.id, eap_code: '03'}, ...]
    4. bulkDelete(toDelete.ids)
    5. RPC renumber_eap_items(projectId, patch)
    6. undoStack.push({type: 'delete-with-renumber', deletedItems: toDelete, snapshot})
```

### Undo insert-with-renumber

```
User clicks ⟲
  → undoStack.pop() → entry
  → if entry.type === 'insert-with-renumber':
      1. deleteItem(entry.createdItemId)
      2. RPC revert_renumber(projectId, entry.snapshot)  ← reaplica os códigos antigos
```

### Undo delete-with-renumber

```
User clicks ⟲
  → undoStack.pop() → entry
  → if entry.type === 'delete-with-renumber':
      1. RPC revert_renumber(projectId, entry.snapshot)  ← devolve os códigos antigos aos sobreviventes
      2. bulk insert entry.deletedItems preservando IDs originais
```

## Tratamento de Erros

- **RPC renumber_eap_items falha** (ex: constraint violation, rede): frontend mostra toast de erro, não faz o create/delete. Estado do banco fica consistente porque a RPC é atômica por transação Postgres.
- **create falha após renumeração bem-sucedida:** frontend chama imediatamente `revert_renumber(snapshot)` para desfazer a renumeração, depois mostra erro ao usuário.
- **bulkDelete falha:** nem tenta renumerar.
- **Race conditions:** dois usuários inserindo etapa ao mesmo tempo podem colidir na unique constraint. O segundo recebe erro e retry implícito não é feito — usuário recebe mensagem "Outra alteração ocorreu, recarregue a planilha". Isso é um edge case raro dado o uso (um orçamentista por projeto).

## Testes

### Unitários — `frontend/src/lib/eap.test.ts` (novo)

Usando `bun test`:

**`computeRenumberPatch` - insert:**
- Insert em planilha vazia (patch vazio)
- Insert no início (atPosition=1) level 1 — todos os existentes shift +1
- Insert no meio level 1 — só os ≥ atPosition shift
- Insert no final level 1 — patch vazio
- Insert level 2 — respeita parentPrefix, só renumera irmãos dentro daquela etapa
- Insert level 3 — idem com prefixo duplo
- Insert com descendentes — cascata correta (ex: 03→04 leva 03.01→04.01, 03.01.001→04.01.001)
- Padding correto (level 3 usa 3 dígitos)

**`computeRenumberPatch` - delete:**
- Delete único item sem descendentes
- Delete item com descendentes (patch não inclui os descendentes, só irmãos posteriores)
- Delete primeiro item — todos shift -1
- Delete último item — patch vazio
- Delete no meio — só os > shift
- Delete level 2/3 respeita parentPrefix
- Cascata em descendentes dos irmãos posteriores

**`buildInsertPositionOptions`:**
- Level 1: lista plana correta, "No início" + "Depois de X" + "No final"
- Level 2: agrupado por etapa, labels corretas
- Level 3: agrupado por etapa › item
- Vazio: retorna `[]` (popover não deve abrir)
- Ordenação por eap_code
- Default highlight no "No final"

**`snapshotAffected`:**
- Retorna apenas items mencionados no patch, com seus `eap_code` atuais

### Manuais (após deploy)

- [ ] Inserir etapa entre 02 e 03 — verificar renumeração visual correta
- [ ] Inserir item dentro de uma etapa, no meio
- [ ] Inserir subitem no meio
- [ ] Excluir etapa do meio — verificar renumeração
- [ ] Excluir última etapa — sem renumeração
- [ ] Undo após insert com renumeração — tudo volta ao estado original
- [ ] Undo após delete com renumeração — items ressurgem no lugar correto
- [ ] Menu de contexto "Inserir acima/abaixo" continua funcionando (e agora sem bug de órfãos)
- [ ] Popover fecha com ESC e click fora
- [ ] Popover não abre quando planilha vazia

## Arquivos Impactados

**Novos:**
- `frontend/src/lib/eap.ts`
- `frontend/src/lib/eap.test.ts`
- `frontend/src/components/planilha/InsertPositionPopover.tsx`
- `supabase/migrations/20260410000001_renumber_eap_rpc.sql`

**Modificados:**
- `frontend/src/components/planilha/BudgetToolbar.tsx` — wrap buttons com popover
- `frontend/src/components/planilha/BudgetTable.tsx` — substituir `handleAddItem`, migrar `handleDeleteRequest` e `insertRelative` para usar a nova infraestrutura
- `frontend/src/hooks/useUndoStack.ts` (ou arquivo equivalente) — novos tipos de entrada e seus reverts

## Deploy

1. Migration: `bash scripts/deploy.sh migrations` (ou equivalente Supabase CLI)
2. Frontend: `cd frontend && npx vercel --prod --yes`
3. Backend: não há mudança no backend W5 nesta feature (tudo é RPC direto do frontend).

## Riscos & Mitigações

| Risco | Mitigação |
|---|---|
| Unique constraint `(project_id, eap_code)` não existe → renumeração pode criar duplicatas silenciosas | Migration adiciona a constraint (pré-check com `DO $$`) |
| Dados legados já têm duplicatas → migration falha ao adicionar constraint | Antes do deploy, rodar query diagnóstica `SELECT project_id, eap_code, COUNT(*) FROM ob_orcamento_items GROUP BY 1,2 HAVING COUNT(*) > 1`; se houver, limpar manualmente |
| Race condition: dois usuários simultâneos | Aceita: segundo recebe erro e recarrega. Uso real é single-user por projeto. |
| Planilha gigante (500+ items) → patch grande → RPC lenta | RPC é um único request transacional; 500 updates em Postgres são < 100ms na prática |
| Undo stack incha com snapshots grandes | Snapshots só guardam `{id, eap_code}`, ~50 bytes por entrada; stack limitado a N entradas como hoje |
