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

  it("uses the whole-Inbox local count for the Inbox tab", () => {
    const source = appLayoutSource();

    expect(source).toContain('const localCount = localCounts["__inboxTotal"]');
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

  it("keeps the explicit Other inbox tab and search restoration path", () => {
    const source = appLayoutSource();

    expect(source).toContain("href: `/inbox?tab=${OTHER_INBOX_TAB_PARAM}`");
    expect(source).toContain("id: OTHER_INBOX_TAB_ID");
    expect(source).toContain('params.set("tab", tab)');
  });

  it("builds pin mutations from the resolved visible pins", () => {
    const source = appLayoutSource();

    expect(source).toContain("const current = pinnedLabels;");
    expect(source).toContain("[pinnedLabels, updateSettings],");
  });

  it("keeps pinned tab dragging aligned with the displayed pin order", () => {
    const source = appLayoutSource();

    expect(source).toContain("const canDrag = !!tab.pinnedId;");
    expect(source).toContain(
      "const current = pinnedLabels;\n    if (!current.includes(dragPinnedId)) return;",
    );
  });

  it("keeps exclusive tab badges local and mirrors primary tabs on mobile", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "const inboxPartitionTabIds = new Set<string>([OTHER_INBOX_TAB_ID]);",
    );
    expect(source).toContain(
      "if (inboxPartitionTabIds.has(viewId)) return localCount;",
    );
    expect(source).toContain("const mobileInboxTabs = visibleTabs.filter(");
    expect(source).toContain("{mobileInboxTabs.map((tab) => {");
  });

  it("does not let loaded pages inflate server-backed label badges", () => {
    const source = appLayoutSource();

    expect(source).not.toContain("Math.max(serverCount, localCount)");
    expect(source).toContain(
      'typeof serverCount === "number" && useServerLabelCounts',
    );
  });

  it("preserves labels and exposes a retry when Gmail label reads fail", () => {
    const source = appLayoutSource();

    expect(source).toContain("data: labelsData");
    expect(source).toContain("isError: labelsError");
    expect(source).toContain("refetch: refetchLabels");
    expect(source).toContain('role="alert"');
  });

  // Repro: with no Google account connected, `view` for an unmatched URL
  // (e.g. /this-route-should-not-exist-xyz) was still "not settings" and
  // "not draft-queue", so the no-accounts takeover replaced `{children}` —
  // the routed NotFound page — with the Google-connect banner instead. The
  // page's <title> was correct (computed separately in $view.tsx's meta())
  // while the rendered body silently became the inbox shell.
  it("only shows the Google-connect takeover for a known mail view", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'import { isKnownMailView } from "@/routes/$view";',
    );
    expect(source).toContain(
      "isKnownMailView(view) &&\n          (googleConfigured || canOfferGoogleOAuthSetup) ? (\n            <GoogleConnectBanner",
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
