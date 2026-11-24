// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ShellActionEffect,
  ShellRename,
  SidebarReorderPolicy,
  SidebarResizePolicy,
} from "./contracts.js";
import {
  useNavigationDisclosure,
  useNavigationFocusHandoff,
  useNavigationHistory,
  useNavigationOpener,
  useNavigationPreferences,
  useNavigationRename,
  useNavigationReorder,
  useShellShortcuts,
  useSidebarCollapse,
  useSidebarPeek,
  useSidebarResize,
  type NavigationHistoryPolicy,
  type ShellShortcutEvent,
} from "./shell-hooks.js";
import {
  decodeSidebarCollapse,
  isShellRouteActive,
  mergeVisibleNavigationOrder,
  readShellPreference,
  shellConditionState,
  sidebarCollapseAtPhase,
  type SidebarCollapsePolicy,
} from "./shell-policies.js";

let root: Root;
let host: HTMLDivElement;
function mount<T>(hook: () => T) {
  const box: { current?: T } = {};
  function Harness() {
    box.current = hook();
    return null;
  }
  const render = () => act(() => root.render(createElement(Harness)));
  render();
  return {
    get value(): T {
      if (box.current === undefined) throw new Error("Harness not mounted");
      return box.current;
    },
    render,
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const collapse: SidebarCollapsePolicy = {
  key: "test.navigation",
  encoding: "zero-one",
  defaultCollapsed: false,
  writeOnReady: "never",
  boot: { absent: true, invalid: false, unavailable: false },
  widths: { expanded: 244, collapsed: 8, bootCollapsed: 8 },
};
const resize: SidebarResizePolicy = {
  min: 244,
  max: 340,
  step: 4,
  shiftStep: 16,
  reset: 244,
  round: true,
  keyboard: true,
  pointerCancel: "restore-start-and-commit",
  lostPointerCapture: "restore-start-and-commit",
  persist: "end",
  storageKey: "test.width",
  codec: "decimal",
};
const reorder: SidebarReorderPolicy = {
  containerId: "primary",
  pointerThreshold: 4,
  collision: "closestCenter",
  keyboard: { start: "Space", move: "arrows", end: "Space", cancel: "Escape" },
  cancel: "restore-order",
  missingDropTarget: "no-commit",
  merge: "visible-into-complete-order",
  persist: "server",
  disableWhileEffectPending: true,
};
function effect(run = vi.fn()): ShellActionEffect {
  return { id: "save", kind: "action", actionName: "save-navigation", run };
}

describe("collapse storage and phase policy", () => {
  it.each([
    ["zero-one", "1", true],
    ["zero-one", "0", false],
    ["zero-one", "true", undefined],
    ["zero-one", "false", undefined],
    ["true-false", "true", true],
    ["true-false", "false", false],
    ["true-false", "0", undefined],
    ["true-false", "1", undefined],
    ["zero-one", "", undefined],
    ["true-false", "invalid", undefined],
  ] as const)(
    "decodes %s / %s without migrating it",
    (encoding, raw, expected) => {
      expect(decodeSidebarCollapse(raw, encoding)).toBe(expected);
    },
  );
  it("separates absent, invalid and inaccessible storage", () => {
    expect(
      readShellPreference(
        () => ({ getItem: () => null, setItem() {} }),
        "x",
        (raw) => decodeSidebarCollapse(raw, "zero-one"),
      ),
    ).toEqual({ status: "absent" });
    expect(
      readShellPreference(
        () => ({ getItem: () => "true", setItem() {} }),
        "x",
        (raw) => decodeSidebarCollapse(raw, "zero-one"),
      ),
    ).toEqual({ status: "invalid", rawValue: "true" });
    expect(
      readShellPreference(
        () => {
          throw new Error("denied");
        },
        "x",
        (raw) => raw,
      ).status,
    ).toBe("unavailable");
  });
  it("retains the boot-width conflict and commits persisted collapse synchronously in layout before paint", () => {
    expect(
      sidebarCollapseAtPhase(collapse, { status: "absent" }, "boot"),
    ).toEqual({ collapsed: true, width: 8 });
    expect(
      sidebarCollapseAtPhase(collapse, { status: "absent" }, "ready"),
    ).toEqual({ collapsed: false, width: 244 });
    const store = new Map([[collapse.key, "1"]]);
    const writes = vi.fn((key: string, value: string) => {
      store.set(key, value);
    });
    const access = () => ({
      getItem: (key: string) => store.get(key) ?? null,
      setItem: writes,
    });
    const observations: boolean[] = [];
    function Child() {
      const state = useSidebarCollapse(collapse, access);
      return createElement("div", {
        "data-collapsed": String(state.collapsed),
      });
    }
    function Parent() {
      useLayoutEffect(() => {
        observations.push(
          host.querySelector("div")?.getAttribute("data-collapsed") === "true",
        );
      });
      return createElement(Child);
    }
    act(() => root.render(createElement(Parent)));
    expect(host.querySelector("div")?.getAttribute("data-collapsed")).toBe(
      "true",
    );
    expect(writes).not.toHaveBeenCalled();
    expect(observations.length).toBe(1);
  });
  it.each(["never", "valid-only", "always"] as const)(
    "applies %s mount writes and preserves raw invalid strings otherwise",
    (writeOnReady) => {
      let raw: string | null = "false";
      const writes = vi.fn((_key: string, value: string) => {
        raw = value;
      });
      const access = () => ({ getItem: () => raw, setItem: writes });
      const policy = { ...collapse, writeOnReady };
      const hook = mount(() => useSidebarCollapse(policy, access));
      expect(hook.value.collapsed).toBe(false);
      expect(hook.value.stored.status).toBe("invalid");
      expect(raw).toBe(writeOnReady === "always" ? "0" : "false");
      act(() => {
        hook.value.setCollapsed((value) => !value);
        hook.value.setCollapsed((value) => !value);
      });
      expect(hook.value.collapsed).toBe(false);
      expect(raw).toBe("0");
      writes.mockImplementation(() => {
        throw new Error("denied");
      });
      act(() => hook.value.setCollapsed(true));
      expect(hook.value.collapsed).toBe(true);
      expect(hook.value.stored.status).toBe("unavailable");
    },
  );
});

describe("resize policy", () => {
  it("previews without end persistence, clamps, cancels to start, and supports all keyboard bounds", async () => {
    const saved = effect();
    const hook = mount(() => {
      const [value, set] = useState(260);
      return {
        width: value,
        engine: useSidebarResize(resize, { value, set }, [saved], "save"),
      };
    });
    act(() => {
      hook.value.engine.begin(100);
    });
    await act(async () => {
      await hook.value.engine.move(300);
    });
    expect(hook.value.width).toBe(340);
    expect(saved.run).not.toHaveBeenCalled();
    await act(async () => {
      await hook.value.engine.cancel();
    });
    expect(hook.value.width).toBe(260);
    expect(saved.run).toHaveBeenLastCalledWith(260);
    await act(async () => {
      await hook.value.engine.key("ArrowRight", true);
    });
    expect(hook.value.width).toBe(276);
    await act(async () => {
      await hook.value.engine.key("Home");
    });
    expect(hook.value.width).toBe(244);
    await act(async () => {
      await hook.value.engine.key("End");
    });
    expect(hook.value.width).toBe(340);
    await act(async () => {
      await hook.value.engine.reset();
    });
    expect(hook.value.width).toBe(244);
    act(() => {
      hook.value.engine.begin(0);
    });
    await act(async () => {
      await hook.value.engine.move(40);
      await hook.value.engine.lostCapture();
    });
    expect(hook.value.width).toBe(244);
  });
  it("keeps fractional pointer-only widths and commits each change and cancel-current", async () => {
    const policy: SidebarResizePolicy = {
      ...resize,
      min: 192,
      max: 330,
      round: false,
      keyboard: false,
      reset: undefined,
      persist: "change",
      pointerCancel: "commit-current",
      lostPointerCapture: "unbound",
    };
    const saved = effect();
    const hook = mount(() => {
      const [value, set] = useState(192);
      return {
        width: value,
        engine: useSidebarResize(policy, { value, set }, [saved], "save"),
      };
    });
    act(() => {
      hook.value.engine.begin(10);
    });
    await act(async () => {
      await hook.value.engine.move(20.5);
    });
    expect(hook.value.width).toBe(202.5);
    expect(saved.run).toHaveBeenLastCalledWith(202.5);
    await act(async () => {
      await hook.value.engine.cancel();
    });
    expect(hook.value.width).toBe(202.5);
    expect(saved.run).toHaveBeenCalledTimes(2);
    expect(await hook.value.engine.key("Home")).toBe(false);
    expect(await hook.value.engine.reset()).toBe(false);
  });
});

it("dismisses mobile navigation on route changes and restores only explicitly dismissed focus", () => {
  let routeKey = "/one";
  const focus = vi.fn();
  const hook = mount(() =>
    useNavigationOpener({
      initialOpen: true,
      routeKey,
      dismissOnNavigation: true,
      returnFocus: focus,
    }),
  );
  routeKey = "/two";
  hook.render();
  expect(hook.value.open).toBe(false);
  expect(focus).not.toHaveBeenCalled();
  act(() => hook.value.show());
  expect(hook.value.open).toBe(true);
  act(() => hook.value.dismiss());
  expect(focus).toHaveBeenCalledOnce();
});
it("applies peek delays and cancels timers when expanded or unmounted", () => {
  vi.useFakeTimers();
  let collapsed = true;
  const hook = mount(() =>
    useSidebarPeek({ collapsed, openDelayMs: 120, closeDelayMs: 200 }),
  );
  act(() => {
    hook.value.enter();
    vi.advanceTimersByTime(119);
  });
  expect(hook.value.open).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(hook.value.open).toBe(true);
  act(() => {
    hook.value.leave();
    vi.advanceTimersByTime(199);
  });
  expect(hook.value.open).toBe(true);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(hook.value.open).toBe(false);
  act(() => hook.value.enter());
  collapsed = false;
  hook.render();
  act(() => {
    vi.advanceTimersByTime(120);
  });
  expect(hook.value.open).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it("reveals the active team, expands new favorites and toggles a bounded group", () => {
  let active = "a";
  let favorites: readonly string[] = [];
  const hook = mount(() =>
    useNavigationDisclosure(
      [],
      { revealActive: true, expandNewFavorites: true },
      active,
      favorites,
    ),
  );
  expect([...hook.value.openKeys]).toEqual(["a"]);
  active = "b";
  favorites = ["c"];
  hook.render();
  expect([...hook.value.openKeys]).toEqual(["a", "b", "c"]);
  act(() => hook.value.toggle("a", ["a", "b"]));
  expect([...hook.value.openKeys]).toEqual(["c"]);
});
it("keeps rename local, ignores empty/unchanged input, respects row blur, and commits once", async () => {
  const saved = effect();
  const hook = mount(() => {
    const [value, set] = useState("First");
    const [editing, setEditing] = useState(false);
    const rename: ShellRename = {
      binding: { value, set },
      editing: { value: editing, set: setEditing },
      controlLabel: "Rename",
      trim: true,
      ignoreEmpty: true,
      ignoreUnchanged: true,
      commitOnBlur: true,
      cancelKey: "Escape",
      submitKey: "Enter",
      commitEffectId: "save",
      autoFocus: true,
      blurBoundary: "row",
    };
    return { editing, value, engine: useNavigationRename(rename, [saved]) };
  });
  act(() => hook.value.engine.begin());
  act(() => hook.value.engine.setDraft("  Renamed  "));
  expect(await hook.value.engine.blur(true)).toBe(false);
  expect(saved.run).not.toHaveBeenCalled();
  await act(async () => {
    await hook.value.engine.key("Enter");
    await hook.value.engine.blur(false);
  });
  expect(saved.run).toHaveBeenCalledExactlyOnceWith("Renamed");
  expect(hook.value.editing).toBe(false);
  act(() => hook.value.engine.begin());
  act(() => hook.value.engine.setDraft(" "));
  await act(async () => {
    await hook.value.engine.commit();
  });
  expect(saved.run).toHaveBeenCalledOnce();
  act(() => hook.value.engine.begin());
  act(() => hook.value.engine.setDraft("discard"));
  await act(async () => {
    await hook.value.engine.key("Escape");
  });
  expect(hook.value.value).toBe("Renamed");
});
it("enforces reorder thresholds, restores on cancellation, merges hidden siblings and locks pending effects", async () => {
  const saved = effect();
  let complete: readonly string[] = ["a", "hidden", "b"];
  const preview = vi.fn((keys: readonly string[]) => {
    complete = keys;
  });
  const hook = mount(() =>
    useNavigationReorder(
      reorder,
      { complete, visible: ["a", "b"] },
      preview,
      [saved],
      "save",
    ),
  );
  act(() => {
    hook.value.begin("a", 0, 0);
    expect(hook.value.over("b", 3, 0)).toBe(false);
  });
  expect(preview).not.toHaveBeenCalled();
  act(() => {
    expect(hook.value.over("b", 4, 0)).toBe(true);
    hook.value.previewVisible(["b", "a"]);
  });
  expect(complete).toEqual(["b", "hidden", "a"]);
  act(() => hook.value.cancel());
  expect(complete).toEqual(["a", "hidden", "b"]);
  expect(saved.run).not.toHaveBeenCalled();
  await act(async () => {
    await hook.value.key(" ", "a");
    await hook.value.key("ArrowDown", "a");
    await hook.value.key(" ", "a");
  });
  expect(saved.run).toHaveBeenLastCalledWith(["b", "hidden", "a"]);
  saved.pending = true;
  act(() => {
    expect(hook.value.begin("a", 0, 0)).toBe(false);
  });
  expect(mergeVisibleNavigationOrder(["a", "hidden", "b"], ["b", "a"])).toEqual(
    ["b", "hidden", "a"],
  );
  expect(() => mergeVisibleNavigationOrder(["a"], ["unknown"])).toThrow();
});
it("preserves session key spelling, inherited detail context, search/hash, current-section no-op and malformed read diagnostics", () => {
  const values = new Map<string, string>();
  const access = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  const policy: NavigationHistoryPolicy = {
    activeKey: "tab:active",
    destinationKey: (section) => `tab:dest:${section}`,
    sections: ["one", "two"],
    fallbacks: { one: "/one", two: "/two" },
    resolveSection: (location, previous) =>
      location.pathname.startsWith("/detail")
        ? (previous ?? "one")
        : location.pathname.startsWith("/two")
          ? "two"
          : "one",
    belongsTo: (to, section) =>
      to.startsWith(`/${section}`) || to.startsWith("/detail"),
    restoreScrollPosition: true,
  };
  let location = { pathname: "/one", search: "?q=x", hash: "#item" };
  const hook = mount(() => useNavigationHistory(policy, access, location));
  expect(values.get("tab:dest:one")).toBe('{"to":"/one?q=x#item"}');
  expect(hook.value.target("one")).toEqual({ kind: "current" });
  location = { pathname: "/detail/1", search: "?mode=all", hash: "#note" };
  hook.render();
  expect(hook.value.active).toBe("one");
  location = { pathname: "/two", search: "", hash: "" };
  hook.render();
  expect(hook.value.target("one")).toMatchObject({
    kind: "navigate",
    to: "/detail/1?mode=all#note",
    state: { restoreScrollPosition: true },
  });
  values.set("tab:dest:two", "bad");
  location = { pathname: "/one", search: "", hash: "" };
  hook.render();
  expect(hook.value.target("two")).toMatchObject({
    to: "/two",
    stored: { status: "invalid" },
  });
});
it("delegates shortcut ownership once with platform, focus, repeat and composition guards", () => {
  const dispatch = vi.fn();
  const hook = mount(() =>
    useShellShortcuts(
      "shell",
      [
        {
          id: "search",
          actionName: "search",
          ownerId: "shell",
          keys: [{ key: "k", mod: true }],
          displayLabel: "⌘ K",
          platform: "all",
          scope: "navigation",
          phase: "capture",
          guard: {
            focusKinds: ["page"],
            allowRepeat: false,
            composition: "ignore",
            overlay: "ignore",
            respectDefaultPrevented: true,
          },
        },
      ],
      dispatch,
    ),
  );
  const event: ShellShortcutEvent = {
    key: "k",
    code: "KeyK",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
  };
  const context = {
    platform: "mac" as const,
    scope: "navigation",
    phase: "capture" as const,
    focusKind: "page",
    overlayOpen: false,
    pausedOwners: [],
  };
  expect(hook.value(event, context)).toBe(true);
  expect(hook.value(event, context)).toBe(false);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("search");
  expect(hook.value({ ...event }, { ...context, focusKind: "field" })).toBe(
    false,
  );
  expect(hook.value({ ...event, repeat: true }, context)).toBe(false);
  expect(hook.value({ ...event, isComposing: true }, context)).toBe(false);
  expect(
    hook.value(
      { ...event, metaKey: false, ctrlKey: true },
      { ...context, platform: "other" },
    ),
  ).toBe(true);
});
it("shares preference ordering/visibility with the customizer and suppresses writes on failed reads", async () => {
  let read: import("./contracts.js").ShellReadState = {
    status: "error",
    message: "unavailable",
  };
  const saved = effect();
  const set = vi.fn();
  const hook = mount(() =>
    useNavigationPreferences(
      [
        { key: "a", visibility: "always", badged: false },
        { key: "b", visibility: "badged", badged: false },
        { key: "c", visibility: "more", badged: true },
      ],
      { value: ["c", "a", "b"], set },
      read,
      [saved],
      "save",
    ),
  );
  expect(hook.value.visible.map((item) => item.key)).toEqual(["a"]);
  expect(hook.value.more.map((item) => item.key)).toEqual(["c", "b"]);
  expect(await hook.value.reorderVisible(["a"])).toBe(false);
  expect(saved.run).not.toHaveBeenCalled();
  read = { status: "ready" };
  hook.render();
  expect(await hook.value.changeVisibility("b", "always", "save")).toBe(true);
  expect(saved.run).toHaveBeenLastCalledWith({
    key: "b",
    visibility: "always",
  });
});
it("returns focus once to the remembered trigger", () => {
  const hook = mount(useNavigationFocusHandoff);
  const focus = vi.fn();
  hook.value.remember({ focus });
  hook.value.restore();
  hook.value.restore();
  expect(focus).toHaveBeenCalledOnce();
});
it("resolves longest and segment route rules without granting denied gates", () => {
  expect(
    isShellRouteActive(
      { kind: "prefix", path: "/one", boundary: "segment" },
      "/ones",
    ),
  ).toBe(false);
  expect(
    isShellRouteActive(
      { kind: "longest-match", destination: "/one" },
      "/one/two",
      ["/one/two"],
    ),
  ).toBe(false);
  expect(
    shellConditionState({
      gate: { key: "admin", allowed: false, denied: "hidden" },
    }),
  ).toEqual({ visible: false, disabled: false });
});

it("accepts inline collapse policy and storage access without repeated layout reads", () => {
  const getItem = vi.fn(() => "1");
  const hook = mount(() =>
    useSidebarCollapse({ ...collapse }, () => ({ getItem, setItem() {} })),
  );
  expect(hook.value.collapsed).toBe(true);
  expect(getItem).toHaveBeenCalledOnce();
  hook.render();
  expect(getItem).toHaveBeenCalledOnce();
  act(() => hook.value.reload());
  expect(getItem).toHaveBeenCalledTimes(2);
});
it("keeps an active team manually closed until the active route changes", () => {
  let active = "a";
  const hook = mount(() =>
    useNavigationDisclosure(
      [],
      { revealActive: true, expandNewFavorites: true },
      active,
    ),
  );
  expect([...hook.value.openKeys]).toEqual(["a"]);
  act(() => hook.value.toggle("a"));
  expect([...hook.value.openKeys]).toEqual([]);
  hook.render();
  expect([...hook.value.openKeys]).toEqual([]);
  active = "b";
  hook.render();
  expect([...hook.value.openKeys]).toEqual(["b"]);
});
it("supports the vertical resize keys as the same grow and shrink operations", async () => {
  const saved = effect();
  const hook = mount(() => {
    const [value, set] = useState(260);
    return {
      value,
      engine: useSidebarResize(resize, { value, set }, [saved], "save"),
    };
  });
  await act(async () => {
    expect(await hook.value.engine.key("ArrowUp")).toBe(true);
  });
  expect(hook.value.value).toBe(264);
  await act(async () => {
    expect(await hook.value.engine.key("ArrowDown", true)).toBe(true);
  });
  expect(hook.value.value).toBe(248);
});
it("tracks every shared chord prefix and expires incomplete sequences", () => {
  const dispatch = vi.fn();
  const descriptors = ["p", "c", "r"].map((key) => ({
    id: key,
    actionName: key,
    ownerId: "shell",
    keys: [{ key: "g" }, { key }],
    displayLabel: `G ${key}`,
    platform: "all" as const,
    scope: "navigation",
    phase: "capture" as const,
    sequenceTimeoutMs: 100,
    guard: {
      focusKinds: ["page"],
      allowRepeat: false,
      composition: "ignore" as const,
      overlay: "ignore" as const,
      respectDefaultPrevented: true,
    },
  }));
  const hook = mount(() => useShellShortcuts("shell", descriptors, dispatch));
  const context = {
    platform: "mac" as const,
    scope: "navigation",
    phase: "capture" as const,
    focusKind: "page",
    overlayOpen: false,
    pausedOwners: [],
  };
  const event = (key: string): ShellShortcutEvent => ({
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
  });
  for (const key of ["p", "c", "r"]) {
    expect(hook.value(event("g"), context, 0)).toBe(true);
    expect(hook.value(event(key), context, 50)).toBe(true);
    expect(dispatch).toHaveBeenLastCalledWith(key);
  }
  expect(dispatch).toHaveBeenCalledTimes(3);
  hook.value(event("g"), context, 1000);
  expect(hook.value(event("c"), context, 1101)).toBe(false);
  expect(dispatch).toHaveBeenCalledTimes(3);
});
it("keeps navigation history stable with inline policies/access callbacks", () => {
  const getItem = vi.fn(() => null);
  const setItem = vi.fn();
  const hook = mount(() =>
    useNavigationHistory(
      {
        activeKey: "tab:active",
        destinationKey: (key) => `tab:dest:${key}`,
        sections: ["one", "two"],
        fallbacks: { one: "/one", two: "/two" },
        resolveSection: (location) =>
          location.pathname === "/two" ? "two" : "one",
        belongsTo: (to, section) => to.startsWith(`/${section}`),
        restoreScrollPosition: true,
      },
      () => ({ getItem, setItem }),
      { pathname: "/one" },
    ),
  );
  expect(hook.value.active).toBe("one");
  expect(getItem).toHaveBeenCalledOnce();
  expect(setItem).toHaveBeenCalledTimes(2);
  hook.render();
  expect(setItem).toHaveBeenCalledTimes(2);
});

it("preserves bubble-phase chord progress when the same event first visits capture", () => {
  const dispatch = vi.fn();
  const guard = {
    focusKinds: ["page"],
    allowRepeat: false,
    composition: "ignore" as const,
    overlay: "ignore" as const,
    respectDefaultPrevented: true,
  };
  const descriptors = ["p", "c"].map((key) => ({
    id: key,
    actionName: key,
    ownerId: "shell",
    keys: [{ key: "g" }, { key }],
    displayLabel: `G ${key}`,
    platform: "all" as const,
    scope: "navigation",
    phase: "bubble" as const,
    sequenceTimeoutMs: 100,
    guard,
  }));
  const hook = mount(() => useShellShortcuts("shell", descriptors, dispatch));
  const context = {
    platform: "mac" as const,
    scope: "navigation",
    phase: "capture" as const,
    focusKind: "page",
    overlayOpen: false,
    pausedOwners: [],
  };
  for (const [key, now] of [
    ["g", 0],
    ["c", 50],
  ] as const) {
    const event: ShellShortcutEvent = {
      key,
      code: `Key${key.toUpperCase()}`,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
    };
    expect(hook.value(event, context, now)).toBe(false);
    expect(hook.value(event, { ...context, phase: "bubble" }, now)).toBe(true);
  }
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("c");
});

it("keeps a chord sequence in flight while a modifier for its next chord is pressed", () => {
  const dispatch = vi.fn();
  const descriptors = [
    {
      id: "help",
      actionName: "help",
      ownerId: "shell",
      keys: [{ key: "g" }, { key: "?", shift: true }],
      displayLabel: "G ?",
      platform: "all" as const,
      scope: "navigation",
      phase: "capture" as const,
      sequenceTimeoutMs: 100,
      guard: {
        focusKinds: ["page"],
        allowRepeat: false,
        composition: "ignore" as const,
        overlay: "ignore" as const,
        respectDefaultPrevented: true,
      },
    },
  ];
  const hook = mount(() => useShellShortcuts("shell", descriptors, dispatch));
  const context = {
    platform: "mac" as const,
    scope: "navigation",
    phase: "capture" as const,
    focusKind: "page",
    overlayOpen: false,
    pausedOwners: [],
  };
  const event = (key: string, shiftKey = false): ShellShortcutEvent => ({
    key,
    code: key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
  });
  expect(hook.value(event("g"), context, 0)).toBe(true);
  expect(hook.value(event("Shift", true), context, 20)).toBe(false);
  expect(hook.value(event("?", true), context, 40)).toBe(true);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("help");
  hook.value(event("g"), context, 1000);
  hook.value(event("Shift", true), context, 1090);
  expect(hook.value(event("?", true), context, 1101)).toBe(false);
  hook.value(event("g"), context, 2000);
  hook.value(event("x"), context, 2010);
  expect(hook.value(event("?", true), context, 2020)).toBe(false);
  expect(dispatch).toHaveBeenCalledOnce();
});

it("keeps the last section and writes nothing when a route resolves outside every section", () => {
  const values = new Map<string, string>();
  const access = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  const policy: NavigationHistoryPolicy = {
    activeKey: "tab:active",
    destinationKey: (section) => `tab:dest:${section}`,
    sections: ["one", "two"],
    fallbacks: { one: "/one", two: "/two" },
    resolveSection: (location) =>
      location.pathname.startsWith("/two")
        ? "two"
        : location.pathname.startsWith("/one")
          ? "one"
          : "elsewhere",
    belongsTo: (to, section) => to.startsWith(`/${section}`),
    restoreScrollPosition: false,
  };
  let location = { pathname: "/two", search: "", hash: "" };
  const hook = mount(() => useNavigationHistory(policy, access, location));
  expect(hook.value.active).toBe("two");
  const before = new Map(values);
  location = { pathname: "/unmapped", search: "", hash: "" };
  expect(() => hook.render()).not.toThrow();
  expect(hook.value.active).toBe("two");
  expect(hook.value.persistence).toEqual({
    status: "invalid",
    rawValue: "elsewhere",
  });
  expect(values).toEqual(before);
  location = { pathname: "/one", search: "", hash: "" };
  hook.render();
  expect(hook.value.active).toBe("one");
  expect(hook.value.persistence.status).toBe("value");
  expect(hook.value.target("two")).toMatchObject({ to: "/two" });
});

it.each([
  {
    label: "initial stored section",
    initial: true,
    stored: "one",
    active: "one",
  },
  {
    label: "changed key with history",
    initial: false,
    stored: "one",
    active: "one",
  },
  {
    label: "changed key without history",
    initial: false,
    stored: null,
    active: undefined,
  },
  {
    label: "changed key with invalid history",
    initial: false,
    stored: "other",
    active: undefined,
  },
])(
  "uses the current storage key on an unresolved route: $label",
  ({ initial, stored, active }) => {
    const values = new Map<string, string>();
    if (stored !== null) values.set("tab:b:active", stored);
    const setItem = vi.fn((key: string, value: string) =>
      values.set(key, value),
    );
    const access = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
    });
    let namespace = initial ? "tab:b" : "tab:a";
    let location = { pathname: initial ? "/unmapped" : "/two" };
    const hook = mount(() =>
      useNavigationHistory(
        {
          activeKey: `${namespace}:active`,
          destinationKey: (section) => `${namespace}:dest:${section}`,
          sections: ["one", "two"],
          fallbacks: { one: "/one", two: "/two" },
          resolveSection: (current) =>
            current.pathname === "/two" ? "two" : "unresolved",
          belongsTo: (to, section) => to.startsWith(`/${section}`),
          restoreScrollPosition: false,
        },
        access,
        location,
      ),
    );
    const mappedThenUnmapped: (string | undefined)[] = [];
    if (!initial) {
      mappedThenUnmapped.push(hook.value.active);
      location = { pathname: "/unmapped" };
      hook.render();
      mappedThenUnmapped.push(hook.value.active);
      setItem.mockClear();
    }
    expect(mappedThenUnmapped).toEqual(initial ? [] : ["two", "two"]);
    const before = new Map(values);
    if (!initial) {
      namespace = "tab:b";
      hook.render();
    }
    expect(hook.value.active).toBe(active);
    expect(hook.value.persistence).toEqual({
      status: "invalid",
      rawValue: "unresolved",
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(values).toEqual(before);
  },
);
