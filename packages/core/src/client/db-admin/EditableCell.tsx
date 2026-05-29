import { useEffect, useRef, useState } from "react";
import {
  IconChevronDown,
  IconCircleX,
  IconMaximize,
} from "@tabler/icons-react";
import { cn } from "../utils.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  type EditorKind,
  formatCellValue,
  inferEnumValues,
  valueToEditString,
  parseEditValue,
  ParseError,
  cycleTriStateBoolean,
  formatJsonPretty,
} from "./cell-format.js";
import type { DbAdminColumn } from "../../db-admin/types.js";

export interface EditableCellProps {
  column: DbAdminColumn;
  kind: EditorKind;
  value: unknown;
  /** Whether this cell holds a staged (uncommitted) edit. */
  dirty?: boolean;
  /** Whether editing is allowed (false when the table has no PK). */
  editable?: boolean;
  /** Whether this cell is the keyboard-focused/active cell in the grid. */
  active?: boolean;
  /** True if the editor should open immediately (e.g. typing began). */
  editing?: boolean;
  /** Commit a new value into the changeset. */
  onCommit: (value: unknown) => void;
  /** Request entering edit mode. */
  onStartEdit?: () => void;
  /** Request leaving edit mode without committing. */
  onCancelEdit?: () => void;
  /** Move focus after Enter ("down") or Tab ("right"). */
  onNavigate?: (dir: "up" | "down" | "left" | "right") => void;
  className?: string;
}

const NULL_TOKEN = (
  <span className="italic text-muted-foreground/60 select-none">NULL</span>
);

export function EditableCell({
  column,
  kind,
  value,
  dirty,
  editable = true,
  active,
  editing,
  onCommit,
  onStartEdit,
  onCancelEdit,
  onNavigate,
  className,
}: EditableCellProps) {
  const display = formatCellValue(value, kind);

  // Boolean cells toggle in place rather than opening a text editor.
  if (kind === "boolean") {
    return (
      <BooleanCell
        value={value}
        dirty={dirty}
        editable={editable}
        active={active}
        onCommit={onCommit}
        onNavigate={onNavigate}
        className={className}
      />
    );
  }

  const baseCell = cn(
    "relative h-full w-full px-2 py-1 text-xs truncate outline-none",
    "font-mono",
    active && "ring-1 ring-inset ring-ring",
    dirty && "bg-amber-500/10 ring-1 ring-inset ring-amber-500/50",
    editable && "cursor-text",
    className,
  );

  if (editing && editable) {
    if (kind === "enum") {
      return (
        <EnumEditor
          column={column}
          value={value}
          onCommit={onCommit}
          onCancel={onCancelEdit}
          onNavigate={onNavigate}
        />
      );
    }
    if (kind === "json") {
      return (
        <JsonEditor value={value} onCommit={onCommit} onCancel={onCancelEdit} />
      );
    }
    return (
      <InlineTextEditor
        kind={kind}
        value={value}
        nullable={column.nullable}
        onCommit={onCommit}
        onCancel={onCancelEdit}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div
      role="gridcell"
      tabIndex={active ? 0 : -1}
      className={baseCell}
      onDoubleClick={() => editable && onStartEdit?.()}
      onKeyDown={(e) => {
        if (!editable) return;
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          onStartEdit?.();
        }
      }}
      title={display.isNull ? "NULL" : display.text}
    >
      <div className="flex items-center gap-1">
        <span className="truncate">
          {display.isNull ? NULL_TOKEN : display.text}
        </span>
        {editable && (kind === "json" || kind === "text") && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit?.();
            }}
            className="ml-auto shrink-0 text-muted-foreground/50 opacity-0 hover:text-foreground group-hover:opacity-100"
            aria-label="Expand editor"
          >
            <IconMaximize className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Boolean (tri-state) ─────────────────────────────────────────────────────

function BooleanCell({
  value,
  dirty,
  editable,
  active,
  onCommit,
  onNavigate,
  className,
}: {
  value: unknown;
  dirty?: boolean;
  editable: boolean;
  active?: boolean;
  onCommit: (v: unknown) => void;
  onNavigate?: (dir: "up" | "down" | "left" | "right") => void;
  className?: string;
}) {
  const label = value === true ? "true" : value === false ? "false" : null;
  return (
    <div
      role="gridcell"
      tabIndex={active ? 0 : -1}
      className={cn(
        "h-full w-full px-2 py-1 text-xs font-mono outline-none cursor-pointer select-none",
        active && "ring-1 ring-inset ring-ring",
        dirty && "bg-amber-500/10 ring-1 ring-inset ring-amber-500/50",
        className,
      )}
      onClick={() => editable && onCommit(cycleTriStateBoolean(value))}
      onKeyDown={(e) => {
        if (!editable) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onCommit(cycleTriStateBoolean(value));
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          onNavigate?.("down");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          onNavigate?.("up");
        }
      }}
    >
      {label === null ? NULL_TOKEN : label}
    </div>
  );
}

// ─── Inline text / number / timestamp / uuid editor ──────────────────────────

function InlineTextEditor({
  kind,
  value,
  nullable,
  onCommit,
  onCancel,
  onNavigate,
}: {
  kind: EditorKind;
  value: unknown;
  nullable: boolean;
  onCommit: (v: unknown) => void;
  onCancel?: () => void;
  onNavigate?: (dir: "up" | "down" | "left" | "right") => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => valueToEditString(value, kind));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = (nav?: "down" | "right") => {
    try {
      const parsed = parseEditValue(text, kind);
      setError(null);
      onCommit(parsed);
      if (nav) onNavigate?.(nav);
    } catch (err) {
      setError(err instanceof ParseError ? err.message : String(err));
    }
  };

  return (
    <div className="relative h-full w-full">
      <input
        ref={ref}
        type="text"
        inputMode={kind === "number" ? "decimal" : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit("down");
          } else if (e.key === "Tab") {
            e.preventDefault();
            commit("right");
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel?.();
          }
        }}
        className={cn(
          "h-full w-full bg-background px-2 py-1 text-xs font-mono outline-none",
          "ring-2 ring-inset ring-ring",
          error && "ring-destructive",
        )}
      />
      {nullable && (
        <button
          type="button"
          tabIndex={-1}
          title="Set NULL"
          onMouseDown={(e) => {
            e.preventDefault();
            onCommit(null);
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
        >
          <IconCircleX className="h-3.5 w-3.5" />
        </button>
      )}
      {error && (
        <div className="absolute left-0 top-full z-50 mt-0.5 rounded border border-destructive bg-popover px-2 py-1 text-[11px] text-destructive shadow-md">
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Enum (select) editor ────────────────────────────────────────────────────

function EnumEditor({
  column,
  value,
  onCommit,
  onCancel,
  onNavigate,
}: {
  column: DbAdminColumn;
  value: unknown;
  onCommit: (v: unknown) => void;
  onCancel?: () => void;
  onNavigate?: (dir: "up" | "down" | "left" | "right") => void;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  const options = inferEnumValues(column) ?? [];

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <select
      ref={ref}
      defaultValue={value === null || value === undefined ? "" : String(value)}
      onChange={(e) => {
        const v = e.target.value;
        onCommit(v === "" ? null : v);
        onNavigate?.("down");
      }}
      onBlur={() => onCancel?.()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel?.();
      }}
      className="h-full w-full appearance-none bg-background px-2 py-1 text-xs font-mono outline-none ring-2 ring-inset ring-ring"
    >
      {column.nullable && <option value="">NULL</option>}
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

// ─── JSON / long-text expanding editor ───────────────────────────────────────

function JsonEditor({
  value,
  onCommit,
  onCancel,
}: {
  value: unknown;
  onCommit: (v: unknown) => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState(() => formatJsonPretty(value));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (text.trim() === "") {
      onCommit(null);
      setOpen(false);
      return;
    }
    try {
      const parsed = parseEditValue(text, "json");
      setError(null);
      onCommit(parsed);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ParseError ? err.message : String(err));
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel?.();
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full items-center gap-1 px-2 py-1 text-xs font-mono ring-2 ring-inset ring-ring outline-none"
        >
          <span className="truncate">{formatJsonPretty(value) || "{}"}</span>
          <IconChevronDown className="ml-auto h-3 w-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[28rem] p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel?.();
            }
          }}
          rows={10}
          spellCheck={false}
          className={cn(
            "w-full resize-y rounded border border-border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring",
            error && "border-destructive",
          )}
        />
        {error && (
          <div className="mt-1 text-[11px] text-destructive">{error}</div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onCommit(null);
              setOpen(false);
            }}
            className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Set NULL
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onCancel?.()}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Apply
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
