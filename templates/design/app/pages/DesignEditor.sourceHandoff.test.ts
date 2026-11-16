import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { handleHostChatState } from "./design-editor/host-chat-state";
import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("DesignEditor pending source handoff", () => {
  const source = readDesignEditorSource();
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
    const hostChatGeneratingRef = { current: false };
    const stagedSourceHandoffRef = {
      current: "awaiting-start" as "awaiting-start" | "running" | "idle",
    };
    const started = vi.fn();
    const stagedHandoffStartedRef = {
      current: started as (() => void) | undefined,
    };
    const setApplyingViaHost = vi.fn();
    const reloadRunningAppPreviewFrames = vi.fn();

    handleHostChatState({
      next: "generating",
      hostChatGeneratingRef,
      stagedSourceHandoffRef,
      stagedHandoffStartedRef,
      clearStartTimer: vi.fn(),
      setApplyingViaHost,
      reloadRunningAppPreviewFrames,
    });
    expect(started).toHaveBeenCalledOnce();
    expect(stagedHandoffStartedRef.current).toBeUndefined();
    expect(stagedSourceHandoffRef.current).toBe("running");
    expect(hostChatGeneratingRef.current).toBe(true);
    expect(setApplyingViaHost).not.toHaveBeenCalled();

    handleHostChatState({
      next: "idle",
      hostChatGeneratingRef,
      stagedSourceHandoffRef,
      stagedHandoffStartedRef,
      clearStartTimer: vi.fn(),
      setApplyingViaHost,
      reloadRunningAppPreviewFrames,
    });

    expect(setApplyingViaHost).toHaveBeenCalledWith(false);
    expect(reloadRunningAppPreviewFrames).toHaveBeenCalledOnce();
    expect(stagedSourceHandoffRef.current).toBe("idle");
    expect(hostChatGeneratingRef.current).toBe(false);
  });

  it("keeps visual-edit handoffs on the copy-prompt path when signed in", () => {
    const start = source.indexOf("data-design-pending-visual-style-toolbar");
    const toolbar = source.slice(
      start,
      source.indexOf('viewMode === "overview"', start),
    );
    expect(toolbar).not.toBe("");
    expect(source).toMatch(
      /const canApplyPendingVisualEditsFromToolbar =\s*canApplyPendingVisualEditsWithAgent &&\s*\(!isVisualEditSurface \|\| hostEmbeddedEditor\);/,
    );
    expect(toolbar).toContain("canApplyPendingVisualEditsFromToolbar");
    expect(toolbar).toContain("handleApplyPendingVisualStylesWithAgent");
    expect(toolbar).toContain("handleCopyPendingVisualStylePrompt");
    expect(toolbar).toContain(
      "canApplyPendingVisualEditsFromToolbar ? null : (",
    );
    expect(toolbar).toContain("<DropdownMenu>");
    expect(toolbar).toContain(
      '"designEditor.pendingVisualStyles.copyAgentPrompt"',
    );
    expect(toolbar).toContain('"designEditor.pendingVisualStyles.copyPrompt"');
    expect(toolbar).toContain(
      '"designEditor.pendingVisualStyles.copyFullPrompt"',
    );
    expect(toolbar).toContain('"designEditor.pendingVisualStyles.applying"');
    expect(toolbar).toContain("applyingViaHost ||");
    expect(toolbar).toContain("{applyingViaHost ? (");
  });

  it("waits for queued handoff publication before copying the full prompt by default", () => {
    const copyHandler = source.slice(
      source.indexOf("const handleCopyPendingVisualStylePrompt = useCallback"),
      source.indexOf(
        "// ── Export:",
        source.indexOf(
          "const handleCopyPendingVisualStylePrompt = useCallback",
        ),
      ),
    );
    expect(copyHandler).toContain("fullPrompt = true");
    expect(copyHandler).toContain(
      "await pendingVisualEditPublicationQueueRef.current",
    );
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
      source.indexOf(
        'useEffect(() => {\n    if (viewMode === "overview" && !motionDockOpen) return;',
      ),
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

  it("opens Design chat only for a local fallback and prevents duplicate sends", () => {
    expect(handler).toContain("pendingAgentHandoffBusyRef.current = true;");
    expect(handler).toContain("pendingAgentHandoffBusyRef.current = false;");
    expect(handler).toContain(
      'if (delivery.target === "local") setActiveLeftPanel("agent");',
    );
  });
});
