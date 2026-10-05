export interface ConversationMessageLike {
  index: number;
  id: string | null;
  role: string;
  createdAt: string | number | null;
  metadata: unknown;
}

export interface ConversationRunLike {
  id: string;
  startedAt: number;
}

export type ConversationRow<
  M extends ConversationMessageLike,
  R extends ConversationRunLike,
> =
  | { kind: "message"; key: string; message: M; run: R | null }
  | { kind: "run"; key: string; run: R };

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * The run a persisted message belongs to. Assistant rows carry the run that
 * produced them; user rows carry the run they submitted (`submittedRunId`).
 */
export function messageRunId(message: ConversationMessageLike): string | null {
  const meta = message.metadata as Record<string, any> | null | undefined;
  if (!meta || typeof meta !== "object") return null;
  const custom =
    meta.custom && typeof meta.custom === "object" ? meta.custom : {};
  if (message.role === "user") {
    return stringField(custom.submittedRunId) ?? stringField(meta.runId);
  }
  return (
    stringField(meta.runId) ??
    stringField(custom.runId) ??
    stringField(custom.runError?.runId) ??
    stringField(meta.runError?.runId)
  );
}

export function messageRowKey(message: ConversationMessageLike): string {
  return message.id
    ? `message:${message.id}`
    : `message-index:${message.index}`;
}

export function runRowKey(run: ConversationRunLike): string {
  return `run:${run.id}`;
}

function messageTime(message: ConversationMessageLike): number | null {
  const value = message.createdAt;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

/**
 * One chronological list of the thread: every persisted message, plus a
 * standalone row for each run no assistant message accounts for. Those runs
 * are usually failures before the model replied (run_preparation_failed,
 * background_worker_never_started); dropping them would hide exactly the runs
 * someone opened this page to debug.
 */
export function buildConversationRows<
  M extends ConversationMessageLike,
  R extends ConversationRunLike,
>(messages: M[], runs: R[]): ConversationRow<M, R>[] {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const answeredRunIds = new Set<string>();
  const submittedRunIds = new Set<string>();
  for (const message of messages) {
    const runId = messageRunId(message);
    if (!runId || !runsById.has(runId)) continue;
    if (message.role === "user") submittedRunIds.add(runId);
    else answeredRunIds.add(runId);
  }

  const rows: ConversationRow<M, R>[] = [];
  for (const message of messages) {
    const runId = messageRunId(message);
    const run = runId ? (runsById.get(runId) ?? null) : null;
    rows.push({ kind: "message", key: messageRowKey(message), message, run });
    // A submitted turn with no assistant reply ends right after its prompt.
    if (
      message.role === "user" &&
      run &&
      submittedRunIds.has(run.id) &&
      !answeredRunIds.has(run.id)
    ) {
      rows.push({ kind: "run", key: runRowKey(run), run });
    }
  }

  const unlinked = runs
    .filter(
      (run) => !answeredRunIds.has(run.id) && !submittedRunIds.has(run.id),
    )
    .sort((a, b) => a.startedAt - b.startedAt);
  for (const run of unlinked) {
    const row: ConversationRow<M, R> = {
      kind: "run",
      key: runRowKey(run),
      run,
    };
    const insertAt = rows.findIndex((candidate) => {
      if (candidate.kind !== "message")
        return candidate.run.startedAt > run.startedAt;
      const time = messageTime(candidate.message);
      return time != null && time > run.startedAt;
    });
    if (insertAt === -1) rows.push(row);
    else rows.splice(insertAt, 0, row);
  }
  return rows;
}

/** The row to open by default: the one tied to a deep-linked run, else the last. */
export function defaultConversationRowKey<
  M extends ConversationMessageLike,
  R extends ConversationRunLike,
>(
  rows: ConversationRow<M, R>[],
  runId: string | null | undefined,
): string | null {
  if (runId) {
    const linked =
      rows.find(
        (row) =>
          row.run?.id === runId &&
          (row.kind === "run" || row.message.role !== "user"),
      ) ?? rows.find((row) => row.run?.id === runId);
    if (linked) return linked.key;
  }
  return rows.at(-1)?.key ?? null;
}
