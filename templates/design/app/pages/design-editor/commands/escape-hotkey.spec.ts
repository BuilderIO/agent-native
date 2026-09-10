import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runEscapeHotkey, type EscapeHotkeyArgs } from "./escape-hotkey";

const SELECTED_ELEMENT = {
  id: "kid-one",
  selector: '[data-agent-native-node-id="kid-one"]',
  tagName: "div",
} as unknown as ElementInfo;

function harness(overrides: Partial<EscapeHotkeyArgs> = {}) {
  const calls = {
    setSelectedElement: vi.fn(),
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
    drawMode: false,
    enterOverviewFromZoom: vi.fn(),
    focusedAnnotationSending: false,
    handleBreakpointBarSelect: vi.fn(),
    handleCloseKeyboardShortcuts: vi.fn(),
    handleExitFocusedDrawMode: vi.fn(),
    handleExitOverviewDrawMode: vi.fn(),
    keyboardShortcutsOpen: false,
    mode: "edit",
    overviewAnnotationSending: false,
    pinMode: false,
    selectedElement: SELECTED_ELEMENT,
    setActiveTool: vi.fn(),
    setDrawMode: vi.fn(),
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
    expect(calls.setSelectedLayerIdsState).toHaveBeenCalledWith([]);
    expect(calls.setOverviewSelectedScreenIds).toHaveBeenCalledWith([]);
    expect(calls.setOverviewClearSelectionRequest).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to selecting the containing screen frame", () => {
    const { args, calls } = harness({ viewMode: "overview" });

    runEscapeHotkey(args);

    expect(calls.setOverviewSelectedScreenIds).toHaveBeenCalledTimes(1);
    expect(calls.setOverviewSelectedScreenIds).toHaveBeenCalledWith([]);
  });

  it("still lets a higher-priority consumer take the keypress", () => {
    const { args, calls } = harness({ cancelActiveEditorDrag: () => true });

    runEscapeHotkey(args);

    expect(calls.setSelectedElement).not.toHaveBeenCalled();
  });
});
