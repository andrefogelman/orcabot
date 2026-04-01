import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

interface RealtimeSubscriptionOptions {
  table: string;
  filterColumn?: string;
  filterValue?: string;
  queryKeys: string[][];
  enabled?: boolean;
  onChangeCallback?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

export function useRealtimeSubscription({
  table,
  filterColumn,
  filterValue,
  queryKeys,
  enabled = true,
  onChangeCallback,
}: RealtimeSubscriptionOptions) {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const filter = filterColumn && filterValue
      ? `${filterColumn}=eq.${filterValue}`
      : undefined;

    const channel = supabase
      .channel(`realtime-${table}-${filterValue ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter,
        },
        (payload) => {
          for (const key of queryKeys) {
            queryClient.invalidateQueries({ queryKey: key });
          }
          onChangeCallback?.(payload);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filterColumn, filterValue, enabled]);
}
