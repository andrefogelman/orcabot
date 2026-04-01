import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatBRL, formatNumber, formatPercent, parseBRNumber } from "@/lib/format";

type CellType = "text" | "number" | "currency" | "percent" | "unit" | "readonly-currency" | "readonly-number";

interface BudgetCellProps {
  value: string | number | null;
  type: CellType;
  onChange: (value: string | number) => void;
  className?: string;
  readOnly?: boolean;
}

export function BudgetCell({ value, type, onChange, className, readOnly }: BudgetCellProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const isReadOnly = readOnly || type.startsWith("readonly");

  function displayValue(): string {
    if (value === null || value === undefined || value === "") return "—";
    switch (type) {
      case "currency":
      case "readonly-currency":
        return formatBRL(Number(value));
      case "number":
      case "readonly-number":
        return formatNumber(Number(value));
      case "percent":
        return formatPercent(Number(value));
      case "unit":
      case "text":
      default:
        return String(value);
    }
  }

  function handleDoubleClick() {
    if (isReadOnly) return;
    setEditing(true);
    setEditValue(value !== null && value !== undefined ? String(value) : "");
  }

  function handleBlur() {
    setEditing(false);
    commitValue();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      setEditing(false);
      commitValue();
    }
    if (e.key === "Escape") {
      setEditing(false);
    }
  }

  function commitValue() {
    if (type === "currency" || type === "number" || type === "percent") {
      const parsed = parseBRNumber(editValue);
      onChange(parsed);
    } else {
      onChange(editValue);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full border-none bg-transparent px-2 py-1 text-sm outline-none budget-cell-editing",
          className
        )}
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        "cursor-default select-none truncate px-2 py-1 text-sm",
        !isReadOnly && "cursor-cell hover:bg-accent/30",
        className
      )}
      title={displayValue()}
    >
      {displayValue()}
    </div>
  );
}
