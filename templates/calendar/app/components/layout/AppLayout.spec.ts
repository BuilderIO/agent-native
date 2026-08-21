import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function appLayoutSource(): string {
  return readFileSync(new URL("./AppLayout.tsx", import.meta.url), "utf8");
}

describe("Calendar app navigation", () => {
  it("collapses the native sidebar while the per-app chat is open", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'import { usePerAppChatOpen } from "@agent-native/core/client/hooks";',
    );
    expect(source).toContain(
      "collapsed={!isMobile && (sidebarCollapsed || perAppChatOpen)}",
    );
  });
});
