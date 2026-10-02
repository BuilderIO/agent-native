import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design editor header", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");

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

  it("offers signed-out Localhost owners the account-gated live-canvas path", () => {
    const signedOutActionsStart = editorSource.indexOf(
      "const signedOutPersistenceActions = (",
    );
    const signedOutActionsEnd = editorSource.indexOf(
      "const rightToolbarCompact =",
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
