import { useMemo } from "react";
import type { OrcamentoItem, CurvaAbcEntry } from "@/types/orcamento";

/**
 * Compute Curva ABC from budget items.
 * Items sorted by custo_total descending.
 * Cumulative % assigned. A = 0-80%, B = 80-95%, C = 95-100%.
 */
export function useCurvaABC(items: OrcamentoItem[]): CurvaAbcEntry[] {
  return useMemo(() => {
    const leafItems = items.filter(
      (i) => i.eap_level > 1 && (i.custo_total ?? 0) > 0
    );

    const totalCost = leafItems.reduce((sum, i) => sum + (i.custo_total ?? 0), 0);
    if (totalCost === 0) return [];

    const sorted = [...leafItems].sort(
      (a, b) => (b.custo_total ?? 0) - (a.custo_total ?? 0)
    );

    let cumulative = 0;
    return sorted.map((item) => {
      const peso = ((item.custo_total ?? 0) / totalCost) * 100;
      cumulative += peso;

      let classe: "A" | "B" | "C";
      if (cumulative <= 80) classe = "A";
      else if (cumulative <= 95) classe = "B";
      else classe = "C";

      return {
        item,
        peso_percentual: peso,
        peso_acumulado: cumulative,
        classe,
      };
    });
  }, [items]);
}
