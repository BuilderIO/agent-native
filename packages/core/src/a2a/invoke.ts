import {
  discoverAgents as defaultDiscoverAgents,
  findAgent as defaultFindAgent,
  type DiscoveredAgent,
} from "../server/agent-discovery.js";
import { callAgent as defaultCallAgent } from "./client.js";

export type AgentInvocationErrorCode =
  | "missing-target"
  | "missing-prompt"
  | "invalid-url"
  | "self-call"
  | "not-found";

export class AgentInvocationError extends Error {
  readonly code: AgentInvocationErrorCode;
  readonly target?: string;
  readonly availableAgents?: DiscoveredAgent[];

  constructor(
    code: AgentInvocationErrorCode,
    message: string,
    options?: { target?: string; availableAgents?: DiscoveredAgent[] },
  ) {
    super(message);
    this.name = "AgentInvocationError";
    this.code = code;
    this.target = options?.target;
    this.availableAgents = options?.availableAgents;
  }
}

export interface ResolvedAgentInvocationTarget {
  kind: "discovered" | "url";
  id?: string;
  name: string;
  description?: string;
  url: string;
  color?: string;
}

export interface AgentInvocationResult {
  target: ResolvedAgentInvocationTarget;
  prompt: string;
  responseText: string;
}

export interface AgentInvocationRuntime {
  findAgent: typeof defaultFindAgent;
  discoverAgents: typeof defaultDiscoverAgents;
  callAgent: typeof defaultCallAgent;
}

export interface ResolveAgentInvocationTargetOptions {
  selfAppId?: string;
  selfUrl?: string;
  runtime?: Partial<AgentInvocationRuntime>;
}

export interface InvokeAgentOptions extends ResolveAgentInvocationTargetOptions {
  target: string;
  prompt: string;
  apiKey?: string;
  contextId?: string;
  userEmail?: string;
  orgDomain?: string;
  orgSecret?: string;
  async?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  includeInvocationHint?: boolean;
  runtime?: Partial<AgentInvocationRuntime>;
}

/**
 * Resolve an A2A invocation target from a direct URL or from the connected app
 * registry. ID/name resolution deliberately uses the same discovery path as
 * the in-agent `call-agent` script.
 */
export async function resolveAgentInvocationTarget(
  target: string,
  options: ResolveAgentInvocationTargetOptions = {},
): Promise<ResolvedAgentInvocationTarget> {
  const cleanTarget = target.trim();
  if (!cleanTarget) {
    throw new AgentInvocationError(
      "missing-target",
      "Error: agent target is required",
    );
  }

  const directUrl = parseAgentUrl(cleanTarget);
  if (directUrl) {
    assertNotSelfUrl(directUrl, options.selfUrl);
    return {
      kind: "url",
      name: directUrl,
      url: directUrl,
    };
  }

  if (
    options.selfAppId &&
    normalizeAgentHandle(cleanTarget) ===
      normalizeAgentHandle(options.selfAppId)
  ) {
    throw new AgentInvocationError(
      "self-call",
      formatSelfCallError(options.selfAppId),
      { target: cleanTarget },
    );
  }

  const findAgent = options.runtime?.findAgent ?? defaultFindAgent;
  const discoverAgents =
    options.runtime?.discoverAgents ?? defaultDiscoverAgents;
  const agent = await findAgent(cleanTarget, options.selfAppId);
  if (!agent) {
    const availableAgents = await discoverAgents(options.selfAppId);
    const available = availableAgents.map((a) => a.name).join(", ");
    throw new AgentInvocationError(
      "not-found",
      `Error: Agent "${cleanTarget}" not found. Available agents: ${available || "(none)"}`,
      { target: cleanTarget, availableAgents },
    );
  }

  return {
    kind: "discovered",
    id: agent.id,
    name: agent.name,
    description: agent.description,
    url: agent.url,
    color: agent.color,
  };
}

/**
 * First-class headless A2A primitive: resolve an app/agent by id, name, or URL,
 * send a text prompt, and return the text response with target metadata.
 */
export async function invokeAgent(
  options: InvokeAgentOptions,
): Promise<AgentInvocationResult> {
  const prompt = options.prompt;
  if (!prompt.trim()) {
    throw new AgentInvocationError(
      "missing-prompt",
      "Error: prompt is required",
      { target: options.target },
    );
  }

  const target = await resolveAgentInvocationTarget(options.target, {
    selfAppId: options.selfAppId,
    selfUrl: options.selfUrl,
    runtime: options.runtime,
  });

  const promptToSend =
    options.includeInvocationHint === false
      ? prompt
      : buildAgentInvocationPrompt(prompt, target.url);

  const callAgent = options.runtime?.callAgent ?? defaultCallAgent;
  const responseText = await callAgent(target.url, promptToSend, {
    apiKey: options.apiKey,
    contextId: options.contextId,
    userEmail: options.userEmail,
    orgDomain: options.orgDomain,
    orgSecret: options.orgSecret,
    async: options.async,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });

  return {
    target,
    prompt: promptToSend,
    responseText,
  };
}

export function buildAgentInvocationPrompt(
  prompt: string,
  agentUrl: string,
): string {
  return (
    `${prompt}\n\n` +
    `[Note: this request comes from another app via A2A. The caller cannot see your local UI, resource list, or navigation - only the literal text you put in your reply. ` +
    `If you create or reference a deck/document/design/dashboard/resource, include its FULLY-QUALIFIED URL (e.g. ${agentUrl.replace(/\/$/, "")}/<path>/<id>) in your reply, not a relative path. ` +
    `Use only artifact IDs and URL paths returned by successful actions - never invent slugs, IDs, or hosts.]`
  );
}

export function looksLikeAgentUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}

function parseAgentUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!looksLikeAgentUrl(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AgentInvocationError(
      "invalid-url",
      `Error: Invalid agent URL "${trimmed}"`,
      { target: trimmed },
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AgentInvocationError(
      "invalid-url",
      "Error: Agent URL must use http or https",
      { target: trimmed },
    );
  }

  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

function assertNotSelfUrl(targetUrl: string, selfUrl: string | undefined) {
  if (!selfUrl) return;
  const target = canonicalAgentBaseUrl(targetUrl);
  const self = canonicalAgentBaseUrl(selfUrl);
  if (!target || !self || target !== self) return;
  throw new AgentInvocationError(
    "self-call",
    "Error: You cannot invoke this app via A2A from itself. Use the app's own registered actions/tools instead. A2A invocation is only for communicating with other separately-deployed apps.",
    { target: targetUrl },
  );
}

function canonicalAgentBaseUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/_agent-native/a2a")) {
      pathname = pathname.slice(0, -"/_agent-native/a2a".length);
    } else if (pathname.endsWith("/a2a")) {
      pathname = pathname.slice(0, -"/a2a".length);
    }
    parsed.pathname = pathname || "/";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizeAgentHandle(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "image" ||
    normalized === "images" ||
    normalized === "asset"
  ) {
    return "assets";
  }
  return normalized;
}

function formatSelfCallError(selfAppId: string): string {
  return `Error: You cannot use A2A invocation to call yourself (${selfAppId}). Use your own registered actions/tools instead. A2A invocation is only for communicating with OTHER separately-deployed apps.`;
}
