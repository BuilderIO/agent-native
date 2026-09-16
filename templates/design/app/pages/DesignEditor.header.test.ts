import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design editor header", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");

  it("keeps the title without rendering the review status chip", () => {
    expect(editorSource).toContain("{projectTitleControl}");
    expect(editorSource).not.toContain("ReviewStatusControl");
    expect(editorSource).not.toContain("status={reviewStatus}");
  });

  it("routes board review threads and uses unread roots for the comments badge", () => {
    expect(editorSource).toContain("const boardTarget = targetId === null");
    expect(editorSource).toContain(
      "setActiveFileId(boardTarget ? (boardFileId ?? null) : targetId)",
    );
    expect(editorSource).toContain("reviewCommentsCount: reviewUnreadCount");
  });

  it("keeps the shared chat header and tabs on the scoped agent surface", () => {
    const panelStart = editorSource.indexOf("data-design-agent-panel");
    const surfaceStart = editorSource.indexOf("<AgentChatSurface", panelStart);
    const surfaceEnd = editorSource.indexOf("/>", surfaceStart);
    const surface = editorSource.slice(surfaceStart, surfaceEnd);

    expect(surface).toContain("storageKey={DESIGN_CHAT_STORAGE_KEY}");
    expect(surface).toContain("scope={designChatScope}");
    expect(surface).toContain("chatHistory={designChatHistory}");
    expect(surface).toContain("isolateHistoryByScope={true}");
    expect(surface).toContain("showHeader={true}");
    expect(surface).toContain("showTabBar={true}");
    expect(surface).toContain("chatOnly={true}");
    expect(surface).toContain("onCollapse={() => setActiveLeftPanel(null)}");
    expect(surface).toContain("min-w-0");
  });
});
