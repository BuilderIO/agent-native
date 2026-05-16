import AsyncStorage from "@react-native-async-storage/async-storage";
import { TEMPLATE_APPS } from "@agent-native/shared-app-config";

export const SESSION_TOKEN_KEY = "agent-native:session-token";

export const REMOTE_SESSIONS_ENDPOINTS = {
  hosts: "/_agent-native/integrations/remote/hosts",
  runs: "/_agent-native/integrations/remote/runs",
  runDetail: (runId: string) =>
    `/_agent-native/integrations/remote/runs/${encodeURIComponent(runId)}`,
  transcript: (runId: string) =>
    `/_agent-native/integrations/remote/runs/${encodeURIComponent(
      runId,
    )}/transcript`,
  enqueue: "/_agent-native/integrations/remote/enqueue",
} as const;

const dispatchApp = TEMPLATE_APPS.find((app) => app.id === "dispatch");
export const DEFAULT_REMOTE_RELAY_BASE_URL =
  dispatchApp?.url || "https://dispatch.agent-native.com";

export type RemoteHostStatus = "online" | "offline" | "busy" | "unknown";
export type RemoteRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "needs-approval"
  | "completed"
  | "errored"
  | "unknown";

export interface RemoteHost {
  id: string;
  name: string;
  status: RemoteHostStatus;
  lastSeenAt?: string;
  platform?: string;
  version?: string;
}

export interface RemoteRun {
  id: string;
  goalId?: string;
  hostId?: string;
  title: string;
  subtitle?: string;
  status: RemoteRunStatus;
  phase?: string;
  needsApproval?: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type RemoteTranscriptEventType =
  | "user"
  | "system"
  | "artifact"
  | "status";

export interface RemoteTranscriptEvent {
  id: string;
  runId: string;
  type: RemoteTranscriptEventType;
  title?: string;
  text: string;
  createdAt: string;
  artifactPath?: string;
  artifactUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface RemoteApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export interface CreateRemoteRunInput {
  prompt: string;
  hostId?: string;
  cwd?: string;
  goalId?: string;
  permissionMode?: "read-only" | "ask-before-edit" | "auto-edit" | "full-auto";
}

export interface AppendRemoteFollowUpInput {
  runId: string;
  prompt: string;
  goalId?: string;
  hostId?: string;
  followUpMode?: "immediate" | "queued";
}

export interface PendingCommandDecisionInput {
  runId: string;
  decision: "approve" | "deny";
  commandId?: string;
  reason?: string;
  hostId?: string;
}

export interface PendingCommand {
  id?: string;
  reason: string;
  command?: string;
}

type FetchOptions = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> =>
    Boolean(asRecord(item)),
  );
}

function pickArray(
  payload: unknown,
  keys: string[],
): Record<string, unknown>[] {
  const direct = asRecordArray(payload);
  if (direct.length > 0) return direct;

  const record = asRecord(payload);
  if (!record) return [];
  for (const key of keys) {
    const values = asRecordArray(record[key]);
    if (values.length > 0) return values;
  }

  const nested = asRecord(record.data) ?? asRecord(record.result);
  if (!nested) return [];
  for (const key of keys) {
    const values = asRecordArray(nested[key]);
    if (values.length > 0) return values;
  }
  return [];
}

function pickRecord(
  payload: unknown,
  keys: string[],
): Record<string, unknown> | null {
  const record = asRecord(payload);
  if (!record) return null;
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  const nested = asRecord(record.data) ?? asRecord(record.result);
  if (!nested) return record;
  for (const key of keys) {
    const value = asRecord(nested[key]);
    if (value) return value;
  }
  return nested;
}

function parseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFromPayload(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  return (
    asString(record?.error) ||
    asString(record?.message) ||
    asString(asRecord(record?.data)?.error) ||
    asString(asRecord(record?.result)?.error) ||
    fallback
  );
}

export function getRemoteRelayBaseUrl(): string {
  return normalizeBaseUrl(DEFAULT_REMOTE_RELAY_BASE_URL);
}

async function remoteFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<RemoteApiResult<T>> {
  const token = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Sign in to Agent Native on this device to connect sessions.",
    };
  }

  try {
    const response = await fetch(`${getRemoteRelayBaseUrl()}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = parseJson(await response.text());
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: payload as T,
        error:
          response.status === 404
            ? "Remote sessions are not available on this relay yet."
            : messageFromPayload(
                payload,
                `Request failed (${response.status}).`,
              ),
      };
    }
    return { ok: true, status: response.status, data: payload as T };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeStatus(value: unknown): RemoteRunStatus {
  if (
    value === "queued" ||
    value === "running" ||
    value === "paused" ||
    value === "needs-approval" ||
    value === "completed" ||
    value === "errored"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeHostStatus(value: unknown): RemoteHostStatus {
  if (value === "online" || value === "offline" || value === "busy") {
    return value;
  }
  return "unknown";
}

function normalizeHost(record: Record<string, unknown>): RemoteHost {
  const id = asString(record.id) || asString(record.hostId) || "unknown-host";
  return {
    id,
    name: asString(record.name) || asString(record.label) || id,
    status: normalizeHostStatus(record.status),
    lastSeenAt: asString(record.lastSeenAt) || asString(record.updatedAt),
    platform: asString(record.platform),
    version: asString(record.version),
  };
}

function normalizeRun(record: Record<string, unknown>): RemoteRun {
  const id = asString(record.id) || asString(record.runId) || "unknown-run";
  const metadata = asRecord(record.metadata) ?? undefined;
  return {
    id,
    goalId: asString(record.goalId),
    hostId: asString(record.hostId),
    title: asString(record.title) || asString(record.name) || id,
    subtitle:
      asString(record.subtitle) ||
      asString(record.cwd) ||
      asString(record.projectPath),
    status: normalizeStatus(record.status),
    phase: asString(record.phase),
    needsApproval: Boolean(record.needsApproval),
    createdAt: asString(record.createdAt) || new Date().toISOString(),
    updatedAt:
      asString(record.updatedAt) ||
      asString(record.lastEventAt) ||
      new Date().toISOString(),
    metadata,
  };
}

function normalizeTranscriptEvent(
  record: Record<string, unknown>,
  runId: string,
): RemoteTranscriptEvent {
  const type = record.type;
  return {
    id:
      asString(record.id) ||
      `${runId}-${asString(record.createdAt) || Date.now().toString()}`,
    runId: asString(record.runId) || runId,
    type:
      type === "user" ||
      type === "system" ||
      type === "artifact" ||
      type === "status"
        ? type
        : "system",
    title: asString(record.title),
    text: asString(record.text) || asString(record.message) || "",
    createdAt: asString(record.createdAt) || new Date().toISOString(),
    artifactPath: asString(record.artifactPath),
    artifactUrl: asString(record.artifactUrl),
    metadata: asRecord(record.metadata) ?? undefined,
  };
}

async function enqueueRemoteOperation<T>(
  operation: string,
  payload: Record<string, unknown>,
): Promise<RemoteApiResult<T>> {
  return remoteFetch<T>(REMOTE_SESSIONS_ENDPOINTS.enqueue, {
    method: "POST",
    body: {
      operation,
      type: operation,
      payload,
    },
  });
}

export async function listPairedHosts(): Promise<
  RemoteApiResult<RemoteHost[]>
> {
  const result = await remoteFetch<unknown>(REMOTE_SESSIONS_ENDPOINTS.hosts);
  if (!result.ok) return { ...result, data: [] };
  return {
    ok: true,
    status: result.status,
    data: pickArray(result.data, ["hosts", "pairedHosts", "items"]).map(
      normalizeHost,
    ),
  };
}

export async function listRemoteRuns(
  goalId = "task",
): Promise<RemoteApiResult<RemoteRun[]>> {
  const query = goalId ? `?goalId=${encodeURIComponent(goalId)}` : "";
  const result = await remoteFetch<unknown>(
    `${REMOTE_SESSIONS_ENDPOINTS.runs}${query}`,
  );
  if (!result.ok) return { ...result, data: [] };
  return {
    ok: true,
    status: result.status,
    data: pickArray(result.data, ["runs", "sessions", "items"]).map(
      normalizeRun,
    ),
  };
}

export async function getRemoteRunDetail(
  runId: string,
): Promise<RemoteApiResult<RemoteRun | null>> {
  const result = await remoteFetch<unknown>(
    REMOTE_SESSIONS_ENDPOINTS.runDetail(runId),
  );
  if (!result.ok) return { ...result, data: null };
  const record = pickRecord(result.data, ["run", "session"]);
  return {
    ok: true,
    status: result.status,
    data: record ? normalizeRun(record) : null,
  };
}

export async function readRemoteTranscript(
  runId: string,
): Promise<RemoteApiResult<RemoteTranscriptEvent[]>> {
  const result = await remoteFetch<unknown>(
    REMOTE_SESSIONS_ENDPOINTS.transcript(runId),
  );
  if (!result.ok) return { ...result, data: [] };
  return {
    ok: true,
    status: result.status,
    data: pickArray(result.data, ["events", "transcript", "items"]).map(
      (event) => normalizeTranscriptEvent(event, runId),
    ),
  };
}

export async function createRemoteRun(input: CreateRemoteRunInput): Promise<
  RemoteApiResult<{
    run?: RemoteRun;
    event?: RemoteTranscriptEvent;
    message?: string;
  }>
> {
  const result = await enqueueRemoteOperation<unknown>(
    "code-agent.run.create",
    {
      goalId: input.goalId ?? "task",
      hostId: input.hostId,
      prompt: input.prompt,
      cwd: input.cwd,
      permissionMode: input.permissionMode ?? "full-auto",
    },
  );
  if (!result.ok) return { ...result, data: undefined };

  const runRecord = pickRecord(result.data, ["run", "session"]);
  const commandRecord = pickRecord(result.data, ["command"]);
  const run = runRecord
    ? normalizeRun(runRecord)
    : commandRecord
      ? normalizeRun({
          id:
            commandRecord.id ??
            commandRecord.commandId ??
            commandRecord.requestId,
          runId:
            commandRecord.runId ??
            commandRecord.id ??
            commandRecord.commandId ??
            commandRecord.requestId,
          hostId: input.hostId,
          title: input.prompt,
          status: "queued",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: { remoteCommandId: commandRecord.id },
        })
      : undefined;
  const eventRecord = pickRecord(result.data, ["event"]);
  return {
    ok: true,
    status: result.status,
    data: {
      run,
      event:
        eventRecord && run
          ? normalizeTranscriptEvent(eventRecord, run.id)
          : undefined,
      message: messageFromPayload(result.data, "Session started."),
    },
  };
}

export async function appendRemoteFollowUp(
  input: AppendRemoteFollowUpInput,
): Promise<
  RemoteApiResult<{ event?: RemoteTranscriptEvent; message?: string }>
> {
  const result = await enqueueRemoteOperation<unknown>(
    "code-agent.run.follow-up",
    {
      goalId: input.goalId ?? "task",
      hostId: input.hostId,
      runId: input.runId,
      prompt: input.prompt,
      followUpMode: input.followUpMode ?? "immediate",
    },
  );
  if (!result.ok) return { ...result, data: undefined };

  const eventRecord = pickRecord(result.data, ["event"]);
  return {
    ok: true,
    status: result.status,
    data: {
      event: eventRecord
        ? normalizeTranscriptEvent(eventRecord, input.runId)
        : undefined,
      message: messageFromPayload(result.data, "Follow-up queued."),
    },
  };
}

export async function decidePendingCommand(
  input: PendingCommandDecisionInput,
): Promise<RemoteApiResult<{ message?: string }>> {
  const result = await enqueueRemoteOperation<unknown>(
    "code-agent.pending-command.decide",
    {
      hostId: input.hostId,
      runId: input.runId,
      commandId: input.commandId,
      decision: input.decision,
      reason: input.reason,
    },
  );
  if (!result.ok) return { ...result, data: undefined };
  return {
    ok: true,
    status: result.status,
    data: {
      message: messageFromPayload(
        result.data,
        input.decision === "approve" ? "Command approved." : "Command denied.",
      ),
    },
  };
}

export async function stopRemoteRun(
  runId: string,
  hostId?: string,
): Promise<RemoteApiResult<{ message?: string }>> {
  const result = await enqueueRemoteOperation<unknown>("code-agent.run.stop", {
    hostId,
    runId,
  });
  if (!result.ok) return { ...result, data: undefined };
  return {
    ok: true,
    status: result.status,
    data: { message: messageFromPayload(result.data, "Stop requested.") },
  };
}

export function isRemoteRunActive(run: RemoteRun | null | undefined): boolean {
  return Boolean(
    run &&
    (run.status === "queued" ||
      run.status === "running" ||
      run.status === "paused" ||
      run.status === "needs-approval"),
  );
}

export function getPendingCommand(
  run: RemoteRun | null | undefined,
): PendingCommand | null {
  if (!run) return null;
  const value = run.metadata?.pendingApproval;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return run.needsApproval || run.status === "needs-approval"
      ? { reason: "Review the pending command." }
      : null;
  }
  const record = value as Record<string, unknown>;
  return {
    id: asString(record.id) || asString(record.commandId),
    reason: asString(record.reason) || "Review the pending command.",
    command: asString(record.command),
  };
}
