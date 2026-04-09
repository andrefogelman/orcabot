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
import { useQuantitativos } from "@/hooks/useOrcamento";
import { toast } from "sonner";
import type { OrcamentoItem, Quantitativo } from "@/types/orcamento";

interface ImportQuantitativosProps {
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
    quantitativo_id: string;
  }>) => void;
}

export function ImportQuantitativos({
  open,
  onOpenChange,
  projectId,
  existingItems,
  onImport,
}: ImportQuantitativosProps) {
  const { data: quantitativos, isLoading } = useQuantitativos(projectId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetEtapa, setTargetEtapa] = useState<string>("__new__");
  const [newEtapaName, setNewEtapaName] = useState("");

  const level1Items = existingItems.filter((i) => i.eap_level === 1);

  const alreadyImported = new Set(
    existingItems.filter((i) => i.quantitativo_id).map((i) => i.quantitativo_id)
  );

  const toggleSelection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!quantitativos) return;
    if (selected.size === quantitativos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(quantitativos.map((q) => q.id)));
    }
  };

  function handleImport() {
    if (!quantitativos || selected.size === 0) return;

    const selectedItems = quantitativos.filter((q) => selected.has(q.id));

    const toCreate: Array<{
      eap_code: string;
      eap_level: number;
      descricao: string;
      unidade: string | null;
      quantidade: number | null;
      quantitativo_id: string;
    }> = [];

    let l1Code: string;

    if (targetEtapa === "__new__") {
      const maxNum = level1Items.reduce((max, i) => {
        const num = parseInt(i.eap_code, 10);
        return num > max ? num : max;
      }, 0);
      l1Code = String(maxNum + 1).padStart(2, "0");
      toCreate.push({
        eap_code: l1Code,
        eap_level: 1,
        descricao: newEtapaName || "NOVA ETAPA",
        unidade: null,
        quantidade: null,
        quantitativo_id: "",
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
    selectedItems.forEach((q, idx) => {
      const l2Code = `${l1Code}.${String(maxL2 + idx + 1).padStart(2, "0")}`;
      toCreate.push({
        eap_code: l2Code,
        eap_level: 2,
        descricao: q.descricao,
        unidade: q.unidade,
        quantidade: q.quantidade,
        quantitativo_id: q.id,
      });
    });

    onImport(toCreate);
    setSelected(new Set());
    setTargetEtapa("__new__");
    setNewEtapaName("");
    onOpenChange(false);
    toast.success(`${selectedItems.length} quantitativo(s) importado(s)`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Quantitativos</DialogTitle>
          <DialogDescription>
            Selecione os quantitativos e a etapa destino na planilha.
          </DialogDescription>
        </DialogHeader>

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
              placeholder="Nome da nova etapa..."
              className="flex-1"
              value={newEtapaName}
              onChange={(e) => setNewEtapaName(e.target.value)}
            />
          )}
        </div>

        {/* Quantitativos list */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !quantitativos || quantitativos.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            Nenhum quantitativo encontrado. Processe PDFs primeiro.
          </p>
        ) : (
          <ScrollArea className="max-h-[350px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs font-medium text-muted-foreground">
                  <th className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === quantitativos.length}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-2 py-2 text-left">Descrição</th>
                  <th className="w-16 px-2 py-2 text-center">Und</th>
                  <th className="w-20 px-2 py-2 text-right">Qtde</th>
                  <th className="w-24 px-2 py-2 text-center">Disc.</th>
                  <th className="w-20 px-2 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {quantitativos.map((q) => {
                  const imported = alreadyImported.has(q.id);
                  return (
                    <tr
                      key={q.id}
                      className="border-b transition-colors hover:bg-accent/20 cursor-pointer"
                      onClick={() => toggleSelection(q.id)}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(q.id)}
                          onChange={() => toggleSelection(q.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-2 py-1.5">{q.descricao}</td>
                      <td className="px-2 py-1.5 text-center">{q.unidade}</td>
                      <td className="px-2 py-1.5 text-right">
                        {q.quantidade?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">
                          {q.disciplina}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center text-xs">
                        {imported ? (
                          <span className="text-orange-500">Reimportar</span>
                        ) : (
                          <span className="text-green-600">Disponível</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={selected.size === 0 || (targetEtapa === "__new__" && !newEtapaName.trim())}
          >
            Importar na Etapa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
