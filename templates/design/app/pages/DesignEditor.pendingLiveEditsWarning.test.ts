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
    expect(toolbar).toContain('"min-w-0 shrink-0 cursor-pointer');
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
    expect(source).toContain("runPublishVisualEditPending({");
    expect(source).toContain("pendingVisualStylePrompt");
  });

  it("only publishes the durable handoff from an editor session", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const publishCallIndex = source.indexOf("runPublishVisualEditPending({");
    expect(publishCallIndex).toBeGreaterThan(-1);
    const depsStart = source.indexOf(".then(publish);", publishCallIndex);
    expect(depsStart).toBeGreaterThan(publishCallIndex);
    const depsEnd = source.indexOf("]);", depsStart);
    const publishCall = source.slice(publishCallIndex, depsStart);
    const deps = source.slice(depsStart, depsEnd);
    // Public viewers can copy the prompt, but only editor-capable sessions
    // may publish it for an MCP client without the Design tab.
    expect(publishCall).toContain("canPublishDurableHandoff: canEditDesign,");
    expect(deps).toContain("canEditDesign,");
    expect(deps).not.toContain("isLiveCanvasShareLink,");
  });

  it("uses the shared guard for frame entry and close path for re-clicking the focused screen", () => {
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
      source.indexOf("// Escape is the standard", handlerStart),
    );
    const focusedFrameIndex = handler.indexOf(
      "overviewInteractScreenIdRef.current === screenId",
    );
    const closeIndex = handler.indexOf("handleExitResponsiveInteract();");
    const enterIndex = handler.indexOf(
      'handleModeChange("interact", { targetFileId: screenId })',
    );
    expect(focusedFrameIndex).toBeGreaterThan(-1);
    expect(closeIndex).toBeGreaterThan(focusedFrameIndex);
    expect(enterIndex).toBeGreaterThan(closeIndex);

    const modeChangeStart = source.indexOf(
      "const handleModeChange = useCallback(",
    );
    const modeChangeEnd = source.indexOf("\n  );", modeChangeStart);
    expect(modeChangeStart).toBeGreaterThan(-1);
    expect(modeChangeEnd).toBeGreaterThan(modeChangeStart);
    const modeChange = source.slice(modeChangeStart, modeChangeEnd);
    expect(modeChange).toContain("hasPendingVisualEdits:");
    expect(modeChange).toContain("pendingVisualStyleEdits.length > 0");
    expect(modeChange).toContain("pendingLiveNonStyleEdits.length > 0");
    expect(modeChange).toContain("remoteVisualEditPending");
    expect(modeChange).not.toContain('designAccessRole !== "owner"');
    expect(source).toContain("const showVisualEditApply =");
    expect(source).toMatch(
      /const showVisualEditApply =[\s\S]{0,180}pendingVisualEditRecoveryVisible;/,
    );
  });

  it("shows the existing recovery toolbar whenever the Interact guard blocks", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /onPendingVisualEditsBlocked: \(\) =>\s+setPendingVisualEditRecoveryVisible\(true\)/,
    );
    expect(source).toMatch(
      /const showVisualEditApply =[\s\S]{0,180}pendingVisualEditRecoveryVisible;/,
    );
    const toolbarStart = source.indexOf(
      "data-design-pending-visual-style-toolbar",
    );
    const toolbarEnd = source.indexOf("{viewMode ===", toolbarStart);
    const toolbar = source.slice(toolbarStart, toolbarEnd);
    expect(toolbar).toContain("handleApplyPendingVisualStylesWithAgent");
    expect(toolbar).toContain("handleCopyPendingVisualStylePrompt");
    expect(toolbar).toContain("handleAbortPendingVisualStyles");
  });
});
