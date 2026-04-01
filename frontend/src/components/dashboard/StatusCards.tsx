import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useProjectStats } from "@/hooks/useProjects";

const CARDS = [
  { key: "total" as const, label: "Total de Projetos", icon: FileText, color: "text-primary" },
  { key: "processing" as const, label: "Processando", icon: Clock, color: "text-yellow-600" },
  { key: "review" as const, label: "Aguardando Revisão", icon: AlertTriangle, color: "text-orange-600" },
  { key: "done" as const, label: "Concluídos", icon: CheckCircle2, color: "text-green-600" },
];

export function StatusCards() {
  const { data: stats } = useProjectStats();

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map((card) => (
        <Card key={card.key}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.label}
            </CardTitle>
            <card.icon className={`h-4 w-4 ${card.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.[card.key] ?? 0}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
