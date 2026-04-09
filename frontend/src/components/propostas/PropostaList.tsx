import { usePropostas } from "@/hooks/usePropostas";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  const queryClient = useQueryClient();

  const handleDelete = async (e: React.MouseEvent, proposta: Proposta) => {
    e.stopPropagation();
    try {
      // Delete items, proposta, job, file record, and storage file
      await supabase.from("ob_proposta_items").delete().eq("proposta_id", proposta.id);
      await supabase.from("ob_propostas").delete().eq("id", proposta.id);
      if (proposta.file_id) {
        await supabase.from("ob_pdf_jobs").delete().eq("file_id", proposta.file_id);
        const { data: file } = await supabase
          .from("ob_project_files")
          .select("storage_path")
          .eq("id", proposta.file_id)
          .single();
        if (file) {
          await supabase.storage.from("project-pdfs").remove([file.storage_path]);
        }
        await supabase.from("ob_project_files").delete().eq("id", proposta.file_id);
      }
      queryClient.invalidateQueries({ queryKey: ["propostas", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-files", projectId] });
      toast.success("Proposta excluída");
    } catch {
      toast.error("Erro ao excluir proposta");
    }
  };

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
          <div
            key={p.id}
            onClick={() => onSelect(p)}
            className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/30 cursor-pointer ${
              selectedId === p.id ? "border-primary bg-accent/20" : "border-transparent"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{p.fornecedor || "Sem nome"}</span>
              <div className="flex items-center gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
                <button
                  onClick={(e) => handleDelete(e, p)}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Excluir proposta"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {p.valor_total != null && p.valor_total > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Total: R$ {p.valor_total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(p.created_at).toLocaleDateString("pt-BR")}
            </p>
          </div>
        );
      })}
    </div>
  );
}
