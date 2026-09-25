import { IconKey, IconX, IconRefresh, IconCircleX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type {
  DbAdminColumn,
  DbAdminTableSchema,
} from "../../db-admin/types.js";
import { cn } from "../utils.js";
import {
  inferEditorKind,
  inferEnumValues,
  valueToEditString,
  parseEditValue,
  ParseError,
  type EditorKind,
} from "./cell-format.js";

export type RowSidePanelMode = "insert" | "edit";

export interface RowSidePanelProps {
  schema: DbAdminTableSchema;
  mode: RowSidePanelMode;
  /** For edit mode: the original row values. */
  row?: Record<string, unknown>;
  /** For edit mode: staged overrides already in the changeset. */
  staged?: Record<string, unknown>;
  onClose: () => void;
  /**
   * Persist into the changeset. For insert mode `values` is the full new-row
   * object; for edit mode it is only the changed columns.
   */
  onSave: (values: Record<string, unknown>) => void;
}

type FieldState = {
  /** Raw text in the input. */
  text: string;
  /** Whether the field is explicitly set to NULL. */
  isNull: boolean;
  /** Parse error, if any. */
  error?: string | null;
  /** Whether the user has touched this field (insert) — drives "blank = skip". */
  touched: boolean;
};

function initialFieldState(
  _col: DbAdminColumn,
  kind: EditorKind,
  value: unknown,
  isInsert: boolean,
): FieldState {
  const isNull = value === null || value === undefined;
  return {
    text: isNull ? "" : valueToEditString(value, kind),
    isNull: isInsert ? false : isNull,
    touched: false,
  };
}

export function RowSidePanel({
  schema,
  mode,
  row,
  staged,
  onClose,
  onSave,
}: RowSidePanelProps) {
  const isInsert = mode === "insert";
  const [fields, setFields] = useState<Record<string, FieldState>>(() => {
    const init: Record<string, FieldState> = {};
    for (const col of schema.columns) {
      const kind = inferEditorKind(col);
      const original = row?.[col.name];
      const value =
        staged && Object.prototype.hasOwnProperty.call(staged, col.name)
          ? staged[col.name]
          : original;
      init[col.name] = initialFieldState(col, kind, value, isInsert);
    }
    return init;
  });

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = (name: string, patch: Partial<FieldState>) =>
    setFields((prev) => ({
      ...prev,
      [name]: { ...prev[name], ...patch, touched: true },
    }));

  const save = () => {
    const out: Record<string, unknown> = {};
    let hadError = false;
    const nextFields = { ...fields };

    for (const col of schema.columns) {
      const kind = inferEditorKind(col);
      const fs = fields[col.name];
      const isGenerated = col.pk && col.autoIncrement;

      if (fs.isNull) {
        // Explicit NULL.
        if (!isInsert || fs.touched) out[col.name] = null;
        continue;
      }

      // Insert: blank, untouched, auto/pk/default columns are left out entirely.
      if (isInsert && fs.text === "" && !fs.touched) {
        continue;
      }
      if (isInsert && fs.text === "" && (isGenerated || col.defaultValue)) {
        continue;
      }

      // Edit: only include columns the user touched.
      if (!isInsert && !fs.touched) continue;

      try {
        const parsed = parseEditValue(fs.text, kind, {
          allowEmptyString: kind === "text",
        });
        out[col.name] = parsed;
      } catch (err) {
        hadError = true;
        nextFields[col.name] = {
          ...fs,
          error: err instanceof ParseError ? err.message : String(err),
        };
      }
    }

    if (hadError) {
      setFields(nextFields);
      return;
    }
    onSave(out);
    onClose();
  };

  const panel = (
    <div className="fixed inset-0 z-[400] flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {isInsert ? "Insert row" : "Edit row"}
            </h2>
            <p className="text-xs text-muted-foreground">{schema.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-4">
            {schema.columns.map((col) => (
              <RowField
                key={col.name}
                column={col}
                state={fields[col.name]}
                isInsert={isInsert}
                onChange={(patch) => update(col.name, patch)}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {isInsert ? "Stage insert" : "Stage changes"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(panel, document.body);
}

function RowField({
  column,
  state,
  isInsert: _isInsert,
  onChange,
}: {
  column: DbAdminColumn;
  state: FieldState;
  isInsert: boolean;
  onChange: (patch: Partial<FieldState>) => void;
}) {
  const kind = inferEditorKind(column);
  const enumValues = inferEnumValues(column);
  const isGenerated = column.pk && column.autoIncrement;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {column.pk && <IconKey className="h-3 w-3 text-amber-500" />}
        <label className="text-xs font-medium text-foreground">
          {column.name}
        </label>
        <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
          {column.type}
        </span>
        {!column.nullable && (
          <span className="text-[10px] text-destructive">required</span>
        )}
        {column.nullable && (
          <button
            type="button"
            onClick={() => onChange({ isNull: !state.isNull })}
            className={cn(
              "ml-auto rounded px-1.5 py-0.5 text-[10px]",
              state.isNull
                ? "bg-muted text-foreground ring-1 ring-inset ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {state.isNull ? "NULL" : "set null"}
          </button>
        )}
      </div>

      {state.isNull ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-2 py-1.5 text-xs italic text-muted-foreground/70">
          NULL
          <button
            type="button"
            onClick={() => onChange({ isNull: false })}
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Clear NULL"
          >
            <IconCircleX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : enumValues ? (
        <select
          value={state.text}
          onChange={(e) => onChange({ text: e.target.value, error: null })}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">—</option>
          {enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : kind === "boolean" ? (
        <select
          value={state.text}
          onChange={(e) => onChange({ text: e.target.value, error: null })}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : kind === "json" ? (
        <textarea
          value={state.text}
          onChange={(e) => onChange({ text: e.target.value, error: null })}
          rows={4}
          spellCheck={false}
          placeholder={isGenerated ? "(auto-generated)" : "{ }"}
          className={cn(
            "resize-y rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring",
            state.error && "border-destructive",
          )}
        />
      ) : (
        <input
          type="text"
          inputMode={kind === "number" ? "decimal" : undefined}
          value={state.text}
          onChange={(e) => onChange({ text: e.target.value, error: null })}
          placeholder={
            isGenerated
              ? "(auto-generated)"
              : column.defaultValue
                ? `default: ${column.defaultValue}`
                : ""
          }
          className={cn(
            "h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring",
            state.error && "border-destructive",
          )}
        />
      )}

      {column.defaultValue && !isGenerated && !state.isNull && (
        <span className="text-[10px] text-muted-foreground/70">
          default: {column.defaultValue}
        </span>
      )}
      {isGenerated && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
          <IconRefresh className="h-3 w-3" />
          auto-generated — leave blank
        </span>
      )}
      {state.error && (
        <span className="text-[10px] text-destructive">{state.error}</span>
      )}
    </div>
  );
}
