import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor pending source handoff", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const agentHandoffSource = readFileSync(
    "app/pages/design-editor/commands/apply-pending-visual-styles-with-agent.ts",
    "utf8",
  );
  const handler = agentHandoffSource;

  it("waits for acknowledged host-or-local delivery before clearing previews", () => {
    expect(
      handler.match(/await sendDesignSourceHandoffAndConfirm/g),
    ).toHaveLength(2);
    expect(handler).toContain("if (!delivery.delivered)");
    expect(handler.indexOf("if (!delivery.delivered)")).toBeLessThan(
      handler.indexOf("finalizeWithoutStructureVerification();"),
    );
    expect(handler).toContain(
      't("designEditor.pendingVisualStyles.agentHandoffFailedToast")',
    );
  });

  it("resolves the handoff when the host's turn settles, not when it is posted", () => {
    expect(handler).toContain("if (delivery.awaitingHostTurn) {");
    expect(handler).toContain(
      'stagedSourceHandoffRef.current = "awaiting-start";',
    );
    expect(handler).toContain("setApplyingViaHost(true);");
    expect(handler).toContain("HOST_TURN_START_TIMEOUT_MS");
    const chatState = source.slice(
      source.indexOf('if (data.type === "design:chatState")'),
      source.indexOf("const focusDesignInspectorForSelection"),
    );
    expect(chatState).toContain('stagedSourceHandoffRef.current = "running";');
    expect(chatState).toContain(
      'if (stagedSourceHandoffRef.current === "running")',
    );
    expect(chatState).toContain("clearPendingLiveEditStateRef.current();");
    expect(chatState.indexOf("reloadRunningAppPreviewFrames();")).toBeLessThan(
      chatState.indexOf("clearPendingLiveEditStateRef.current();"),
    );
    expect(chatState.indexOf("setApplyingViaHost(false);")).toBeLessThan(
      chatState.indexOf('if (next === "idle")'),
    );
  });

  it("routes pending edits to the host agent or the copy-prompt menu", () => {
    const start = source.indexOf("data-design-pending-visual-style-toolbar");
    const toolbar = source.slice(
      start,
      source.indexOf('viewMode === "overview"', start),
    );
    expect(toolbar).not.toBe("");
    expect(toolbar).toContain("canApplyPendingVisualEditsWithAgent");
    expect(toolbar).toContain("handleApplyPendingVisualStylesWithAgent");
    expect(toolbar).toContain("handleCopyPendingVisualStylePrompt");
    expect(toolbar).toContain("canApplyPendingVisualEditsWithAgent ? null : (");
    expect(toolbar).toContain("<DropdownMenu>");
    expect(toolbar).toContain('"designEditor.pendingVisualStyles.copyPrompt"');
    expect(toolbar).toContain(
      '"designEditor.pendingVisualStyles.copyFullPrompt"',
    );
    expect(toolbar).toContain('"designEditor.pendingVisualStyles.applying"');
    expect(toolbar).toContain("applyingViaHost ||");
    expect(toolbar).toContain("{applyingViaHost ? (");
  });

  it("refreshes the copied handoff when the current design changes", () => {
    const copyHandler = source.slice(
      source.indexOf("const handleCopyPendingVisualStylePrompt = useCallback"),
      source.indexOf(
        "// ── Export:",
        source.indexOf(
          "const handleCopyPendingVisualStylePrompt = useCallback",
        ),
      ),
    );
    expect(copyHandler).toContain("          id,");
  });

  it("drops the staged flag whenever pending edits are cleared", () => {
    const clearState = source.slice(
      source.indexOf("const clearPendingLiveEditState = useCallback"),
      source.indexOf("const clearPendingLiveEditStateRef"),
    );
    expect(clearState).toContain('stagedSourceHandoffRef.current = "idle";');
    expect(clearState).toContain("setApplyingViaHost(false);");
  });

  it("clears the open ledger only after the current MCP revision is acknowledged", () => {
    expect(source).toContain('"get-visual-edit-pending"');
    expect(source).toContain("refetchIntervalInBackground: false");
    const acknowledgementEffect = source.slice(
      source.indexOf("const localPendingCount"),
      source.indexOf("const visualEditPromptResult"),
    );
    expect(acknowledgementEffect).toContain(
      "isVisualEditHandoffAcknowledged({",
    );
    expect(acknowledgementEffect).toContain(
      "clearPendingLiveEditStateRef.current();",
    );
  });

  it("keeps signed-out copy flow quiet while preserving editor MCP publication", () => {
    const handoffQuery = source.slice(
      source.indexOf('"get-visual-edit-pending"'),
      source.indexOf(
        "useEffect(() => {",
        source.indexOf('"get-visual-edit-pending"'),
      ),
    );
    expect(handoffQuery).toContain(
      "enabled: canEditDesign && Boolean(id) && !shellMode",
    );

    expect(source).toContain("shouldPublishVisualEditPending({");
    expect(source).toContain("canEditDesign,");
    expect(source).toContain(
      "canEditLiveScreen: canEditLiveScreen(activeOverviewScreen?.id)",
    );
    expect(source).toContain("runPublishVisualEditPending({");
    expect(source).toContain("activeScreenBridgeUrl,");
  });

  it("routes interaction-state edits through the selected screen", () => {
    const screenStyleHandler = source.slice(
      source.indexOf("const handleInspectorScreenStyleChange = useCallback"),
      source.indexOf(
        "selectedScreenStyleChangeRef.current = handleInspectorScreenStyleChange",
      ),
    );
    expect(screenStyleHandler).toContain("if (interactionState)");
    expect(screenStyleHandler).toContain(
      "sendLinkedScreenPreviewInteractionStateStyle(screenId",
    );
    expect(screenStyleHandler).toContain("recordPendingVisualStyleEdit(");
    expect(screenStyleHandler).toContain("screenId,");
    expect(screenStyleHandler).toContain("applyInteractionStateStyleCommit(");
  });

  it("opens Design chat only for a local fallback and prevents duplicate sends", () => {
    expect(handler).toContain("pendingAgentHandoffBusyRef.current = true;");
    expect(handler).toContain("pendingAgentHandoffBusyRef.current = false;");
    expect(handler).toContain(
      'if (delivery.target === "local") setActiveLeftPanel("agent");',
    );
  });
});
