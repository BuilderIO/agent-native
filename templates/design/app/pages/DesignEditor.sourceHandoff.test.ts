import { describe, expect, it, vi } from "vitest";

import { handleHostChatState } from "./design-editor/host-chat-state";

// oracle-change: removed DesignEditor and handoff handler source greps; the handleHostChatState cases remain
// oracle-change(templates/design/app/pages/DesignEditor.emptyDesign.test.ts): DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.header.test.ts): DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.keyboard-shortcuts.test.ts): DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.linkedBreakpointUndo.spec.ts): linked-screen-preview.test.ts owns the fan-out; the rest was source greps
// oracle-change(templates/design/app/pages/DesignEditor.livePrimitiveCreation.spec.ts): command and DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.liveScreenLayerDrop.spec.ts): layer-move-to-screen and DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.liveSnapshotUndoSync.spec.ts): asserted local fake functions, not production code
// oracle-change(templates/design/app/pages/DesignEditor.liveStyleCommit.spec.ts): commit-visual-styles source greps only
// oracle-change(templates/design/app/pages/DesignEditor.mobile-layout.test.ts): DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.selectedComponentSourceGate.spec.ts): DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.shellContext.spec.ts): DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.toolbar-wiring.test.ts): DesignEditor source greps only
// oracle-change(templates/design/app/pages/DesignEditor.versionHistory.spec.ts): DesignEditor source greps only

describe("DesignEditor pending source handoff", () => {
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
});
