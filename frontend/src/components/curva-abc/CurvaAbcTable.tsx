import { formatBRL, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CurvaAbcEntry } from "@/types/orcamento";
import { cn } from "@/lib/utils";

interface CurvaAbcTableProps {
  entries: CurvaAbcEntry[];
}

const CLASSE_COLORS = {
  A: "bg-blue-100 text-blue-800 border-blue-300",
  B: "bg-amber-100 text-amber-800 border-amber-300",
  C: "bg-slate-100 text-slate-600 border-slate-300",
};

export function CurvaAbcTable({ entries }: CurvaAbcTableProps) {
  const countA = entries.filter((e) => e.classe === "A").length;
  const countB = entries.filter((e) => e.classe === "B").length;
  const countC = entries.filter((e) => e.classe === "C").length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={CLASSE_COLORS.A}>A</Badge>
          <span className="text-sm">{countA} itens (80% do custo)</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={CLASSE_COLORS.B}>B</Badge>
          <span className="text-sm">{countB} itens (15% do custo)</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={CLASSE_COLORS.C}>C</Badge>
          <span className="text-sm">{countC} itens (5% do custo)</span>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead className="w-16">Classe</TableHead>
            <TableHead className="w-20">Item</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead className="w-28 text-right">Custo Total</TableHead>
            <TableHead className="w-20 text-right">Peso %</TableHead>
            <TableHead className="w-24 text-right">Acumulado %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, index) => (
            <TableRow
              key={entry.item.id}
              className={cn(
                entry.classe === "A" && "bg-blue-50/50",
                entry.classe === "B" && "bg-amber-50/30"
              )}
            >
              <TableCell className="font-mono text-xs">{index + 1}</TableCell>
              <TableCell>
                <Badge variant="outline" className={cn("text-xs", CLASSE_COLORS[entry.classe])}>
                  {entry.classe}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{entry.item.eap_code}</TableCell>
              <TableCell className="text-sm">{entry.item.descricao}</TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatBRL(entry.item.custo_total ?? 0)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatNumber(entry.peso_percentual)}%
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatNumber(entry.peso_acumulado)}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
