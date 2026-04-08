# Propostas de Fornecedores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable upload of supplier proposal PDFs, extract items via a dedicated container pipeline, review/edit in a new Propostas tab, and import into the budget spreadsheet via a dedicated "Importar Proposta" button.

**Architecture:** Two decoupled flows — (1) Upload & extraction in a new Propostas tab with a `proposal-pipeline` container skill, storing results in `ob_propostas` + `ob_proposta_items`; (2) Import from the Planilha tab via a new dialog that maps proposal items to L1→L2→L3 budget items with `fonte = "cotacao"` and costs pre-filled.

**Tech Stack:** React + TypeScript, Shadcn UI, TanStack Query, Supabase (Postgres + Storage + RLS), Zod, Gemini 2.5 Pro (LLM vision), Bun

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260408000001_propostas.sql` | Create `ob_propostas` and `ob_proposta_items` tables with RLS |
| `frontend/src/hooks/usePropostas.ts` | React Query hooks for propostas CRUD |
| `frontend/src/components/workspace/PropostasTab.tsx` | Tab container for propostas workflow |
| `frontend/src/components/propostas/PropostaUploader.tsx` | Drag-drop PDF upload (proposal type) |
| `frontend/src/components/propostas/PropostaList.tsx` | List of proposals with status badges |
| `frontend/src/components/propostas/PropostaItemsTable.tsx` | Editable table for reviewing extracted items |
| `frontend/src/components/planilha/ImportPropostas.tsx` | Dialog for importing proposals into budget |
| `container/skills/proposal-pipeline/src/index.ts` | Pipeline orchestrator |
| `container/skills/proposal-pipeline/src/types.ts` | Zod schemas and TypeScript types |
| `container/skills/proposal-pipeline/src/extraction.ts` | PDF text + vision extraction |
| `container/skills/proposal-pipeline/src/supabase.ts` | Supabase client operations |
| `container/skills/proposal-pipeline/package.json` | Package manifest |
| `container/skills/proposal-pipeline/tsconfig.json` | TypeScript config |

### Modified files

| File | Change |
|------|--------|
| `frontend/src/contexts/ProjectContext.tsx:4` | Add `"propostas"` to `WorkspaceTab` union |
| `frontend/src/components/workspace/WorkspaceTabs.tsx:5-11` | Add propostas tab entry to TABS array |
| `frontend/src/pages/ProjectPage.tsx:8-12,128-132` | Import and render PropostasTab |
| `frontend/src/types/orcamento.ts` | Add `Proposta` and `PropostaItem` types |
| `frontend/src/components/planilha/BudgetToolbar.tsx:13-21,98-104` | Add `onImportPropostas` prop and button |
| `frontend/src/components/planilha/BudgetTable.tsx:530-575,625-678` | Wire ImportPropostas dialog |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260408000001_propostas.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260408000001_propostas.sql

-- Propostas (supplier proposals)
CREATE TABLE ob_propostas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES ob_projects(id) ON DELETE CASCADE NOT NULL,
  file_id uuid REFERENCES ob_project_files(id) ON DELETE SET NULL,
  fornecedor text NOT NULL DEFAULT '',
  valor_total numeric(14,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'extracted', 'reviewed')),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_propostas_project ON ob_propostas(project_id);

ALTER TABLE ob_propostas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read propostas for their org projects"
  ON ob_propostas FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM ob_projects WHERE org_id IN (
        SELECT org_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert propostas for their org projects"
  ON ob_propostas FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM ob_projects WHERE org_id IN (
        SELECT org_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update propostas for their org projects"
  ON ob_propostas FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM ob_projects WHERE org_id IN (
        SELECT org_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete propostas for their org projects"
  ON ob_propostas FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM ob_projects WHERE org_id IN (
        SELECT org_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

-- Proposta items (extracted line items)
CREATE TABLE ob_proposta_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  proposta_id uuid REFERENCES ob_propostas(id) ON DELETE CASCADE NOT NULL,
  descricao text NOT NULL DEFAULT '',
  unidade text,
  quantidade numeric(14,4),
  preco_unitario numeric(14,2),
  preco_total numeric(14,2),
  confidence numeric(3,2) DEFAULT 0,
  needs_review boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_proposta_items_proposta ON ob_proposta_items(proposta_id);

ALTER TABLE ob_proposta_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read proposta items via proposta"
  ON ob_proposta_items FOR SELECT
  USING (
    proposta_id IN (
      SELECT id FROM ob_propostas WHERE project_id IN (
        SELECT id FROM ob_projects WHERE org_id IN (
          SELECT org_id FROM profiles WHERE id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users can insert proposta items via proposta"
  ON ob_proposta_items FOR INSERT
  WITH CHECK (
    proposta_id IN (
      SELECT id FROM ob_propostas WHERE project_id IN (
        SELECT id FROM ob_projects WHERE org_id IN (
          SELECT org_id FROM profiles WHERE id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users can update proposta items via proposta"
  ON ob_proposta_items FOR UPDATE
  USING (
    proposta_id IN (
      SELECT id FROM ob_propostas WHERE project_id IN (
        SELECT id FROM ob_projects WHERE org_id IN (
          SELECT org_id FROM profiles WHERE id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users can delete proposta items via proposta"
  ON ob_proposta_items FOR DELETE
  USING (
    proposta_id IN (
      SELECT id FROM ob_propostas WHERE project_id IN (
        SELECT id FROM ob_projects WHERE org_id IN (
          SELECT org_id FROM profiles WHERE id = auth.uid()
        )
      )
    )
  );

-- Add 'proposta' as valid disciplina for ob_project_files
-- (The column uses text type, so no enum change needed —
--  just document that 'proposta' is now a valid value)
```

- [ ] **Step 2: Apply the migration locally**

Run: `supabase db push` or `supabase migration up`
Expected: Tables `ob_propostas` and `ob_proposta_items` created with RLS enabled.

- [ ] **Step 3: Regenerate Supabase types**

Run: `supabase gen types typescript --local > frontend/src/types/database.ts`
Expected: `database.ts` now includes `ob_propostas` and `ob_proposta_items` table types.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260408000001_propostas.sql frontend/src/types/database.ts
git commit -m "feat: add ob_propostas and ob_proposta_items tables with RLS"
```

---

## Task 2: Frontend Types

**Files:**
- Modify: `frontend/src/types/orcamento.ts`

- [ ] **Step 1: Add Proposta and PropostaItem types**

Add after line 14 (after `SinapiComposicao` type):

```typescript
export type Proposta = Database["public"]["Tables"]["ob_propostas"]["Row"];
export type PropostaInsert = Database["public"]["Tables"]["ob_propostas"]["Insert"];
export type PropostaItem = Database["public"]["Tables"]["ob_proposta_items"]["Row"];
export type PropostaItemInsert = Database["public"]["Tables"]["ob_proposta_items"]["Insert"];
export type PropostaItemUpdate = Database["public"]["Tables"]["ob_proposta_items"]["Update"];
```

- [ ] **Step 2: Verify types compile**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/orcamento.ts
git commit -m "feat: add Proposta and PropostaItem frontend types"
```

---

## Task 3: Propostas Hooks

**Files:**
- Create: `frontend/src/hooks/usePropostas.ts`

- [ ] **Step 1: Create the hooks file**

```typescript
// frontend/src/hooks/usePropostas.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  Proposta,
  PropostaInsert,
  PropostaItem,
  PropostaItemInsert,
  PropostaItemUpdate,
} from "@/types/orcamento";

export function usePropostas(projectId: string) {
  return useQuery({
    queryKey: ["propostas", projectId],
    queryFn: async (): Promise<Proposta[]> => {
      const { data, error } = await supabase
        .from("ob_propostas")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });
}

export function usePropostaItems(propostaId: string | null) {
  return useQuery({
    queryKey: ["proposta-items", propostaId],
    queryFn: async (): Promise<PropostaItem[]> => {
      const { data, error } = await supabase
        .from("ob_proposta_items")
        .select("*")
        .eq("proposta_id", propostaId!)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!propostaId,
  });
}

export function useCreateProposta() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (proposta: PropostaInsert) => {
      const { data, error } = await supabase
        .from("ob_propostas")
        .insert(proposta)
        .select()
        .single();

      if (error) throw error;
      return data as Proposta;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["propostas", data.project_id] });
    },
  });
}

export function useUpdatePropostaStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status, projectId }: { id: string; status: string; projectId: string }) => {
      const { error } = await supabase
        .from("ob_propostas")
        .update({ status })
        .eq("id", id);

      if (error) throw error;
      return { projectId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["propostas", data.projectId] });
    },
  });
}

export function useUpdatePropostaItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, propostaId, ...updates }: { id: string; propostaId: string } & PropostaItemUpdate) => {
      const { data, error } = await supabase
        .from("ob_proposta_items")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return { ...data, propostaId } as PropostaItem & { propostaId: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["proposta-items", (data as PropostaItem & { propostaId: string }).propostaId] });
    },
  });
}

export function useDeletePropostaItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, propostaId }: { id: string; propostaId: string }) => {
      const { error } = await supabase
        .from("ob_proposta_items")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return { propostaId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["proposta-items", data.propostaId] });
    },
  });
}

/** Fetch all proposals with status 'extracted' or 'reviewed' for import dialog */
export function useImportablePropostas(projectId: string) {
  return useQuery({
    queryKey: ["propostas-importable", projectId],
    queryFn: async (): Promise<(Proposta & { items: PropostaItem[] })[]> => {
      const { data: propostas, error } = await supabase
        .from("ob_propostas")
        .select("*, ob_proposta_items(*)")
        .eq("project_id", projectId)
        .in("status", ["extracted", "reviewed"])
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (propostas ?? []).map((p: Record<string, unknown>) => ({
        ...(p as Proposta),
        items: (p.ob_proposta_items ?? []) as PropostaItem[],
      }));
    },
    enabled: !!projectId,
  });
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/usePropostas.ts
git commit -m "feat: add usePropostas hooks for CRUD and import queries"
```

---

## Task 4: Add Propostas Tab to Workspace

**Files:**
- Modify: `frontend/src/contexts/ProjectContext.tsx:4`
- Modify: `frontend/src/components/workspace/WorkspaceTabs.tsx:5-11`
- Create: `frontend/src/components/workspace/PropostasTab.tsx`
- Modify: `frontend/src/pages/ProjectPage.tsx:8-12,128-132`

- [ ] **Step 1: Add "propostas" to WorkspaceTab type**

In `frontend/src/contexts/ProjectContext.tsx`, change line 4:

```typescript
// Before
type WorkspaceTab = "planilha" | "pdfs" | "quantitativos" | "premissas" | "curva-abc";

// After
type WorkspaceTab = "planilha" | "pdfs" | "quantitativos" | "propostas" | "premissas" | "curva-abc";
```

- [ ] **Step 2: Add tab entry to WorkspaceTabs**

In `frontend/src/components/workspace/WorkspaceTabs.tsx`, add the import and tab entry:

```typescript
// Add to imports (line 3)
import { Table2, FileText, Calculator, Settings2, BarChart3, Receipt } from "lucide-react";

// Add to TABS array after "quantitativos" entry (between lines 8-9)
  { value: "propostas" as const, label: "Propostas", icon: Receipt },
```

- [ ] **Step 3: Create the PropostasTab placeholder**

```typescript
// frontend/src/components/workspace/PropostasTab.tsx
import { useProjectContext } from "@/contexts/ProjectContext";

export function PropostasTab() {
  const { project } = useProjectContext();

  if (!project) return null;

  return (
    <div className="h-full p-6">
      <p className="text-muted-foreground">Propostas tab — coming soon</p>
    </div>
  );
}
```

- [ ] **Step 4: Wire PropostasTab into ProjectPage**

In `frontend/src/pages/ProjectPage.tsx`:

Add import (after line 12):
```typescript
import { PropostasTab } from "@/components/workspace/PropostasTab";
```

Add render (after line 130, the quantitativos line):
```typescript
          {activeTab === "propostas" && <PropostasTab />}
```

- [ ] **Step 5: Verify the app compiles**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No type errors. Propostas tab appears in the UI.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/contexts/ProjectContext.tsx frontend/src/components/workspace/WorkspaceTabs.tsx frontend/src/components/workspace/PropostasTab.tsx frontend/src/pages/ProjectPage.tsx
git commit -m "feat: add Propostas tab to workspace navigation"
```

---

## Task 5: Proposta Uploader Component

**Files:**
- Create: `frontend/src/components/propostas/PropostaUploader.tsx`

- [ ] **Step 1: Create the uploader component**

Follows the same pattern as `PdfUploader.tsx` but uploads with `disciplina = "proposta"` and creates an `ob_propostas` record after the file upload.

```typescript
// frontend/src/components/propostas/PropostaUploader.tsx
import { useCallback, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadPdf } from "@/hooks/usePdfJobs";
import { useCreateProposta } from "@/hooks/usePropostas";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PropostaUploaderProps {
  projectId: string;
}

export function PropostaUploader({ projectId }: PropostaUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const uploadPdf = useUploadPdf();
  const createProposta = useCreateProposta();

  const handleFiles = useCallback(
    async (files: FileList) => {
      const pdfFiles = Array.from(files).filter(
        (f) => f.name.toLowerCase().endsWith(".pdf")
      );

      if (pdfFiles.length === 0) {
        toast.error("Selecione arquivos PDF de propostas");
        return;
      }

      for (const file of pdfFiles) {
        try {
          const fileRecord = await uploadPdf.mutateAsync({
            projectId,
            file,
            disciplina: "proposta",
            fileType: "pdf",
          });

          await createProposta.mutateAsync({
            project_id: projectId,
            file_id: fileRecord.id,
            fornecedor: file.name.replace(/\.pdf$/i, ""),
            status: "pending",
          });

          toast.success(`${file.name} enviado para extração`);
        } catch {
          toast.error(`Erro ao enviar ${file.name}`);
        }
      }
    },
    [projectId, uploadPdf, createProposta]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors",
        dragOver
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
      )}
    >
      <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">
        Arraste PDFs de propostas aqui
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Propostas comerciais de fornecedores
      </p>
      <input
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        id="proposta-upload-input"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
        }}
      />
      <Button
        variant="outline"
        className="mt-3"
        onClick={() => document.getElementById("proposta-upload-input")?.click()}
        disabled={uploadPdf.isPending}
      >
        <FileText className="mr-2 h-4 w-4" />
        {uploadPdf.isPending ? "Enviando..." : "Selecionar PDFs"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/propostas/PropostaUploader.tsx
git commit -m "feat: add PropostaUploader component with drag-drop"
```

---

## Task 6: Proposta List Component

**Files:**
- Create: `frontend/src/components/propostas/PropostaList.tsx`

- [ ] **Step 1: Create the list component**

```typescript
// frontend/src/components/propostas/PropostaList.tsx
import { usePropostas } from "@/hooks/usePropostas";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Proposta } from "@/types/orcamento";

interface PropostaListProps {
  projectId: string;
  selectedId: string | null;
  onSelect: (proposta: Proposta) => void;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  pending: { label: "Processando", variant: "secondary" },
  extracted: { label: "Extraído", variant: "outline" },
  reviewed: { label: "Revisado", variant: "default" },
};

export function PropostaList({ projectId, selectedId, onSelect }: PropostaListProps) {
  const { data: propostas, isLoading } = usePropostas(projectId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!propostas || propostas.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhuma proposta enviada ainda.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {propostas.map((p) => {
        const status = STATUS_LABELS[p.status] ?? STATUS_LABELS.pending;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/30 ${
              selectedId === p.id ? "border-primary bg-accent/20" : "border-transparent"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{p.fornecedor || "Sem nome"}</span>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            {p.valor_total != null && (
              <p className="mt-1 text-xs text-muted-foreground">
                Total: R$ {p.valor_total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(p.created_at).toLocaleDateString("pt-BR")}
            </p>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/propostas/PropostaList.tsx
git commit -m "feat: add PropostaList component with status badges"
```

---

## Task 7: Proposta Items Editable Table

**Files:**
- Create: `frontend/src/components/propostas/PropostaItemsTable.tsx`

- [ ] **Step 1: Create the editable table component**

```typescript
// frontend/src/components/propostas/PropostaItemsTable.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Check, AlertTriangle } from "lucide-react";
import { usePropostaItems, useUpdatePropostaItem, useDeletePropostaItem, useUpdatePropostaStatus } from "@/hooks/usePropostas";
import { toast } from "sonner";
import type { PropostaItem } from "@/types/orcamento";

interface PropostaItemsTableProps {
  propostaId: string;
  propostaStatus: string;
  projectId: string;
  fornecedor: string;
}

export function PropostaItemsTable({ propostaId, propostaStatus, projectId, fornecedor }: PropostaItemsTableProps) {
  const { data: items, isLoading } = usePropostaItems(propostaId);
  const updateItem = useUpdatePropostaItem();
  const deleteItem = useDeletePropostaItem();
  const updateStatus = useUpdatePropostaStatus();
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (item: PropostaItem, field: keyof PropostaItem) => {
    setEditingCell({ id: item.id, field });
    setEditValue(String(item[field] ?? ""));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;

    const numericFields = ["quantidade", "preco_unitario", "preco_total"];
    const value = numericFields.includes(field)
      ? parseFloat(editValue.replace(",", ".")) || null
      : editValue;

    updateItem.mutate(
      { id, propostaId, [field]: value },
      { onError: () => toast.error("Erro ao salvar") }
    );
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditingCell(null);
  };

  const handleDelete = (id: string) => {
    deleteItem.mutate(
      { id, propostaId },
      { onSuccess: () => toast.success("Item removido") }
    );
  };

  const handleMarkReviewed = () => {
    updateStatus.mutate(
      { id: propostaId, status: "reviewed", projectId },
      { onSuccess: () => toast.success("Proposta marcada como revisada") }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {propostaStatus === "pending"
          ? "Aguardando extração..."
          : "Nenhum item extraído."}
      </p>
    );
  }

  const renderCell = (item: PropostaItem, field: keyof PropostaItem, align: string = "left") => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;

    if (isEditing) {
      return (
        <Input
          autoFocus
          className="h-7 text-sm"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
        />
      );
    }

    const value = item[field];
    const displayValue =
      typeof value === "number"
        ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })
        : (value ?? "—");

    return (
      <span
        className={`cursor-pointer hover:underline text-${align}`}
        onClick={() => startEdit(item, field)}
      >
        {displayValue}
      </span>
    );
  };

  const total = items.reduce((sum, i) => sum + (i.preco_total ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">{fornecedor}</h3>
          <p className="text-xs text-muted-foreground">
            {items.length} itens — Total: R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </p>
        </div>
        {propostaStatus === "extracted" && (
          <Button size="sm" onClick={handleMarkReviewed}>
            <Check className="mr-1 h-3 w-3" />
            Marcar como Revisado
          </Button>
        )}
      </div>

      <ScrollArea className="max-h-[500px]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs font-medium text-muted-foreground">
              <th className="px-2 py-2 text-left">Descrição</th>
              <th className="w-16 px-2 py-2 text-center">Und</th>
              <th className="w-20 px-2 py-2 text-right">Qtde</th>
              <th className="w-24 px-2 py-2 text-right">P. Unit.</th>
              <th className="w-24 px-2 py-2 text-right">P. Total</th>
              <th className="w-8 px-2 py-2 text-center">Conf.</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={`border-b transition-colors hover:bg-accent/20 ${
                  item.needs_review ? "bg-yellow-500/5" : ""
                }`}
              >
                <td className="px-2 py-1.5">{renderCell(item, "descricao")}</td>
                <td className="px-2 py-1.5 text-center">{renderCell(item, "unidade")}</td>
                <td className="px-2 py-1.5 text-right">{renderCell(item, "quantidade", "right")}</td>
                <td className="px-2 py-1.5 text-right">{renderCell(item, "preco_unitario", "right")}</td>
                <td className="px-2 py-1.5 text-right">{renderCell(item, "preco_total", "right")}</td>
                <td className="px-2 py-1.5 text-center">
                  {item.needs_review ? (
                    <AlertTriangle className="mx-auto h-3.5 w-3.5 text-yellow-500" />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {((item.confidence ?? 0) * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/propostas/PropostaItemsTable.tsx
git commit -m "feat: add PropostaItemsTable with inline editing"
```

---

## Task 8: Wire Up PropostasTab

**Files:**
- Modify: `frontend/src/components/workspace/PropostasTab.tsx`

- [ ] **Step 1: Replace placeholder with full implementation**

```typescript
// frontend/src/components/workspace/PropostasTab.tsx
import { useState } from "react";
import { useProjectContext } from "@/contexts/ProjectContext";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { PropostaUploader } from "@/components/propostas/PropostaUploader";
import { PropostaList } from "@/components/propostas/PropostaList";
import { PropostaItemsTable } from "@/components/propostas/PropostaItemsTable";
import type { Proposta } from "@/types/orcamento";

export function PropostasTab() {
  const { project } = useProjectContext();
  const [selected, setSelected] = useState<Proposta | null>(null);

  useRealtimeSubscription({
    table: "ob_propostas",
    filterColumn: "project_id",
    filterValue: project?.id,
    queryKeys: [["propostas", project?.id ?? ""]],
    enabled: !!project?.id,
  });

  if (!project) return null;

  return (
    <div className="flex h-full">
      {/* Left panel: upload + list */}
      <div className="w-80 shrink-0 border-r p-4 space-y-4 overflow-auto">
        <PropostaUploader projectId={project.id} />
        <PropostaList
          projectId={project.id}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
      </div>

      {/* Right panel: items table */}
      <div className="flex-1 p-4 overflow-auto">
        {selected ? (
          <PropostaItemsTable
            propostaId={selected.id}
            propostaStatus={selected.status}
            projectId={project.id}
            fornecedor={selected.fornecedor}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Selecione uma proposta para ver os itens extraídos
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/workspace/PropostasTab.tsx
git commit -m "feat: wire PropostasTab with uploader, list, and items table"
```

---

## Task 9: Import Propostas Dialog

**Files:**
- Create: `frontend/src/components/planilha/ImportPropostas.tsx`

- [ ] **Step 1: Create the import dialog**

Follows the same pattern as `ImportQuantitativos.tsx` but sources from `ob_propostas` + `ob_proposta_items` and maps `preco_unitario` → `custo_unitario` with `fonte = "cotacao"`.

```typescript
// frontend/src/components/planilha/ImportPropostas.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useImportablePropostas } from "@/hooks/usePropostas";
import { toast } from "sonner";
import type { OrcamentoItem } from "@/types/orcamento";

interface ImportPropostasProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  existingItems: OrcamentoItem[];
  onImport: (items: Array<{
    eap_code: string;
    eap_level: number;
    descricao: string;
    unidade: string | null;
    quantidade: number | null;
    custo_unitario: number | null;
    custo_total: number | null;
    fonte: string | null;
  }>) => void;
}

export function ImportPropostas({
  open,
  onOpenChange,
  projectId,
  existingItems,
  onImport,
}: ImportPropostasProps) {
  const { data: propostas, isLoading } = useImportablePropostas(projectId);
  const [selectedPropostaId, setSelectedPropostaId] = useState<string | null>(null);
  const [targetEtapa, setTargetEtapa] = useState<string>("__new__");
  const [newEtapaName, setNewEtapaName] = useState("");

  const level1Items = existingItems.filter((i) => i.eap_level === 1);
  const selectedProposta = propostas?.find((p) => p.id === selectedPropostaId);

  function handleImport() {
    if (!selectedProposta || selectedProposta.items.length === 0) return;

    const propItems = selectedProposta.items;
    const toCreate: Array<{
      eap_code: string;
      eap_level: number;
      descricao: string;
      unidade: string | null;
      quantidade: number | null;
      custo_unitario: number | null;
      custo_total: number | null;
      fonte: string | null;
    }> = [];

    let l1Code: string;

    if (targetEtapa === "__new__") {
      const maxNum = level1Items.reduce((max, i) => {
        const num = parseInt(i.eap_code, 10);
        return num > max ? num : max;
      }, 0);
      l1Code = String(maxNum + 1).padStart(2, "0");

      const etapaName = newEtapaName.trim() || `Prop. ${selectedProposta.fornecedor}`;

      toCreate.push({
        eap_code: l1Code,
        eap_level: 1,
        descricao: etapaName,
        unidade: null,
        quantidade: null,
        custo_unitario: null,
        custo_total: null,
        fonte: null,
      });

      const l2Code = `${l1Code}.01`;
      toCreate.push({
        eap_code: l2Code,
        eap_level: 2,
        descricao: "Itens da Proposta",
        unidade: null,
        quantidade: null,
        custo_unitario: null,
        custo_total: null,
        fonte: null,
      });

      propItems.forEach((item, idx) => {
        const l3Code = `${l2Code}.${String(idx + 1).padStart(3, "0")}`;
        toCreate.push({
          eap_code: l3Code,
          eap_level: 3,
          descricao: item.descricao,
          unidade: item.unidade,
          quantidade: item.quantidade,
          custo_unitario: item.preco_unitario,
          custo_total: item.preco_total,
          fonte: "cotacao",
        });
      });
    } else {
      l1Code = targetEtapa;

      const l2Children = existingItems.filter(
        (i) => i.eap_level === 2 && i.eap_code.startsWith(l1Code + ".")
      );

      if (l2Children.length > 0) {
        const lastL2 = l2Children.sort((a, b) =>
          a.eap_code.localeCompare(b.eap_code)
        )[l2Children.length - 1];
        const l2Code = lastL2.eap_code;

        const l3Children = existingItems.filter(
          (i) => i.eap_level === 3 && i.eap_code.startsWith(l2Code + ".")
        );
        const maxL3 = l3Children.reduce((max, i) => {
          const num = parseInt(i.eap_code.split(".")[2], 10);
          return num > max ? num : max;
        }, 0);

        propItems.forEach((item, idx) => {
          const l3Code = `${l2Code}.${String(maxL3 + idx + 1).padStart(3, "0")}`;
          toCreate.push({
            eap_code: l3Code,
            eap_level: 3,
            descricao: item.descricao,
            unidade: item.unidade,
            quantidade: item.quantidade,
            custo_unitario: item.preco_unitario,
            custo_total: item.preco_total,
            fonte: "cotacao",
          });
        });
      } else {
        const l2Code = `${l1Code}.01`;
        toCreate.push({
          eap_code: l2Code,
          eap_level: 2,
          descricao: "Itens da Proposta",
          unidade: null,
          quantidade: null,
          custo_unitario: null,
          custo_total: null,
          fonte: null,
        });

        propItems.forEach((item, idx) => {
          const l3Code = `${l2Code}.${String(idx + 1).padStart(3, "0")}`;
          toCreate.push({
            eap_code: l3Code,
            eap_level: 3,
            descricao: item.descricao,
            unidade: item.unidade,
            quantidade: item.quantidade,
            custo_unitario: item.preco_unitario,
            custo_total: item.preco_total,
            fonte: "cotacao",
          });
        });
      }
    }

    onImport(toCreate);
    setSelectedPropostaId(null);
    setTargetEtapa("__new__");
    setNewEtapaName("");
    onOpenChange(false);
    toast.success(`${propItems.length} item(ns) da proposta importado(s)`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar Proposta</DialogTitle>
          <DialogDescription>
            Selecione uma proposta e a etapa destino na planilha.
          </DialogDescription>
        </DialogHeader>

        {/* Proposta selector */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Proposta:</label>
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !propostas || propostas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma proposta disponível. Envie e extraia propostas na aba Propostas primeiro.
            </p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-auto">
              {propostas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPropostaId(p.id)}
                  className={`w-full rounded border p-2 text-left text-sm transition-colors hover:bg-accent/30 ${
                    selectedPropostaId === p.id ? "border-primary bg-accent/20" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{p.fornecedor || "Sem nome"}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={p.status === "reviewed" ? "default" : "outline"}>
                        {p.status === "reviewed" ? "Revisado" : "Extraído"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{p.items.length} itens</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Items preview */}
        {selectedProposta && selectedProposta.items.length > 0 && (
          <ScrollArea className="max-h-[250px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs font-medium text-muted-foreground">
                  <th className="px-2 py-2 text-left">Descrição</th>
                  <th className="w-14 px-2 py-2 text-center">Und</th>
                  <th className="w-18 px-2 py-2 text-right">Qtde</th>
                  <th className="w-24 px-2 py-2 text-right">P. Unit.</th>
                  <th className="w-24 px-2 py-2 text-right">P. Total</th>
                </tr>
              </thead>
              <tbody>
                {selectedProposta.items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-2 py-1.5">{item.descricao}</td>
                    <td className="px-2 py-1.5 text-center">{item.unidade}</td>
                    <td className="px-2 py-1.5 text-right">
                      {item.quantidade?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {item.preco_unitario?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {item.preco_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}

        {/* Target etapa selector */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <label className="text-sm font-medium whitespace-nowrap">Etapa destino:</label>
          <Select value={targetEtapa} onValueChange={setTargetEtapa}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Selecione a etapa..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__new__">+ Criar nova etapa</SelectItem>
              {level1Items.map((item) => (
                <SelectItem key={item.eap_code} value={item.eap_code}>
                  {item.eap_code} — {item.descricao}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targetEtapa === "__new__" && (
            <Input
              placeholder={selectedProposta ? `Prop. ${selectedProposta.fornecedor}` : "Nome da etapa..."}
              className="flex-1"
              value={newEtapaName}
              onChange={(e) => setNewEtapaName(e.target.value)}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={!selectedProposta || selectedProposta.items.length === 0}
          >
            Importar {selectedProposta?.items.length ?? 0} itens
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/planilha/ImportPropostas.tsx
git commit -m "feat: add ImportPropostas dialog for budget import"
```

---

## Task 10: Wire Import Button into Planilha

**Files:**
- Modify: `frontend/src/components/planilha/BudgetToolbar.tsx:13-21,98-104`
- Modify: `frontend/src/components/planilha/BudgetTable.tsx:530-575,625-678`

- [ ] **Step 1: Add onImportPropostas prop to BudgetToolbar**

In `frontend/src/components/planilha/BudgetToolbar.tsx`:

Add to `BudgetToolbarProps` interface (after line 19):
```typescript
  onImportPropostas?: () => void;
```

Add to destructured props (after `onUndo`):
```typescript
  onImportPropostas,
```

Add button after the "Importar Quantitativos" block (after line 104, before `{/* Undo */}`):
```typescript
      {/* Import Propostas */}
      {onImportPropostas && (
        <Button variant="outline" size="sm" onClick={onImportPropostas}>
          <Upload className="mr-1 h-3 w-3" />
          Importar Proposta
        </Button>
      )}
```

- [ ] **Step 2: Wire ImportPropostas dialog into BudgetTable**

In `frontend/src/components/planilha/BudgetTable.tsx`:

Add import at top (after the ImportQuantitativos import):
```typescript
import { ImportPropostas } from "./ImportPropostas";
```

Add state (near the existing `importOpen` state):
```typescript
const [importPropostasOpen, setImportPropostasOpen] = useState(false);
```

Add handler (after the `handleImportQuantitativos` callback, around line 575):
```typescript
  // ─── Import Propostas ──────────────────────────────────────
  const handleImportPropostas = useCallback(
    (
      importItems: Array<{
        eap_code: string;
        eap_level: number;
        descricao: string;
        unidade: string | null;
        quantidade: number | null;
        custo_unitario: number | null;
        custo_total: number | null;
        fonte: string | null;
      }>
    ) => {
      const inserts = importItems.map((item) => ({
        project_id: projectId,
        eap_code: item.eap_code,
        eap_level: item.eap_level,
        descricao: item.descricao,
        unidade: item.unidade,
        quantidade: item.quantidade,
        fonte: item.fonte,
        fonte_codigo: null,
        fonte_data_base: null,
        custo_unitario: item.custo_unitario,
        custo_material: item.eap_level === 1 ? null : (item.custo_total ?? 0),
        custo_mao_obra: item.eap_level === 1 ? null : 0,
        custo_total: item.eap_level === 1 ? null : (item.custo_total ?? 0),
        adm_percentual: 12,
        peso_percentual: null,
        curva_abc_classe: null,
        quantitativo_id: null,
      }));

      bulkCreate.mutate(
        { items: inserts },
        {
          onSuccess: (data) => {
            for (const created of data) {
              undoStack.push({
                type: "create",
                table: "ob_orcamento_items",
                itemId: created.id,
              });
            }
          },
        }
      );
    },
    [projectId, bulkCreate, undoStack]
  );
```

Add `onImportPropostas` prop to `BudgetToolbar` render (around line 635):
```typescript
        onImportPropostas={() => setImportPropostasOpen(true)}
```

Add `ImportPropostas` dialog render (after the `ImportQuantitativos` component, around line 675):
```typescript
      {/* Import Propostas Modal */}
      <ImportPropostas
        open={importPropostasOpen}
        onOpenChange={setImportPropostasOpen}
        projectId={projectId}
        existingItems={items ?? []}
        onImport={handleImportPropostas}
      />
```

- [ ] **Step 3: Verify compile**

Run: `cd frontend && bun run tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/planilha/BudgetToolbar.tsx frontend/src/components/planilha/BudgetTable.tsx
git commit -m "feat: wire ImportPropostas button and dialog into planilha"
```

---

## Task 11: Proposal Pipeline — Types and Supabase

**Files:**
- Create: `container/skills/proposal-pipeline/package.json`
- Create: `container/skills/proposal-pipeline/tsconfig.json`
- Create: `container/skills/proposal-pipeline/src/types.ts`
- Create: `container/skills/proposal-pipeline/src/supabase.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "proposal-pipeline",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

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
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create types.ts**

```typescript
// container/skills/proposal-pipeline/src/types.ts
import { z } from "zod";

export const ProposalItemSchema = z.object({
  descricao: z.string(),
  unidade: z.string().nullable(),
  quantidade: z.number().nullable(),
  preco_unitario: z.number().nullable(),
  preco_total: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
});
export type ProposalItem = z.infer<typeof ProposalItemSchema>;

export const ProposalOutputSchema = z.object({
  fornecedor: z.string(),
  items: z.array(ProposalItemSchema),
});
export type ProposalOutput = z.infer<typeof ProposalOutputSchema>;

export type JobStatus = "pending" | "processing" | "done" | "error";

export type JobStage =
  | "pending"
  | "ingestion"
  | "extraction"
  | "structured_output"
  | "done"
  | "error";

export interface PdfJob {
  id: string;
  file_id: string;
  project_id: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export const CONFIDENCE_THRESHOLD = 0.7;
```

- [ ] **Step 4: Create supabase.ts**

```typescript
// container/skills/proposal-pipeline/src/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PdfJob, ProposalItem } from "./types.js";

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

export function setSupabase(sb: SupabaseClient): void {
  client = sb;
}

export async function getJob(jobId: string): Promise<PdfJob> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_pdf_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(`Failed to fetch job ${jobId}: ${error.message}`);
  return data as PdfJob;
}

export async function updateJob(
  jobId: string,
  updates: Partial<Pick<PdfJob, "status" | "stage" | "progress" | "error_message" | "started_at" | "completed_at">>
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("ob_pdf_jobs").update(updates).eq("id", jobId);
  if (error) throw new Error(`Failed to update job ${jobId}: ${error.message}`);
}

export async function getFileStoragePath(fileId: string): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_project_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();
  if (error) throw new Error(`Failed to fetch file ${fileId}: ${error.message}`);
  return data.storage_path;
}

export async function downloadPdf(storagePath: string, localPath: string): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from("project-pdfs")
    .download(storagePath);
  if (error) throw new Error(`Failed to download ${storagePath}: ${error.message}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  const { writeFile } = await import("node:fs/promises");
  await writeFile(localPath, buffer);
}

export async function getPropostaByFileId(fileId: string): Promise<{ id: string; project_id: string }> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ob_propostas")
    .select("id, project_id")
    .eq("file_id", fileId)
    .single();
  if (error) throw new Error(`No proposta found for file ${fileId}: ${error.message}`);
  return data;
}

export async function upsertPropostaItems(
  propostaId: string,
  items: ProposalItem[]
): Promise<void> {
  const sb = getSupabase();

  // Clear existing items and insert fresh
  await sb.from("ob_proposta_items").delete().eq("proposta_id", propostaId);

  if (items.length === 0) return;

  const rows = items.map((item) => ({
    proposta_id: propostaId,
    descricao: item.descricao,
    unidade: item.unidade,
    quantidade: item.quantidade,
    preco_unitario: item.preco_unitario,
    preco_total: item.preco_total,
    confidence: item.confidence,
    needs_review: item.needs_review,
  }));

  const { error } = await sb.from("ob_proposta_items").insert(rows);
  if (error) throw new Error(`Failed to insert proposta items: ${error.message}`);
}

export async function updatePropostaAfterExtraction(
  propostaId: string,
  fornecedor: string,
  valorTotal: number
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("ob_propostas")
    .update({
      fornecedor,
      valor_total: valorTotal,
      status: "extracted",
    })
    .eq("id", propostaId);
  if (error) throw new Error(`Failed to update proposta: ${error.message}`);
}
```

- [ ] **Step 5: Install dependencies**

Run: `cd container/skills/proposal-pipeline && bun install`
Expected: Dependencies installed.

- [ ] **Step 6: Commit**

```bash
git add container/skills/proposal-pipeline/
git commit -m "feat: add proposal-pipeline types and supabase client"
```

---

## Task 12: Proposal Pipeline — Extraction and Orchestrator

**Files:**
- Create: `container/skills/proposal-pipeline/src/extraction.ts`
- Create: `container/skills/proposal-pipeline/src/index.ts`

- [ ] **Step 1: Create extraction.ts**

This module extracts text from the PDF and uses Gemini 2.5 Pro with vision to identify supplier items.

```typescript
// container/skills/proposal-pipeline/src/extraction.ts
import { readFile } from "node:fs/promises";
import { ProposalOutputSchema, CONFIDENCE_THRESHOLD, type ProposalOutput } from "./types.js";

/**
 * Extract proposal items from a PDF using LLM vision.
 * Sends each page as an image + the raw text to Gemini for structured extraction.
 */
export async function extractProposalItems(
  pdfPath: string,
  textContent: string
): Promise<ProposalOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const pdfBuffer = await readFile(pdfPath);
  const pdfBase64 = pdfBuffer.toString("base64");

  const prompt = `Analise este PDF de proposta comercial de fornecedor para construção civil.
Extraia TODOS os itens de fornecimento encontrados.

Para cada item, extraia:
- descricao: descrição do item/serviço
- unidade: unidade de medida (un, m², m³, m, kg, vb, etc.)
- quantidade: quantidade
- preco_unitario: preço unitário em reais
- preco_total: preço total em reais (quantidade × preço unitário)
- confidence: sua confiança na extração (0.0 a 1.0)
- needs_review: true se algum campo estiver incerto

Também identifique o nome do fornecedor.

IMPORTANTE:
- Valores monetários devem ser números (sem R$, sem pontos de milhar)
- Use ponto como separador decimal
- Se um campo não estiver claro, defina confidence < 0.7 e needs_review = true
- Extraia TODOS os itens, mesmo que com baixa confiança

Responda APENAS com JSON válido no formato:
{
  "fornecedor": "Nome do Fornecedor",
  "items": [
    {
      "descricao": "...",
      "unidade": "...",
      "quantidade": 0,
      "preco_unitario": 0,
      "preco_total": 0,
      "confidence": 0.0,
      "needs_review": false
    }
  ]
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: pdfBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${text.slice(0, 500)}`);
  }

  const result = await response.json();
  const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error("Empty response from Gemini");
  }

  const parsed = JSON.parse(content);
  const validated = ProposalOutputSchema.parse(parsed);

  // Flag low-confidence items
  for (const item of validated.items) {
    if (item.confidence < CONFIDENCE_THRESHOLD) {
      item.needs_review = true;
    }
  }

  return validated;
}
```

- [ ] **Step 2: Create index.ts (pipeline orchestrator)**

```typescript
// container/skills/proposal-pipeline/src/index.ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getJob,
  updateJob,
  downloadPdf,
  getFileStoragePath,
  getPropostaByFileId,
  upsertPropostaItems,
  updatePropostaAfterExtraction,
} from "./supabase.js";
import { extractProposalItems } from "./extraction.js";
import type { JobStage } from "./types.js";

const STAGE_PROGRESS: Record<string, number> = {
  ingestion: 10,
  extraction: 50,
  structured_output: 90,
  done: 100,
};

/**
 * Run the proposal extraction pipeline for a given job ID.
 */
export async function runPipeline(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (job.status !== "pending") {
    console.log(`Job ${jobId} is not pending (status: ${job.status}), skipping.`);
    return;
  }

  const workDir = join(tmpdir(), `proposal-pipeline-${jobId}`);
  await mkdir(workDir, { recursive: true });

  try {
    // --- Stage 1: Ingestion ---
    await updateJob(jobId, {
      status: "processing",
      stage: "ingestion" as JobStage,
      progress: STAGE_PROGRESS.ingestion,
      started_at: new Date().toISOString(),
    });

    const storagePath = await getFileStoragePath(job.file_id);
    const pdfPath = join(workDir, "input.pdf");
    await downloadPdf(storagePath, pdfPath);
    console.log(`[${jobId}] Ingestion complete: ${storagePath}`);

    // --- Stage 2: Extraction (LLM Vision) ---
    await updateJob(jobId, {
      stage: "extraction" as JobStage,
      progress: STAGE_PROGRESS.extraction,
    });

    const output = await extractProposalItems(pdfPath, "");
    console.log(`[${jobId}] Extraction complete: ${output.items.length} items, fornecedor: ${output.fornecedor}`);

    // --- Stage 3: Structured Output (persist) ---
    await updateJob(jobId, {
      stage: "structured_output" as JobStage,
      progress: STAGE_PROGRESS.structured_output,
    });

    const proposta = await getPropostaByFileId(job.file_id);
    await upsertPropostaItems(proposta.id, output.items);

    const valorTotal = output.items.reduce(
      (sum, item) => sum + (item.preco_total ?? 0),
      0
    );
    await updatePropostaAfterExtraction(proposta.id, output.fornecedor, valorTotal);

    console.log(`[${jobId}] Persisted ${output.items.length} items to proposta ${proposta.id}`);

    // --- Done ---
    await updateJob(jobId, {
      status: "done",
      stage: "done" as JobStage,
      progress: 100,
      completed_at: new Date().toISOString(),
    });

    console.log(`[${jobId}] Pipeline complete`);
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

// CLI entry point: `proposal-pipeline process --job-id <uuid>`
const args = process.argv.slice(2);
if (args[0] === "process" && args[1] === "--job-id" && args[2]) {
  runPipeline(args[2]).catch((err) => {
    console.error("Fatal pipeline error:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Build and verify**

Run: `cd container/skills/proposal-pipeline && bun run build`
Expected: Compiles successfully to `dist/`.

- [ ] **Step 4: Commit**

```bash
git add container/skills/proposal-pipeline/
git commit -m "feat: add proposal-pipeline extraction and orchestrator"
```

---

## Task 13: Integration — Poller Dispatch for Proposals

This task ensures the existing job poller dispatches proposal files to the `proposal-pipeline` instead of the `pdf-pipeline`. The exact implementation depends on how the poller currently detects file types.

**Files:**
- Investigate and modify: the poller/dispatcher that picks up `ob_pdf_jobs` with status `pending`

- [ ] **Step 1: Find the poller dispatch logic**

Run: `grep -r "pending" container/ src/ --include="*.ts" -l | head -10` and `grep -r "pdf-pipeline" src/ container/ --include="*.ts" -l | head -10`

Look for where `ob_pdf_jobs` with `status = 'pending'` are polled and dispatched to the pdf-pipeline.

- [ ] **Step 2: Add proposal-pipeline dispatch**

The dispatcher should check `ob_project_files.disciplina` for the file associated with the job. If `disciplina = 'proposta'`, dispatch to `proposal-pipeline` instead of `pdf-pipeline`.

Add a condition like:
```typescript
const file = await getFileForJob(job);
if (file.disciplina === "proposta") {
  await dispatchToPipeline("proposal-pipeline", job.id);
} else {
  await dispatchToPipeline("pdf-pipeline", job.id);
}
```

The exact code depends on the poller's structure — adapt to match existing patterns.

- [ ] **Step 3: Verify end-to-end**

Test by uploading a proposal PDF through the Propostas tab and confirming:
1. File appears in `ob_project_files` with `disciplina = 'proposta'`
2. Job created in `ob_pdf_jobs` with `status = 'pending'`
3. Poller dispatches to `proposal-pipeline`
4. Items appear in `ob_proposta_items`
5. Proposta status changes to `extracted`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: dispatch proposal files to proposal-pipeline in poller"
```

---

## Summary

| Task | Component | Est. Complexity |
|------|-----------|----------------|
| 1 | DB Migration (tables + RLS) | Low |
| 2 | Frontend Types | Low |
| 3 | Propostas Hooks | Medium |
| 4 | Workspace Tab Setup | Low |
| 5 | Proposta Uploader | Low |
| 6 | Proposta List | Low |
| 7 | Proposta Items Table (editable) | Medium |
| 8 | Wire PropostasTab | Low |
| 9 | Import Propostas Dialog | Medium |
| 10 | Wire Import Button in Planilha | Medium |
| 11 | Pipeline Types + Supabase | Medium |
| 12 | Pipeline Extraction + Orchestrator | High |
| 13 | Poller Dispatch Integration | Medium |
