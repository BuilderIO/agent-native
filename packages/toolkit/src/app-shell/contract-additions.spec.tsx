// @vitest-environment happy-dom
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type {
  ShellActionEffect,
  ShellIconReference,
  ShellShortcutDescriptor,
} from "./contracts.js";
import {
  useNavigationHistory,
  useShellShortcuts,
  useSidebarCollapse,
  type ShellShortcutContext,
  type ShellShortcutEvent,
} from "./shell-hooks.js";
import {
  runShellAction,
  sidebarCollapseAtPhase,
  type SidebarCollapsePolicy,
} from "./shell-policies.js";
import {
  captureShellSnapshot,
  compareShellSnapshots,
  type ShellSemanticSnapshot,
} from "./shell-testing.js";

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
function mount<T>(hook: () => T, strict = false) {
  let result: T;
  function Harness() {
    result = hook();
    return null;
  }
  const render = () =>
    act(() =>
      root.render(
        strict
          ? createElement(StrictMode, null, createElement(Harness))
          : createElement(Harness),
      ),
    );
  render();
  return Object.assign(() => result, { render });
}
const context: ShellShortcutContext = {
  platform: "mac",
  scope: "navigation",
  phase: "capture",
  focusKind: "page",
  overlayOpen: false,
  pausedOwners: [],
};
function key(
  key: string,
  overrides: Partial<ShellShortcutEvent> = {},
): ShellShortcutEvent {
  return {
    key,
    code: key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    ...overrides,
  };
}
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
    unmatched: "consume",
    modifiers: "consume",
    guardRejected: { repeat: "preserve", overlay: "preserve" },
  },
  guard: {
    focusKinds: ["page"],
    allowRepeat: false,
    composition: "allow",
    overlay: "ignore",
    respectDefaultPrevented: false,
  },
};
it.each([
  [1199, true],
  [1200, false],
  [1201, false],
] as const)("exclusive chord boundary at %d ms", (elapsed, expected) => {
  const dispatch = vi.fn();
  const read = mount(() => useShellShortcuts("shell", [descriptor], dispatch));
  expect(read()(key("g"), context, 0)).toBe(true);
  expect(read()(key("p"), context, elapsed)).toBe(expected);
  expect(dispatch).toHaveBeenCalledTimes(expected ? 1 : 0);
});
it("retains the inclusive boundary by default", () => {
  const dispatch = vi.fn();
  const read = mount(() =>
    useShellShortcuts(
      "shell",
      [{ ...descriptor, sequencePolicy: undefined }],
      dispatch,
    ),
  );
  read()(key("g"), context, 0);
  expect(read()(key("p"), context, 1200)).toBe(true);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("projects");
});
it.each(["Shift", "g", "x"])(
  "consumes the next eligible %s without restarting",
  (suffix) => {
    const dispatch = vi.fn();
    const read = mount(() =>
      useShellShortcuts("shell", [descriptor], dispatch),
    );
    read()(key("g"), context, 0);
    expect(read()(key(suffix), context, 10)).toBe(false);
    expect(read()(key("p"), context, 20)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  },
);
it.each(["repeat", "overlay"] as const)(
  "preserves progress for %s rejection without extending expiry",
  (guard) => {
    const dispatch = vi.fn();
    const read = mount(() =>
      useShellShortcuts("shell", [descriptor], dispatch),
    );
    const blocked =
      guard === "overlay" ? { ...context, overlayOpen: true } : context;
    const event = key("x", { repeat: guard === "repeat" });
    read()(key("g"), context, 0);
    expect(read()(event, blocked, 100)).toBe(false);
    expect(read()(key("p"), context, 1199)).toBe(true);
    read()(key("g"), context, 2000);
    read()(key("x", { repeat: guard === "repeat" }), blocked, 2100);
    expect(read()(key("p"), context, 3200)).toBe(false);
    expect(dispatch).toHaveBeenCalledOnce();
  },
);
it("editable focus clears a reserved prefix", () => {
  const dispatch = vi.fn();
  const read = mount(() => useShellShortcuts("shell", [descriptor], dispatch));
  read()(key("g"), context, 0);
  expect(read()(key("p"), { ...context, focusKind: "input" }, 10)).toBe(false);
  expect(read()(key("p"), context, 20)).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
});
it("reserves in capture and activates once in bubble using that event's later guards", () => {
  const dispatch = vi.fn();
  const item: ShellShortcutDescriptor = {
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
  };
  const read = mount(() => useShellShortcuts("shell", [item], dispatch));
  const bubble = { ...context, phase: "bubble" as const };
  const prefix = key("g", { isComposing: true });
  expect(read()(prefix, context, 0)).toBe(true);
  expect(read()(prefix, bubble, 0)).toBe(false);
  const suffix = key("p");
  expect(read()(suffix, context, 1199)).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
  expect(read()(suffix, bubble, 1199)).toBe(true);
  expect(read()(suffix, bubble, 1199)).toBe(false);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("projects");
  for (const [overrides, blockedContext] of [
    [{ isComposing: true }, bubble],
    [{ defaultPrevented: true }, bubble],
    [{}, { ...bubble, pausedOwners: ["workspace"] }],
  ] as const) {
    read()(key("g"), context, 2000);
    const event = key("p", overrides);
    expect(read()(event, context, 2010)).toBe(true);
    expect(read()(event, blockedContext, 2010)).toBe(false);
    expect(read()(event, bubble, 2011)).toBe(false);
  }
  expect(dispatch).toHaveBeenCalledOnce();
});
it("applies pause only to the declared initiating keys", () => {
  const dispatch = vi.fn();
  const item: ShellShortcutDescriptor = {
    ...descriptor,
    keys: [{ key: "p" }],
    guard: { ...descriptor.guard, pauseOwner: "workspace", pauseKeys: ["g"] },
  };
  const read = mount(() => useShellShortcuts("shell", [item], dispatch));
  expect(read()(key("p"), { ...context, pausedOwners: ["workspace"] }, 0)).toBe(
    true,
  );
  expect(dispatch).toHaveBeenCalledOnce();
});

const collapse: SidebarCollapsePolicy = {
  key: "test.utility",
  encoding: "zero-one",
  defaultCollapsed: false,
  writeOnReady: "always",
  startup: "passive-read-initial-write",
  boot: { absent: true, invalid: false, unavailable: false },
  widths: { expanded: 244, collapsed: 8, bootCollapsed: 8 },
};
it.each([
  [null, ["0"], false],
  ["0", ["0"], false],
  ["1", ["0", "1"], true],
  ["bad", ["0"], false],
] as const)(
  "preserves passive utility startup for seed %s",
  (seed, expected, settled) => {
    let stored: string | null = seed;
    const writes: string[] = [];
    const observations: { collapsed: boolean; writes: string[] }[] = [];
    const read = mount(() => {
      const state = useSidebarCollapse(collapse, () => ({
        getItem: () => stored,
        setItem: (_key, value) => {
          stored = value;
          writes.push(value);
        },
      }));
      useLayoutEffect(() => {
        observations.push({ collapsed: state.collapsed, writes: [...writes] });
      });
      return state;
    });
    expect(observations[0]).toEqual({ collapsed: false, writes: [] });
    expect(observations[1]).toEqual({ collapsed: settled, writes: ["0"] });
    expect(writes).toEqual(expected);
    expect(read().collapsed).toBe(settled);
    expect(
      sidebarCollapseAtPhase(collapse, { status: "absent" }, "boot").collapsed,
    ).toBe(true);
    expect(
      sidebarCollapseAtPhase(collapse, { status: "absent" }, "ready").collapsed,
    ).toBe(false);
  },
);
it("preserves the loaded value across strict effect replay", () => {
  let stored = "1";
  const read = mount(
    () =>
      useSidebarCollapse(collapse, () => ({
        getItem: () => stored,
        setItem: (_key, value) => {
          stored = value;
        },
      })),
    true,
  );
  expect(read().collapsed).toBe(true);
  expect(stored).toBe("1");
});
it("reports a failed initial write even when the ready write succeeds", () => {
  let writes = 0;
  const failure = new Error("initial write denied");
  const read = mount(() =>
    useSidebarCollapse(collapse, () => ({
      getItem: () => "1",
      setItem: () => {
        if (++writes === 1) throw failure;
      },
    })),
  );
  expect(writes).toBe(2);
  expect(read().stored).toEqual({ status: "unavailable", error: failure });
});

function historyStore(fail = false, inherited = false) {
  const values = new Map<string, string>();
  const events: string[] = [];
  let blocked = false;
  let location = { pathname: "/one" };
  const read = mount(() =>
    useNavigationHistory(
      {
        activeKey: "test.active",
        destinationKey: (s) => `test.dest.${s}`,
        sections: ["one", "two"],
        fallbacks: { one: "/one", two: "/two" },
        resolveSection: (l, previous) =>
          l.pathname.startsWith("/detail/")
            ? (previous ?? "one")
            : l.pathname.slice(1),
        belongsTo: (to, s) =>
          to.startsWith(`/${s}`) || to.startsWith("/detail/"),
        restoreScrollPosition: true,
      },
      () => ({
        getItem: (k) => values.get(k) ?? null,
        setItem: (k, v) => {
          if (blocked) throw new Error("storage denied");
          values.set(k, v);
          events.push(`${k}=${v}`);
        },
      }),
      location,
    ),
  );
  const visit = (pathname: string) => {
    location = { pathname };
    read.render();
  };
  if (inherited) visit("/detail/1");
  events.length = 0;
  blocked = fail;
  return { read, values, events, visit };
}
it.each([false, true])(
  "writes selection before navigation without changing route context (inherited=%s)",
  async (inherited) => {
    const { read, values, events, visit } = historyStore(false, inherited);
    expect(read().target("two")).toMatchObject({ to: "/two" });
    expect(events).toEqual([]);
    const effects: ShellActionEffect[] = [
      {
        id: "select",
        kind: "action",
        actionName: "select-section",
        run: () => {
          const result = read().select("two");
          if (result.status === "unavailable") throw result.error;
        },
      },
      {
        id: "open",
        kind: "action",
        actionName: "open-section",
        beforeEffectId: "select",
        run: () => {
          events.push(
            `navigate:${values.get("test.active")}:${read().target("two").kind}`,
          );
        },
      },
    ];
    await act(async () => {
      expect(await runShellAction(effects, "open")).toBe(true);
    });
    expect(events).toEqual(["test.active=two", "navigate:two:navigate"]);
    expect(read().active).toBe("one");
    expect(read().persistence).toEqual({ status: "value", value: "two" });
    expect(() => read().select("unknown")).toThrow(
      "Unknown navigation section",
    );
    visit("/two");
    expect(read().active).toBe("two");
    expect(read().target("two")).toEqual({ kind: "current" });
  },
);
it.each([false, true])(
  "reports selection failure without changing route context or navigating (inherited=%s)",
  async (inherited) => {
    const { read, values, visit } = historyStore(true, inherited);
    const navigate = vi.fn();
    const effects: ShellActionEffect[] = [
      {
        id: "select",
        kind: "action",
        actionName: "select-section",
        run: () => {
          const result = read().select("two");
          if (result.status === "unavailable") throw result.error;
        },
      },
      {
        id: "open",
        kind: "action",
        actionName: "open-section",
        beforeEffectId: "select",
        run: navigate,
      },
    ];
    await act(async () => {
      await expect(runShellAction(effects, "open")).rejects.toThrow(
        "storage denied",
      );
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(read().persistence.status).toBe("unavailable");
    expect(read().active).toBe("one");
    expect(values.get("test.active")).toBe("one");
    expect(read().target("two")).toMatchObject({
      kind: "navigate",
      to: "/two",
    });
    visit("/detail/next");
    expect(read().active).toBe("one");
  },
);
it("hands successful selection intent to a committed remembered detail destination", async () => {
  const { read, values, events, visit } = historyStore(false, true);
  values.set("test.dest.two", JSON.stringify({ to: "/detail/2" }));
  const effects: ShellActionEffect[] = [
    {
      id: "select",
      kind: "action",
      actionName: "select",
      run: () => {
        const result = read().select("two");
        if (result.status === "unavailable") throw result.error;
      },
    },
    {
      id: "open",
      kind: "action",
      actionName: "open",
      beforeEffectId: "select",
      run: () => {
        expect(read().active).toBe("one");
        const target = read().target("two");
        expect(target).toMatchObject({ kind: "navigate", to: "/detail/2" });
        if (target.kind === "navigate") visit(target.to);
      },
    },
  ];
  await act(async () => {
    expect(await runShellAction(effects, "open")).toBe(true);
  });
  expect(read().active).toBe("two");
  expect(values.get("test.active")).toBe("two");
  expect(values.get("test.dest.one")).toBe(JSON.stringify({ to: "/detail/1" }));
  expect(values.get("test.dest.two")).toBe(JSON.stringify({ to: "/detail/2" }));
  expect(events).toEqual([
    "test.active=two",
    "test.active=two",
    'test.dest.two={"to":"/detail/2"}',
  ]);
});
it("awaits prerequisites and checks all pending locks before any write", async () => {
  let resolve: (() => void) | undefined;
  const write = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const navigate = vi.fn();
  const effects: ShellActionEffect[] = [
    { id: "select", kind: "action", actionName: "select", run: write },
    {
      id: "open",
      kind: "action",
      actionName: "open",
      beforeEffectId: "select",
      run: navigate,
      pending: true,
    },
  ];
  expect(await runShellAction(effects, "open")).toBe(false);
  expect(write).not.toHaveBeenCalled();
  effects[1].pending = false;
  const done = runShellAction(effects, "open");
  expect(write).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
  resolve?.();
  expect(await done).toBe(true);
  expect(navigate).toHaveBeenCalledOnce();
});
it("fails closed on a cyclic effect order before running anything", async () => {
  const run = vi.fn();
  await expect(
    runShellAction(
      [
        {
          id: "open",
          kind: "action",
          actionName: "open",
          beforeEffectId: "open",
          run,
        },
      ],
      "open",
    ),
  ).rejects.toThrow("Cyclic");
  expect(run).not.toHaveBeenCalled();
});

it("carries arbitrary resolved icon color while semantic comparison ignores appearance", () => {
  const icons: ShellIconReference[] = [
    {
      kind: "entity",
      key: "team",
      fallbackText: "A",
      color: "var(--team-tone)",
    },
    { kind: "symbol", key: "star", color: "#123abc" },
    { kind: "initial", text: "A", color: "" },
  ];
  const snapshot: ShellSemanticSnapshot = {
    id: "team",
    part: "sidebar.item",
    containerId: "teams",
    order: 0,
    present: true,
    family: "button",
    role: "button",
    expanded: null,
    name: "Alpha",
    value: null,
    choices: [],
    enabled: true,
    selected: false,
    checked: null,
    shortcut: null,
    badge: null,
    effect: { kind: "none", target: null, result: null },
    read: { status: "ready", message: null, recovery: null },
    action: { pending: false, error: null, recovery: null },
    keyboard: { reachable: true, operable: true },
  };
  const capture = (icon: ShellIconReference) => {
    act(() =>
      root.render(
        createElement(
          "button",
          { "data-rid": "team", "data-part": "sidebar.item" },
          createElement("span", { style: { color: icon.color } }, "A"),
          "Alpha",
        ),
      ),
    );
    return captureShellSnapshot(host, {
      visible: () => true,
      observe: (_identity, elements) => ({
        ...snapshot,
        name: elements[0].textContent,
      }),
    });
  };
  const first = capture(icons[0]);
  expect(compareShellSnapshots(first, capture(icons[1])).differences).toEqual(
    [],
  );
  expect(compareShellSnapshots(first, capture(icons[2])).differences).toEqual(
    [],
  );
});
