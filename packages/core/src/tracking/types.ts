export interface TrackingEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
  anonymousId?: string;
  /**
   * Browser session the event belongs to, so a server-side event joins the
   * visit that caused it. Carried as a typed field rather than a property so
   * each provider maps it to its own session concept instead of every backend
   * receiving another backend's reserved key. `undefined` for callers with no
   * browser — cron, CLI, MCP, A2A — which is a real distinction, not a gap.
   */
  sessionId?: string;
}

export interface TrackingProvider {
  name: string;
  track(event: TrackingEvent): void | Promise<void>;
  identify?(
    userId: string,
    traits?: Record<string, unknown>,
  ): void | Promise<void>;
  flush?(): void | Promise<void>;
}
