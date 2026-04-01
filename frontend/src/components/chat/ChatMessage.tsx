import { cn } from "@/lib/utils";
import type { AgentConversation } from "@/types/orcamento";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  message: AgentConversation;
}

const AGENT_LABELS: Record<string, string> = {
  orcamentista: "Orçamentista",
  estrutural: "Eng. Estrutural",
  hidraulico: "Eng. Hidráulico",
  eletricista: "Eng. Eletricista",
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center px-4 py-1">
        <span className="text-xs text-muted-foreground italic">{message.content}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        {!isUser && (
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {AGENT_LABELS[message.agent_slug] ?? message.agent_slug}
          </p>
        )}
        <p className="whitespace-pre-wrap">{message.content}</p>
        <p className="mt-1 text-[10px] opacity-60">
          {new Date(message.created_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
