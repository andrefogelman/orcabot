import { useState, useEffect } from "react";
import { useProjectContext } from "@/contexts/ProjectContext";
import { useUpdateProject } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Save } from "lucide-react";

export function PremissasTab() {
  const { project, setProject } = useProjectContext();
  const updateProject = useUpdateProject();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tipoObra, setTipoObra] = useState("");
  const [areaM2, setAreaM2] = useState("");
  const [uf, setUf] = useState("");
  const [cidade, setCidade] = useState("");
  const [admPadrao, setAdmPadrao] = useState("");
  const [dataBaseSinapi, setDataBaseSinapi] = useState("");
  const [bdiPercentual, setBdiPercentual] = useState("");

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
      setTipoObra(project.tipo_obra);
      setAreaM2(project.area_total_m2?.toString() ?? "");
      setUf(project.uf);
      setCidade(project.cidade ?? "");
      setAdmPadrao(
        ((project.premissas as Record<string, unknown>)?.adm_percentual_padrao as number)?.toString() ?? ""
      );
      setDataBaseSinapi(project.data_base_sinapi ?? "");
      setBdiPercentual(project.bdi_percentual?.toString() ?? "");
    }
  }, [project]);

  if (!project) return null;

  async function handleSave() {
    try {
      const result = await updateProject.mutateAsync({
        id: project!.id,
        name,
        description: description || null,
        tipo_obra: tipoObra,
        area_total_m2: areaM2 ? parseFloat(areaM2) : null,
        uf,
        cidade: cidade || null,
        data_base_sinapi: dataBaseSinapi || null,
        bdi_percentual: bdiPercentual ? parseFloat(bdiPercentual) : null,
        premissas: {
          ...(project!.premissas as Record<string, unknown>),
          adm_percentual_padrao: parseFloat(admPadrao),
        },
      });
      setProject(result);
      toast.success("Premissas salvas com sucesso");
    } catch {
      toast.error("Erro ao salvar premissas");
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-2xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Premissas do Projeto</h2>
          <Button onClick={handleSave} disabled={updateProject.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateProject.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Dados Gerais</CardTitle>
            <CardDescription>Informações básicas do projeto</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Projeto</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição do projeto..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de Obra</Label>
                <Input value={tipoObra} onChange={(e) => setTipoObra(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Área Total (m²)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={areaM2}
                  onChange={(e) => setAreaM2(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>UF</Label>
                <Input value={uf} onChange={(e) => setUf(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input value={cidade} onChange={(e) => setCidade(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parâmetros Orçamentários</CardTitle>
            <CardDescription>Base de cálculo e percentuais</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Adm% Padrão</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={admPadrao}
                  onChange={(e) => setAdmPadrao(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Definir nas premissas de cada projeto
                </p>
              </div>
              <div className="space-y-2">
                <Label>BDI (%)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={bdiPercentual}
                  onChange={(e) => setBdiPercentual(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Data Base SINAPI</Label>
                <Input
                  type="month"
                  value={dataBaseSinapi}
                  onChange={(e) => setDataBaseSinapi(e.target.value)}
                  placeholder="2026-03"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
