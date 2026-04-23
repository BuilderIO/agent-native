import type { ActionTool } from "./agent/types.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";

/** HTTP exposure config for an action. */
export interface ActionHttpConfig {
  /** HTTP method. Default: "POST". Use "GET" for read-only actions. */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Override route path under /_agent-native/actions/. Default: action filename. */
  path?: string;
}

/** Schema definition for a single action parameter (legacy JSON schema style). */
export interface ParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
}

/** Infer runtime parameter types from a legacy parameter schema map. */
type InferParams<T extends Record<string, ParameterSchema> | undefined> =
  T extends Record<string, ParameterSchema>
    ? { [K in keyof T]?: string }
    : Record<string, string>;

// ---------------------------------------------------------------------------
// Schema-based action options (new: Zod / Valibot / ArkType via Standard Schema)
// ---------------------------------------------------------------------------

interface DefineActionWithSchema<
  TSchema extends StandardSchemaV1,
  TReturn = any,
> {
  description: string;
  /** Standard Schema-compatible schema (Zod, Valibot, ArkType). Provides runtime
   *  validation and full TypeScript type inference for `run()` args. The schema is
   *  also converted to JSON Schema for the Claude API tool definition. */
  schema: TSchema;
  /** Legacy parameters — ignored when `schema` is provided. */
  parameters?: never;
  run: (
    args: StandardSchemaV1.InferOutput<TSchema>,
  ) => Promise<TReturn> | TReturn;
  http?: ActionHttpConfig | false;
  /** If true, the framework will NOT emit a screen-refresh poll event after a
   *  successful call. Auto-inferred as `true` when `http.method === "GET"`.
   *  Only set this manually when you need to override the inference — e.g. a
   *  POST action that only reads data but can't use GET for a protocol reason. */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Legacy parameter-based action options
// ---------------------------------------------------------------------------

interface DefineActionWithParams<
  TParams extends Record<string, ParameterSchema> | undefined =
    | Record<string, ParameterSchema>
    | undefined,
  TReturn = any,
> {
  description: string;
  /** Flat map of parameter names to their schema. Automatically wrapped in
   *  `{ type: "object", properties: ... }` for the Claude API. */
  parameters?: TParams;
  /** Standard Schema — not used in this overload. */
  schema?: never;
  run: (args: InferParams<TParams>) => Promise<TReturn> | TReturn;
  http?: ActionHttpConfig | false;
  /** If true, the framework will NOT emit a screen-refresh poll event after a
   *  successful call. Auto-inferred as `true` when `http.method === "GET"`. */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Define an agent action. Place in `actions/` directory — auto-discovered by the framework.
 *
 * Supports two modes:
 *
 * **Schema mode (recommended)** — pass a Standard Schema-compatible schema (Zod, Valibot,
 * ArkType) for runtime validation and full type inference:
 *
 * ```ts
 * import { defineAction } from "@agent-native/core";
 * import { z } from "zod";
 *
 * export default defineAction({
 *   description: "Create a form",
 *   schema: z.object({
 *     title: z.string().describe("Form title"),
 *     status: z.enum(["draft", "published", "closed"]).default("draft"),
 *   }),
 *   run: async (args) => {
 *     // args is { title: string; status: "draft" | "published" | "closed" }
 *     // Already validated — invalid inputs never reach here
 *   },
 * });
 * ```
 *
 * **Parameters mode (legacy)** — pass raw JSON schema-like parameter definitions:
 *
 * ```ts
 * export default defineAction({
 *   description: "List events",
 *   parameters: {
 *     from: { type: "string", description: "Start date" },
 *   },
 *   run: async (args) => { ... },
 * });
 * ```
 */
export function defineAction<TSchema extends StandardSchemaV1, TReturn>(
  options: DefineActionWithSchema<TSchema, TReturn>,
): any;
export function defineAction<
  TParams extends Record<string, ParameterSchema> | undefined,
  TReturn,
>(options: DefineActionWithParams<TParams, TReturn>): any;
export function defineAction(options: any) {
  const hasSchema = options.schema && "~standard" in options.schema;

  // Build tool definition for the Claude API
  let toolParameters: ActionTool["parameters"];
  if (hasSchema) {
    // Convert Standard Schema to JSON Schema for Claude
    toolParameters = schemaToJsonSchema(options.schema, options.description);
  } else if (options.parameters) {
    toolParameters = {
      type: "object" as const,
      properties: options.parameters,
    };
  }

  // Wrap run() with validation when schema is provided.
  // Pass toolParameters so the validation error can echo the expected signature
  // (required vs optional fields) and help the caller self-correct.
  const run = hasSchema
    ? wrapWithValidation(options.schema, options.run, toolParameters)
    : options.run;

  // Auto-infer readOnly from http.method === "GET" unless explicitly set.
  // GET actions are idempotent reads; their completion should NOT trigger a
  // screen refresh. Everything else is assumed to mutate — the dispatcher
  // emits a poll event on success so the UI auto-refetches its queries.
  const httpConfig = options.http as ActionHttpConfig | false | undefined;
  const inferredReadOnly =
    httpConfig !== false &&
    httpConfig !== undefined &&
    httpConfig.method === "GET";
  // Explicit `readOnly` (true OR false) wins. Otherwise infer from http.method.
  // We store the resolved boolean so downstream checks can trust entry.readOnly
  // without re-running method inference — including when a caller explicitly
  // passes readOnly:false to override a GET (rare but valid).
  const readOnly: boolean | undefined =
    typeof options.readOnly === "boolean"
      ? options.readOnly
      : inferredReadOnly
        ? true
        : undefined;

  return {
    tool: {
      description: options.description,
      parameters: toolParameters,
    },
    run,
    ...(hasSchema ? { schema: options.schema } : {}),
    ...(options.http !== undefined ? { http: options.http } : {}),
    ...(typeof readOnly === "boolean" ? { readOnly } : {}),
  };
}

// ---------------------------------------------------------------------------
// Schema → JSON Schema conversion
// ---------------------------------------------------------------------------

/**
 * Convert a Standard Schema to JSON Schema for the Claude API.
 * Tries vendor-specific toJSONSchema first (Zod v4), then falls back
 * to a basic introspection of the schema shape.
 */
function schemaToJsonSchema(
  schema: StandardSchemaV1,
  _description?: string,
): ActionTool["parameters"] {
  const s = schema as any;

  // Prefer Zod's own JSON Schema output — it handles descriptions,
  // enums, coerce, and all type wrappers correctly.
  if (s["~standard"]?.jsonSchema?.input) {
    try {
      const result = s["~standard"].jsonSchema.input({
        target: "draft-07",
      }) as any;
      // Strip $schema — the Claude API validates against draft 2020-12
      // and a mismatched $schema declaration can cause rejections.
      if (result && typeof result === "object") {
        delete result.$schema;
      }
      return result as ActionTool["parameters"];
    } catch {
      // Fall through to manual converter
    }
  }

  // Fallback: manual conversion from Zod v4 internal defs
  if (s._zod?.def) {
    return zodDefToJsonSchema(s._zod.def);
  }

  // Last resort: empty object schema
  return { type: "object" as const, properties: {} };
}

/**
 * Convert a Zod v4 internal def to JSON Schema.
 * Handles the common types used in action parameters.
 */
function zodDefToJsonSchema(def: any): any {
  const type = def.type;

  if (type === "object") {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    const shape = def.shape;
    if (shape) {
      for (const [key, fieldSchema] of Object.entries(shape) as any[]) {
        const fieldDef = fieldSchema?._zod?.def;
        if (fieldDef) {
          const prop = zodDefToJsonSchema(fieldDef);
          // Zod v4 stores .describe() on the schema object, not in the def
          const desc = fieldSchema?.description;
          if (desc && !prop.description) prop.description = desc;
          properties[key] = prop;
          if (fieldDef.type !== "optional" && fieldDef.type !== "default") {
            required.push(key);
          }
        }
      }
    }
    const result: any = { type: "object", properties };
    if (required.length > 0) result.required = required;
    return result;
  }

  if (type === "string") {
    const result: any = { type: "string" };
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "number" || type === "float" || type === "int") {
    const result: any = { type: type === "int" ? "integer" : "number" };
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "boolean") {
    const result: any = { type: "boolean" };
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "enum") {
    // Zod v4 stores enum entries as an object {a: "a", b: "b"};
    // JSON Schema requires an array.
    const entries = def.entries;
    const enumValues = Array.isArray(entries)
      ? entries
      : typeof entries === "object" && entries !== null
        ? Object.values(entries)
        : entries;
    const result: any = { type: "string", enum: enumValues };
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "literal") {
    return { type: typeof def.value, enum: [def.value] };
  }

  if (type === "array") {
    const result: any = { type: "array" };
    if (def.element?._zod?.def) {
      result.items = zodDefToJsonSchema(def.element._zod.def);
    }
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "optional") {
    if (def.innerType?._zod?.def) {
      return zodDefToJsonSchema(def.innerType._zod.def);
    }
  }

  if (type === "default") {
    if (def.innerType?._zod?.def) {
      const inner = zodDefToJsonSchema(def.innerType._zod.def);
      inner.default =
        typeof def.defaultValue === "function"
          ? def.defaultValue()
          : def.defaultValue;
      return inner;
    }
  }

  if (type === "nullable") {
    if (def.innerType?._zod?.def) {
      return zodDefToJsonSchema(def.innerType._zod.def);
    }
  }

  if (type === "union") {
    if (def.options?.length) {
      // Check if it's a simple enum-like union of literals
      const allLiterals = def.options.every(
        (o: any) => o?._zod?.def?.type === "literal",
      );
      if (allLiterals) {
        return {
          type: "string",
          enum: def.options.map((o: any) => o._zod.def.value),
        };
      }
      return {
        anyOf: def.options.map((o: any) =>
          zodDefToJsonSchema(o._zod?.def ?? {}),
        ),
      };
    }
  }

  // Fallback
  return { type: "string" };
}

// ---------------------------------------------------------------------------
// Runtime validation wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an action's run function with schema validation.
 * Invalid inputs get a clear error message (including what was actually passed)
 * so the agent can see its own mistake and correct it on the next turn.
 */
function wrapWithValidation(
  schema: StandardSchemaV1,
  run: Function,
  toolParameters?: ActionTool["parameters"],
): (args: any) => any {
  return async (args: any) => {
    const result = await schema["~standard"].validate(args);
    if (result.issues) {
      // Split issues into "missing required field" vs other validation errors
      // so the error message reads naturally rather than as "fieldName: Required".
      const missing: string[] = [];
      const other: string[] = [];
      for (const issue of result.issues) {
        const pathStr = issue.path
          ? issue.path.map((p) => (typeof p === "object" ? p.key : p)).join(".")
          : "";
        const msg = String(issue.message ?? "");
        // Zod emits "Required" for missing fields; other libraries may use
        // similar wording. Treat any variant as "missing".
        if (
          pathStr &&
          (msg === "Required" ||
            /invalid.*undefined/i.test(msg) ||
            /expected.*received undefined/i.test(msg))
        ) {
          missing.push(pathStr);
        } else {
          other.push(pathStr ? `${pathStr}: ${msg}` : msg);
        }
      }

      const parts: string[] = [];
      if (missing.length > 0) {
        parts.push(
          `Missing required parameter${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
        );
      }
      if (other.length > 0) {
        parts.push(other.join("; "));
      }

      // Echo the args that were actually passed so the caller (usually an
      // agent) can see exactly what it sent and fix its next call.
      let received: string;
      try {
        received = JSON.stringify(args);
        if (received.length > 500) received = received.slice(0, 500) + "…";
      } catch {
        received = String(args);
      }

      // Also show the EXPECTED signature so the agent doesn't have to guess.
      // Format: `{ deckId*: string, content*: string, slideId?: string, ... }`
      // where `*` = required, `?` = optional.
      let expected = "";
      if (toolParameters?.properties) {
        const required = new Set(toolParameters.required ?? []);
        const sig = Object.entries(toolParameters.properties)
          .map(([k, v]) => {
            const mark = required.has(k) ? "*" : "?";
            const type = (v as { type?: string }).type ?? "any";
            return `${k}${mark}: ${type}`;
          })
          .join(", ");
        if (sig)
          expected = ` Expected: { ${sig} } (where * = required, ? = optional).`;
      }

      throw new Error(
        `Invalid action parameters — ${parts.join(". ")}. Received: ${received}.${expected}`,
      );
    }
    return run((result as StandardSchemaV1.SuccessResult<any>).value);
  };
}
