import { StatusCards } from "@/components/dashboard/StatusCards";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import { NewProjectDialog } from "@/components/dashboard/NewProjectDialog";
import { useProjects } from "@/hooks/useProjects";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const { data: projects, isLoading } = useProjects();

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projetos</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie seus orçamentos de obras
          </p>
        </div>
        <NewProjectDialog />
      </div>

      {/* Status cards */}
      <StatusCards />

      {/* Project list */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium">Nenhum projeto ainda</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie seu primeiro projeto para começar a orçar
          </p>
        </div>
      )}
    </div>
  );
}
