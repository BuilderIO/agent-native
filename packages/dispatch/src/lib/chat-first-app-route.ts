export type ChatFirstAppRouteAnswer =
  | {
      status: "ok";
      app: string;
      cached?: boolean;
      latencyMs?: number;
      model?: string;
    }
  | { status: "not_configured" | "failed"; reason: string; latencyMs?: number };

export type ChatFirstAppRouteSkip =
  | "none"
  | "not_configured"
  | "failed"
  | "timeout"
  | "unknown_app"
  | "dispatch"
  | "shown"
  | "stale";

export type ChatFirstAppRoutePlan =
  | { kind: "open"; appId: string }
  | { kind: "skip"; reason: ChatFirstAppRouteSkip };

/**
 * What an early route answer may do to the pane. It opens only an installed
 * app other than Dispatch and the one already shown, and only while nothing has
 * changed the pane since the send.
 */
export function planChatFirstAppRoute(input: {
  answer: ChatFirstAppRouteAnswer | "timeout";
  /** The installed app id the answer names, or null when none matches. */
  installedApp: (app: string) => string | null;
  isDispatchApp: (appId: string) => boolean;
  shownAppId: string | null;
  stale: boolean;
}): ChatFirstAppRoutePlan {
  const { answer } = input;
  if (answer === "timeout") return { kind: "skip", reason: "timeout" };
  if (answer.status !== "ok") return { kind: "skip", reason: answer.status };
  if (answer.app === "none") return { kind: "skip", reason: "none" };
  const appId = input.installedApp(answer.app);
  if (!appId) return { kind: "skip", reason: "unknown_app" };
  if (input.isDispatchApp(appId)) return { kind: "skip", reason: "dispatch" };
  if (appId === input.shownAppId) return { kind: "skip", reason: "shown" };
  if (input.stale) return { kind: "skip", reason: "stale" };
  return { kind: "open", appId };
}

export type ChatFirstAppRouteRecord = {
  route: string;
  outcome: ChatFirstAppRouteAnswer["status"] | "timeout";
  plan: ChatFirstAppRoutePlan;
  latencyMs: number;
  hostedLatencyMs?: number;
  cached?: boolean;
};

/**
 * The tab layout a route answer must still find to act on. Any tab opened,
 * closed or switched since the send, by the agent or the person, changes it.
 */
export function chatFirstPaneSignature(snapshot: {
  tabs: ReadonlyArray<{ id: string }>;
  activeTabId: string | null;
}): string {
  return JSON.stringify([
    snapshot.activeTabId,
    snapshot.tabs.map((tab) => tab.id),
  ]);
}
