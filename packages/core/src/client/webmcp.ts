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
    inputObject?: string,
    options?: AgentNativeWebMcpToolExecutionOptions,
  ): Promise<unknown>;
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
    options: NativeContextToolExecuteOptions,
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
  if (tool.inputSchema !== undefined) {
    if (!isRecord(tool.inputSchema)) {
      throw new Error(`WebMCP tool "${tool.name}" has an invalid input schema`);
    }
    jsonLength(
      tool.inputSchema,
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
    ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
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
  const nativeTools = new Map<string, NativeRegisteredTool>();
  let listedNativeTools = new WeakMap<object, NativeRegisteredTool>();

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
    listedNativeTools = new WeakMap();
    nativeTools.clear();
    normalizedTools.forEach((tool, index) => {
      nativeTools.set(toolKey(tool), result[index]);
      listedNativeTools.set(tool, result[index]);
    });
    return normalizedTools;
  }

  function findNativeTool(
    tool: Pick<AgentNativeWebMcpTool, "name" | "origin">,
  ): NativeRegisteredTool | undefined {
    const matches = [...nativeTools.values()].filter(
      (candidate) =>
        candidate.name === tool.name &&
        (!tool.origin || candidate.origin === tool.origin),
    );
    if (matches.length > 1 && !tool.origin) {
      throw new Error(
        `WebMCP tool "${tool.name}" is exposed by multiple origins; origin is required`,
      );
    }
    return matches[0];
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
    const result = await requireModelContext().executeTool(
      nativeTool,
      JSON.stringify(input),
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

    await listTools();
    const nativeTool = findNativeTool(tool);
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
        `WebMCP tool "${tool.name}" was not returned by the current live listing`,
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
  const { run: _run, ...manifest } = action;
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
  const modelContext = getModelContext(options.document);
  let controller: AbortController | undefined;
  let registered = 0;
  let started = false;
  let generation = 0;

  async function start(): Promise<void> {
    if (started || options.enabled === false || !modelContext) return;
    const startGeneration = ++generation;
    started = true;
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
      const session = createSession(options.session);
      for (const action of actions) {
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
            ...(action.title ? { title: action.title } : {}),
            description: action.description,
            inputSchema,
            annotations: {
              readOnlyHint: action.readOnly === true,
              ...(typeof action.untrustedContentHint === "boolean"
                ? { untrustedContentHint: action.untrustedContentHint }
                : {}),
            },
            execute: async (input, executionOptions) => {
              if (executionOptions.signal.aborted) {
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
                actionRuntime(options, context, session),
              );
              if (executionOptions.signal.aborted) {
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
      }
    } catch (error) {
      if (!isActive()) return;
      runController?.abort();
      registered = 0;
      started = false;
      controller = undefined;
      throw error;
    }
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
    },
  };
}
