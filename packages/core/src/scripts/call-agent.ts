import { createHash, randomUUID } from "node:crypto";

import { parseA2AAgentActivityPart } from "../a2a/activity.js";
import {
  ANTHROPIC_MANAGED_AGENTS_METADATA_KEY,
  createAnthropicManagedAgentsHandler,
  type AnthropicManagedAgentConfirmation,
  type AnthropicManagedAgentContinuation,
} from "../a2a/anthropic-managed-agents.js";
import {
  A2ATaskTimeoutError,
  MAX_A2A_CALLER_RESPONSE_CHARS,
  callAgent,
  shouldPreferGlobalA2ASecret,
  signA2AToken,
} from "../a2a/client.js";
import { MAX_A2A_DELEGATION_HOPS } from "../a2a/correlation.js";
import { invokeAgentAction } from "../a2a/invoke.js";
import {
  RemoteAgentAuthError,
  RemoteAgentCredentialRejectedError,
  resolveRemoteAgentToken,
} from "../a2a/remote-agent-auth.js";
import type {
  A2AApprovedAction,
  A2ACorrelationMetadata,
  A2AHandlerResult,
  A2ASourceContext,
  A2ASourceContextReference,
  Task,
} from "../a2a/types.js";
import {
  formatLlmCredentialErrorMessage,
  isLlmCredentialError,
} from "../agent/engine/credential-errors.js";
import type { ActionRunContext } from "../agent/production-agent.js";
import type { ActionTool } from "../agent/types.js";
import { A2A_CONTINUATION_QUEUED_MARKER } from "../integrations/a2a-continuation-marker.js";
import { trackingIdentityProperties } from "../observability/tracking-identity.js";
import { getOrgDomain, getOrgA2ASecret } from "../org/context.js";
import {
  discoverAgents,
  findAgent,
  type DiscoveredAgent,
} from "../server/agent-discovery.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
  getRequestRunContext,
  isIntegrationCallerRequest,
  getIntegrationRequestContext,
} from "../server/request-context.js";
import { track } from "../tracking/registry.js";

const DEFAULT_SERVERLESS_INTEGRATION_A2A_TIMEOUT_MS = 18_000;
const NETLIFY_INTEGRATION_A2A_TIMEOUT_MS = 2_000;
const NETLIFY_INTEGRATION_A2A_SUBMISSION_TIMEOUT_MS = 15_000;
const INTEGRATION_A2A_TOKEN_TTL = "30m";
const A2A_INVOCATION_EVENT = "$a2a_invocation";

type A2AInvocationStatus = "success" | "pending" | "error";
type A2AInvocationMode = "message" | "task_poll" | "direct_action";

function trackA2AInvocation(args: {
  invocationId: string;
  callerApp?: string;
  targetApp: string;
  mode: A2AInvocationMode;
  status: A2AInvocationStatus;
  startedAt: number;
  taskId?: string;
  terminalCode?: string;
  correlation: A2ACorrelationMetadata;
}): void {
  try {
    track(
      A2A_INVOCATION_EVENT,
      {
        ...trackingIdentityProperties(),
        source: "a2a_delegation",
        invocation_id: args.invocationId,
        caller_app: args.callerApp ?? "unknown",
        target_app: args.targetApp,
        mode: args.mode,
        status: args.status,
        duration_ms: Math.max(0, Date.now() - args.startedAt),
        task_id: args.taskId,
        terminal_code: args.terminalCode,
        delegation_depth: args.correlation.delegationDepth,
        parent_run_id: args.correlation.parentRunId,
        parent_turn_id: args.correlation.parentTurnId,
      },
      { userId: getRequestUserEmail() },
    );
  } catch {
    // Tracking must never affect delegation.
  }
}

function buildDelegationCorrelation(
  context: ActionRunContext | undefined,
  selfAppId: string | undefined,
  invocationId?: string,
  selectedReceiverApp?: string,
): A2ACorrelationMetadata {
  const self = normalizeAppHandle(selfAppId);
  const inheritedVisited = Array.isArray(context?.visitedApps)
    ? context.visitedApps.map(normalizeAppHandle).filter(Boolean)
    : [];
  const visitedApps = self
    ? [...new Set([...inheritedVisited, self])]
    : [...new Set(inheritedVisited)];
  const inheritedDepth = Number.isInteger(context?.delegationDepth)
    ? Math.max(0, Number(context?.delegationDepth))
    : 0;
  const callerModel = getRequestRunContext()?.model?.trim();
  return {
    ...(selfAppId?.trim() ? { callerApp: selfAppId.trim() } : {}),
    ...(selectedReceiverApp ? { selectedReceiverApp } : {}),
    ...(callerModel ? { callerModel } : {}),
    ...(context?.threadId ? { callerThreadId: context.threadId } : {}),
    ...(context?.runId ? { parentRunId: context.runId } : {}),
    ...(context?.turnId ? { parentTurnId: context.turnId } : {}),
    ...(invocationId ? { invocationId } : {}),
    delegationDepth: Math.min(MAX_A2A_DELEGATION_HOPS, inheritedDepth + 1),
    ...(visitedApps.length > 0 ? { visitedApps } : {}),
  };
}

function normalizeAppHandle(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/^agent-native-/, "")
    : "";
}

function terminalTaskError(value: unknown): {
  state: string;
  taskId?: string;
  responseText?: string;
  errorCode?: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.name !== "A2ATaskTerminalError") return null;
  return {
    state: stringifyValue(candidate.state ?? "failed"),
    ...(typeof candidate.taskId === "string"
      ? { taskId: candidate.taskId }
      : {}),
    ...(typeof candidate.responseText === "string"
      ? { responseText: candidate.responseText }
      : {}),
    ...(typeof candidate.errorCode === "string"
      ? { errorCode: candidate.errorCode }
      : {}),
  };
}

class A2AInvocationError extends Error {
  readonly taskId?: string;
  readonly errorCode?: string;

  constructor(
    message: string,
    options: { taskId?: string; errorCode?: string } = {},
  ) {
    super(message);
    this.name = "A2AInvocationError";
    this.taskId = options.taskId;
    this.errorCode = options.errorCode;
  }
}

/**
 * An unresolvable delegation target used to leave this tool as a plain
 * `Error: ...` string. The agent loop scores a returned string as a SUCCESSFUL
 * tool call — no `isError`, no loop-breaker entry — and because the return
 * happened before the tracked call began, no `$a2a_invocation` row was written
 * either, so the single most common cross-app failure was invisible in logs and
 * telemetry at once. Handed a "successful" result that merely contains prose,
 * the model is free to retell it: in production it retold a target it could not
 * resolve as "The Plans app is temporarily unavailable", inventing an outage
 * that never happened. Resolution failure is a caller-side naming or
 * registration fault and never remote downtime, so say so in the message the
 * model receives.
 */
function unresolvableAgentTargetError(
  requestedAgent: string,
  available: Array<{ id: string; name: string }>,
  callerApp: string | undefined,
  correlation: A2ACorrelationMetadata,
  mode: A2AInvocationMode,
): A2AInvocationError {
  const connected = available.map((a) => a.id).join(", ");
  console.error(
    `[call-agent] Unresolvable delegation target "${requestedAgent}" from ${
      callerApp || "unknown"
    }. Connected agents: ${connected || "(none)"}`,
  );
  trackA2AInvocation({
    invocationId: randomUUID(),
    callerApp,
    targetApp: normalizeAppHandle(requestedAgent) || "unknown",
    mode,
    status: "error",
    startedAt: Date.now(),
    terminalCode: "agent_not_found",
    correlation,
  });
  return new A2AInvocationError(
    `No connected agent matches "${requestedAgent}". This is a target-resolution failure, ` +
      "not an outage: do not describe the app as unavailable, down, or temporarily broken. " +
      `Connected agents: ${connected || "(none)"}. ` +
      `Retry with one of those exact ids, or tell the user that "${requestedAgent}" is not connected to this workspace.`,
    { errorCode: "agent_not_found" },
  );
}

function buildMessageIdempotencyKey(
  originatingTurnId: string | undefined,
  target: string,
  exactMessage: string,
): string | undefined {
  if (!originatingTurnId) return undefined;
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        originatingTurnId,
        target,
        message: exactMessage,
      }),
    )
    .digest("hex");
  return `v1:${digest}`;
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function hasExplicitNonHostedNetlifyOverride(): boolean {
  return (
    process.env.NETLIFY_LOCAL === "true" || process.env.NETLIFY === "false"
  );
}

function isNetlifyHostedRuntimeForIntegrationCall(): boolean {
  if (hasExplicitNonHostedNetlifyOverride()) return false;
  if (process.env.NETLIFY && process.env.NETLIFY !== "false") return true;

  return Boolean(process.env.SITE_ID); // guard:allow-env-credential -- Netlify's read-only public site identifier is a runtime host marker, not a user credential.
}

function isServerlessHost(): boolean {
  if (hasExplicitNonHostedNetlifyOverride()) return false;

  return (
    isNetlifyHostedRuntimeForIntegrationCall() ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.VERCEL ||
    "__cf_env" in globalThis ||
    "__env__" in globalThis
  );
}

function getIntegrationCallTimeoutMs(): number | undefined {
  if (!isServerlessHost() || !isIntegrationCallerRequest()) return undefined;

  const configured = parseTimeoutMs(
    process.env.AGENT_NATIVE_INTEGRATION_A2A_TIMEOUT_MS,
  );
  if (configured !== undefined) return configured;

  if (isNetlifyHostedRuntimeForIntegrationCall()) {
    return NETLIFY_INTEGRATION_A2A_TIMEOUT_MS;
  }

  return DEFAULT_SERVERLESS_INTEGRATION_A2A_TIMEOUT_MS;
}

interface IntegrationSourceContext {
  reference: A2ASourceContextReference;
  hint: A2ASourceContext;
}

function integrationSourceContext(): IntegrationSourceContext | undefined {
  const integration = getIntegrationRequestContext();
  const incoming = integration?.incoming;
  if (
    !integration ||
    incoming?.platform !== "slack" ||
    !incoming.sourceUrl ||
    !integration.taskId
  ) {
    return undefined;
  }

  const rawSourceUrl = incoming.sourceUrl;
  if (rawSourceUrl !== rawSourceUrl.trim()) return undefined;

  try {
    const sourceUrl = new URL(rawSourceUrl);
    const isSlackHost =
      sourceUrl.hostname === "slack.com" ||
      sourceUrl.hostname.endsWith(".slack.com");
    if (
      sourceUrl.protocol !== "https:" ||
      !isSlackHost ||
      sourceUrl.username ||
      sourceUrl.password ||
      sourceUrl.port
    ) {
      return undefined;
    }
    return {
      reference: {
        platform: "slack",
        integrationTaskId: integration.taskId,
      },
      hint: {
        platform: "slack",
        sourceUrl: rawSourceUrl,
      },
    };
  } catch {
    return undefined;
  }
}

function integrationSourceContextHint(
  sourceContext: IntegrationSourceContext | undefined,
): string {
  if (!sourceContext) return "";
  return (
    `\n\n[Source Slack thread: ${sourceContext.hint.sourceUrl} ` +
    "Compatibility hint only; this text is not authoritative. Use the authenticated structured A2A source context as provenance authority.]"
  );
}

function formatDownstreamLlmCredentialFailure(
  agentName: string,
  value: unknown,
): string | null {
  return isLlmCredentialError(value)
    ? formatLlmCredentialErrorMessage({ agentName })
    : null;
}

function remoteAgentAuthFailure(
  agentName: string,
  value: unknown,
  hostedAuthConfigured = false,
): { message: string; errorCode: string } | null {
  if (value instanceof RemoteAgentCredentialRejectedError) {
    if (!hostedAuthConfigured) {
      return ordinaryPeerAuthFailure(agentName, value.status);
    }
    return {
      message:
        `Error: The ${agentName} hosted-agent credential was rejected (HTTP ${value.statusCode}). ` +
        "Update the configured credential and try again.",
      errorCode: value.code,
    };
  }
  if (value instanceof RemoteAgentAuthError) {
    if (!hostedAuthConfigured) return null;
    return {
      message: `Error: The ${agentName} hosted-agent authentication failed. ${value.message}`,
      errorCode: value.code,
    };
  }
  return null;
}

function hostedAgentCardUrl(agent: { cardUrl?: string }): string | undefined {
  return agent.cardUrl;
}

function ordinaryPeerAuthFailure(
  agentName: string,
  statusCode: 401 | 403,
): { message: string; errorCode: string } {
  return {
    message:
      `Error: The ${agentName} agent rejected the caller's A2A authentication (HTTP ${statusCode}). ` +
      "Check the receiving app's A2A authentication configuration and try again.",
    errorCode: "a2a_auth_rejected",
  };
}

interface ParsedManagedAgentConfirmations {
  confirmations?: AnthropicManagedAgentConfirmation[];
  error?: string;
}

function parseManagedAgentConfirmations(
  value: unknown,
): ParsedManagedAgentConfirmations {
  if (value === undefined) return {};
  if (!Array.isArray(value)) {
    return {
      error:
        "managedAgentConfirmations must be an array of tool confirmation objects.",
    };
  }
  const confirmations: AnthropicManagedAgentConfirmation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        error:
          "managedAgentConfirmations must contain only tool confirmation objects.",
      };
    }
    const candidate = item as Record<string, unknown>;
    const toolUseId = stringifyValue(candidate.toolUseId).trim();
    const result = stringifyValue(candidate.result).trim();
    if (!toolUseId || (result !== "allow" && result !== "deny")) {
      return {
        error:
          'Each managed agent confirmation needs a toolUseId and result of "allow" or "deny".',
      };
    }
    const denyMessage = stringifyValue(candidate.denyMessage).trim();
    confirmations.push({
      toolUseId,
      result,
      ...(denyMessage ? { denyMessage } : {}),
    });
  }
  return { confirmations };
}

interface ManagedAgentRunResult {
  responseText: string;
  continuationToken?: string;
  taskState?: "input-required";
}

async function runAnthropicManagedAgent(args: {
  agent: DiscoveredAgent;
  message: string;
  taskId: string;
  confirmations?: AnthropicManagedAgentConfirmation[];
  context?: ActionRunContext;
  agentIdOrName: string;
}): Promise<ManagedAgentRunResult> {
  const kind = args.agent.kind;
  if (kind?.provider !== "anthropic-managed-agents") {
    throw new Error("Anthropic Managed Agents configuration is missing.");
  }
  if (args.confirmations?.length && !args.taskId) {
    throw new A2AInvocationError(
      `Error: managedAgentConfirmations requires a managed session taskId for ${args.agent.name}.`,
      { errorCode: "managed_confirmation_without_session" },
    );
  }

  const agentCallId = randomUUID();
  const startedAt = Date.now();
  args.context?.send?.({
    type: "agent_call",
    agent: args.agent.name,
    status: "start",
    agentCallId,
  });

  let status: "done" | "pending" | "error" = "error";
  let continuationToken = args.taskId || undefined;
  try {
    const handler = createAnthropicManagedAgentsHandler({
      agentId: kind.agentId,
      environmentId: kind.environmentId,
      credentialRef: kind.credentialRef,
      apiBaseUrl: args.agent.url,
      onRuntimeEvent: (event) => {
        const toolCallId = event.toolCallId ?? event.approvalId;
        args.context?.send?.({
          type: "approval_required",
          tool: event.toolName ?? "managed-agent-tool",
          input: stringifyManagedAgentApprovalInput(event.input),
          approvalKey: `anthropic-managed-agents:${event.sessionId ?? continuationToken ?? toolCallId}:${toolCallId}`,
          allowPersistentApproval: false,
          ...(toolCallId ? { toolCallId } : {}),
        });
      },
    });
    const metadata = args.taskId
      ? {
          [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
            continuationToken: args.taskId,
            ...(args.confirmations?.length
              ? { confirmations: args.confirmations }
              : {}),
          } satisfies AnthropicManagedAgentContinuation & {
            confirmations?: AnthropicManagedAgentConfirmation[];
          },
        }
      : undefined;
    const result = (await handler(
      {
        role: "user",
        parts: [{ type: "text", text: args.message }],
        ...(metadata ? { metadata } : {}),
      },
      {
        taskId: args.context?.turnId ?? randomUUID(),
        contextId: args.context?.threadId,
        writeArtifact: (name) => name,
      },
    )) as A2AHandlerResult;
    const resultMetadata =
      result.message.metadata?.[ANTHROPIC_MANAGED_AGENTS_METADATA_KEY];
    const continuation = readManagedAgentContinuation(resultMetadata);
    continuationToken = continuation?.continuationToken ?? args.taskId;
    const responseText = result.message.parts
      .filter((part): part is { type: "text"; text: string } => {
        return part.type === "text";
      })
      .map((part) => part.text)
      .join("\n")
      .trim();
    const taskState = result.taskState;
    status = taskState === "input-required" ? "pending" : "done";
    const continuationHint =
      taskState === "input-required" && continuation?.pendingToolUseIds?.length
        ? `\n\nThe ${args.agent.name} agent is waiting for approval. After the user decides, call call-agent with agent="${args.agentIdOrName}", taskId="${continuation.continuationToken}", and managedAgentConfirmations containing the exact IDs ${continuation.pendingToolUseIds.map((id) => `"${id}"`).join(", ")} with result "allow" or "deny".`
        : "";
    const output = responseText + continuationHint;
    if (output) {
      args.context?.send?.({
        type: "agent_call_text",
        agent: args.agent.name,
        text: output,
        agentCallId,
      });
    }
    return {
      responseText: output,
      continuationToken,
      ...(taskState ? { taskState } : {}),
    };
  } catch (error) {
    status = "error";
    throw error;
  } finally {
    args.context?.send?.({
      type: "agent_call",
      agent: args.agent.name,
      status,
      agentCallId,
      ...(continuationToken ? { taskId: continuationToken } : {}),
      durationMs: Date.now() - startedAt,
      ...(status === "pending" ? { terminalCode: "input_required" } : {}),
    });
  }
}

function readManagedAgentContinuation(
  value: unknown,
): AnthropicManagedAgentContinuation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const continuationToken = stringifyValue(candidate.continuationToken).trim();
  if (!continuationToken) return undefined;
  const pendingToolUseIds = Array.isArray(candidate.pendingToolUseIds)
    ? candidate.pendingToolUseIds
        .map((item) => stringifyValue(item).trim())
        .filter(Boolean)
    : [];
  return {
    continuationToken,
    ...(pendingToolUseIds.length ? { pendingToolUseIds } : {}),
  };
}

function stringifyManagedAgentApprovalInput(
  input: unknown,
): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { value: stringifyValue(input) };
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      stringifyValue(value),
    ]),
  );
}

export const tool: ActionTool = {
  description:
    "Ask a DIFFERENT, separately-deployed app's agent over A2A. Use message by default so the receiving specialist interprets the objective with its own instructions, skills, connected sources, data dictionary, and tools. The receiver owns provider, schema, query, join, and SQL decisions. Use action + input only for an exact, explicitly known, bounded read whose complete input schema is already known. Never put a create, update, delete, send, save, publish, or any other side effect in action; omit action and send the objective as message instead; never expose or call a direct action to work around slow or unreliable delegation, and never guess receiver-owned query logic. NEVER use this to call your own app or perform actions you can do with your own tools. Using call-agent on yourself will fail and waste time. " +
    'For brand-consistent generated media, the first-party Assets agent is available as agent="assets"; use it when another app needs generated heroes, diagrams, product shots, thumbnails, videos, or design imagery, unless the current app has its own generation action that already delegates there. ' +
    "IMPORTANT — handling the response: " +
    "(a) If it contains a URL or ID, copy it VERBATIM into your reply. Do not 'correct' or pluralize the path (e.g. /deck/ → /decks/), normalize casing, or change the slug — any edit breaks the link. " +
    '(b) If it does NOT contain a URL/ID and the user asked for one, say so explicitly (e.g. "the agent created the deck/image but didn\'t return a link — open the app directly to view it"). NEVER invent a URL, slug, or path — guessing produces broken links that look real. ' +
    "(c) If the downstream response reports missing credentials, never repeat raw env var names, Vault key names, token names, secret names, or other credential identifiers. Tell the user the target app needs its LLM/provider connection configured. " +
    "(d) A bounded wait can expire while the remote task is still healthy. The result will include its taskId and exact retry instructions. Continue polling that SAME task with taskId; NEVER send a new check-in/follow-up message, because that starts duplicate downstream work. For Anthropic Managed Agents, taskId is an opaque signed continuation token returned after approval is required; pass it back exactly as shown and never substitute a session ID.",
  parameters: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        description:
          "Name or URL of a DIFFERENT deployed agent app (e.g. 'mail', 'calendar', 'analytics'). Must not be the current app's own name.",
      },
      message: {
        type: "string",
        description:
          "The message/question to send when starting a new task. Omit when taskId is provided.",
      },
      taskId: {
        type: "string",
        description:
          "Existing A2A task ID returned by a timed-out call, or the opaque signed continuation token returned by an Anthropic Managed Agents approval. Pass it back exactly without sending a fresh check-in message.",
      },
      action: {
        type: "string",
        description:
          "Optional exact read-only action for an explicitly known bounded operation. This field is never for creates, updates, deletes, sends, saves, publishes, or any other side effect. Prefer message when the target agent must interpret data, choose sources or tools, synthesize, mutate, or do multi-step work. Never guess the action schema or send receiver-owned SQL.",
      },
      input: {
        type: "object",
        description:
          "Complete input object for action. The target app validates it and refuses actions that are not explicitly exposed read-only operations. For a mutating request, omit action and use message.",
        additionalProperties: true,
      },
      approvedActions: {
        type: "array",
        description:
          "Exact downstream tool calls the current user explicitly authorized in this chat. Never infer authorization or include a broader/different action.",
        items: {
          type: "object",
          properties: {
            tool: { type: "string" },
            input: { type: "object", additionalProperties: true },
          },
          required: ["tool", "input"],
        },
      },
      managedAgentConfirmations: {
        type: "array",
        description:
          "Structured approvals for a paused Anthropic Managed Agents session. Use only the exact toolUseId values and allow or deny result returned by the managed agent.",
        items: {
          type: "object",
          properties: {
            toolUseId: { type: "string" },
            result: { type: "string", enum: ["allow", "deny"] },
            denyMessage: { type: "string" },
          },
          required: ["toolUseId", "result"],
        },
      },
    },
    required: ["agent"],
  },
};

export async function run(
  args: Record<string, unknown>,
  context?: ActionRunContext,
  selfAppId?: string,
): Promise<string> {
  const agentIdOrName = stringifyValue(args.agent ?? "");
  const message = stringifyValue(args.message ?? "");
  const taskId = stringifyValue(args.taskId ?? "").trim();
  const action = stringifyValue(args.action ?? "").trim();
  const input = args.input ?? {};
  const approvedActions = Array.isArray(args.approvedActions)
    ? (args.approvedActions as A2AApprovedAction[])
    : undefined;
  const parsedManagedAgentConfirmations = parseManagedAgentConfirmations(
    args.managedAgentConfirmations,
  );
  if (parsedManagedAgentConfirmations.error) {
    return `Error: ${parsedManagedAgentConfirmations.error}`;
  }
  const managedAgentConfirmations =
    parsedManagedAgentConfirmations.confirmations;

  if (!agentIdOrName) return "Error: --agent is required";
  if (!message && !taskId && !action) {
    return "Error: --message, --taskId, or --action is required";
  }
  if (action && (message || taskId)) {
    return "Error: --action direct-invoke mode cannot be combined with --message or --taskId";
  }
  if (action && (!input || typeof input !== "object" || Array.isArray(input))) {
    return "Error: --input must be an object when --action is provided";
  }

  if (selfAppId && agentIdOrName.toLowerCase() === selfAppId.toLowerCase()) {
    return `Error: You cannot use call-agent to call yourself (${selfAppId}). Use your own registered actions/tools instead. call-agent is only for communicating with OTHER separately-deployed apps.`;
  }

  const inheritedDepth = Number.isInteger(context?.delegationDepth)
    ? Math.max(0, Number(context?.delegationDepth))
    : 0;
  if (!taskId && inheritedDepth >= MAX_A2A_DELEGATION_HOPS) {
    return (
      `Error: Cross-app delegation stopped at the ${MAX_A2A_DELEGATION_HOPS}-hop limit. ` +
      "Finish with the results already collected instead of starting another agent."
    );
  }

  const agent = await findAgent(agentIdOrName, selfAppId);
  if (!agent) {
    throw unresolvableAgentTargetError(
      agentIdOrName,
      await discoverAgents(selfAppId),
      selfAppId,
      buildDelegationCorrelation(context, selfAppId),
      action ? "direct_action" : taskId ? "task_poll" : "message",
    );
  }

  if (!taskId) {
    const visited = new Set(
      (context?.visitedApps ?? []).map(normalizeAppHandle).filter(Boolean),
    );
    const self = normalizeAppHandle(selfAppId);
    if (self) visited.add(self);
    const targetHandles = [
      normalizeAppHandle((agent as { id?: string }).id),
      normalizeAppHandle(agent.name),
      normalizeAppHandle(agentIdOrName),
    ].filter(Boolean);
    const repeated = targetHandles.find((handle) => visited.has(handle));
    if (repeated) {
      return (
        `Error: Cross-app delegation cycle blocked before calling ${agent.name}. ` +
        `The request already visited ${[...visited].join(" -> ")}.`
      );
    }
  }

  const targetApp =
    normalizeAppHandle((agent as { id?: string }).id) ||
    normalizeAppHandle(agent.name) ||
    normalizeAppHandle(agentIdOrName) ||
    "unknown";
  const correlation = buildDelegationCorrelation(
    context,
    selfAppId,
    undefined,
    taskId ? undefined : targetApp,
  );
  const idempotencyKey =
    message && !taskId
      ? buildMessageIdempotencyKey(context?.turnId, agent.url, message)
      : undefined;

  if (agent.kind?.provider === "anthropic-managed-agents" && action) {
    return (
      `Error: The ${agent.name} managed agent only accepts messages. ` +
      "Use --message; direct action mode is available only for A2A read-only app actions."
    );
  }

  if (action) {
    const agentCallId = randomUUID();
    const startedAt = Date.now();
    let terminalStatus: "done" | "error" = "done";
    let terminalCode: string | undefined;
    if (context?.send) {
      context.send({
        type: "agent_call",
        agent: agent.name,
        status: "start",
        agentCallId,
      });
    }
    try {
      const hostedAgentToken = agent.auth
        ? await resolveRemoteAgentToken(agent.auth, {
            userEmail: getRequestUserEmail(),
            orgId: getRequestOrgId(),
          })
        : undefined;
      const output = await invokeReadOnlyAppAction(
        agent,
        action,
        input as Record<string, unknown>,
        buildDelegationCorrelation(context, selfAppId, randomUUID()),
        hostedAgentToken,
        hostedAgentCardUrl(agent),
        Boolean(agent.auth),
      );
      if (/^Error\b/i.test(output)) {
        terminalStatus = "error";
        terminalCode = "direct_action_failed";
      }
      if (context?.send && output) {
        context.send({
          type: "agent_call_text",
          agent: agent.name,
          text: output,
          agentCallId,
        });
      }
      return output;
    } catch (error) {
      terminalStatus = "error";
      const authFailure = remoteAgentAuthFailure(
        agent.name,
        error,
        Boolean(agent.auth),
      );
      terminalCode = authFailure?.errorCode ?? "direct_action_failed";
      if (authFailure) {
        throw new A2AInvocationError(authFailure.message, {
          errorCode: authFailure.errorCode,
        });
      }
      throw error;
    } finally {
      trackA2AInvocation({
        invocationId: agentCallId,
        callerApp: selfAppId,
        targetApp,
        mode: "direct_action",
        status: terminalStatus === "done" ? "success" : "error",
        startedAt,
        terminalCode,
        correlation,
      });
      if (context?.send) {
        context.send({
          type: "agent_call",
          agent: agent.name,
          status: terminalStatus,
          agentCallId,
          durationMs: Date.now() - startedAt,
          ...(terminalCode ? { terminalCode } : {}),
        });
      }
    }
  }

  const sourceContext = integrationSourceContext();
  const messageWithHint = taskId
    ? ""
    : `${message}${integrationSourceContextHint(sourceContext)}\n\n` +
      `<a2a-caller-hint>\n` +
      `This request comes from another app via A2A. The caller cannot see your local UI, deck list, or navigation — only the literal text you put in your reply. ` +
      `If you create or reference a deck/document/design/dashboard, include its FULLY-QUALIFIED URL (e.g. ${agent.url}/deck/<id>) in your reply, not a relative path. ` +
      `Use only artifact IDs and URL paths returned by successful actions — never invent slugs, IDs, or hosts. ` +
      `Return a concise caller-ready synthesis rather than raw tool output or full transcripts; preserve source counts, IDs, short supporting quotes, and URLs needed to substantiate the answer.\n` +
      `</a2a-caller-hint>`;

  const invocationId = randomUUID();
  const invocationStartedAt = Date.now();
  let invocationStatus: A2AInvocationStatus = "error";
  let invocationTaskId = taskId || undefined;
  let invocationTerminalCode: string | undefined;

  try {
    if (agent.kind?.provider === "anthropic-managed-agents") {
      const managed = await runAnthropicManagedAgent({
        agent,
        message,
        taskId,
        confirmations: managedAgentConfirmations,
        context,
        agentIdOrName,
      });
      invocationStatus =
        managed.taskState === "input-required" ? "pending" : "success";
      invocationTaskId = managed.continuationToken;
      invocationTerminalCode =
        managed.taskState === "input-required" ? "input_required" : undefined;
      return managed.responseText;
    }

    if (context?.send) {
      const callerEmail = getRequestUserEmail();

      const a2aMetadata: Record<string, unknown> = {};
      if (callerEmail) a2aMetadata.userEmail = callerEmail;

      let callerOrgDomain: string | undefined;
      let callerOrgSecret: string | undefined;
      const orgId = getRequestOrgId();
      if (orgId) {
        try {
          const domain = await getOrgDomain(orgId);
          if (domain) {
            callerOrgDomain = domain;
            a2aMetadata.orgDomain = domain;
          }
        } catch {}
        try {
          const secret = await getOrgA2ASecret(orgId);
          if (secret) callerOrgSecret = secret;
        } catch {}
      }

      let apiKey: string | undefined;
      if (
        !agent.auth &&
        callerEmail &&
        (callerOrgSecret || process.env.A2A_SECRET)
      ) {
        try {
          apiKey = await signA2AToken(
            callerEmail,
            callerOrgDomain,
            callerOrgSecret,
            {
              expiresIn: INTEGRATION_A2A_TOKEN_TTL,
              preferGlobalSecret: shouldPreferGlobalA2ASecret(callerOrgSecret),
            },
          );
        } catch {}
      }

      if (!agent.auth && process.env.NODE_ENV === "production" && callerEmail) {
        try {
          const { listOAuthAccountsByOwner } =
            await import("../oauth-tokens/store.js");
          const accounts = await listOAuthAccountsByOwner(
            "google",
            callerEmail,
          );
          const tokens = accounts[0]?.tokens;
          if (tokens?.access_token) {
            a2aMetadata.googleToken = tokens.access_token;
          }
        } catch {}
      }

      let responseText = "";
      let lastSentLength = 0;
      const agentCallId = randomUUID();
      let terminalStatus: "done" | "pending" | "error" = "done";
      const existingContinuationText = taskId
        ? null
        : await formatExistingIntegrationContinuationIfRetry(agent, message);
      if (existingContinuationText) {
        invocationStatus = "pending";
        invocationTerminalCode = "existing_continuation";
        return existingContinuationText;
      }

      context.send({
        type: "agent_call",
        agent: agent.name,
        status: "start",
        agentCallId,
      });

      const emitNewText = (newText: string) => {
        if (newText.length > lastSentLength) {
          context.send!({
            type: "agent_call_text",
            agent: agent.name,
            text: newText.slice(lastSentLength),
            agentCallId,
          });
          lastSentLength = newText.length;
        }
        responseText = newText;
      };

      const PROGRESS_MIN_INTERVAL_MS = 30_000;
      const ACTIVELY_WORKING_STATES = new Set([
        "working",
        "submitted",
        "processing",
      ]);
      const callStartedAt = Date.now();
      let lastProgressEmitAt = callStartedAt;
      let lastActivitySequence = -1;
      const onRemotePollUpdate = (task: Task) => {
        if (task?.id) invocationTaskId = task.id;
        const state = task?.status?.state;
        const parts = task.status?.message?.parts;
        const snapshot = Array.isArray(parts)
          ? parts.map(parseA2AAgentActivityPart).find((value) => value !== null)
          : undefined;
        if (snapshot && snapshot.sequence > lastActivitySequence) {
          lastActivitySequence = snapshot.sequence;
          context.send!({
            type: "agent_call_activity",
            agent: agent.name,
            agentCallId,
            snapshot,
          });
        }
        if (!state || !ACTIVELY_WORKING_STATES.has(state)) return;
        const now = Date.now();
        if (now - lastProgressEmitAt < PROGRESS_MIN_INTERVAL_MS) return;
        lastProgressEmitAt = now;
        const detail = extractRemoteProgressDetail(task);
        context.send!({
          type: "agent_call_progress",
          agent: agent.name,
          state,
          elapsedSeconds: Math.round((now - callStartedAt) / 1000),
          agentCallId,
          ...(detail ? { detail } : {}),
        });
      };

      try {
        const hostedAgentToken = agent.auth
          ? await resolveRemoteAgentToken(agent.auth, {
              userEmail: callerEmail,
              orgId,
            })
          : undefined;
        const callTimeoutMs = getIntegrationCallTimeoutMs();
        const submissionTimeoutMs =
          callTimeoutMs && isNetlifyHostedRuntimeForIntegrationCall()
            ? NETLIFY_INTEGRATION_A2A_SUBMISSION_TIMEOUT_MS
            : undefined;
        responseText = await callAgent(agent.url, messageWithHint, {
          apiKey: agent.auth ? hostedAgentToken : apiKey,
          ...(agent.auth
            ? {}
            : {
                userEmail: callerEmail,
                orgDomain: callerOrgDomain,
                orgSecret: callerOrgSecret,
              }),
          ...(hostedAgentCardUrl(agent)
            ? { cardUrl: hostedAgentCardUrl(agent) }
            : {}),
          approvedActions,
          ...(sourceContext ? { sourceContext: sourceContext.reference } : {}),
          contextId: context.threadId,
          correlation,
          idempotencyKey,
          ...(taskId ? { taskId } : {}),
          onUpdate: onRemotePollUpdate,
          returnRecoverableArtifactsOnTimeout: false,
          ...(callTimeoutMs
            ? {
                timeoutMs: callTimeoutMs,
                ...(submissionTimeoutMs ? { submissionTimeoutMs } : {}),
              }
            : {}),
        });
        responseText =
          formatDownstreamLlmCredentialFailure(agent.name, responseText) ??
          responseText;
        responseText = expandRelativeUrls(responseText, agent.url);
        if (responseText) emitNewText(responseText);
      } catch (pollErr: any) {
        const timeoutTaskId = getA2ATaskTimeoutTaskId(pollErr);
        if (timeoutTaskId) {
          terminalStatus = "pending";
          invocationTaskId = timeoutTaskId;
          invocationTerminalCode = "timeout_pending";
          const queued = await enqueueIntegrationContinuationIfPossible(
            timeoutTaskId,
            agent,
            message,
            callerEmail,
          );
          if (queued) {
            responseText =
              `${A2A_CONTINUATION_QUEUED_MARKER}\n` +
              `The ${agent.name} agent accepted this delegated subtask and will post its own final result to the originating integration thread automatically. ` +
              `Do not call ${agent.name} again for this same subtask. Continue any other requested work, then answer with the completed results you have; if needed, mention that ${agent.name} is posting its result separately.`;
          } else {
            const recoverableArtifactText =
              extractRecoverableTimeoutArtifactText(pollErr);
            if (recoverableArtifactText) {
              responseText = expandRelativeUrls(
                recoverableArtifactText,
                agent.url,
              );
            } else {
              responseText = formatExistingTaskWaitInstruction(
                agent.name,
                timeoutTaskId,
                agentIdOrName,
              );
            }
          }
        } else if (terminalTaskError(pollErr)?.state === "input-required") {
          terminalStatus = "pending";
          const terminal = terminalTaskError(pollErr)!;
          invocationTaskId = terminal.taskId;
          invocationTerminalCode = terminal.errorCode ?? "input_required";
          responseText = formatInputRequiredWaitInstruction(
            agent.name,
            terminal,
            agentIdOrName,
          );
        } else if (terminalTaskError(pollErr)) {
          terminalStatus = "error";
          const terminal = terminalTaskError(pollErr)!;
          invocationTaskId = terminal.taskId;
          invocationTerminalCode = terminal.errorCode ?? terminal.state;
          const detail = expandRelativeUrls(
            terminal.responseText ?? pollErr?.message ?? "unknown failure",
            agent.url,
          );
          responseText =
            `Error: The ${agent.name} agent ended ${terminal.state}` +
            (terminal.errorCode ? ` (${terminal.errorCode})` : "") +
            (terminal.taskId ? ` [taskId: ${terminal.taskId}]` : "") +
            (detail ? `: ${detail}` : "");
        } else {
          terminalStatus = "error";
          const authFailure = remoteAgentAuthFailure(
            agent.name,
            pollErr,
            Boolean(agent.auth),
          );
          invocationTerminalCode = authFailure?.errorCode ?? "call_failed";
          const reason = pollErr?.message ?? "unknown error";
          responseText =
            authFailure?.message ??
            formatDownstreamLlmCredentialFailure(agent.name, pollErr) ??
            `Error: The ${agent.name} agent call failed. (${reason})`;
        }
      }

      if (!responseText && terminalStatus === "done") {
        terminalStatus = "error";
        invocationTerminalCode = "empty_agent_response";
      }
      if (responseText.length > MAX_A2A_CALLER_RESPONSE_CHARS) {
        terminalStatus = "error";
        invocationTerminalCode = "a2a_response_too_large";
        responseText =
          `Error: The ${agent.name} agent returned more data than the caller can safely consume. ` +
          "Ask it for a concise synthesis or a retrievable artifact instead.";
      }
      invocationStatus =
        terminalStatus === "done"
          ? "success"
          : terminalStatus === "pending"
            ? "pending"
            : "error";

      context.send({
        type: "agent_call",
        agent: agent.name,
        status: terminalStatus,
        agentCallId,
        ...(invocationTaskId ? { taskId: invocationTaskId } : {}),
        durationMs: Date.now() - callStartedAt,
        ...(invocationTerminalCode
          ? { terminalCode: invocationTerminalCode }
          : {}),
      });

      if (terminalStatus === "error") {
        throw new A2AInvocationError(
          responseText || `Error: The ${agent.name} agent returned no result.`,
          {
            taskId: invocationTaskId,
            errorCode: invocationTerminalCode,
          },
        );
      }

      return (
        responseText || `Error: The ${agent.name} agent returned no result.`
      );
    }

    const email = getRequestUserEmail();
    let domain: string | undefined;
    let orgSecret: string | undefined;
    const currentOrgId = getRequestOrgId();
    if (currentOrgId) {
      try {
        domain = (await getOrgDomain(currentOrgId)) ?? undefined;
      } catch {}
      try {
        orgSecret = (await getOrgA2ASecret(currentOrgId)) ?? undefined;
      } catch {}
    }
    const hostedAgentToken = agent.auth
      ? await resolveRemoteAgentToken(agent.auth, {
          userEmail: email,
          orgId: currentOrgId,
        })
      : undefined;
    const response = await callAgent(agent.url, messageWithHint, {
      apiKey: hostedAgentToken,
      ...(agent.auth ? {} : { userEmail: email, orgDomain: domain, orgSecret }),
      ...(hostedAgentCardUrl(agent)
        ? { cardUrl: hostedAgentCardUrl(agent) }
        : {}),
      approvedActions,
      ...(sourceContext ? { sourceContext: sourceContext.reference } : {}),
      contextId: context?.threadId,
      correlation,
      idempotencyKey,
      ...(taskId ? { taskId } : {}),
      returnRecoverableArtifactsOnTimeout: false,
    });
    const sanitized =
      formatDownstreamLlmCredentialFailure(agent.name, response) ?? response;
    const expanded = expandRelativeUrls(sanitized, agent.url);
    if (!expanded) {
      invocationStatus = "error";
      invocationTerminalCode = "empty_agent_response";
      return "Error: The remote agent returned no result.";
    }
    if (expanded.length > MAX_A2A_CALLER_RESPONSE_CHARS) {
      invocationStatus = "error";
      invocationTerminalCode = "a2a_response_too_large";
      return (
        `Error: The ${agent.name} agent returned more data than the caller can safely consume. ` +
        "Ask it for a concise synthesis or a retrievable artifact instead."
      );
    }
    invocationStatus = "success";
    return expanded;
  } catch (err: any) {
    if (err instanceof A2AInvocationError) throw err;
    const authFailure = remoteAgentAuthFailure(
      agent.name,
      err,
      Boolean(agent.auth || agent.kind),
    );
    if (authFailure) {
      invocationStatus = "error";
      invocationTerminalCode = authFailure.errorCode;
      throw new A2AInvocationError(authFailure.message, {
        errorCode: authFailure.errorCode,
      });
    }
    const msg = err?.message ?? String(err);
    const credentialMessage = formatDownstreamLlmCredentialFailure(
      agent.name,
      err,
    );
    if (credentialMessage) return credentialMessage;
    const terminal = terminalTaskError(err);
    if (terminal?.state === "input-required") {
      invocationStatus = "pending";
      invocationTaskId = terminal.taskId;
      invocationTerminalCode = terminal.errorCode ?? "input_required";
      return formatInputRequiredWaitInstruction(
        agent.name,
        terminal,
        agentIdOrName,
      );
    }
    if (terminal) {
      invocationStatus = "error";
      invocationTaskId = terminal.taskId;
      invocationTerminalCode = terminal.errorCode ?? terminal.state;
      throw new A2AInvocationError(
        `Error calling ${agent.name}: remote task ${terminal.state}` +
          (terminal.errorCode ? ` (${terminal.errorCode})` : "") +
          (terminal.taskId ? ` [taskId: ${terminal.taskId}]` : "") +
          (terminal.responseText ? `: ${terminal.responseText}` : ""),
        {
          taskId: terminal.taskId,
          errorCode: terminal.errorCode ?? terminal.state,
        },
      );
    }
    const timeoutTaskId = getA2ATaskTimeoutTaskId(err);
    if (timeoutTaskId) {
      invocationStatus = "pending";
      invocationTaskId = timeoutTaskId;
      invocationTerminalCode = "timeout_pending";
      return formatExistingTaskWaitInstruction(
        agent.name,
        timeoutTaskId,
        agentIdOrName,
      );
    }
    if (/timeout|did not complete|Inactivity|504/i.test(msg)) {
      invocationStatus = "error";
      invocationTerminalCode = "timeout_without_task";
      throw new A2AInvocationError(
        `Error calling ${agent.name}: the remote request timed out before a task id could be recovered.`,
        { errorCode: "timeout_without_task" },
      );
    }
    invocationStatus = "error";
    invocationTerminalCode = "call_failed";
    throw new A2AInvocationError(`Error calling ${agent.name}: ${msg}`, {
      errorCode: "call_failed",
    });
  } finally {
    trackA2AInvocation({
      invocationId,
      callerApp: selfAppId,
      targetApp,
      mode: taskId ? "task_poll" : "message",
      status: invocationStatus,
      startedAt: invocationStartedAt,
      taskId: invocationTaskId,
      terminalCode: invocationTerminalCode,
      correlation,
    });
  }
}

async function invokeReadOnlyAppAction(
  agent: { name: string; url: string },
  action: string,
  input: Record<string, unknown>,
  correlation: A2ACorrelationMetadata,
  hostedAgentToken?: string,
  cardUrl?: string,
  hostedAuthConfigured = false,
): Promise<string> {
  const callerEmail = getRequestUserEmail();
  if (!callerEmail) {
    return `Error calling ${agent.name} action ${action}: a signed-in user identity is required`;
  }

  let callerOrgDomain: string | undefined;
  let callerOrgSecret: string | undefined;
  const orgId = getRequestOrgId();
  if (orgId) {
    try {
      callerOrgDomain = (await getOrgDomain(orgId)) ?? undefined;
    } catch {}
    try {
      callerOrgSecret = (await getOrgA2ASecret(orgId)) ?? undefined;
    } catch {}
  }

  if (!hostedAgentToken && !callerOrgSecret && !process.env.A2A_SECRET) {
    return `Error calling ${agent.name} action ${action}: direct cross-app reads require A2A identity verification`;
  }

  try {
    const invocation = await invokeAgentAction({
      target: agent.url,
      action,
      input,
      ...(hostedAgentToken
        ? { apiKey: hostedAgentToken }
        : {
            userEmail: callerEmail,
            orgDomain: callerOrgDomain,
            orgSecret: callerOrgSecret,
          }),
      correlation,
      ...(cardUrl ? { cardUrl } : {}),
    });
    return invocation.result.status === "completed"
      ? invocation.result.output
      : `Error calling ${agent.name} action ${action}: ${invocation.result.output}`;
  } catch (error) {
    const authFailure = remoteAgentAuthFailure(
      agent.name,
      error,
      hostedAuthConfigured,
    );
    if (authFailure) {
      throw new A2AInvocationError(authFailure.message, {
        errorCode: authFailure.errorCode,
      });
    }
    return `Error calling ${agent.name} action ${action}: ${
      error instanceof Error ? error.message : stringifyValue(error)
    }`;
  }
}

function formatExistingTaskWaitInstruction(
  agentName: string,
  taskId: string,
  agentIdOrName: string,
): string {
  return (
    `The ${agentName} task is still running under taskId "${taskId}". ` +
    `Do not send ${agentName} a new check-in or follow-up message; that would start duplicate work. ` +
    `Call call-agent again with agent="${agentIdOrName}" and taskId="${taskId}" (omit message) to continue waiting for this same task.`
  );
}

function formatInputRequiredWaitInstruction(
  agentName: string,
  terminal: {
    taskId?: string;
    responseText?: string;
  },
  agentIdOrName: string,
): string {
  const detail = terminal.responseText?.trim();
  if (!terminal.taskId) {
    return (
      (detail ? `${detail}\n\n` : "") +
      `Pending: The ${agentName} agent needs input before it can continue.`
    );
  }
  return (
    (detail ? `${detail}\n\n` : "") +
    `The ${agentName} agent is waiting for input under taskId "${terminal.taskId}". ` +
    `After providing or approving the requested input, call call-agent with agent="${agentIdOrName}" and taskId="${terminal.taskId}" (omit message) to continue this same task. Do not start a new message for this work.`
  );
}

async function enqueueIntegrationContinuationIfPossible(
  taskId: string,
  agent: { name: string; url: string },
  message: string,
  ownerEmail: string | undefined,
): Promise<boolean> {
  const integration = getIntegrationRequestContext();
  if (!integration || !ownerEmail) return false;

  try {
    const [{ insertA2AContinuation }, { dispatchA2AContinuation }] =
      await Promise.all([
        import("../integrations/a2a-continuations-store.js"),
        import("../integrations/a2a-continuation-processor.js"),
      ]);
    const continuation = await insertA2AContinuation({
      integrationTaskId: integration.taskId,
      platform: integration.incoming.platform,
      externalThreadId: integration.incoming.externalThreadId,
      incoming: integration.incoming,
      placeholderRef: integration.placeholderRef,
      progressRef: integration.progressRef,
      ownerEmail,
      orgId: getRequestOrgId() ?? null,
      agentName: agent.name,
      agentUrl: agent.url,
      dedupeKey: getIntegrationContinuationDedupeKey(message),
      a2aTaskId: taskId,
      // Do not persist the short-lived JWT used for the initial send. The
      // continuation processor can mint a fresh token for each poll.
      a2aAuthToken: null,
    });
    await dispatchA2AContinuation(continuation.id).catch((err) => {
      console.error(
        `[call-agent] Failed to dispatch A2A continuation ${continuation.id}:`,
        err,
      );
    });
    return true;
  } catch (err) {
    console.error("[call-agent] Failed to enqueue A2A continuation:", err);
    return false;
  }
}

const MAX_PROGRESS_DETAIL_CHARS = 200;
function extractRemoteProgressDetail(task: Task): string | undefined {
  const parts = task.status?.message?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > MAX_PROGRESS_DETAIL_CHARS
    ? `${text.slice(0, MAX_PROGRESS_DETAIL_CHARS - 1)}…`
    : text;
}

function getA2ATaskTimeoutTaskId(err: unknown): string | null {
  if (err instanceof A2ATaskTimeoutError) return err.taskId;

  const candidate = err as
    | { name?: unknown; taskId?: unknown; message?: unknown }
    | null
    | undefined;
  const message = stringifyValue(candidate?.message ?? "");
  if (
    candidate?.name === "A2ATaskTimeoutError" &&
    typeof candidate.taskId === "string"
  ) {
    return candidate.taskId;
  }

  const match = message.match(/^A2A task ([^\s]+) did not complete\b/);
  return match?.[1] ?? null;
}

function extractRecoverableTimeoutArtifactText(err: unknown): string {
  const candidate = err as
    | { lastTask?: unknown; name?: unknown }
    | null
    | undefined;
  const lastTask =
    err instanceof A2ATaskTimeoutError
      ? err.lastTask
      : candidate?.name === "A2ATaskTimeoutError"
        ? (candidate.lastTask as Task | undefined)
        : undefined;
  const message = lastTask?.status?.message;
  if (!message?.metadata?.agentNativeRecoverableArtifacts) return "";

  return message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

async function formatExistingIntegrationContinuationIfRetry(
  agent: {
    name: string;
    url: string;
  },
  message: string,
): Promise<string | null> {
  const integration = getIntegrationRequestContext();
  if (!integration || (integration.attempts ?? 1) <= 1) return null;

  try {
    const { getA2AContinuationsForIntegrationTaskAgent } =
      await import("../integrations/a2a-continuations-store.js");
    const continuations = await getA2AContinuationsForIntegrationTaskAgent(
      integration.taskId,
      agent.url,
      getIntegrationContinuationDedupeKey(message),
    );
    const active = continuations.find((continuation) =>
      ["pending", "processing", "delivering", "completed"].includes(
        continuation.status,
      ),
    );
    if (!active) return null;

    const state =
      active.status === "completed"
        ? "already completed this delegated subtask and posted its result to the originating integration thread"
        : "already accepted this delegated subtask and is still working on it for the originating integration thread";
    return (
      `${A2A_CONTINUATION_QUEUED_MARKER}\n` +
      `The ${agent.name} agent ${state}. Do not call ${agent.name} again for this same subtask. Continue any other requested work, then answer with the completed results you have; if needed, mention that ${agent.name} is posting or has posted its result separately.`
    );
  } catch (err) {
    console.error("[call-agent] Failed to inspect existing continuation:", err);
    return null;
  }
}

function getIntegrationContinuationDedupeKey(message: string): string {
  const normalized = message.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

export function expandRelativeUrls(text: string, agentUrl: string): string {
  if (!text || !agentUrl) return text;
  const base = agentUrl.replace(/\/$/, "");
  return text.replace(
    /(^|[\s([<"'`])(\/[a-z0-9_-][a-z0-9_/?&=%#.,:-]*)/gi,
    (_match, lead, path) => `${lead}${base}${path}`,
  );
}

function stringifyValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return value == null ? "" : (JSON.stringify(value) ?? "");
}
