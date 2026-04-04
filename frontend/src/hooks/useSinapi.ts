import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SinapiComposicao {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  tipo: string;        // "INSUMO" | "COMPOSICAO"
  classe: string;      // "MATERIAIS" | "MAO DE OBRA" | "EQUIPAMENTOS" | etc
  uf: string;
  data_base: string;
  preco_desonerado: number;
  preco_nao_desonerado: number;
}

export interface SinapiCounts {
  byTipo: Record<string, number>;
  byClasse: Record<string, number>;
  total: number;
}

/**
 * Search SINAPI composições with optional filters.
 */
export function useSinapiSearch(query: string, tipo: string | null, classe: string | null) {
  return useQuery<SinapiComposicao[]>({
    queryKey: ["sinapi-composicoes", query, tipo, classe],
    queryFn: async () => {
      let q = supabase
        .from("ob_sinapi_composicoes")
        .select("*")
        .order("codigo", { ascending: true });

      if (tipo) {
        q = q.eq("tipo", tipo);
      }

      if (classe) {
        q = q.eq("classe", classe);
      }

      if (query.trim()) {
        q = q.or(`descricao.ilike.%${query.trim()}%,codigo.ilike.%${query.trim()}%`);
      }

      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data ?? [];
    },
    placeholderData: (prev) => prev,
  });
}

/**
 * Get counts by tipo and classe for the tree badges.
 */
export function useSinapiCounts() {
  return useQuery<SinapiCounts>({
    queryKey: ["sinapi-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ob_sinapi_composicoes")
        .select("tipo, classe");
      if (error) throw error;

      const byTipo: Record<string, number> = {};
      const byClasse: Record<string, number> = {};
      let total = 0;

      for (const row of data ?? []) {
        byTipo[row.tipo] = (byTipo[row.tipo] ?? 0) + 1;
        byClasse[row.classe] = (byClasse[row.classe] ?? 0) + 1;
        total++;
      }

      return { byTipo, byClasse, total };
    },
    staleTime: 1000 * 60 * 5,
  });
}
