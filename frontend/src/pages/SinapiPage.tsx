import { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Search, Database, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { CategoryTree, type TreeNode } from "@/components/shared/CategoryTree";
import {
  useSinapiSearch,
  useSinapiCounts,
  type SinapiComposicao,
} from "@/hooks/useSinapi";

export default function SinapiPage() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedQuery(searchInput), 300);
    return () => clearTimeout(timerRef.current);
  }, [searchInput]);

  const { data: counts } = useSinapiCounts();

  // Parse selected node to tipo/classe filters
  const { tipo, classe } = useMemo(() => {
    if (!selectedNode) return { tipo: null, classe: null };
    if (selectedNode === "INSUMO" || selectedNode === "COMPOSICAO") {
      return { tipo: selectedNode, classe: null };
    }
    // classe nodes: "INSUMO:MATERIAIS" etc
    if (selectedNode.includes(":")) {
      const [t, c] = selectedNode.split(":");
      return { tipo: t, classe: c };
    }
    return { tipo: null, classe: null };
  }, [selectedNode]);

  const { data: composicoes, isLoading } = useSinapiSearch(debouncedQuery, tipo, classe);

  // Build tree from counts
  const tree: TreeNode[] = useMemo(() => {
    if (!counts) return [];

    // Group classes by tipo
    // We need to read from the data which classes belong to which tipo.
    // For now, build from counts data.
    const insumoClasses = ["MATERIAIS", "MAO DE OBRA", "EQUIPAMENTOS"];
    const composicaoClasses = ["COMPOSICAO"];

    const insumoChildren: TreeNode[] = insumoClasses
      .filter((c) => (counts.byClasse[c] ?? 0) > 0)
      .map((c) => ({
        id: `INSUMO:${c}`,
        label: c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " "),
        count: counts.byClasse[c] ?? 0,
      }));

    // Add any other classes found under INSUMO that aren't in our list
    for (const [c, count] of Object.entries(counts.byClasse)) {
      if (!insumoClasses.includes(c) && !composicaoClasses.includes(c) && count > 0) {
        insumoChildren.push({
          id: `INSUMO:${c}`,
          label: c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " "),
          count,
        });
      }
    }

    return [
      {
        id: "root",
        label: "SINAPI",
        count: counts.total,
        children: [
          {
            id: "INSUMO",
            label: "Insumos",
            count: counts.byTipo["INSUMO"] ?? 0,
            children: insumoChildren,
          },
          {
            id: "COMPOSICAO",
            label: "Composicoes",
            count: counts.byTipo["COMPOSICAO"] ?? 0,
          },
        ],
      },
    ];
  }, [counts]);

  // Header text
  const headerText = useMemo(() => {
    if (!selectedNode) return "Todos os itens";
    if (selectedNode === "root") return "Todos os itens";
    if (selectedNode.includes(":")) {
      const c = selectedNode.split(":")[1];
      return c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " ");
    }
    if (selectedNode === "INSUMO") return "Insumos";
    if (selectedNode === "COMPOSICAO") return "Composicoes";
    return selectedNode;
  }, [selectedNode]);

  const handleSelectNode = (id: string | null) => {
    // "root" means all
    if (id === "root") {
      setSelectedNode(null);
    } else {
      setSelectedNode(id);
    }
    setExpandedId(null);
  };

  return (
    <div className="flex flex-col h-full">
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* LEFT PANEL — Category tree */}
        <ResizablePanel defaultSize={25} minSize={15} maxSize={40}>
          <div className="h-full overflow-auto border-r bg-muted/20">
            <div className="px-3 pt-4 pb-2">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-5 w-5 text-orange-600" />
                <h2 className="text-sm font-bold">Base SINAPI</h2>
              </div>
            </div>
            <CategoryTree
              tree={tree}
              selectedId={selectedNode}
              onSelect={handleSelectNode}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* RIGHT PANEL — Results */}
        <ResizablePanel defaultSize={75}>
          <div className="flex flex-col h-full">
            {/* Orange header */}
            <div className="bg-orange-500 text-white px-6 py-2.5 flex items-center gap-3">
              <span className="font-semibold text-sm">
                Mostrando: {headerText}
              </span>
              {composicoes && (
                <Badge className="bg-white/20 text-white border-0 text-xs">
                  {composicoes.length} iten{composicoes.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {/* Search */}
            <div className="px-6 py-3 border-b">
              <div className="relative max-w-lg">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por codigo ou descricao..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto px-6 py-4">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : composicoes && composicoes.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="w-28">Codigo</TableHead>
                      <TableHead>Descricao</TableHead>
                      <TableHead className="w-16">Un</TableHead>
                      <TableHead className="w-16">UF</TableHead>
                      <TableHead className="w-28">Data Base</TableHead>
                      <TableHead className="w-36 text-right">R$ Desonerado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {composicoes.map((comp) => {
                      const isExpanded = expandedId === comp.id;
                      return (
                        <TableRow key={comp.id} className="group">
                          <TableCell colSpan={7} className="p-0">
                            <div
                              className="flex w-full items-center px-4 py-3 cursor-pointer hover:bg-muted/30"
                              onClick={() => setExpandedId(isExpanded ? null : comp.id)}
                            >
                              <button className="w-8 shrink-0">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </button>
                              <span className="w-28 shrink-0 font-mono text-xs">{comp.codigo}</span>
                              <span className="flex-1 pr-4 truncate text-sm">{comp.descricao}</span>
                              <span className="w-16 shrink-0 text-center text-sm text-muted-foreground">{comp.unidade}</span>
                              <span className="w-16 shrink-0 text-center text-sm text-muted-foreground">{comp.uf}</span>
                              <span className="w-28 shrink-0 text-center text-sm text-muted-foreground">{comp.data_base}</span>
                              <span className="w-36 shrink-0 text-right font-mono font-semibold text-primary">
                                {formatBRL(comp.preco_desonerado)}
                              </span>
                            </div>

                            {/* Expanded detail */}
                            {isExpanded && (
                              <div className="bg-muted/30 p-4 border-t space-y-3">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                  <div>
                                    <span className="text-muted-foreground text-xs">Codigo:</span>{" "}
                                    <span className="font-mono font-medium">{comp.codigo}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Tipo:</span>{" "}
                                    <span className="font-medium">{comp.tipo}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Classe:</span>{" "}
                                    <span className="font-medium">{comp.classe}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Unidade:</span>{" "}
                                    <span className="font-medium">{comp.unidade}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">UF:</span>{" "}
                                    <span className="font-medium">{comp.uf}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Data Base:</span>{" "}
                                    <span className="font-medium">{comp.data_base}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Preco Desonerado:</span>{" "}
                                    <span className="font-semibold text-primary">{formatBRL(comp.preco_desonerado)}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Preco Nao Desonerado:</span>{" "}
                                    <span className="font-semibold">{formatBRL(comp.preco_nao_desonerado)}</span>
                                  </div>
                                </div>
                                <p className="text-sm">{comp.descricao}</p>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Database className="h-12 w-12 mb-4 opacity-40" />
                  <p className="text-lg font-medium">Nenhum item encontrado</p>
                  <p className="text-sm">Tente alterar os filtros ou a busca.</p>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
