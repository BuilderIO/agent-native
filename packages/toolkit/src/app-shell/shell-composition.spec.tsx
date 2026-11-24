import {
  fireEvent,
  getByRole,
  queryByRole,
  waitFor,
} from "@testing-library/react";
// @vitest-environment happy-dom
import {
  act,
  StrictMode,
  useState,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ToolkitProvider } from "../provider.js";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu.js";
import type {
  NavigationEntry,
  NavigationModel,
  ShellModel,
  NavigationContentSlot,
} from "./contracts.js";
import { HouseSidebar, HouseAppShell } from "./house-frames.js";
import {
  ShellContent,
  ShellHostProvider,
  ShellMenuControl,
  type ShellHost,
} from "./house-shell-host.js";
import { useSidebarCollapse } from "./shell-hooks.js";
import type { SidebarCollapsePolicy } from "./shell-policies.js";
import {
  captureShellSnapshot,
  captureShellContentSlots,
  compareShellContentSlots,
  compareShellSnapshots,
  type ShellSemanticSnapshot,
} from "./shell-testing.js";
function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Missing ${what}`);
  return value;
}
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
const identity = (id: string, order = 0) => ({
  id,
  part: "sidebar" as const,
  subPart: "sidebar.item" as const,
  containerId: "nav",
  order,
});
const entry = (
  id: string,
  order = 0,
  extra: Partial<Omit<NavigationEntry, "part" | "subPart">> = {},
): NavigationEntry => ({
  ...identity(id, order),
  kind: "action",
  label: id,
  effect: { kind: "none" },
  ...extra,
});
const model = (
  entries: NavigationEntry[] = [],
  contentSlots: NavigationContentSlot[] = [],
): NavigationModel => ({
  entries,
  sections: [],
  contentSlots,
  presentation: {
    collapsed: { value: false },
    mobileOpen: { value: false },
    peekOpen: false,
    profile: "test",
    themeFamily: "test",
    visibility: "visible",
    width: 240,
  },
});
function RefSidebar({ model: m }: { model: NavigationModel }) {
  return (
    <nav data-part="sidebar">
      {[...m.entries, ...m.sections, ...(m.contentSlots ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((g) =>
          "content" in g ? (
            <div
              key={g.id}
              data-shell-content-id={g.id}
              data-shell-content-order={g.order}
            >
              <ShellContent content={g.content} />
            </div>
          ) : "entries" in g ? (
            <section key={g.id} data-rid={g.id} data-part={g.subPart}>
              {g.label}
            </section>
          ) : (
            <button key={g.id} data-rid={g.id} data-part={g.subPart}>
              {g.label}
            </button>
          ),
        )}
    </nav>
  );
}
function render(node: ReactNode, h: ShellHost = { pathname: "/" }) {
  act(() =>
    root.render(
      <ToolkitProvider>
        <ShellHostProvider value={h}>{node}</ShellHostProvider>
      </ToolkitProvider>,
    ),
  );
}
const slot = (id: string, order: number): NavigationContentSlot => ({
  ...identity(id, order),
  subPart: "sidebar.slot",
  content: { owner: "custom", key: id, reason: "Retained content controller" },
});
for (const look of ["reference", "house"] as const)
  for (const collapsed of [false, true])
    it(`${look} ordered inline slots, collapsed=${collapsed}`, () => {
      const m = model(
        [entry("before", 0), entry("after", 4)],
        [slot("retained", 2)],
      );
      m.sections = [
        {
          ...identity("group", 3),
          subPart: "sidebar.section",
          label: "Group",
          entries: [],
          hideIfEmpty: false,
        },
      ];
      m.presentation.collapsed.value = collapsed;
      const node =
        look === "house" ? (
          <HouseSidebar model={m} effects={[]} />
        ) : (
          <RefSidebar model={m} />
        );
      render(node, {
        pathname: "/",
        slots: {
          retained: (
            <div data-rid="custom-child" data-part="sidebar.item">
              Owned content
            </div>
          ),
        },
      });
      expect(host.querySelectorAll("nav")).toHaveLength(1);
      expect(
        [
          ...required(host.querySelector("nav"), "navigation").querySelectorAll(
            "button,[data-shell-content-id],section",
          ),
        ].map((n) => n.textContent),
      ).toEqual(["before", "Owned content", "Group", "after"]);
      const slots = captureShellContentSlots(host);
      expect(slots).toEqual([
        {
          id: "retained",
          key: "retained",
          owner: "custom",
          reason: "Retained content controller",
          order: 2,
          placement: {
            frame: 0,
            index: 1,
            before: { id: "before" },
            after: { id: "group" },
          },
        },
      ]);
      expect(
        compareShellContentSlots(slots, [
          { ...slots[0], reason: "Other owner" },
        ]),
      ).toEqual(['["retained",null]: content ownership']);
      expect(
        host
          .querySelector("[data-shell-slot]")
          ?.closest('button,[role="dialog"]'),
      ).toBeNull();
    });
it("compares slot order, ownership and surface/keyboard ownership without waivers", () => {
  const a = [
    {
      id: "one",
      key: "one",
      owner: "custom" as const,
      reason: "Owned",
      order: 1,
    },
    {
      id: "two",
      key: "two",
      owner: "later-pattern" as const,
      reason: "Later",
      order: 2,
    },
  ];
  expect(compareShellContentSlots(a, [a[1], a[0]])).toContain(
    "content slot order",
  );
  expect(compareShellContentSlots(a, a)).toEqual([]);
});
for (const look of ["reference", "house"] as const)
  it(`${look} delegates one owned dialog and its focus policy`, async () => {
    let setOpen: (v: boolean) => void = () => {};
    let opened = false;
    function Harness() {
      const [open, set] = useState(false);
      setOpen = set;
      opened = open;
      const opener = entry("Open owned", 0, {
        effect: {
          kind: "open",
          surfaceId: "owned",
          open: { value: open, set },
          surface: { owner: "content", kind: "dialog" },
          body: { owner: "custom", key: "owned", reason: "Domain surface" },
        },
      });
      const body = (
        <Dialog open={open} onOpenChange={set}>
          <DialogContent
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              getByRole(host, "button", { name: "Open owned" }).focus();
            }}
          >
            <DialogTitle>Owned title</DialogTitle>
            <button onClick={() => set(false)}>Finish</button>
          </DialogContent>
        </Dialog>
      );
      return (
        <ShellHostProvider value={{ pathname: "/", slots: { owned: body } }}>
          {look === "house" ? (
            <HouseSidebar model={model([opener])} effects={[]} />
          ) : (
            <>
              <button onClick={() => set(true)}>Open owned</button>
              <ShellContent
                content={
                  opener.effect?.kind === "open"
                    ? opener.effect.body
                    : { owner: "kit", key: "unused" }
                }
              />
            </>
          )}
        </ShellHostProvider>
      );
    }
    render(<Harness />);
    const button = getByRole(host, "button", { name: "Open owned" });
    await act(async () => {
      button.focus();
      fireEvent.click(button);
    });
    expect(opened).toBe(true);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(getByRole(document.body, "dialog").textContent).toContain(
      "Owned title",
    );
    await act(async () => {
      fireEvent.click(getByRole(document.body, "button", { name: "Finish" }));
    });
    expect(opened).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
for (const look of ["reference", "house"] as const)
  it(`${look} registers typed controls with retained menu collection`, async () => {
    const hit = vi.fn();
    const e = entry("Modeled", 0, {
      effect: { kind: "action", effectId: "run" },
    });
    const h: ShellHost = {
      pathname: "/",
      labels: { retry: "Retry" },
      menuControls: {
        account: ({ children, disabled }) => (
          <DropdownMenuItem asChild disabled={disabled}>
            {children}
          </DropdownMenuItem>
        ),
      },
    };
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Custom before</DropdownMenuItem>
          {look === "house" ? (
            <HouseSidebar
              model={{ ...model([e]), menu: { ownerKey: "account" } }}
              effects={[
                { id: "run", kind: "action", actionName: "Run", run: hit },
              ]}
            />
          ) : (
            <ShellMenuControl entry={e} ownerKey="account" disabled={false}>
              <button onClick={() => hit()}>Modeled</button>
            </ShellMenuControl>
          )}
          <DropdownMenuItem>Custom after</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
      h,
    );
    const before = getByRole(document.body, "menuitem", {
      name: "Custom before",
    });
    const row = getByRole(document.body, "menuitem", { name: "Modeled" });
    await act(async () => {
      before.focus();
      fireEvent.keyDown(before, { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(row);
    await act(async () => {
      fireEvent.keyDown(row, { key: "Enter" });
    });
    expect(hit).toHaveBeenCalledTimes(1);
  });
for (const look of ["reference", "house"] as const)
  it(`${look} inline section stays open on Escape and outside press`, () => {
    function Harness() {
      const [open, set] = useState(true);
      const m = model();
      m.sections = [
        {
          ...identity("recent"),
          subPart: "sidebar.section",
          label: "Recent",
          hideIfEmpty: false,
          entries: [entry("Child")],
          disclosure: {
            binding: { value: open, set },
            unmountWhenClosed: true,
            dismissal: "header-only",
          },
        },
      ];
      return look === "house" ? (
        <HouseSidebar model={m} effects={[]} />
      ) : (
        <section>
          <button aria-expanded={open} onClick={() => set(!open)}>
            Recent
          </button>
          {open && <button>Child</button>}
        </section>
      );
    }
    render(<Harness />);
    const child = getByRole(host, "button", { name: "Child" });
    act(() => {
      child.focus();
      fireEvent.keyDown(child, { key: "Escape" });
      fireEvent.pointerDown(document.body, { button: 0 });
    });
    expect(
      getByRole(host, "button", { name: "Recent" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    expect(document.activeElement).toBe(child);
    act(() => {
      fireEvent.click(getByRole(host, "button", { name: "Recent" }));
    });
    expect(queryByRole(host, "button", { name: "Child" })).toBeNull();
  });
const policy: SidebarCollapsePolicy = {
  key: "test.collapse",
  encoding: "zero-one",
  defaultCollapsed: false,
  writeOnReady: "always",
  startup: "lazy-read-passive-write",
  boot: { absent: false, invalid: false, unavailable: false },
  widths: { expanded: 240, collapsed: 56, bootCollapsed: 0 },
};
for (const look of ["reference", "house"] as const)
  for (const stored of [null, "1", "0", "invalid", "unavailable"])
    it(`${look} lazy first host and passive commits ${stored}`, () => {
      const writes: string[] = [];
      const paints: boolean[] = [];
      let set: (v: boolean | ((b: boolean) => boolean)) => void = () => {};
      const access = () => ({
        getItem: () => {
          if (stored === "unavailable") throw Error("Unavailable");
          return stored;
        },
        setItem: (_k: string, v: string) => {
          writes.push(v);
        },
      });
      function Harness() {
        const c = useSidebarCollapse(policy, access);
        set = c.setCollapsed;
        useLayoutEffect(() => {
          paints.push(c.collapsed);
        }, [c.collapsed]);
        return (
          <div data-collapsed={c.collapsed}>
            {look === "house" ? (
              <HouseSidebar
                model={{
                  ...model(),
                  presentation: {
                    ...model().presentation,
                    collapsed: { value: c.collapsed },
                  },
                }}
                effects={[]}
              />
            ) : (
              <nav />
            )}
          </div>
        );
      }
      render(<Harness />);
      const initial = stored === "1";
      expect(paints).toEqual([initial]);
      expect(writes).toEqual([initial ? "1" : "0"]);
      act(() => {
        set((v) => !v);
        set((v) => !v);
        set(initial);
      });
      expect(writes).toEqual([initial ? "1" : "0"]);
      act(() => set(!initial));
      expect(writes).toEqual([initial ? "1" : "0", initial ? "0" : "1"]);
      act(() => set(!initial));
      expect(writes).toHaveLength(2);
    });
for (const look of ["reference", "house"] as const)
  for (const standalone of [false, true])
    it(`${look} read error retains title/detail/recovery standalone=${standalone}`, () => {
      const retry = vi.fn();
      const m: ShellModel = {
        frame: { key: "frame", routeRuleId: "frame" },
        navigation: model(),
        shortcuts: [],
        preferences: [],
        effects: [
          { id: "retry", kind: "action", actionName: "Retry", run: retry },
        ],
        regions: [
          {
            ...identity("error"),
            part: "app-shell",
            subPart: "app-shell.skeleton",
            content: { owner: "kit", key: "none" },
            title: "Workspace unavailable",
            readPresentation: standalone ? "standalone" : undefined,
            state: {
              status: "error",
              message: "Disconnected",
              reloadEffectId: "retry",
              retryLabel: "Retry",
            },
          },
        ],
      };
      render(
        look === "house" ? (
          <HouseAppShell model={m} />
        ) : (
          <section>
            <div role="alert">
              {standalone && <strong>Workspace unavailable</strong>}Disconnected
            </div>
            <button onClick={() => retry()}>Retry</button>
          </section>
        ),
      );
      expect(getByRole(host, "alert").textContent).toBe(
        standalone ? "Workspace unavailableDisconnected" : "Disconnected",
      );
      act(() => {
        fireEvent.click(getByRole(host, "button", { name: "Retry" }));
      });
      expect(retry).toHaveBeenCalledOnce();
    });
for (const look of ["reference", "house"] as const)
  it(`${look} standalone effect failure is one alert before its modeled recovery controls`, () => {
    const retry = vi.fn(),
      dismiss = vi.fn();
    const m: ShellModel = {
      frame: { key: "frame", routeRuleId: "frame" },
      navigation: model(),
      shortcuts: [],
      preferences: [],
      effects: [
        {
          id: "save",
          kind: "action",
          actionName: "Save",
          run: retry,
          error: "Failed to save",
        },
        { id: "dismiss", kind: "action", actionName: "Dismiss", run: dismiss },
      ],
      regions: [
        {
          ...identity("banner"),
          part: "app-shell",
          subPart: "app-shell.banner",
          content: { owner: "kit", key: "none" },
          title: "Could not complete:",
          effectError: { effectId: "save" },
          actions: [
            {
              ...entry("Retry", 0, {
                effect: { kind: "action", effectId: "save" },
              }),
              part: "app-shell",
              subPart: "app-shell.banner",
            },
            {
              ...entry("Dismiss", 1, {
                effect: { kind: "action", effectId: "dismiss" },
              }),
              part: "app-shell",
              subPart: "app-shell.banner",
            },
          ],
        },
      ],
    };
    render(
      look === "house" ? (
        <HouseAppShell model={m} />
      ) : (
        <section role="alert">
          <div>Could not complete: {m.effects[0].error}</div>
          <button onClick={() => retry()}>Retry</button>
          <button onClick={() => dismiss()}>Dismiss</button>
        </section>
      ),
    );
    const alerts = host.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe(
      "Could not complete: Failed to saveRetryDismiss",
    );
    expect(alerts[0].getAttribute("aria-label")).toBeNull();
    act(() => {
      fireEvent.click(
        getByRole(alerts[0] as HTMLElement, "button", { name: "Retry" }),
      );
    });
    act(() => {
      fireEvent.click(
        getByRole(alerts[0] as HTMLElement, "button", { name: "Dismiss" }),
      );
    });
    expect(retry).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  });

it("excludes retained content from row snapshots while preserving adjacent rows", () => {
  const m = model(
    [entry("before", 0), entry("after", 2)],
    [slot("retained", 1)],
  );
  render(<HouseSidebar model={m} effects={[]} />, {
    pathname: "/",
    slots: {
      retained: (
        <button data-rid="private" data-part="sidebar.item">
          Private
        </button>
      ),
    },
  });
  const observe = vi.fn();
  const retained = required(
    host.querySelector("[data-shell-slot]"),
    "retained slot",
  );
  expect(
    captureShellSnapshot(retained, { visible: () => true, observe }),
  ).toEqual([]);
  expect(observe).not.toHaveBeenCalled();
  expect(
    host.querySelectorAll('[data-rid="before"],[data-rid="after"]'),
  ).toHaveLength(4);
});

for (const strict of [false, true])
  it(`lazy persistence catches write failure and skips no-op commits strict=${strict}`, () => {
    const failure = Error("Write denied"),
      writes = vi.fn(() => {
        throw failure;
      });
    let current: ReturnType<typeof useSidebarCollapse> | undefined;
    const read = () => required(current, "sidebar collapse state");
    function Harness() {
      current = useSidebarCollapse(policy, () => ({
        getItem: () => "1",
        setItem: writes,
      }));
      return null;
    }
    render(
      strict ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    );
    expect(read().collapsed).toBe(true);
    expect(read().stored).toEqual({ status: "unavailable", error: failure });
    expect(writes).toHaveBeenCalledTimes(1);
    act(() => {
      read().setCollapsed(true);
    });
    expect(writes).toHaveBeenCalledTimes(1);
    act(() => {
      read().setCollapsed(false);
    });
    expect(writes).toHaveBeenCalledTimes(2);
    expect(read().stored.status).toBe("unavailable");
  });

for (const look of ["reference", "house"] as const)
  for (const checked of [false, true])
    it(`${look} menu boolean choice is owned by the retained collection checked=${checked}`, async () => {
      const set = vi.fn();
      const e = entry("Show items", 0, {
        kind: "choice",
        binding: { value: checked, set },
      });
      const h: ShellHost = {
        pathname: "/",
        menuControls: {
          account: ({ children, disabled }) => (
            <DropdownMenuItem
              role="menuitemcheckbox"
              asChild
              aria-checked={checked}
              disabled={disabled}
            >
              {children}
            </DropdownMenuItem>
          ),
        },
      };
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Account</DropdownMenuTrigger>
          <DropdownMenuContent>
            {look === "house" ? (
              <HouseSidebar
                model={{ ...model([e]), menu: { ownerKey: "account" } }}
                effects={[]}
              />
            ) : (
              <ShellMenuControl ownerKey="account" entry={e} disabled={false}>
                <button aria-checked={checked} onClick={() => set(!checked)}>
                  Show items
                </button>
              </ShellMenuControl>
            )}
          </DropdownMenuContent>
        </DropdownMenu>,
        h,
      );
      const row = getByRole(document.body, "menuitemcheckbox", {
        name: "Show items",
      });
      expect(row.getAttribute("aria-checked")).toBe(String(checked));
      await act(async () => {
        row.focus();
        fireEvent.keyDown(row, { key: " " });
      });
      expect(set).toHaveBeenCalledExactlyOnceWith(!checked);
    });

it("compares independently observed surface and keyboard owners", () => {
  const row: ShellSemanticSnapshot = {
    id: "item",
    part: "sidebar.item",
    containerId: "nav",
    order: 0,
    present: true,
    family: "button",
    role: "button",
    expanded: null,
    name: "Item",
    value: null,
    choices: [],
    enabled: true,
    selected: null,
    checked: null,
    shortcut: null,
    badge: null,
    effect: { kind: "surface", target: "owned", result: null },
    read: { status: "ready", message: null, recovery: null },
    action: { pending: false, error: null, recovery: null },
    keyboard: { reachable: true, operable: true },
    surfaceOwner: "content",
    keyboardOwner: "account",
  };
  expect(
    compareShellSnapshots([row], [{ ...row, surfaceOwner: "house" }])
      .differences,
  ).toEqual(['["item",null]: surfaceOwner']);
  expect(
    compareShellSnapshots([row], [{ ...row, keyboardOwner: "other" }])
      .differences,
  ).toEqual(['["item",null]: keyboardOwner']);
});

it("observes actual inline-slot placement relative to modeled rows and its frame", () => {
  const m = model(
    [entry("before", 0), entry("after", 2)],
    [slot("retained", 1)],
  );
  render(
    <>
      <HouseSidebar model={m} effects={[]} />
      <HouseSidebar model={model([entry("other")])} effects={[]} />
    </>,
    { pathname: "/", slots: { retained: <div>Body</div> } },
  );
  const before = captureShellContentSlots(host);
  const boundary = required(
    host.querySelector("[data-shell-content-id]"),
    "content boundary",
  );
  const frame = required(host.querySelector("nav"), "navigation");
  required(frame.firstElementChild, "navigation body").append(boundary);
  expect(
    compareShellContentSlots(before, captureShellContentSlots(host)),
  ).not.toEqual([]);
  required(
    host.querySelectorAll("nav")[1].firstElementChild,
    "second navigation body",
  ).prepend(boundary);
  expect(
    compareShellContentSlots(before, captureShellContentSlots(host)),
  ).not.toEqual([]);
});

for (const look of ["reference", "house"] as const)
  for (const state of ["read-error", "effect-error", "section"] as const)
    it(`${look} every generated menu control joins the retained collection: ${state}`, async () => {
      const retry = vi.fn();
      const e = entry(
        "Row",
        0,
        state === "read-error"
          ? {
              state: {
                status: "error",
                message: "Disconnected",
                reloadEffectId: "retry",
                retryLabel: "Retry",
              },
            }
          : { effect: { kind: "action", effectId: "retry" } },
      );
      const m = {
        ...model(state === "section" ? [] : [e]),
        menu: { ownerKey: "account" },
      };
      if (state === "section")
        m.sections = [
          {
            ...identity("section"),
            subPart: "sidebar.section",
            label: "Section",
            entries: [],
            hideIfEmpty: false,
            disclosure: {
              binding: { value: true, set: retry },
              unmountWhenClosed: true,
            },
          },
        ];
      const effects = [
        {
          id: "retry",
          kind: "action" as const,
          actionName: "Retry",
          run: retry,
          ...(state === "effect-error" ? { error: "Rejected", retry } : {}),
        },
      ];
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Account</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Before</DropdownMenuItem>
            {look === "house" ? (
              <HouseSidebar model={m} effects={effects} />
            ) : (
              <DropdownMenuItem onSelect={() => retry()}>
                {state === "section" ? "Section" : "Retry"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem>After</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
        {
          pathname: "/",
          labels: { retry: "Retry" },
          menuControls: {
            account: ({ children, disabled }) => (
              <DropdownMenuItem asChild disabled={disabled}>
                {children}
              </DropdownMenuItem>
            ),
          },
        },
      );
      const target = getByRole(document.body, "menuitem", {
        name: state === "section" ? "Section" : "Retry",
      });
      const before = getByRole(document.body, "menuitem", { name: "Before" });
      await act(async () => {
        before.focus();
        fireEvent.keyDown(before, { key: "ArrowDown" });
      });
      if (state === "effect-error" && look === "house") {
        await waitFor(() => {
          if (document.activeElement === before)
            throw new Error("Focus has not left the first menu item");
        });
        await act(async () => {
          fireEvent.keyDown(required(document.activeElement, "focused item"), {
            key: "ArrowDown",
          });
        });
      }
      await waitFor(() => expect(document.activeElement).toBe(target));
      await act(async () => {
        fireEvent.keyDown(target, { key: "Enter" });
      });
      expect(retry).toHaveBeenCalledTimes(1);
    });

it("retains independently modeled menu rows inside an inline custom owner without crediting its body", () => {
  const menu = { ...model([entry("modeled")]), menu: { ownerKey: "account" } };
  const m = model(
    [entry("before", 0), entry("after", 2)],
    [slot("retained", 1)],
  );
  render(<HouseSidebar model={m} effects={[]} />, {
    pathname: "/",
    menuControls: { account: ({ children }) => children },
    slots: {
      retained: (
        <>
          <button data-rid="private" data-part="sidebar.item">
            Custom
          </button>
          <HouseSidebar model={menu} effects={[]} />
        </>
      ),
    },
  });
  const observed = captureShellSnapshot(host, {
    visible: () => true,
    observe: (identity, elements, order) => ({
      ...identity,
      part: "sidebar.item",
      containerId: "nav",
      order,
      present: true,
      family: "button",
      role: "button",
      expanded: null,
      name: elements[0].textContent,
      value: null,
      choices: [],
      enabled: true,
      selected: null,
      checked: null,
      shortcut: null,
      badge: null,
      effect: { kind: "none", target: null, result: null },
      read: { status: "ready", message: null, recovery: null },
      action: { pending: false, error: null, recovery: null },
      keyboard: { reachable: true, operable: true },
    }),
  });
  expect(observed.map((row) => row.id)).toEqual(["before", "modeled", "after"]);
});
