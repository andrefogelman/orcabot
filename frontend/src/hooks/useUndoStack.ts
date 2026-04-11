import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OrcamentoItem } from "@/types/orcamento";
import type { EapPatch } from "@/lib/eap";

export type UndoAction =
  | {
      type: "update";
      table: string;
      itemId: string;
      projectId: string;
      previousData: Record<string, unknown>;
    }
  | {
      type: "create";
      table: string;
      itemId: string;
      projectId: string;
      previousData: Record<string, unknown>;
    }
  | {
      type: "delete";
      table: string;
      itemId: string;
      projectId: string;
      previousData: Record<string, unknown>;
    }
  | {
      type: "insert-with-renumber";
      projectId: string;
      createdItemId: string;
      snapshot: EapPatch[];
    }
  | {
      type: "delete-with-renumber";
      projectId: string;
      deletedItems: OrcamentoItem[];
      snapshot: EapPatch[];
    };

const MAX_UNDO_STACK = 10;

export function useUndoStack() {
  const stackRef = useRef<UndoAction[]>([]);
  const queryClient = useQueryClient();

  const push = useCallback((action: UndoAction) => {
    stackRef.current = [
      ...stackRef.current.slice(-(MAX_UNDO_STACK - 1)),
      action,
    ];
  }, []);

  const undo = useCallback(async () => {
    const action = stackRef.current.pop();
    if (!action) {
      toast.info("Nada para desfazer");
      return;
    }

    try {
      switch (action.type) {
        case "update": {
          const { error } = await supabase
            .from(action.table)
            .update(action.previousData)
            .eq("id", action.itemId);
          if (error) throw error;
          break;
        }
        case "create": {
          const { error } = await supabase
            .from(action.table)
            .delete()
            .eq("id", action.itemId);
          if (error) throw error;
          break;
        }
        case "delete": {
          const { error } = await supabase
            .from(action.table)
            .insert(action.previousData);
          if (error) throw error;
          break;
        }
        case "insert-with-renumber": {
          // 1. Delete the created item
          const delRes = await supabase
            .from("ob_orcamento_items")
            .delete()
            .eq("id", action.createdItemId);
          if (delRes.error) throw delRes.error;
          // 2. Revert the renumbering
          if (action.snapshot.length > 0) {
            const { error } = await supabase.rpc("revert_renumber", {
              p_project_id: action.projectId,
              p_snapshot: action.snapshot,
            });
            if (error) throw error;
          }
          break;
        }
        case "delete-with-renumber": {
          // 1. Revert the renumbering (returns old codes to survivors)
          if (action.snapshot.length > 0) {
            const { error: rpcErr } = await supabase.rpc("revert_renumber", {
              p_project_id: action.projectId,
              p_snapshot: action.snapshot,
            });
            if (rpcErr) throw rpcErr;
          }
          // 2. Re-insert deleted items preserving their IDs
          if (action.deletedItems.length > 0) {
            const { error: insErr } = await supabase
              .from("ob_orcamento_items")
              .insert(action.deletedItems);
            if (insErr) throw insErr;
          }
          break;
        }
      }

      queryClient.invalidateQueries({
        queryKey: ["orcamento", action.projectId],
      });
      toast.success("Ação desfeita");
    } catch (err) {
      console.error("Undo failed:", err);
      toast.error("Erro ao desfazer ação");
      // Push back the action so user can retry
      stackRef.current.push(action);
    }
  }, [queryClient]);

  // Listen for Ctrl+Z
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo]);

  return { push, undo };
}
