import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BudgetCell } from "./BudgetCell";
import { useProjectContext } from "@/contexts/ProjectContext";
import type { OrcamentoItem } from "@/types/orcamento";

interface BudgetRowProps {
  item: OrcamentoItem;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onUpdate: (field: keyof OrcamentoItem, value: string | number) => void;
}

export function BudgetRow({ item, isExpanded, hasChildren, onToggle, onUpdate }: BudgetRowProps) {
  const { setActiveItemId } = useProjectContext();
  const isLevel1 = item.eap_level === 1;
  const isLevel3 = item.eap_level === 3;

  return (
    <tr
      className={cn(
        "border-b transition-colors hover:bg-accent/20",
        isLevel1 && "budget-row-level1 bg-primary/5",
        !isLevel1 && !isLevel3 && "budget-row-level2",
        isLevel3 && "budget-row-level3"
      )}
      onClick={() => setActiveItemId(item.id)}
    >
      {/* Item code */}
      <td className="w-20 border-r px-2 py-1">
        <div className="flex items-center gap-1">
          {hasChildren && (
            <button onClick={onToggle} className="p-0.5 hover:bg-accent rounded">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          )}
          <span className={cn("text-sm", isLevel1 && "font-bold")}>{item.eap_code}</span>
        </div>
      </td>

      {/* Descricao */}
      <td className="min-w-[200px] border-r">
        <BudgetCell
          value={item.descricao}
          type="text"
          onChange={(v) => onUpdate("descricao", v)}
          className={cn(isLevel1 && "font-bold")}
          readOnly={isLevel1}
        />
      </td>

      {/* Unidade */}
      <td className="w-16 border-r text-center">
        <BudgetCell
          value={item.unidade}
          type="unit"
          onChange={(v) => onUpdate("unidade", v)}
          readOnly={isLevel1}
        />
      </td>

      {/* Quantidade */}
      <td className="w-20 border-r text-right">
        <BudgetCell
          value={item.quantidade}
          type={isLevel1 ? "readonly-number" : "number"}
          onChange={(v) => onUpdate("quantidade", v)}
          className="text-right"
          readOnly={isLevel1}
        />
      </td>

      {/* Material */}
      <td className="w-28 border-r text-right">
        <BudgetCell
          value={item.custo_material}
          type={isLevel1 ? "readonly-currency" : "currency"}
          onChange={(v) => onUpdate("custo_material", v)}
          className="text-right"
        />
      </td>

      {/* Mao de Obra */}
      <td className="w-28 border-r text-right">
        <BudgetCell
          value={item.custo_mao_obra}
          type={isLevel1 ? "readonly-currency" : "currency"}
          onChange={(v) => onUpdate("custo_mao_obra", v)}
          className="text-right"
        />
      </td>

      {/* Custo Total */}
      <td className="w-28 border-r text-right">
        <BudgetCell
          value={item.custo_total}
          type="readonly-currency"
          onChange={() => {}}
          className={cn("text-right", isLevel1 && "font-bold")}
          readOnly
        />
      </td>

      {/* Adm% */}
      <td className="w-16 text-right">
        <BudgetCell
          value={item.adm_percentual}
          type={isLevel1 ? "readonly-number" : "percent"}
          onChange={(v) => onUpdate("adm_percentual", v)}
          className="text-right"
          readOnly={isLevel1}
        />
      </td>
    </tr>
  );
}
