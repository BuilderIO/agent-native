import type { ActionTool } from "./agent/types.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface AgentActionStopOptions {
  /** Optional stable code surfaced in run metadata and tests. */
  errorCode?: string;
  /** Optional short tool-result text. Defaults to the user-facing message. */
  toolResult?: string;
}

/**
 * Throw from an action when the agent should stop the current turn instead of
 * feeding the failure back to the model for another retry.
 */
export class AgentActionStopError extends Error {
  readonly agentNativeStop = true;
  readonly errorCode?: string;
  readonly toolResult?: string;

  constructor(message: string, options: AgentActionStopOptions = {}) {
    super(message);
    this.name = "AgentActionStopError";
    this.errorCode = options.errorCode;
    this.toolResult = options.toolResult;
  }
}

export function isAgentActionStopError(
  err: unknown,
): err is AgentActionStopError {
  return (
    err instanceof AgentActionStopError ||
    Boolean(
      err &&
      typeof err === "object" &&
      "agentNativeStop" in err &&
      (err as { agentNativeStop?: unknown }).agentNativeStop === true,
    )
  );
}

/** HTTP exposure config for an action. */
export interface ActionHttpConfig {
  /** HTTP method. Default: "POST". Use "GET" for read-only actions. */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Override route path under /_agent-native/actions/. Default: action filename. */
  path?: string;
}

/** Explicit opt-in metadata for public agent protocols such as MCP or A2A. */
export interface PublicAgentActionConfig {
  expose: boolean;
  readOnly: boolean;
  requiresAuth?: boolean;
  isConsequential?: boolean;
  title?: string;
  description?: string;
}

/** A deep link an external agent (MCP / A2A) can surface to the user so they
 *  can open the produced/listed resource in the running app UI. */
export interface ActionDeepLink {
  /** App-relative path (e.g. `/_agent-native/open?app=mail&view=inbox&...`)
   *  or an absolute URL. The MCP layer prefixes the request origin when this
   *  is relative, and may rewrite it to the `agentnative://` desktop scheme. */
  url: string;
  /** Human-readable label, e.g. "Open draft in Mail". */
  label: string;
  /** Optional view hint (matches the `navigate` command `view`). */
  view?: string;
}

/** Builds a deep link from an action's args + result so external agents can
 *  surface an "Open in <app> →" link. MUST be pure and synchronous — no I/O,
 *  no awaits. Best-effort: a throw or null is swallowed and never fails the
 *  tool call. See the `external-agents` skill. */
export type ActionLinkBuilder = (ctx: {
  args: Record<string, any>;
  result: any;
}) => ActionDeepLink | null | undefined;

export const MCP_APP_EXTENSION_ID = "io.modelcontextprotocol/ui" as const;
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const MCP_APP_RESOURCE_URI_META_KEY = "ui/resourceUri" as const;

export interface ActionMcpAppCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export type ActionMcpAppCspBuilder = (ctx: {
  actionName: string;
  appId?: string;
  requestOrigin?: string;
}) => ActionMcpAppCsp | Promise<ActionMcpAppCsp>;

export interface ActionMcpAppPermissions {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
}

export interface ActionMcpAppResourceMeta {
  csp?: ActionMcpAppCsp | ActionMcpAppCspBuilder;
  permissions?: ActionMcpAppPermissions;
  /**
   * Host-specific sandbox domain hint. Do not set this to the app's normal
   * production URL; app origins belong in CSP/open-link metadata. ChatGPT uses
   * the separate `openai/widgetDomain` compatibility field.
   */
  domain?: string;
  prefersBorder?: boolean;
}

export type ActionMcpAppHtmlBuilder = (ctx: {
  actionName: string;
  appId?: string;
  requestOrigin?: string;
}) => string;

export interface ActionMcpAppResourceConfig {
  /** `ui://` URI. Defaults to `ui://<app>/<action-name>`. */
  uri?: string;
  /** MCP resource name. Defaults to the action name. */
  name?: string;
  title?: string;
  description?: string;
  /**
   * HTML5 document content for the MCP App resource. Keep this self-contained
   * or declare any external origins in `csp`.
   */
  html: string | ActionMcpAppHtmlBuilder;
  /** Defaults to the MCP Apps HTML MIME type. */
  mimeType?: typeof MCP_APP_MIME_TYPE;
  /** Extra resource/content metadata. `ui` is merged with the fields below. */
  _meta?: Record<string, unknown>;
  csp?: ActionMcpAppCsp | ActionMcpAppCspBuilder;
  permissions?: ActionMcpAppPermissions;
  /**
   * Host-specific sandbox domain hint. Do not set this to the app's normal
   * production URL; app origins belong in CSP/open-link metadata. ChatGPT uses
   * the separate `openai/widgetDomain` compatibility field.
   */
  domain?: string;
  prefersBorder?: boolean;
}

export interface ActionMcpAppConfig {
  resource: ActionMcpAppResourceConfig;
  /**
   * MCP Apps tool visibility. Defaults to model + app so the LLM can call the
   * action and the app iframe can call it back through the host bridge.
   */
  visibility?: Array<"model" | "app">;
  /**
   * Rare escape hatch for MCP Apps chat hosts. By default OAuth callers with
   * `mcp:apps` see the generic app tools (`open_app`, `list_apps`, etc.) so
   * hosts do not ingest every action-specific UI resource. Set this only when
   * this specific action must stay visible in that compact catalog.
   */
  compactCatalog?: boolean;
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
  /** If true, the framework will NOT emit a screen-refresh change event after a
   *  successful call. Auto-inferred as `true` when `http.method === "GET"`.
   *  Only set this manually when you need to override the inference — e.g. a
   *  POST action that only reads data but can't use GET for a protocol reason. */
  readOnly?: boolean;
  /** If true, the agent may execute this action concurrently with other
   *  read-only or parallel-safe tool calls emitted in the same model turn.
   *  Only set this for mutating actions that are internally concurrency-safe
   *  and order-independent for same-turn execution. */
  parallelSafe?: boolean;
  /** Whether this action may be invoked from the tools (Alpine iframe) bridge
   *  via `appAction(name, params)` — see `packages/core/docs/content/actions.md`
   *  ("Tools Callability"). **Default-allow opt-out**: undefined / `true` both
   *  allow tool-iframe calls; only an explicit `false` returns 403. Set to
   *  `false` for high-blast-radius admin operations (account deletion, org
   *  membership changes, anything that modifies auth state) — used by the
   *  framework's `share-resource`, `unshare-resource`, and
   *  `set-resource-visibility` for defense-in-depth. Regular UI/agent/CLI/MCP/A2A
   *  calls are unaffected. Enforced by the action HTTP route layer — see
   *  `packages/core/src/server/action-routes.ts`. Audit reference: H5 in
   *  `security-audit/05-tools-sandbox.md`. */
  toolCallable?: boolean;
  /** Explicit public-agent exposure metadata. Public web routes never imply
   *  public MCP/A2A/OpenAPI tool exposure. Actions must opt in here and public
   *  protocol mounts must still filter for safe, route-appropriate tools. */
  publicAgent?: PublicAgentActionConfig;
  /** Optional deep-link builder. When set, MCP/A2A surfaces append an
   *  "Open in <app> →" link built from the call's args + result so the
   *  external agent can drop the user into the running app at the right
   *  view/record. Pure + sync + best-effort. See the `external-agents` skill. */
  link?: ActionLinkBuilder;
  /** Optional MCP Apps UI resource for hosts that can render inline
   *  interactive app iframes. Text/deep-link tool results remain the fallback
   *  for CLI and non-UI hosts. */
  mcpApp?: ActionMcpAppConfig;
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
  /** If true, the framework will NOT emit a screen-refresh change event after a
   *  successful call. Auto-inferred as `true` when `http.method === "GET"`. */
  readOnly?: boolean;
  /** If true, the agent may execute this action concurrently with other
   *  read-only or parallel-safe tool calls emitted in the same model turn. */
  parallelSafe?: boolean;
  /** Whether this action may be invoked from the tools (Alpine iframe) bridge
   *  via `appAction(name, params)`. See the schema overload above for details
   *  and the `toolCallable` section in actions.md. */
  toolCallable?: boolean;
  /** Explicit public-agent exposure metadata. See schema overload above. */
  publicAgent?: PublicAgentActionConfig;
  /** Optional deep-link builder. See schema overload above. */
  link?: ActionLinkBuilder;
  /** Optional MCP Apps UI resource. See schema overload above. */
  mcpApp?: ActionMcpAppConfig;
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
  // emits a change event on success so the UI auto-refetches its queries.
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

  // toolCallable: thread through whatever the caller declared. We DO NOT
  // default to `true` here — the absence of an explicit field is meaningful
  // to the tools bridge: it lets us emit a one-shot warning when an action
  // without a declared `toolCallable` flag is invoked from a tool, so the
  // ecosystem can migrate over time. The bridge treats `undefined` as
  // "implicit allow with a deprecation warning"; only an explicit `false`
  // refuses the call. See `extensions/routes.ts` and audit H5.
  const toolCallable: boolean | undefined =
    typeof options.toolCallable === "boolean"
      ? options.toolCallable
      : undefined;
  const parallelSafe: boolean | undefined =
    typeof options.parallelSafe === "boolean"
      ? options.parallelSafe
      : undefined;
  const publicAgent: PublicAgentActionConfig | undefined =
    options.publicAgent &&
    typeof options.publicAgent === "object" &&
    !Array.isArray(options.publicAgent)
      ? options.publicAgent
      : undefined;
  const link: ActionLinkBuilder | undefined =
    typeof options.link === "function" ? options.link : undefined;
  const mcpApp: ActionMcpAppConfig | undefined =
    options.mcpApp &&
    typeof options.mcpApp === "object" &&
    !Array.isArray(options.mcpApp) &&
    options.mcpApp.resource &&
    typeof options.mcpApp.resource === "object" &&
    !Array.isArray(options.mcpApp.resource) &&
    (typeof options.mcpApp.resource.html === "string" ||
      typeof options.mcpApp.resource.html === "function")
      ? options.mcpApp
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
    ...(typeof parallelSafe === "boolean" ? { parallelSafe } : {}),
    ...(typeof toolCallable === "boolean" ? { toolCallable } : {}),
    ...(publicAgent ? { publicAgent } : {}),
    ...(link ? { link } : {}),
    ...(mcpApp ? { mcpApp } : {}),
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
          if (
            fieldDef.type !== "optional" &&
            fieldDef.type !== "default" &&
            fieldDef.type !== "nullable"
          ) {
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
      const inner = zodDefToJsonSchema(def.innerType._zod.def);
      // Surface null as a valid value so the model knows it may pass null
      // (and doesn't treat the field as a non-nullable required string).
      return { anyOf: [inner, { type: "null" }] };
    }
  }

  if (type === "union") {
    if (def.options?.length) {
      // Check if it's a simple enum-like union of literals
      const allLiterals = def.options.every(
        (o: any) => o?._zod?.def?.type === "literal",
      );
      if (allLiterals) {
        const values = def.options.map((o: any) => o._zod.def.value);
        const jsonTypeOf = (v: any) =>
          typeof v === "number"
            ? "number"
            : typeof v === "boolean"
              ? "boolean"
              : "string";
        const uniqueTypes = [...new Set(values.map(jsonTypeOf))];
        if (uniqueTypes.length === 1) {
          // Homogeneous literal union (e.g. all numbers) — derive the JSON
          // type instead of hardcoding "string", which would contradict the
          // enum values and make the model coerce/round-trip them wrongly.
          return { type: uniqueTypes[0], enum: values };
        }
        // Mixed literal types: emit anyOf so each branch stays self-consistent.
        return {
          anyOf: values.map((v: any) => ({ type: jsonTypeOf(v), enum: [v] })),
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
