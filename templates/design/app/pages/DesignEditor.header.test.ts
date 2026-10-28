import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("Design editor header", () => {
  const editorSource = readDesignEditorSource();

  it("keeps the shared chat header and tabs on the scoped agent surface", () => {
    const panelStart = editorSource.indexOf("data-design-agent-panel");
    const surfaceStart = editorSource.indexOf(
      "<MemoAgentChatSurface",
      panelStart,
    );
    const surfaceEnd = editorSource.indexOf("/>", surfaceStart);
    const surface = editorSource.slice(surfaceStart, surfaceEnd);

    expect(surface).toContain("storageKey={DESIGN_CHAT_STORAGE_KEY}");
    expect(surface).toContain("scope={designChatScope}");
    expect(surface).toContain("chatHistory={designChatHistory}");
    expect(surface).toContain("isolateHistoryByScope={true}");
    expect(surface).toContain("showHeader={true}");
    expect(surface).toContain("showTabBar={true}");
    expect(surface).toContain("chatOnly={true}");
    expect(surface).toContain("onCollapse={collapseLeftPanel}");
    expect(surface).toContain("min-w-0");
  });
});
