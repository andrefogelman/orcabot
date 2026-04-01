import { useProjectContext } from "@/contexts/ProjectContext";
import { useOrcamentoItems } from "@/hooks/useOrcamento";
import { useCurvaABC } from "@/hooks/useCurvaABC";
import { CurvaAbcChart } from "@/components/curva-abc/CurvaAbcChart";
import { CurvaAbcTable } from "@/components/curva-abc/CurvaAbcTable";
import { ScrollArea } from "@/components/ui/scroll-area";

export function CurvaAbcTab() {
  const { project } = useProjectContext();
  const { data: items } = useOrcamentoItems(project?.id ?? "");
  const entries = useCurvaABC(items ?? []);

  if (!project) return null;

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Nenhum item no orçamento para gerar a Curva ABC</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-8">
        <div>
          <h2 className="text-lg font-bold mb-4">Curva ABC — Análise de Pareto</h2>
          <CurvaAbcChart entries={entries} />
        </div>

        <CurvaAbcTable entries={entries} />
      </div>
    </ScrollArea>
  );
}
