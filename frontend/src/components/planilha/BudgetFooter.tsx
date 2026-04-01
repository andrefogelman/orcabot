import { formatBRL } from "@/lib/format";
import type { BudgetFooterTotals } from "@/types/orcamento";

interface BudgetFooterProps {
  totals: BudgetFooterTotals;
}

export function BudgetFooter({ totals }: BudgetFooterProps) {
  const rows = [
    { label: "Custo Direto Total", value: totals.custo_direto_total },
    { label: "Administração Total", value: totals.administracao_total },
    { label: "Impostos", value: totals.impostos },
    { label: "Preço Total da Obra", value: totals.preco_total_obra, bold: true },
  ];

  return (
    <tfoot>
      {rows.map((row) => (
        <tr
          key={row.label}
          className={`border-t ${
            row.bold
              ? "bg-foreground/5 font-bold text-base"
              : "text-sm"
          }`}
        >
          <td colSpan={6} className="px-2 py-2 text-right font-medium">
            {row.label}
          </td>
          <td className="px-2 py-2 text-right font-mono">
            {formatBRL(row.value)}
          </td>
          <td />
        </tr>
      ))}
    </tfoot>
  );
}
