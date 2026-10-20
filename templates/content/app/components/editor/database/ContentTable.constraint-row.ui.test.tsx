// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContentTableConstraintBar,
  ContentTableConstraintChip,
} from "./ContentTable";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let layout: { clientWidth: number; scrollWidth: number };
let resizeCallbacks: Array<() => void>;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

function defineLayout(name: string, get: (element: HTMLElement) => number) {
  descriptors.set(
    name,
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
  );
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get(this: HTMLElement) {
      return get(this);
    },
  });
}

function isScroller(element: HTMLElement) {
  return element.hasAttribute("data-constraint-scroller");
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // Five chips in a 340px row at 390px: two of them are past the end.
  layout = { clientWidth: 340, scrollWidth: 560 };
  resizeCallbacks = [];
  defineLayout("clientWidth", (element) =>
    isScroller(element) ? layout.clientWidth : 0,
  );
  defineLayout("scrollWidth", (element) =>
    isScroller(element) ? layout.scrollWidth : 0,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  for (const [name, descriptor] of descriptors) {
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
        name
      ];
  }
  descriptors.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CHIPS = ["Status", "Owner", "Due date", "Priority", "Search: launch"];

function render(extra?: ReactNode) {
  return act(async () =>
    root.render(
      <ContentTableConstraintBar
        trailing={<button type="button">Save for everyone</button>}
      >
        {CHIPS.map((label) => (
          <ContentTableConstraintChip
            key={label}
            label={label}
            removeLabel={`Remove ${label}`}
            onRemove={() => {}}
          />
        ))}
        {extra}
      </ContentTableConstraintBar>,
    ),
  );
}

function scroller() {
  return host.querySelector<HTMLElement>("[data-constraint-scroller]")!;
}

function cue(edge: "start" | "end") {
  return host.querySelector<HTMLButtonElement>(
    `[data-constraint-scroll-cue="${edge}"]`,
  );
}

// An edge with more chips past it both fades and shows its chevron.
function fadeEdges() {
  const edges = {
    start: scroller().hasAttribute("data-overflow-start"),
    end: scroller().hasAttribute("data-overflow-end"),
  };
  expect({ start: Boolean(cue("start")), end: Boolean(cue("end")) }).toEqual(
    edges,
  );
  return edges;
}

describe("constraint chips on a narrow screen", () => {
  it("keeps the view actions outside the scrolling chips", async () => {
    await render();
    const save = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Save for everyone",
    )!;
    expect(scroller().contains(save)).toBe(false);
    expect(scroller().querySelectorAll('[aria-label^="Remove "]')).toHaveLength(
      CHIPS.length,
    );
  });

  it("fades and marks each edge that has more chips past it", async () => {
    await render();
    expect(fadeEdges()).toEqual({ start: false, end: true });

    scroller().scrollLeft = 110;
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    expect(fadeEdges()).toEqual({ start: true, end: true });

    scroller().scrollLeft = 220;
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    expect(fadeEdges()).toEqual({ start: true, end: false });
  });

  it("scrolls the row toward the chevron that is tapped", async () => {
    await render();
    const scrollBy = vi.fn();
    scroller().scrollBy = scrollBy;
    await act(async () => cue("end")!.click());
    expect(scrollBy).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 255 }),
    );

    scroller().scrollLeft = 220;
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    await act(async () => cue("start")!.click());
    expect(scrollBy).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: -255 }),
    );
  });

  it("keeps the chevrons out of the tab order and away from screen readers", async () => {
    await render();
    expect(cue("end")!.tabIndex).toBe(-1);
    expect(cue("end")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("drops the fade once the chips fit, as they do when the screen widens", async () => {
    await render();
    expect(fadeEdges().end).toBe(true);

    layout = { clientWidth: 600, scrollWidth: 600 };
    await act(async () => resizeCallbacks.forEach((callback) => callback()));
    expect(fadeEdges()).toEqual({ start: false, end: false });
  });

  it("scrolls a chip that takes keyboard focus clear of the fade", async () => {
    await render();
    const reveal = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const remove = host.querySelector<HTMLButtonElement>(
      '[aria-label="Remove Priority"]',
    )!;
    await act(async () => remove.focus());
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal.mock.contexts[0]).toBe(remove);
    expect(reveal).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("leaves focus inside a chip's popover alone", async () => {
    await render(
      createPortal(<input aria-label="Filter value" />, document.body),
    );
    const reveal = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Filter value"]',
    )!;
    await act(async () => input.focus());
    expect(reveal).not.toHaveBeenCalled();
  });

  it("does nothing on focus when every chip already fits", async () => {
    layout = { clientWidth: 600, scrollWidth: 600 };
    await render();
    const reveal = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Remove Status"]')!
        .focus(),
    );
    expect(reveal).not.toHaveBeenCalled();
  });
});
