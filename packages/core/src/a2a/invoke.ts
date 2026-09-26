import { randomUUID } from "node:crypto";

import type {
  RemoteAgentAuth,
  RemoteAgentKind,
} from "../resources/metadata.js";
import {
  discoverAgents as defaultDiscoverAgents,
  findAgent as defaultFindAgent,
  type DiscoveredAgent,
} from "../server/agent-discovery.js";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "../server/request-context.js";
import {
  ANTHROPIC_MANAGED_AGENTS_METADATA_KEY,
  createAnthropicManagedAgentsHandler,
  type AnthropicManagedAgentContinuation,
} from "./anthropic-managed-agents.js";
import {
  callAction as defaultCallAction,
  callAgent as defaultCallAgent,
} from "./client.js";
import { resolveRemoteAgentToken } from "./remote-agent-auth.js";
import type {
  A2ACorrelationMetadata,
  A2AHandlerResult,
  A2AReadOnlyActionResult,
} from "./types.js";

export type AgentInvocationErrorCode =
  | "missing-target"
  | "missing-prompt"
  | "missing-action"
  | "invalid-input"
  | "invalid-url"
  | "invalid-response"
  | "unsupported-action"
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
  cardUrl?: string;
}

const invocationAuthByTarget = new WeakMap<
  ResolvedAgentInvocationTarget,
  RemoteAgentAuth
>();
const invocationProviderKindByTarget = new WeakMap<
  ResolvedAgentInvocationTarget,
  RemoteAgentKind
>();

export interface AgentInvocationResult {
  target: ResolvedAgentInvocationTarget;
  prompt: string;
  responseText: string;
  taskState?: "input-required";
  continuation?: AnthropicManagedAgentContinuation;
}

export interface AgentActionInvocationResult {
  target: ResolvedAgentInvocationTarget;
  action: string;
  result: A2AReadOnlyActionResult;
}

export interface AgentInvocationRuntime {
  findAgent: typeof defaultFindAgent;
  discoverAgents: typeof defaultDiscoverAgents;
  callAgent: typeof defaultCallAgent;
  callAction: typeof defaultCallAction;
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
  orgId?: string;
  orgDomain?: string;
  orgSecret?: string;
  async?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  includeInvocationHint?: boolean;
  correlation?: A2ACorrelationMetadata;
  idempotencyKey?: string;
  cardUrl?: string;
  runtime?: Partial<AgentInvocationRuntime>;
}

export interface InvokeAgentActionOptions extends ResolveAgentInvocationTargetOptions {
  target: string;
  action: string;
  input?: Record<string, unknown>;
  apiKey?: string;
  userEmail?: string;
  orgDomain?: string;
  orgSecret?: string;
  requestTimeoutMs?: number;
  correlation?: A2ACorrelationMetadata;
  cardUrl?: string;
  runtime?: Partial<AgentInvocationRuntime>;
}

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

  const resolvedTarget: ResolvedAgentInvocationTarget = {
    kind: "discovered",
    id: agent.id,
    name: agent.name,
    description: agent.description,
    url: agent.url,
    color: agent.color,
    ...(agent.cardUrl ? { cardUrl: agent.cardUrl } : {}),
  };
  if (agent.auth) invocationAuthByTarget.set(resolvedTarget, agent.auth);
  if (agent.kind)
    invocationProviderKindByTarget.set(resolvedTarget, agent.kind);
  return resolvedTarget;
}

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

  const auth = invocationAuthByTarget.get(target);
  const providerKind = invocationProviderKindByTarget.get(target);
  if (providerKind?.provider === "anthropic-managed-agents") {
    const handler = createAnthropicManagedAgentsHandler({
      agentId: providerKind.agentId,
      environmentId: providerKind.environmentId,
      credentialRef: providerKind.credentialRef,
      apiBaseUrl: target.url,
      resolveApiKey: async (credentialRef, context) =>
        resolveRemoteAgentToken(
          { type: "bearer", credentialRef },
          {
            userEmail: options.userEmail ?? context.userEmail,
            orgId: options.orgId ?? getRequestOrgId(),
          },
        ),
    });
    const invokeHandler = async (): Promise<A2AHandlerResult> =>
      (await handler(
        {
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
        {
          taskId: options.contextId ?? randomUUID(),
          contextId: options.contextId,
          writeArtifact: (name) => name,
        },
      )) as A2AHandlerResult;
    const requestContext = getRequestContext();
    const result = (await (requestContext ||
    options.userEmail !== undefined ||
    options.orgId !== undefined
      ? runWithRequestContext(
          {
            ...(requestContext ?? {}),
            ...(options.userEmail !== undefined
              ? { userEmail: options.userEmail }
              : {}),
            ...(options.orgId !== undefined ? { orgId: options.orgId } : {}),
          },
          invokeHandler,
        )
      : invokeHandler())) as A2AHandlerResult;
    const responseText = result.message.parts
      .filter((part): part is { type: "text"; text: string } => {
        return part.type === "text";
      })
      .map((part) => part.text)
      .join("\n")
      .trim();
    const resultMetadata =
      result.message.metadata?.[ANTHROPIC_MANAGED_AGENTS_METADATA_KEY];
    const continuation = readManagedAgentContinuation(resultMetadata);
    const taskState = result.taskState;
    if (!responseText) {
      throw new AgentInvocationError(
        "invalid-response",
        "Error: The managed agent returned no text response.",
        { target: options.target },
      );
    }
    return {
      target,
      prompt,
      responseText,
      ...(taskState ? { taskState } : {}),
      ...(continuation ? { continuation } : {}),
    };
  }
  const authOptions = await resolveInvocationAuth(target, options.userEmail);
  const callAgent = options.runtime?.callAgent ?? defaultCallAgent;
  const responseText = await callAgent(target.url, promptToSend, {
    ...(auth
      ? { apiKey: authOptions.token }
      : {
          apiKey: options.apiKey,
          userEmail: options.userEmail,
          orgDomain: options.orgDomain,
          orgSecret: options.orgSecret,
        }),
    contextId: options.contextId,
    async: options.async,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    correlation: options.correlation,
    idempotencyKey: options.idempotencyKey,
    ...((options.cardUrl ?? target.cardUrl)
      ? { cardUrl: options.cardUrl ?? target.cardUrl }
      : {}),
  });

  return {
    target,
    prompt: promptToSend,
    responseText,
  };
}

export async function invokeAgentAction(
  options: InvokeAgentActionOptions,
): Promise<AgentActionInvocationResult> {
  const action = options.action.trim();
  if (!action) {
    throw new AgentInvocationError(
      "missing-action",
      "Error: action is required",
      { target: options.target },
    );
  }
  const input = options.input ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentInvocationError(
      "invalid-input",
      "Error: action input must be an object",
      { target: options.target },
    );
  }

  const target = await resolveAgentInvocationTarget(options.target, {
    selfAppId: options.selfAppId,
    selfUrl: options.selfUrl,
    runtime: options.runtime,
  });
  const providerKind = invocationProviderKindByTarget.get(target);
  if (providerKind?.provider === "anthropic-managed-agents") {
    throw new AgentInvocationError(
      "unsupported-action",
      "Error: Anthropic Managed Agents targets accept messages only; direct action invocation is unavailable.",
      { target: options.target },
    );
  }
  const callAction = options.runtime?.callAction ?? defaultCallAction;
  const auth = invocationAuthByTarget.get(target);
  const authOptions = await resolveInvocationAuth(target, options.userEmail);
  const result = await callAction(target.url, action, input, {
    ...(auth
      ? { apiKey: authOptions.token }
      : {
          apiKey: options.apiKey,
          userEmail: options.userEmail,
          orgDomain: options.orgDomain,
          orgSecret: options.orgSecret,
        }),
    requestTimeoutMs: options.requestTimeoutMs,
    correlation: options.correlation,
    ...((options.cardUrl ?? target.cardUrl)
      ? { cardUrl: options.cardUrl ?? target.cardUrl }
      : {}),
  });

  return { target, action, result };
}

async function resolveInvocationAuth(
  target: ResolvedAgentInvocationTarget,
  userEmail?: string,
): Promise<{ token?: string }> {
  const auth = invocationAuthByTarget.get(target);
  if (!auth) return {};
  const token = await resolveRemoteAgentToken(auth, {
    userEmail: userEmail || getRequestUserEmail(),
    orgId: getRequestOrgId(),
  });
  return { token };
}

export function buildAgentInvocationPrompt(
  prompt: string,
  agentUrl: string,
): string {
  return (
    `${prompt}\n\n` +
    `<a2a-caller-hint>\n` +
    `This request comes from another app via A2A. The caller cannot see your local UI, resource list, or navigation - only the literal text you put in your reply. ` +
    `If you create or reference a deck/document/design/dashboard/resource, include its FULLY-QUALIFIED URL (e.g. ${agentUrl.replace(/\/$/, "")}/<path>/<id>) in your reply, not a relative path. ` +
    `Use only artifact IDs and URL paths returned by successful actions - never invent slugs, IDs, or hosts.\n` +
    `</a2a-caller-hint>`
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

function readManagedAgentContinuation(
  value: unknown,
): AnthropicManagedAgentContinuation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const continuationToken =
    typeof candidate.continuationToken === "string"
      ? candidate.continuationToken.trim()
      : "";
  if (!continuationToken) return undefined;
  const pendingToolUseIds = Array.isArray(candidate.pendingToolUseIds)
    ? candidate.pendingToolUseIds.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      )
    : [];
  return {
    continuationToken,
    ...(pendingToolUseIds.length ? { pendingToolUseIds } : {}),
  };
}
