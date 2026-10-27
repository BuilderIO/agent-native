// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { revealActiveSidebarRow } from "./SidebarNavigationRow";

function rect(top: number, bottom: number) {
  return { top, bottom, left: 0, right: 200, width: 200, height: bottom - top };
}

function sidebar() {
  const viewport = document.createElement("div");
  viewport.setAttribute("data-radix-scroll-area-viewport", "");
  viewport.getBoundingClientRect = () => rect(0, 400) as DOMRect;
  const placeholder = document.createElement("div");
  placeholder.setAttribute("data-sidebar-row-placeholder", "");
  const row = document.createElement("div");
  row.setAttribute("aria-current", "page");
  row.getBoundingClientRect = () => rect(900, 928) as DOMRect;
  row.scrollIntoView = vi.fn();
  viewport.append(placeholder, row);
  document.body.append(viewport);
  return { viewport, placeholder, row };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("revealActiveSidebarRow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("waits for loading rows before scrolling the open page into view", async () => {
    const { placeholder, row } = sidebar();

    revealActiveSidebarRow(row);
    await settle();
    expect(row.scrollIntoView).not.toHaveBeenCalled();

    placeholder.remove();
    await settle();
    expect(row.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("leaves the scroll alone when the rows that loaded already show the page", async () => {
    const { viewport, placeholder, row } = sidebar();

    revealActiveSidebarRow(row);
    const recent = document.createElement("div");
    recent.setAttribute("aria-current", "page");
    recent.getBoundingClientRect = () => rect(120, 148) as DOMRect;
    viewport.prepend(recent);
    placeholder.remove();
    await settle();

    expect(row.scrollIntoView).not.toHaveBeenCalled();
  });

  it("stops waiting when the row is no longer the open page", async () => {
    const { placeholder, row } = sidebar();

    const stop = revealActiveSidebarRow(row);
    stop?.();
    placeholder.remove();
    await settle();

    expect(row.scrollIntoView).not.toHaveBeenCalled();
  });
});
