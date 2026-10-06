import type { ZodType } from "zod";

import { collectEnvAliases } from "./env-layer.js";
import { appConfigSchema } from "./schema.js";

export interface ConfigFieldDescription {
  path: string;
  env: string[];
  type: string;
  doc?: string;
  defaultValue?: unknown;
  required: boolean;
}

interface ZodInternals {
  def: {
    type: string;
    innerType?: unknown;
    shape?: Record<string, unknown>;
    defaultValue?: unknown;
  };
}

function internals(schema: unknown): ZodInternals {
  return (schema as { _zod: ZodInternals })._zod;
}

const WRAPPER_TYPES = new Set([
  "optional",
  "default",
  "prefault",
  "nullable",
  "readonly",
]);

export function describeConfigFields(
  schema: ZodType = appConfigSchema,
): ConfigFieldDescription[] {
  const fields: ConfigFieldDescription[] = [];

  const visit = (node: unknown, path: string[]): void => {
    const meta = (
      node as { meta?: () => Record<string, unknown> | undefined }
    ).meta?.();

    let inner = node;
    let optional = false;
    let defaultValue: unknown;
    while (WRAPPER_TYPES.has(internals(inner).def.type)) {
      const { type, innerType, defaultValue: declared } = internals(inner).def;
      if (type === "optional" || type === "nullable") optional = true;
      if (type === "default" || type === "prefault") {
        defaultValue = typeof declared === "function" ? declared() : declared;
        optional = true;
      }
      if (innerType === undefined) break;
      inner = innerType;
    }

    const { type, shape } = internals(inner).def;
    if (type === "object" && shape) {
      for (const [key, child] of Object.entries(shape)) {
        visit(child, [...path, key]);
      }
      return;
    }

    const env = meta?.env;
    fields.push({
      path: path.join("."),
      env: typeof env === "string" ? [env] : Array.isArray(env) ? env : [],
      type,
      doc: typeof meta?.doc === "string" ? meta.doc : undefined,
      defaultValue,
      required: !optional,
    });
  };

  visit(schema, []);
  return fields;
}

export function declaredEnvKeys(schema: ZodType = appConfigSchema): string[] {
  const keys = new Set<string>();
  for (const alias of collectEnvAliases(schema)) {
    for (const key of alias.env) keys.add(key);
  }
  return [...keys].sort();
}
