# Inserir/Excluir Etapa com Renumeração — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o usuário escolha onde inserir uma nova Etapa/Item/Subitem na planilha do OrcaBot via popover, e que a exclusão renumere automaticamente as linhas subsequentes, incluindo todos os descendentes.

**Architecture:** Lógica pura de renumeração em `frontend/src/lib/eap.ts` (testável com `bun test`), aplicada atomicamente via novas RPCs Postgres `renumber_eap_items` e `revert_renumber`. UI via novo componente `InsertPositionPopover` ancorado nos botões do toolbar. Undo suporta entradas compostas com snapshot dos `eap_code` anteriores.

**Tech Stack:** React + TypeScript + Vite (frontend), Supabase Postgres (backend), shadcn/ui (Popover + Command), `@tanstack/react-query`, `bun test` para testes unitários.

**Design doc:** `docs/superpowers/specs/2026-04-10-planilha-inserir-excluir-com-renumeracao-design.md`

---

## Pré-requisitos e convenções

- Todo trabalho feito a partir de `/Users/andrefogelman/orcabot`
- Rodar comandos `cd frontend && ...` quando o contexto for frontend
- Migrations usam o formato `YYYYMMDDNNNNNN_descricao.sql` — a próxima é `20260410000001_renumber_eap_rpc.sql`
- Estado atual relevante:
  - `frontend/src/hooks/useUndoStack.ts` — atual com 3 tipos (`update|create|delete`), 89 linhas
  - `frontend/src/components/planilha/BudgetTable.tsx` — 742 linhas, tem `handleAddItem` (linha 207), `handleDeleteRequest` (linha 281), `insertRelative` (linha 342)
  - `frontend/src/components/planilha/BudgetToolbar.tsx` — 130 linhas, 3 botões em linha 40/44/48 chamando `onAddItem(level)`
  - `frontend/src/hooks/useOrcamento.ts` — expõe `useCreateOrcamentoItem`, `useUpdateOrcamentoItem`, `useDeleteOrcamentoItem`, `useBulkDeleteOrcamentoItems`, `useBulkCreateOrcamentoItems`
  - Cliente Supabase em `@/lib/supabase`
  - Tipo `OrcamentoItem` em `@/types/orcamento`
- Shadcn Popover e Command ainda **não existem** em `components/ui/` mas as deps `@radix-ui/react-popover` e `cmdk` já estão no `package.json`
- Não há setup de teste no frontend hoje — vamos usar `bun test` direto (bun executa `.test.ts` sem configuração adicional)

---

## Task 1: Migration Postgres — unique constraint + RPCs

**Files:**
- Create: `supabase/migrations/20260410000001_renumber_eap_rpc.sql`

**Goal:** Adicionar a unique constraint `(project_id, eap_code)` e criar as RPCs `renumber_eap_items` e `revert_renumber`.

- [ ] **Step 1: Query diagnóstica — checar se há duplicatas legadas**

Antes de escrever a migration, rodar no Supabase SQL Editor (ou via `supabase db remote query`) para confirmar que não há dados que quebrariam a constraint:

```sql
SELECT project_id, eap_code, COUNT(*)
FROM ob_orcamento_items
GROUP BY project_id, eap_code
HAVING COUNT(*) > 1;
```

Expected: 0 linhas. Se houver, reportar ao usuário antes de prosseguir (pode ser necessário limpeza manual).

- [ ] **Step 2: Escrever a migration**

Criar `supabase/migrations/20260410000001_renumber_eap_rpc.sql`:

```sql
-- Unique constraint em (project_id, eap_code) ---------------------------------
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

-- RPC: aplica um lote de mudanças de eap_code atomicamente --------------------
CREATE OR REPLACE FUNCTION renumber_eap_items(
  p_project_id uuid,
  p_patches jsonb  -- [{"id": "...", "eap_code": "..."}, ...]
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
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
    RAISE EXCEPTION 'renumber_eap_items: item(s) nao pertencem ao projeto %', p_project_id;
  END IF;

  -- 2-step para evitar colisao da unique constraint (project_id, eap_code):
  -- passo 1: mover afetados para prefixo temporario
  FOR patch IN SELECT * FROM jsonb_array_elements(p_patches) LOOP
    UPDATE ob_orcamento_items
       SET eap_code = '__tmp__' || (patch->>'id')
     WHERE id = (patch->>'id')::uuid
       AND project_id = p_project_id;
  END LOOP;

  -- passo 2: aplicar os codigos finais
  FOR patch IN SELECT * FROM jsonb_array_elements(p_patches) LOOP
    UPDATE ob_orcamento_items
       SET eap_code = patch->>'eap_code',
           updated_at = now()
     WHERE id = (patch->>'id')::uuid
       AND project_id = p_project_id;
  END LOOP;
END;
$$;

-- RPC: reverte um snapshot (usado pelo undo) ----------------------------------
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

-- Grants ----------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION renumber_eap_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION revert_renumber(uuid, jsonb) TO authenticated;
```

- [ ] **Step 3: Aplicar a migration no Supabase**

```bash
cd /Users/andrefogelman/orcabot
supabase db push
```

Expected: output lista a migration `20260410000001_renumber_eap_rpc.sql` como aplicada, sem erros.

- [ ] **Step 4: Smoke test da RPC**

No SQL Editor do Supabase, rodar:

```sql
-- Deve falhar com erro sobre patches vazios ou retornar sem erro
SELECT renumber_eap_items(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '[]'::jsonb
);
```

Expected: retorna `void` sem erro (patch vazio é no-op).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrefogelman/orcabot
git add supabase/migrations/20260410000001_renumber_eap_rpc.sql
git commit -m "feat(db): add renumber_eap_items RPC + unique constraint

Enables atomic batch renumbering of eap_code values with temporary
prefix trick to avoid unique constraint collisions during swap.
Adds complementary revert_renumber for undo operations.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Lib `eap.ts` — tipos + `computeRenumberPatch` para insert

**Files:**
- Create: `frontend/src/lib/eap.ts`
- Create: `frontend/src/lib/eap.test.ts`

**Goal:** Função pura que recebe a lista de items + operação de insert e retorna o patch completo de renumeração (irmãos posteriores + descendentes).

- [ ] **Step 1: Criar o arquivo com tipos públicos**

`frontend/src/lib/eap.ts`:

```ts
import type { OrcamentoItem } from "@/types/orcamento";

export type EapLevel = 1 | 2 | 3;

export type InsertOperation = {
  kind: "insert";
  level: EapLevel;
  /** Prefixo do pai — '' para level 1, '01' para level 2, '01.02' para level 3 */
  parentPrefix: string;
  /** 1-based: se já existe item com esse last-segment, ele é empurrado */
  atPosition: number;
};

export type DeleteOperation = {
  kind: "delete";
  /** eap_code completo do item deletado */
  deletedCode: string;
  level: EapLevel;
};

export type EapPatch = { id: string; eap_code: string };

/** Padding do último segmento por nível (level 3 é 3 dígitos, demais 2). */
export function padLengthForLevel(level: EapLevel): number {
  return level === 3 ? 3 : 2;
}

/** Formata um eap_code a partir de prefixo pai + número + nível. */
export function formatEapCode(parentPrefix: string, lastSegment: number, level: EapLevel): string {
  const pad = padLengthForLevel(level);
  const padded = String(lastSegment).padStart(pad, "0");
  return parentPrefix ? `${parentPrefix}.${padded}` : padded;
}

/**
 * Extrai o último segmento numérico de um eap_code.
 * Ex: "03" → 3, "01.02" → 2, "01.02.003" → 3
 */
export function lastSegmentOf(eapCode: string): number {
  const parts = eapCode.split(".");
  return parseInt(parts[parts.length - 1], 10);
}

/** TODO — será implementado nos próximos steps */
export function computeRenumberPatch(
  _items: OrcamentoItem[],
  _operation: InsertOperation | DeleteOperation
): EapPatch[] {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Escrever testes do helper `formatEapCode` + `lastSegmentOf`**

`frontend/src/lib/eap.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  formatEapCode,
  lastSegmentOf,
  padLengthForLevel,
  computeRenumberPatch,
  type InsertOperation,
  type DeleteOperation,
} from "./eap";
import type { OrcamentoItem } from "@/types/orcamento";

// Factory mínima — só as colunas que as funções tocam
function item(eap_code: string, eap_level: 1 | 2 | 3, id = eap_code): OrcamentoItem {
  return {
    id,
    project_id: "test-project",
    eap_code,
    eap_level,
    descricao: `item ${eap_code}`,
    unidade: null,
    quantidade: null,
    fonte: null,
    fonte_codigo: null,
    fonte_data_base: null,
    custo_unitario: null,
    custo_material: null,
    custo_mao_obra: null,
    custo_total: null,
    adm_percentual: 12,
    peso_percentual: null,
    curva_abc_classe: null,
    quantitativo_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as OrcamentoItem;
}

describe("padLengthForLevel", () => {
  test("level 1 and 2 use 2 digits", () => {
    expect(padLengthForLevel(1)).toBe(2);
    expect(padLengthForLevel(2)).toBe(2);
  });
  test("level 3 uses 3 digits", () => {
    expect(padLengthForLevel(3)).toBe(3);
  });
});

describe("formatEapCode", () => {
  test("level 1 has no prefix", () => {
    expect(formatEapCode("", 3, 1)).toBe("03");
    expect(formatEapCode("", 12, 1)).toBe("12");
  });
  test("level 2 uses parent prefix + 2 digits", () => {
    expect(formatEapCode("01", 2, 2)).toBe("01.02");
  });
  test("level 3 uses 3-digit padding", () => {
    expect(formatEapCode("01.02", 5, 3)).toBe("01.02.005");
  });
});

describe("lastSegmentOf", () => {
  test("level 1 code", () => {
    expect(lastSegmentOf("03")).toBe(3);
  });
  test("level 2 code", () => {
    expect(lastSegmentOf("01.07")).toBe(7);
  });
  test("level 3 code", () => {
    expect(lastSegmentOf("01.02.014")).toBe(14);
  });
});
```

- [ ] **Step 3: Rodar os testes e verificar que passam (os 3 helpers) e o placeholder falha**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun test src/lib/eap.test.ts
```

Expected: 6 `expect` passam (os 3 describe dos helpers). `computeRenumberPatch` ainda não tem testes, então nenhum falha ainda.

- [ ] **Step 4: Adicionar os testes de `computeRenumberPatch` para insert**

Adicionar ao final de `frontend/src/lib/eap.test.ts`:

```ts
describe("computeRenumberPatch - insert level 1", () => {
  test("insert at end returns empty patch", () => {
    const items = [item("01", 1), item("02", 1), item("03", 1)];
    const op: InsertOperation = { kind: "insert", level: 1, parentPrefix: "", atPosition: 4 };
    expect(computeRenumberPatch(items, op)).toEqual([]);
  });

  test("insert at start shifts all etapas +1", () => {
    const items = [item("01", 1), item("02", 1)];
    const op: InsertOperation = { kind: "insert", level: 1, parentPrefix: "", atPosition: 1 };
    const patch = computeRenumberPatch(items, op);
    expect(patch).toEqual([
      { id: "01", eap_code: "02" },
      { id: "02", eap_code: "03" },
    ]);
  });

  test("insert in middle shifts only siblings >= atPosition", () => {
    const items = [item("01", 1), item("02", 1), item("03", 1), item("04", 1)];
    const op: InsertOperation = { kind: "insert", level: 1, parentPrefix: "", atPosition: 3 };
    const patch = computeRenumberPatch(items, op);
    expect(patch).toEqual([
      { id: "03", eap_code: "04" },
      { id: "04", eap_code: "05" },
    ]);
  });

  test("insert cascades rename to descendants", () => {
    const items = [
      item("01", 1),
      item("02", 1),
      item("02.01", 2),
      item("02.02", 2),
      item("02.01.001", 3),
      item("03", 1),
      item("03.01", 2),
    ];
    const op: InsertOperation = { kind: "insert", level: 1, parentPrefix: "", atPosition: 2 };
    const patch = computeRenumberPatch(items, op);
    // Deve renumerar 02→03, 03→04, e todos descendentes acompanham
    expect(patch).toContainEqual({ id: "02", eap_code: "03" });
    expect(patch).toContainEqual({ id: "02.01", eap_code: "03.01" });
    expect(patch).toContainEqual({ id: "02.02", eap_code: "03.02" });
    expect(patch).toContainEqual({ id: "02.01.001", eap_code: "03.01.001" });
    expect(patch).toContainEqual({ id: "03", eap_code: "04" });
    expect(patch).toContainEqual({ id: "03.01", eap_code: "04.01" });
    expect(patch).toHaveLength(6);
  });

  test("empty list returns empty patch", () => {
    const op: InsertOperation = { kind: "insert", level: 1, parentPrefix: "", atPosition: 1 };
    expect(computeRenumberPatch([], op)).toEqual([]);
  });
});

describe("computeRenumberPatch - insert level 2", () => {
  test("insert in middle of etapa respects parentPrefix", () => {
    const items = [
      item("01", 1),
      item("01.01", 2),
      item("01.02", 2),
      item("01.03", 2),
      item("02", 1),
      item("02.01", 2),
    ];
    const op: InsertOperation = { kind: "insert", level: 2, parentPrefix: "01", atPosition: 2 };
    const patch = computeRenumberPatch(items, op);
    // Só items dentro de 01.* com last-segment >= 2
    expect(patch).toContainEqual({ id: "01.02", eap_code: "01.03" });
    expect(patch).toContainEqual({ id: "01.03", eap_code: "01.04" });
    // 02 e 02.01 NÃO devem ser tocados
    expect(patch.find((p) => p.id === "02")).toBeUndefined();
    expect(patch.find((p) => p.id === "02.01")).toBeUndefined();
    expect(patch).toHaveLength(2);
  });

  test("insert cascades to level 3 descendants", () => {
    const items = [
      item("01", 1),
      item("01.01", 2),
      item("01.01.001", 3),
      item("01.02", 2),
      item("01.02.001", 3),
      item("01.02.002", 3),
    ];
    const op: InsertOperation = { kind: "insert", level: 2, parentPrefix: "01", atPosition: 1 };
    const patch = computeRenumberPatch(items, op);
    expect(patch).toContainEqual({ id: "01.01", eap_code: "01.02" });
    expect(patch).toContainEqual({ id: "01.01.001", eap_code: "01.02.001" });
    expect(patch).toContainEqual({ id: "01.02", eap_code: "01.03" });
    expect(patch).toContainEqual({ id: "01.02.001", eap_code: "01.03.001" });
    expect(patch).toContainEqual({ id: "01.02.002", eap_code: "01.03.002" });
    expect(patch).toHaveLength(5);
  });
});

describe("computeRenumberPatch - insert level 3", () => {
  test("uses 3-digit padding", () => {
    const items = [
      item("01", 1),
      item("01.01", 2),
      item("01.01.001", 3),
      item("01.01.002", 3),
    ];
    const op: InsertOperation = { kind: "insert", level: 3, parentPrefix: "01.01", atPosition: 1 };
    const patch = computeRenumberPatch(items, op);
    expect(patch).toEqual([
      { id: "01.01.001", eap_code: "01.01.002" },
      { id: "01.01.002", eap_code: "01.01.003" },
    ]);
  });
});
```

- [ ] **Step 5: Rodar testes — devem falhar com "not implemented"**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun test src/lib/eap.test.ts
```

Expected: ~12 novos testes falhando com erro "not implemented".

- [ ] **Step 6: Implementar `computeRenumberPatch` para insert**

Substituir a stub em `frontend/src/lib/eap.ts`:

```ts
export function computeRenumberPatch(
  items: OrcamentoItem[],
  operation: InsertOperation | DeleteOperation
): EapPatch[] {
  if (operation.kind === "insert") {
    return computeInsertPatch(items, operation);
  }
  return computeDeletePatch(items, operation);
}

function computeInsertPatch(items: OrcamentoItem[], op: InsertOperation): EapPatch[] {
  // Identificar irmãos do mesmo nível sob o mesmo pai
  const siblings = items.filter((i) => {
    if (i.eap_level !== op.level) return false;
    if (op.level === 1) return true;
    return i.eap_code.startsWith(op.parentPrefix + ".");
  });

  // Irmãos a renumerar: aqueles com last-segment >= atPosition
  const toShift = siblings.filter((s) => lastSegmentOf(s.eap_code) >= op.atPosition);
  if (toShift.length === 0) return [];

  const patch: EapPatch[] = [];

  for (const sibling of toShift) {
    const oldLast = lastSegmentOf(sibling.eap_code);
    const newLast = oldLast + 1;
    const newCode = formatEapCode(op.parentPrefix, newLast, op.level);
    patch.push({ id: sibling.id, eap_code: newCode });

    // Cascatear para todos os descendentes desse irmão
    const oldPrefix = sibling.eap_code;
    const newPrefix = newCode;
    for (const desc of items) {
      if (desc.eap_code.startsWith(oldPrefix + ".")) {
        const suffix = desc.eap_code.slice(oldPrefix.length);
        patch.push({ id: desc.id, eap_code: newPrefix + suffix });
      }
    }
  }

  return patch;
}

function computeDeletePatch(_items: OrcamentoItem[], _op: DeleteOperation): EapPatch[] {
  throw new Error("delete not implemented yet");
}
```

Remover `export function` antigo do stub (acima).

- [ ] **Step 7: Rodar testes — insert deve passar, delete ainda falha**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun test src/lib/eap.test.ts
```

Expected: todos os testes de insert (~12) passam. Nenhum teste de delete ainda.

- [ ] **Step 8: Commit**

```bash
cd /Users/andrefogelman/orcabot
git add frontend/src/lib/eap.ts frontend/src/lib/eap.test.ts
git commit -m "feat(eap): pure renumber patch computation for insert

Adds computeRenumberPatch for insert operations with full descendant
cascade — fixes latent bug where insertRelative would orphan children
when renumbering level-1 etapas.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `eap.ts` — `computeRenumberPatch` para delete

**Files:**
- Modify: `frontend/src/lib/eap.ts`
- Modify: `frontend/src/lib/eap.test.ts`

**Goal:** Implementar o ramo `delete` de `computeRenumberPatch` seguindo o mesmo padrão de insert (shift -1 em irmãos > deletedLastSegment, cascata em descendentes).

- [ ] **Step 1: Escrever testes de delete**

Adicionar ao final de `frontend/src/lib/eap.test.ts`:

```ts
describe("computeRenumberPatch - delete level 1", () => {
  test("delete last etapa returns empty patch", () => {
    const items = [item("01", 1), item("02", 1), item("03", 1)];
    const op: DeleteOperation = { kind: "delete", deletedCode: "03", level: 1 };
    expect(computeRenumberPatch(items, op)).toEqual([]);
  });

  test("delete first etapa shifts all others -1", () => {
    const items = [item("01", 1), item("02", 1), item("03", 1)];
    const op: DeleteOperation = { kind: "delete", deletedCode: "01", level: 1 };
    expect(computeRenumberPatch(items, op)).toEqual([
      { id: "02", eap_code: "01" },
      { id: "03", eap_code: "02" },
    ]);
  });

  test("delete in middle shifts only subsequent", () => {
    const items = [item("01", 1), item("02", 1), item("03", 1), item("04", 1)];
    const op: DeleteOperation = { kind: "delete", deletedCode: "02", level: 1 };
    const patch = computeRenumberPatch(items, op);
    expect(patch).toEqual([
      { id: "03", eap_code: "02" },
      { id: "04", eap_code: "03" },
    ]);
  });

  test("delete cascades rename to descendants of subsequent siblings", () => {
    const items = [
      item("01", 1),
      item("02", 1),
      item("02.01", 2),
      item("03", 1),
      item("03.01", 2),
      item("03.01.001", 3),
      item("03.02", 2),
    ];
    const op: DeleteOperation = { kind: "delete", deletedCode: "02", level: 1 };
    const patch = computeRenumberPatch(items, op);
    // 02 e 02.01 NÃO devem aparecer no patch (são removidos pelo bulkDelete)
    expect(patch.find((p) => p.id === "02")).toBeUndefined();
    expect(patch.find((p) => p.id === "02.01")).toBeUndefined();
    // 03 → 02 e toda sua subárvore acompanha
    expect(patch).toContainEqual({ id: "03", eap_code: "02" });
    expect(patch).toContainEqual({ id: "03.01", eap_code: "02.01" });
    expect(patch).toContainEqual({ id: "03.01.001", eap_code: "02.01.001" });
    expect(patch).toContainEqual({ id: "03.02", eap_code: "02.02" });
    expect(patch).toHaveLength(4);
  });
});

describe("computeRenumberPatch - delete level 2", () => {
  test("delete middle item in etapa shifts subsequent siblings", () => {
    const items = [
      item("01", 1),
      item("01.01", 2),
      item("01.02", 2),
      item("01.03", 2),
      item("02", 1),
      item("02.01", 2),
    ];
    const op: DeleteOperation = { kind: "delete", deletedCode: "01.02", level: 2 };
    const patch = computeRenumberPatch(items, op);
    expect(patch).toEqual([{ id: "01.03", eap_code: "01.02" }]);
    // 02 e 02.01 NÃO são tocados (parent diferente)
    expect(patch.find((p) => p.id === "02")).toBeUndefined();
  });

  test("delete level 2 cascades to level 3 descendants", () => {
    const items = [
      item("01", 1),
      item("01.01", 2),
      item("01.02", 2),
      item("01.02.001", 3),
      item("01.02.002", 3),
      item("01.03", 2),
      item("01.03.001", 3),
    ];
    const op: DeleteOperation = { kind: "delete", deletedCode: "01.01", level: 2 };
    const patch = computeRenumberPatch(items, op);
    expect(patch).toContainEqual({ id: "01.02", eap_code: "01.01" });
    expect(patch).toContainEqual({ id: "01.02.001", eap_code: "01.01.001" });
    expect(patch).toContainEqual({ id: "01.02.002", eap_code: "01.01.002" });
    expect(patch).toContainEqual({ id: "01.03", eap_code: "01.02" });
    expect(patch).toContainEqual({ id: "01.03.001", eap_code: "01.02.001" });
    expect(patch).toHaveLength(5);
  });
});

describe("computeRenumberPatch - delete level 3", () => {
  test("uses 3-digit padding when renumbering", () => {
    const items = [
      item("01", 1),
      item("01.01", 2),
      item("01.01.001", 3),
      item("01.01.002", 3),
      item("01.01.003", 3),
    ];
    const op: DeleteOperation = { kind: "delete", deletedCode: "01.01.001", level: 3 };
    const patch = computeRenumberPatch(items, op);
    expect(patch).toEqual([
      { id: "01.01.002", eap_code: "01.01.001" },
      { id: "01.01.003", eap_code: "01.01.002" },
    ]);
  });
});
```

- [ ] **Step 2: Rodar testes — os de delete devem falhar**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun test src/lib/eap.test.ts
```

Expected: ~8 novos testes falhando com "delete not implemented yet".

- [ ] **Step 3: Implementar `computeDeletePatch`**

Em `frontend/src/lib/eap.ts`, substituir a stub de `computeDeletePatch`:

```ts
function computeDeletePatch(items: OrcamentoItem[], op: DeleteOperation): EapPatch[] {
  // Derivar parentPrefix a partir do deletedCode
  const parts = op.deletedCode.split(".");
  const parentPrefix = parts.slice(0, -1).join(".");
  const deletedLastSegment = parseInt(parts[parts.length - 1], 10);

  // Irmãos do mesmo nível sob o mesmo pai
  const siblings = items.filter((i) => {
    if (i.eap_level !== op.level) return false;
    if (i.eap_code === op.deletedCode) return false; // exclui o próprio
    if (op.level === 1) return true;
    return i.eap_code.startsWith(parentPrefix + ".");
  });

  // Irmãos com last-segment > deletedLastSegment precisam shift -1
  const toShift = siblings.filter((s) => lastSegmentOf(s.eap_code) > deletedLastSegment);
  if (toShift.length === 0) return [];

  const patch: EapPatch[] = [];

  for (const sibling of toShift) {
    const oldLast = lastSegmentOf(sibling.eap_code);
    const newLast = oldLast - 1;
    const newCode = formatEapCode(parentPrefix, newLast, op.level);
    patch.push({ id: sibling.id, eap_code: newCode });

    // Cascatear aos descendentes
    const oldPrefix = sibling.eap_code;
    const newPrefix = newCode;
    for (const desc of items) {
      if (desc.eap_code.startsWith(oldPrefix + ".")) {
        const suffix = desc.eap_code.slice(oldPrefix.length);
        patch.push({ id: desc.id, eap_code: newPrefix + suffix });
      }
    }
  }

  return patch;
}
```

- [ ] **Step 4: Rodar todos os testes**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun test src/lib/eap.test.ts
```

Expected: todos os ~20 testes passam.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrefogelman/orcabot
git add frontend/src/lib/eap.ts frontend/src/lib/eap.test.ts
git commit -m "feat(eap): pure renumber patch computation for delete

Mirror of insert logic — shifts subsequent siblings -1 and cascades
rename to all descendants.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `eap.ts` — `buildInsertPositionOptions` e `snapshotAffected`

**Files:**
- Modify: `frontend/src/lib/eap.ts`
- Modify: `frontend/src/lib/eap.test.ts`

**Goal:** Fornecer os helpers que a UI vai usar: gerar opções para o popover e tirar snapshot para undo.

- [ ] **Step 1: Escrever testes de `snapshotAffected`**

Adicionar ao final de `frontend/src/lib/eap.test.ts`:

```ts
describe("snapshotAffected", () => {
  test("returns current eap_codes of items referenced in patch", () => {
    const items = [item("01", 1), item("02", 1), item("03", 1)];
    const patch = [
      { id: "02", eap_code: "03" },
      { id: "03", eap_code: "04" },
    ];
    const snapshot = snapshotAffected(items, patch);
    expect(snapshot).toEqual([
      { id: "02", eap_code: "02" },
      { id: "03", eap_code: "03" },
    ]);
  });

  test("empty patch returns empty snapshot", () => {
    const items = [item("01", 1)];
    expect(snapshotAffected(items, [])).toEqual([]);
  });

  test("ignores items in patch that are not in the list", () => {
    const items = [item("01", 1)];
    const patch = [{ id: "nonexistent", eap_code: "02" }];
    expect(snapshotAffected(items, patch)).toEqual([]);
  });
});
```

- [ ] **Step 2: Escrever testes de `buildInsertPositionOptions` — level 1**

Adicionar ao mesmo arquivo:

```ts
describe("buildInsertPositionOptions - level 1", () => {
  test("empty list returns empty array", () => {
    expect(buildInsertPositionOptions([], 1)).toEqual([]);
  });

  test("single etapa returns 'start' + 'end' only", () => {
    const items = [item("01", 1)];
    items[0].descricao = "Instalação";
    const options = buildInsertPositionOptions(items, 1);
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ parentPrefix: "", atPosition: 1, label: "No início" });
    expect(options[options.length - 1]).toMatchObject({
      parentPrefix: "",
      atPosition: 2,
      label: "No final",
      highlighted: true,
    });
  });

  test("multiple etapas return start + after each + end", () => {
    const items = [item("01", 1), item("02", 1), item("03", 1)];
    items[0].descricao = "Instalação";
    items[1].descricao = "Despesas";
    items[2].descricao = "Revestimentos";
    const options = buildInsertPositionOptions(items, 1);
    // No início + 3 "Depois de X" + No final = 5
    expect(options).toHaveLength(5);
    expect(options[0].label).toBe("No início");
    expect(options[1].label).toContain("01");
    expect(options[1].label).toContain("Instalação");
    expect(options[1].atPosition).toBe(2);
    expect(options[4].label).toBe("No final");
    expect(options[4].highlighted).toBe(true);
  });

  test("ignores level 2/3 items", () => {
    const items = [
      item("01", 1),
      item("01.01", 2),
      item("01.01.001", 3),
      item("02", 1),
    ];
    const options = buildInsertPositionOptions(items, 1);
    // No início + depois de 01 + depois de 02 + No final = 4
    expect(options).toHaveLength(4);
  });
});
```

- [ ] **Step 3: Rodar testes — devem falhar porque `snapshotAffected` e `buildInsertPositionOptions` não existem**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun test src/lib/eap.test.ts
```

Expected: testes de snapshot e buildInsert falham ("is not a function" / compile error). Adicionar o import que falta.

- [ ] **Step 4: Implementar `snapshotAffected` e `buildInsertPositionOptions`**

Adicionar no final de `frontend/src/lib/eap.ts`:

```ts
/**
 * Retorna um snapshot do estado atual (id → eap_code) dos items mencionados no patch.
 * Usado para undo: reverter um patch = reaplicá-lo com este snapshot.
 */
export function snapshotAffected(items: OrcamentoItem[], patch: EapPatch[]): EapPatch[] {
  const byId = new Map(items.map((i) => [i.id, i.eap_code]));
  const result: EapPatch[] = [];
  for (const p of patch) {
    const current = byId.get(p.id);
    if (current !== undefined) {
      result.push({ id: p.id, eap_code: current });
    }
  }
  return result;
}

export type InsertPositionOption = {
  /** chave única para React key */
  id: string;
  /** texto mostrado no item do popover */
  label: string;
  /** grupo para agrupamento visual em levels 2/3 — ex: "01 — Instalação" */
  group?: string;
  /** subgrupo só para level 3 — ex: "01.02 — Revestimentos" */
  subgroup?: string;
  parentPrefix: string;
  atPosition: number;
  /** default a ser destacado ao abrir */
  highlighted?: boolean;
};

/**
 * Gera a lista de opções para o popover "Onde inserir?".
 * - Level 1: plana, "No início" + "Depois de X" + "No final" (highlighted)
 * - Level 2: agrupada por etapa
 * - Level 3: agrupada por etapa › item
 */
export function buildInsertPositionOptions(
  items: OrcamentoItem[],
  level: EapLevel
): InsertPositionOption[] {
  if (items.length === 0) return [];

  if (level === 1) {
    const etapas = items
      .filter((i) => i.eap_level === 1)
      .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

    if (etapas.length === 0) return [];

    const options: InsertPositionOption[] = [
      { id: "start", label: "No início", parentPrefix: "", atPosition: 1 },
    ];
    for (const e of etapas) {
      const lastSeg = lastSegmentOf(e.eap_code);
      options.push({
        id: `after-${e.id}`,
        label: `Depois de ${e.eap_code} — ${e.descricao}`,
        parentPrefix: "",
        atPosition: lastSeg + 1,
      });
    }
    // O último "Depois de N" é equivalente a "No final". Substituir pelo label final e marcar como highlighted.
    const last = options[options.length - 1];
    last.label = "No final";
    last.highlighted = true;
    last.id = "end";
    return options;
  }

  if (level === 2) {
    const etapas = items
      .filter((i) => i.eap_level === 1)
      .sort((a, b) => a.eap_code.localeCompare(b.eap_code));
    if (etapas.length === 0) return [];

    const options: InsertPositionOption[] = [];
    for (let eIdx = 0; eIdx < etapas.length; eIdx++) {
      const etapa = etapas[eIdx];
      const prefix = etapa.eap_code;
      const groupLabel = `${etapa.eap_code} — ${etapa.descricao}`;
      const children = items
        .filter((i) => i.eap_level === 2 && i.eap_code.startsWith(prefix + "."))
        .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

      // "No início da etapa"
      options.push({
        id: `start-${etapa.id}`,
        label: "No início da etapa",
        group: groupLabel,
        parentPrefix: prefix,
        atPosition: 1,
      });
      for (const c of children) {
        options.push({
          id: `after-${c.id}`,
          label: `Depois de ${c.eap_code} — ${c.descricao}`,
          group: groupLabel,
          parentPrefix: prefix,
          atPosition: lastSegmentOf(c.eap_code) + 1,
        });
      }
      // Se teve children, o último é "No final da etapa"
      if (children.length > 0) {
        const last = options[options.length - 1];
        last.label = "No final da etapa";
        last.id = `end-${etapa.id}`;
      }
      // Highlight do último "No final da etapa" da última etapa
      if (eIdx === etapas.length - 1) {
        options[options.length - 1].highlighted = true;
      }
    }
    return options;
  }

  // level === 3
  const etapas = items
    .filter((i) => i.eap_level === 1)
    .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

  const options: InsertPositionOption[] = [];
  for (let eIdx = 0; eIdx < etapas.length; eIdx++) {
    const etapa = etapas[eIdx];
    const groupLabel = `${etapa.eap_code} — ${etapa.descricao}`;
    const items2 = items
      .filter((i) => i.eap_level === 2 && i.eap_code.startsWith(etapa.eap_code + "."))
      .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

    for (let iIdx = 0; iIdx < items2.length; iIdx++) {
      const it2 = items2[iIdx];
      const subgroupLabel = `${it2.eap_code} — ${it2.descricao}`;
      const prefix = it2.eap_code;
      const children = items
        .filter((i) => i.eap_level === 3 && i.eap_code.startsWith(prefix + "."))
        .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

      options.push({
        id: `start-${it2.id}`,
        label: "No início do item",
        group: groupLabel,
        subgroup: subgroupLabel,
        parentPrefix: prefix,
        atPosition: 1,
      });
      for (const c of children) {
        options.push({
          id: `after-${c.id}`,
          label: `Depois de ${c.eap_code} — ${c.descricao}`,
          group: groupLabel,
          subgroup: subgroupLabel,
          parentPrefix: prefix,
          atPosition: lastSegmentOf(c.eap_code) + 1,
        });
      }
      if (children.length > 0) {
        const last = options[options.length - 1];
        last.label = "No final do item";
        last.id = `end-${it2.id}`;
      }
      // Highlight: último "No final do item" do último item da última etapa
      if (eIdx === etapas.length - 1 && iIdx === items2.length - 1) {
        options[options.length - 1].highlighted = true;
      }
    }
  }
  return options;
}
```

Adicionar import no topo do `eap.test.ts`:

```ts
import {
  formatEapCode,
  lastSegmentOf,
  padLengthForLevel,
  computeRenumberPatch,
  snapshotAffected,
  buildInsertPositionOptions,
  type InsertOperation,
  type DeleteOperation,
} from "./eap";
```

- [ ] **Step 5: Rodar todos os testes**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun test src/lib/eap.test.ts
```

Expected: todos os testes passam.

- [ ] **Step 6: Rodar typecheck do frontend**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun run typecheck
```

Expected: sem erros. (Nota: `eap.test.ts` pode não estar incluído no `tsconfig.json` — se aparecer erro de não encontrar `bun:test`, documentar e ignorar, os testes rodam via `bun test` diretamente.)

- [ ] **Step 7: Commit**

```bash
cd /Users/andrefogelman/orcabot
git add frontend/src/lib/eap.ts frontend/src/lib/eap.test.ts
git commit -m "feat(eap): add snapshotAffected and buildInsertPositionOptions

Provides the helpers consumed by the UI layer: position picker options
(level 1/2/3 grouped) and pre-operation snapshot for undo.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Adicionar componentes shadcn Popover + Command

**Files:**
- Create: `frontend/src/components/ui/popover.tsx`
- Create: `frontend/src/components/ui/command.tsx`

**Goal:** Instalar os wrappers shadcn para `@radix-ui/react-popover` e `cmdk` (já presentes nas dependências).

- [ ] **Step 1: Criar `popover.tsx`**

`frontend/src/components/ui/popover.tsx`:

```tsx
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
```

- [ ] **Step 2: Criar `command.tsx`**

`frontend/src/components/ui/command.tsx`:

```tsx
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
      className
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[320px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground",
      "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
      "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
      "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
};
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun run typecheck
```

Expected: sem erros (as deps já estão no `package.json`).

- [ ] **Step 4: Commit**

```bash
cd /Users/andrefogelman/orcabot
git add frontend/src/components/ui/popover.tsx frontend/src/components/ui/command.tsx
git commit -m "feat(ui): add shadcn Popover and Command primitives

Required for the InsertPositionPopover. Deps @radix-ui/react-popover
and cmdk were already in package.json.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Componente `InsertPositionPopover`

**Files:**
- Create: `frontend/src/components/planilha/InsertPositionPopover.tsx`

**Goal:** Popover ancorado num trigger que mostra as opções geradas por `buildInsertPositionOptions` e chama `onSelect` ao clicar.

- [ ] **Step 1: Criar o componente**

`frontend/src/components/planilha/InsertPositionPopover.tsx`:

```tsx
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  buildInsertPositionOptions,
  type EapLevel,
  type InsertPositionOption,
} from "@/lib/eap";
import type { OrcamentoItem } from "@/types/orcamento";

interface InsertPositionPopoverProps {
  level: EapLevel;
  items: OrcamentoItem[];
  onSelect: (parentPrefix: string, atPosition: number) => void;
  children: React.ReactNode;
}

export function InsertPositionPopover({
  level,
  items,
  onSelect,
  children,
}: InsertPositionPopoverProps) {
  const [open, setOpen] = useState(false);

  const options = useMemo(() => buildInsertPositionOptions(items, level), [items, level]);

  // Se não há opções (planilha vazia ou sem pai válido para esse nível),
  // inserir direto no começo sem abrir popover
  const handleTriggerClick = (e: React.MouseEvent) => {
    if (options.length === 0) {
      e.preventDefault();
      onSelect("", 1);
      return;
    }
  };

  const handlePick = (opt: InsertPositionOption) => {
    setOpen(false);
    onSelect(opt.parentPrefix, opt.atPosition);
  };

  // Agrupa opções por `group` (e subgrupo) para render
  const grouped = useMemo(() => {
    const map = new Map<string, InsertPositionOption[]>();
    for (const opt of options) {
      const key = opt.group ?? "__ungrouped__";
      const arr = map.get(key) ?? [];
      arr.push(opt);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={handleTriggerClick}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command>
          <CommandInput placeholder="Onde inserir?" />
          <CommandList>
            <CommandEmpty>Nenhuma posição</CommandEmpty>
            {grouped.map(([groupLabel, opts]) => (
              <CommandGroup
                key={groupLabel}
                heading={groupLabel === "__ungrouped__" ? undefined : groupLabel}
              >
                {opts.map((opt) => (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.group ?? ""}|${opt.subgroup ?? ""}|${opt.label}`}
                    onSelect={() => handlePick(opt)}
                    className={opt.highlighted ? "font-semibold" : undefined}
                  >
                    {opt.subgroup && (
                      <span className="text-xs text-muted-foreground mr-2">
                        {opt.subgroup}
                      </span>
                    )}
                    {opt.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun run typecheck
```

Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
cd /Users/andrefogelman/orcabot
git add frontend/src/components/planilha/InsertPositionPopover.tsx
git commit -m "feat(planilha): InsertPositionPopover component

Uses shadcn Popover + Command to present 'where to insert' options
generated by buildInsertPositionOptions. Handles empty list by
inserting at start without opening the popover.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Refatorar `BudgetToolbar` para usar o popover

**Files:**
- Modify: `frontend/src/components/planilha/BudgetToolbar.tsx`

**Goal:** Trocar a assinatura `onAddItem(level)` por `onInsertAt(level, parentPrefix, atPosition)` e wrappear os 3 botões com `InsertPositionPopover`.

- [ ] **Step 1: Modificar a interface de props e imports**

Substituir no topo de `frontend/src/components/planilha/BudgetToolbar.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, Download, Filter, Search, Upload, Undo2, X } from "lucide-react";
import { useState } from "react";
import { InsertPositionPopover } from "./InsertPositionPopover";
import type { OrcamentoItem } from "@/types/orcamento";

interface BudgetToolbarProps {
  items: OrcamentoItem[];
  onInsertAt: (level: 1 | 2 | 3, parentPrefix: string, atPosition: number) => void;
  onExportExcel: () => void;
  onSearch: (query: string) => void;
  filterDisciplina: string | null;
  onFilterDisciplina: (disciplina: string | null) => void;
  onImportQuantitativos?: () => void;
  onImportPropostas?: () => void;
  onUndo?: () => void;
}

export function BudgetToolbar({
  items,
  onInsertAt,
  onExportExcel,
  onSearch,
  filterDisciplina,
  onFilterDisciplina,
  onImportQuantitativos,
  onImportPropostas,
  onUndo,
}: BudgetToolbarProps) {
```

- [ ] **Step 2: Substituir o bloco dos 3 botões de adicionar**

Substituir linhas 38-52 (`{/* Add item buttons */} ... </div>`) por:

```tsx
      {/* Add item buttons */}
      <div className="flex items-center gap-1">
        <InsertPositionPopover
          level={1}
          items={items}
          onSelect={(prefix, pos) => onInsertAt(1, prefix, pos)}
        >
          <Button variant="outline" size="sm">
            <Plus className="mr-1 h-3 w-3" />
            Etapa
          </Button>
        </InsertPositionPopover>
        <InsertPositionPopover
          level={2}
          items={items}
          onSelect={(prefix, pos) => onInsertAt(2, prefix, pos)}
        >
          <Button variant="outline" size="sm">
            <Plus className="mr-1 h-3 w-3" />
            Item
          </Button>
        </InsertPositionPopover>
        <InsertPositionPopover
          level={3}
          items={items}
          onSelect={(prefix, pos) => onInsertAt(3, prefix, pos)}
        >
          <Button variant="outline" size="sm">
            <Plus className="mr-1 h-3 w-3" />
            Subitem
          </Button>
        </InsertPositionPopover>
      </div>
```

- [ ] **Step 3: Typecheck (vai falhar porque o callsite em BudgetTable não foi atualizado)**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun run typecheck
```

Expected: erro em `BudgetTable.tsx` sobre `onAddItem` não existir mais. Isso é esperado e será corrigido na Task 9.

- [ ] **Step 4: NÃO commitar ainda** — deixar como WIP, commitar junto com a refatoração de BudgetTable na Task 9 para não deixar build quebrada entre commits.

---

## Task 8: Estender `useUndoStack` com entradas compostas

**Files:**
- Modify: `frontend/src/hooks/useUndoStack.ts`

**Goal:** Adicionar os tipos `insert-with-renumber` e `delete-with-renumber` ao discriminated union e implementar os reverts correspondentes.

- [ ] **Step 1: Reescrever o arquivo com novos tipos e lógica**

Substituir `frontend/src/hooks/useUndoStack.ts` inteiro:

```ts
import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OrcamentoItem } from "@/types/orcamento";
import type { EapPatch } from "@/lib/eap";

export type UndoAction =
  | {
      type: "update";
      table: string;
      itemId: string;
      projectId: string;
      previousData: Record<string, unknown>;
    }
  | {
      type: "create";
      table: string;
      itemId: string;
      projectId: string;
      previousData: Record<string, unknown>;
    }
  | {
      type: "delete";
      table: string;
      itemId: string;
      projectId: string;
      previousData: Record<string, unknown>;
    }
  | {
      type: "insert-with-renumber";
      projectId: string;
      createdItemId: string;
      snapshot: EapPatch[];
    }
  | {
      type: "delete-with-renumber";
      projectId: string;
      deletedItems: OrcamentoItem[];
      snapshot: EapPatch[];
    };

const MAX_UNDO_STACK = 10;

export function useUndoStack() {
  const stackRef = useRef<UndoAction[]>([]);
  const queryClient = useQueryClient();

  const push = useCallback((action: UndoAction) => {
    stackRef.current = [
      ...stackRef.current.slice(-(MAX_UNDO_STACK - 1)),
      action,
    ];
  }, []);

  const undo = useCallback(async () => {
    const action = stackRef.current.pop();
    if (!action) {
      toast.info("Nada para desfazer");
      return;
    }

    try {
      switch (action.type) {
        case "update": {
          const { error } = await supabase
            .from(action.table)
            .update(action.previousData)
            .eq("id", action.itemId);
          if (error) throw error;
          break;
        }
        case "create": {
          const { error } = await supabase
            .from(action.table)
            .delete()
            .eq("id", action.itemId);
          if (error) throw error;
          break;
        }
        case "delete": {
          const { error } = await supabase
            .from(action.table)
            .insert(action.previousData);
          if (error) throw error;
          break;
        }
        case "insert-with-renumber": {
          // 1. Deletar o item criado
          const delRes = await supabase
            .from("ob_orcamento_items")
            .delete()
            .eq("id", action.createdItemId);
          if (delRes.error) throw delRes.error;
          // 2. Reverter a renumeração
          if (action.snapshot.length > 0) {
            const { error } = await supabase.rpc("revert_renumber", {
              p_project_id: action.projectId,
              p_snapshot: action.snapshot,
            });
            if (error) throw error;
          }
          break;
        }
        case "delete-with-renumber": {
          // 1. Reverter a renumeração (devolve os códigos antigos aos sobreviventes)
          if (action.snapshot.length > 0) {
            const { error: rpcErr } = await supabase.rpc("revert_renumber", {
              p_project_id: action.projectId,
              p_snapshot: action.snapshot,
            });
            if (rpcErr) throw rpcErr;
          }
          // 2. Reinserir os itens deletados preservando IDs
          if (action.deletedItems.length > 0) {
            const { error: insErr } = await supabase
              .from("ob_orcamento_items")
              .insert(action.deletedItems);
            if (insErr) throw insErr;
          }
          break;
        }
      }

      queryClient.invalidateQueries({
        queryKey: ["orcamento", action.projectId],
      });
      toast.success("Ação desfeita");
    } catch (err) {
      console.error("Undo failed:", err);
      toast.error("Erro ao desfazer ação");
      // Push back the action so user can retry
      stackRef.current.push(action);
    }
  }, [queryClient]);

  // Listen for Ctrl+Z
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo]);

  return { push, undo };
}
```

Nota: no `BudgetTable.tsx` atual (linhas 266, 293, 312) o código push usa `{ type: "create", ...}` e `{ type: "delete", ...}` como objects literal sem discriminated union estrito. O novo `UndoAction` é mais estrito (discriminated union), mas os objetos antigos devem continuar válidos. Verificar no typecheck.

- [ ] **Step 2: Typecheck (pode falhar em BudgetTable — será corrigido na Task 9)**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun run typecheck
```

Expected: pode aparecer erros em `BudgetTable.tsx` porque as entradas antigas de `create`/`delete` não têm todos os campos discriminados. Não commitar ainda — resolver junto com Task 9.

---

## Task 9: Refatorar `BudgetTable` — `handleInsertAt`, `handleDeleteRequest` e `insertRelative`

**Files:**
- Modify: `frontend/src/components/planilha/BudgetTable.tsx`

**Goal:** Substituir `handleAddItem` por `handleInsertAt`, modificar `handleDeleteRequest` para renumerar, e migrar `insertRelative` para usar a mesma infraestrutura (eliminando o bug latente de descendentes órfãos).

- [ ] **Step 1: Adicionar imports**

No topo de `BudgetTable.tsx`, adicionar (junto aos imports existentes):

```tsx
import { supabase } from "@/lib/supabase";
import {
  computeRenumberPatch,
  snapshotAffected,
  formatEapCode,
} from "@/lib/eap";
```

- [ ] **Step 2: Substituir `handleAddItem` por `handleInsertAt`**

Localizar o bloco `handleAddItem` (começa em linha ~207, após `// ─── Add Item ───`) e substituir **tudo** até o fechamento `);` do useCallback (linha ~278) por:

```tsx
  // ─── Insert Item at Position ───────────────────────────────────
  const handleInsertAt = useCallback(
    async (level: 1 | 2 | 3, parentPrefix: string, atPosition: number) => {
      if (!items) return;

      // Calcular patch de renumeração + snapshot pra undo
      const patch = computeRenumberPatch(items, {
        kind: "insert",
        level,
        parentPrefix,
        atPosition,
      });
      const snapshot = snapshotAffected(items, patch);

      // Aplicar renumeração atomicamente (se houver)
      if (patch.length > 0) {
        const { error } = await supabase.rpc("renumber_eap_items", {
          p_project_id: projectId,
          p_patches: patch,
        });
        if (error) {
          toast.error("Erro ao renumerar");
          console.error("renumber_eap_items failed:", error);
          return;
        }
      }

      // Criar o novo item com o eap_code que ficou livre
      const newCode = formatEapCode(parentPrefix, atPosition, level);

      createItem.mutate(
        {
          project_id: projectId,
          eap_code: newCode,
          eap_level: level,
          descricao: level === 1 ? "NOVA ETAPA" : "Novo item",
          unidade: level === 1 ? null : "un",
          quantidade: level === 1 ? null : 0,
          fonte: null,
          fonte_codigo: null,
          fonte_data_base: null,
          custo_unitario: null,
          custo_material: level === 1 ? null : 0,
          custo_mao_obra: level === 1 ? null : 0,
          custo_total: level === 1 ? null : 0,
          adm_percentual: 12,
          peso_percentual: null,
          curva_abc_classe: null,
          quantitativo_id: null,
        },
        {
          onSuccess: (data) => {
            undoStack.push({
              type: "insert-with-renumber",
              projectId,
              createdItemId: data.id,
              snapshot,
            });
          },
          onError: async (err) => {
            console.error("createItem failed, reverting renumber", err);
            // Rollback da renumeração
            if (snapshot.length > 0) {
              await supabase.rpc("revert_renumber", {
                p_project_id: projectId,
                p_snapshot: snapshot,
              });
            }
            toast.error("Erro ao criar item");
          },
        }
      );
    },
    [items, projectId, createItem, undoStack]
  );
```

- [ ] **Step 3: Modificar `handleDeleteRequest` para renumerar**

Localizar `handleDeleteRequest` (linha ~281) e substituir todo o bloco do useCallback por:

```tsx
  // ─── Delete Item with auto-renumber (inline Sim/Não in BudgetRow) ──
  const handleDeleteRequest = useCallback(
    async (item: OrcamentoItem) => {
      if (!items) return;

      // Determinar tudo que será removido
      const toDelete =
        item.eap_level === 1
          ? items.filter(
              (i) => i.id === item.id || i.eap_code.startsWith(item.eap_code + ".")
            )
          : [item];

      // Calcular patch de renumeração dos irmãos posteriores (+ descendentes)
      const patch = computeRenumberPatch(items, {
        kind: "delete",
        deletedCode: item.eap_code,
        level: item.eap_level as 1 | 2 | 3,
      });
      const snapshot = snapshotAffected(items, patch);

      // 1) Bulk delete
      try {
        await bulkDelete.mutateAsync({
          ids: toDelete.map((i) => i.id),
          projectId,
        });
      } catch (err) {
        console.error("bulkDelete failed:", err);
        toast.error("Erro ao excluir");
        return;
      }

      // 2) Renumerar irmãos posteriores
      if (patch.length > 0) {
        const { error } = await supabase.rpc("renumber_eap_items", {
          p_project_id: projectId,
          p_patches: patch,
        });
        if (error) {
          console.error("renumber_eap_items failed after delete:", error);
          toast.error("Itens excluídos, mas renumeração falhou");
          return;
        }
      }

      // 3) Push entrada composta no undoStack
      undoStack.push({
        type: "delete-with-renumber",
        projectId,
        deletedItems: toDelete,
        snapshot,
      });

      toast.success(`${toDelete.length} item(ns) excluído(s)`);
    },
    [items, projectId, bulkDelete, undoStack]
  );
```

Remover a variável `deleteItem` dos deps se não for mais usada em nenhum outro lugar do arquivo (checar com Grep).

- [ ] **Step 4: Migrar `insertRelative` para usar a nova infra**

Localizar `insertRelative` (linha ~342) e substituir por uma versão fina que delega a `handleInsertAt`:

```tsx
  /** Insert a new sibling relative to the target item (used by context menu) */
  const insertRelative = useCallback(
    (target: OrcamentoItem, position: "above" | "below") => {
      const level = target.eap_level as 1 | 2 | 3;
      const parts = target.eap_code.split(".");
      const parentPrefix = parts.slice(0, -1).join(".");
      const targetLastSeg = parseInt(parts[parts.length - 1], 10);

      const atPosition =
        position === "above" ? targetLastSeg : targetLastSeg + 1;

      handleInsertAt(level, parentPrefix, atPosition);
    },
    [handleInsertAt]
  );
```

Isso elimina TODO o código antigo de `insertRelative` (que tinha o bug de descendentes órfãos) e passa tudo pela lógica testada em `eap.ts`.

- [ ] **Step 5: Atualizar o callsite do `BudgetToolbar`**

Localizar onde `BudgetToolbar` é renderizado (linha ~684, `onAddItem={handleAddItem}`) e substituir:

```tsx
onAddItem={handleAddItem}
```

por:

```tsx
items={items ?? []}
onInsertAt={handleInsertAt}
```

- [ ] **Step 6: Remover imports não usados**

Após as substituições, `handleAddItem` não existe mais. Verificar se `updateItem` ainda é usado (era usado por `insertRelative` diretamente, agora só via `handleInsertAt` que não o usa diretamente). Rodar:

```bash
cd /Users/andrefogelman/orcabot/frontend
bun run typecheck
```

Remover warnings de unused imports se aparecerem (ex: `useUpdateOrcamentoItem` pode não ser mais necessário se só o `insertRelative` o usava). Se `updateItem` ainda é necessário para outras coisas no arquivo, manter.

- [ ] **Step 7: Typecheck limpo**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun run typecheck
```

Expected: sem erros.

- [ ] **Step 8: Rodar testes unitários (devem continuar passando)**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun test src/lib/eap.test.ts
```

Expected: todos os testes passam.

- [ ] **Step 9: Commit (inclui Tasks 7, 8 e 9)**

```bash
cd /Users/andrefogelman/orcabot
git add frontend/src/components/planilha/BudgetToolbar.tsx \
        frontend/src/components/planilha/BudgetTable.tsx \
        frontend/src/hooks/useUndoStack.ts
git commit -m "feat(planilha): insert/delete with position picker and auto-renumber

- BudgetToolbar: 3 buttons now wrapped in InsertPositionPopover
- BudgetTable: handleInsertAt replaces handleAddItem, uses RPC for atomic batch
- handleDeleteRequest: now renumbers subsequent siblings + descendants
- insertRelative (context menu): migrated to same infrastructure, fixes
  latent bug where descendants became orphans after sibling renumber
- useUndoStack: new insert-with-renumber and delete-with-renumber actions
  with snapshot-based revert via revert_renumber RPC

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Verificação manual + deploy

**Goal:** Build, deploy e smoke test manual no browser.

- [ ] **Step 1: Build do frontend**

```bash
cd /Users/andrefogelman/orcabot/frontend
bun run build
```

Expected: build completa sem erros.

- [ ] **Step 2: Deploy Vercel**

```bash
cd /Users/andrefogelman/orcabot/frontend
npx vercel --prod --yes
```

Expected: URL de produção retornada.

- [ ] **Step 3: Verificação manual — ações a testar**

Abrir a URL de produção em `/apartamento-mark-linker` (ou qualquer projeto com pelo menos 3 etapas). Checklist:

- [ ] Clicar em `+ Etapa` → popover abre com lista de posições
- [ ] Popover mostra "No início" + "Depois de XX — ..." para cada etapa + "No final" (destacado)
- [ ] Selecionar "Depois de 02 — Despesas Gerais" → nova etapa 03 criada, antigas 03+ renumeradas para 04+
- [ ] Descendentes das etapas renumeradas também foram renumerados (verificar expandindo uma etapa que tinha subitens)
- [ ] Clicar em `+ Item` → popover mostra opções agrupadas por etapa
- [ ] Inserir item no meio de uma etapa → item e descendentes shift OK
- [ ] Clicar em `+ Subitem` → popover mostra opções agrupadas por etapa › item
- [ ] Clicar no trash de uma etapa → Sim/Não inline → Sim → etapa removida, subsequentes renumeradas
- [ ] Ctrl+Z após inserção → etapa nova removida + renumeração desfeita
- [ ] Ctrl+Z após exclusão → etapas deletadas ressurgem no lugar certo + renumeração desfeita
- [ ] Right-click numa linha → "Inserir acima/abaixo" ainda funciona e **não cria descendentes órfãos** (testar com etapa que tem subitens)
- [ ] Popover fecha com ESC e click fora

- [ ] **Step 4: Se tudo OK, reportar sucesso e caminho do deploy. Se falhar, diagnosticar e corrigir.**

- [ ] **Step 5: Push final (se houver correções)**

```bash
cd /Users/andrefogelman/orcabot
git push
```

---

## Self-Review do plano

**Spec coverage:**
- ✅ `computeRenumberPatch` (insert + delete com cascata) — Tasks 2, 3
- ✅ `buildInsertPositionOptions` — Task 4
- ✅ `snapshotAffected` — Task 4
- ✅ `InsertPositionPopover` — Tasks 5, 6
- ✅ `BudgetToolbar` refatorado — Task 7
- ✅ `BudgetTable.handleInsertAt` — Task 9
- ✅ `BudgetTable.handleDeleteRequest` com renumeração — Task 9
- ✅ `insertRelative` migrado (fix do bug de órfãos) — Task 9
- ✅ `useUndoStack` estendido — Task 8
- ✅ Migration Postgres RPCs + unique constraint — Task 1
- ✅ Testes unitários cobrindo insert/delete × 3 levels + edge cases — Tasks 2, 3, 4
- ✅ Verificação manual pós-deploy — Task 10

**Placeholder scan:** nenhum "TBD"/"TODO" no plano. Todos os passos têm código concreto.

**Type consistency:** `EapPatch`, `EapLevel`, `InsertOperation`, `DeleteOperation`, `InsertPositionOption` consistentes entre `eap.ts`, `useUndoStack.ts`, `InsertPositionPopover.tsx` e `BudgetTable.tsx`. `handleInsertAt(level, parentPrefix, atPosition)` assinatura consistente entre toolbar e table.

**Ordem de dependência:** Task 1 (DB) → 2, 3, 4 (lib pura) → 5, 6 (UI primitives) → 7 (toolbar, WIP) → 8 (hook, WIP) → 9 (table + resolve WIP) → 10 (deploy). Tasks 7 e 8 deixam build quebrada intencionalmente e são commitadas junto com 9.
