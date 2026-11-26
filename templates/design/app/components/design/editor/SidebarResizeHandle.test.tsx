// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SidebarResizeHandle } from "./SidebarResizeHandle";

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected element is missing");
  return value;
}

async function mountHandle(edge: "start" | "end") {
  const onWidthChange = vi.fn();
  const onReset = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SidebarResizeHandle
        edge={edge}
        label="Resize"
        width={320}
        minWidth={240}
        maxWidth={400}
        onPointerDown={vi.fn()}
        onWidthChange={onWidthChange}
        onReset={onReset}
      />,
    );
  });
  const handle = must(host.querySelector<HTMLElement>('[role="separator"]'));
  const press = (key: string, shiftKey = false) =>
    act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
      );
    });
  return {
    handle,
    press,
    onWidthChange,
    onReset,
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

describe("SidebarResizeHandle", () => {
  it("grows an end-edge column with ArrowRight, 8px or 40px with Shift", async () => {
    const view = await mountHandle("end");
    expect(view.handle.getAttribute("tabindex")).toBe("0");
    expect(view.handle.getAttribute("aria-valuenow")).toBe("320");
    await view.press("ArrowRight");
    await view.press("ArrowLeft", true);
    expect(view.onWidthChange.mock.calls).toEqual([[328], [280]]);
    await view.unmount();
  });

  it("grows a start-edge column with ArrowLeft", async () => {
    const view = await mountHandle("start");
    await view.press("ArrowLeft");
    expect(view.onWidthChange).toHaveBeenCalledWith(328);
    await view.unmount();
  });

  it("resets on double-click", async () => {
    const view = await mountHandle("end");
    await act(async () => {
      view.handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(view.onReset).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
