import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";

import { agentNativeToolTitle } from "../shared/agent-mcp-metadata.js";
import { agentNativePath } from "./api-path.js";
import type {
  AgentNativeClientAction,
  AgentNativeClientActions,
  AgentNativeClientActionRuntime,
  AgentNativeHostCommandHandlers,
  AgentNativeHostContext,
  AgentNativeHostContextGetter,
  AgentNativeHostSession,
} from "./host-bridge.js";

export interface AgentNativeWebMcpToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

/** Serializable WebMCP metadata. The native RegisteredTool also has a Window. */
export interface AgentNativeWebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  origin?: string;
  annotations?: AgentNativeWebMcpToolAnnotations;
}

export interface AgentNativeWebMcpToolExecutionOptions {
  signal?: AbortSignal;
}

export type AgentNativeWebMcpToolResult =
  | string
  | number
  | boolean
  | null
  | AgentNativeWebMcpToolResult[]
  | { [key: string]: AgentNativeWebMcpToolResult };

export interface AgentNativeWebMcpClient {
  readonly supported: boolean;
  listTools(options?: {
    fromOrigins?: string[];
  }): Promise<AgentNativeWebMcpTool[]>;
  executeTool(
    tool: Pick<AgentNativeWebMcpTool, "name" | "origin">,
    input?: unknown,
    options?: AgentNativeWebMcpToolExecutionOptions,
  ): Promise<AgentNativeWebMcpToolResult>;
  executeListedTool(
    tool: AgentNativeWebMcpTool,
    input?: unknown,
    options?: AgentNativeWebMcpToolExecutionOptions,
  ): Promise<AgentNativeWebMcpToolResult>;
  onToolChange?(listener: () => void): () => void;
}

export class AgentNativeWebMcpUnsupportedError extends Error {
  constructor() {
    super("WebMCP is not supported by this browser or document");
    this.name = "AgentNativeWebMcpUnsupportedError";
  }
}

interface NativeModelContext {
  registerTool(
    tool: NativeContextTool,
    options?: NativeRegisterToolOptions,
  ): Promise<void>;
  getTools(options?: {
    fromOrigins?: string[];
  }): Promise<NativeRegisteredTool[]>;
  executeTool(
    tool: NativeRegisteredTool,
    inputObject?: string | Record<string, unknown>,
    options?: AgentNativeWebMcpToolExecutionOptions,
  ): Promise<unknown>;
  codexExecuteTool?: (...args: unknown[]) => unknown;
  codexGetTools?: (...args: unknown[]) => unknown;
  addEventListener?(type: "toolchange", listener: EventListener): void;
  removeEventListener?(type: "toolchange", listener: EventListener): void;
}

interface NativeContextDocument extends Document {
  modelContext?: NativeModelContext;
}

interface NativeContextToolExecuteOptions {
  signal: AbortSignal;
}

interface NativeContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: AgentNativeWebMcpToolAnnotations;
  execute: (
    input: Record<string, unknown>,
    options?: NativeContextToolExecuteOptions,
  ) => string | Promise<string>;
}

interface NativeRegisterToolOptions {
  exposedTo?: string[];
  signal?: AbortSignal;
}

interface NativeRegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  window: Window;
  origin: string;
  annotations?: unknown;
}

const DEFAULT_INPUT_CHARS = 20_000;
const DEFAULT_RESULT_CHARS = 50_000;
const DEFAULT_SCHEMA_CHARS = 50_000;
const DEFAULT_DESCRIPTION_CHARS = 2_000;
const DEFAULT_TOOL_COUNT = 100;
const DEFAULT_MANIFEST_CHARS = 500_000;
const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const EMPTY_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getDocument(
  targetDocument: Document | undefined,
): NativeContextDocument | undefined {
  if (targetDocument) return targetDocument as NativeContextDocument;
  if (typeof document === "undefined") return undefined;
  return document as NativeContextDocument;
}

function getModelContext(
  targetDocument: Document | undefined,
): NativeModelContext | undefined {
  const value = getDocument(targetDocument)?.modelContext;
  if (!value || typeof value !== "object") return undefined;
  if (
    typeof value.registerTool !== "function" ||
    typeof value.getTools !== "function" ||
    typeof value.executeTool !== "function"
  ) {
    return undefined;
  }
  return value;
}

/** Where {@link getAgentNativeWebMcpStatus} publishes progress in the page world. */
const WEBMCP_STATUS_KEY = "__agentNativeWebMcpStatus";

export type AgentNativeWebMcpRegistrationState =
  | "registering"
  | "ready"
  | "failed";

export interface AgentNativeWebMcpStatus {
  state: AgentNativeWebMcpRegistrationState;
  /** Tools registered so far. Only equals `total` once state is "ready". */
  registered: number;
  /** Tools this registration pass intends to register. */
  total: number;
  /** Present only when state is "failed". */
  error?: string;
}

const registrationStatuses = new WeakMap<
  object,
  Map<symbol, AgentNativeWebMcpStatus>
>();

function statusHost(
  targetDocument: Document | undefined,
): Record<string, unknown> | undefined {
  const view = getDocument(targetDocument)?.defaultView;
  if (view) return view as unknown as Record<string, unknown>;
  if (typeof window === "undefined") return undefined;
  return window as unknown as Record<string, unknown>;
}

/**
 * Publish registration progress into the page world.
 *
 * Tools register one at a time, so a discovery caller reading `getTools()`
 * mid-flight sees a truncated list that is otherwise indistinguishable from a
 * complete one — the caller then reports a live tool as missing. This is the
 * only signal that separates "still registering" from "this is all there is".
 */
function publishRegistrationStatus(
  targetDocument: Document | undefined,
  registrationId: symbol,
  status: AgentNativeWebMcpStatus | undefined,
): void {
  const host = statusHost(targetDocument);
  if (!host) return;
  let statuses = host[WEBMCP_STATUS_KEY]
    ? registrationStatuses.get(host)
    : undefined;
  if (!statuses) registrationStatuses.delete(host);
  if (!status) {
    statuses?.delete(registrationId);
    if (!statuses?.size) {
      registrationStatuses.delete(host);
      delete host[WEBMCP_STATUS_KEY];
      settleReadyWaiters(host, {
        state: "failed",
        registered: 0,
        total: 0,
        error: "WebMCP registration stopped",
      });
      return;
    }
  } else {
    if (!statuses) {
      statuses = new Map();
      registrationStatuses.set(host, statuses);
    }
    statuses.set(registrationId, { ...status });
  }

  const records = [...statuses.values()];
  const failed = records.find((record) => record.state === "failed");
  const registering = records.some((record) => record.state === "registering");
  const next = {
    state: failed ? "failed" : registering ? "registering" : "ready",
    registered: records.reduce((sum, record) => sum + record.registered, 0),
    total: records.reduce((sum, record) => sum + record.total, 0),
    ...(failed?.error ? { error: failed.error } : {}),
  } satisfies AgentNativeWebMcpStatus;
  host[WEBMCP_STATUS_KEY] = next;
  if (next.state !== "registering") settleReadyWaiters(host, next);
}

const readyWaiters = new WeakMap<
  object,
  Set<(status: AgentNativeWebMcpStatus) => void>
>();

function settleReadyWaiters(
  host: object,
  status: AgentNativeWebMcpStatus,
): void {
  const waiters = readyWaiters.get(host);
  if (!waiters) return;
  readyWaiters.delete(host);
  waiters.forEach((resolve) => resolve(status));
}

/** Resolves on the next settled status publish for this page. */
function waitForSettledStatus(host: object): Promise<AgentNativeWebMcpStatus> {
  return new Promise((resolve) => {
    let waiters = readyWaiters.get(host);
    if (!waiters) {
      waiters = new Set();
      readyWaiters.set(host, waiters);
    }
    waiters.add(resolve);
  });
}

/** Read WebMCP registration progress for the current page. */
export function getAgentNativeWebMcpStatus(
  targetDocument?: Document,
): AgentNativeWebMcpStatus | undefined {
  const value = statusHost(targetDocument)?.[WEBMCP_STATUS_KEY];
  return isRecord(value)
    ? (value as unknown as AgentNativeWebMcpStatus)
    : undefined;
}

/**
 * Make the page-local WebMCP surface available when the browser does not
 * provide it natively. The polyfill only owns the current document. A host
 * bridge or browser evaluator still controls who can discover and invoke it.
 */
export function initializeAgentNativeWebMcp(): boolean {
  if (isAgentNativeWebMcpSupported()) return true;
  if (typeof window === "undefined") return false;
  initializeWebMCPPolyfill();
  return isAgentNativeWebMcpSupported();
}

export function isAgentNativeWebMcpSupported(
  targetDocument?: Document,
): boolean {
  return Boolean(getModelContext(targetDocument));
}

function jsonLength(value: unknown, label: string, maxChars: number): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
  if (serialized === undefined) {
    throw new Error(`${label} must be JSON-serializable`);
  }
  if (serialized.length > maxChars) {
    throw new Error(`${label} exceeds the ${maxChars}-character limit`);
  }
  return serialized.length;
}

function normalizeTool(
  tool: NativeRegisteredTool,
  options: Required<
    Pick<
      AgentNativeWebMcpClientOptions,
      "maxDescriptionChars" | "maxSchemaChars" | "maxToolCount"
    >
  >,
): AgentNativeWebMcpTool {
  if (!tool || typeof tool !== "object") {
    throw new Error("WebMCP returned an invalid tool descriptor");
  }
  if (typeof tool.name !== "string" || !TOOL_NAME_RE.test(tool.name)) {
    throw new Error("WebMCP returned a tool with an invalid name");
  }
  if (
    typeof tool.description !== "string" ||
    !tool.description.trim() ||
    tool.description.length > options.maxDescriptionChars
  ) {
    throw new Error(`WebMCP tool "${tool.name}" has an invalid description`);
  }
  if (
    tool.title !== undefined &&
    (typeof tool.title !== "string" ||
      tool.title.length > options.maxDescriptionChars)
  ) {
    throw new Error(`WebMCP tool "${tool.name}" has an invalid title`);
  }
  // The Codex page adapter lists inputSchema as a JSON string, not an object.
  let inputSchema = tool.inputSchema as unknown;
  if (typeof inputSchema === "string") {
    try {
      inputSchema = JSON.parse(inputSchema);
    } catch {
      throw new Error(`WebMCP tool "${tool.name}" has an invalid input schema`);
    }
  }
  if (inputSchema !== undefined) {
    if (!isRecord(inputSchema)) {
      throw new Error(`WebMCP tool "${tool.name}" has an invalid input schema`);
    }
    jsonLength(
      inputSchema,
      `WebMCP tool "${tool.name}" input schema`,
      options.maxSchemaChars,
    );
  }
  if (tool.origin !== undefined && typeof tool.origin !== "string") {
    throw new Error(`WebMCP tool "${tool.name}" has an invalid origin`);
  }
  const annotations = normalizeAnnotations(tool.annotations, tool.name);
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    ...(isRecord(inputSchema) ? { inputSchema } : {}),
    ...(tool.origin ? { origin: tool.origin } : {}),
    ...(annotations ? { annotations } : {}),
  };
}

function normalizeAnnotations(
  value: unknown,
  toolName: string,
): AgentNativeWebMcpToolAnnotations | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`WebMCP tool "${toolName}" has invalid annotations`);
  }
  const annotations: AgentNativeWebMcpToolAnnotations = {};
  for (const key of ["readOnlyHint", "untrustedContentHint"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      throw new Error(`WebMCP tool "${toolName}" has invalid annotations`);
    }
    if (typeof value[key] === "boolean") annotations[key] = value[key];
  }
  return Object.keys(annotations).length ? annotations : undefined;
}

function toolKey(tool: Pick<AgentNativeWebMcpTool, "name" | "origin">): string {
  return `${tool.origin ?? ""}\u0000${tool.name}`;
}

function normalizeToolResult(
  value: unknown,
  label: string,
  maxChars: number,
): AgentNativeWebMcpToolResult {
  if (typeof value === "string") {
    if (value.length > maxChars) {
      throw new Error(`${label} exceeds the ${maxChars}-character limit`);
    }
    return value;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
  if (serialized === undefined) {
    throw new Error(`${label} must be JSON-serializable`);
  }
  if (serialized.length > maxChars) {
    throw new Error(`${label} exceeds the ${maxChars}-character limit`);
  }
  return JSON.parse(serialized) as AgentNativeWebMcpToolResult;
}

export interface AgentNativeWebMcpClientOptions {
  document?: Document;
  fromOrigins?: string[];
  maxInputChars?: number;
  maxResultChars?: number;
  maxSchemaChars?: number;
  maxDescriptionChars?: number;
  maxToolCount?: number;
  maxManifestChars?: number;
}

export function createAgentNativeWebMcpClient(
  options: AgentNativeWebMcpClientOptions = {},
): AgentNativeWebMcpClient {
  if (!options.document) initializeAgentNativeWebMcp();
  const modelContext = getModelContext(options.document);
  const defaultFromOrigins = options.fromOrigins;
  const limits = {
    maxInputChars: options.maxInputChars ?? DEFAULT_INPUT_CHARS,
    maxResultChars: options.maxResultChars ?? DEFAULT_RESULT_CHARS,
    maxSchemaChars: options.maxSchemaChars ?? DEFAULT_SCHEMA_CHARS,
    maxDescriptionChars:
      options.maxDescriptionChars ?? DEFAULT_DESCRIPTION_CHARS,
    maxToolCount: options.maxToolCount ?? DEFAULT_TOOL_COUNT,
    maxManifestChars: options.maxManifestChars ?? DEFAULT_MANIFEST_CHARS,
  };
  // Keep bindings for in-flight approvals; each descriptor is a listing capability.
  const listedNativeTools = new WeakMap<object, NativeRegisteredTool>();

  function requireModelContext(): NativeModelContext {
    if (!modelContext) throw new AgentNativeWebMcpUnsupportedError();
    return modelContext;
  }

  async function listTools(
    listOptions: { fromOrigins?: string[] } = {},
  ): Promise<AgentNativeWebMcpTool[]> {
    const context = requireModelContext();
    const fromOrigins = listOptions.fromOrigins ?? defaultFromOrigins;
    const result = fromOrigins
      ? await context.getTools({ fromOrigins })
      : await context.getTools();
    if (!Array.isArray(result)) {
      throw new Error("WebMCP returned an invalid tool list");
    }
    if (result.length > limits.maxToolCount) {
      throw new Error(
        `WebMCP returned more than the ${limits.maxToolCount}-tool limit`,
      );
    }
    const normalizedTools = result.map((tool) => normalizeTool(tool, limits));
    jsonLength(
      normalizedTools,
      "WebMCP tool manifest",
      limits.maxManifestChars,
    );
    const seenKeys = new Set<string>();
    normalizedTools.forEach((tool) => {
      const key = toolKey(tool);
      if (seenKeys.has(key)) {
        throw new Error(
          `WebMCP returned duplicate tool "${tool.name}" for origin "${tool.origin ?? ""}"`,
        );
      }
      seenKeys.add(key);
    });
    normalizedTools.forEach((tool, index) => {
      listedNativeTools.set(tool, result[index]);
    });
    return normalizedTools;
  }

  function findListedNativeTool(
    tools: AgentNativeWebMcpTool[],
    tool: Pick<AgentNativeWebMcpTool, "name" | "origin">,
  ): NativeRegisteredTool | undefined {
    const matches = tools.filter(
      (candidate) =>
        candidate.name === tool.name &&
        (!tool.origin || candidate.origin === tool.origin),
    );
    if (matches.length > 1 && !tool.origin) {
      throw new Error(
        `WebMCP tool "${tool.name}" is exposed by multiple origins; origin is required`,
      );
    }
    const listedTool = matches[0];
    return listedTool ? listedNativeTools.get(listedTool) : undefined;
  }

  async function executeNativeTool(
    tool: Pick<AgentNativeWebMcpTool, "name">,
    nativeTool: NativeRegisteredTool,
    input: unknown,
    executionOptions: AgentNativeWebMcpToolExecutionOptions,
  ): Promise<AgentNativeWebMcpToolResult> {
    if (input === null || !isRecord(input)) {
      throw new Error(`WebMCP tool "${tool.name}" input must be an object`);
    }
    jsonLength(input, `WebMCP tool "${tool.name}" input`, limits.maxInputChars);
    const context = requireModelContext();
    const usesCodexPageAdapter =
      typeof context.codexExecuteTool === "function" ||
      typeof context.codexGetTools === "function";
    const result = await context.executeTool(
      nativeTool,
      usesCodexPageAdapter ? input : JSON.stringify(input),
      executionOptions,
    );
    return normalizeToolResult(
      result,
      `WebMCP tool "${tool.name}" result`,
      limits.maxResultChars,
    );
  }

  async function executeTool(
    tool: Pick<AgentNativeWebMcpTool, "name" | "origin">,
    input: unknown = {},
    executionOptions: AgentNativeWebMcpToolExecutionOptions = {},
  ): Promise<AgentNativeWebMcpToolResult> {
    requireModelContext();
    if (!tool || typeof tool.name !== "string" || !tool.name.trim()) {
      throw new Error("A WebMCP tool name is required");
    }

    const listedTools = await listTools();
    const nativeTool = findListedNativeTool(listedTools, tool);
    if (!nativeTool) {
      throw new Error(`WebMCP tool "${tool.name}" is no longer available`);
    }
    return executeNativeTool(tool, nativeTool, input, executionOptions);
  }

  async function executeListedTool(
    tool: AgentNativeWebMcpTool,
    input: unknown = {},
    executionOptions: AgentNativeWebMcpToolExecutionOptions = {},
  ): Promise<AgentNativeWebMcpToolResult> {
    if (!tool || typeof tool.name !== "string" || !tool.name.trim()) {
      throw new Error("A WebMCP tool name is required");
    }
    const nativeTool = listedNativeTools.get(tool);
    if (!nativeTool) {
      throw new Error(
        `WebMCP tool "${tool.name}" was not returned by a live listing`,
      );
    }
    return executeNativeTool(tool, nativeTool, input, executionOptions);
  }

  const client: AgentNativeWebMcpClient = {
    supported: Boolean(modelContext),
    listTools,
    executeTool,
    executeListedTool,
    ...(modelContext?.addEventListener
      ? {
          onToolChange(listener) {
            const handler: EventListener = () => listener();
            modelContext.addEventListener?.("toolchange", handler);
            return () =>
              modelContext?.removeEventListener?.("toolchange", handler);
          },
        }
      : {}),
  };
  return client;
}

/** Where {@link installAgentNativeWebMcpPageHelper} publishes the page helper. */
const WEBMCP_HELPER_KEY = "__agentNativeWebMcp";
const HELPER_MAX_ATTEMPTS = 10;
const HELPER_MAX_OUTCOMES = 200;
const HELPER_DEFAULT_WAIT_MS = 20_000;
const HELPER_SUMMARY_DESCRIPTION_CHARS = 240;
const STALE_DESCRIPTOR_RE =
  /RegisteredTool must be an object|not found in registry|no longer available|not returned by a live listing/i;

export interface AgentNativeWebMcpToolSummary {
  name: string;
  title?: string;
  /** Truncated; call `describe(name)` for the full description and schema. */
  description: string;
  required: string[];
  readOnly: boolean;
}

export type AgentNativeWebMcpCallFailureCode =
  | "unsupported"
  | "registering"
  | "not-registered"
  | "execution-failed";

export type AgentNativeWebMcpCallOutcome =
  | {
      id: string;
      state: "done";
      ok: true;
      tool: string;
      attempts: number;
      result: unknown;
    }
  | {
      id: string;
      state: "done";
      ok: false;
      tool: string;
      attempts: number;
      code: AgentNativeWebMcpCallFailureCode;
      error: string;
      status?: AgentNativeWebMcpStatus;
    }
  | {
      id: string;
      state: "pending";
      tool: string;
      status?: AgentNativeWebMcpStatus;
    }
  | { id: string; state: "unknown" };

/**
 * The page-world entry point a browser agent's JavaScript evaluator calls.
 * It hides everything an evaluator otherwise has to get right per call: which
 * input contract the active host uses, that a descriptor must come from a
 * live listing, that a partial registry is not a complete one, and that a
 * write may outlive a host evaluator's timeout.
 */
export interface AgentNativeWebMcpPageHelper {
  status(): AgentNativeWebMcpStatus | undefined;
  /** Waits until registration settles, bounded by `waitMs`. */
  ready(options?: { waitMs?: number }): Promise<AgentNativeWebMcpStatus>;
  /** Compact listing; `filter` matches name, title, or description. */
  tools(filter?: string | RegExp): Promise<AgentNativeWebMcpToolSummary[]>;
  describe(name: string): Promise<AgentNativeWebMcpTool | undefined>;
  /**
   * Executes a tool by name. Returns `pending` with an id when the call has
   * not settled within `waitMs`; the call keeps running in the page and
   * `result(id)` reports it. Pass `waitMs: 0` on hosts whose evaluator times
   * out in a few seconds.
   */
  call(
    name: string,
    args?: Record<string, unknown>,
    options?: { waitMs?: number },
  ): Promise<AgentNativeWebMcpCallOutcome>;
  result(id: string): AgentNativeWebMcpCallOutcome;
}

function parseToolResult(value: AgentNativeWebMcpToolResult): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!/^[[{]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function toolMatches(
  tool: AgentNativeWebMcpTool,
  filter: string | RegExp | undefined,
): boolean {
  if (filter === undefined) return true;
  const haystack = `${tool.name} ${tool.title ?? ""} ${tool.description}`;
  // Test the bare name first so anchored patterns like /^get-deck$/ match.
  if (filter instanceof RegExp) {
    // A /g or /y pattern carries lastIndex between tests; copy it without.
    const pattern = new RegExp(
      filter.source,
      filter.flags.replace(/[gy]/g, ""),
    );
    return pattern.test(tool.name) || pattern.test(haystack);
  }
  return haystack.toLowerCase().includes(filter.toLowerCase());
}

function summarizeTool(
  tool: AgentNativeWebMcpTool,
): AgentNativeWebMcpToolSummary {
  const required = tool.inputSchema?.required;
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description:
      tool.description.length > HELPER_SUMMARY_DESCRIPTION_CHARS
        ? `${tool.description.slice(0, HELPER_SUMMARY_DESCRIPTION_CHARS - 1)}…`
        : tool.description,
    required: Array.isArray(required)
      ? required.filter((key): key is string => typeof key === "string")
      : [],
    readOnly: tool.annotations?.readOnlyHint === true,
  };
}

/**
 * Race a promise against a wall-clock bound. Timers are the only part of this
 * file that a hidden browser pane can throttle, and they sit only on the
 * pending path: a settled call wins the race without one.
 */
function settleWithin<T>(
  promise: Promise<T>,
  waitMs: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  if (waitMs <= 0) return Promise.resolve({ settled: false });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ settled: false }), waitMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ settled: true, value });
      },
      () => {
        clearTimeout(timer);
        resolve({ settled: false });
      },
    );
  });
}

export function createAgentNativeWebMcpPageHelper(options?: {
  document?: Document;
}): AgentNativeWebMcpPageHelper {
  const targetDocument = options?.document;
  const host = statusHost(targetDocument);
  const client = createAgentNativeWebMcpClient({
    ...(targetDocument ? { document: targetDocument } : {}),
    maxToolCount: 1_000,
    maxDescriptionChars: 10_000,
  });
  const outcomes = new Map<string, AgentNativeWebMcpCallOutcome>();
  let sequence = 0;
  // The polyfill's getTools() awaits a timer, so a hidden pane pays a throttled
  // wake-up per listing. Reuse the last listing until the registry says it
  // changed; hosts without toolchange events always list fresh.
  let listing: AgentNativeWebMcpTool[] | undefined;
  let listingGeneration = 0;
  const cacheable = typeof client.onToolChange === "function";
  const invalidateListing = () => {
    listing = undefined;
    listingGeneration += 1;
  };
  if (cacheable) client.onToolChange?.(invalidateListing);
  async function list(): Promise<AgentNativeWebMcpTool[]> {
    if (!cacheable) return client.listTools();
    if (listing) return listing;
    // A toolchange during the await outdates this listing before it lands;
    // the generation check keeps a stale result out of the cache.
    const generation = listingGeneration;
    const tools = await client.listTools();
    if (generation === listingGeneration) listing = tools;
    return tools;
  }
  function remember(id: string, outcome: AgentNativeWebMcpCallOutcome): void {
    outcomes.set(id, outcome);
    while (outcomes.size > HELPER_MAX_OUTCOMES) {
      const oldest = outcomes.keys().next().value;
      if (oldest === undefined) break;
      outcomes.delete(oldest);
    }
  }

  const status = () => getAgentNativeWebMcpStatus(targetDocument);

  async function ready(readyOptions?: {
    waitMs?: number;
  }): Promise<AgentNativeWebMcpStatus> {
    const current = status();
    if (current && current.state !== "registering") return current;
    if (!host) {
      return current ?? { state: "failed", registered: 0, total: 0 };
    }
    const settled = await settleWithin(
      waitForSettledStatus(host),
      readyOptions?.waitMs ?? HELPER_DEFAULT_WAIT_MS,
    );
    return settled.settled
      ? settled.value
      : (status() ?? { state: "registering", registered: 0, total: 0 });
  }

  async function run(
    id: string,
    name: string,
    args: Record<string, unknown>,
    waitMs: number,
  ): Promise<AgentNativeWebMcpCallOutcome> {
    if (!client.supported) {
      return {
        id,
        state: "done",
        ok: false,
        tool: name,
        attempts: 0,
        code: "unsupported",
        error: "document.modelContext is not available on this page",
      };
    }
    const settledStatus = await ready({ waitMs });
    let attempts = 0;
    let lastError = "";
    for (; attempts < HELPER_MAX_ATTEMPTS; attempts += 1) {
      let tools: AgentNativeWebMcpTool[];
      try {
        tools = await list();
      } catch (error) {
        return {
          id,
          state: "done",
          ok: false,
          tool: name,
          attempts: attempts + 1,
          code: "execution-failed",
          error: error instanceof Error ? error.message : String(error),
          ...(status() ? { status: status() } : {}),
        };
      }
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) {
        const current = status() ?? settledStatus;
        const registering = current.state === "registering";
        invalidateListing();
        return {
          id,
          state: "done",
          ok: false,
          tool: name,
          attempts: attempts + 1,
          code: registering ? "registering" : "not-registered",
          error: registering
            ? `"${name}" is not registered yet (${current.registered}/${current.total}); call again`
            : `"${name}" is not a tool on this page (${tools.length} listed)`,
          status: current,
        };
      }
      try {
        const result = await client.executeListedTool(tool, args);
        return {
          id,
          state: "done",
          ok: true,
          tool: name,
          attempts: attempts + 1,
          result: parseToolResult(result),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        // A descriptor from an earlier listing dies when the registry
        // restarts under it; the next listing is live again, so retry now.
        if (STALE_DESCRIPTOR_RE.test(lastError)) {
          invalidateListing();
          continue;
        }
        attempts += 1;
        break;
      }
    }
    return {
      id,
      state: "done",
      ok: false,
      tool: name,
      attempts,
      code: "execution-failed",
      error: lastError,
      ...(status() ? { status: status() } : {}),
    };
  }

  const helper: AgentNativeWebMcpPageHelper = {
    status,
    ready,
    async tools(filter) {
      if (!client.supported) return [];
      const listed = await list();
      return listed
        .filter((tool) => toolMatches(tool, filter))
        .map(summarizeTool);
    },
    async describe(name) {
      if (!client.supported) return undefined;
      const listed = await list();
      return listed.find((tool) => tool.name === name);
    },
    async call(name, args = {}, callOptions) {
      const id = `webmcp-call-${++sequence}`;
      const waitMs = callOptions?.waitMs ?? HELPER_DEFAULT_WAIT_MS;
      remember(id, { id, state: "pending", tool: name });
      const promise = run(id, name, args, waitMs)
        .catch(
          (error): AgentNativeWebMcpCallOutcome => ({
            id,
            state: "done",
            ok: false,
            tool: name,
            attempts: 0,
            code: "execution-failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        .then((outcome) => {
          remember(id, outcome);
          return outcome;
        });
      const settled = await settleWithin(promise, waitMs);
      if (settled.settled) return settled.value;
      const current = status();
      return {
        id,
        state: "pending",
        tool: name,
        ...(current ? { status: current } : {}),
      };
    },
    result(id) {
      return outcomes.get(id) ?? { id, state: "unknown" };
    },
  };
  return helper;
}

/** Publish the page helper as `window.__agentNativeWebMcp` once per page. */
export function installAgentNativeWebMcpPageHelper(options?: {
  document?: Document;
}): AgentNativeWebMcpPageHelper | undefined {
  const host = statusHost(options?.document);
  if (!host) return undefined;
  const existing = host[WEBMCP_HELPER_KEY];
  if (isRecord(existing) && typeof existing.call === "function") {
    return existing as unknown as AgentNativeWebMcpPageHelper;
  }
  const helper = createAgentNativeWebMcpPageHelper(options);
  host[WEBMCP_HELPER_KEY] = helper;
  return helper;
}

export function getAgentNativeWebMcpPageHelper(
  targetDocument?: Document,
): AgentNativeWebMcpPageHelper | undefined {
  const value = statusHost(targetDocument)?.[WEBMCP_HELPER_KEY];
  return isRecord(value) && typeof value.call === "function"
    ? (value as unknown as AgentNativeWebMcpPageHelper)
    : undefined;
}

export interface AgentNativeWebMcpApprovalRequest {
  action: AgentNativeClientAction;
  args: unknown;
  context: AgentNativeHostContext;
  session: AgentNativeHostSession;
}

type AgentNativeWebMcpActionManifest = Omit<AgentNativeClientAction, "run">;

export interface AgentNativeWebMcpRegistrationOptions {
  actions: AgentNativeClientActions;
  document?: Document;
  enabled?: boolean;
  exposedTo?: string[];
  getContext?: AgentNativeHostContextGetter;
  session?: string | Partial<AgentNativeHostSession>;
  origin?: string;
  commands?: AgentNativeHostCommandHandlers;
  approve?: (
    request: AgentNativeWebMcpApprovalRequest,
  ) => boolean | Promise<boolean>;
  maxInputChars?: number;
  maxResultChars?: number;
  maxSchemaChars?: number;
  maxDescriptionChars?: number;
  maxToolCount?: number;
  maxManifestChars?: number;
}

export interface AgentNativeWebMcpRegistration {
  readonly supported: boolean;
  readonly registered: number;
  start(): Promise<void>;
  stop(): void;
}

interface AgentNativeServerActionManifest {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  readOnly?: boolean;
}

export function createAgentNativeServerActionWebMcpRegistration(options?: {
  document?: Document;
  fetch?: typeof fetch;
}): AgentNativeWebMcpRegistration {
  const fetchImpl =
    options?.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return createAgentNativeWebMcpRegistration({
    document: options?.document,
    maxToolCount: 1_000,
    maxDescriptionChars: 10_000,
    commands: {
      // The same event the host bridge's refreshData command raises, so a
      // WebMCP write repaints through the sync transport instead of waiting
      // for the next idle poll or a reload.
      refreshData: ({ payload }) => {
        const view = options?.document?.defaultView ?? window;
        view.dispatchEvent(
          new CustomEvent("agentNative:refresh-data", { detail: payload }),
        );
        return { dispatched: true };
      },
    },
    actions: async () => {
      const response = await fetchImpl(
        agentNativePath("/_agent-native/webmcp/manifest"),
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        throw new Error(`Unable to load WebMCP actions (${response.status})`);
      }
      const manifest =
        (await response.json()) as AgentNativeServerActionManifest[];
      if (!Array.isArray(manifest)) {
        throw new Error("WebMCP action manifest must be an array");
      }
      return manifest.map((action) => ({
        name: action.name,
        title: agentNativeToolTitle(action.name, action.title),
        description: action.description,
        ...(action.inputSchema ? { schema: action.inputSchema } : {}),
        ...(action.readOnly ? { readOnly: true } : {}),
        run: async (args, runtime) => {
          const result = await fetchImpl(
            agentNativePath(
              `/_agent-native/webmcp/actions/${encodeURIComponent(action.name)}`,
            ),
            {
              method: "POST",
              credentials: "same-origin",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(args),
              ...(runtime.signal ? { signal: runtime.signal } : {}),
            },
          );
          const body = await result.json();
          if (!result.ok) {
            throw new Error(
              isRecord(body) && typeof body.error === "string"
                ? body.error
                : `WebMCP action failed (${result.status})`,
            );
          }
          if (!action.readOnly) await runtime.refresh();
          return body;
        },
      }));
    },
  });
}

function resolveActions(
  actions: AgentNativeClientActions,
): Promise<AgentNativeClientAction[]> {
  return Promise.resolve(
    typeof actions === "function" ? actions() : actions,
  ).then((value) => {
    if (!Array.isArray(value)) {
      throw new Error("WebMCP actions must be an array");
    }
    return value;
  });
}

function createSession(
  session: AgentNativeWebMcpRegistrationOptions["session"],
): AgentNativeHostSession {
  const base =
    typeof session === "string"
      ? { id: session }
      : session && typeof session === "object"
        ? session
        : {};
  return {
    id:
      base.id ||
      `webmcp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    connectedAt: base.connectedAt ?? new Date().toISOString(),
    url:
      base.url ||
      (typeof window !== "undefined" ? window.location.href : undefined),
    ...base,
  };
}

function sensitiveAction(action: AgentNativeClientAction): boolean {
  return (
    action.destructive === true ||
    action.requiresApproval === true ||
    typeof action.requiresApproval === "object" ||
    Boolean(action.approval)
  );
}

function actionManifest(
  action: AgentNativeClientAction,
): AgentNativeWebMcpActionManifest {
  const manifest = {
    ...action,
    title: agentNativeToolTitle(action.name, action.title),
  };
  delete (manifest as Partial<AgentNativeClientAction>).run;
  return manifest;
}

function actionInputSchema(
  action: AgentNativeClientAction,
): Record<string, unknown> {
  return action.schema ?? action.parameters ?? EMPTY_INPUT_SCHEMA;
}

function actionRuntime(
  options: AgentNativeWebMcpRegistrationOptions,
  context: AgentNativeHostContext,
  session: AgentNativeHostSession,
  signal?: AbortSignal,
): AgentNativeClientActionRuntime {
  const origin = options.origin ?? "agent-native-webmcp";
  const runCommand = async (command: string, payload?: unknown) => {
    const handler =
      options.commands?.[command] ??
      options.commands?.[
        command.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      ];
    if (!handler) throw new Error(`Host command "${command}" is not available`);
    return handler(
      { command, payload, origin },
      undefined as unknown as MessageEvent,
    );
  };
  return {
    ...(signal ? { signal } : {}),
    origin,
    context,
    session,
    event: undefined as unknown as MessageEvent,
    refresh: (payload?: unknown) => runCommand("refreshData", payload),
    command: runCommand,
  };
}

function validateBoundedJson(
  value: unknown,
  label: string,
  maxChars: number,
): void {
  jsonLength(value, label, maxChars);
}

function serializeWebMcpResult(
  value: unknown,
  label: string,
  maxChars: number,
): string {
  if (typeof value === "string") {
    if (value.length > maxChars) {
      throw new Error(`${label} exceeds the ${maxChars}-character limit`);
    }
    return value;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
  if (serialized === undefined) {
    throw new Error(`${label} must be JSON-serializable`);
  }
  if (serialized.length > maxChars) {
    throw new Error(`${label} exceeds the ${maxChars}-character limit`);
  }
  return serialized;
}

export function createAgentNativeWebMcpRegistration(
  options: AgentNativeWebMcpRegistrationOptions,
): AgentNativeWebMcpRegistration {
  if (!options.document) initializeAgentNativeWebMcp();
  const modelContext = getModelContext(options.document);
  let controller: AbortController | undefined;
  let registered = 0;
  let started = false;
  let generation = 0;
  let startPromise: Promise<void> | undefined;
  const registrationId = Symbol("webmcp-registration");

  async function runStart(): Promise<void> {
    if (started || options.enabled === false || !modelContext) return;
    const startGeneration = ++generation;
    registered = 0;
    started = true;
    let total = 0;
    const runController =
      typeof AbortController === "undefined"
        ? undefined
        : new AbortController();
    controller = runController;
    const isActive = () =>
      generation === startGeneration &&
      !(runController?.signal.aborted ?? false);
    try {
      const actions = await resolveActions(options.actions);
      if (!isActive()) return;
      const maxToolCount = options.maxToolCount ?? DEFAULT_TOOL_COUNT;
      if (actions.length > maxToolCount) {
        throw new Error(
          `WebMCP returned more than the ${maxToolCount}-tool limit`,
        );
      }
      const manifests = actions.map((action) => {
        if (!action.name || !action.description) {
          throw new Error("WebMCP actions require a name and description");
        }
        return actionManifest(action);
      });
      jsonLength(
        manifests,
        "WebMCP tool manifest",
        options.maxManifestChars ?? DEFAULT_MANIFEST_CHARS,
      );
      total = actions.length;
      installAgentNativeWebMcpPageHelper(
        options.document ? { document: options.document } : undefined,
      );
      publishRegistrationStatus(options.document, registrationId, {
        state: "registering",
        registered: 0,
        total,
      });
      const session = createSession(options.session);
      // Concurrent on purpose: the polyfill awaits a setTimeout(0) inside
      // every registerTool, and a hidden browser pane throttles timers to one
      // wake-up per second or worse. Sequential awaits cost one wake-up per
      // tool (a 141-tool page took minutes to become ready); concurrent ones
      // share a single wake-up.
      const registerAction = async (action: AgentNativeClientAction) => {
        if (!isActive()) return;
        if (!action?.name || !action.description) {
          throw new Error("WebMCP actions require a name and description");
        }
        const requiresApproval = sensitiveAction(action);
        if (
          requiresApproval &&
          !options.approve &&
          !options.commands?.requestApproval &&
          !options.commands?.["request-approval"]
        ) {
          throw new Error(
            `WebMCP action "${action.name}" requires an approval handler`,
          );
        }
        const inputSchema = actionInputSchema(action);
        validateBoundedJson(
          inputSchema,
          `WebMCP action "${action.name}" input schema`,
          options.maxSchemaChars ?? DEFAULT_SCHEMA_CHARS,
        );
        if (!TOOL_NAME_RE.test(action.name)) {
          throw new Error(`WebMCP action "${action.name}" has an invalid name`);
        }
        if (
          action.description.length >
          (options.maxDescriptionChars ?? DEFAULT_DESCRIPTION_CHARS)
        ) {
          throw new Error(
            `WebMCP action "${action.name}" has a long description`,
          );
        }
        await modelContext.registerTool(
          {
            name: action.name,
            title: agentNativeToolTitle(action.name, action.title),
            description: action.description,
            inputSchema,
            annotations: {
              readOnlyHint: action.readOnly === true,
              ...(typeof action.untrustedContentHint === "boolean"
                ? { untrustedContentHint: action.untrustedContentHint }
                : {}),
            },
            execute: async (input, executionOptions) => {
              if (executionOptions?.signal?.aborted) {
                throw new Error(`WebMCP action "${action.name}" was aborted`);
              }
              validateBoundedJson(
                input,
                `WebMCP action "${action.name}" input`,
                options.maxInputChars ?? DEFAULT_INPUT_CHARS,
              );
              const context = options.getContext
                ? await options.getContext()
                : {};
              const request = {
                action,
                args: input,
                context,
                session,
              } satisfies AgentNativeWebMcpApprovalRequest;
              if (requiresApproval) {
                const approved = options.approve
                  ? await options.approve(request)
                  : await (
                      options.commands?.requestApproval ??
                      options.commands?.["request-approval"]
                    )?.(
                      {
                        command: "requestApproval",
                        payload: {
                          action: actionManifest(action),
                          args: input,
                          context,
                          session,
                          approval:
                            typeof action.requiresApproval === "object"
                              ? action.requiresApproval
                              : action.approval,
                        },
                        origin: options.origin ?? "agent-native-webmcp",
                      },
                      undefined as unknown as MessageEvent,
                    );
                if (
                  approved !== true &&
                  !(
                    isRecord(approved) &&
                    (approved.approved === true || approved.ok === true)
                  )
                ) {
                  throw new Error(
                    `WebMCP action "${action.name}" was not approved`,
                  );
                }
              }
              const result = await action.run(
                input,
                actionRuntime(
                  options,
                  context,
                  session,
                  executionOptions?.signal,
                ),
              );
              if (executionOptions?.signal?.aborted) {
                throw new Error(`WebMCP action "${action.name}" was aborted`);
              }
              return serializeWebMcpResult(
                result,
                `WebMCP action "${action.name}" result`,
                options.maxResultChars ?? DEFAULT_RESULT_CHARS,
              );
            },
          },
          {
            ...(options.exposedTo ? { exposedTo: options.exposedTo } : {}),
            ...(runController ? { signal: runController.signal } : {}),
          },
        );
        if (!isActive()) return;
        registered += 1;
        publishRegistrationStatus(options.document, registrationId, {
          state: "registering",
          registered,
          total,
        });
      };
      await Promise.all(actions.map(registerAction));
      if (!isActive()) return;
      publishRegistrationStatus(options.document, registrationId, {
        state: "ready",
        registered,
        total,
      });
    } catch (error) {
      if (!isActive()) return;
      runController?.abort();
      started = false;
      controller = undefined;
      publishRegistrationStatus(options.document, registrationId, {
        state: "failed",
        registered,
        total,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  function start(): Promise<void> {
    if (startPromise) return startPromise;
    const promise = runStart();
    const settled = promise.finally(() => {
      if (startPromise === settled) startPromise = undefined;
    });
    startPromise = settled;
    return settled;
  }

  return {
    get supported() {
      return Boolean(modelContext);
    },
    get registered() {
      return registered;
    },
    start,
    stop() {
      generation += 1;
      controller?.abort();
      controller = undefined;
      registered = 0;
      started = false;
      startPromise = undefined;
      publishRegistrationStatus(options.document, registrationId, undefined);
    },
  };
}
