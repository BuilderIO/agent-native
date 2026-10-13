/**
 * Whether a piece of per-turn grounding reached the model. `empty` is a real
 * answer (nothing relevant); `timed_out` and `failed` mean the model is
 * working without context it would normally have, and must be told so.
 */
export type ContextStatus = "ok" | "empty" | "timed_out" | "failed";

const SEVERITY: Record<ContextStatus, number> = {
  empty: 0,
  ok: 1,
  timed_out: 2,
  failed: 3,
};

export function isContextStatus(value: unknown): value is ContextStatus {
  return typeof value === "string" && Object.hasOwn(SEVERITY, value);
}

const warnedInvalidStatuses = new Set<string>();

/**
 * The status an app hook reported, from an object with a `status` field.
 * Undefined means the hook reported nothing; a status this code doesn't know
 * is a hook bug, so it counts as `failed` rather than as silence.
 */
export function readReportedContextStatus(
  value: unknown,
): ContextStatus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = (value as { status?: unknown }).status;
  if (status === undefined) return undefined;
  if (isContextStatus(status)) return status;
  const shown = String(status).slice(0, 40);
  if (!warnedInvalidStatuses.has(shown)) {
    warnedInvalidStatuses.add(shown);
    console.warn(
      `[agent-chat] unknown context status "${shown}" reported by prepareRequest; treating it as failed`,
    );
  }
  return "failed";
}

export function worstContextStatus(
  ...statuses: ReadonlyArray<ContextStatus | undefined>
): ContextStatus | undefined {
  let worst: ContextStatus | undefined;
  for (const status of statuses) {
    if (status && (!worst || SEVERITY[status] > SEVERITY[worst])) {
      worst = status;
    }
  }
  return worst;
}

export function isContextDegraded(status: ContextStatus | undefined): boolean {
  return status === "timed_out" || status === "failed";
}

const wrapNote = (text: string) => `\n\n<context-note>${text}</context-note>`;

export function screenContextUnavailableNote(canViewScreen: boolean): string {
  return wrapNote(
    canViewScreen
      ? "Current screen unavailable this turn; call view-screen before editing or answering about the open page."
      : "Current screen unavailable this turn; ask the user what is open before editing or answering about the page.",
  );
}

export const SELECTION_CONTEXT_UNAVAILABLE_NOTE = wrapNote(
  "Selected text unavailable this turn; ask the user to paste it if the request refers to a selection.",
);

/** `partial` when another source did deliver context this turn. */
export function preloadedContextUnavailableNote(
  status: ContextStatus,
  options: { partial?: boolean } = {},
): string {
  const reason = status === "timed_out" ? "timed out" : "failed";
  return wrapNote(
    `${options.partial ? "Some preloaded context" : "Preloaded context"} was unavailable this turn (${reason}); search for anything relevant with the available tools before answering.`,
  );
}
