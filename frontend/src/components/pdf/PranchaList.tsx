import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ProjectFile } from "@/types/orcamento";
import {
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";

interface PranchaListProps {
  files: ProjectFile[];
  activeFileId: string | null;
  onSelectFile: (fileId: string) => void;
}

const STATUS_ICON = {
  uploaded: Clock,
  processing: Loader2,
  done: CheckCircle2,
  error: AlertCircle,
};

const DISCIPLINA_LABELS: Record<string, string> = {
  arq: "Arquitetônico",
  est: "Estrutural",
  hid: "Hidráulico",
  ele: "Elétrico",
  memorial: "Memorial",
};

export function PranchaList({ files, activeFileId, onSelectFile }: PranchaListProps) {
  const grouped = files.reduce<Record<string, ProjectFile[]>>((acc, file) => {
    const key = file.disciplina ?? "sem-disciplina";
    if (!acc[key]) acc[key] = [];
    acc[key].push(file);
    return acc;
  }, {});

  return (
    <ScrollArea className="h-full w-64 border-r">
      <div className="p-3 space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Pranchas</h3>

        {Object.entries(grouped).map(([disciplina, groupFiles]) => (
          <div key={disciplina} className="space-y-1">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              {DISCIPLINA_LABELS[disciplina] ?? "Outros"}
            </p>
            {groupFiles.map((file) => {
              const StatusIcon = STATUS_ICON[file.status];
              const isActive = file.id === activeFileId;

              return (
                <button
                  key={file.id}
                  onClick={() => onSelectFile(file.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="flex-1 truncate">{file.filename}</span>
                  <StatusIcon
                    className={cn(
                      "h-3.5 w-3.5 flex-shrink-0",
                      file.status === "processing" && "animate-spin text-yellow-600",
                      file.status === "done" && "text-green-600",
                      file.status === "error" && "text-red-600",
                      file.status === "uploaded" && "text-muted-foreground"
                    )}
                  />
                </button>
              );
            })}
          </div>
        ))}

        {files.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Nenhum PDF enviado
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
