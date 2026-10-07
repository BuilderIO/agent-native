import { getDbExec } from "../db/client.js";
import { resolveWorkspaceConnectionForApp } from "../workspace-connections/store.js";
import { ensureRunTables } from "./run-store.js";
import type { AgentChatEvent } from "./types.js";

type ConnectionRequired = Extract<
  AgentChatEvent,
  { type: "connection_required" }
>;

/**
 * A run that ended `connection_required` leaves no mark on its `agent_runs`
 * row, so the event ledger is the only durable record. The lookup is bounded
 * by run count and age so it stays cheap and an old request ages out. Turn-abort
 * marker rows are bookkeeping, not runs, and must not use up the window.
 */
const CONNECTION_REQUEST_RUN_WINDOW = 8;
const CONNECTION_REQUEST_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_REQUEST_EVENT_ROWS = 16;
/** A request nothing can re-check outlives only this many runs. */
const UNVERIFIABLE_REQUEST_RUNS = 2;
const MAX_NOTE_PROVIDERS = 3;
const MAX_NAME_CHARS = 80;
const MAX_DETAIL_CHARS = 200;
/** Longer than this and the read costs the user more than the note saves. */
const PRIOR_CONNECTION_READ_TIMEOUT_MS = 400;

const REMEDY_BY_REASON: Partial<Record<ConnectionRequired["reason"], string>> =
  {
    connect:
      "If you cannot connect it yourself, ask a workspace admin to connect it for the workspace.",
    grant:
      "Ask a workspace admin to grant this app access to the existing connection.",
    admin_required:
      "Only a workspace admin can do this; ask one to connect it.",
  };

/** A connection request's message, plus who can unblock it when that is known. */
export function connectionRequiredMessage(
  message: string,
  reason: ConnectionRequired["reason"],
): string {
  const remedy = REMEDY_BY_REASON[reason];
  if (!remedy || /workspace admin/i.test(message)) return message;
  return `${message} ${remedy}`;
}

/**
 * Provider, label and detail are supplied by A2A peers and provider adapters,
 * and the note lands in the user turn: nothing that can open or close a tag or
 * start a new line of instructions gets through.
 */
function sanitizeNoteText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export interface ThreadConnectionRequest {
  request: ConnectionRequired;
  /** How many of the thread's newer runs came after the one that asked. */
  runsAgo: number;
}

/**
 * The connection requests among a thread's recent runs, newest first. Throws
 * when the ledger can't be read.
 */
export async function readThreadConnectionRequests(
  threadId: string,
  options: { excludeRunId?: string } = {},
): Promise<ThreadConnectionRequest[]> {
  await ensureRunTables();
  const db = getDbExec();
  const { rows: runRows } = await db.execute({
    sql: `SELECT id FROM agent_runs
          WHERE thread_id = ?
            AND started_at >= ?
            AND dispatch_mode IS DISTINCT FROM 'turn-abort'
            AND id <> ?
          ORDER BY started_at DESC
          LIMIT ?`,
    args: [
      threadId,
      Date.now() - CONNECTION_REQUEST_MAX_AGE_MS,
      options.excludeRunId ?? "",
      CONNECTION_REQUEST_RUN_WINDOW,
    ],
  });
  const runIds = runRows.map((row) => (row as { id: string }).id);
  if (runIds.length === 0) return [];

  const { rows } = await db.execute({
    sql: `SELECT run_id, event_data
          FROM agent_run_events
          WHERE run_id IN (${runIds.map(() => "?").join(", ")})
            AND event_data LIKE '{"type":"connection_required"%' /* guard:allow-blob-predicate — scoped to one thread's last 8 runs in 6h by the (run_id, seq) key; the marker has no column of its own, so a column plus backfill is the follow-up */
          ORDER BY event_at DESC NULLS LAST, seq DESC
          LIMIT ?`,
    args: [...runIds, MAX_REQUEST_EVENT_ROWS],
  });
  const found: ThreadConnectionRequest[] = [];
  for (const row of rows as Array<{ run_id: string; event_data?: string }>) {
    if (!row.event_data) continue;
    const request = JSON.parse(row.event_data) as ConnectionRequired;
    if (
      request.type === "connection_required" &&
      sanitizeNoteText(request.provider, MAX_NAME_CHARS)
    ) {
      found.push({ request, runsAgo: runIds.indexOf(row.run_id) });
    }
  }
  return found.sort((a, b) => a.runsAgo - b.runsAgo);
}

export type PriorConnectionNote =
  | { status: "none" }
  | { status: "connected" }
  | { status: "blocked"; note: string }
  | { status: "unreadable"; error: string };

const PRIOR_CONNECTION_UNREADABLE_NOTE =
  "\n\n<context-note>Prior-run connection state could not be read this turn; if a provider call returns connection_required, stop and tell the user instead of retrying.</context-note>";

/** The context note a resolved state adds to the turn, or "" when it adds none. */
export function priorConnectionContextNote(prior: PriorConnectionNote): string {
  if (prior.status === "blocked") return prior.note;
  if (prior.status === "unreadable") return PRIOR_CONNECTION_UNREADABLE_NOTE;
  return "";
}

function describeRequest(request: ConnectionRequired): {
  name: string;
  detail: string;
} {
  const provider = sanitizeNoteText(request.provider, MAX_NAME_CHARS);
  const label = sanitizeNoteText(request.source?.label, MAX_NAME_CHARS);
  // A label can name an agent or a connection; the provider is always said.
  const name = !label
    ? provider
    : label.toLowerCase() === provider.toLowerCase()
      ? label
      : `${provider} (${label})`;
  return { name, detail: sanitizeNoteText(request.detail, MAX_DETAIL_CHARS) };
}

function priorConnectionNote(requests: ConnectionRequired[]): string {
  const many = requests.length > 1;
  const described = requests.map(describeRequest);
  const details = described.filter(({ detail }) => detail);
  const detailText = details.length
    ? ` (${
        many
          ? details.map(({ name, detail }) => `${name}: ${detail}`).join("; ")
          : details[0].detail
      })`
    : "";
  return (
    `\n\n<context-note>${described.map(({ name }) => name).join(", ")} ${many ? "were" : "was"} not connected for this workspace when last tried in this thread${detailText}. ` +
    `Do not call ${many ? "them" : "it"} again unless the user says ${many ? "they are" : "it is"} now connected; use another connected source that can answer the request, or tell the user who can connect ${many ? "them" : "it"}.</context-note>`
  );
}

async function resolveNote(input: {
  threadId: string;
  appId?: string;
  excludeRunId?: string;
}): Promise<PriorConnectionNote> {
  const appIdFor = (request: ConnectionRequired) =>
    request.appId ?? input.appId;
  const canRecheck = (request: ConnectionRequired) =>
    request.source?.kind === "workspace_connection" && !!appIdFor(request);

  // One entry per provider, newest first: each run's failure names a
  // different provider, and a note about only the latest sends the model to
  // the one before it.
  const seen = new Set<string>();
  const candidates = (
    await readThreadConnectionRequests(input.threadId, {
      excludeRunId: input.excludeRunId,
    })
  )
    .filter(({ request }) => {
      const key = sanitizeNoteText(
        request.provider,
        MAX_NAME_CHARS,
      ).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter(
      ({ request, runsAgo }) =>
        canRecheck(request) || runsAgo < UNVERIFIABLE_REQUEST_RUNS,
    )
    .slice(0, MAX_NOTE_PROVIDERS);
  if (candidates.length === 0) return { status: "none" };

  const stillBlocked = await Promise.all(
    candidates.map(async ({ request }) => {
      if (!canRecheck(request)) return true;
      try {
        const resolved = await resolveWorkspaceConnectionForApp({
          appId: appIdFor(request)!,
          provider: request.provider,
          requireConnected: true,
        });
        return !resolved.available;
      } catch (error) {
        console.warn(
          "[agent-chat] could not re-check workspace connection; keeping the earlier request:",
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }
    }),
  );
  const blocked = candidates.filter((_, index) => stillBlocked[index]);
  if (blocked.length === 0) return { status: "connected" };
  return {
    status: "blocked",
    note: priorConnectionNote(blocked.map(({ request }) => request)),
  };
}

/**
 * The note that keeps a thread's next run from retrying a provider whose
 * connection request ended an earlier run. A request drops out once a
 * workspace connection for that provider is available again, or, when nothing
 * can re-check it, after a couple of runs. A ledger that can't be read in time
 * is reported rather than read as "no request".
 */
export async function resolvePriorConnectionNote(input: {
  threadId: string;
  appId?: string;
  excludeRunId?: string;
  timeoutMs?: number;
}): Promise<PriorConnectionNote> {
  const timeoutMs = input.timeoutMs ?? PRIOR_CONNECTION_READ_TIMEOUT_MS;
  const unreadable = (error: unknown): PriorConnectionNote => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[agent-chat] prior connection request unreadable:", message);
    return { status: "unreadable", error: message };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PriorConnectionNote>((resolve) => {
    timer = setTimeout(
      () => resolve(unreadable(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([resolveNote(input), timedOut]);
  } catch (error) {
    return unreadable(error);
  } finally {
    clearTimeout(timer);
  }
}
