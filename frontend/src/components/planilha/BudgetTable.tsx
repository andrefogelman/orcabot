import { useState, useMemo, useCallback } from "react";
import { BudgetRow } from "./BudgetRow";
import { BudgetFooter } from "./BudgetFooter";
import { BudgetToolbar } from "./BudgetToolbar";
import {
  buildBudgetTree,
  calculateFooterTotals,
  useOrcamentoItems,
  useUpdateOrcamentoItem,
  useCreateOrcamentoItem,
} from "@/hooks/useOrcamento";
import { exportBudgetToExcel } from "@/lib/excel-export";
import type { OrcamentoItem, BudgetRow as BudgetRowType } from "@/types/orcamento";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface BudgetTableProps {
  projectId: string;
  projectName: string;
}

export function BudgetTable({ projectId, projectName }: BudgetTableProps) {
  const { data: items, isLoading } = useOrcamentoItems(projectId);
  const updateItem = useUpdateOrcamentoItem();
  const createItem = useCreateOrcamentoItem();

  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDisciplina, setFilterDisciplina] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    let result = items;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.descricao.toLowerCase().includes(q) ||
          i.eap_code.includes(q)
      );
    }

    return result;
  }, [items, searchQuery]);

  const tree = useMemo(() => buildBudgetTree(filteredItems), [filteredItems]);

  const footerTotals = useMemo(
    () => calculateFooterTotals(items ?? []),
    [items]
  );

  const handleToggle = useCallback((eapCode: string) => {
    setExpandedMap((prev) => ({ ...prev, [eapCode]: !prev[eapCode] }));
  }, []);

  const isExpanded = useCallback(
    (eapCode: string) => expandedMap[eapCode] !== false,
    [expandedMap]
  );

  const handleUpdate = useCallback(
    (itemId: string, field: keyof OrcamentoItem, value: string | number) => {
      const updates: Record<string, string | number> = { [field]: value };

      if (field === "custo_material" || field === "custo_mao_obra") {
        const item = items?.find((i) => i.id === itemId);
        if (item) {
          const material = field === "custo_material" ? Number(value) : (item.custo_material ?? 0);
          const maoObra = field === "custo_mao_obra" ? Number(value) : (item.custo_mao_obra ?? 0);
          updates.custo_total = material + maoObra;
        }
      }

      updateItem.mutate({ id: itemId, projectId, ...updates });
    },
    [items, projectId, updateItem]
  );

  const handleAddItem = useCallback(
    (level: number) => {
      if (!items) return;

      const sameLevel = items.filter((i) => i.eap_level === level);
      let newCode: string;

      if (level === 1) {
        const maxNum = sameLevel.reduce((max, i) => {
          const num = parseInt(i.eap_code, 10);
          return num > max ? num : max;
        }, 0);
        newCode = String(maxNum + 1).padStart(2, "0");
      } else if (level === 2) {
        const level1Codes = items.filter((i) => i.eap_level === 1).map((i) => i.eap_code);
        const lastL1 = level1Codes[level1Codes.length - 1] ?? "01";
        const childrenOfLast = sameLevel.filter((i) => i.eap_code.startsWith(lastL1 + "."));
        const maxSub = childrenOfLast.reduce((max, i) => {
          const parts = i.eap_code.split(".");
          const num = parseInt(parts[1], 10);
          return num > max ? num : max;
        }, 0);
        newCode = `${lastL1}.${String(maxSub + 1).padStart(2, "0")}`;
      } else {
        const level2Codes = items.filter((i) => i.eap_level === 2).map((i) => i.eap_code);
        const lastL2 = level2Codes[level2Codes.length - 1] ?? "01.01";
        const childrenOfLast = items.filter(
          (i) => i.eap_level === 3 && i.eap_code.startsWith(lastL2 + ".")
        );
        const maxSub = childrenOfLast.reduce((max, i) => {
          const parts = i.eap_code.split(".");
          const num = parseInt(parts[2], 10);
          return num > max ? num : max;
        }, 0);
        newCode = `${lastL2}.${String(maxSub + 1).padStart(3, "0")}`;
      }

      createItem.mutate({
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
      });
    },
    [items, projectId, createItem]
  );

  const handleExportExcel = useCallback(async () => {
    if (!items) return;
    try {
      await exportBudgetToExcel(items, footerTotals, projectName);
      toast.success("Planilha exportada com sucesso");
    } catch {
      toast.error("Erro ao exportar planilha");
    }
  }, [items, footerTotals, projectName]);

  function renderTree(rows: BudgetRowType[]): React.ReactNode[] {
    const result: React.ReactNode[] = [];
    for (const row of rows) {
      const expanded = isExpanded(row.item.eap_code);
      result.push(
        <BudgetRow
          key={row.item.id}
          item={row.item}
          isExpanded={expanded}
          hasChildren={row.children.length > 0}
          onToggle={() => handleToggle(row.item.eap_code)}
          onUpdate={(field, value) => handleUpdate(row.item.id, field, value)}
        />
      );
      if (expanded && row.children.length > 0) {
        result.push(...renderTree(row.children));
      }
    }
    return result;
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <BudgetToolbar
        onAddItem={handleAddItem}
        onExportExcel={handleExportExcel}
        onSearch={setSearchQuery}
        filterDisciplina={filterDisciplina}
        onFilterDisciplina={setFilterDisciplina}
      />

      <ScrollArea className="flex-1">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-xs font-medium text-muted-foreground">
              <th className="w-20 border-r px-2 py-2 text-left">Item</th>
              <th className="min-w-[200px] border-r px-2 py-2 text-left">Descricao</th>
              <th className="w-16 border-r px-2 py-2 text-center">Unid</th>
              <th className="w-20 border-r px-2 py-2 text-right">Qtde</th>
              <th className="w-28 border-r px-2 py-2 text-right">Material</th>
              <th className="w-28 border-r px-2 py-2 text-right">Mão de Obra</th>
              <th className="w-28 border-r px-2 py-2 text-right">Custo Total</th>
              <th className="w-16 px-2 py-2 text-right">Adm%</th>
            </tr>
          </thead>
          <tbody>{renderTree(tree)}</tbody>
          <BudgetFooter totals={footerTotals} />
        </table>
      </ScrollArea>
    </div>
  );
}
