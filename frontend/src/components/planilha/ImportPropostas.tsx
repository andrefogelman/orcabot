import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useImportablePropostas } from "@/hooks/usePropostas";
import { toast } from "sonner";
import type { OrcamentoItem } from "@/types/orcamento";

interface ImportPropostasProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  existingItems: OrcamentoItem[];
  onImport: (items: Array<{
    eap_code: string;
    eap_level: number;
    descricao: string;
    unidade: string | null;
    quantidade: number | null;
    custo_unitario: number | null;
    custo_total: number | null;
    fonte: string | null;
  }>) => void;
}

export function ImportPropostas({
  open,
  onOpenChange,
  projectId,
  existingItems,
  onImport,
}: ImportPropostasProps) {
  const { data: propostas, isLoading } = useImportablePropostas(projectId);
  const [selectedPropostaId, setSelectedPropostaId] = useState<string | null>(null);
  const [targetEtapa, setTargetEtapa] = useState<string>("__new__");
  const [newEtapaName, setNewEtapaName] = useState("");

  const level1Items = existingItems.filter((i) => i.eap_level === 1);
  const selectedProposta = propostas?.find((p) => p.id === selectedPropostaId);

  function handleImport() {
    if (!selectedProposta || selectedProposta.items.length === 0) return;

    const propItems = selectedProposta.items;
    const toCreate: Array<{
      eap_code: string;
      eap_level: number;
      descricao: string;
      unidade: string | null;
      quantidade: number | null;
      custo_unitario: number | null;
      custo_total: number | null;
      fonte: string | null;
    }> = [];

    let l1Code: string;

    if (targetEtapa === "__new__") {
      const maxNum = level1Items.reduce((max, i) => {
        const num = parseInt(i.eap_code, 10);
        return num > max ? num : max;
      }, 0);
      l1Code = String(maxNum + 1).padStart(2, "0");

      const etapaName = newEtapaName.trim() || `Prop. ${selectedProposta.fornecedor}`;

      toCreate.push({
        eap_code: l1Code,
        eap_level: 1,
        descricao: etapaName,
        unidade: null,
        quantidade: null,
        custo_unitario: null,
        custo_total: null,
        fonte: null,
      });
    } else {
      l1Code = targetEtapa;
    }

    // Find existing L2 children to determine next code
    const l2Children = existingItems.filter(
      (i) => i.eap_level === 2 && i.eap_code.startsWith(l1Code + ".")
    );
    const maxL2 = l2Children.reduce((max, i) => {
      const num = parseInt(i.eap_code.split(".")[1], 10);
      return num > max ? num : max;
    }, 0);

    // Items go directly as L2 under the etapa
    propItems.forEach((item, idx) => {
      const l2Code = `${l1Code}.${String(maxL2 + idx + 1).padStart(2, "0")}`;
      toCreate.push({
        eap_code: l2Code,
        eap_level: 2,
        descricao: item.descricao,
        unidade: item.unidade,
        quantidade: item.quantidade,
        custo_unitario: item.preco_unitario,
        custo_total: item.preco_total,
        fonte: "cotacao",
      });
    });

    onImport(toCreate);
    setSelectedPropostaId(null);
    setTargetEtapa("__new__");
    setNewEtapaName("");
    onOpenChange(false);
    toast.success(`${propItems.length} item(ns) da proposta importado(s)`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar Proposta</DialogTitle>
          <DialogDescription>
            Selecione uma proposta e a etapa destino na planilha.
          </DialogDescription>
        </DialogHeader>

        {/* Proposta selector */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Proposta:</label>
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !propostas || propostas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma proposta disponível. Envie e extraia propostas na aba Propostas primeiro.
            </p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-auto">
              {propostas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPropostaId(p.id)}
                  className={`w-full rounded border p-2 text-left text-sm transition-colors hover:bg-accent/30 ${
                    selectedPropostaId === p.id ? "border-primary bg-accent/20" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{p.fornecedor || "Sem nome"}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={p.status === "reviewed" ? "default" : "outline"}>
                        {p.status === "reviewed" ? "Revisado" : "Extraído"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{p.items.length} itens</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Items preview */}
        {selectedProposta && selectedProposta.items.length > 0 && (
          <ScrollArea className="max-h-[250px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs font-medium text-muted-foreground">
                  <th className="px-2 py-2 text-left">Descrição</th>
                  <th className="w-14 px-2 py-2 text-center">Und</th>
                  <th className="w-18 px-2 py-2 text-right">Qtde</th>
                  <th className="w-24 px-2 py-2 text-right">P. Unit.</th>
                  <th className="w-24 px-2 py-2 text-right">P. Total</th>
                </tr>
              </thead>
              <tbody>
                {selectedProposta.items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-2 py-1.5">{item.descricao}</td>
                    <td className="px-2 py-1.5 text-center">{item.unidade}</td>
                    <td className="px-2 py-1.5 text-right">
                      {item.quantidade?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {item.preco_unitario?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {item.preco_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}

        {/* Target etapa selector */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <label className="text-sm font-medium whitespace-nowrap">Etapa destino:</label>
          <Select value={targetEtapa} onValueChange={setTargetEtapa}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Selecione a etapa..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__new__">+ Criar nova etapa</SelectItem>
              {level1Items.map((item) => (
                <SelectItem key={item.eap_code} value={item.eap_code}>
                  {item.eap_code} — {item.descricao}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targetEtapa === "__new__" && (
            <Input
              placeholder={selectedProposta ? `Prop. ${selectedProposta.fornecedor}` : "Nome da etapa..."}
              className="flex-1"
              value={newEtapaName}
              onChange={(e) => setNewEtapaName(e.target.value)}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={!selectedProposta || selectedProposta.items.length === 0}
          >
            Importar {selectedProposta?.items.length ?? 0} itens
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
