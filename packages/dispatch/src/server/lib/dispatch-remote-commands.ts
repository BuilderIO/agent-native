import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";

export type RemoteCodeCommand =
  | { type: "create"; prompt: string }
  | { type: "list" }
  | { type: "status"; runRef?: string }
  | { type: "continue"; runRef: string; text: string }
  | { type: "approve"; approvalId: string }
  | { type: "deny"; approvalId: string }
  | { type: "stop"; runRef: string }
  | { type: "help"; reason?: string };

export interface RemoteCodeCommandEnvelope {
  kind: "code-agent";
  ownerEmail: string;
  command: Exclude<RemoteCodeCommand, { type: "help" }>;
  source: {
    platform: string;
    externalThreadId: string;
    senderId?: string;
    senderName?: string;
    messageId?: string;
    timestamp: number;
  };
}

export interface RemoteCodeRunSummary {
  id?: string;
  runId?: string;
  title?: string;
  prompt?: string;
  status?: string;
  updatedAt?: string | number | Date;
  createdAt?: string | number | Date;
}

export interface RemoteCodeCommandResult {
  ok?: boolean;
  status?: string;
  hostOnline?: boolean;
  hostStatus?: string;
  commandId?: string;
  requestId?: string;
  runId?: string;
  run?: RemoteCodeRunSummary;
  runs?: RemoteCodeRunSummary[];
  message?: string;
  error?: string;
}

export type RemoteCodeCommandRelay = (
  envelope: RemoteCodeCommandEnvelope,
) => Promise<RemoteCodeCommandResult>;

export interface HandleRemoteCodeCommandOptions {
  resolveOwner: () => Promise<string> | string;
  relay?: RemoteCodeCommandRelay;
}

const CODE_COMMAND_RE = /^\/code(?:@[a-zA-Z0-9_]+)?(?:\s+|$)/i;

export function parseTelegramCodeCommand(
  incoming: Pick<IncomingMessage, "platform" | "text" | "platformContext">,
): RemoteCodeCommand | null {
  if (incoming.platform !== "telegram") return null;

  const rawText = rawTelegramText(incoming);
  if (!rawText || !CODE_COMMAND_RE.test(rawText)) return null;

  return parseCodeCommandBody(rawText.replace(CODE_COMMAND_RE, "").trim());
}

export async function handleRemoteCodeCommand(
  incoming: IncomingMessage,
  _adapter: PlatformAdapter,
  options: HandleRemoteCodeCommandOptions,
): Promise<{ handled: true; responseText?: string } | { handled: false }> {
  const command = parseTelegramCodeCommand(incoming);
  if (!command) return { handled: false };

  if (command.type === "help") {
    return { handled: true, responseText: formatCodeCommandHelp(command) };
  }

  try {
    const ownerEmail = await options.resolveOwner();
    const envelope = createRemoteCodeCommandEnvelope(
      incoming,
      ownerEmail,
      command,
    );
    const relay = options.relay ?? enqueueRemoteCodeCommand;
    const result = await relay(envelope);
    return {
      handled: true,
      responseText: formatRemoteCodeCommandResult(command, result),
    };
  } catch (error) {
    return {
      handled: true,
      responseText:
        error instanceof Error
          ? `I couldn't route that code command: ${error.message}`
          : "I couldn't route that code command.",
    };
  }
}

export function createRemoteCodeCommandEnvelope(
  incoming: IncomingMessage,
  ownerEmail: string,
  command: Exclude<RemoteCodeCommand, { type: "help" }>,
): RemoteCodeCommandEnvelope {
  return {
    kind: "code-agent",
    ownerEmail,
    command,
    source: {
      platform: incoming.platform,
      externalThreadId: incoming.externalThreadId,
      senderId: incoming.senderId,
      senderName: incoming.senderName,
      messageId: contextString(incoming.platformContext.messageId),
      timestamp: incoming.timestamp,
    },
  };
}

export async function enqueueRemoteCodeCommand(
  envelope: RemoteCodeCommandEnvelope,
): Promise<RemoteCodeCommandResult> {
  const helperResult = await tryCoreRemoteCommandHelper(envelope);
  if (helperResult) return helperResult;

  const endpoint = `${resolveRemoteRelayBaseUrl()}/_agent-native/integrations/remote/enqueue`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error?: unknown }).error)
        : `remote relay returned ${response.status}`;
    throw new Error(message);
  }

  return normalizeRemoteCodeCommandResult(body);
}

export function formatRemoteCodeCommandResult(
  command: Exclude<RemoteCodeCommand, { type: "help" }>,
  result: RemoteCodeCommandResult,
): string {
  if (result.message?.trim()) return result.message.trim();
  if (result.error?.trim())
    return `Code command failed: ${result.error.trim()}`;

  if (command.type === "list") return formatRunList(result.runs ?? []);
  if (command.type === "status") return formatStatus(command, result);

  const id =
    result.runId ||
    result.run?.runId ||
    result.run?.id ||
    result.commandId ||
    result.requestId;
  const suffix = id ? ` (${id})` : "";
  const offline = isOfflineOrSleeping(result);

  if (command.type === "create") {
    return offline
      ? `Queued code run${suffix}. Your computer looks offline or asleep, so it will pick this up when it wakes.`
      : `Queued code run${suffix}.`;
  }

  if (command.type === "continue") {
    return offline
      ? `Queued follow-up for ${command.runRef}. Your computer looks offline or asleep, so it will pick this up when it wakes.`
      : `Queued follow-up for ${command.runRef}.`;
  }

  if (command.type === "approve") {
    return `Approved code-agent request ${command.approvalId}.`;
  }

  if (command.type === "deny") {
    return `Denied code-agent request ${command.approvalId}.`;
  }

  if (command.type === "stop") {
    return offline
      ? `Queued stop request for ${command.runRef}. Your computer looks offline or asleep, so it will receive the stop request when it wakes.`
      : `Stop requested for ${command.runRef}.`;
  }

  return "Code command routed.";
}

function parseCodeCommandBody(body: string): RemoteCodeCommand {
  if (!body) return { type: "help" };

  const [verbRaw = "", ...restParts] = body.split(/\s+/);
  const verb = verbRaw.toLowerCase();
  const rest = restParts.join(" ").trim();

  if (verb === "help") return { type: "help" };
  if (verb === "list") return { type: "list" };
  if (verb === "status") {
    return rest ? { type: "status", runRef: rest } : { type: "status" };
  }
  if (verb === "continue") {
    const { first, rest: text } = splitFirst(rest);
    if (!first || !text) {
      return { type: "help", reason: "continue needs a run id and text" };
    }
    return { type: "continue", runRef: first, text };
  }
  if (verb === "approve") {
    return rest
      ? { type: "approve", approvalId: rest }
      : { type: "help", reason: "approve needs a request id" };
  }
  if (verb === "deny") {
    return rest
      ? { type: "deny", approvalId: rest }
      : { type: "help", reason: "deny needs a request id" };
  }
  if (verb === "stop") {
    return rest
      ? { type: "stop", runRef: rest }
      : { type: "help", reason: "stop needs a run id or list index" };
  }

  return { type: "create", prompt: body };
}

function rawTelegramText(
  incoming: Pick<IncomingMessage, "text" | "platformContext">,
): string | null {
  const context = incoming.platformContext;
  return (
    contextString(context.rawText) ||
    contextString(context.originalText) ||
    contextString(context.messageText) ||
    (CODE_COMMAND_RE.test(incoming.text) ? incoming.text : null)
  );
}

function formatCodeCommandHelp(
  command?: Extract<RemoteCodeCommand, { type: "help" }>,
): string {
  const prefix = command?.reason ? `${command.reason}.\n\n` : "";
  return `${prefix}Use /code <prompt>, /code list, /code status [run], /code continue <run> <text>, /code approve <id>, /code deny <id>, or /code stop <run>.`;
}

function formatRunList(runs: RemoteCodeRunSummary[]): string {
  if (!runs.length) return "No recent code-agent runs found.";
  const lines = runs.slice(0, 8).map((run, index) => {
    const id = run.runId || run.id || "unknown";
    const title = run.title || run.prompt || "Untitled run";
    const status = run.status || "unknown";
    return `${index + 1}. ${title} — ${status} (${id})`;
  });
  return `Recent code-agent runs:\n${lines.join("\n")}`;
}

function formatStatus(
  command: Extract<RemoteCodeCommand, { type: "status" }>,
  result: RemoteCodeCommandResult,
): string {
  const run = result.run;
  const hostStatus =
    result.hostStatus || (result.hostOnline ? "online" : "offline");
  if (!run) {
    const target = command.runRef ? ` for ${command.runRef}` : "";
    return `Code-agent host is ${hostStatus}${target}.`;
  }

  const id = run.runId || run.id || command.runRef || "unknown";
  const title = run.title || run.prompt || "Untitled run";
  const status = run.status || result.status || "unknown";
  const updated = formatDate(run.updatedAt || run.createdAt);
  return [
    `Code run ${id}: ${status}`,
    `Task: ${title}`,
    `Host: ${hostStatus}`,
    updated ? `Updated: ${updated}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isOfflineOrSleeping(result: RemoteCodeCommandResult): boolean {
  if (result.hostOnline === false) return true;
  const status = result.hostStatus?.toLowerCase();
  return status === "offline" || status === "asleep" || status === "sleeping";
}

function splitFirst(value: string): { first: string; rest: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  return { first: match?.[1] || "", rest: match?.[2]?.trim() || "" };
}

function contextString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function formatDate(value: RemoteCodeRunSummary["updatedAt"]): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function tryCoreRemoteCommandHelper(
  envelope: RemoteCodeCommandEnvelope,
): Promise<RemoteCodeCommandResult | null> {
  const core = (await import("@agent-native/core/server")) as Record<
    string,
    unknown
  >;
  const helper =
    core.enqueueRemoteCommand ||
    core.enqueueIntegrationRemoteCommand ||
    core.enqueueRemoteIntegrationCommand;
  if (typeof helper !== "function") return null;
  return normalizeRemoteCodeCommandResult(await helper(envelope));
}

function normalizeRemoteCodeCommandResult(
  value: unknown,
): RemoteCodeCommandResult {
  if (!value || typeof value !== "object") return { ok: true };
  const result = value as RemoteCodeCommandResult;
  return {
    ok: result.ok,
    status: contextString(result.status),
    hostOnline:
      typeof result.hostOnline === "boolean" ? result.hostOnline : undefined,
    hostStatus: contextString(result.hostStatus),
    commandId: contextString(result.commandId),
    requestId: contextString(result.requestId),
    runId: contextString(result.runId),
    run: result.run,
    runs: Array.isArray(result.runs) ? result.runs : undefined,
    message: contextString(result.message),
    error: contextString(result.error),
  };
}

function resolveRemoteRelayBaseUrl(): string {
  const raw =
    process.env.WEBHOOK_BASE_URL ||
    process.env.APP_URL ||
    process.env.URL ||
    "http://localhost:3000";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, "");
  return `https://${raw.replace(/\/$/, "")}`;
}
