import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { usePdfPages } from "@/hooks/usePdfJobs";
import { useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Loader2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  TableProperties,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ProjectFile } from "@/types/orcamento";

interface PdfProcessPanelProps {
  file: ProjectFile | null;
  projectId: string;
}

interface ExtractedItem {
  descricao: string;
  quantidade: number;
  unidade: string;
  memorial_calculo?: string;
  ambiente?: string;
  disciplina?: string;
  confidence?: number;
  selected: boolean;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  items?: ExtractedItem[];
}

const SUGGESTED_PROMPTS: Record<string, string> = {
  "demolir": "Levante todas as áreas de demolição (m²), incluindo paredes, pisos e forros a demolir. Identifique cada item com localização.",
  "medida": "Extraia todas as medidas e cotas do projeto. Liste ambientes com suas dimensões (largura x comprimento), áreas e perímetros.",
  "hidraulic": "Levante tubulações por diâmetro e material, conexões, registros, válvulas e equipamentos sanitários. Separe por sistema (água fria, esgoto, pluvial).",
  "eletric": "Levante pontos elétricos (iluminação, TUGs, TUEs), circuitos, eletrodutos por diâmetro e fiação por seção. Identifique quadros.",
  "forro": "Levante áreas de forro por tipo (gesso, PVC, mineral) e por ambiente. Inclua iluminação embutida se visível.",
  "piso": "Levante áreas de piso por tipo de revestimento e por ambiente. Inclua rodapés, soleiras e peitoris.",
  "revestiment": "Levante áreas de revestimento de parede por tipo (cerâmico, porcelanato, pintura) e por ambiente. Desconte vãos de portas e janelas.",
  "ar condicionado": "Levante equipamentos de ar condicionado: tipo (split, multi-split, VRF), capacidade BTU, pontos de dreno e infraestrutura elétrica.",
};

function getSuggestedPrompt(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const [key, prompt] of Object.entries(SUGGESTED_PROMPTS)) {
    if (lower.includes(key)) return prompt;
  }
  return null;
}

export function PdfProcessPanel({ file, projectId }: PdfProcessPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data: pages } = usePdfPages(file?.id ?? "");

  // Reset when file changes
  useEffect(() => {
    if (!file) return;
    const suggested = getSuggestedPrompt(file.filename);
    setMessages([
      {
        role: "system",
        content: `PDF selecionado: **${file.filename}**${file.disciplina ? ` (${file.disciplina})` : ""}. Descreva o que levantar deste arquivo.`,
        timestamp: new Date(),
      },
    ]);
    setInput(suggested ?? "");
  }, [file?.id]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Selecione um PDF para processar
        </p>
      </div>
    );
  }

  // Get the latest message that has items
  const latestItemsMsg = [...messages].reverse().find((m) => m.items && m.items.length > 0);
  const extractedItems = latestItemsMsg?.items ?? [];
  const selectedCount = extractedItems.filter((i) => i.selected).length;

  function toggleItem(idx: number) {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg !== latestItemsMsg || !msg.items) return msg;
        const newItems = [...msg.items];
        newItems[idx] = { ...newItems[idx], selected: !newItems[idx].selected };
        return { ...msg, items: newItems };
      })
    );
  }

  function toggleAll(selected: boolean) {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg !== latestItemsMsg || !msg.items) return msg;
        return { ...msg, items: msg.items.map((i) => ({ ...i, selected })) };
      })
    );
  }

  async function handleSubmit() {
    if (!input.trim() || !file || processing) return;

    const userMsg: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setProcessing(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "process-single-pdf",
        {
          body: {
            project_id: projectId,
            file_id: file.id,
            prompt: userMsg.content,
          },
        }
      );

      if (error) throw error;

      // Parse items from structured_data
      const rawItems: ExtractedItem[] = (data.structured_data?.itens || []).map(
        (item: any) => ({
          descricao: item.descricao || "",
          quantidade: item.quantidade || 0,
          unidade: item.unidade || "un",
          memorial_calculo: item.memorial_calculo || "",
          ambiente: item.ambiente || "",
          disciplina: item.disciplina || file.disciplina || "",
          confidence: item.confidence ?? 0.7,
          selected: true,
        })
      );

      const assistantMsg: Message = {
        role: "assistant",
        content: data.summary || "Processamento concluído.",
        timestamp: new Date(),
        items: rawItems,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Refresh queries
      queryClient.invalidateQueries({ queryKey: ["pdf-pages", file.id] });
      queryClient.invalidateQueries({ queryKey: ["project-files", projectId] });
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Erro: ${err.message || "Falha no processamento"}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setProcessing(false);
    }
  }

  async function saveToSpreadsheet() {
    if (!file || saving) return;
    const itemsToSave = extractedItems.filter((i) => i.selected);
    if (itemsToSave.length === 0) {
      toast.error("Selecione ao menos um item");
      return;
    }

    setSaving(true);
    try {
      const rows = itemsToSave.map((item, idx) => ({
        project_id: projectId,
        disciplina: item.disciplina || "arquitetonico",
        item_code: String(idx + 1).padStart(2, "0"),
        descricao: item.descricao,
        unidade: item.unidade,
        quantidade: item.quantidade,
        calculo_memorial: item.memorial_calculo || "",
        origem_prancha: file.id,
        origem_ambiente: item.ambiente || "",
        confidence: item.confidence ?? 0.7,
        needs_review: (item.confidence ?? 0.7) < 0.7,
        created_by: "usuario",
      }));

      const { error } = await supabase
        .from("ob_quantitativos")
        .insert(rows);

      if (error) throw error;

      toast.success(`${rows.length} itens salvos na planilha`);

      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `${rows.length} itens salvos em Quantitativos. Veja na aba Planilha.`,
          timestamp: new Date(),
        },
      ]);

      queryClient.invalidateQueries({ queryKey: ["quantitativos", projectId] });
      queryClient.invalidateQueries({ queryKey: ["orcamento", projectId] });
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const hasResults = pages && pages.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium truncate">{file.filename}</h3>
          <Badge
            variant="outline"
            className={
              file.status === "done"
                ? "text-green-600 border-green-600"
                : file.status === "processing"
                  ? "text-yellow-600 border-yellow-600"
                  : "text-muted-foreground"
            }
          >
            {file.status === "done"
              ? "Processado"
              : file.status === "processing"
                ? "Processando"
                : "Aguardando"}
          </Badge>
        </div>
      </div>

      {/* Results summary */}
      {hasResults && (
        <div className="border-b px-4 py-2 bg-muted/50">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Resultados extraídos:
          </p>
          {pages.map((page) => (
            <div key={page.id} className="flex items-center gap-2 text-xs">
              {page.needs_review ? (
                <AlertTriangle className="h-3 w-3 text-orange-500" />
              ) : (
                <CheckCircle2 className="h-3 w-3 text-green-500" />
              )}
              <span>
                Pág. {page.page_number} — {page.tipo ?? "classificando..."}{" "}
                {page.prancha_id && `(${page.prancha_id})`}
              </span>
              {page.confidence != null && (
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {Math.round(page.confidence * 100)}%
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Chat messages + extracted items */}
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div key={i}>
              <div
                className={
                  msg.role === "user"
                    ? "flex justify-end"
                    : msg.role === "system"
                      ? "flex justify-center"
                      : "flex justify-start"
                }
              >
                <div
                  className={
                    msg.role === "user"
                      ? "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground text-sm"
                      : msg.role === "system"
                        ? "max-w-[90%] rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground text-center"
                        : "max-w-[95%] rounded-lg border bg-card px-3 py-2 text-sm whitespace-pre-wrap"
                  }
                >
                  {msg.content}
                </div>
              </div>

              {/* Extracted items table */}
              {msg.items && msg.items.length > 0 && (
                <div className="mt-2 rounded-lg border bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
                    <span className="text-xs font-medium">
                      {msg.items.length} itens encontrados
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => toggleAll(true)}
                      >
                        Todos
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => toggleAll(false)}
                      >
                        Nenhum
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/80">
                        <tr>
                          <th className="w-8 p-1.5"></th>
                          <th className="text-left p-1.5">Descrição</th>
                          <th className="text-right p-1.5 w-16">Qtd</th>
                          <th className="text-left p-1.5 w-12">Und</th>
                        </tr>
                      </thead>
                      <tbody>
                        {msg.items.map((item, idx) => (
                          <tr
                            key={idx}
                            className={`border-t cursor-pointer hover:bg-muted/30 ${
                              !item.selected ? "opacity-40" : ""
                            }`}
                            onClick={() => toggleItem(idx)}
                          >
                            <td className="p-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={() => toggleItem(idx)}
                                className="rounded"
                              />
                            </td>
                            <td className="p-1.5">
                              <div>{item.descricao}</div>
                              {item.ambiente && (
                                <div className="text-[10px] text-muted-foreground">
                                  {item.ambiente}
                                </div>
                              )}
                            </td>
                            <td className="p-1.5 text-right font-mono">
                              {item.quantidade.toLocaleString("pt-BR", {
                                minimumFractionDigits: 2,
                              })}
                            </td>
                            <td className="p-1.5">{item.unidade}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
          {processing && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Processando PDF...
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Save to spreadsheet bar */}
      {extractedItems.length > 0 && (
        <div className="border-t px-3 py-2 bg-muted/30 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedCount} de {extractedItems.length} itens selecionados
          </span>
          <Button
            size="sm"
            onClick={saveToSpreadsheet}
            disabled={selectedCount === 0 || saving}
          >
            {saving ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <TableProperties className="mr-2 h-3 w-3" />
            )}
            Salvar na Planilha
          </Button>
        </div>
      )}

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            placeholder="O que levantar deste PDF? Ex: Levantar áreas de demolição..."
            className="min-h-[60px] text-sm resize-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={processing}
          />
          <Button
            size="icon"
            className="h-[60px] w-[60px]"
            onClick={handleSubmit}
            disabled={!input.trim() || processing}
          >
            {processing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
