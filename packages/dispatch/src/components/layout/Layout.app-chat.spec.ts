import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(
  new URL("./Layout.tsx", import.meta.url),
  "utf8",
);
const railSource = readFileSync(
  new URL("../workspace-app-host.tsx", import.meta.url),
  "utf8",
);

describe("Dispatch layout scrolling", () => {
  it("keeps page scrolling inside the viewport with a sticky chat control", () => {
    expect(layoutSource).toMatch(/<main\s+className=\{cn\(\s*"min-h-0 flex-1"/);
    expect(layoutSource).toContain(
      'className="pointer-events-none sticky top-0',
    );
    expect(layoutSource).toContain(
      "<RunsTray limit={8} onOpenThread={openRunThread} />",
    );
    expect(layoutSource).toContain("<AgentToggleButton");
    expect(layoutSource).toContain("useHeaderTitle");
    expect(layoutSource).toContain("useHeaderActions");
    expect(layoutSource).not.toContain("showHeader ? <Header onOpenMobile");
  });
});

describe("Dispatch workspace app chat rail", () => {
  it("routes the open-app rail through the shared app-chat component", () => {
    // Both app surfaces must share one rail: a second inlined AgentSidebar is
    // how one of them silently keeps talking to Dispatch's own agent.
    expect(layoutSource).toContain("<WorkspaceAppChatRail");
    expect(layoutSource).toContain("data-dispatch-workspace-app-frame");
    expect(layoutSource).toContain(
      'window.dispatchEvent(new Event("agent-panel:toggle"))',
    );
    expect(layoutSource).not.toContain('openStorageKey="dispatch-app-chat"');
  });

  it("persists app-specific threads and points the rail at the app's own agent", () => {
    expect(railSource).toContain('openStorageKey="dispatch-app-chat"');
    expect(railSource).toContain("storageKey={`dispatch-app-chat:${appId}`}");
    expect(railSource).toContain("apiUrl={appChat.apiUrl}");
  });
});
