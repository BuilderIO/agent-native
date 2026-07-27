// @vitest-environment happy-dom

/**
 * Escape-key ordering regression (adversarial-review item 2): does an
 * Escape keypress inside DesignColorPicker's open popover (wired at
 * `onEscapeKeyDown={revertToOpenSnapshot}`, ~DesignColorPicker.tsx:1368)
 * also reach `useDesignHotkeys`' `onEscape` (handleEscapeHotkey in
 * DesignEditor.tsx), which pops/clears the canvas selection? If so, one
 * Escape press would both revert+close the picker AND pop canvas
 * selection — two distinct effects from a single keypress.
 *
 * This does NOT render the full DesignColorPicker/DesignEditor tree (out of
 * scope and too heavy); instead it wires the two REAL, unmocked mechanisms
 * that decide the outcome — Radix's `@radix-ui/react-dismissable-layer`
 * (via the shared `PopoverContent` wrapper, same `onEscapeKeyDown` prop
 * DesignColorPicker uses) and the real `useDesignHotkeys` hook (same
 * `onEscape` prop DesignEditor.tsx wires to `handleEscapeHotkey`) — and
 * dispatches a real, bubbling, cancelable "Escape" keydown at a plain
 * (non-editable) inner element, matching the SV field / ColorTrack slider /
 * gradient stop buttons named in the review: none of them are
 * input/textarea/select/contenteditable/role=textbox, so
 * `isDesignHotkeyEditableTarget` would NOT skip them on its own.
 *
 * Finding: the double-fire cannot happen, and no code change was made here.
 * Radix's `DismissableLayer` (see
 * @radix-ui/react-dismissable-layer/dist/index.mjs) adds its Escape listener
 * on `ownerDocument` with `{ capture: true }`, and always calls
 * `event.preventDefault()` after `onEscapeKeyDown` fires whenever the layer
 * has an `onDismiss` (Popover always wires one — `onDismiss: () =>
 * context.onOpenChange(false)` — regardless of what `onEscapeKeyDown` does).
 * `useDesignHotkeys` (DesignEditor.tsx's call has no `target`/`capture`
 * override) listens on `window` with the default bubble phase. Native keydown
 * dispatch order is: capture phase window -> document -> ... -> target, then
 * bubble phase target -> ... -> document -> window. Radix's document-capture
 * listener therefore always runs and calls `preventDefault()` *before* the
 * event ever reaches the target or bubbles back up to `window`, so by the
 * time `useDesignHotkeys`' handler runs, `event.defaultPrevented` is already
 * `true` and its very first guard (`if (event.defaultPrevented ...) return;`)
 * bails out before `onEscape` is invoked. The ordering is a structural
 * guarantee of the DOM event model (document is always an ancestor of
 * window's bubble-phase delivery point in this browser event model — more
 * precisely: capture always fully completes down to target before any
 * bubble listener runs), not an accident of registration order, so this test
 * pins the guarantee rather than proposing a fix.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDesignHotkeys } from "@/hooks/useDesignHotkeys";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Harness({
  onPopoverEscape,
  onCanvasEscapeHotkey,
}: {
  onPopoverEscape: () => void;
  onCanvasEscapeHotkey: () => void;
}) {
  // Mirrors DesignEditor.tsx's real `useDesignHotkeys({ ..., onEscape:
  // handleEscapeHotkey })` call: no `target`/`capture` override, so it binds
  // to `window` in the default bubble phase, exactly like production.
  useDesignHotkeys({ onEscape: onCanvasEscapeHotkey });

  return (
    <Popover open onOpenChange={() => undefined}>
      <PopoverTrigger asChild>
        <button type="button">trigger</button>
      </PopoverTrigger>
      {/* portalled=false keeps this inline for the test; DesignColorPicker's
          real PopoverContent (portalled, default true) still binds Radix's
          document-level capture listener the same way regardless of portal
          placement — portalling only changes where the DOM node lives, not
          which document/capture phase the DismissableLayer effect uses. */}
      <PopoverContent portalled={false} onEscapeKeyDown={onPopoverEscape}>
        {/* A plain button — not input/textarea/select/contenteditable/
            role=textbox — matching the SV field / ColorTrack slider /
            gradient stop buttons the review named as targets that
            useDesignHotkeys' editable-target guard would NOT skip. */}
        <button type="button" data-testid="inner-target">
          inner
        </button>
      </PopoverContent>
    </Popover>
  );
}

describe("Escape ordering — DesignColorPicker popover vs canvas hotkeys", () => {
  it("an Escape keydown on a non-editable popover-content target fires the popover's onEscapeKeyDown but never reaches useDesignHotkeys' onEscape", () => {
    const onPopoverEscape = vi.fn();
    const onCanvasEscapeHotkey = vi.fn();

    act(() => {
      root.render(
        <Harness
          onPopoverEscape={onPopoverEscape}
          onCanvasEscapeHotkey={onCanvasEscapeHotkey}
        />,
      );
    });

    const inner = container.querySelector<HTMLButtonElement>(
      '[data-testid="inner-target"]',
    );
    expect(inner).not.toBeNull();

    act(() => {
      inner!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onPopoverEscape).toHaveBeenCalledTimes(1);
    expect(onCanvasEscapeHotkey).not.toHaveBeenCalled();
  });

  it("a bare Escape keydown with no open popover DOES reach useDesignHotkeys' onEscape (control case — proves the hook itself is wired and working)", () => {
    const onCanvasEscapeHotkey = vi.fn();

    function ControlHarness() {
      useDesignHotkeys({ onEscape: onCanvasEscapeHotkey });
      return (
        <button type="button" data-testid="plain-target">
          plain
        </button>
      );
    }

    act(() => {
      root.render(<ControlHarness />);
    });

    const target = container.querySelector<HTMLButtonElement>(
      '[data-testid="plain-target"]',
    );
    act(() => {
      target!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onCanvasEscapeHotkey).toHaveBeenCalledTimes(1);
  });
});
