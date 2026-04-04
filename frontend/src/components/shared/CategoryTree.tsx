import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface TreeNode {
  id: string;
  label: string;
  count?: number;
  children?: TreeNode[];
}

interface CategoryTreeProps {
  tree: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function TreeNodeItem({
  node,
  depth,
  selectedId,
  onSelect,
  expandedNodes,
  toggleExpand,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  expandedNodes: Set<string>;
  toggleExpand: (id: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedId === node.id;
  const isRoot = depth === 0;

  const handleClick = () => {
    if (hasChildren) {
      toggleExpand(node.id);
    }
    // Select/deselect — toggle if clicking same node
    onSelect(isSelected ? null : node.id);
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors text-left",
          isSelected
            ? "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200"
            : "hover:bg-muted/60",
          isRoot && "font-semibold",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand/collapse icon */}
        {hasChildren ? (
          <span className="shrink-0 w-4 h-4 flex items-center justify-center">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Folder icon */}
        {isExpanded || isSelected ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-orange-500" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        {/* Label */}
        <span className="flex-1 truncate">{node.label}</span>

        {/* Count badge */}
        {node.count != null && node.count > 0 && (
          <Badge
            variant="secondary"
            className={cn(
              "shrink-0 text-[10px] px-1.5 py-0 h-5 min-w-[1.5rem] justify-center",
              isSelected && "bg-orange-200/80 text-orange-900 dark:bg-orange-800/50 dark:text-orange-100",
            )}
          >
            {node.count}
          </Badge>
        )}
      </button>

      {/* Children with smooth collapse */}
      {hasChildren && (
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
          )}
        >
          {node.children!.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedNodes={expandedNodes}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoryTree({ tree, selectedId, onSelect }: CategoryTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-0.5 py-2">
      {tree.map((node) => (
        <TreeNodeItem
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          expandedNodes={expandedNodes}
          toggleExpand={toggleExpand}
        />
      ))}
    </div>
  );
}
