import { describe, expect, it } from "vitest";

import { ALL_TAB_ID } from "./inbox-threads";
import { resolveMailOpenPath } from "./mail-routes";

describe("Mail open paths", () => {
  it("opens the linked thread in its view", () => {
    expect(
      resolveMailOpenPath({
        view: "inbox",
        params: { threadId: "1a1167f0aa08b90a" },
      }),
    ).toBe("/inbox/1a1167f0aa08b90a");
    expect(
      resolveMailOpenPath({ view: "sent", params: { threadId: "t/1 2" } }),
    ).toBe("/sent/t%2F1%202");
  });

  it("opens a thread linked from a view without thread routes in the inbox", () => {
    expect(
      resolveMailOpenPath({ view: "settings", params: { threadId: "abc" } }),
    ).toBe("/inbox/abc");
    expect(resolveMailOpenPath({ params: { threadId: "abc" } })).toBe(
      "/inbox/abc",
    );
  });

  it("carries the queued draft, inbox tab, saved filter, and search", () => {
    expect(
      resolveMailOpenPath({
        view: "draft-queue",
        params: { queuedDraftId: "draft 1" },
      }),
    ).toBe("/draft-queue?id=draft%201");
    expect(
      resolveMailOpenPath({ view: "inbox", params: { tab: "important" } }),
    ).toBe("/inbox?tab=important");
    expect(
      resolveMailOpenPath({ view: "inbox", params: { tab: ALL_TAB_ID } }),
    ).toBe(`/inbox?tab=${ALL_TAB_ID}`);
    expect(
      resolveMailOpenPath({ view: "inbox", params: { filter: "vip & co" } }),
    ).toBe("/inbox?filter=vip%20%26%20co");
    expect(
      resolveMailOpenPath({ view: "all", params: { q: "from:alice" } }),
    ).toBe("/all?q=from%3Aalice");
  });

  it("leaves links without a record to the open route's /<view> fallback", () => {
    expect(resolveMailOpenPath({ view: "scheduled", params: {} })).toBeNull();
    expect(
      resolveMailOpenPath({ view: "sent", params: { messageId: "m1" } }),
    ).toBeNull();
    expect(resolveMailOpenPath({ view: "draft-queue", params: {} })).toBeNull();
  });
});
