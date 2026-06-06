import { z, type ZodType, type ZodTypeAny } from "zod";

/**
 * Schema introspection for the auto-editor. Walks a block's zod `data` schema
 * and classifies each top-level field into a {@link FieldKind} the
 * `SchemaBlockEditor` knows how to render.
 *
 * zod v4 note: schemas expose `_def.type` (a string discriminator) rather than
 * v3's `typeName`. Object shape is `_def.shape`, array element is `_def.element`,
 * enum options are `.options`. `.describe()` does NOT propagate through
 * `.optional()`/`.default()`/`.nullable()` to the outer schema, so `unwrap`
 * inherits the innermost description while peeling wrapper layers.
 */

const MD_TAG = "x-an-field:markdown";
const RT_TAG = "x-an-field:richtext";

/**
 * Tag a string schema so the auto-editor renders it with the shared inline
 * rich-markdown editor (Notion-style editing) instead of a plain textarea.
 * Survives `.optional()` because `unwrap` reads the inner description.
 */
export function markdown(schema: ZodTypeAny = z.string()): ZodTypeAny {
  return schema.describe(MD_TAG);
}

/** Alias for {@link markdown} — tags a string field as rich text. */
export function richtext(schema: ZodTypeAny = z.string()): ZodTypeAny {
  return schema.describe(RT_TAG);
}

export type FieldKind =
  | "markdown"
  | "richtext"
  | "text"
  | "longtext"
  | "number"
  | "boolean"
  | "enum"
  | "array"
  | "object"
  | "unsupported";

export interface FieldDescriptor {
  key: string;
  /** Humanized key for the field label. */
  label: string;
  kind: FieldKind;
  optional: boolean;
  enumValues?: string[];
  /** Element schema for arrays / inner schema for objects. */
  inner?: ZodTypeAny;
  /** Element descriptors for object fields (one level of nesting). */
  fields?: FieldDescriptor[];
  /** Description tag, when present (used to detect markdown/richtext). */
  description?: string;
}

function defType(schema: ZodTypeAny): string | undefined {
  return (schema?._def as { type?: string } | undefined)?.type;
}

/** Peel optional/default/nullable/refine wrappers; keep the innermost description. */
function unwrap(schema: ZodTypeAny): {
  schema: ZodTypeAny;
  optional: boolean;
  description?: string;
} {
  let current = schema;
  let optional = false;
  let description: string | undefined = current?.description;
  // Bound the loop so a malformed schema can never spin forever.
  for (let i = 0; i < 12; i++) {
    const type = defType(current);
    const inner = (current._def as { innerType?: ZodTypeAny } | undefined)
      ?.innerType;
    if (type === "optional" || type === "nullable" || type === "nullish") {
      optional = true;
    } else if (type === "default" || type === "catch" || type === "readonly") {
      // not optional per se, but a wrapper to peel
    } else {
      break;
    }
    if (!inner) break;
    current = inner;
    description = description ?? current.description;
  }
  return { schema: current, optional, description };
}

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function classify(schema: ZodTypeAny, description?: string): FieldKind {
  if (description === MD_TAG) return "markdown";
  if (description === RT_TAG) return "richtext";
  const type = defType(schema);
  switch (type) {
    case "string": {
      // A long max length implies a textarea; otherwise a single-line input.
      const checks = (schema._def as { checks?: unknown[] } | undefined)
        ?.checks;
      const max = readMaxLength(checks);
      return max !== undefined && max > 240 ? "longtext" : "text";
    }
    case "number":
    case "bigint":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
      return "enum";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "unsupported";
  }
}

function readMaxLength(checks: unknown[] | undefined): number | undefined {
  if (!checks) return undefined;
  for (const check of checks) {
    const def = (
      check as { _zod?: { def?: { check?: string; maximum?: number } } }
    )?._zod?.def;
    if (def?.check === "max_length" && typeof def.maximum === "number") {
      return def.maximum;
    }
    // Fallback for shapes that expose the bound directly.
    const direct = check as { kind?: string; value?: number; maximum?: number };
    if (direct?.kind === "max" && typeof direct.value === "number") {
      return direct.value;
    }
    if (typeof direct?.maximum === "number") return direct.maximum;
  }
  return undefined;
}

function objectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | null {
  const rawShape = (schema._def as { shape?: unknown } | undefined)?.shape;
  if (!rawShape) return null;
  const shape = typeof rawShape === "function" ? rawShape() : rawShape;
  return shape && typeof shape === "object"
    ? (shape as Record<string, ZodTypeAny>)
    : null;
}

function describeField(key: string, raw: ZodTypeAny): FieldDescriptor {
  const { schema, optional, description } = unwrap(raw);
  const kind = classify(schema, description);
  const descriptor: FieldDescriptor = {
    key,
    label: humanize(key),
    kind,
    optional,
    description,
  };
  if (kind === "enum") {
    const options = (schema as { options?: unknown[] }).options;
    descriptor.enumValues = Array.isArray(options)
      ? options.map((value) => String(value))
      : [];
  } else if (kind === "array") {
    const element = (schema._def as { element?: ZodTypeAny } | undefined)
      ?.element;
    descriptor.inner = element;
    const elementShape = element ? objectShape(unwrap(element).schema) : null;
    if (elementShape) {
      descriptor.fields = Object.entries(elementShape).map(
        ([childKey, child]) => describeField(childKey, child),
      );
    }
  } else if (kind === "object") {
    descriptor.inner = schema;
    const shape = objectShape(schema);
    if (shape) {
      descriptor.fields = Object.entries(shape).map(([childKey, child]) =>
        describeField(childKey, child),
      );
    }
  }
  return descriptor;
}

/**
 * Introspect a block's `data` schema into a flat list of field descriptors. The
 * input is unwrapped to its object schema first (so an `.optional()`-wrapped or
 * `.refine()`-wrapped object still yields its fields).
 */
export function introspect(schema: ZodType<unknown>): FieldDescriptor[] {
  const { schema: unwrapped } = unwrap(schema as ZodTypeAny);
  const shape = objectShape(unwrapped);
  if (!shape) return [];
  return Object.entries(shape).map(([key, child]) => describeField(key, child));
}
