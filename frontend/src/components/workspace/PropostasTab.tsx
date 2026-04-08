import { useProjectContext } from "@/contexts/ProjectContext";

export function PropostasTab() {
  const { project } = useProjectContext();

  if (!project) return null;

  return (
    <div className="h-full p-6">
      <p className="text-muted-foreground">Propostas tab — coming soon</p>
    </div>
  );
}
