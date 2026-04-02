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
} from "lucide-react";
import type { ProjectFile } from "@/types/orcamento";

interface PdfProcessPanelProps {
  file: ProjectFile | null;
  projectId: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data: pages } = usePdfPages(file?.id ?? "");

  // Reset messages when file changes
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

      const assistantMsg: Message = {
        role: "assistant",
        content: data.summary || "Processamento concluído.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Refresh queries
      queryClient.invalidateQueries({ queryKey: ["pdf-pages", file.id] });
      queryClient.invalidateQueries({ queryKey: ["project-files", projectId] });
      queryClient.invalidateQueries({ queryKey: ["pdf-jobs", projectId] });
      queryClient.invalidateQueries({ queryKey: ["review-items", projectId] });
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

      {/* Results summary (if any) */}
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

      {/* Chat messages */}
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
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
                      : "max-w-[85%] rounded-lg border bg-card px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {msg.content}
              </div>
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
