import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Dispatch workspace app chat rail", () => {
  it("owns the iframe chat toggle and persists app-specific threads", () => {
    const source = readFileSync(
      new URL("./Layout.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('openStorageKey="dispatch-app-chat"');
    expect(source).toContain(
      "storageKey={`dispatch-app-chat:${workspaceAppId}`}",
    );
    expect(source).toContain("data-dispatch-workspace-app-frame");
    expect(source).toContain(
      'window.dispatchEvent(new Event("agent-panel:toggle"))',
    );
  });
});
