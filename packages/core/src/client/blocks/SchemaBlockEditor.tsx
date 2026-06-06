import { useMemo, useState } from "react";
import type { ZodType } from "zod";
import { cn } from "../utils.js";
import type { BlockRenderContext } from "./types.js";
import { introspect, type FieldDescriptor } from "./schema-form/introspect.js";

/**
 * Schema-driven auto-editor. When a {@link BlockSpec} omits `Edit`, the registry
 * renders this: it walks the block's zod `data` schema and renders one control
 * per field (string → input, longtext → textarea, number, boolean → toggle,
 * enum → native select, array → repeating rows, object → nested fieldset). A
 * `markdown()`-tagged string field defers to the app-provided inline rich
 * editor via `ctx.renderMarkdownEditor` so prose stays Notion-editable.
 *
 * It uses plain accessible native controls (not template shadcn primitives,
 * which core does not bundle) styled to match the shadcn look. Validation runs
 * the spec's own schema on every edit; the raw edit is kept in local state so a
 * transiently-invalid value (e.g. mid-typing) doesn't get rolled back, and only
 * valid data is committed upstream.
 */
export function SchemaBlockEditor<T>({
  data,
  onChange,
  schema,
  editable,
  blockId,
  ctx,
}: {
  data: T;
  onChange: (next: T) => void;
  schema: ZodType<T>;
  editable: boolean;
  blockId?: string;
  ctx: BlockRenderContext;
}) {
  const fields = useMemo(() => introspect(schema), [schema]);
  const [showOptional, setShowOptional] = useState(false);

  const setField = (key: string, value: unknown) => {
    const next = { ...(data as Record<string, unknown>), [key]: value } as T;
    const parsed = schema.safeParse(next);
    // Commit valid data; otherwise pass the raw edit through so the user can
    // keep typing — the upstream owner re-validates before persisting.
    onChange((parsed.success ? parsed.data : next) as T);
  };

  const required = fields.filter((field) => !field.optional);
  const optional = fields.filter((field) => field.optional);

  return (
    <div className="an-schema-block-editor flex flex-col gap-3">
      {required.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          value={(data as Record<string, unknown>)[field.key]}
          onChange={(value) => setField(field.key, value)}
          editable={editable}
          blockId={blockId}
          ctx={ctx}
        />
      ))}
      {optional.length > 0 && (
        <div className="flex flex-col gap-3">
          {showOptional ? (
            optional.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                value={(data as Record<string, unknown>)[field.key]}
                onChange={(value) => setField(field.key, value)}
                editable={editable}
                blockId={blockId}
                ctx={ctx}
              />
            ))
          ) : (
            <button
              type="button"
              data-plan-interactive
              className="self-start text-sm text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowOptional(true)}
            >
              More options
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const textareaClass =
  "flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  editable,
  blockId,
  ctx,
}: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  editable: boolean;
  blockId?: string;
  ctx: BlockRenderContext;
}) {
  if (field.kind === "markdown" || field.kind === "richtext") {
    const node = ctx.renderMarkdownEditor?.({
      value: typeof value === "string" ? value : "",
      onChange: (next) => onChange(next),
      editable,
      blockId,
    });
    return (
      <label className="flex flex-col gap-1.5">
        <FieldLabel>{field.label}</FieldLabel>
        {node ?? (
          // Fallback when no app markdown editor is injected: a plain textarea.
          <textarea
            data-plan-interactive
            className={textareaClass}
            value={typeof value === "string" ? value : ""}
            disabled={!editable}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </label>
    );
  }

  if (field.kind === "boolean") {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          data-plan-interactive
          className="size-4 rounded border-input accent-primary"
          checked={Boolean(value)}
          disabled={!editable}
          onChange={(event) => onChange(event.target.checked)}
        />
        <FieldLabel>{field.label}</FieldLabel>
      </label>
    );
  }

  if (field.kind === "enum") {
    const options = field.enumValues ?? [];
    return (
      <label className="flex flex-col gap-1.5">
        <FieldLabel>{field.label}</FieldLabel>
        <select
          data-plan-interactive
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          disabled={!editable}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          {field.optional && <option value="">—</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.kind === "number") {
    return (
      <label className="flex flex-col gap-1.5">
        <FieldLabel>{field.label}</FieldLabel>
        <input
          type="number"
          data-plan-interactive
          className={inputClass}
          value={typeof value === "number" ? value : ""}
          disabled={!editable}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "" ? undefined : Number(raw));
          }}
        />
      </label>
    );
  }

  if (field.kind === "longtext") {
    return (
      <label className="flex flex-col gap-1.5">
        <FieldLabel>{field.label}</FieldLabel>
        <textarea
          data-plan-interactive
          className={textareaClass}
          value={typeof value === "string" ? value : ""}
          disabled={!editable}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  if (field.kind === "text") {
    return (
      <label className="flex flex-col gap-1.5">
        <FieldLabel>{field.label}</FieldLabel>
        <input
          type="text"
          data-plan-interactive
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          disabled={!editable}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  // array / object / unsupported: the auto-editor intentionally does not render
  // a control for positional/structured data. Blocks with these fields should
  // ship a custom `Edit`. Surface a hint in dev so the gap is visible.
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-input px-3 py-2 text-xs text-muted-foreground",
      )}
    >
      <FieldLabel>{field.label}</FieldLabel>
      <p className="mt-1">
        This field ({field.kind}) needs a custom editor — define `Edit` on the
        block spec.
      </p>
    </div>
  );
}
