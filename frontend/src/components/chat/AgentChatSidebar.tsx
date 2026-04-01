import { useEffect, useRef, useState } from "react";
import { useProjectContext } from "@/contexts/ProjectContext";
import { useAgentChat } from "@/hooks/useAgentChat";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, Bot } from "lucide-react";

const AGENTS = [
  { slug: "orcamentista", label: "Orçamentista" },
  { slug: "estrutural", label: "Eng. Estrutural" },
  { slug: "hidraulico", label: "Eng. Hidráulico" },
  { slug: "eletricista", label: "Eng. Eletricista" },
];

export function AgentChatSidebar() {
  const { project, setChatOpen, activeTab, activePranchaId, activeItemId } =
    useProjectContext();
  const [agentSlug, setAgentSlug] = useState("orcamentista");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, isLoading, sendMessage, isSending } = useAgentChat(
    project?.id ?? "",
    agentSlug
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!project) return null;

  function handleSend(content: string) {
    const context: Record<string, unknown> = {
      project_id: project!.id,
      active_tab: activeTab,
    };
    if (activePranchaId) context.active_prancha_id = activePranchaId;
    if (activeItemId) context.active_item_id = activeItemId;

    sendMessage({ content, context });
  }

  return (
    <div className="flex w-80 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <Select value={agentSlug} onValueChange={setAgentSlug}>
            <SelectTrigger className="h-7 w-40 border-none text-sm font-medium shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENTS.map((a) => (
                <SelectItem key={a.slug} value={a.slug}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setChatOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="py-2" ref={scrollRef}>
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : messages.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Bot className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p>Inicie uma conversa com o agente</p>
              <p className="mt-1 text-xs">
                Ele tem contexto do projeto e pode tirar dúvidas sobre o orçamento
              </p>
            </div>
          ) : (
            messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        isSending={isSending}
        placeholder={`Pergunte ao ${AGENTS.find((a) => a.slug === agentSlug)?.label ?? "agente"}...`}
      />
    </div>
  );
}
