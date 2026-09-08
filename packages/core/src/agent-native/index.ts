import type {
  AgentInvocationResult,
  AgentInvocationRuntime,
  InvokeAgentOptions,
} from "../a2a/invoke.js";
import type { DiscoveredAgent } from "../server/agent-discovery.js";

type DiscoverAgents = (selfAppId?: string) => Promise<DiscoveredAgent[]>;
type InvokeAgent = (
  options: InvokeAgentOptions,
) => Promise<AgentInvocationResult>;

export interface AgentNativeRuntime extends Partial<AgentInvocationRuntime> {
  invokeAgent?: InvokeAgent;
}

export interface AgentNativeClientOptions {
  apiKey?: string;
  apiKeyEnv?: string;
  contextId?: string;
  selfAppId?: string;
  selfUrl?: string;
  userEmail?: string;
  orgDomain?: string;
  orgSecret?: string;
  async?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  includeInvocationHint?: boolean;
  env?: Record<string, string | undefined>;
  runtime?: AgentNativeRuntime;
}

export type AgentNativeInvokeOptions = Omit<
  AgentNativeClientOptions,
  "env" | "runtime"
>;

export interface AgentNativeInvokeRequest extends AgentNativeInvokeOptions {
  agent?: string;
  target?: string;
  prompt: string;
}

export interface AgentNativeListAgentsOptions {
  selfAppId?: string;
}

export interface AgentNativeClient {
  listAgents(
    options?: AgentNativeListAgentsOptions,
  ): Promise<DiscoveredAgent[]>;
  invoke(
    target: string,
    prompt: string,
    options?: AgentNativeInvokeOptions,
  ): Promise<AgentInvocationResult>;
  invoke(request: AgentNativeInvokeRequest): Promise<AgentInvocationResult>;
}

export function createAgentNativeClient(
  defaults: AgentNativeClientOptions = {},
): AgentNativeClient {
  const getRuntime = (): AgentNativeRuntime => defaults.runtime ?? {};

  async function listAgents(
    options: AgentNativeListAgentsOptions = {},
  ): Promise<DiscoveredAgent[]> {
    const discoverAgents =
      getRuntime().discoverAgents ?? (await loadDiscoverAgents());
    const env = resolveEnv(defaults, defaults.env);
    return discoverAgents(
      options.selfAppId ?? defaults.selfAppId ?? inferSelfAppId(env),
    );
  }

  async function invoke(
    targetOrRequest: string | AgentNativeInvokeRequest,
    prompt?: string,
    options: AgentNativeInvokeOptions = {},
  ): Promise<AgentInvocationResult> {
    const request =
      typeof targetOrRequest === "string"
        ? { ...options, target: targetOrRequest, prompt: prompt ?? "" }
        : targetOrRequest;

    const target = (request.target ?? request.agent ?? "").trim();
    if (!target) {
      throw new Error("agentNative.invoke requires an agent target");
    }

    const merged = mergeOptions(defaults, request);
    const runtime: AgentNativeRuntime = defaults.runtime ?? {};
    const invokeAgent = runtime.invokeAgent ?? (await loadInvokeAgent());
    const env = resolveEnv(merged, defaults.env);
    const auth = resolveAuth(merged, env);

    return invokeAgent({
      target,
      prompt: request.prompt,
      apiKey: auth.apiKey,
      contextId: merged.contextId,
      selfAppId: merged.selfAppId ?? inferSelfAppId(env),
      selfUrl: merged.selfUrl ?? env.APP_URL ?? env.BETTER_AUTH_URL,
      userEmail: merged.userEmail,
      orgDomain: merged.orgDomain,
      orgSecret: auth.orgSecret,
      async: merged.async,
      timeoutMs: merged.timeoutMs,
      pollIntervalMs: merged.pollIntervalMs,
      includeInvocationHint: merged.includeInvocationHint,
      runtime,
    });
  }

  return {
    listAgents,
    invoke: invoke as AgentNativeClient["invoke"],
  };
}

export const agentNative = createAgentNativeClient();

async function loadDiscoverAgents(): Promise<DiscoverAgents> {
  const mod = await import("../server/agent-discovery.js");
  return mod.discoverAgents;
}

async function loadInvokeAgent(): Promise<InvokeAgent> {
  const mod = await import("../a2a/invoke.js");
  return mod.invokeAgent;
}

function mergeOptions(
  defaults: AgentNativeClientOptions,
  options: AgentNativeInvokeRequest | AgentNativeInvokeOptions,
): AgentNativeClientOptions {
  return {
    ...defaults,
    ...options,
    runtime: defaults.runtime,
    env: defaults.env,
  };
}

function resolveAuth(
  options: AgentNativeClientOptions,
  env: Record<string, string | undefined>,
): { apiKey?: string; orgSecret?: string } {
  if (options.apiKey) {
    return { apiKey: options.apiKey, orgSecret: options.orgSecret };
  }
  if (!options.apiKeyEnv) return { orgSecret: options.orgSecret };

  const value = env[options.apiKeyEnv];
  if (!value) {
    throw new Error(`Environment variable ${options.apiKeyEnv} is not set`);
  }

  if (options.apiKeyEnv === "A2A_SECRET") {
    return { orgSecret: options.orgSecret ?? value };
  }

  return { apiKey: value, orgSecret: options.orgSecret };
}

function resolveEnv(
  options: AgentNativeClientOptions,
  defaultEnv?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return options.env ?? defaultEnv ?? defaultProcessEnv();
}

function defaultProcessEnv(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function inferSelfAppId(
  env: Record<string, string | undefined>,
): string | undefined {
  return (
    normalizeWorkspaceAppId(env.AGENT_NATIVE_WORKSPACE_APP_ID) ??
    normalizeWorkspaceAppId(env.APP_NAME) ??
    normalizeWorkspaceAppId(env.AGENT_APP) ??
    normalizeWorkspaceAppId(env.APP_BASE_PATH) ??
    normalizeWorkspaceAppId(env.VITE_APP_BASE_PATH) ??
    undefined
  );
}

function normalizeWorkspaceAppId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = trimmed.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(candidate)) return null;
  return candidate;
}
