// @vitest-environment happy-dom

import * as PopoverPrimitive from "@radix-ui/react-popover";
import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeAgentPanelOverlayFocusRestore,
  deferAgentPanelOverlayOpen,
} from "./AgentPanel.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";

function OverlayHandoffHarness({
  onFocusRestore,
}: {
  onFocusRestore?: (prevented: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pendingOverlayRef = useRef(false);

  const closeMenuForOverlay = () => {
    pendingOverlayRef.current = true;
    setMenuOpen(false);
  };

  return (
    <div>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" data-testid="menu-trigger">
            Options
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={(event) => {
            consumeAgentPanelOverlayFocusRestore(pendingOverlayRef, event);
            onFocusRestore?.(event.defaultPrevented);
          }}
        >
          <DropdownMenuItem
            data-testid="feedback-item"
            onSelect={(event) =>
              deferAgentPanelOverlayOpen(event, closeMenuForOverlay, () =>
                setFeedbackOpen(true),
              )
            }
          >
            Feedback
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PopoverPrimitive.Root open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button type="button" tabIndex={-1} aria-hidden="true">
            Feedback trigger
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content data-testid="feedback-content">
            Feedback form
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}

describe("AgentPanel sibling overlay handoff", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: Array<FrameRequestCallback>;
  let requestAnimationFrame: typeof window.requestAnimationFrame;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    frames = [];
    requestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    window.requestAnimationFrame = requestAnimationFrame;
    vi.unstubAllGlobals();
  });

  it("keeps feedback open after the menu restores focus", async () => {
    const focusRestorePrevented = vi.fn();

    await act(async () => {
      root.render(
        <OverlayHandoffHarness onFocusRestore={focusRestorePrevented} />,
      );
    });

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>(
        '[data-testid="menu-trigger"]',
      );
      trigger?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          cancelable: true,
        }),
      );
      trigger?.click();
    });

    expect(
      document.querySelector('[data-testid="feedback-item"]'),
    ).toBeTruthy();

    await act(async () => {
      document
        .querySelector<HTMLElement>('[data-testid="feedback-item"]')
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    });

    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(focusRestorePrevented).toHaveBeenCalledWith(true);
    expect(frames).toHaveLength(1);

    await act(async () => {
      frames[0]!(0);
    });

    expect(
      document.body.querySelector('[data-testid="feedback-content"]'),
    ).toBeTruthy();
  });
});
