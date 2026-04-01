import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { CurvaAbcEntry } from "@/types/orcamento";
import { formatBRL, formatNumber } from "@/lib/format";

interface CurvaAbcChartProps {
  entries: CurvaAbcEntry[];
}

export function CurvaAbcChart({ entries }: CurvaAbcChartProps) {
  const data = entries.map((entry, index) => ({
    name: entry.item.eap_code,
    descricao: entry.item.descricao,
    custo: entry.item.custo_total ?? 0,
    acumulado: entry.peso_acumulado,
    classe: entry.classe,
    index: index + 1,
  }));

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 30, left: 20, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10 }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `R$ ${formatNumber(v / 1000, 0)}k`}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `${formatNumber(v, 0)}%`}
            domain={[0, 100]}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (name === "custo") return [formatBRL(value), "Custo"];
              if (name === "acumulado") return [`${formatNumber(value)}%`, "Acumulado"];
              return [value, name];
            }}
            labelFormatter={(label: string) => {
              const item = data.find((d) => d.name === label);
              return item ? `${label} — ${item.descricao}` : label;
            }}
          />

          <ReferenceLine yAxisId="right" y={80} stroke="#2563eb" strokeDasharray="5 5" label="80%" />
          <ReferenceLine yAxisId="right" y={95} stroke="#f59e0b" strokeDasharray="5 5" label="95%" />

          <Bar
            yAxisId="left"
            dataKey="custo"
            fill="#2563eb"
            radius={[2, 2, 0, 0]}
            opacity={0.8}
          />
          <Line
            yAxisId="right"
            dataKey="acumulado"
            stroke="#dc2626"
            strokeWidth={2}
            dot={{ r: 2 }}
            type="monotone"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
