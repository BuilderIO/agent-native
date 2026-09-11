import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor version history", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const rootSource = readFileSync("app/root.tsx", "utf8");
  const eventsSource = readFileSync("app/lib/design-ui-events.ts", "utf8");

  it("exposes version history from the project menu", () => {
    expect(editorSource).toContain('{"Version history" /* i18n-ignore */}');
    expect(editorSource).toContain("setHistoryOpen(true)");
    expect(editorSource).toContain("IconHistory");
    expect(editorSource).toContain("<HistoryPanel");
  });

  it("opens history from Cmd+K through a window event", () => {
    expect(eventsSource).toContain(
      'DESIGN_HISTORY_OPEN_EVENT = "agent-native:open-design-history"',
    );
    expect(eventsSource).toContain("requestDesignHistoryOpen");
    expect(rootSource).toContain("requestDesignHistoryOpen");
    expect(rootSource).toContain("IconHistory");
    expect(editorSource).toContain("DESIGN_HISTORY_OPEN_EVENT");
  });
});
