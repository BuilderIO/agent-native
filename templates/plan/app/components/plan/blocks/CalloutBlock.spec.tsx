// @vitest-environment happy-dom

import type { BlockRenderContext } from "@agent-native/core/blocks";
import { CalloutBlockEdit, type CalloutData } from "@agent-native/core/blocks";
import React, { act, cloneElement, isValidElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function TestEditSurface({
  trigger,
  children,
}: Parameters<NonNullable<BlockRenderContext["renderEditSurface"]>>[0]) {
  const [open, setOpen] = useState(false);
  const opener = isValidElement<{ onClick?: () => void }>(trigger)
    ? cloneElement(trigger, {
        onClick: () => setOpen(true),
      })
    : trigger;

  return (
    <>
      {opener}
      {open && <div className="an-block-edit-popover">{children}</div>}
    </>
  );
}

function setInputValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// The `callout` block now lives in the shared core library
// (`@agent-native/core/blocks`); plan registers it via `registerLibraryBlocks`.
// This guards that plan's expected callout edit UX — inline-prose body plus a
// tone/type picker in the edit popover — survives in the shared component.
describe("CalloutBlockEdit", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps prose inline and moves callout type controls into the edit popover", () => {
    const changes: CalloutData[] = [];

    act(() => {
      root.render(
        <CalloutBlockEdit
          blockId="callout-1"
          ctx={{
            renderEditSurface: (props) => <TestEditSurface {...props} />,
          }}
          data={{ tone: "info", body: "FIRST block callout." }}
          editable
          onChange={(next) => changes.push(next)}
        />,
      );
    });

    const inlineBody = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(inlineBody?.value).toBe("FIRST block callout.");
    expect(container.textContent).not.toContain("decision");
    expect(container.textContent).not.toContain("warning");

    setInputValue(inlineBody!, "Updated inline text.");
    expect(changes[changes.length - 1]?.body).toBe("Updated inline text.");

    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit callout type"]',
    );
    expect(editButton).toBeTruthy();

    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("decision");
    expect(container.textContent).toContain("warning");

    const warningButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".an-block-edit-popover button",
      ),
    ).find((button) => button.textContent === "warning");
    expect(warningButton).toBeTruthy();

    act(() => {
      warningButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(changes[changes.length - 1]?.tone).toBe("warning");
  });
});
