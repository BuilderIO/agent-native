import {
  discoverAgents as defaultDiscoverAgents,
  type DiscoveredAgent,
} from "../server/agent-discovery.js";
import {
  invokeAgent as defaultInvokeAgent,
  type AgentInvocationResult,
  type AgentInvocationRuntime,
} from "../a2a/invoke.js";

export interface AgentNativeRuntime extends Partial<AgentInvocationRuntime> {
  invokeAgent?: typeof defaultInvokeAgent;
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
    const discoverAgents = getRuntime().discoverAgents ?? defaultDiscoverAgents;
    return discoverAgents(options.selfAppId ?? defaults.selfAppId);
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
    const invokeAgent = runtime.invokeAgent ?? defaultInvokeAgent;
    const apiKey = resolveApiKey(merged, defaults.env);

    return invokeAgent({
      target,
      prompt: request.prompt,
      apiKey,
      contextId: merged.contextId,
      selfAppId: merged.selfAppId,
      selfUrl: merged.selfUrl,
      userEmail: merged.userEmail,
      orgDomain: merged.orgDomain,
      orgSecret: merged.orgSecret,
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

function resolveApiKey(
  options: AgentNativeClientOptions,
  defaultEnv?: Record<string, string | undefined>,
): string | undefined {
  if (options.apiKey) return options.apiKey;
  if (!options.apiKeyEnv) return undefined;

  const env = options.env ?? defaultEnv ?? process.env;
  const value = env[options.apiKeyEnv];
  if (!value) {
    throw new Error(`Environment variable ${options.apiKeyEnv} is not set`);
  }
  return value;
}
