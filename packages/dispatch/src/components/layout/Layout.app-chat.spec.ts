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
