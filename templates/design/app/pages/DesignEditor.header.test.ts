import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("Design editor header", () => {
  const editorSource = readDesignEditorSource();

  it("only offers Add screen to editors", () => {
    expect(editorSource).toContain(
      "canEditDesign ? handleAddScreenAffordance : undefined",
    );
  });

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

  it("mounts the top bar from the shared visibility rule", () => {
    expect(editorSource).toContain("const topBarVisible = isTopBarVisible({");
    expect(editorSource).toMatch(/\{topBarVisible \? \(\s*<EditorTopBar/);
  });

  it("falls back to the rail row and toolbar tabs wherever the top bar is absent", () => {
    const railStart = editorSource.indexOf("export function renderRightRail(");
    const railEnd = editorSource.indexOf(
      "{minimalUi && !hostOwnsChrome ? (",
      railStart,
    );
    const rail = editorSource.slice(railStart, railEnd);
    // Docked rail: only the local-preview row. Every other shell keeps the
    // full action row (visual-edit route, embedded chrome, minimal UI).
    expect(rail).toMatch(/\{!topBarVisible \? \(\s*rightSidebarActions/);
    expect(rail).toContain("{localPreviewRow}");
    expect(editorSource).toContain("showModeTabs={!topBarVisible}");
    const minimalBarStart = editorSource.indexOf(
      'data-design-minimal-bar="right"',
    );
    expect(
      editorSource.slice(minimalBarStart, minimalBarStart + 400),
    ).toContain("{rightSidebarActions}");
  });

  it("puts the signed-out play control beside the presence slot", () => {
    expect(editorSource).toContain(
      "{sessionResolved && !isSignedIn ? publishWaitlistControl : null}",
    );
    expect(editorSource).toContain(
      "{!sessionResolved || isSignedIn ? publishWaitlistControl : null}",
    );
  });

  it("offers signed-out Localhost owners the account-gated live-canvas path", () => {
    const signedOutActionsStart = editorSource.indexOf(
      "export function renderSignedOutPersistenceActions(",
    );
    const signedOutActionsEnd = editorSource.indexOf(
      "\n}\n",
      signedOutActionsStart,
    );
    const signedOutActions = editorSource.slice(
      signedOutActionsStart,
      signedOutActionsEnd,
    );

    expect(editorSource).toContain(
      "...(hasLocalhostScreens &&\n      sessionResolved &&\n      (!isSignedIn || canEditDesign)",
    );
    expect(editorSource).toContain("content: isSignedIn ? (");
    expect(signedOutActions).toContain("{hasLocalhostScreens ? (");
    expect(signedOutActions).toContain("<PopoverTrigger asChild>");
    expect(signedOutActions).toContain('{t("designEditor.share")}');
    expect(signedOutActions).toContain('<PopoverContent align="end"');
    expect(signedOutActions).toContain("href={signInToShareHref}");
    expect(signedOutActions).toContain(
      '{t("designEditor.signUpToShareLiveCanvas")}',
    );
  });
});
