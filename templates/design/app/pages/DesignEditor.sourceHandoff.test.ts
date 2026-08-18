import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor pending source handoff", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const handler = source.slice(
    source.indexOf("const handleApplyPendingVisualStylesWithAgent"),
    source.indexOf("const handleAbortPendingVisualStyles"),
  );

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
    // A posted handoff is not an applied one, and the Apply control would
    // otherwise never go away.
    expect(handler).toContain("if (delivery.awaitingHostTurn) {");
    expect(handler).toContain("stagedSourceHandoffRef.current = true;");
    expect(handler).toContain("setApplyingViaHost(true);");
    const chatState = source.slice(
      source.indexOf('if (data.type === "design:chatState")'),
      source.indexOf("const focusDesignInspectorForSelection"),
    );
    expect(chatState).toContain(
      'if (stagedSourceHandoffRef.current && next === "idle")',
    );
    expect(chatState).toContain("clearPendingLiveEditStateRef.current();");
    expect(chatState.indexOf("reloadRunningAppPreviewFrames();")).toBeLessThan(
      chatState.indexOf("clearPendingLiveEditStateRef.current();"),
    );
  });

  it("offers only Apply in the host shell, and shows it working", () => {
    // The host runs the turn and owns the chat, so copying the prompt or
    // aborting into interact mode have nothing to act on there.
    const start = source.indexOf("data-design-pending-visual-style-toolbar");
    const toolbar = source.slice(
      start,
      source.indexOf('viewMode === "overview"', start),
    );
    expect(toolbar).not.toBe("");
    expect(toolbar).toContain("{shellMode ? null : (");
    expect(toolbar).toContain("<DropdownMenu>");
    expect(toolbar.indexOf("{shellMode ? null : (")).toBeLessThan(
      toolbar.indexOf("<DropdownMenu>"),
    );
    expect(toolbar).toContain(
      '"designEditor.pendingVisualStyles.applying"',
    );
    expect(toolbar).toContain("applyingViaHost ||");
    expect(toolbar).toContain("{applyingViaHost ? (");
  });

  it("drops the staged flag whenever pending edits are cleared", () => {
    // Otherwise a discarded preview leaves the flag armed and the next
    // unrelated host turn wipes edits made after it.
    const clearState = source.slice(
      source.indexOf("const clearPendingLiveEditState = useCallback"),
      source.indexOf("const clearPendingLiveEditStateRef"),
    );
    expect(clearState).toContain("stagedSourceHandoffRef.current = false;");
  });

  it("opens Design chat only for a local fallback and prevents duplicate sends", () => {
    expect(handler).toContain("pendingAgentHandoffBusyRef.current = true;");
    expect(handler).toContain("pendingAgentHandoffBusyRef.current = false;");
    expect(handler).toContain(
      'if (delivery.target === "local") setActiveLeftPanel("agent");',
    );
  });
});
