import { z, type ZodType, type ZodTypeAny } from "zod";

const MD_TAG = "x-an-field:markdown";
const RT_TAG = "x-an-field:richtext";

export function markdown(schema: ZodTypeAny = z.string()): ZodTypeAny {
  return schema.describe(MD_TAG);
}

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
  label: string;
  kind: FieldKind;
  optional: boolean;
  enumValues?: string[];
  inner?: ZodTypeAny;
  fields?: FieldDescriptor[];
  description?: string;
}

function defType(schema: ZodTypeAny): string | undefined {
  return (schema?._def as { type?: string } | undefined)?.type;
}

function unwrap(schema: ZodTypeAny): {
  schema: ZodTypeAny;
  optional: boolean;
  description?: string;
} {
  let current = schema;
  let optional = false;
  let description: string | undefined = current?.description;
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

export function introspect(schema: ZodType<unknown>): FieldDescriptor[] {
  const { schema: unwrapped } = unwrap(schema as ZodTypeAny);
  const shape = objectShape(unwrapped);
  if (!shape) return [];
  return Object.entries(shape).map(([key, child]) => describeField(key, child));
}
