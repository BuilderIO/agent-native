// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { expect, it, vi } from "vitest";

import { AppShell } from "./app-shell.js";

it("tracks the mounted shell's viewport and releases its breakpoint listener", () => {
  const frame = document.body.appendChild(document.createElement("iframe"));
  const win = frame.contentWindow;
  if (!win) throw new Error("Missing frame window");
  let matches = true;
  const query = Object.defineProperty(new EventTarget(), "matches", {
    get: () => matches,
  });
  const matchMedia = vi.fn(() => query);
  Object.defineProperty(win, "matchMedia", { value: matchMedia });
  const remove = vi.spyOn(query, "removeEventListener");
  const ref = createRef<HTMLDivElement>();
  const onSidebarOpenChange = vi.fn();
  const view = render(
    <AppShell
      ref={ref}
      sidebarOpen
      onSidebarOpenChange={onSidebarOpenChange}
    />,
    {
      container: win.document.body.appendChild(
        win.document.createElement("div"),
      ),
    },
  );
  try {
    expect(ref.current?.ownerDocument).toBe(win.document);
    expect(ref.current?.hasAttribute("data-mobile")).toBe(true);
    matches = false;
    act(() => {
      query.dispatchEvent(new Event("change"));
    });
    expect(ref.current?.hasAttribute("data-mobile")).toBe(false);
    expect(onSidebarOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(matchMedia).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    frame.remove();
  }
  expect(remove).toHaveBeenCalledTimes(1);
  expect(ref.current).toBeNull();
});
