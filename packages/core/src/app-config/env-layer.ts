import type { ZodType } from "zod";


export interface EnvAlias {
  path: string[];
  env: string[];
  type: string;
}

interface ZodInternals {
  def: {
    type: string;
    innerType?: unknown;
    shape?: Record<string, unknown>;
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

const MAX_WRAPPER_DEPTH = 10;

function unwrap(schema: unknown, path: string[]): unknown {
  let node = schema;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth += 1) {
    const { type, innerType } = internals(node).def;
    if (!WRAPPER_TYPES.has(type) || innerType === undefined) return node;
    node = innerType;
  }
  throw new Error(
    `Config field "${path.join(".")}" wraps more than ${MAX_WRAPPER_DEPTH} modifiers deep`,
  );
}

function readEnvMeta(node: unknown): string[] | undefined {
  const meta = (
    node as { meta?: () => Record<string, unknown> | undefined }
  ).meta?.();
  const env = meta?.env;
  const keys = typeof env === "string" ? [env] : Array.isArray(env) ? env : [];
  const valid = keys.filter(
    (key): key is string => typeof key === "string" && key.length > 0,
  );
  return valid.length > 0 ? valid : undefined;
}

const aliasCache = new WeakMap<ZodType, EnvAlias[]>();

export function collectEnvAliases(schema: ZodType): EnvAlias[] {
  const cached = aliasCache.get(schema);
  if (cached) return cached;
  const aliases: EnvAlias[] = [];

  const visit = (node: unknown, path: string[]): void => {
    const env = readEnvMeta(node);
    const base = unwrap(node, path);
    const { type, shape } = internals(base).def;

    if (type === "object" && shape) {
      if (env) {
        throw new Error(
          `Config group "${path.join(".")}" declares env "${env.join(", ")}". Only leaf fields can carry an environment alias.`,
        );
      }
      for (const [key, child] of Object.entries(shape)) {
        visit(child, [...path, key]);
      }
      return;
    }

    if (env) aliases.push({ path, env, type });
  };

  visit(schema, []);
  aliasCache.set(schema, aliases);
  return aliases;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function parseEnvValue(raw: string, key: string, alias: EnvAlias): unknown {
  switch (alias.type) {
    case "string":
    case "enum":
    case "literal":
      return raw.trim();
    case "boolean": {
      const normalized = raw.trim().toLowerCase();
      if (TRUE_VALUES.has(normalized)) return true;
      if (FALSE_VALUES.has(normalized)) return false;
      throw new Error(
        `${key} must be one of ${[...TRUE_VALUES, ...FALSE_VALUES].join(", ")}, got "${raw}"`,
      );
    }
    case "number":
    case "int": {
      const value = Number(raw.trim());
      if (!Number.isFinite(value)) {
        throw new Error(`${key} must be a number, got "${raw}"`);
      }
      return value;
    }
    case "array":
      return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    default:
      throw new Error(
        `Config field "${alias.path.join(".")}" declares env "${key}" but its type "${alias.type}" has no environment parser. Add one here or drop the alias.`,
      );
  }
}

function assign(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let node = target;
  for (const key of path.slice(0, -1)) {
    const existing = node[key];
    if (existing === undefined) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

export function readEnvConfigLayer(
  schema: ZodType,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const layer: Record<string, unknown> = {};
  for (const alias of collectEnvAliases(schema)) {
    for (const key of alias.env) {
      const raw = env[key];
      if (raw === undefined || raw.trim() === "") continue;
      assign(layer, alias.path, parseEnvValue(raw, key, alias));
      break;
    }
  }
  return layer;
}
