export const OVERLAY_REQUESTS_SETTING_KEY = "calendar-overlay-requests";

// Marks a slot as reserved while an overlay-request email is in flight, so a
// concurrent call sees it as occupied instead of re-reading a pre-send state.
export const PENDING_PREFIX = "pending:";

/**
 * Parses a stored `calendar-overlay-requests` entry, which is either a
 * confirmed ISO timestamp or a `pending:<iso>` reservation marker.
 */
export function parseOverlayRequestEntry(value: string): {
  sentAt: number | null;
  pending: boolean;
} {
  const pending = value.startsWith(PENDING_PREFIX);
  const raw = pending ? value.slice(PENDING_PREFIX.length) : value;
  const parsed = Date.parse(raw);
  return { sentAt: Number.isFinite(parsed) ? parsed : null, pending };
}

export type OverlayRequestState = {
  /** Per-peer cooldown/reservation marker: peerEmail -> iso | `pending:iso`. */
  perPeer: Record<string, string>;
  /** Fixed-window send count per UTC day ("YYYY-MM-DD"), for the daily cap. */
  dailyCounts: Record<string, number>;
};

/** UTC calendar-day key used to bucket the daily send cap. */
export function overlayRequestDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Normalizes a stored `calendar-overlay-requests` value into the current
 * `{ perPeer, dailyCounts }` shape. Older stored data is a flat
 * `Record<peerEmail, string>` (no daily-count bucket yet); that shape is
 * read as `perPeer`, with `dailyCounts` rebuilt by bucketing each entry's own
 * timestamp by day rather than left empty — an undercount for a peer resent
 * same-day (the flat shape only ever kept one entry per peer), but far closer
 * to the real count than reporting zero and handing back a full cap for free.
 */
export function normalizeOverlayRequestState(
  current: unknown,
): OverlayRequestState {
  if (current && typeof current === "object" && "perPeer" in current) {
    const state = current as Partial<OverlayRequestState>;
    return {
      perPeer: state.perPeer ?? {},
      dailyCounts: state.dailyCounts ?? {},
    };
  }
  const perPeer = (current ?? {}) as Record<string, string>;
  const dailyCounts: Record<string, number> = {};
  for (const value of Object.values(perPeer)) {
    const { sentAt } = parseOverlayRequestEntry(value);
    if (sentAt === null) continue;
    const dayKey = overlayRequestDayKey(sentAt);
    dailyCounts[dayKey] = (dailyCounts[dayKey] ?? 0) + 1;
  }
  return { perPeer, dailyCounts };
}
