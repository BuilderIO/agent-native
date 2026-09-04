import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function appLayoutSource(): string {
  return readFileSync(new URL("./AppLayout.tsx", import.meta.url), "utf8");
}

describe("Calendar app navigation", () => {
  it("lets the calendar page own the /home toolbar", () => {
    const source = appLayoutSource();

    expect(source).toContain('pathname === "/" || pathname === "/home"');
  });

  it("uses per-app chat state for the native sidebar collapsedness", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'import { usePerAppChatOpen } from "@agent-native/core/client/hooks";',
    );
    expect(source).toContain(
      "collapsed={\n                !isMobile &&\n                (perAppChatOpen",
    );
  });

  it("keeps the native sidebar toggleable while per-app chat is open", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "const [sidebarExpandedWhileChatOpen, setSidebarExpandedWhileChatOpen] =",
    );
    expect(source).toContain(
      "(perAppChatOpen\n                  ? !sidebarExpandedWhileChatOpen\n                  : sidebarCollapsed)",
    );
    expect(source).toContain(
      "if (perAppChatOpen) {\n                        setSidebarExpandedWhileChatOpen(!nextCollapsed);\n                        return;\n                      }\n                      setSidebarCollapsed(nextCollapsed)",
    );
    expect(source).toContain("setSidebarExpandedWhileChatOpen(!nextCollapsed)");
  });
});
