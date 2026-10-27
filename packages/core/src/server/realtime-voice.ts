import {
  defineEventHandler,
  getHeader,
  getMethod,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { actionCallReadOnly } from "../action-call-classification.js";
import { getBuilderGatewayRequestHeaders } from "../agent/engine/builder-gateway-headers.js";
import {
  actionsToEngineTools,
  type ActionEntry,
  type AgentApprovalBinding,
} from "../agent/production-agent.js";
import {
  consumeAgentToolApproval,
  createAgentToolApproval,
  isAgentToolAlwaysAllowed,
  type AgentToolApprovalBinding,
} from "../agent/tool-approval-store.js";
import {
  redactSensitiveFields,
  sanitizeToolErrorText,
  sanitizeToolErrorValue,
} from "../agent/tool-error-redaction.js";
import {
  createToolSearchEntry,
  isTargetedToolSearch,
  TOOL_SEARCH_ACTION_NAME,
} from "../agent/tool-search.js";
import { parseAcceptLanguage } from "../localization/server.js";
import { getSession } from "./auth.js";
import {
  gatewayLaneUnavailableMessage,
  getBuilderGatewayBaseUrl,
  resolveBuilderGatewayAuth,
  resolveSecret,
} from "./credential-provider.js";
import { getH3App } from "./framework-request-handler.js";
import { runWithRequestContext } from "./request-context.js";
import { isSameOriginRequest } from "./request-origin.js";
import {
  signRealtimeVoiceCapability,
  verifyRealtimeVoiceCapability,
} from "./short-lived-token.js";

export const REALTIME_VOICE_SESSION_PATH =
  "/_agent-native/realtime-voice/session";
export const REALTIME_VOICE_TOOL_PATH = "/_agent-native/realtime-voice/tool";
export const REALTIME_VOICE_MAX_SDP_BYTES = 64 * 1024;
export const REALTIME_VOICE_MAX_TOOL_BODY_BYTES = 64 * 1024;
export const REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS = 16_000;
export const REALTIME_VOICE_MAX_TOOLS = 32;
export const REALTIME_VOICE_MAX_TOOL_SCHEMA_BYTES = 32_000;
export const REALTIME_VOICE_MAX_SESSION_BYTES = 64_000;
export const REALTIME_VOICE_TOOL_GRANT_TTL_MS = 75 * 60 * 1_000;
export const REALTIME_VOICE_CAPABILITY_HEADER =
  "X-Agent-Native-Realtime-Capability";
export const REALTIME_VOICE_PROTOCOL_HEADER =
  "X-Agent-Native-Realtime-Protocol";
export const REALTIME_VOICE_MODEL_HEADER = "X-Agent-Native-Realtime-Model";
export const REALTIME_VOICE_INTELLIGENCE_HEADER =
  "X-Agent-Native-Realtime-Intelligence";
export const REALTIME_VOICE_PRIORITY_TOOLS_HEADER =
  "X-Agent-Native-Realtime-Priority-Tools";

const OPENAI_LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const DEFAULT_MODEL = "gpt-live-1";
const LEGACY_MODEL = "gpt-realtime-2.1";
const DEFAULT_DELEGATED_MODEL = "gpt-6-luna";
const DEFAULT_VOICE = "marin";
const DEFAULT_VOICE_INSTRUCTIONS =
  'You are the live voice interface for this Agent-Native app. Speak naturally, briefly, and conversationally. Before each action, say a few words that name it, such as "On it, changing the heading." When a step takes more than a moment, say so in a few words instead of going silent. Say you are working on something only while an action is actually running, and report what its result says. If the user corrects themselves mid-sentence, act on what they said last. Never claim an action succeeded until its result confirms success.';
const LIVE_DELEGATION_INSTRUCTIONS =
  "Your backend agent holds the app's tools, including web search. Delegate every request to look something up, search the web, navigate, or change anything in the app. Never say you cannot do something before the backend has tried it.";
const REALTIME_TOOL_INSTRUCTIONS =
  "Use the function tools for every request to look something up, search the web, navigate, or change anything in the app. Never say you cannot do something before you have tried the tools.";
const DEFAULT_TOOL_INSTRUCTIONS =
  "You act for a live voice conversation in this Agent-Native app. Use the available function tools when the user asks you to look something up, navigate, or take an action. For a web search, call `web-search`, then `web-request` on the most relevant result. When you lack a tool for the request, call `tool-search` before saying the app cannot do it. When the user asks about a previous conversation, saved chat details, or something they told you before, search with the `chat-history` tool before saying you cannot access it. Summarize a matching result and open a thread only when the user asks. If the user repeats a request, acknowledge the prior attempt and finish or correct the missing part instead of restarting from scratch or asking the same clarification again. Never claim an action succeeded until its tool result confirms success. If a tool requires approval, say it needs the user's approval on screen and wait; you will be told whether they approved it and what it returned. Never call it again yourself.";
const MAX_INSTRUCTIONS_CHARS = 16_000;
const MAX_TOOL_DESCRIPTION_CHARS = 2_000;
const MAX_APPROVAL_KEY_CHARS = 1_024;
const MAX_APPROVED_TOOL_CALLS = 4;
const REALTIME_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const CALL_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const BROWSER_TAB_ID = /^[A-Za-z0-9_-]{1,96}$/;
const ISO_639_1_LANGUAGE = /^[A-Za-z]{2}$/;
const REALTIME_VOICE_BUILT_INS = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
]);
export const REALTIME_VOICE_INTELLIGENCE_LEVELS = [
  "instant",
  "balanced",
  "deep",
] as const;
export type RealtimeVoiceIntelligence =
  (typeof REALTIME_VOICE_INTELLIGENCE_LEVELS)[number];
// The delegated Live model rejects "minimal", so its levels start at "low".
const LIVE_REASONING_EFFORT = {
  instant: "low",
  balanced: "medium",
  deep: "high",
} as const;
const LEGACY_REASONING_EFFORT = {
  instant: "minimal",
  balanced: "low",
  deep: "medium",
} as const;

const REALTIME_VOICE_PRIORITY_TOOLS = [
  "navigate",
  "set-url-path",
  "set-search-params",
  "view-screen",
  "chat-history",
  TOOL_SEARCH_ACTION_NAME,
  "web-search",
  "web-request",
] as const;

export interface RealtimeVoiceRequestContext {
  event: H3Event;
  userEmail: string;
  orgId?: string;
  browserTabId?: string;
}

export interface RealtimeVoiceToolExecutionRequest extends RealtimeVoiceRequestContext {
  name: string;
  args: Record<string, unknown>;
  callId: string;
  /** The mounted actions plus the caller's own; run the call against these. */
  actions: Record<string, ActionEntry>;
  /**
   * Approval keys the user approved for this call. A key only runs a call the
   * server recorded an approval for in this voice session.
   */
  approvedToolCalls?: string[];
  sessionId?: string;
}

export interface RealtimeVoiceToolExecutionResult {
  status: "completed" | "failed" | "approval_required";
  output: string;
  approvalKey?: string;
}

export interface RealtimeVoiceInstructions {
  /** The spoken model (or the only model on the Realtime protocol). */
  voice: string;
  /** The delegated model that calls the tools. */
  tools: string;
}

export interface MountRealtimeVoiceRoutesOptions {
  model?: string;
  voice?: string;
  /**
   * How the voice agent talks and sizes its actions. Both the spoken model and
   * the tool-using model read it, ahead of the app context.
   */
  voiceInstructions?: string;
  /**
   * Tools loaded at session start after the framework's navigation and search
   * tools, so common requests skip a `tool-search` round trip.
   */
  priorityToolNames?: readonly string[];
  /** The intelligence a session uses until the user picks one. */
  defaultIntelligence?: RealtimeVoiceIntelligence;
  /** App context for the tool-using model. */
  instructions?: string;
  getInstructions?: (
    context: RealtimeVoiceRequestContext,
  ) => string | null | undefined | Promise<string | null | undefined>;
  resolveOrgId?: (
    event: H3Event,
  ) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * The caller's own actions, such as their connected MCP servers' tools,
   * resolved for each voice request on top of the mounted ones. A mounted
   * action keeps its name.
   */
  resolveRequestActions?: (
    context: RealtimeVoiceRequestContext,
  ) => Promise<Record<string, ActionEntry>>;
  executeTool: (
    request: RealtimeVoiceToolExecutionRequest,
  ) =>
    | RealtimeVoiceToolExecutionResult
    | Promise<RealtimeVoiceToolExecutionResult>;
}

interface RealtimeFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface RealtimeToolCapability {
  userEmail: string;
  orgId?: string;
  browserTabId?: string;
  initialNames: Set<string>;
  names: Set<string>;
}

interface AuthenticatedVoiceContext extends RealtimeVoiceRequestContext {
  timezone?: string;
}

function readSafeHeader(event: H3Event, name: string): string | undefined {
  const value = getHeader(event, name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function configuredIdentifier(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  return trimmed && /^[A-Za-z0-9_.:-]{1,128}$/.test(trimmed)
    ? trimmed
    : fallback;
}

export function resolveRealtimeVoiceTranscriptionLanguage(
  acceptLanguage: string | null | undefined,
): string {
  for (const locale of parseAcceptLanguage(acceptLanguage)) {
    const primaryLanguage = locale.split("-")[0];
    if (ISO_639_1_LANGUAGE.test(primaryLanguage)) {
      return primaryLanguage.toLowerCase();
    }
  }
  return "en";
}

export function resolveRealtimeVoiceLanguagePreference(
  value: string | null | undefined,
  acceptLanguage: string | null | undefined,
): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && ISO_639_1_LANGUAGE.test(normalized)
    ? normalized
    : resolveRealtimeVoiceTranscriptionLanguage(acceptLanguage);
}

export function resolveRealtimeVoiceIntelligence(
  value: string | null | undefined,
  fallback: RealtimeVoiceIntelligence = "instant",
): RealtimeVoiceIntelligence {
  const normalized = value?.trim().toLowerCase();
  return (REALTIME_VOICE_INTELLIGENCE_LEVELS as readonly string[]).includes(
    normalized ?? "",
  )
    ? (normalized as RealtimeVoiceIntelligence)
    : fallback;
}

export function resolveRealtimeVoiceReasoningEffort(
  value: string | null | undefined,
  protocol: "live" | "realtime" = "live",
): "minimal" | "low" | "medium" | "high" {
  const levels =
    protocol === "live" ? LIVE_REASONING_EFFORT : LEGACY_REASONING_EFFORT;
  return levels[resolveRealtimeVoiceIntelligence(value)];
}

export function resolveRealtimeVoicePreference(
  value: string | null | undefined,
  fallback: string,
): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && REALTIME_VOICE_BUILT_INS.has(normalized)
    ? normalized
    : fallback;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n...[truncated]`;
}

function sanitizeOutput(value: unknown, maxChars: number): string {
  let serialized: string;
  try {
    const redacted = redactSensitiveFields(value);
    serialized =
      typeof redacted === "string"
        ? redacted
        : (JSON.stringify(redacted, (_key, entry) =>
            typeof entry === "bigint" ? entry.toString() : entry,
          ) ?? "null");
  } catch {
    serialized = "[Unserializable tool result]";
  }
  return truncate(sanitizeToolErrorText(serialized), maxChars);
}

async function safeOpenAiErrorDetail(
  response: Response,
  apiKey: string,
): Promise<string | null> {
  const raw = await response.text().catch(() => "");
  if (!raw) return null;
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as {
      error?: unknown;
    };
    if (parsed.error && typeof parsed.error === "object") {
      const error = parsed.error as {
        message?: unknown;
        code?: unknown;
        type?: unknown;
      };
      detail = [error.message, error.code, error.type]
        .filter((value) => typeof value === "string" && value.trim())
        .join(" · ");
    }
  } catch {
    // Plain-text upstream errors are sanitized below.
  }
  const redacted = sanitizeToolErrorText(detail).replaceAll(
    apiKey,
    "[REDACTED]",
  );
  return truncate(redacted, 500) || null;
}

function normalizeToolSchema(
  inputSchema: unknown,
): Record<string, unknown> | null {
  try {
    const serialized = JSON.stringify(inputSchema);
    if (
      !serialized ||
      Buffer.byteLength(serialized, "utf8") >
        REALTIME_VOICE_MAX_TOOL_SCHEMA_BYTES
    ) {
      return null;
    }
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildRealtimeTools(
  actions: Record<string, ActionEntry>,
  appPriorityToolNames: readonly string[] = [],
): RealtimeFunctionTool[] {
  const tools: RealtimeFunctionTool[] = [];
  for (const tool of actionsToEngineTools(actions)) {
    if (!REALTIME_TOOL_NAME.test(tool.name)) continue;
    const parameters = normalizeToolSchema(tool.inputSchema);
    if (!parameters) continue;
    tools.push({
      type: "function",
      name: tool.name,
      description: truncate(
        sanitizeToolErrorText(tool.description || ""),
        MAX_TOOL_DESCRIPTION_CHARS,
      ),
      parameters,
    });
  }
  const priority = new Map<string, number>();
  for (const name of [
    ...REALTIME_VOICE_PRIORITY_TOOLS,
    ...appPriorityToolNames,
  ]) {
    if (!priority.has(name)) priority.set(name, priority.size);
  }
  return tools
    .map((tool, index) => ({ tool, index }))
    .sort((left, right) => {
      const leftPriority = priority.get(left.tool.name);
      const rightPriority = priority.get(right.tool.name);
      if (leftPriority !== undefined || rightPriority !== undefined) {
        if (leftPriority === undefined) return 1;
        if (rightPriority === undefined) return -1;
        return leftPriority - rightPriority;
      }
      return left.index - right.index;
    })
    .map(({ tool }) => tool);
}

/**
 * Strict schemas make every optional parameter required, so the delegated
 * model fills each one with a placeholder the action rejects, and retries.
 */
function delegatedRealtimeTool(tool: RealtimeFunctionTool) {
  return { ...tool, strict: false };
}

function realtimeSessionWithTools(
  session: Record<string, unknown>,
  tools: RealtimeFunctionTool[],
): Record<string, unknown> {
  if (session.model === "gpt-live-1") {
    const delegation = isRecord(session.delegation)
      ? session.delegation
      : { type: "responses" };
    const responses = isRecord(delegation.responses)
      ? delegation.responses
      : { model: DEFAULT_DELEGATED_MODEL };
    return {
      ...session,
      delegation: {
        ...delegation,
        type: "responses",
        responses: {
          ...responses,
          tools: tools.map(delegatedRealtimeTool),
          tool_choice: "auto",
        },
      },
    };
  }
  return { ...session, tools, tool_choice: "auto" };
}

function packRealtimeTools(
  session: Record<string, unknown>,
  eligibleTools: RealtimeFunctionTool[],
): RealtimeFunctionTool[] {
  const packed: RealtimeFunctionTool[] = [];
  for (const tool of eligibleTools.slice(0, REALTIME_VOICE_MAX_TOOLS)) {
    const candidate = [...packed, tool];
    const candidateSession = realtimeSessionWithTools(session, candidate);
    if (
      Buffer.byteLength(JSON.stringify(candidateSession), "utf8") <=
      REALTIME_VOICE_MAX_SESSION_BYTES
    ) {
      packed.push(tool);
    }
  }
  return packed;
}

function mintRealtimeToolCapability(
  auth: AuthenticatedVoiceContext,
  capability: Pick<RealtimeToolCapability, "initialNames" | "names">,
): string {
  return signRealtimeVoiceCapability(
    {
      userEmail: auth.userEmail,
      ...(auth.orgId ? { orgId: auth.orgId } : {}),
      ...(auth.browserTabId ? { browserTabId: auth.browserTabId } : {}),
      toolNames: [...capability.initialNames],
      discoveredToolNames: [...capability.names],
    },
    REALTIME_VOICE_TOOL_GRANT_TTL_MS / 1_000,
  );
}

function resolveRealtimeToolCapability(
  token: string | undefined,
  auth: AuthenticatedVoiceContext,
): RealtimeToolCapability | null {
  const verified = verifyRealtimeVoiceCapability(token, {
    userEmail: auth.userEmail,
    ...(auth.orgId ? { orgId: auth.orgId } : {}),
    ...(auth.browserTabId ? { browserTabId: auth.browserTabId } : {}),
  });
  if (!verified.ok) return null;
  return {
    userEmail: verified.userEmail,
    ...(verified.orgId ? { orgId: verified.orgId } : {}),
    ...(verified.browserTabId ? { browserTabId: verified.browserTabId } : {}),
    initialNames: new Set(verified.toolNames),
    names: new Set(verified.discoveredToolNames),
  };
}

function parseSuccessfulToolSearchNames(output: string): string[] {
  try {
    const parsed = JSON.parse(output) as { results?: unknown };
    if (!Array.isArray(parsed.results)) return [];
    const names: string[] = [];
    for (const result of parsed.results) {
      if (!isRecord(result) || typeof result.name !== "string") continue;
      if (!REALTIME_TOOL_NAME.test(result.name)) continue;
      if (!names.includes(result.name)) names.push(result.name);
      if (names.length >= REALTIME_VOICE_MAX_TOOLS) break;
    }
    return names;
  } catch {
    return [];
  }
}

function grantDiscoveredRealtimeTools(input: {
  request: NonNullable<ReturnType<typeof parseToolRequest>>;
  result: RealtimeVoiceToolExecutionResult;
  toolsByName: ReadonlyMap<string, RealtimeFunctionTool>;
  initialAllowedNames: ReadonlySet<string>;
  capability: RealtimeToolCapability;
}): RealtimeFunctionTool[] {
  if (
    input.request.name !== TOOL_SEARCH_ACTION_NAME ||
    input.result.status !== "completed" ||
    !isTargetedToolSearch(input.request.args)
  ) {
    return [];
  }

  const candidates = parseSuccessfulToolSearchNames(input.result.output)
    .filter((name) => !input.initialAllowedNames.has(name))
    .map((name) => input.toolsByName.get(name))
    .filter((tool): tool is RealtimeFunctionTool => Boolean(tool));
  const boundedTools = packRealtimeTools({}, candidates);
  const expandedTools: RealtimeFunctionTool[] = [];
  for (const tool of boundedTools) {
    if (
      !input.capability.names.has(tool.name) &&
      input.capability.names.size >= REALTIME_VOICE_MAX_TOOLS
    ) {
      continue;
    }
    input.capability.names.add(tool.name);
    expandedTools.push(tool);
  }
  return expandedTools;
}

function declaredBodyBytes(event: H3Event): number | undefined {
  const raw = readSafeHeader(event, "content-length");
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readLimitedRawBody(
  event: H3Event,
  maxBytes: number,
): Promise<string | null> {
  const declared = declaredBodyBytes(event);
  if (declared !== undefined && declared > maxBytes) return "oversize";

  const raw = await readRawBody(event, "utf8").catch(() => undefined);
  if (raw == null) return null;
  const text =
    typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array);
  return new TextEncoder().encode(text).byteLength > maxBytes
    ? "oversize"
    : text;
}

async function authenticateVoiceRequest(
  event: H3Event,
  options: MountRealtimeVoiceRoutesOptions,
): Promise<AuthenticatedVoiceContext | null> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return null;
  const resolvedOrgId = options.resolveOrgId
    ? await options.resolveOrgId(event)
    : session.orgId;
  const timezone = readSafeHeader(event, "x-user-timezone");
  const rawBrowserTabId = readSafeHeader(event, "x-agent-native-browser-tab");
  const browserTabId =
    rawBrowserTabId && BROWSER_TAB_ID.test(rawBrowserTabId)
      ? rawBrowserTabId
      : undefined;
  return {
    event,
    userEmail: session.email,
    ...(resolvedOrgId ? { orgId: resolvedOrgId } : {}),
    ...(timezone && timezone.length < 64 ? { timezone } : {}),
    ...(browserTabId ? { browserTabId } : {}),
  };
}

export function composeRealtimeVoiceInstructions(input: {
  protocol: "live" | "realtime";
  voiceInstructions?: string | null | undefined;
  appInstructions?: string | null | undefined;
}): RealtimeVoiceInstructions {
  const voiceGuidance = input.voiceInstructions?.trim();
  const appContext = input.appInstructions?.trim();
  const compose = (parts: Array<string | undefined>) =>
    truncate(
      sanitizeToolErrorText(parts.filter(Boolean).join("\n\n")),
      MAX_INSTRUCTIONS_CHARS,
    );
  const tools = compose([DEFAULT_TOOL_INSTRUCTIONS, voiceGuidance, appContext]);
  if (input.protocol === "live") {
    return {
      voice: compose([
        DEFAULT_VOICE_INSTRUCTIONS,
        LIVE_DELEGATION_INSTRUCTIONS,
        voiceGuidance,
      ]),
      tools,
    };
  }
  // One Realtime model both speaks and calls the tools.
  const realtime = compose([
    DEFAULT_VOICE_INSTRUCTIONS,
    REALTIME_TOOL_INSTRUCTIONS,
    DEFAULT_TOOL_INSTRUCTIONS,
    voiceGuidance,
    appContext,
  ]);
  return { voice: realtime, tools: realtime };
}

async function buildInstructions(
  context: RealtimeVoiceRequestContext,
  options: MountRealtimeVoiceRoutesOptions,
  protocol: "live" | "realtime",
): Promise<RealtimeVoiceInstructions> {
  const dynamic = await options.getInstructions?.(context);
  return composeRealtimeVoiceInstructions({
    protocol,
    voiceInstructions: options.voiceInstructions,
    appInstructions: dynamic ?? options.instructions,
  });
}

export async function realtimeVoiceSafetyIdentifier(
  userEmail: string,
): Promise<string> {
  const input = new TextEncoder().encode(
    `agent-native:${userEmail.trim().toLowerCase()}`,
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function invalidMethod(event: H3Event): { error: string } {
  setResponseStatus(event, 405);
  return { error: "Method not allowed" };
}

interface RealtimeVoiceRequestTools {
  actions: Record<string, ActionEntry>;
  tools: RealtimeFunctionTool[];
  toolsByName: ReadonlyMap<string, RealtimeFunctionTool>;
}

type ResolveRealtimeVoiceTools = (
  context: RealtimeVoiceRequestContext,
) => Promise<RealtimeVoiceRequestTools>;

function createSessionHandler(
  resolveTools: ResolveRealtimeVoiceTools,
  options: MountRealtimeVoiceRoutesOptions,
) {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) !== "POST") return invalidMethod(event);
    if (!isSameOriginRequest(event)) {
      setResponseStatus(event, 403);
      return { error: "Cross-origin request rejected" };
    }
    setResponseHeader(event, "Cache-Control", "no-store");

    const auth = await authenticateVoiceRequest(event, options);
    if (!auth) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }

    const contentType = readSafeHeader(event, "content-type")?.toLowerCase();
    if (!contentType?.includes("application/sdp")) {
      setResponseStatus(event, 415);
      return { error: "Expected Content-Type: application/sdp" };
    }

    const rawSdp = await readLimitedRawBody(
      event,
      REALTIME_VOICE_MAX_SDP_BYTES,
    );
    if (rawSdp === "oversize") {
      setResponseStatus(event, 413);
      return {
        error: `SDP offer is too large (max ${REALTIME_VOICE_MAX_SDP_BYTES} bytes)`,
      };
    }
    const sdp = rawSdp ?? "";
    if (!sdp.trim()) {
      setResponseStatus(event, 400);
      return { error: "SDP offer is required" };
    }

    return runWithRequestContext(
      {
        userEmail: auth.userEmail,
        orgId: auth.orgId,
        timezone: auth.timezone,
        run: auth.browserTabId
          ? { browserTabId: auth.browserTabId }
          : undefined,
      },
      async () => {
        const builderCredentials = await resolveBuilderGatewayAuth();
        const builderConfigured = builderCredentials !== null;

        const apiKey = builderConfigured
          ? null
          : (await resolveSecret("OPENAI_API_KEY"))?.trim();
        if (!builderConfigured && !apiKey) {
          setResponseStatus(event, 409);
          return {
            error: gatewayLaneUnavailableMessage(
              "Use Builder.io (free tier available) or configure an OpenAI API key to use realtime voice.",
            ),
            code: "realtime_voice_setup_required",
          };
        }

        const transcriptionLanguage = resolveRealtimeVoiceLanguagePreference(
          readSafeHeader(event, "x-agent-native-realtime-language"),
          readSafeHeader(event, "accept-language"),
        );
        const protocol = readSafeHeader(event, REALTIME_VOICE_PROTOCOL_HEADER);
        const configuredModel = configuredIdentifier(
          options.model,
          DEFAULT_MODEL,
        );
        const model =
          protocol === "realtime" && configuredModel === DEFAULT_MODEL
            ? LEGACY_MODEL
            : configuredModel;
        const sessionProtocol = model === DEFAULT_MODEL ? "live" : "realtime";
        const instructions = await buildInstructions(
          auth,
          options,
          sessionProtocol,
        );
        // A missing header means the user has not picked a level.
        const intelligence = resolveRealtimeVoiceIntelligence(
          readSafeHeader(event, REALTIME_VOICE_INTELLIGENCE_HEADER),
          resolveRealtimeVoiceIntelligence(options.defaultIntelligence),
        );
        const reasoningEffort = resolveRealtimeVoiceReasoningEffort(
          intelligence,
          sessionProtocol,
        );
        const voice = resolveRealtimeVoicePreference(
          readSafeHeader(event, "x-agent-native-realtime-voice"),
          configuredIdentifier(options.voice, DEFAULT_VOICE),
        );
        const sessionBase =
          model === DEFAULT_MODEL
            ? {
                model,
                instructions: `${instructions.voice}\n\nSpeak in ${transcriptionLanguage} unless the user asks to switch languages.`,
                audio: { output: { voice } },
                delegation: {
                  type: "responses",
                  responses: {
                    model: DEFAULT_DELEGATED_MODEL,
                    instructions: instructions.tools,
                    parallel_tool_calls: false,
                    reasoning: { effort: reasoningEffort },
                  },
                },
              }
            : {
                type: "realtime",
                model: model === LEGACY_MODEL ? LEGACY_MODEL : model,
                instructions: instructions.voice,
                parallel_tool_calls: false,
                reasoning: { effort: reasoningEffort },
                output_modalities: ["audio"],
                audio: {
                  input: {
                    transcription: {
                      model: "gpt-4o-mini-transcribe",
                      language: transcriptionLanguage,
                    },
                    turn_detection: {
                      type: "semantic_vad",
                      create_response: false,
                      interrupt_response: true,
                      eagerness: "auto",
                    },
                  },
                  output: {
                    voice,
                  },
                },
              };
        let tools: RealtimeFunctionTool[];
        try {
          ({ tools } = await resolveTools(auth));
        } catch (error) {
          // Starting without the caller's tools would hide them; say why.
          setResponseStatus(event, 503);
          return {
            error: truncate(
              `Could not load your connected tools for voice chat: ${
                sanitizeToolErrorValue(error) || "unknown error"
              }`,
              REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS,
            ),
            code: "realtime_voice_tools_unavailable",
          };
        }
        const packedTools = packRealtimeTools(sessionBase, tools);
        const session = realtimeSessionWithTools(sessionBase, packedTools);

        let upstream: Response;
        try {
          if (builderConfigured) {
            const gatewayUrl = new URL(
              "realtime/calls",
              getBuilderGatewayBaseUrl().endsWith("/")
                ? getBuilderGatewayBaseUrl()
                : `${getBuilderGatewayBaseUrl()}/`,
            );
            if (builderCredentials.spaceId) {
              gatewayUrl.searchParams.set("apiKey", builderCredentials.spaceId);
            }
            upstream = await fetch(gatewayUrl.toString(), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: builderCredentials.authorization,
                ...(builderCredentials.spaceId
                  ? { "x-builder-api-key": builderCredentials.spaceId }
                  : {}),
                ...getBuilderGatewayRequestHeaders(),
                ...(builderCredentials.userId
                  ? { "x-builder-user-id": builderCredentials.userId }
                  : {}),
              },
              body: JSON.stringify({ sdp, session }),
            });
          } else {
            if (model === DEFAULT_MODEL) {
              upstream = await fetch(OPENAI_LIVE_SESSIONS_URL, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  "OpenAI-Safety-Identifier":
                    await realtimeVoiceSafetyIdentifier(auth.userEmail),
                },
                body: JSON.stringify({
                  session,
                  transport: { type: "webrtc", sdp },
                }),
              });
            } else {
              const form = new FormData();
              form.set("sdp", sdp);
              form.set("session", JSON.stringify(session));
              upstream = await fetch(OPENAI_REALTIME_CALLS_URL, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "OpenAI-Safety-Identifier":
                    await realtimeVoiceSafetyIdentifier(auth.userEmail),
                },
                body: form,
              });
            }
          }
        } catch {
          setResponseStatus(event, 502);
          return {
            error: builderConfigured
              ? gatewayLaneUnavailableMessage(
                  "Could not reach the Builder realtime voice gateway",
                )
              : "Could not reach the OpenAI Realtime API",
          };
        }

        if (!upstream.ok) {
          const detail = await safeOpenAiErrorDetail(
            upstream,
            builderConfigured
              ? builderCredentials.authorization.replace(/^Bearer\s+/i, "")
              : apiKey!,
          );
          setResponseStatus(event, builderConfigured ? upstream.status : 502);
          const rejection = `${builderConfigured ? "Builder" : "OpenAI"} rejected the realtime session (${upstream.status})${detail ? `: ${detail}` : ""}`;
          return {
            error: builderConfigured
              ? gatewayLaneUnavailableMessage(rejection)
              : rejection,
          };
        }

        let upstreamBody: string;
        try {
          upstreamBody = await upstream.text();
        } catch {
          setResponseStatus(event, 502);
          return {
            error: builderConfigured
              ? gatewayLaneUnavailableMessage(
                  "Could not read the Builder realtime voice response",
                )
              : "Could not read the OpenAI Realtime API response",
          };
        }
        let answerSdp = upstreamBody;
        if (model === DEFAULT_MODEL && !builderConfigured) {
          try {
            const payload = JSON.parse(upstreamBody) as {
              id?: unknown;
              session?: { id?: unknown };
              transport?: { sdp?: unknown };
            };
            const sessionId =
              typeof payload.session?.id === "string"
                ? payload.session.id
                : payload.id;
            answerSdp =
              typeof sessionId === "string" &&
              typeof payload.transport?.sdp === "string"
                ? payload.transport.sdp
                : "";
          } catch {
            answerSdp = "";
          }
        }
        if (!answerSdp.trim()) {
          setResponseStatus(event, 502);
          const emptyAnswer = `${builderConfigured ? "Builder" : "OpenAI"} returned an empty realtime session answer`;
          return {
            error: builderConfigured
              ? gatewayLaneUnavailableMessage(emptyAnswer)
              : emptyAnswer,
          };
        }

        setResponseStatus(event, upstream.status);
        setResponseHeader(event, "Content-Type", "application/sdp");
        setResponseHeader(
          event,
          REALTIME_VOICE_CAPABILITY_HEADER,
          mintRealtimeToolCapability(auth, {
            initialNames: new Set(packedTools.map((tool) => tool.name)),
            names: new Set(),
          }),
        );
        setResponseHeader(
          event,
          REALTIME_VOICE_PROTOCOL_HEADER,
          model === DEFAULT_MODEL ? "live" : "realtime",
        );
        setResponseHeader(event, REALTIME_VOICE_MODEL_HEADER, model);
        setResponseHeader(
          event,
          REALTIME_VOICE_INTELLIGENCE_HEADER,
          intelligence,
        );
        const packedNames = new Set(packedTools.map((tool) => tool.name));
        const priorityToolNames = (options.priorityToolNames ?? []).filter(
          (name) => packedNames.has(name),
        );
        if (priorityToolNames.length > 0) {
          setResponseHeader(
            event,
            REALTIME_VOICE_PRIORITY_TOOLS_HEADER,
            priorityToolNames.join(","),
          );
        }
        return answerSdp;
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseToolRequest(value: unknown): {
  name: string;
  args: Record<string, unknown>;
  callId: string;
  sessionId?: string;
  browserTabId?: string;
  approvedToolCalls?: string[];
} | null {
  if (!isRecord(value)) return null;
  const { name, args, callId, sessionId, browserTabId, approvedToolCalls } =
    value;
  if (typeof name !== "string" || !REALTIME_TOOL_NAME.test(name)) return null;
  if (typeof callId !== "string" || !CALL_ID.test(callId)) return null;
  if (!isRecord(args)) return null;
  if (
    sessionId !== undefined &&
    (typeof sessionId !== "string" || !SESSION_ID.test(sessionId))
  ) {
    return null;
  }
  if (
    browserTabId !== undefined &&
    (typeof browserTabId !== "string" || !BROWSER_TAB_ID.test(browserTabId))
  ) {
    return null;
  }
  if (
    approvedToolCalls !== undefined &&
    (!Array.isArray(approvedToolCalls) ||
      approvedToolCalls.length > MAX_APPROVED_TOOL_CALLS ||
      !approvedToolCalls.every(
        (key) =>
          typeof key === "string" &&
          key.length > 0 &&
          key.length <= MAX_APPROVAL_KEY_CHARS,
      ))
  ) {
    return null;
  }
  return {
    name,
    args,
    callId,
    ...(sessionId ? { sessionId } : {}),
    ...(browserTabId ? { browserTabId } : {}),
    ...(approvedToolCalls?.length
      ? { approvedToolCalls: approvedToolCalls as string[] }
      : {}),
  };
}

function normalizeExecutionResult(
  result: RealtimeVoiceToolExecutionResult,
): RealtimeVoiceToolExecutionResult {
  const status = result?.status;
  if (
    status !== "completed" &&
    status !== "failed" &&
    status !== "approval_required"
  ) {
    throw new Error("Invalid realtime tool execution status");
  }
  const output = sanitizeOutput(
    result.output,
    REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS,
  );
  return {
    status,
    output,
    ...(status === "approval_required" &&
    typeof result.approvalKey === "string" &&
    result.approvalKey.length > 0 &&
    result.approvalKey.length <= MAX_APPROVAL_KEY_CHARS
      ? { approvalKey: result.approvalKey }
      : {}),
  };
}

/** Omitted when the call is unclassified, so it never reads as a write. */
function readOnlyField(readOnly: boolean | undefined) {
  return readOnly === undefined ? {} : { readOnly };
}

function createToolHandler(
  resolveTools: ResolveRealtimeVoiceTools,
  options: MountRealtimeVoiceRoutesOptions,
) {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) !== "POST") return invalidMethod(event);
    if (!isSameOriginRequest(event)) {
      setResponseStatus(event, 403);
      return { error: "Cross-origin request rejected" };
    }
    setResponseHeader(event, "Cache-Control", "no-store");

    const auth = await authenticateVoiceRequest(event, options);
    if (!auth) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }
    const capability = resolveRealtimeToolCapability(
      readSafeHeader(event, REALTIME_VOICE_CAPABILITY_HEADER),
      auth,
    );
    if (!capability) {
      setResponseStatus(event, 403);
      return { error: "Invalid or expired realtime voice capability" };
    }

    const contentType = readSafeHeader(event, "content-type")?.toLowerCase();
    if (!contentType?.includes("application/json")) {
      setResponseStatus(event, 415);
      return { error: "Expected Content-Type: application/json" };
    }

    const raw = await readLimitedRawBody(
      event,
      REALTIME_VOICE_MAX_TOOL_BODY_BYTES,
    );
    if (raw === "oversize") {
      setResponseStatus(event, 413);
      return {
        error: `Tool request is too large (max ${REALTIME_VOICE_MAX_TOOL_BODY_BYTES} bytes)`,
      };
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw ?? "");
    } catch {
      setResponseStatus(event, 400);
      return { error: "Invalid realtime tool request" };
    }
    const request = parseToolRequest(parsedBody);
    if (!request) {
      setResponseStatus(event, 400);
      return { error: "Invalid realtime tool request" };
    }
    if (
      request.browserTabId !== undefined &&
      request.browserTabId !== capability.browserTabId
    ) {
      setResponseStatus(event, 403);
      return { error: "Realtime voice browser tab mismatch" };
    }
    if (
      !capability.initialNames.has(request.name) &&
      !capability.names.has(request.name)
    ) {
      setResponseStatus(event, 404);
      return { error: "Unknown realtime voice tool" };
    }

    const browserTabId = capability.browserTabId;
    const threadId = realtimeVoiceThreadId(request);
    return runWithRequestContext(
      {
        userEmail: auth.userEmail,
        orgId: auth.orgId,
        timezone: auth.timezone,
        run: {
          threadId,
          ...(browserTabId ? { browserTabId } : {}),
        },
      },
      async () => {
        try {
          const { actions, toolsByName } = await resolveTools(auth);
          const result = normalizeExecutionResult(
            await options.executeTool({
              event,
              userEmail: auth.userEmail,
              orgId: auth.orgId,
              ...request,
              ...(browserTabId ? { browserTabId } : {}),
              actions,
            }),
          );
          const expandedTools = grantDiscoveredRealtimeTools({
            request,
            result,
            toolsByName,
            initialAllowedNames: capability.initialNames,
            capability,
          });
          const entry = Object.hasOwn(actions, request.name)
            ? actions[request.name]
            : undefined;
          return {
            callId: request.callId,
            ...result,
            ...readOnlyField(
              entry ? actionCallReadOnly(entry, request.args) : undefined,
            ),
            ...(expandedTools.length > 0
              ? {
                  expandedTools,
                  capability: mintRealtimeToolCapability(auth, capability),
                }
              : {}),
          };
        } catch (error) {
          setResponseStatus(event, 500);
          return {
            callId: request.callId,
            status: "failed" as const,
            output: truncate(
              sanitizeToolErrorValue(error) || "Tool execution failed",
              REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS,
            ),
          };
        }
      },
    );
  });
}

/** The thread a voice tool call runs in: its session's, or its own. */
export function realtimeVoiceThreadId(request: {
  sessionId?: string | undefined;
  callId: string;
}): string {
  // guard:allow-realtime-opt-in — a thread id prefix, not a realtime sync opt-in
  return `realtime:${request.sessionId ?? request.callId}`;
}

/**
 * Approval hooks for one voice tool call. A voice session is one approval
 * scope, so the approval a call asks for is consumed by the user's approved
 * retry of that exact call, and an "always allow" from chat applies here too.
 */
export function realtimeVoiceApprovalHooks(
  request: Pick<
    RealtimeVoiceToolExecutionRequest,
    "userEmail" | "orgId" | "sessionId" | "callId" | "approvedToolCalls"
  >,
) {
  const scope = realtimeVoiceThreadId(request);
  const orgId = request.orgId ?? null;
  const storeBinding = (
    binding: AgentApprovalBinding,
  ): AgentToolApprovalBinding => ({
    ownerEmail: request.userEmail,
    orgId,
    threadId: scope,
    turnId: scope,
    toolName: binding.toolName,
    toolRevision: binding.toolRevision,
    callId: binding.callId,
    approvalKey: binding.approvalKey,
    argumentsHash: binding.argumentsHash,
    ...(binding.approvalId ? { approvalId: binding.approvalId } : {}),
  });
  return {
    ...(request.approvedToolCalls
      ? { approvedToolCalls: request.approvedToolCalls }
      : {}),
    onApprovalRequired: (binding: AgentApprovalBinding) =>
      createAgentToolApproval(storeBinding(binding)),
    consumeApproval: (binding: AgentApprovalBinding) =>
      consumeAgentToolApproval(storeBinding(binding)),
    isToolAlwaysAllowed: (binding: AgentApprovalBinding) =>
      isAgentToolAlwaysAllowed({
        ownerEmail: request.userEmail,
        orgId,
        toolName: binding.toolName,
        toolRevision: binding.toolRevision,
      }),
  };
}

export function mountRealtimeVoiceRoutes(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options: MountRealtimeVoiceRoutesOptions,
): { sessionPath: string; toolPath: string } {
  if (typeof options?.executeTool !== "function") {
    throw new Error("mountRealtimeVoiceRoutes requires executeTool");
  }

  // Converting every action's schema is mount-time work a cold instance pays
  // on its first framework request, voice or not, so the tools wait for the
  // first voice request. They come from the actions as mounted.
  const mounted = { ...actions };
  let tools: RealtimeFunctionTool[] | undefined;
  let toolsByName: ReadonlyMap<string, RealtimeFunctionTool> | undefined;
  const getTools = () =>
    (tools ??= buildRealtimeTools(mounted, options.priorityToolNames));
  const getToolsByName = () =>
    (toolsByName ??= new Map(getTools().map((tool) => [tool.name, tool])));
  const resolveTools: ResolveRealtimeVoiceTools = async (context) => {
    const mountedTools = () => ({
      actions: mounted,
      tools: getTools(),
      toolsByName: getToolsByName(),
    });
    if (!options.resolveRequestActions) return mountedTools();
    const requestActions = Object.entries(
      await options.resolveRequestActions(context),
    ).filter(([name]) => !Object.hasOwn(mounted, name));
    if (requestActions.length === 0) return mountedTools();
    const actions: Record<string, ActionEntry> = {
      ...mounted,
      ...Object.fromEntries(requestActions),
    };
    if (Object.hasOwn(actions, TOOL_SEARCH_ACTION_NAME)) {
      actions[TOOL_SEARCH_ACTION_NAME] = createToolSearchEntry(() => actions);
    }
    const tools = [
      ...getTools(),
      ...buildRealtimeTools(Object.fromEntries(requestActions)),
    ];
    return {
      actions,
      tools,
      toolsByName: new Map(tools.map((tool) => [tool.name, tool])),
    };
  };
  const app = getH3App(nitroApp);
  app.use(
    REALTIME_VOICE_SESSION_PATH,
    createSessionHandler(resolveTools, options),
  );
  app.use(REALTIME_VOICE_TOOL_PATH, createToolHandler(resolveTools, options));
  return {
    sessionPath: REALTIME_VOICE_SESSION_PATH,
    toolPath: REALTIME_VOICE_TOOL_PATH,
  };
}
