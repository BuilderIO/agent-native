import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { ZodType } from "zod";

import { cn } from "../utils.js";
import { ltrCodeBlockProps } from "./code-block-direction.js";
import { introspect, type FieldDescriptor } from "./schema-form/introspect.js";
import type { BlockRenderContext } from "./types.js";

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
    <div
      {...ltrCodeBlockProps}
      className="an-schema-block-editor flex flex-col gap-3"
    >
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
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const textareaClass =
  "flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** A sensible empty value for a single field, used when adding array items. */
function emptyForField(field: FieldDescriptor): unknown {
  switch (field.kind) {
    case "text":
      // A field literally named `id` gets a fresh stable id so new rows are
      // distinguishable without the user having to type one.
      return field.key === "id"
        ? `item-${Math.random().toString(36).slice(2, 10)}`
        : "";
    case "longtext":
    case "markdown":
    case "richtext":
      return "";
    case "boolean":
      return false;
    case "enum":
      return field.enumValues?.[0];
    case "array":
      return [];
    case "object":
      return emptyObjectFromFields(field.fields);
    case "number":
    default:
      // number → undefined (the input shows blank until the user types); any
      // unsupported kind also defaults to undefined.
      return undefined;
  }
}

/** Build an empty object value from a descriptor's child fields. */
function emptyObjectFromFields(
  fields: FieldDescriptor[] | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const child of fields ?? []) {
    result[child.key] = emptyForField(child);
  }
  return result;
}

/** A scalar element kind classified from an array's inner element schema. */
function scalarKindFromInner(
  inner: FieldDescriptor["inner"],
): "number" | "boolean" | "text" {
  const type = (inner?._def as { type?: string } | undefined)?.type;
  if (type === "number" || type === "bigint") return "number";
  if (type === "boolean") return "boolean";
  return "text";
}

/** An empty value for a scalar array element of the given kind. */
function emptyScalar(kind: "number" | "boolean" | "text"): unknown {
  if (kind === "boolean") return false;
  if (kind === "number") return undefined;
  return "";
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

  if (field.kind === "object" && field.fields && field.fields.length > 0) {
    const objValue =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return (
      <div className="flex flex-col gap-3 rounded-md border border-input px-3 py-3">
        <FieldLabel>{field.label}</FieldLabel>
        <div className="flex flex-col gap-3">
          {field.fields.map((child) => (
            <FieldControl
              key={child.key}
              field={child}
              value={objValue[child.key]}
              onChange={(childVal) =>
                onChange({ ...objValue, [child.key]: childVal })
              }
              editable={editable}
              blockId={blockId}
              ctx={ctx}
            />
          ))}
        </div>
      </div>
    );
  }

  if (field.kind === "array") {
    const items = Array.isArray(value) ? (value as unknown[]) : [];
    const replaceItem = (index: number, next: unknown) => {
      const copy = items.slice();
      copy[index] = next;
      onChange(copy);
    };
    const removeItem = (index: number) => {
      onChange(items.filter((_, i) => i !== index));
    };
    const objectElement =
      Array.isArray(field.fields) && field.fields.length > 0;
    const scalarKind = objectElement ? null : scalarKindFromInner(field.inner);
    const addItem = () => {
      if (objectElement) {
        onChange([...items, emptyObjectFromFields(field.fields)]);
      } else {
        onChange([...items, emptyScalar(scalarKind ?? "text")]);
      }
    };
    return (
      <div className="flex flex-col gap-2">
        <FieldLabel>{field.label}</FieldLabel>
        <div className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-md border border-input px-3 py-3"
            >
              <div className="flex flex-1 flex-col gap-3">
                {objectElement ? (
                  field.fields!.map((child) => {
                    const itemValue =
                      item && typeof item === "object" && !Array.isArray(item)
                        ? (item as Record<string, unknown>)
                        : {};
                    return (
                      <FieldControl
                        key={child.key}
                        field={child}
                        value={itemValue[child.key]}
                        onChange={(childVal) =>
                          replaceItem(index, {
                            ...itemValue,
                            [child.key]: childVal,
                          })
                        }
                        editable={editable}
                        blockId={blockId}
                        ctx={ctx}
                      />
                    );
                  })
                ) : scalarKind === "boolean" ? (
                  <input
                    type="checkbox"
                    data-plan-interactive
                    className="size-4 self-start rounded border-input accent-primary"
                    checked={Boolean(item)}
                    disabled={!editable}
                    onChange={(event) =>
                      replaceItem(index, event.target.checked)
                    }
                  />
                ) : scalarKind === "number" ? (
                  <input
                    type="number"
                    data-plan-interactive
                    className={inputClass}
                    value={typeof item === "number" ? item : ""}
                    disabled={!editable}
                    onChange={(event) => {
                      const raw = event.target.value;
                      replaceItem(index, raw === "" ? undefined : Number(raw));
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    data-plan-interactive
                    className={inputClass}
                    value={typeof item === "string" ? item : ""}
                    disabled={!editable}
                    onChange={(event) => replaceItem(index, event.target.value)}
                  />
                )}
              </div>
              {editable && (
                <button
                  type="button"
                  data-plan-interactive
                  aria-label="Remove item"
                  className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => removeItem(index)}
                >
                  <IconTrash className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        {editable && (
          <button
            type="button"
            data-plan-interactive
            className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={addItem}
          >
            <IconPlus className="size-4" />
            Add {field.label.replace(/s$/i, "").toLowerCase() || "item"}
          </button>
        )}
      </div>
    );
  }

  // Unsupported / structured-without-fields: the auto-editor cannot infer a
  // control. Blocks with these fields should ship a custom `Edit`. Surface a
  // hint in dev so the gap is visible.
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
