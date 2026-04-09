import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Check, AlertTriangle } from "lucide-react";
import { usePropostaItems, useUpdatePropostaItem, useDeletePropostaItem, useUpdatePropostaStatus } from "@/hooks/usePropostas";
import { toast } from "sonner";
import type { PropostaItem } from "@/types/orcamento";

interface PropostaItemsTableProps {
  propostaId: string;
  propostaStatus: string;
  projectId: string;
  fornecedor: string;
}

export function PropostaItemsTable({ propostaId, propostaStatus, projectId, fornecedor }: PropostaItemsTableProps) {
  const { data: items, isLoading } = usePropostaItems(propostaId);
  const updateItem = useUpdatePropostaItem();
  const deleteItem = useDeletePropostaItem();
  const updateStatus = useUpdatePropostaStatus();
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (item: PropostaItem, field: keyof PropostaItem) => {
    setEditingCell({ id: item.id, field });
    setEditValue(String(item[field] ?? ""));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;

    const numericFields = ["quantidade", "preco_unitario", "preco_total"];
    const value = numericFields.includes(field)
      ? parseFloat(editValue.replace(",", ".")) || null
      : editValue;

    updateItem.mutate(
      { id, propostaId, [field]: value },
      { onError: () => toast.error("Erro ao salvar") }
    );
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditingCell(null);
  };

  const handleDelete = (id: string) => {
    deleteItem.mutate(
      { id, propostaId },
      { onSuccess: () => toast.success("Item removido") }
    );
  };

  const handleMarkReviewed = () => {
    updateStatus.mutate(
      { id: propostaId, status: "reviewed", projectId },
      { onSuccess: () => toast.success("Proposta marcada como revisada") }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {propostaStatus === "pending"
          ? "Aguardando extração..."
          : "Nenhum item extraído."}
      </p>
    );
  }

  const renderCell = (item: PropostaItem, field: keyof PropostaItem, align: string = "left") => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;

    if (isEditing) {
      return (
        <Input
          autoFocus
          className="h-7 text-sm"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
        />
      );
    }

    const value = item[field];
    const displayValue =
      typeof value === "number"
        ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })
        : (value ?? "—");

    return (
      <span
        className={`cursor-pointer hover:underline text-${align}`}
        onClick={() => startEdit(item, field)}
      >
        {displayValue}
      </span>
    );
  };

  const total = items.reduce((sum, i) => sum + (i.preco_total ?? 0), 0);

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-medium">{fornecedor}</h3>
          <p className="text-xs text-muted-foreground">
            {items.length} itens — Total: R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </p>
        </div>
        {propostaStatus === "extracted" && (
          <Button size="sm" onClick={handleMarkReviewed}>
            <Check className="mr-1 h-3 w-3" />
            Marcar como Revisado
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs font-medium text-muted-foreground">
              <th className="px-2 py-2 text-left">Descrição</th>
              <th className="w-16 px-2 py-2 text-center">Und</th>
              <th className="w-20 px-2 py-2 text-right">Qtde</th>
              <th className="w-24 px-2 py-2 text-right">P. Unit.</th>
              <th className="w-24 px-2 py-2 text-right">P. Total</th>
              <th className="w-8 px-2 py-2 text-center">Conf.</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={`border-b transition-colors hover:bg-accent/20 ${
                  item.needs_review ? "bg-yellow-500/5" : ""
                }`}
              >
                <td className="px-2 py-1.5">{renderCell(item, "descricao")}</td>
                <td className="px-2 py-1.5 text-center">{renderCell(item, "unidade")}</td>
                <td className="px-2 py-1.5 text-right">{renderCell(item, "quantidade", "right")}</td>
                <td className="px-2 py-1.5 text-right">{renderCell(item, "preco_unitario", "right")}</td>
                <td className="px-2 py-1.5 text-right">{renderCell(item, "preco_total", "right")}</td>
                <td className="px-2 py-1.5 text-center">
                  {item.needs_review ? (
                    <AlertTriangle className="mx-auto h-3.5 w-3.5 text-yellow-500" />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {((item.confidence ?? 0) * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
