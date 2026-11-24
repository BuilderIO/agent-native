export type ChatFirstAppRouteAnswer =
  | {
      status: "ok";
      app: string;
      confidence?: number;
      explicit?: true;
      /** Until app screen bindings are discoverable, only the registered home is routable. */
      screen?: "home";
      params?: Record<string, string>;
      cached?: boolean;
      latencyMs?: number;
      model?: string;
      /** A saved pointer matched: open this object, even in the shown app. */
      pointer?: boolean;
      objectId?: string;
      url?: string;
    }
  | { status: "not_configured" | "failed"; reason: string; latencyMs?: number };

export type ChatFirstAppRouteSkip =
  | "none"
  | "low_confidence"
  | "not_configured"
  | "failed"
  | "timeout"
  | "unknown_app"
  | "dispatch"
  | "shown"
  | "stale";

export type ChatFirstAppRoutePlan<Target = { appId: string }> =
  | { kind: "open" | "warm"; target: Target }
  | { kind: "skip"; reason: ChatFirstAppRouteSkip };

/**
 * Warm a likely installed app while the pane still matches the send. Only
 * an explicit choice can commit a visible pane before the tool handoff.
 */
export function planChatFirstAppRoute<Target extends { appId: string }>(input: {
  answer: ChatFirstAppRouteAnswer | "timeout";
  installedApp: (
    app: string,
    object?: { url?: string | undefined; objectId?: string | undefined },
  ) => Target | null;
  isDispatchApp: (appId: string) => boolean;
  shownAppId: string | null;
  stale: boolean;
}): ChatFirstAppRoutePlan {
  const { answer } = input;
  if (answer === "timeout") return { kind: "skip", reason: "timeout" };
  if (answer.status !== "ok") return { kind: "skip", reason: answer.status };
  if (
    typeof answer.confidence !== "number" ||
    !Number.isFinite(answer.confidence) ||
    answer.confidence < 0.85 ||
    answer.confidence > 1
  )
    return { kind: "skip", reason: "low_confidence" };
  if (answer.app === "none") return { kind: "skip", reason: "none" };
  const object = answer.pointer
    ? { url: answer.url, objectId: answer.objectId }
    : undefined;
  const target = input.installedApp(answer.app, object);
  if (!target) return { kind: "skip", reason: "unknown_app" };
  if (input.isDispatchApp(target.appId)) {
    return { kind: "skip", reason: "dispatch" };
  }
  if (
    target.appId === input.shownAppId &&
    !(answer.pointer && (answer.url || answer.objectId))
  ) {
    return { kind: "skip", reason: "shown" };
  }
  if (input.stale) return { kind: "skip", reason: "stale" };
  return { kind: answer.explicit === true ? "open" : "warm", target };
}

export type ChatFirstAppRouteRecord = {
  route: string;
  outcome: ChatFirstAppRouteAnswer["status"] | "timeout";
  plan: ChatFirstAppRoutePlan<unknown>;
  latencyMs: number;
  hostedLatencyMs?: number;
  cached?: boolean;
};

/**
 * The tab layout a route answer must still find to act on. Any tab opened,
 * closed or switched since the send, by the agent or the person, changes it.
 */
export function chatFirstPaneSignature(snapshot: {
  tabs: ReadonlyArray<{ id: string; path?: string; view?: string }>;
  activeTabId: string | null;
}): string {
  return JSON.stringify([
    snapshot.activeTabId,
    snapshot.tabs.map((tab) => [tab.id, tab.path, tab.view]),
  ]);
}
