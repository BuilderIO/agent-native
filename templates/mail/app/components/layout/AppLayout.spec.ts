import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { labelTabHref } from "./AppLayout";

function appLayoutSource(): string {
  return readFileSync(new URL("./AppLayout.tsx", import.meta.url), "utf8");
}

describe("AppLayout inbox rail count", () => {
  it("uses the mailbox-wide unread count instead of the loaded page", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'const inboxSidebarUnreadCount = getInboxCount("unread");',
    );
    expect(source).not.toContain(
      'const inboxSidebarUnreadCount =\n    labelThreadCounts.unread["__inboxTotal"]',
    );
  });

  it("collapses the native rail while the per-app chat is open", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'import { usePerAppChatOpen } from "@agent-native/core/client/hooks";',
    );
    expect(source).toContain(
      "(sidebarPinned ? sidebarCollapsed : perAppChatOpen)",
    );
  });
});

describe("labelTabHref", () => {
  it("routes a nested user label to the unscoped all-mail view, not the inbox tab", () => {
    // Repro: Jason Yang's "2-Tasks/Jira" label carries mail that's filed out
    // of the inbox. Routing through /inbox forces `in:inbox` server-side
    // (gmail-query.ts) and the label reads as empty even though it has mail.
    expect(labelTabHref("2-tasks/jira")).toBe("/all?label=2-tasks%2Fjira");
  });

  it("keeps Gmail's inbox-only categories pinned to the inbox view", () => {
    // "important" (and the other category labels) only ever exist inside the
    // inbox, so they keep the client-slice-of-inbox behavior on purpose.
    expect(labelTabHref("important")).toBe("/inbox?label=important");
    expect(labelTabHref("updates")).toBe("/inbox?label=updates");
  });
});
