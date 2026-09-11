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
 * read as `perPeer` with an empty `dailyCounts`, so existing settings keep
 * working without a migration.
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
  return {
    perPeer: (current ?? {}) as Record<string, string>,
    dailyCounts: {},
  };
}
