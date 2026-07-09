// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  isDesignHotkeyEditableTarget,
  useDesignHotkeys,
  type UseDesignHotkeysProps,
} from "./useDesignHotkeys";

describe("isDesignHotkeyEditableTarget", () => {
  it("treats Monaco-style textbox elements as editable targets", () => {
    const root = document.createElement("div");
    root.setAttribute("data-hotkeys-scope", "text");
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    root.append(textbox);
    document.body.append(root);

    expect(isDesignHotkeyEditableTarget(textbox)).toBe(true);

    root.remove();
  });
});

function Probe(props: UseDesignHotkeysProps) {
  useDesignHotkeys(props);
  return null;
}

async function withHotkeys(
  props: UseDesignHotkeysProps,
  run: () => void | Promise<void>,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe {...props} />);
  });
  try {
    await run();
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}

function dispatchKey(
  key: string,
  init: KeyboardEventInit & { code?: string } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

async function withNavigatorPlatform(
  platform: string,
  run: () => void | Promise<void>,
) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    await run();
  } finally {
    if (ownDescriptor) {
      Object.defineProperty(navigator, "platform", ownDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "platform");
    }
  }
}

describe("useDesignHotkeys — current Figma tool bindings", () => {
  it("Y arms the annotation/draw tool", async () => {
    const onDrawTool = vi.fn();
    const onToolChange = vi.fn();
    await withHotkeys({ onDrawTool, onToolChange }, () => {
      dispatchKey("y");
    });
    expect(onDrawTool).toHaveBeenCalledTimes(1);
    expect(onToolChange).toHaveBeenCalledWith(
      "draw",
      expect.objectContaining({ key: "y" }),
    );
  });

  it("keeps F as Frame and leaves the historical A alias unhandled", async () => {
    const onFrameTool = vi.fn();
    await withHotkeys({ onFrameTool }, () => {
      dispatchKey("f");
      dispatchKey("a");
    });
    expect(onFrameTool).toHaveBeenCalledTimes(1);
  });

  it("uses Shift+L for Arrow while plain L remains Line", async () => {
    const onLineTool = vi.fn();
    const onArrowTool = vi.fn();
    await withHotkeys({ onLineTool, onArrowTool }, () => {
      dispatchKey("l");
      dispatchKey("l", { shiftKey: true });
    });
    expect(onLineTool).toHaveBeenCalledTimes(1);
    expect(onArrowTool).toHaveBeenCalledTimes(1);
  });

  it("uses literal Control+C for Pick color on Apple platforms and Cmd+C for Copy", async () => {
    const onEyedropper = vi.fn();
    const onCopy = vi.fn();
    await withNavigatorPlatform("MacIntel", () =>
      withHotkeys({ onEyedropper, onCopy }, () => {
        dispatchKey("c", { code: "KeyC", ctrlKey: true });
        dispatchKey("c", { code: "KeyC", metaKey: true });
      }),
    );
    expect(onEyedropper).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("routes Shift+Cmd+C to Copy as PNG without touching ordinary Copy", async () => {
    const onCopy = vi.fn();
    const onCopyAsPng = vi.fn();
    await withHotkeys({ onCopy, onCopyAsPng }, () => {
      dispatchKey("c", { metaKey: true, shiftKey: true });
    });
    expect(onCopyAsPng).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
  });
});

describe("useDesignHotkeys — Figma selection and frame traversal", () => {
  it("keeps Tab / Shift+Tab available for sibling traversal", async () => {
    const onTab = vi.fn();
    await withHotkeys({ onTab }, () => {
      const dispatchIframeTab = (shiftKey: boolean) => {
        const event = new KeyboardEvent("keydown", {
          key: "Tab",
          code: "Tab",
          shiftKey,
          bubbles: true,
          cancelable: true,
        }) as KeyboardEvent & { __agentNativeIframeHotkey?: boolean };
        event.__agentNativeIframeHotkey = true;
        window.dispatchEvent(event);
      };
      dispatchIframeTab(false);
      dispatchIframeTab(true);
    });
    expect(onTab).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ backwards: false }),
    );
    expect(onTab).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ backwards: true }),
    );
  });

  it("uses N / Shift+N for next / previous frame", async () => {
    const onNextFrame = vi.fn();
    const onPreviousFrame = vi.fn();
    await withHotkeys({ onNextFrame, onPreviousFrame }, () => {
      dispatchKey("n");
      dispatchKey("n", { shiftKey: true });
    });
    expect(onNextFrame).toHaveBeenCalledTimes(1);
    expect(onPreviousFrame).toHaveBeenCalledTimes(1);
  });

  it("uses plain Backslash for parent selection", async () => {
    const onSelectParent = vi.fn();
    const onToggleUi = vi.fn();
    await withHotkeys({ onSelectParent, onToggleUi }, () => {
      dispatchKey("\\", { code: "Backslash" });
    });
    expect(onSelectParent).toHaveBeenCalledTimes(1);
    expect(onToggleUi).not.toHaveBeenCalled();
  });

  it("does not turn inverse/matching-selection shortcuts into Select all", async () => {
    const onSelectAll = vi.fn();
    await withHotkeys({ onSelectAll }, () => {
      dispatchKey("a", { metaKey: true, shiftKey: true });
      dispatchKey("a", { metaKey: true, altKey: true });
    });
    expect(onSelectAll).not.toHaveBeenCalled();
  });
});

describe("useDesignHotkeys — Figma navigation and find", () => {
  it("routes Cmd+F on Apple and Ctrl+F on non-Apple platforms", async () => {
    const onAppleFind = vi.fn();
    await withNavigatorPlatform("MacIntel", () =>
      withHotkeys({ onFind: onAppleFind }, () => {
        dispatchKey("f", { code: "KeyF", metaKey: true });
        dispatchKey("f", { code: "KeyF", ctrlKey: true });
      }),
    );
    expect(onAppleFind).toHaveBeenCalledTimes(1);

    const onWindowsFind = vi.fn();
    await withNavigatorPlatform("Win32", () =>
      withHotkeys({ onFind: onWindowsFind }, () => {
        dispatchKey("f", { code: "KeyF", ctrlKey: true });
        dispatchKey("f", { code: "KeyF", metaKey: true });
      }),
    );
    expect(onWindowsFind).toHaveBeenCalledTimes(1);
  });

  it("leaves Cmd+F native inside editable targets", async () => {
    const onFind = vi.fn();
    await withNavigatorPlatform("MacIntel", () =>
      withHotkeys({ onFind }, () => {
        const input = document.createElement("input");
        document.body.append(input);
        const event = new KeyboardEvent("keydown", {
          key: "f",
          code: "KeyF",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        input.remove();
      }),
    );
    expect(onFind).not.toHaveBeenCalled();
  });

  it("uses Option/Alt+1 and Option/Alt+2 for File and Assets", async () => {
    const onShowLayersPanel = vi.fn();
    const onShowAssetsPanel = vi.fn();
    const onOpacityChange = vi.fn();
    await withHotkeys(
      { onShowLayersPanel, onShowAssetsPanel, onOpacityChange },
      () => {
        dispatchKey("¡", { code: "Digit1", altKey: true });
        dispatchKey("™", { code: "Digit2", altKey: true });
      },
    );
    expect(onShowLayersPanel).toHaveBeenCalledTimes(1);
    expect(onShowAssetsPanel).toHaveBeenCalledTimes(1);
    expect(onOpacityChange).not.toHaveBeenCalled();
  });
});

describe("useDesignHotkeys — selection toggles (Cmd+Shift+H / Cmd+Shift+L)", () => {
  it("fires onToggleHidden for Cmd+Shift+H", async () => {
    const onToggleHidden = vi.fn();
    const onHandTool = vi.fn();
    await withHotkeys({ onToggleHidden, onHandTool }, () => {
      dispatchKey("h", { metaKey: true, shiftKey: true });
    });
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
    expect(onHandTool).not.toHaveBeenCalled();
  });

  it("fires onToggleLocked for Cmd+Shift+L", async () => {
    const onToggleLocked = vi.fn();
    const onLineTool = vi.fn();
    const onArrowTool = vi.fn();
    await withHotkeys({ onToggleLocked, onLineTool, onArrowTool }, () => {
      dispatchKey("l", { metaKey: true, shiftKey: true });
    });
    expect(onToggleLocked).toHaveBeenCalledTimes(1);
    expect(onLineTool).not.toHaveBeenCalled();
    expect(onArrowTool).not.toHaveBeenCalled();
  });

  it("uses plain H for Hand and plain K for Scale", async () => {
    const onHandTool = vi.fn();
    const onScaleTool = vi.fn();
    const onToggleHidden = vi.fn();
    await withHotkeys({ onHandTool, onScaleTool, onToggleHidden }, () => {
      dispatchKey("h");
      dispatchKey("k");
    });
    expect(onHandTool).toHaveBeenCalledTimes(1);
    expect(onScaleTool).toHaveBeenCalledTimes(1);
    expect(onToggleHidden).not.toHaveBeenCalled();
  });
});

describe("useDesignHotkeys — group/ungroup/frame (Cmd+G family)", () => {
  it("Cmd+G groups", async () => {
    const onGroup = vi.fn();
    await withHotkeys({ onGroup }, () => {
      dispatchKey("g", { metaKey: true });
    });
    expect(onGroup).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Backspace ungroups", async () => {
    const onUngroup = vi.fn();
    const onFrameSelection = vi.fn();
    await withHotkeys({ onUngroup, onFrameSelection }, () => {
      dispatchKey("Backspace", { metaKey: true });
    });
    expect(onUngroup).toHaveBeenCalledTimes(1);
    expect(onFrameSelection).not.toHaveBeenCalled();
  });

  it("does not retain the historical Shift+Cmd+G ungroup binding", async () => {
    const onUngroup = vi.fn();
    const onGroup = vi.fn();
    await withHotkeys({ onUngroup, onGroup }, () => {
      dispatchKey("g", { metaKey: true, shiftKey: true });
    });
    expect(onUngroup).not.toHaveBeenCalled();
    expect(onGroup).not.toHaveBeenCalled();
  });

  it("Cmd+Alt+G frames the selection instead of ungrouping", async () => {
    const onUngroup = vi.fn();
    const onFrameSelection = vi.fn();
    const onGroup = vi.fn();
    await withHotkeys({ onUngroup, onFrameSelection, onGroup }, () => {
      dispatchKey("g", { metaKey: true, altKey: true });
    });
    expect(onFrameSelection).toHaveBeenCalledTimes(1);
    expect(onUngroup).not.toHaveBeenCalled();
    expect(onGroup).not.toHaveBeenCalled();
  });
});

describe("useDesignHotkeys — zoom keys", () => {
  it("plain = / + zoom in with no modifiers", async () => {
    const onZoomIn = vi.fn();
    await withHotkeys({ onZoomIn }, () => {
      dispatchKey("=");
    });
    expect(onZoomIn).toHaveBeenCalledTimes(1);

    const onZoomInPlus = vi.fn();
    await withHotkeys({ onZoomIn: onZoomInPlus }, () => {
      dispatchKey("+");
    });
    expect(onZoomInPlus).toHaveBeenCalledTimes(1);
  });

  it("plain - zooms out with no modifiers", async () => {
    const onZoomOut = vi.fn();
    await withHotkeys({ onZoomOut }, () => {
      dispatchKey("-");
    });
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("Cmd+= / Cmd+- still zoom in/out", async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    await withHotkeys({ onZoomIn, onZoomOut }, () => {
      dispatchKey("=", { metaKey: true });
      dispatchKey("-", { metaKey: true });
    });
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('Shift+= (the "+" keystroke on a US layout) zooms in like Figma', async () => {
    const onZoomIn = vi.fn();
    await withHotkeys({ onZoomIn }, () => {
      dispatchKey("+", { shiftKey: true, code: "Equal" });
    });
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it("Shift+Cmd+= does not double-fire onZoomIn (primary branch already wins)", async () => {
    const onZoomIn = vi.fn();
    await withHotkeys({ onZoomIn }, () => {
      dispatchKey("+", { shiftKey: true, metaKey: true, code: "Equal" });
    });
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it("does not confuse plain digit opacity shortcuts with zoom keys", async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onOpacityChange = vi.fn();
    await withHotkeys({ onZoomIn, onZoomOut, onOpacityChange }, () => {
      dispatchKey("5", { code: "Digit5" });
    });
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onOpacityChange).toHaveBeenCalledTimes(1);
  });
});

describe("useDesignHotkeys — selection alignment (Alt+A/D/W/S/H/V)", () => {
  it.each([
    ["a", "left"],
    ["d", "right"],
    ["w", "top"],
    ["s", "bottom"],
    ["h", "center-h"],
    ["v", "center-v"],
  ] as const)("Alt+%s aligns to %s", async (key, edge) => {
    const onAlignSelection = vi.fn();
    await withHotkeys({ onAlignSelection }, () => {
      dispatchKey(key, { altKey: true });
    });
    expect(onAlignSelection).toHaveBeenCalledTimes(1);
    expect(onAlignSelection.mock.calls[0]![0]).toMatchObject({ edge });
  });

  // Real macOS keyboards compose Option+letter into a different character
  // (Option+A -> "å", Option+D -> "∂", Option+W -> "∑", Option+S -> "ß",
  // Option+H -> "˙", Option+V -> "√") — event.key carries the composed
  // character, not the plain letter. Synthetic test events that send a
  // clean `key` (like the block above) don't exercise this at all, which is
  // exactly why this class of bug slipped past automated checks. These
  // cases dispatch the real composed `key` alongside the physical `code`,
  // matching what a real browser sends, to prove the dispatcher reads
  // event.code (not event.key) for alt-combos.
  it.each([
    ["å", "KeyA", "left"],
    ["∂", "KeyD", "right"],
    ["∑", "KeyW", "top"],
    ["ß", "KeyS", "bottom"],
    ["˙", "KeyH", "center-h"],
    ["√", "KeyV", "center-v"],
  ] as const)(
    "Alt+composed-char %s (code %s) still aligns to %s",
    async (composedKey, code, edge) => {
      const onAlignSelection = vi.fn();
      await withHotkeys({ onAlignSelection }, () => {
        dispatchKey(composedKey, { code, altKey: true });
      });
      expect(onAlignSelection).toHaveBeenCalledTimes(1);
      expect(onAlignSelection.mock.calls[0]![0]).toMatchObject({ edge });
    },
  );

  it("does not fire align or the historical Frame alias for plain A", async () => {
    const onAlignSelection = vi.fn();
    const onFrameTool = vi.fn();
    await withHotkeys({ onAlignSelection, onFrameTool }, () => {
      dispatchKey("a");
    });
    expect(onAlignSelection).not.toHaveBeenCalled();
    expect(onFrameTool).not.toHaveBeenCalled();
  });

  it("does not fire align for Cmd+Alt+K (create component) or Cmd+Alt+G (frame selection)", async () => {
    const onAlignSelection = vi.fn();
    const onCreateComponent = vi.fn();
    const onFrameSelection = vi.fn();
    await withHotkeys(
      { onAlignSelection, onCreateComponent, onFrameSelection },
      () => {
        dispatchKey("k", { metaKey: true, altKey: true });
        dispatchKey("g", { metaKey: true, altKey: true });
      },
    );
    expect(onCreateComponent).toHaveBeenCalledTimes(1);
    expect(onFrameSelection).toHaveBeenCalledTimes(1);
    expect(onAlignSelection).not.toHaveBeenCalled();
  });
});

describe("useDesignHotkeys — distribute (Ctrl+Alt+H/V) and Tidy up (Ctrl+Alt+T)", () => {
  it("Ctrl+Alt+H distributes horizontally and stays distinct from Alt+H align", async () => {
    const onDistributeSelection = vi.fn();
    const onAlignSelection = vi.fn();
    await withHotkeys({ onDistributeSelection, onAlignSelection }, () => {
      dispatchKey("h", { altKey: true, ctrlKey: true });
    });
    expect(onDistributeSelection).toHaveBeenCalledTimes(1);
    expect(onDistributeSelection.mock.calls[0]![0]).toMatchObject({
      axis: "horizontal",
    });
    expect(onAlignSelection).not.toHaveBeenCalled();
  });

  it("Ctrl+Alt+V distributes vertically and stays distinct from Alt+V align", async () => {
    const onDistributeSelection = vi.fn();
    const onAlignSelection = vi.fn();
    await withHotkeys({ onDistributeSelection, onAlignSelection }, () => {
      dispatchKey("v", { altKey: true, ctrlKey: true });
    });
    expect(onDistributeSelection).toHaveBeenCalledTimes(1);
    expect(onDistributeSelection.mock.calls[0]![0]).toMatchObject({
      axis: "vertical",
    });
    expect(onAlignSelection).not.toHaveBeenCalled();
  });

  it("Ctrl+Alt+T fires Tidy up even without a meta/cmd key", async () => {
    const onTidyUp = vi.fn();
    await withHotkeys({ onTidyUp }, () => {
      dispatchKey("t", { ctrlKey: true, altKey: true });
    });
    expect(onTidyUp).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Alt+composed-char (†, code KeyH) still distributes horizontally", async () => {
    const onDistributeSelection = vi.fn();
    const onAlignSelection = vi.fn();
    await withHotkeys({ onDistributeSelection, onAlignSelection }, () => {
      dispatchKey("†", { code: "KeyH", altKey: true, ctrlKey: true });
    });
    expect(onDistributeSelection).toHaveBeenCalledTimes(1);
    expect(onDistributeSelection.mock.calls[0]![0]).toMatchObject({
      axis: "horizontal",
    });
    expect(onAlignSelection).not.toHaveBeenCalled();
  });

  it("Ctrl+Alt+composed-char (†, code KeyT) still fires Tidy up", async () => {
    const onTidyUp = vi.fn();
    await withHotkeys({ onTidyUp }, () => {
      dispatchKey("†", { code: "KeyT", ctrlKey: true, altKey: true });
    });
    expect(onTidyUp).toHaveBeenCalledTimes(1);
  });
});

describe("useDesignHotkeys — Shift+A adds auto layout", () => {
  it("fires onAddAutoLayout for Shift+A, not the frame tool", async () => {
    const onAddAutoLayout = vi.fn();
    const onFrameTool = vi.fn();
    await withHotkeys({ onAddAutoLayout, onFrameTool }, () => {
      dispatchKey("a", { shiftKey: true });
    });
    expect(onAddAutoLayout).toHaveBeenCalledTimes(1);
    expect(onFrameTool).not.toHaveBeenCalled();
  });

  it("plain A (no modifiers) no longer selects the frame tool", async () => {
    const onAddAutoLayout = vi.fn();
    const onFrameTool = vi.fn();
    await withHotkeys({ onAddAutoLayout, onFrameTool }, () => {
      dispatchKey("a");
    });
    expect(onFrameTool).not.toHaveBeenCalled();
    expect(onAddAutoLayout).not.toHaveBeenCalled();
  });
});

describe("useDesignHotkeys — Cmd+\\ show/hide UI and Shift+C show/hide comments", () => {
  it("fires onToggleUi for Cmd+\\", async () => {
    const onToggleUi = vi.fn();
    await withHotkeys({ onToggleUi }, () => {
      dispatchKey("\\", { metaKey: true });
    });
    expect(onToggleUi).toHaveBeenCalledTimes(1);
  });

  it("fires onToggleComments for Shift+C, not the comment tool", async () => {
    const onToggleComments = vi.fn();
    const onCommentTool = vi.fn();
    await withHotkeys({ onToggleComments, onCommentTool }, () => {
      dispatchKey("c", { shiftKey: true });
    });
    expect(onToggleComments).toHaveBeenCalledTimes(1);
    expect(onCommentTool).not.toHaveBeenCalled();
  });

  it("plain C (no modifiers) still selects the comment tool", async () => {
    const onToggleComments = vi.fn();
    const onCommentTool = vi.fn();
    await withHotkeys({ onToggleComments, onCommentTool }, () => {
      dispatchKey("c");
    });
    expect(onCommentTool).toHaveBeenCalledTimes(1);
    expect(onToggleComments).not.toHaveBeenCalled();
  });
});
