import type { ZodType } from "zod";

/**
 * Builds the environment-variable layer of the app config.
 *
 * Environment variables are declared shortcuts into the schema, not a parallel
 * namespace: a key exists only because some field carries `.meta({ env })`.
 * This module is the one place in the framework that turns those strings into
 * typed values, which is what lets every consumer read `getAppConfig()`
 * instead of parsing `process.env` at its own call site.
 */

/**
 * A leaf field that declares one or more environment-variable aliases.
 *
 * `env` is ordered: the first key that is set wins. Several fields need this
 * because one concept accumulated many spellings over time — app identity has
 * eight — and collapsing them means declaring the precedence once here instead
 * of rebuilding a slightly different chain at each call site.
 */
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

/**
 * Zod exposes no public API for peeling `.optional()` / `.default()` back off a
 * field, and we need the declared kind underneath to know how to parse a string
 * into it. `_zod.def` is that introspection surface; a zod major upgrade is the
 * moment to re-check this file.
 */
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

// Walking the schema is pure and the schema is a module constant, so the walk
// happens once per schema rather than on every config read.
const aliasCache = new WeakMap<ZodType, EnvAlias[]>();

/** Every leaf in `schema` that declares an environment-variable alias. */
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
      // Every hand-rolled reader this replaces trimmed its value. Keeping that
      // means a stray trailing space in a deploy UI does not become part of an
      // app id or a URL.
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
      // Comma-separated, which is what every hand-rolled list reader in core
      // already used. Blank entries are dropped so a trailing comma is not an
      // empty allow-list entry.
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

/**
 * Reads every declared alias out of `env` into a partial config object.
 *
 * A key that is unset, empty, or only whitespace is treated as absent. Several
 * hosting platforms surface an unset variable as `""`, and every reader this
 * replaces used `?.trim() ||` — so a blank value has always meant "fall through
 * to the next source", never "the configured value is blank".
 *
 * When a field declares several aliases, the first one with a value wins and
 * the rest are not consulted.
 */
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
