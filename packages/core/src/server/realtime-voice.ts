import {
  defineEventHandler,
  getHeader,
  getMethod,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getBuilderGatewayRequestHeaders } from "../agent/engine/builder-gateway-headers.js";
import {
  actionsToEngineTools,
  type ActionEntry,
} from "../agent/production-agent.js";
import {
  redactSensitiveFields,
  sanitizeToolErrorText,
  sanitizeToolErrorValue,
} from "../agent/tool-error-redaction.js";
import { TOOL_SEARCH_ACTION_NAME } from "../agent/tool-search.js";
import { parseAcceptLanguage } from "../localization/server.js";
import { getSession } from "./auth.js";
import {
  getBuilderGatewayBaseUrl,
  resolveBuilderCredentials,
  resolveSecret,
} from "./credential-provider.js";
import { getH3App } from "./framework-request-handler.js";
import { runWithRequestContext } from "./request-context.js";
import { isSameOriginRequest } from "./request-origin.js";

export const REALTIME_VOICE_SESSION_PATH =
  "/_agent-native/realtime-voice/session";
export const REALTIME_VOICE_TOOL_PATH = "/_agent-native/realtime-voice/tool";
export const REALTIME_VOICE_MAX_SDP_BYTES = 64 * 1024;
export const REALTIME_VOICE_MAX_TOOL_BODY_BYTES = 64 * 1024;
export const REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS = 16_000;
export const REALTIME_VOICE_MAX_TOOLS = 32;
export const REALTIME_VOICE_MAX_TOOL_SCHEMA_BYTES = 32_000;
export const REALTIME_VOICE_MAX_SESSION_BYTES = 64_000;
export const REALTIME_VOICE_TOOL_GRANT_TTL_MS = 10 * 60 * 1_000;
export const REALTIME_VOICE_MAX_TOOL_GRANT_SESSIONS = 256;
export const REALTIME_VOICE_CAPABILITY_HEADER =
  "X-Agent-Native-Realtime-Capability";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const DEFAULT_MODEL = "gpt-realtime-2.1";
const DEFAULT_VOICE = "marin";
const DEFAULT_INSTRUCTIONS =
  "You are the live voice interface for this Agent Native app. Speak naturally, briefly, and conversationally. Use the available function tools when the user asks you to navigate or take an action. Never claim an action succeeded until its tool result confirms success. If a tool requires approval, explain that the user must approve it in chat.";
const MAX_INSTRUCTIONS_CHARS = 16_000;
const MAX_TOOL_DESCRIPTION_CHARS = 2_000;
const MAX_APPROVAL_KEY_CHARS = 1_024;
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
const REALTIME_VOICE_REASONING_EFFORT = {
  instant: "minimal",
  balanced: "low",
  deep: "medium",
} as const;

/**
 * Realtime sessions have a deliberately bounded tool manifest. Keep the
 * context/navigation tools ahead of large template registries so voice can
 * always see and operate the same UI navigation surface as text chat.
 */
const REALTIME_VOICE_PRIORITY_TOOLS = [
  "navigate",
  "set-url-path",
  "set-search-params",
  "view-screen",
  TOOL_SEARCH_ACTION_NAME,
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
  sessionId?: string;
}

export interface RealtimeVoiceToolExecutionResult {
  status: "completed" | "failed" | "approval_required";
  output: string;
  approvalKey?: string;
}

export interface MountRealtimeVoiceRoutesOptions {
  /** Server-controlled model. Defaults to gpt-realtime-2.1. */
  model?: string;
  /** Server-controlled output voice. Defaults to marin. */
  voice?: string;
  /** Static app guidance appended to the safe default voice instructions. */
  instructions?: string;
  /** Per-request app/navigation guidance. It is sent only to OpenAI. */
  getInstructions?: (
    context: RealtimeVoiceRequestContext,
  ) => string | null | undefined | Promise<string | null | undefined>;
  /** Optional app-specific active-organization resolver. */
  resolveOrgId?: (
    event: H3Event,
  ) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Central agent tool executor supplied by the agent-chat plugin. The executor
   * owns validation, approval, journaling, timeout, mutation notification, and
   * action-result normalization; this transport must not call ActionEntry.run.
   */
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
  expiresAt: number;
  initialNames: Set<string>;
  names: Set<string>;
}

type RealtimeToolCapabilityStore = Map<string, RealtimeToolCapability>;

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

export function resolveRealtimeVoiceReasoningEffort(
  value: string | null | undefined,
): "minimal" | "low" | "medium" {
  const normalized = value?.trim().toLowerCase();
  return normalized &&
    Object.hasOwn(REALTIME_VOICE_REASONING_EFFORT, normalized)
    ? REALTIME_VOICE_REASONING_EFFORT[
        normalized as keyof typeof REALTIME_VOICE_REASONING_EFFORT
      ]
    : "low";
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
      error?: { message?: unknown; code?: unknown; type?: unknown } | unknown;
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
  const priority = new Map<string, number>(
    REALTIME_VOICE_PRIORITY_TOOLS.map((name, index) => [name, index]),
  );
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

function packRealtimeTools(
  session: Record<string, unknown>,
  eligibleTools: RealtimeFunctionTool[],
): RealtimeFunctionTool[] {
  const packed: RealtimeFunctionTool[] = [];
  for (const tool of eligibleTools.slice(0, REALTIME_VOICE_MAX_TOOLS)) {
    const candidate = [...packed, tool];
    const candidateSession = {
      ...session,
      tools: candidate,
      tool_choice: "auto",
    };
    if (
      Buffer.byteLength(JSON.stringify(candidateSession), "utf8") <=
      REALTIME_VOICE_MAX_SESSION_BYTES
    ) {
      packed.push(tool);
    }
  }
  return packed;
}

function mintRealtimeToolCapability(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}

function cleanRealtimeToolCapabilities(
  capabilities: RealtimeToolCapabilityStore,
  now = Date.now(),
): void {
  for (const [key, capability] of capabilities) {
    if (capability.expiresAt <= now) capabilities.delete(key);
  }
  while (capabilities.size > REALTIME_VOICE_MAX_TOOL_GRANT_SESSIONS) {
    let oldestKey: string | undefined;
    let oldestExpiry = Number.POSITIVE_INFINITY;
    for (const [key, capability] of capabilities) {
      if (capability.expiresAt < oldestExpiry) {
        oldestKey = key;
        oldestExpiry = capability.expiresAt;
      }
    }
    if (!oldestKey) break;
    capabilities.delete(oldestKey);
  }
}

function registerRealtimeToolCapability(
  capabilities: RealtimeToolCapabilityStore,
  auth: AuthenticatedVoiceContext,
  initialNames: Iterable<string>,
): string {
  cleanRealtimeToolCapabilities(capabilities);
  const token = mintRealtimeToolCapability();
  capabilities.set(token, {
    userEmail: auth.userEmail.trim().toLowerCase(),
    ...(auth.orgId ? { orgId: auth.orgId } : {}),
    ...(auth.browserTabId ? { browserTabId: auth.browserTabId } : {}),
    expiresAt: Date.now() + REALTIME_VOICE_TOOL_GRANT_TTL_MS,
    initialNames: new Set(initialNames),
    names: new Set(),
  });
  cleanRealtimeToolCapabilities(capabilities);
  return token;
}

function resolveRealtimeToolCapability(
  capabilities: RealtimeToolCapabilityStore,
  token: string | undefined,
  auth: AuthenticatedVoiceContext,
): RealtimeToolCapability | null {
  cleanRealtimeToolCapabilities(capabilities);
  if (!token) return null;
  const capability = capabilities.get(token);
  if (!capability) return null;
  if (
    capability.userEmail !== auth.userEmail.trim().toLowerCase() ||
    capability.orgId !== auth.orgId ||
    capability.browserTabId !== auth.browserTabId
  ) {
    return null;
  }
  capability.expiresAt = Date.now() + REALTIME_VOICE_TOOL_GRANT_TTL_MS;
  return capability;
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
  const query = input.request.args.query;
  if (
    input.request.name !== TOOL_SEARCH_ACTION_NAME ||
    input.result.status !== "completed" ||
    typeof query !== "string" ||
    !query.trim()
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
  input.capability.expiresAt = Date.now() + REALTIME_VOICE_TOOL_GRANT_TTL_MS;
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
): Promise<string | null | "oversize"> {
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

async function buildInstructions(
  context: RealtimeVoiceRequestContext,
  options: MountRealtimeVoiceRoutesOptions,
): Promise<string> {
  const dynamic = await options.getInstructions?.(context);
  const appInstructions = dynamic ?? options.instructions;
  if (!appInstructions?.trim()) return DEFAULT_INSTRUCTIONS;
  return truncate(
    sanitizeToolErrorText(
      `${DEFAULT_INSTRUCTIONS}\n\n${appInstructions.trim()}`,
    ),
    MAX_INSTRUCTIONS_CHARS,
  );
}

/**
 * Hash the authenticated identity before sending it to OpenAI. The stable
 * digest is useful for abuse detection without disclosing the user's email.
 */
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

function createSessionHandler(
  tools: RealtimeFunctionTool[],
  capabilities: RealtimeToolCapabilityStore,
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
        const builderCredentials = await resolveBuilderCredentials();
        const builderConfigured = Boolean(
          builderCredentials.privateKey?.trim() &&
          builderCredentials.publicKey?.trim(),
        );
        const apiKey = builderConfigured
          ? null
          : (await resolveSecret("OPENAI_API_KEY"))?.trim();
        if (!builderConfigured && !apiKey) {
          setResponseStatus(event, 409);
          return {
            error:
              "Connect Builder or configure an OpenAI API key to use realtime voice.",
            code: "realtime_voice_setup_required",
          };
        }

        const instructions = await buildInstructions(auth, options);
        const transcriptionLanguage = resolveRealtimeVoiceLanguagePreference(
          readSafeHeader(event, "x-agent-native-realtime-language"),
          readSafeHeader(event, "accept-language"),
        );
        const reasoningEffort = resolveRealtimeVoiceReasoningEffort(
          readSafeHeader(event, "x-agent-native-realtime-intelligence"),
        );
        const voice = resolveRealtimeVoicePreference(
          readSafeHeader(event, "x-agent-native-realtime-voice"),
          configuredIdentifier(options.voice, DEFAULT_VOICE),
        );
        const sessionBase = {
          type: "realtime",
          model: configuredIdentifier(options.model, DEFAULT_MODEL),
          instructions,
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
                create_response: true,
                interrupt_response: true,
                eagerness: "auto",
              },
            },
            output: {
              voice,
            },
          },
        };
        const packedTools = packRealtimeTools(sessionBase, tools);
        const session = {
          ...sessionBase,
          tools: packedTools,
          tool_choice: "auto",
        };

        let upstream: Response;
        try {
          if (builderConfigured) {
            const gatewayUrl = new URL(
              "realtime/calls",
              getBuilderGatewayBaseUrl().endsWith("/")
                ? getBuilderGatewayBaseUrl()
                : `${getBuilderGatewayBaseUrl()}/`,
            );
            gatewayUrl.searchParams.set(
              "apiKey",
              builderCredentials.publicKey!.trim(),
            );
            upstream = await fetch(gatewayUrl.toString(), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${builderCredentials.privateKey!.trim()}`,
                "x-builder-api-key": builderCredentials.publicKey!.trim(),
                ...getBuilderGatewayRequestHeaders(),
                ...(builderCredentials.userId
                  ? { "x-builder-user-id": builderCredentials.userId }
                  : {}),
              },
              body: JSON.stringify({ sdp, session }),
            });
          } else {
            const form = new FormData();
            form.set("sdp", sdp);
            form.set("session", JSON.stringify(session));
            upstream = await fetch(OPENAI_REALTIME_CALLS_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "OpenAI-Safety-Identifier": await realtimeVoiceSafetyIdentifier(
                  auth.userEmail,
                ),
              },
              body: form,
            });
          }
        } catch {
          setResponseStatus(event, 502);
          return {
            error: builderConfigured
              ? "Could not reach the Builder realtime voice gateway"
              : "Could not reach the OpenAI Realtime API",
          };
        }

        if (!upstream.ok) {
          const detail = await safeOpenAiErrorDetail(
            upstream,
            builderConfigured ? builderCredentials.privateKey! : apiKey!,
          );
          setResponseStatus(event, builderConfigured ? upstream.status : 502);
          return {
            error: `${builderConfigured ? "Builder" : "OpenAI"} rejected the realtime session (${upstream.status})${detail ? `: ${detail}` : ""}`,
          };
        }

        const answerSdp = await upstream.text().catch(() => "");
        if (!answerSdp.trim()) {
          setResponseStatus(event, 502);
          return {
            error: `${builderConfigured ? "Builder" : "OpenAI"} returned an empty realtime session answer`,
          };
        }

        setResponseStatus(event, upstream.status);
        setResponseHeader(event, "Content-Type", "application/sdp");
        setResponseHeader(
          event,
          REALTIME_VOICE_CAPABILITY_HEADER,
          registerRealtimeToolCapability(
            capabilities,
            auth,
            packedTools.map((tool) => tool.name),
          ),
        );
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
} | null {
  if (!isRecord(value)) return null;
  const { name, args, callId, sessionId, browserTabId } = value;
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
  return {
    name,
    args,
    callId,
    ...(sessionId ? { sessionId } : {}),
    ...(browserTabId ? { browserTabId } : {}),
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

function createToolHandler(
  toolsByName: ReadonlyMap<string, RealtimeFunctionTool>,
  capabilities: RealtimeToolCapabilityStore,
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
      capabilities,
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
    const threadId = request.sessionId
      ? `realtime:${request.sessionId}`
      : `realtime:${request.callId}`;
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
          const result = normalizeExecutionResult(
            await options.executeTool({
              event,
              userEmail: auth.userEmail,
              orgId: auth.orgId,
              ...request,
              ...(browserTabId ? { browserTabId } : {}),
            }),
          );
          const expandedTools = grantDiscoveredRealtimeTools({
            request,
            result,
            toolsByName,
            initialAllowedNames: capability.initialNames,
            capability,
          });
          return {
            callId: request.callId,
            ...result,
            ...(expandedTools.length > 0 ? { expandedTools } : {}),
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

/** Mount the authenticated OpenAI Realtime WebRTC and tool bridge routes. */
export function mountRealtimeVoiceRoutes(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options: MountRealtimeVoiceRoutesOptions,
): { sessionPath: string; toolPath: string } {
  if (typeof options?.executeTool !== "function") {
    throw new Error("mountRealtimeVoiceRoutes requires executeTool");
  }

  const tools = buildRealtimeTools(actions);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const capabilities: RealtimeToolCapabilityStore = new Map();
  const app = getH3App(nitroApp);
  app.use(
    REALTIME_VOICE_SESSION_PATH,
    createSessionHandler(tools, capabilities, options),
  );
  app.use(
    REALTIME_VOICE_TOOL_PATH,
    createToolHandler(toolsByName, capabilities, options),
  );
  return {
    sessionPath: REALTIME_VOICE_SESSION_PATH,
    toolPath: REALTIME_VOICE_TOOL_PATH,
  };
}
