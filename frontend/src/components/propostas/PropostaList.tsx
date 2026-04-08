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
