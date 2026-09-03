import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor pending source handoff", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const agentHandoffSource = readFileSync(
    "app/pages/design-editor/commands/apply-pending-visual-styles-with-agent.ts",
    "utf8",
  );
  // The extracted command module is exactly the handler body.
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
    // A posted handoff is not an applied one, and the Apply control would
    // otherwise never go away.
    expect(handler).toContain("if (delivery.awaitingHostTurn) {");
    expect(handler).toContain(
      'stagedSourceHandoffRef.current = "awaiting-start";',
    );
    expect(handler).toContain("setApplyingViaHost(true);");
    // A posted handoff is not an acknowledged one.
    expect(handler).toContain("HOST_TURN_START_TIMEOUT_MS");
    const chatState = source.slice(
      source.indexOf('if (data.type === "design:chatState")'),
      source.indexOf("const focusDesignInspectorForSelection"),
    );
    // Only a turn we watched start counts: a turn already generating when Apply
    // was clicked would otherwise settle and be read as ours.
    expect(chatState).toContain('stagedSourceHandoffRef.current = "running";');
    expect(chatState).toContain(
      'if (stagedSourceHandoffRef.current === "running")',
    );
    expect(chatState).toContain("clearPendingLiveEditStateRef.current();");
    expect(chatState.indexOf("reloadRunningAppPreviewFrames();")).toBeLessThan(
      chatState.indexOf("clearPendingLiveEditStateRef.current();"),
    );
    // Released on failure as well, or the shell's only control stays disabled.
    expect(chatState.indexOf("setApplyingViaHost(false);")).toBeLessThan(
      chatState.indexOf('if (next === "idle")'),
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
    expect(toolbar).toContain('"designEditor.pendingVisualStyles.applying"');
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
    expect(clearState).toContain('stagedSourceHandoffRef.current = "idle";');
    expect(clearState).toContain("setApplyingViaHost(false);");
  });

  it("opens Design chat only for a local fallback and prevents duplicate sends", () => {
    expect(handler).toContain("pendingAgentHandoffBusyRef.current = true;");
    expect(handler).toContain("pendingAgentHandoffBusyRef.current = false;");
    expect(handler).toContain(
      'if (delivery.target === "local") setActiveLeftPanel("agent");',
    );
  });
});
