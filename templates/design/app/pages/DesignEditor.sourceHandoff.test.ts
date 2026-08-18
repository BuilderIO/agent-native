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

  it("resolves a staged handoff when the host's turn settles, not when it is prefilled", () => {
    // The host only fills its composer, so nothing clears the pending edits at
    // handoff time and the Apply control would otherwise never go away.
    expect(handler).toContain(
      "if (delivery.staged) stagedSourceHandoffRef.current = true;",
    );
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
