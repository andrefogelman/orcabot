import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  Proposta,
  PropostaInsert,
  PropostaItem,
  PropostaItemInsert,
  PropostaItemUpdate,
} from "@/types/orcamento";

export function usePropostas(projectId: string) {
  return useQuery({
    queryKey: ["propostas", projectId],
    queryFn: async (): Promise<Proposta[]> => {
      const { data, error } = await supabase
        .from("ob_propostas")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });
}

export function usePropostaItems(propostaId: string | null) {
  return useQuery({
    queryKey: ["proposta-items", propostaId],
    queryFn: async (): Promise<PropostaItem[]> => {
      const { data, error } = await supabase
        .from("ob_proposta_items")
        .select("*")
        .eq("proposta_id", propostaId!)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!propostaId,
  });
}

export function useCreateProposta() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (proposta: PropostaInsert) => {
      const { data, error } = await supabase
        .from("ob_propostas")
        .insert(proposta)
        .select()
        .single();

      if (error) throw error;
      return data as Proposta;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["propostas", data.project_id] });
    },
  });
}

export function useUpdatePropostaStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status, projectId }: { id: string; status: string; projectId: string }) => {
      const { error } = await supabase
        .from("ob_propostas")
        .update({ status })
        .eq("id", id);

      if (error) throw error;
      return { projectId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["propostas", data.projectId] });
    },
  });
}

export function useUpdatePropostaItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, propostaId, ...updates }: { id: string; propostaId: string } & PropostaItemUpdate) => {
      const { data, error } = await supabase
        .from("ob_proposta_items")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return { ...data, propostaId } as PropostaItem & { propostaId: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["proposta-items", (data as PropostaItem & { propostaId: string }).propostaId] });
    },
  });
}

export function useDeletePropostaItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, propostaId }: { id: string; propostaId: string }) => {
      const { error } = await supabase
        .from("ob_proposta_items")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return { propostaId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["proposta-items", data.propostaId] });
    },
  });
}

export function useImportablePropostas(projectId: string) {
  return useQuery({
    queryKey: ["propostas-importable", projectId],
    queryFn: async (): Promise<(Proposta & { items: PropostaItem[] })[]> => {
      const { data: propostas, error } = await supabase
        .from("ob_propostas")
        .select("*, ob_proposta_items(*)")
        .eq("project_id", projectId)
        .in("status", ["extracted", "reviewed"])
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (propostas ?? []).map((p: Record<string, unknown>) => ({
        ...(p as Proposta),
        items: (p.ob_proposta_items ?? []) as PropostaItem[],
      }));
    },
    enabled: !!projectId,
  });
}
