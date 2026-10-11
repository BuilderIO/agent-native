// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  useDesignHotkeys,
  type UseDesignHotkeysProps,
} from "@/hooks/useDesignHotkeys";

import { annotationHotkeyHandlers } from "./tool-state";

function Probe(props: UseDesignHotkeysProps) {
  useDesignHotkeys(props);
  return null;
}

/** Mounts the real hotkey hook with the editor's annotation handlers and presses the keys. */
async function pressKeys(
  capabilities: { canEditDesign: boolean; canCommentDesign: boolean },
  keys: Array<{ key: string; shiftKey?: boolean }>,
) {
  const onComment = vi.fn();
  const onDraw = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <Probe
        {...annotationHotkeyHandlers({ ...capabilities, onComment, onDraw })}
      />,
    );
  });
  for (const { key, shiftKey } of keys) {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        shiftKey: shiftKey ?? false,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  await act(async () => {
    root.unmount();
  });
  container.remove();
  return { onComment, onDraw };
}

const COMMENT_AND_DRAW = [{ key: "c" }, { key: "y", shiftKey: true }];

describe("annotation hotkeys", () => {
  it("keeps Shift+Y and C out of annotate mode for an editable widget without comment permission", async () => {
    const { onComment, onDraw } = await pressKeys(
      { canEditDesign: true, canCommentDesign: false },
      COMMENT_AND_DRAW,
    );
    expect(onDraw).not.toHaveBeenCalled();
    expect(onComment).not.toHaveBeenCalled();
  });

  it("enters annotate mode from the keyboard with comment permission", async () => {
    const { onComment, onDraw } = await pressKeys(
      { canEditDesign: true, canCommentDesign: true },
      COMMENT_AND_DRAW,
    );
    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it("still draws only where the design is editable", async () => {
    const { onComment, onDraw } = await pressKeys(
      { canEditDesign: false, canCommentDesign: true },
      COMMENT_AND_DRAW,
    );
    expect(onDraw).not.toHaveBeenCalled();
    expect(onComment).toHaveBeenCalledTimes(1);
  });
});
