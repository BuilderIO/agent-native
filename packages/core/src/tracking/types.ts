export interface TrackingEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
  anonymousId?: string;
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
  /**
   * Receive a test identity's `$exception` events, flagged
   * `test_identity: true`. Every other test-identity event is dropped before
   * any provider; providers without this never see test identities at all.
   */
  acceptsTestIdentityExceptions?: boolean;
}
