import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useReviewItems, useResolveReview } from "@/hooks/usePdfJobs";
import { confidenceLabel } from "@/lib/format";
import type { PdfPage } from "@/types/orcamento";

interface ReviewPanelProps {
  projectId: string;
}

export function ReviewPanel({ projectId }: ReviewPanelProps) {
  const { data: reviewItems, isLoading } = useReviewItems(projectId);
  const resolveReview = useResolveReview();

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Carregando...</div>;
  }

  if (!reviewItems || reviewItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <CheckCircle2 className="mb-2 h-8 w-8 text-green-600" />
        <p className="text-sm font-medium">Nenhum item pendente de revisão</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          Itens para Revisão ({reviewItems.length})
        </h3>

        {reviewItems.map((item) => (
          <ReviewItemCard
            key={item.id}
            item={item}
            onResolve={(notes) =>
              resolveReview.mutate({ pageId: item.id, reviewNotes: notes })
            }
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function ReviewItemCard({
  item,
  onResolve,
}: {
  item: PdfPage;
  onResolve: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const conf = confidenceLabel(item.confidence ?? 0);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium">
            Prancha {item.prancha_id ?? "?"} — Pág. {item.page_number}
          </p>
          <p className="text-xs text-muted-foreground">{item.tipo ?? "Tipo desconhecido"}</p>
        </div>
        <Badge
          variant="outline"
          className={
            conf.color === "high"
              ? "text-confidence-high border-confidence-high"
              : conf.color === "medium"
                ? "text-confidence-medium border-confidence-medium"
                : "text-confidence-low border-confidence-low"
          }
        >
          {conf.text}
        </Badge>
      </div>

      {item.review_notes && (
        <p className="text-xs text-muted-foreground bg-muted rounded p-2">
          {item.review_notes}
        </p>
      )}

      <Textarea
        placeholder="Notas de revisão..."
        className="h-16 text-xs"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => onResolve(notes || "Confirmado pelo usuário")}
        >
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Confirmar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => onResolve(notes || "Rejeitado — corrigir")}
        >
          <XCircle className="mr-1 h-3 w-3" />
          Corrigir
        </Button>
      </div>
    </div>
  );
}
