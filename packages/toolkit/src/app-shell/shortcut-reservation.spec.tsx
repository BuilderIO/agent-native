// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ShellShortcutDescriptor } from "./contracts.js";
import {
  useShellShortcuts,
  type ShellShortcutContext,
  type ShellShortcutEvent,
} from "./shell-hooks.js";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const context: ShellShortcutContext = {
  platform: "mac",
  scope: "navigation",
  phase: "capture",
  focusKind: "page",
  overlayOpen: false,
  pausedOwners: [],
};
const descriptor: ShellShortcutDescriptor = {
  id: "projects",
  actionName: "projects",
  ownerId: "shell",
  keys: [{ key: "g" }, { key: "p" }],
  displayLabel: "G P",
  platform: "all",
  scope: "navigation",
  phase: "capture",
  sequenceTimeoutMs: 1200,
  sequencePolicy: {
    expiry: "exclusive",
    unmatched: "reserve",
    modifiers: "consume",
    guardRejected: {
      modifiers: "preserve",
      repeat: "preserve",
      overlay: "preserve",
    },
  },
  guard: {
    focusKinds: ["page"],
    allowRepeat: false,
    composition: "allow",
    overlay: "ignore",
    respectDefaultPrevented: false,
    rejectModifiers: ["ctrl", "alt", "meta"],
  },
};
function key(value: string, overrides: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", {
    key: value,
    code: `Key${value.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
}
function mount(items: readonly ShellShortcutDescriptor[] = [descriptor]) {
  const dispatch = vi.fn();
  let handler: ReturnType<typeof useShellShortcuts>;
  function Harness() {
    handler = useShellShortcuts("shell", items, dispatch);
    return null;
  }
  act(() => root.render(createElement(Harness)));
  return { read: () => handler, dispatch };
}

it.each(["Shift", "g", "x"])(
  "reserves unmatched %s in the boolean API and ends the prefix",
  (suffix) => {
    const { read, dispatch } = mount();
    expect(read()(key("g"), context, 0)).toBe(true);
    expect(read()(key(suffix), context, 1199)).toBe(true);
    expect(read()(key("p"), context, 1199)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  },
);
it.each(["ctrlKey", "altKey", "metaKey"] as const)(
  "ignores %s rejection before consuming progress without extending its window",
  (modifier) => {
    const { read, dispatch } = mount();
    read()(key("g"), context, 0);
    expect(read()(key("x", { [modifier]: true }), context, 1100)).toBe(false);
    expect(read()(key("p"), context, 1199)).toBe(true);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("projects");
    read()(key("g"), context, 2000);
    read()(key("x", { [modifier]: true }), context, 3100);
    expect(read()(key("p"), context, 3200)).toBe(false);
    expect(dispatch).toHaveBeenCalledOnce();
  },
);
it.each(["Shift", "g", "x"])(
  "distinguishes reserved %s from unhandled and dispatched in native capture/bubble delegation",
  (suffix) => {
    const { read, dispatch } = mount([
      {
        ...descriptor,
        activation: { phase: "bubble", guard: descriptor.guard },
      },
    ]);
    const observations: unknown[] = [];
    let now = 0;
    const capture = (event: KeyboardEvent) => {
      observations.push(read().handle(event, context, now));
    };
    const bubble = (event: KeyboardEvent) => {
      observations.push(
        read().handle(event, { ...context, phase: "bubble" }, now),
      );
    };
    host.addEventListener("keydown", capture, true);
    host.addEventListener("keydown", bubble);
    host.dispatchEvent(key("g"));
    now = 1199;
    const event = key(suffix);
    host.dispatchEvent(event);
    expect(observations).toEqual([
      { status: "reserved", shortcutId: "projects", stage: "prefix" },
      { status: "unhandled" },
      { status: "reserved", shortcutId: "projects", stage: "unmatched" },
      { status: "unhandled" },
    ]);
    expect(read().handle(event, context, now)).toEqual({ status: "unhandled" });
    expect(read().handle(key("p"), context, now)).toEqual({
      status: "unhandled",
    });
    expect(dispatch).not.toHaveBeenCalled();
    now = 2000;
    host.dispatchEvent(key("g"));
    now = 2010;
    host.dispatchEvent(key("p"));
    expect(observations.slice(-2)).toEqual([
      { status: "reserved", shortcutId: "projects", stage: "activation" },
      { status: "dispatched", shortcutId: "projects" },
    ]);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("projects");
  },
);
it.each([1199, 1200, 1201])(
  "bounds unmatched reservation at %d ms",
  (elapsed) => {
    const { read, dispatch } = mount();
    read()(key("g"), context, 0);
    expect(read().handle(key("x"), context, elapsed)).toEqual(
      elapsed < 1200
        ? { status: "reserved", shortcutId: "projects", stage: "unmatched" }
        : { status: "unhandled" },
    );
    expect(read()(key("p"), context, elapsed + 1)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  },
);
it("keeps editable reset stronger than modifier preservation", () => {
  const { read, dispatch } = mount();
  read()(key("g"), context, 0);
  expect(
    read()(key("x", { ctrlKey: true }), { ...context, focusKind: "input" }, 1),
  ).toBe(false);
  expect(read()(key("p"), context, 2)).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
});
it.each(["repeat", "overlay"] as const)(
  "preserves a %s rejection ahead of reservation",
  (guard) => {
    const { read, dispatch } = mount();
    read()(key("g"), context, 0);
    expect(
      read().handle(
        key("x", { repeat: guard === "repeat" }),
        { ...context, overlayOpen: guard === "overlay" },
        1,
      ),
    ).toEqual({ status: "unhandled" });
    expect(read().handle(key("p"), context, 1199)).toEqual({
      status: "dispatched",
      shortcutId: "projects",
    });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("projects");
  },
);
it.each(["ctrlKey", "altKey", "metaKey"] as const)(
  "does not start a prefix on rejected %s",
  (modifier) => {
    const { read, dispatch } = mount();
    expect(read()(key("g", { [modifier]: true }), context, 0)).toBe(false);
    expect(read()(key("p"), context, 1)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  },
);
it("resets modifier rejection when its preservation policy is omitted", () => {
  const { read, dispatch } = mount([
    {
      ...descriptor,
      sequencePolicy: { ...descriptor.sequencePolicy, guardRejected: {} },
    },
  ]);
  read()(key("g"), context, 0);
  expect(read()(key("x", { ctrlKey: true }), context, 1)).toBe(false);
  expect(read()(key("p"), context, 2)).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
});
it("keeps bare-modifier preservation as the default even with unmatched reservation", () => {
  const { read, dispatch } = mount([
    {
      ...descriptor,
      sequencePolicy: { ...descriptor.sequencePolicy, modifiers: undefined },
    },
  ]);
  read()(key("g"), context, 0);
  expect(read()(key("Shift", { shiftKey: true }), context, 1100)).toBe(false);
  expect(read()(key("p"), context, 1199)).toBe(true);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("projects");
});
it("retains unhandled unmatched suffixes for consume and restart policies", () => {
  for (const unmatched of ["consume", "restart"] as const) {
    const { read, dispatch } = mount([
      {
        ...descriptor,
        sequencePolicy: { ...descriptor.sequencePolicy, unmatched },
      },
    ]);
    read()(key("g"), context, 0);
    expect(read()(key("x"), context, 1)).toBe(false);
    expect(read()(key("p"), context, 2)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  }
});
it.each([false, true])(
  "reserves ahead of unrelated single-key dispatch (singleton first=%s)",
  (first) => {
    const singleton: ShellShortcutDescriptor = {
      ...descriptor,
      id: "extra",
      actionName: "extra",
      keys: [{ key: "x" }],
    };
    const { read, dispatch } = mount(
      first ? [singleton, descriptor] : [descriptor, singleton],
    );
    read()(key("g"), context, 0);
    expect(read().handle(key("x"), context, 1)).toEqual({
      status: "reserved",
      shortcutId: "projects",
      stage: "unmatched",
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(read().handle(key("x"), context, 2)).toEqual({
      status: "dispatched",
      shortcutId: "extra",
    });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("extra");
  },
);
it("lets a matching sibling complete before another sibling's unmatched reservation", () => {
  const sibling: ShellShortcutDescriptor = {
    ...descriptor,
    id: "inbox",
    actionName: "inbox",
    keys: [{ key: "g" }, { key: "i" }],
  };
  const { read, dispatch } = mount([descriptor, sibling]);
  read()(key("g"), context, 0);
  expect(read().handle(key("i"), context, 1)).toEqual({
    status: "dispatched",
    shortcutId: "inbox",
  });
  expect(read()(key("p"), context, 2)).toBe(false);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("inbox");
});
it.each([false, true])(
  "ends a legacy sibling instead of restarting it under a live reservation (legacy first=%s)",
  (first) => {
    const legacy: ShellShortcutDescriptor = {
      ...descriptor,
      id: "inbox",
      actionName: "inbox",
      keys: [{ key: "g" }, { key: "i" }],
      sequencePolicy: undefined,
    };
    const { read, dispatch } = mount(
      first ? [legacy, descriptor] : [descriptor, legacy],
    );
    read()(key("g"), context, 0);
    expect(read().handle(key("g"), context, 1)).toEqual({
      status: "reserved",
      shortcutId: "projects",
      stage: "unmatched",
    });
    expect(read().handle(key("i"), context, 2)).toEqual({
      status: "unhandled",
    });
    expect(dispatch).not.toHaveBeenCalled();
    read()(key("g"), context, 10);
    expect(read().handle(key("i"), context, 11)).toEqual({
      status: "dispatched",
      shortcutId: "inbox",
    });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("inbox");
  },
);
it.each(["composition", "defaultPrevented", "overlay", "pause"] as const)(
  "retains late %s rejection after capture reservation",
  (guard) => {
    const { read, dispatch } = mount([
      {
        ...descriptor,
        activation: {
          phase: "bubble",
          guard: {
            ...descriptor.guard,
            composition: "ignore",
            respectDefaultPrevented: true,
            pauseOwner: "workspace",
            pauseKeys: ["p"],
          },
        },
      },
    ]);
    read()(key("g"), context, 0);
    const event = key("p", { isComposing: guard === "composition" });
    expect(read().handle(event, context, 1)).toEqual({
      status: "reserved",
      shortcutId: "projects",
      stage: "activation",
    });
    if (guard === "defaultPrevented") event.preventDefault();
    const bubble: ShellShortcutContext = {
      ...context,
      phase: "bubble",
      overlayOpen: guard === "overlay",
      pausedOwners: guard === "pause" ? ["workspace"] : [],
    };
    expect(read().handle(event, bubble, 1)).toEqual({ status: "unhandled" });
    expect(read().handle(event, { ...context, phase: "bubble" }, 2)).toEqual({
      status: "unhandled",
    });
    expect(read()(key("p"), context, 2)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  },
);

const booleanConsumer = (handler: ReturnType<typeof useShellShortcuts>) => {
  const callback: (
    event: ShellShortcutEvent,
    context: ShellShortcutContext,
    now?: number,
  ) => boolean = handler;
  return callback;
};
it("shares progress across boolean and detailed calls", () => {
  const { read, dispatch } = mount();
  expect(booleanConsumer(read())(key("g"), context, 0)).toBe(true);
  expect(read().handle(key("p"), context, 1)).toEqual({
    status: "dispatched",
    shortcutId: "projects",
  });
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("projects");
});
