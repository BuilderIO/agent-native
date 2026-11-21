import { describe, expect, it } from "vitest";

import { planChatFirstAppRoute } from "./chat-first-app-route.js";

const base = {
  installedApp: (app: string, object?: { url?: string }) => ({
    appId: app,
    ...(object?.url ? { url: object.url } : {}),
  }),
  isDispatchApp: (id: string) => id === "dispatch",
  stale: false,
};

describe("planChatFirstAppRoute pointers", () => {
  it("does not open an uncertain route", () => {
    expect(
      planChatFirstAppRoute({
        ...base,
        shownAppId: null,
        answer: { status: "ok", app: "tasks-2", confidence: 0.7 },
      }),
    ).toEqual({ kind: "skip", reason: "low_confidence" });
  });

  it("passes a pointer's object to the target", () => {
    expect(
      planChatFirstAppRoute({
        ...base,
        shownAppId: null,
        answer: {
          status: "ok",
          app: "content",
          confidence: 1,
          pointer: true,
          url: "https://x/y",
        },
      }),
    ).toEqual({
      kind: "warm",
      target: { appId: "content", url: "https://x/y" },
    });
  });

  it("opens a pointer's object even when its app is already shown", () => {
    const answer = {
      status: "ok" as const,
      app: "content",
      confidence: 1,
      pointer: true,
      explicit: true as const,
      url: "https://x/y",
    };
    expect(
      planChatFirstAppRoute({ ...base, shownAppId: "content", answer }).kind,
    ).toBe("open");
    expect(
      planChatFirstAppRoute({
        ...base,
        shownAppId: "content",
        answer: { status: "ok", app: "content", confidence: 1 },
      }),
    ).toEqual({ kind: "skip", reason: "shown" });
  });
});
