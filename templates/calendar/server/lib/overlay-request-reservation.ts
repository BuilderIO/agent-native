export const OVERLAY_REQUESTS_SETTING_KEY = "calendar-overlay-requests";

export const PENDING_PREFIX = "pending:";

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
  perPeer: Record<string, string>;
  dailyCounts: Record<string, number>;
};

export function overlayRequestDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

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
