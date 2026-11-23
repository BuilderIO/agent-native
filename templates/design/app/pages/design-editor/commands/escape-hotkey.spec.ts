import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runEscapeHotkey, type EscapeHotkeyArgs } from "./escape-hotkey";

// oracle-change: removed two cases duplicated by 'deselects instead of promoting' and the consumed-Escape case that stay
// oracle-change(templates/design/app/pages/design-editor/commands/iframe-scroll.spec.ts): iframe-context-menu.spec.ts keeps the unreadable-scroll case
// oracle-change(templates/design/app/pages/design-editor/commands/layer-move.preview-scope.test.ts): layer-move.preview.spec.ts asserts forcePreviewFullDocument on sibling reorder

const SELECTED_ELEMENT = {
  id: "kid-one",
  selector: '[data-agent-native-node-id="kid-one"]',
  tagName: "div",
} as unknown as ElementInfo;

function harness(overrides: Partial<EscapeHotkeyArgs> = {}) {
  const calls = {
    clearPendingOverviewLayerSelection: vi.fn(),
    setSelectedElement: vi.fn(),
    setCreatedOverviewLayerSelection: vi.fn(),
    setHoveredElement: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    setOverviewClearSelectionRequest: vi.fn(),
  };
  const args: EscapeHotkeyArgs = {
    activeBreakpointWidthStateRef: {
      current: undefined,
    } as RefObject<number | undefined>,
    activeTool: "move",
    cancelActiveEditorDrag: () => false,
    enterOverviewFromZoom: vi.fn(),
    handleBreakpointBarSelect: vi.fn(),
    handleCloseKeyboardShortcuts: vi.fn(),
    keyboardShortcutsOpen: false,
    mode: "edit",
    pinMode: false,
    selectedElement: SELECTED_ELEMENT,
    selectedLayerIds: [],
    setActiveTool: vi.fn(),
    setMode: vi.fn(),
    setPinMode: vi.fn(),
    viewMode: "overview",
    ...calls,
    ...overrides,
  };
  return { args, calls };
}

describe("runEscapeHotkey", () => {
  it("deselects instead of promoting the selection to its parent layer", () => {
    const { args, calls } = harness();

    runEscapeHotkey(args);

    expect(calls.setSelectedElement).toHaveBeenCalledWith(null);
    expect(calls.clearPendingOverviewLayerSelection).toHaveBeenCalledTimes(1);
    expect(calls.setSelectedLayerIdsState).toHaveBeenCalledWith([]);
    expect(calls.setOverviewSelectedScreenIds).toHaveBeenCalledWith([]);
    expect(calls.setOverviewClearSelectionRequest).toHaveBeenCalledTimes(1);
    expect(calls.setCreatedOverviewLayerSelection).toHaveBeenCalledWith(null);
  });

  it("keeps a pending created-layer selection when another handler consumes Escape", () => {
    const { args, calls } = harness({ cancelActiveEditorDrag: () => true });

    runEscapeHotkey(args);

    expect(calls.clearPendingOverviewLayerSelection).not.toHaveBeenCalled();
    expect(calls.setSelectedElement).not.toHaveBeenCalled();
    expect(calls.setCreatedOverviewLayerSelection).not.toHaveBeenCalled();
  });

  it("does not fall back to selecting the containing screen frame", () => {
    const { args, calls } = harness({ viewMode: "overview" });

    runEscapeHotkey(args);

    expect(calls.setOverviewSelectedScreenIds).toHaveBeenCalledTimes(1);
    expect(calls.setOverviewSelectedScreenIds).toHaveBeenCalledWith([]);
  });

  it("clears a created layer before escaping back to overview", () => {
    const { args, calls } = harness({
      viewMode: "single",
      selectedElement: null,
      selectedLayerIds: ["created-layer"],
    });

    runEscapeHotkey(args);

    expect(args.enterOverviewFromZoom).not.toHaveBeenCalled();
    expect(calls.setSelectedElement).toHaveBeenCalledWith(null);
    expect(calls.setSelectedLayerIdsState).toHaveBeenCalledWith([]);
  });

  it("only closes the shortcuts dialog when it is open, leaving selection and tool alone", () => {
    const { args, calls } = harness({
      keyboardShortcutsOpen: true,
      activeTool: "frame",
    });

    runEscapeHotkey(args);

    expect(args.handleCloseKeyboardShortcuts).toHaveBeenCalledTimes(1);
    expect(calls.setSelectedElement).not.toHaveBeenCalled();
    expect(calls.setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(calls.setOverviewSelectedScreenIds).not.toHaveBeenCalled();
    expect(args.setActiveTool).not.toHaveBeenCalled();
    expect(args.setMode).not.toHaveBeenCalled();
  });
});
