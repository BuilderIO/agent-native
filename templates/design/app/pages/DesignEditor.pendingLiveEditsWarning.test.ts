import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import enUSMessages from "../i18n/en-US";

describe("DesignEditor pending live edits", () => {
  it("keeps the Apply split button minimal", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const toolbarStart = source.indexOf(
      "data-design-pending-visual-style-toolbar",
    );
    const toolbar = source.slice(
      toolbarStart,
      source.indexOf("{viewMode ===", toolbarStart),
    );

    expect(toolbar).toContain(
      '"designEditor.pendingVisualStyles.applyDesignUpdates"',
    );
    expect(toolbar).not.toContain("sessionOnlyWarning");
    expect(toolbar).not.toContain("{pendingVisualEditCount}");
    // The primary button's classes moved into `cn()` so the split-button
    // rounding can drop when the host shell hides the chevron.
    expect(toolbar).toContain('"h-9 min-w-0');
    expect(toolbar).toContain('className="h-9 w-8');
    expect(toolbar).not.toContain("h-11");
    expect(toolbar).toContain("canApplyPendingVisualEditsWithAgent");
    expect(toolbar).toContain("handleCopyPendingVisualStylePrompt");
    expect(toolbar).toContain("canApplyPendingVisualEditsWithAgent ? null");

    expect(
      enUSMessages.designEditor.pendingVisualStyles.applyDesignUpdates,
    ).toBe("Apply design update");
  });

  it("clears the pending state after Apply and explicit discard", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    // The apply handler now lives in its own command module.
    const applyHandler = readFileSync(
      new URL(
        "./design-editor/commands/apply-pending-visual-styles-with-agent.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const discardHandler = source.slice(
      source.indexOf("const handleAbortPendingVisualStyles"),
      source.indexOf("const handleCopyPendingVisualStylePrompt"),
    );

    expect(applyHandler).toContain("clearPendingLiveEditState()");
    expect(discardHandler).toContain("clearPendingLiveEditState()");
  });

  it("keeps Escape in the preview menu from reaching editor hotkeys", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const menu = source.slice(
      source.indexOf("data-design-pending-visual-style-toolbar"),
      source.indexOf(
        "{viewMode ===",
        source.indexOf("data-design-pending-visual-style-toolbar"),
      ),
    );
    expect(menu).toContain("onEscapeKeyDown={(event) =>");
    expect(menu).toContain("event.stopPropagation()");
    expect(menu).toContain("onClick={handleAbortPendingVisualStyles}");
  });

  it("keeps signed-out visual-edit sessions on the copy-prompt handoff", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("data-design-public-agent-empty-state");
    expect(source).toContain("canApplyPendingVisualEditsWithAgent");
    expect(source).toContain(
      "isSignedIn || hostEmbeddedEditor || pageHasWebMcpHost()",
    );
    expect(source).toContain("handleCopyPendingVisualStylePrompt");
    expect(source).toContain("isVisualEditSurface &&");
  });

  it("publishes the handoff for agents that do not have the Design tab", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('callAction("publish-visual-edit-pending"');
    expect(source).toContain("pendingVisualStylePrompt");
  });

  it("gates the durable visual-edit handoff publish on canEditDesign so a public viewer never sees the handoff error", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const publishCallIndex = source.indexOf(
      'await callAction("publish-visual-edit-pending", pending);',
    );
    expect(publishCallIndex).toBeGreaterThan(-1);
    const effectStart = source.lastIndexOf(
      "useEffect(() => {",
      publishCallIndex,
    );
    expect(effectStart).toBeGreaterThan(-1);
    const depsStart = source.indexOf(".then(publish);", publishCallIndex);
    expect(depsStart).toBeGreaterThan(publishCallIndex);
    const depsEnd = source.indexOf("]);", depsStart);
    const effectBody = source.slice(effectStart, depsStart);
    const deps = source.slice(depsStart, depsEnd);
    // publish-visual-edit-pending requires editor access; a signed-out or
    // read-only viewer can never satisfy it, so auto-calling it for them
    // only produces a spurious "Could not create agent handoff" error. They
    // still get the pending prompt via the page-local Copy-prompt flow,
    // which reads pendingVisualEditCount directly.
    expect(effectBody).toContain("if (!canEditDesign) return;");
    expect(deps).toContain("canEditDesign,");
  });

  it("blocks per-frame Interact entry the same way runModeChange blocks it, but always allows leaving", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const handlerStart = source.indexOf(
      "const handleOverviewFrameAction = useCallback(",
    );
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = source.slice(
      handlerStart,
      source.indexOf("[t],", handlerStart),
    );
    // Leaving (re-clicking the already-interacting frame) is unconditional —
    // checked, and returned from, before the pending-edit guard below.
    const leaveIndex = handler.indexOf(
      "overviewInteractScreenIdRef.current === screenId",
    );
    const guardIndex = handler.indexOf(
      "pendingVisualStyleEditsRef.current.length > 0",
    );
    expect(leaveIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(leaveIndex);
    expect(handler).toContain("pendingLiveNonStyleEditsRef.current.length > 0");
    expect(handler).toContain(
      'toast.error(t("designEditor.pendingVisualStyles.interactBlocked"))',
    );
  });
});
