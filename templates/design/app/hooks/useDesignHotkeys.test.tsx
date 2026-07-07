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

  it("still selects the hand tool for plain H (no modifiers)", async () => {
    const onHandTool = vi.fn();
    const onToggleHidden = vi.fn();
    await withHotkeys({ onHandTool, onToggleHidden }, () => {
      dispatchKey("h");
    });
    expect(onHandTool).toHaveBeenCalledTimes(1);
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

  it("Shift+Cmd+G ungroups", async () => {
    const onUngroup = vi.fn();
    const onFrameSelection = vi.fn();
    await withHotkeys({ onUngroup, onFrameSelection }, () => {
      dispatchKey("g", { metaKey: true, shiftKey: true });
    });
    expect(onUngroup).toHaveBeenCalledTimes(1);
    expect(onFrameSelection).not.toHaveBeenCalled();
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

  it("does not fire align when a plain tool-shortcut letter is pressed with no modifiers", async () => {
    const onAlignSelection = vi.fn();
    const onFrameTool = vi.fn();
    await withHotkeys({ onAlignSelection, onFrameTool }, () => {
      dispatchKey("a");
    });
    expect(onAlignSelection).not.toHaveBeenCalled();
    expect(onFrameTool).toHaveBeenCalledTimes(1);
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

describe("useDesignHotkeys — distribute (Alt+Shift+H/V) and Tidy up (Ctrl+Alt+T)", () => {
  it("Alt+Shift+H distributes horizontally and wins over plain Alt+H align", async () => {
    const onDistributeSelection = vi.fn();
    const onAlignSelection = vi.fn();
    await withHotkeys({ onDistributeSelection, onAlignSelection }, () => {
      dispatchKey("h", { altKey: true, shiftKey: true });
    });
    expect(onDistributeSelection).toHaveBeenCalledTimes(1);
    expect(onDistributeSelection.mock.calls[0]![0]).toMatchObject({
      axis: "horizontal",
    });
    expect(onAlignSelection).not.toHaveBeenCalled();
  });

  it("Alt+Shift+V distributes vertically and wins over plain Alt+V align", async () => {
    const onDistributeSelection = vi.fn();
    const onAlignSelection = vi.fn();
    await withHotkeys({ onDistributeSelection, onAlignSelection }, () => {
      dispatchKey("v", { altKey: true, shiftKey: true });
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

  it("Alt+Shift+composed-char (˙, code KeyH) still distributes horizontally", async () => {
    const onDistributeSelection = vi.fn();
    const onAlignSelection = vi.fn();
    await withHotkeys({ onDistributeSelection, onAlignSelection }, () => {
      dispatchKey("Ó", { code: "KeyH", altKey: true, shiftKey: true });
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

  it("plain A (no modifiers) still selects the frame tool", async () => {
    const onAddAutoLayout = vi.fn();
    const onFrameTool = vi.fn();
    await withHotkeys({ onAddAutoLayout, onFrameTool }, () => {
      dispatchKey("a");
    });
    expect(onFrameTool).toHaveBeenCalledTimes(1);
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
