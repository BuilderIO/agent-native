// @vitest-environment happy-dom

import {
  clearAgentChatContext,
  listAgentChatContext,
  setAgentChatContextItem,
} from "@agent-native/core/client/agent-chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeClientAppState = vi.hoisted(() =>
  vi.fn(async (_key: string, value: unknown) => value),
);
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "tab-1",
  writeClientAppState,
}));

import {
  _resetAgentSelectForTests,
  getAgentSelectSnapshot,
  hitTestAgentSelectable,
  isAgentSelectableSelected,
  listAgentSelection,
  registerAgentSelectable,
  registerAgentSelectableSource,
  selectAgentSelectable,
  setAgentSelectMode,
  subscribeAgentSelectRejections,
  toggleAgentSelectable,
  type AgentSelectable,
} from "./agent-select.js";

function box(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function placedElement(rect: DOMRect, parent: Element = document.body) {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => rect;
  parent.appendChild(element);
  return element;
}

function selectable(
  kind: string,
  id: string,
  element: Element | null,
  context = `${kind} ${id} context`,
): AgentSelectable {
  return {
    kind,
    id,
    title: `${kind} ${id}`,
    getContext: () => context,
    getElement: () => element,
  };
}

/** Make elementFromPoint return the innermost stubbed element under a point. */
function stubHitTesting(elements: Element[]) {
  document.elementFromPoint = (x: number, y: number) => {
    let hit: Element | null = null;
    let hitArea = Number.POSITIVE_INFINITY;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const inside =
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (inside && rect.width * rect.height < hitArea) {
        hit = element;
        hitArea = rect.width * rect.height;
      }
    }
    return hit;
  };
}

/** A full press: down, up, then click, as a real pointer delivers it. */
function press(x: number, y: number, target: Element) {
  return ["pointerdown", "pointerup", "click"].map((type) =>
    pointer(type, x, y, target),
  );
}

function pointer(type: string, x: number, y: number, target: Element) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    detail: 1,
  });
  target.dispatchEvent(event);
  return event;
}

// Timers only: core drops a context write older than the last one, so a
// faked clock left behind by one test would swallow the next test's picks.
function useFakeTimers() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  _resetAgentSelectForTests();
  clearAgentChatContext();
  document.body.innerHTML = "";
  writeClientAppState.mockClear();
  vi.unstubAllGlobals();
});

describe("registry", () => {
  it("offers Select only while something is registered", () => {
    expect(getAgentSelectSnapshot()).toEqual({ active: false, available: 0 });
    const unregister = registerAgentSelectable(selectable("slide", "s1", null));
    expect(getAgentSelectSnapshot().available).toBe(1);
    setAgentSelectMode(true);
    expect(getAgentSelectSnapshot().active).toBe(true);
    unregister();
    expect(getAgentSelectSnapshot()).toEqual({ active: false, available: 0 });
  });

  it("refuses to enter pick mode with nothing registered", () => {
    setAgentSelectMode(true);
    expect(getAgentSelectSnapshot().active).toBe(false);
  });

  it("keeps a remounted registration when the stale cleanup runs late", () => {
    const first = registerAgentSelectable(selectable("slide", "s1", null));
    const second = registerAgentSelectable(selectable("slide", "s1", null));
    first();
    expect(getAgentSelectSnapshot().available).toBe(1);
    second();
    expect(getAgentSelectSnapshot().available).toBe(0);
  });
});

describe("context-item round trip", () => {
  it("adds and removes a picked object as an ordinary context item", () => {
    registerAgentSelectable(selectable("panel", "p:1", null, "Panel id: p:1"));

    expect(toggleAgentSelectable("panel", "p:1")).toBe("added");
    expect(listAgentChatContext()).toEqual([
      expect.objectContaining({
        key: "agent-select:panel:p%3A1",
        title: "panel p:1",
        context: "Panel id: p:1",
      }),
    ]);
    expect(isAgentSelectableSelected("panel", "p:1")).toBe(true);
    expect(listAgentSelection()).toEqual([
      { kind: "panel", id: "p:1", title: "panel p:1" },
    ]);

    expect(toggleAgentSelectable("panel", "p:1")).toBe("removed");
    expect(listAgentChatContext()).toEqual([]);
  });

  it("leaves other context chips alone", () => {
    setAgentChatContextItem({
      key: "dashboard",
      title: "Dashboard",
      context: "Revenue",
    });
    registerAgentSelectable(selectable("panel", "p1", null));
    toggleAgentSelectable("panel", "p1");
    toggleAgentSelectable("panel", "p1");
    expect(listAgentChatContext().map((item) => item.key)).toEqual([
      "dashboard",
    ]);
  });

  it("replaces picks of the same kind for an exclusive select", () => {
    registerAgentSelectable(selectable("panel", "p1", null));
    registerAgentSelectable(selectable("slide", "s1", null));
    toggleAgentSelectable("panel", "p1");
    toggleAgentSelectable("slide", "s1");

    // The target need not be registered: apps stage objects they describe.
    expect(
      selectAgentSelectable(selectable("panel", "p2", null), {
        exclusive: true,
      }),
    ).toBe("added");
    expect(listAgentSelection().map(({ kind, id }) => `${kind}:${id}`)).toEqual(
      ["slide:s1", "panel:p2"],
    );
  });

  it("releases a pick once its object unregisters for good", async () => {
    useFakeTimers();
    try {
      const unregister = registerAgentSelectable(
        selectable("slide", "s1", null),
      );
      toggleAgentSelectable("slide", "s1");
      unregister();
      await vi.advanceTimersByTimeAsync(0);
      expect(listAgentSelection()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a pick when its object remounts in the same task", async () => {
    useFakeTimers();
    try {
      const unregister = registerAgentSelectable(
        selectable("slide", "s1", null),
      );
      toggleAgentSelectable("slide", "s1");
      unregister();
      registerAgentSelectable(selectable("slide", "s1", null));
      await vi.advanceTimersByTimeAsync(0);
      expect(isAgentSelectableSelected("slide", "s1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can still release a pick whose object is no longer registered", () => {
    const unregister = registerAgentSelectable(selectable("panel", "p1", null));
    toggleAgentSelectable("panel", "p1");
    unregister();
    expect(toggleAgentSelectable("panel", "p1")).toBe("removed");
    expect(toggleAgentSelectable("panel", "p1")).toBe("not-registered");
  });

  it("refuses a pick that would overflow the composer context", () => {
    for (let index = 0; index < 32; index += 1) {
      setAgentChatContextItem({
        key: `chip-${index}`,
        title: `Chip ${index}`,
        context: "x",
      });
    }
    const rejections: string[] = [];
    subscribeAgentSelectRejections(({ reason }) => rejections.push(reason));
    registerAgentSelectable(selectable("panel", "p1", null));

    expect(toggleAgentSelectable("panel", "p1")).toBe("too-many-items");
    expect(rejections).toEqual(["too-many-items"]);
    expect(isAgentSelectableSelected("panel", "p1")).toBe(false);
  });

  it("mirrors the picked objects to application_state", async () => {
    useFakeTimers();
    try {
      registerAgentSelectable(selectable("slide", "s1", null));
      toggleAgentSelectable("slide", "s1");
      await vi.advanceTimersByTimeAsync(200);
      expect(writeClientAppState).toHaveBeenLastCalledWith(
        "agent-selection:tab-1",
        {
          items: [{ kind: "slide", id: "s1", title: "slide s1" }],
          updatedAt: expect.any(Number),
        },
        { keepalive: true },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pick mode", () => {
  function setup() {
    const slide = placedElement(box(0, 0, 400, 300));
    const title = placedElement(box(20, 20, 100, 30), slide);
    const sidebar = placedElement(box(500, 0, 300, 600));
    sidebar.className = "agent-sidebar-panel";
    stubHitTesting([slide, title, sidebar]);
    registerAgentSelectable(selectable("slide", "s1", slide));
    registerAgentSelectable(selectable("element", "e1", title));
    return { slide, title, sidebar };
  }

  it("hit-tests the innermost registered object under the pointer", () => {
    setup();
    expect(hitTestAgentSelectable(50, 30)?.id).toBe("e1");
    expect(hitTestAgentSelectable(300, 200)?.id).toBe("s1");
    expect(hitTestAgentSelectable(600, 100)).toBeNull();
  });

  it("toggles on click and keeps the press from reaching the app", () => {
    const { title } = setup();
    const appEvents: string[] = [];
    for (const type of ["pointerdown", "pointerup", "click"]) {
      title.addEventListener(type, () => appEvents.push(type));
    }
    setAgentSelectMode(true);
    expect(
      document.documentElement.hasAttribute("data-agent-select-mode"),
    ).toBe(true);

    expect(press(50, 30, title).map((event) => event.defaultPrevented)).toEqual(
      [true, true, true],
    );
    expect(appEvents).toEqual([]);
    expect(isAgentSelectableSelected("element", "e1")).toBe(true);

    press(50, 30, title);
    expect(isAgentSelectableSelected("element", "e1")).toBe(false);
  });

  it("leaves an app drag that ends over an object to the app", () => {
    const { slide, title } = setup();
    const canvas = placedElement(box(0, 0, 800, 600));
    stubHitTesting([canvas, slide, title]);
    const appRelease = vi.fn();
    title.addEventListener("pointerup", appRelease);
    setAgentSelectMode(true);

    // Starts on the canvas outside any object, ends on the title.
    expect(pointer("pointerdown", 700, 500, canvas).defaultPrevented).toBe(
      false,
    );
    expect(pointer("pointerup", 50, 30, title).defaultPrevented).toBe(false);
    expect(pointer("click", 50, 30, title).defaultPrevented).toBe(false);
    expect(appRelease).toHaveBeenCalledTimes(1);
    expect(listAgentSelection()).toEqual([]);
  });

  it("forgets a canceled press, so a later keyboard click reaches the app", () => {
    const { title } = setup();
    const appClick = vi.fn();
    title.addEventListener("click", appClick);
    setAgentSelectMode(true);

    pointer("pointerdown", 50, 30, title);
    title.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    const keyboardClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    title.dispatchEvent(keyboardClick);

    expect(keyboardClick.defaultPrevented).toBe(false);
    expect(appClick).toHaveBeenCalledTimes(1);
    expect(listAgentSelection()).toEqual([]);
  });

  it("lets clicks outside registered objects through", () => {
    const { sidebar } = setup();
    const sidebarClick = vi.fn();
    sidebar.addEventListener("click", sidebarClick);
    setAgentSelectMode(true);
    expect(
      press(600, 100, sidebar).map((event) => event.defaultPrevented),
    ).toEqual([false, false, false]);
    expect(sidebarClick).toHaveBeenCalledTimes(1);
    expect(listAgentSelection()).toEqual([]);
  });

  it("does nothing to clicks once pick mode is off", () => {
    const { title } = setup();
    setAgentSelectMode(true);
    setAgentSelectMode(false);
    expect(press(50, 30, title).some((event) => event.defaultPrevented)).toBe(
      false,
    );
    expect(listAgentSelection()).toEqual([]);
  });

  it("exits on Escape and keeps the key from the app", () => {
    setup();
    const appKey = vi.fn();
    document.body.addEventListener("keydown", appKey);
    setAgentSelectMode(true);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(appKey).not.toHaveBeenCalled();
    expect(getAgentSelectSnapshot().active).toBe(false);
    expect(
      document.documentElement.hasAttribute("data-agent-select-mode"),
    ).toBe(false);
  });

  it("resolves dynamic content through a source", () => {
    const { slide } = setup();
    const bullet = placedElement(box(40, 100, 200, 20), slide);
    stubHitTesting([slide, bullet]);
    registerAgentSelectableSource({
      resolve: (target) =>
        target === bullet ? selectable("element", "bullet-1", bullet) : null,
    });
    setAgentSelectMode(true);

    press(60, 110, bullet);
    expect(listAgentSelection()).toEqual([
      { kind: "element", id: "bullet-1", title: "element bullet-1" },
    ]);
    // Picked source objects stay toggleable after the pointer moves on.
    press(60, 110, bullet);
    expect(listAgentSelection()).toEqual([]);
  });

  it("releases picks resolved inside an object when it goes away", async () => {
    const slide = placedElement(box(0, 0, 400, 300));
    const bullet = placedElement(box(40, 100, 200, 20), slide);
    stubHitTesting([slide, bullet]);
    const unregisterSlide = registerAgentSelectable(
      selectable("slide", "s1", slide),
    );
    registerAgentSelectableSource({
      resolve: (target) =>
        target === bullet
          ? {
              ...selectable("element", "s1/bullet", bullet),
              parent: { kind: "slide", id: "s1" },
            }
          : null,
    });
    setAgentSelectMode(true);
    press(60, 110, bullet);
    setAgentSelectMode(false);
    expect(listAgentSelection().map(({ id }) => id)).toEqual(["s1/bullet"]);

    unregisterSlide();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listAgentSelection()).toEqual([]);
  });

  describe("deleted children", () => {
    function pickChild() {
      const slide = placedElement(box(0, 0, 400, 300));
      let bullet = placedElement(box(40, 100, 200, 20), slide);
      stubHitTesting([slide, bullet]);
      registerAgentSelectable(selectable("slide", "s1", slide));
      registerAgentSelectableSource({
        resolve: (target) =>
          target === bullet
            ? {
                ...selectable("element", "s1/bullet", null),
                parent: { kind: "slide", id: "s1" },
                // Looks the node up again, as adapters do by stable id.
                getElement: () => slide.querySelector("[data-bullet]"),
              }
            : null,
      });
      bullet.setAttribute("data-bullet", "");
      setAgentSelectMode(true);
      press(60, 110, bullet);
      setAgentSelectMode(false);
      return {
        slide,
        replaceBullet: () => {
          bullet.remove();
          bullet = placedElement(box(40, 100, 200, 20), slide);
          bullet.setAttribute("data-bullet", "");
        },
        deleteBullet: () => bullet.remove(),
      };
    }

    it("releases a child deleted while its parent stays on screen", async () => {
      useFakeTimers();
      try {
        const { deleteBullet } = pickChild();
        deleteBullet();
        await vi.advanceTimersByTimeAsync(1000);
        expect(listAgentSelection()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(listAgentSelection()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a child its parent re-rendered", async () => {
      useFakeTimers();
      try {
        const { replaceBullet } = pickChild();
        replaceBullet();
        await vi.advanceTimersByTimeAsync(3000);
        expect(listAgentSelection().map(({ id }) => id)).toEqual(["s1/bullet"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a child whose parent is not rendered", async () => {
      useFakeTimers();
      try {
        const { slide } = pickChild();
        slide.remove();
        await vi.advanceTimersByTimeAsync(3000);
        expect(listAgentSelection().map(({ id }) => id)).toEqual(["s1/bullet"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("hit-tests every element of a multi-element object", () => {
    const canvas = placedElement(box(0, 0, 400, 300));
    const thumbnail = placedElement(box(0, 400, 80, 60));
    stubHitTesting([canvas, thumbnail]);
    registerAgentSelectable({
      ...selectable("slide", "s1", null),
      getElement: () => [canvas, thumbnail],
    });
    expect(hitTestAgentSelectable(200, 150)?.id).toBe("s1");
    expect(hitTestAgentSelectable(40, 430)?.id).toBe("s1");
  });

  it("outlines hovered and picked objects", async () => {
    const { title } = setup();
    setAgentSelectMode(true);
    toggleAgentSelectable("slide", "s1");
    title.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 50,
        clientY: 30,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const hover = document.querySelector<HTMLElement>(
      '[data-agent-select-outline="hover"]',
    );
    expect(hover?.style.display).toBe("");
    expect(hover?.style.width).toBe("100px");
    expect(hover?.textContent).toBe("element e1");
    expect(
      document.querySelectorAll('[data-agent-select-outline="selected"]'),
    ).toHaveLength(1);

    setAgentSelectMode(false);
    expect(document.querySelector("[data-agent-select-layer]")).toBeNull();
  });
});
