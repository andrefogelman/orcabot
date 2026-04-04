import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SinapiChunk {
  id: string;
  source_file: string;
  source_title: string;
  page_number: number | null;
  content: string;
  content_length: number;
  similarity?: number;
}

export interface CadernoSummary {
  source_file: string;
  source_title: string;
  chunk_count: number;
}

export interface CadernoQueryResult {
  answer: string;
  sources: Array<{
    title: string;
    page?: number;
    source_file?: string;
  }>;
}

/**
 * List all unique cadernos with chunk count.
 */
export function useCadernoList() {
  return useQuery<CadernoSummary[]>({
    queryKey: ["sinapi-cadernos-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ob_sinapi_chunks")
        .select("source_file, source_title");

      if (error) throw error;

      // Aggregate by source_file
      const map = new Map<string, { source_title: string; count: number }>();
      for (const row of data ?? []) {
        const existing = map.get(row.source_file);
        if (existing) {
          existing.count++;
        } else {
          map.set(row.source_file, {
            source_title: row.source_title,
            count: 1,
          });
        }
      }

      return Array.from(map.entries())
        .map(([source_file, { source_title, count }]) => ({
          source_file,
          source_title,
          chunk_count: count,
        }))
        .sort((a, b) => a.source_title.localeCompare(b.source_title));
    },
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Mutation: ask AI a question about the cadernos técnicos.
 * Calls POST /api/caderno-query on the W5 backend.
 */
export function useCadernoQuery() {
  const ORCABOT_API =
    import.meta.env.VITE_ORCABOT_API_URL || "http://100.66.83.22:8300";
  const API_SECRET = import.meta.env.VITE_ORCABOT_API_SECRET || "";

  return useMutation<CadernoQueryResult, Error, { question: string }>({
    mutationFn: async ({ question }) => {
      const res = await fetch(`${ORCABOT_API}/api/caderno-query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_SECRET}`,
        },
        body: JSON.stringify({ question }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(
          (err as { error?: string }).error || `HTTP ${res.status}`,
        );
      }

      return res.json() as Promise<CadernoQueryResult>;
    },
  });
}
