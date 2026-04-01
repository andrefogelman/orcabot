import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import type { Project } from "@/types/orcamento";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Rascunho", variant: "secondary" },
  processing: { label: "Processando", variant: "default" },
  review: { label: "Revisão", variant: "destructive" },
  done: { label: "Concluído", variant: "outline" },
};

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const status = STATUS_MAP[project.status] ?? STATUS_MAP.draft;

  return (
    <Link to={`/projetos/${project.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base">{project.name}</CardTitle>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>{project.tipo_obra}</span>
              <span>{project.uf}{project.cidade ? ` — ${project.cidade}` : ""}</span>
            </div>
            {project.area_total_m2 && (
              <div>Área: {formatNumber(project.area_total_m2, 2)} m²</div>
            )}
            {project.description && (
              <p className="line-clamp-2 pt-1">{project.description}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
