import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
});
