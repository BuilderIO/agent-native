import {
  deleteUserSetting,
  getUserSetting,
  putUserSetting,
} from "../settings/user-settings.js";
import { httpStatusFromError } from "./errors.js";
import { fetchMcpOriginBound } from "./manager.js";
import {
  deleteMcpOAuthCredentials,
  getMcpOAuthAccessToken,
  getMcpOAuthConnectionState,
  markMcpOAuthReconnectRequired,
  revokeMcpOAuthCredentials,
  saveMcpOAuthCredentials,
  type McpOAuthCredentialBundle,
} from "./oauth-client.js";

export const T3_CODE_SETTING_KEY = "t3-code-connection";
/** The `purpose` an MCP sign-in carries when it connects T3 Code. */
export const T3_CODE_OAUTH_PURPOSE = "t3-code";
const T3_CODE_OPERATE_SCOPE = "orchestration:operate";
const T3_CODE_CALL_TIMEOUT_MS = 20_000;

export interface T3CodeConnection {
  url: string;
  oauthSecretKey: string;
  connectedAt: number;
}

export type T3CodeAgentKind = "claude-code" | "codex";

export interface T3CodeAgent {
  kind: T3CodeAgentKind;
  name: string;
  providerInstanceId: string;
  model: string;
}

export interface T3CodeStatus {
  state: "disconnected" | "connected" | "reconnect" | "unreachable";
  url?: string;
  computer?: string;
  /** "operate" can start and message threads; "read" can only look. */
  access?: "read" | "operate";
  agents: T3CodeAgent[];
  /** When T3 will ask this person to sign in again. */
  expiresAt?: number;
}

export interface T3CodeThread {
  threadId: string;
  title: string;
  status: string;
  agent: T3CodeAgentKind | null;
  projectId: string | null;
  updatedAt: string | null;
}

export class T3CodeNotConnectedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Connect T3 Code in Settings › Model first.");
    this.name = "T3CodeNotConnectedError";
  }
}

export class T3CodeReconnectRequiredError extends Error {
  readonly statusCode = 409;
  constructor() {
    super(
      "T3 Code needs you to sign in again. Reconnect it in Settings › Model.",
    );
    this.name = "T3CodeReconnectRequiredError";
  }
}

export class T3CodeUnreachableError extends Error {
  readonly statusCode = 502;
  constructor() {
    super(
      "Can't reach T3 Code at that address. In T3 Code, turn on T3 Connect for this computer and use the address Copy MCP URL gives you.",
    );
    this.name = "T3CodeUnreachableError";
  }
}

const AGENT_NAMES: Record<T3CodeAgentKind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

export function t3CodeAgentName(kind: T3CodeAgentKind): string {
  return AGENT_NAMES[kind];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function credentialIdentity(email: string, connection: T3CodeConnection) {
  return {
    key: connection.oauthSecretKey,
    scope: "user" as const,
    scopeId: email,
    serverUrl: connection.url,
  };
}

function shortId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function getT3CodeConnection(
  email: string,
): Promise<T3CodeConnection | null> {
  const raw = await getUserSetting(normalizeEmail(email), T3_CODE_SETTING_KEY);
  if (
    !raw ||
    typeof raw.url !== "string" ||
    typeof raw.oauthSecretKey !== "string"
  ) {
    return null;
  }
  return {
    url: raw.url,
    oauthSecretKey: raw.oauthSecretKey,
    connectedAt: typeof raw.connectedAt === "number" ? raw.connectedAt : 0,
  };
}

/** Save a finished T3 sign-in, replacing (and revoking) any earlier one. */
export async function saveT3CodeConnection(
  email: string,
  input: { url: string; credentials: McpOAuthCredentialBundle },
): Promise<T3CodeConnection> {
  const owner = normalizeEmail(email);
  const previous = await getT3CodeConnection(owner);
  const connection: T3CodeConnection = {
    url: input.url,
    oauthSecretKey: `mcp_oauth:${shortId()}`,
    connectedAt: Date.now(),
  };
  await saveMcpOAuthCredentials({
    key: connection.oauthSecretKey,
    scope: "user",
    scopeId: owner,
    credentials: input.credentials,
  });
  await putUserSetting(owner, T3_CODE_SETTING_KEY, { ...connection });
  if (previous) {
    await revokeMcpOAuthCredentials(credentialIdentity(owner, previous)).catch(
      () =>
        deleteMcpOAuthCredentials(credentialIdentity(owner, previous)).catch(
          () => false,
        ),
    );
  }
  return connection;
}

export async function disconnectT3Code(
  email: string,
): Promise<{ disconnected: boolean }> {
  const owner = normalizeEmail(email);
  const connection = await getT3CodeConnection(owner);
  if (!connection) return { disconnected: false };
  await deleteUserSetting(owner, T3_CODE_SETTING_KEY);
  await revokeMcpOAuthCredentials(credentialIdentity(owner, connection)).catch(
    () =>
      deleteMcpOAuthCredentials(credentialIdentity(owner, connection)).catch(
        () => false,
      ),
  );
  return { disconnected: true };
}

export type T3CodeCall = <T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown>,
) => Promise<T>;

interface ToolResult {
  isError?: unknown;
  structuredContent?: unknown;
  content?: unknown;
}

function toolResultValue(result: ToolResult): unknown {
  if (result.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent;
  const text = Array.isArray(result.content)
    ? result.content
        .map((part: unknown) => {
          const { type, text: partText } = (part ?? {}) as {
            type?: unknown;
            text?: unknown;
          };
          return type === "text" && typeof partText === "string"
            ? partText
            : "";
        })
        .join("")
    : "";
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function toolErrorMessage(result: ToolResult): string {
  const value = toolResultValue(result);
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const message =
    [record.error, record.message, record.text].find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.length > 0,
    ) ?? "T3 Code refused the request.";
  return message.slice(0, 500);
}

/**
 * Run `fn` with one MCP session to the person's T3 Code. Every call carries
 * their own sign-in; a refused token marks the sign-in for Reconnect.
 */
export async function withT3Code<R>(
  email: string,
  fn: (call: T3CodeCall) => Promise<R>,
): Promise<R> {
  const owner = normalizeEmail(email);
  const connection = await getT3CodeConnection(owner);
  if (!connection) throw new T3CodeNotConnectedError();
  const identity = credentialIdentity(owner, connection);
  const token = await getMcpOAuthAccessToken({
    ...identity,
    throwOnTransientRefreshFailure: true,
  });
  if (!token) throw new T3CodeReconnectRequiredError();

  const { Client, StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/client");
  const origin = new URL(connection.url).origin;
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (input, init) => fetchMcpOriginBound(input, init, origin),
  });
  const client = new Client(
    { name: "agent-native-t3-code", version: "1.0.0" },
    { capabilities: {}, versionNegotiation: { mode: "auto" } },
  );
  const failWith = async (error: unknown): Promise<never> => {
    const status = httpStatusFromError(error);
    if (status === 401 || status === 403) {
      // coercion-ok: the refused sign-in is reported below either way; marking it only shows Reconnect sooner.
      await markMcpOAuthReconnectRequired(identity).catch(() => false);
      throw new T3CodeReconnectRequiredError();
    }
    if (
      error instanceof T3CodeToolError ||
      error instanceof T3CodeReconnectRequiredError
    ) {
      throw error;
    }
    throw new T3CodeUnreachableError();
  };
  try {
    await withTimeout(client.connect(transport), T3_CODE_CALL_TIMEOUT_MS);
  } catch (error) {
    await client.close().catch(() => undefined);
    return failWith(error);
  }
  try {
    const call: T3CodeCall = async <T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> => {
      let result: ToolResult;
      try {
        result = (await withTimeout(
          client.callTool({ name, arguments: args }),
          T3_CODE_CALL_TIMEOUT_MS,
        )) as ToolResult;
      } catch (error) {
        return failWith(error);
      }
      if (result.isError) throw new T3CodeToolError(toolErrorMessage(result));
      return toolResultValue(result) as T;
    };
    return await fn(call);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export class T3CodeToolError extends Error {
  readonly statusCode = 502;
  constructor(message: string) {
    super(message);
    this.name = "T3CodeToolError";
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("T3 Code did not answer in time.")),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface CapabilityProvider {
  providerInstanceId?: unknown;
  driverKind?: unknown;
  models?: Array<{ id?: unknown } | null>;
  constraints?: unknown[];
}

/** Claude Code and Codex, from the providers T3 reports as signed in. */
export function t3CodeAgentsFromCapabilities(value: unknown): T3CodeAgent[] {
  const listed = (value as { providers?: unknown } | null | undefined)
    ?.providers;
  const providers = Array.isArray(listed)
    ? (listed as CapabilityProvider[])
    : [];
  const agents: T3CodeAgent[] = [];
  for (const provider of providers) {
    const kind = agentKindForDriver(provider.driverKind);
    if (!kind || agents.some((agent) => agent.kind === kind)) continue;
    const constraints = Array.isArray(provider.constraints)
      ? provider.constraints
      : [];
    const model = provider.models?.find((m) => typeof m?.id === "string")?.id;
    if (
      constraints.length > 0 ||
      typeof model !== "string" ||
      typeof provider.providerInstanceId !== "string"
    ) {
      continue;
    }
    agents.push({
      kind,
      name: AGENT_NAMES[kind],
      providerInstanceId: provider.providerInstanceId,
      model,
    });
  }
  return agents.sort((a, b) => a.kind.localeCompare(b.kind));
}

function agentKindForDriver(driver: unknown): T3CodeAgentKind | null {
  if (driver === "claudeAgent") return "claude-code";
  if (driver === "codex") return "codex";
  return null;
}

/** Which agent ran a thread, from its provider instance or model. */
export function t3CodeThreadAgent(thread: {
  providerInstanceId?: unknown;
  model?: unknown;
}): T3CodeAgentKind | null {
  const instance =
    typeof thread.providerInstanceId === "string"
      ? thread.providerInstanceId.toLowerCase()
      : "";
  const model =
    typeof thread.model === "string" ? thread.model.toLowerCase() : "";
  if (instance.includes("claude") || model.startsWith("claude"))
    return "claude-code";
  if (
    instance.includes("codex") ||
    model.startsWith("gpt") ||
    model.startsWith("codex")
  )
    return "codex";
  return null;
}

export function toT3CodeThread(raw: unknown): T3CodeThread | null {
  if (!raw || typeof raw !== "object") return null;
  const thread = raw as Record<string, unknown>;
  if (typeof thread.threadId !== "string") return null;
  return {
    threadId: thread.threadId,
    title: typeof thread.title === "string" ? thread.title : "Untitled thread",
    status: typeof thread.status === "string" ? thread.status : "idle",
    agent: t3CodeThreadAgent(thread),
    projectId: typeof thread.projectId === "string" ? thread.projectId : null,
    updatedAt: typeof thread.updatedAt === "string" ? thread.updatedAt : null,
  };
}

export async function getT3CodeStatus(email: string): Promise<T3CodeStatus> {
  const owner = normalizeEmail(email);
  const connection = await getT3CodeConnection(owner);
  if (!connection) return { state: "disconnected", agents: [] };
  const identity = credentialIdentity(owner, connection);
  const credential = await getMcpOAuthConnectionState(identity);
  const base = { url: connection.url, agents: [] as T3CodeAgent[] };
  if (credential.kind !== "connected" && credential.kind !== "expired") {
    return { ...base, state: "reconnect" };
  }
  const tokens = credential.credential.tokens as { scope?: unknown };
  const scopes =
    typeof tokens.scope === "string" ? tokens.scope.split(/\s+/) : [];
  const access = scopes.includes(T3_CODE_OPERATE_SCOPE) ? "operate" : "read";
  const expiresAt = credential.credential.tokenExpiresAt;
  try {
    return await withT3Code(owner, async (call) => {
      const environment = await call<{ label?: unknown }>(
        "t3_environment_read",
        {},
      );
      const capabilities = await call("orchestrator_capabilities", {});
      return {
        ...base,
        state: "connected" as const,
        ...(typeof environment.label === "string"
          ? { computer: environment.label }
          : {}),
        access,
        agents: t3CodeAgentsFromCapabilities(capabilities),
        ...(expiresAt ? { expiresAt } : {}),
      };
    });
  } catch (error) {
    if (error instanceof T3CodeReconnectRequiredError) {
      return { ...base, state: "reconnect" };
    }
    return { ...base, state: "unreachable", access };
  }
}
