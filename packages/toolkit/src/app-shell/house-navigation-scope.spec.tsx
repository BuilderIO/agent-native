// @vitest-environment happy-dom
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  fireEvent,
  getByRole,
  queryByRole,
  waitFor,
} from "@testing-library/react";
import { Command } from "cmdk";
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ToolkitProvider } from "../provider.js";
import type {
  NavigationEntry,
  NavigationModel,
  ShellModel,
} from "./contracts.js";
import { HouseAppShell, HouseSidebar } from "./house-frames.js";
import {
  ShellGeneratedOwner,
  ShellContent,
  useShellHost,
  ShellHostProvider,
  ShellMenuControl,
  ShellMenuEditor,
  ShellNavigationScope,
  type ShellHost,
  type ShellNavigationOwnerProps,
  type ShellMenuControlProps,
  type ShellMenuEditorProps,
} from "./house-shell-host.js";
import {
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
const item = (
  id: string,
  extra: Partial<Omit<NavigationEntry, "part" | "subPart">> & {
    subPart?: "sidebar.item" | "sidebar.resize-handle";
  } = {},
): NavigationEntry => ({
  id,
  part: "sidebar",
  subPart: "sidebar.item",
  containerId: "nav",
  order: 0,
  kind: "action",
  label: id,
  ...extra,
});
const nav = (entries: readonly NavigationEntry[]): NavigationModel => ({
  entries,
  sections: [],
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
function mount(node: ReactNode, value: ShellHost = { pathname: "/" }) {
  act(() =>
    root.render(
      <ToolkitProvider>
        <ShellHostProvider value={value}>{node}</ShellHostProvider>
      </ToolkitProvider>,
    ),
  );
}
for (const compact of [false, true])
  it(`noninteractive current identity, compact=${compact}`, () => {
    const writes = vi.spyOn(Storage.prototype, "setItem");
    for (const current of [undefined, false, true, false]) {
      const m = nav([
        item("account.current", {
          kind: "identity",
          metadata: { current },
          effect: { kind: "none" },
        }),
      ]);
      m.presentation.collapsed.value = compact;
      mount(<HouseSidebar model={m} effects={[]} />);
      const identity = getByRole(host, "group", { name: "account.current" });
      expect(identity.getAttribute("aria-current")).toBe(
        current ? "true" : null,
      );
      expect(identity.querySelectorAll("[data-shell-current]")).toHaveLength(
        current ? 1 : 0,
      );
      expect(
        identity.querySelector("button,input,[tabindex],a[href]"),
      ).toBeNull();
      expect(identity.getAttribute("tabindex")).toBeNull();
      expect(host.querySelector("[aria-checked]")).toBeNull();
    }
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
for (const keyboard of [false, true])
  it(`resize keyboard=${keyboard} with decimal pointer commit`, async () => {
    const finish = vi.fn();
    const preview = vi.fn();
    function Fixture() {
      const [width, setWidth] = useState(240.5);
      const m = nav([
        item("resize", {
          subPart: "sidebar.resize-handle",
          kind: "controller",
        }),
      ]);
      m.resize = {
        interaction: "policy",
        policy: {
          min: 180,
          max: 400,
          step: 10,
          round: false,
          keyboard,
          pointerCancel: "commit-current",
          lostPointerCapture: "unbound",
          persist: "end",
          storageKey: "test-width",
          codec: "decimal",
        },
        width: { value: width, set: setWidth },
        preview,
        finishEffectId: "finish",
      };
      return (
        <HouseSidebar
          model={m}
          effects={[
            { id: "finish", kind: "action", actionName: "finish", run: finish },
          ]}
        />
      );
    }
    mount(<Fixture />);
    const grip = getByRole(host, "separator");
    expect(grip.tabIndex).toBe(keyboard ? 0 : -1);
    for (const key of ["End", "ArrowRight"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        grip.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(keyboard);
    }
    await act(async () => {
      fireEvent.doubleClick(grip);
    });
    expect(grip.getAttribute("aria-valuenow")).toBe(keyboard ? "400" : "240.5");
    expect(finish.mock.calls).toEqual(keyboard ? [[400], [400]] : []);
    finish.mockClear();
    preview.mockClear();
    Object.assign(grip, { setPointerCapture: vi.fn() });
    await act(async () => {
      fireEvent.pointerDown(grip, { button: 0, clientX: 100, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerMove(grip, { clientX: 79.25, pointerId: 1 });
    });
    expect(finish).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.lostPointerCapture(grip);
    });
    expect(finish).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.pointerCancel(grip);
    });
    const expected = keyboard ? 379.25 : 219.75;
    expect(preview.mock.calls).toEqual([[expected]]);
    expect(finish.mock.calls).toEqual([[expected]]);
  });
for (const look of ["default", "house"] as const)
  for (const gesture of ["pointer", "Enter", " "] as const)
    it(`${look} retained dropdown sole activation owner ${JSON.stringify(gesture)}`, async () => {
      const dispatch = vi.fn();
      const native = vi.fn();
      const anchor = vi.fn();
      const Adapter = ({ children }: ShellMenuControlProps) => (
        <Dropdown.Trigger asChild ref={anchor}>
          {children}
        </Dropdown.Trigger>
      );
      function Fixture() {
        const [open, setOpen] = useState(false);
        const entry = item("workspace.open", {
          effect: {
            kind: "open",
            surfaceId: "workspace",
            open: { value: open, set: setOpen, changeEffectId: "dispatch" },
            surface: {
              owner: "content",
              kind: "menu",
              mount: "host",
              activation: "content",
            },
            body: {
              owner: "custom",
              key: "workspace.body",
              reason: "retained menu",
            },
          },
        });
        const m = nav([entry]);
        m.menu = { ownerKey: "trigger" };
        return (
          <Dropdown.Root
            open={open}
            onOpenChange={(value) => {
              native(value);
              setOpen(value);
            }}
          >
            <ShellHostProvider
              value={{
                pathname: "/",
                menuControls: { trigger: Adapter },
                slots: { "workspace.body": null },
              }}
            >
              {look === "house" ? (
                <HouseSidebar
                  model={m}
                  effects={[
                    {
                      id: "dispatch",
                      kind: "action",
                      actionName: "dispatch",
                      run: dispatch,
                    },
                  ]}
                />
              ) : (
                <ShellMenuControl
                  entry={entry}
                  ownerKey="trigger"
                  disabled={false}
                >
                  <button>{entry.label}</button>
                </ShellMenuControl>
              )}
              <Dropdown.Portal>
                <Dropdown.Content>
                  <Dropdown.Item>Destination</Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </ShellHostProvider>
          </Dropdown.Root>
        );
      }
      mount(<Fixture />);
      const trigger = getByRole(host, "button", { name: "workspace.open" });
      expect(anchor.mock.calls.some(([node]) => node === trigger)).toBe(true);
      for (const detail of [{ button: 2 }, { button: 0, ctrlKey: true }]) {
        await act(async () => {
          fireEvent.pointerDown(trigger, detail);
        });
        expect(queryByRole(document.body, "menu")).toBeNull();
      }
      await act(async () => {
        if (gesture === "pointer")
          fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
        else fireEvent.keyDown(trigger, { key: gesture });
      });
      expect(getByRole(document.body, "menu")).toBeTruthy();
      if (gesture === "pointer")
        await act(async () => {
          fireEvent.pointerUp(trigger, { button: 0 });
          fireEvent.click(trigger);
        });
      expect(getByRole(document.body, "menu")).toBeTruthy();
      expect(native.mock.calls).toEqual([[true]]);
      expect(dispatch).not.toHaveBeenCalled();
      const menu = getByRole(document.body, "menu");
      expect(
        document.getElementById(
          required(
            menu.getAttribute("aria-labelledby"),
            "menu label reference",
          ),
        ),
      ).toBe(trigger);
      expect(
        document.getElementById(
          required(
            trigger.getAttribute("aria-controls"),
            "menu control reference",
          ),
        ),
      ).toBe(menu);
      await act(async () => {
        fireEvent.keyDown(menu, { key: "Escape" });
      });
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(queryByRole(document.body, "menu")).toBeNull();
      expect(dispatch).not.toHaveBeenCalled();
    });
for (const look of ["default", "house"] as const)
  it(`${look} section retains nested controller lifetime and ordering`, () => {
    const mounts = vi.fn();
    const unmounts = vi.fn();
    function Nested() {
      const [count, setCount] = useState(0);
      useEffect(() => {
        mounts();
        return unmounts;
      }, []);
      return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
    }
    function Owner({
      header,
      children,
    }: {
      header: ReactNode;
      children: ReactNode;
    }) {
      return (
        <div data-retained-group>
          {header}
          <Nested />
          {children}
        </div>
      );
    }
    const m = nav([]);
    m.sections = [
      {
        id: "folders",
        part: "sidebar",
        subPart: "sidebar.section",
        containerId: "nav",
        order: 0,
        label: "Folders",
        composition: { ownerKey: "folders" },
        hideIfEmpty: false,
        entries: [item("second", { order: 2 }), item("first", { order: 1 })],
      },
    ];
    const render = () =>
      mount(
        look === "house" ? (
          <HouseSidebar model={m} effects={[]} />
        ) : (
          <nav>
            <ShellGeneratedOwner
              ownerKey="folders"
              identity={m.sections[0]}
              header={<h3>Folders</h3>}
            >
              {[...m.sections[0].entries]
                .sort((a, b) => a.order - b.order)
                .map((entry) => (
                  <button key={entry.id}>{entry.label}</button>
                ))}
            </ShellGeneratedOwner>
          </nav>
        ),
        { pathname: "/", generatedOwners: { folders: Owner } },
      );
    render();
    act(() => {
      fireEvent.click(getByRole(host, "button", { name: "Count 0" }));
    });
    render();
    expect(getByRole(host, "button", { name: "Count 1" })).toBeTruthy();
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(unmounts).not.toHaveBeenCalled();
    expect(
      [...host.querySelectorAll("[data-retained-group] button")].map(
        (n) => n.textContent,
      ),
    ).toEqual(["Count 1", "first", "second"]);
    expect(host.querySelectorAll("nav")).toHaveLength(1);
  });
for (const look of ["default", "house"] as const)
  it(`${look} command editor keeps fuzzy collection selection Enter and ref`, async () => {
    const write = vi.fn();
    const select = vi.fn();
    const inputRef = vi.fn();
    function Editor({
      entry: _entry,
      onValueChange,
      ...props
    }: ShellMenuEditorProps) {
      return (
        <Command.Input
          {...props}
          ref={inputRef}
          onValueChange={onValueChange}
        />
      );
    }
    const Option = ({ entry, children, disabled }: ShellMenuControlProps) => (
      <Command.Item
        asChild
        value={entry.label}
        disabled={disabled}
        onSelect={() => select(entry.id)}
      >
        {children}
      </Command.Item>
    );
    function Fixture() {
      const [query, setQuery] = useState("");
      const entry = item("join.search", {
        kind: "filter",
        search: {
          binding: { value: query, set: setQuery, changeEffectId: "write" },
          placeholder: "Find team",
          match: "resolved",
        },
      });
      const m = nav([entry]);
      m.menu = { ownerKey: "command" };
      return (
        <Command label="join.search">
          <ShellHostProvider
            value={{
              pathname: "/",
              menuControls: { command: Option },
              menuEditors: { command: Editor },
            }}
          >
            {look === "house" ? (
              <HouseSidebar
                model={m}
                effects={[
                  {
                    id: "write",
                    kind: "action",
                    actionName: "write",
                    run: write,
                  },
                ]}
              />
            ) : (
              <ShellMenuEditor
                entry={entry}
                ownerKey="command"
                value={query}
                onValueChange={(value) => {
                  setQuery(value);
                  write(value);
                }}
                aria-label="join.search"
                placeholder="Find team"
              />
            )}
            <Command.List>
              <Command.Group>
                {[
                  item("alpha", { label: "Alpha team" }),
                  item("beta", { label: "Beta team" }),
                ].map((option) =>
                  look === "house" ? (
                    <HouseSidebar
                      key={option.id}
                      model={{
                        ...nav([option]),
                        menu: { ownerKey: "command" },
                      }}
                      effects={[]}
                    />
                  ) : (
                    <Command.Item
                      key={option.id}
                      value={option.label}
                      onSelect={() => select(option.id)}
                    >
                      {option.label}
                    </Command.Item>
                  ),
                )}
              </Command.Group>
            </Command.List>
          </ShellHostProvider>
        </Command>
      );
    }
    mount(<Fixture />);
    const input = getByRole(host, "combobox", { name: "join.search" });
    expect(inputRef.mock.calls.some(([node]) => node === input)).toBe(true);
    await act(async () => {
      fireEvent.change(input, { target: { value: "bt" } });
    });
    await waitFor(() =>
      expect(host.querySelectorAll('[cmdk-item=""]')).toHaveLength(1),
    );
    expect(getByRole(host, "option", { name: "Beta team" })).toBeTruthy();
    expect(queryByRole(host, "option", { name: "Alpha team" })).toBeNull();
    expect(write.mock.calls).toEqual([["bt"]]);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(select.mock.calls).toEqual([["beta"]]);
    expect(write.mock.calls).toEqual([["bt"]]);
  });
for (const look of ["default", "house"] as const)
  it(`${look} independent mobile owner resets while desktop survives`, async () => {
    let resize = () => {};
    const media = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => {
        resize = fn;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => media);
    const mounted = vi.fn();
    const removed = vi.fn();
    const mobileEffect = vi.fn();
    const desktopEffect = vi.fn();
    function Mobile({ children }: ShellNavigationOwnerProps) {
      const [count, setCount] = useState(0);
      useEffect(() => {
        mounted();
        return removed;
      }, []);
      return children({
        model: nav([
          item(`Mobile ${count}`, {
            effect: { kind: "action", effectId: "copy" },
          }),
        ]),
        effects: [
          {
            id: "copy",
            kind: "action",
            actionName: "copy",
            run: () => {
              mobileEffect();
              setCount(count + 1);
            },
          },
        ],
        host: { pathname: "/mobile", slots: {} },
      });
    }
    function Fixture() {
      const [open, setOpen] = useState(false);
      const [count, setCount] = useState(0);
      const navigation = nav([
        item(`Desktop ${count}`, {
          effect: { kind: "action", effectId: "copy" },
        }),
      ]);

      navigation.presentation.collapsed.value = true;
      const model: ShellModel = {
        frame: { key: "independent", routeRuleId: "test" },
        navigation,
        mobileNavigation: {
          ownerKey: "mobile",
          open: { value: open, set: setOpen },
        },
        effects: [
          {
            id: "copy",
            kind: "action",
            actionName: "copy",
            run: () => {
              desktopEffect();
              setCount(count + 1);
            },
          },
        ],
        shortcuts: [],
        preferences: [],
        regions: [
          {
            id: "nav",
            part: "app-shell",
            subPart: "app-shell.nav",
            containerId: "root",
            order: 0,
            content: { owner: "kit", key: "nav" },
          },
        ],
      };
      return (
        <>
          <button onClick={() => setOpen(!open)}>Toggle drawer</button>
          <ShellHostProvider
            value={{
              pathname: "/desktop",
              navigationOwners: { mobile: Mobile },
            }}
          >
            {look === "house" ? (
              <HouseAppShell model={model} />
            ) : (
              <>
                <HouseSidebar model={navigation} effects={model.effects} />
                {open && (
                  <ShellNavigationScope ownerKey="mobile">
                    {(scope) => (
                      <HouseSidebar
                        model={scope.model}
                        effects={scope.effects}
                      />
                    )}
                  </ShellNavigationScope>
                )}
              </>
            )}
          </ShellHostProvider>
        </>
      );
    }
    mount(<Fixture />);
    act(() => {
      fireEvent.click(getByRole(host, "button", { name: "Desktop 0" }));
    });
    const desktop = getByRole(host, "button", { name: "Desktop 1" });
    expect(mounted).not.toHaveBeenCalled();
    act(() => {
      media.matches = true;
      resize();
    });
    expect(host.contains(desktop)).toBe(true);
    act(() => {
      fireEvent.click(getByRole(host, "button", { name: "Toggle drawer" }));
    });
    expect(desktop.closest("nav")?.getAttribute("data-collapsed")).toBe("true");
    const mobile = getByRole(document.body, "button", { name: "Mobile 0" });
    expect(mobile.closest("nav")?.getAttribute("data-collapsed")).toBe("false");
    act(() => {
      fireEvent.click(mobile);
    });
    expect(
      getByRole(document.body, "button", { name: "Mobile 1" }),
    ).toBeTruthy();
    expect(mobileEffect).toHaveBeenCalledTimes(1);
    expect(desktopEffect).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.click(
        getByRole(host, "button", { name: "Toggle drawer", hidden: true }),
      );
    });
    await waitFor(() => expect(removed).toHaveBeenCalledTimes(1));
    act(() => {
      fireEvent.click(
        getByRole(host, "button", { name: "Toggle drawer", hidden: true }),
      );
    });
    expect(
      getByRole(document.body, "button", { name: "Mobile 0" }),
    ).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(host.contains(desktop)).toBe(true);
  });

const observation: ShellSemanticSnapshot = {
  id: "row",
  part: "sidebar.item",
  containerId: "nav",
  order: 0,
  present: true,
  family: "button",
  role: "button",
  expanded: null,
  name: "row",
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
};
for (const [field, value] of [
  ["current", "true"],
  ["activationOwner", "content"],
  ["editorOwner", "command"],
  ["navigationOwner", "mobile"],
] as const)
  it(`comparison rejects ${field} ownership/annotation differences in either direction`, () => {
    const changed = { ...observation, [field]: value };
    expect(
      compareShellSnapshots([observation], [changed]).differences,
    ).toContain(`["row",null]: ${field}`);
    expect(
      compareShellSnapshots([changed], [observation]).differences,
    ).toContain(`["row",null]: ${field}`);
  });

for (const phase of ["change", "blur", "explicit"] as const)
  it(`retained native editor keeps ${phase} commit policy and pending lock`, async () => {
    const writes = vi.fn();
    const Editor = ({
      entry: _entry,
      onValueChange,
      ...props
    }: ShellMenuEditorProps) => (
      <input
        {...props}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
    function Fixture({ pending = false }: { pending?: boolean }) {
      const [value, setValue] = useState("");
      const entry = item("query", {
        kind: "filter",
        search: {
          binding: {
            value,
            set: setValue,
            changeEffectId: "query",
            commit: phase,
          },
          placeholder: "Query",
          match: "resolved",
        },
      });
      return (
        <HouseSidebar
          model={{ ...nav([entry]), menu: { ownerKey: "native" } }}
          effects={[
            {
              id: "query",
              kind: "action",
              actionName: "query",
              pending,
              run: writes,
            },
          ]}
        />
      );
    }
    const value = { pathname: "/", menuEditors: { native: Editor } };
    mount(<Fixture />, value);
    const input = getByRole(host, "searchbox", { name: "query" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "needle" } });
    });
    expect(writes.mock.calls).toEqual(phase === "change" ? [["needle"]] : []);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(writes.mock.calls).toEqual(phase === "blur" ? [] : [["needle"]]);
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(writes.mock.calls).toEqual([["needle"]]);
    mount(<Fixture pending />, value);
    expect((input as HTMLInputElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.change(input, { target: { value: "blocked" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);
    });
    expect(writes.mock.calls).toEqual([["needle"]]);
  });

it("navigation scope isolates same-named host slots and pathname without leaking into the desktop", () => {
  function Probe() {
    const scoped = useShellHost();
    return (
      <div data-path={scoped.pathname}>
        <ShellContent
          content={{ owner: "custom", key: "body", reason: "retained body" }}
        />
      </div>
    );
  }
  const Mobile = ({ children }: ShellNavigationOwnerProps) =>
    children({
      model: nav([]),
      effects: [],
      host: { pathname: "/mobile", slots: { body: <span>Mobile body</span> } },
    });
  mount(
    <>
      <Probe />
      <ShellNavigationScope ownerKey="mobile">
        {() => <Probe />}
      </ShellNavigationScope>
      <Probe />
    </>,
    {
      pathname: "/desktop",
      slots: { body: <span>Desktop body</span> },
      navigationOwners: { mobile: Mobile },
    },
  );
  expect(
    [...host.querySelectorAll("[data-path]")].map((node) => [
      node.getAttribute("data-path"),
      node.textContent,
    ]),
  ).toEqual([
    ["/desktop", "Desktop body"],
    ["/mobile", "Mobile body"],
    ["/desktop", "Desktop body"],
  ]);
});

const navigationRegionCases = [
  { name: "ready", extra: {}, visible: true, ready: true, disabled: false },
  {
    name: "disabled",
    extra: { disabled: true },
    visible: true,
    ready: true,
    disabled: true,
  },
  {
    name: "denied disabled",
    extra: {
      gate: { key: "nav", allowed: false, denied: "disabled" as const },
    },
    visible: true,
    ready: true,
    disabled: true,
  },
  {
    name: "hidden",
    extra: { visible: false },
    visible: false,
    ready: true,
    disabled: false,
  },
  {
    name: "denied hidden",
    extra: { gate: { key: "nav", allowed: false, denied: "hidden" as const } },
    visible: false,
    ready: true,
    disabled: false,
  },
  {
    name: "loading",
    extra: { state: { status: "loading" as const, label: "Loading nav" } },
    visible: true,
    ready: false,
    disabled: false,
  },
  {
    name: "error",
    extra: { state: { status: "error" as const, message: "Nav unavailable" } },
    visible: true,
    ready: false,
    disabled: false,
  },
  {
    name: "retry",
    extra: {
      state: {
        status: "error" as const,
        message: "Nav unavailable",
        reloadEffectId: "reload",
        retryLabel: "Recover nav",
      },
    },
    visible: true,
    ready: false,
    disabled: false,
  },
  {
    name: "retry disabled",
    extra: {
      disabled: true,
      state: {
        status: "error" as const,
        message: "Nav unavailable",
        reloadEffectId: "reload",
        retryLabel: "Recover nav",
      },
    },
    visible: true,
    ready: false,
    disabled: true,
  },
  {
    name: "retry pending",
    extra: {
      state: {
        status: "error" as const,
        message: "Nav unavailable",
        reloadEffectId: "reload",
        retryLabel: "Recover nav",
      },
    },
    visible: true,
    ready: false,
    disabled: false,
    pending: true,
  },
];
for (const copies of [1, 2])
  for (const scenario of navigationRegionCases)
    it(`scoped mobile region preserves ${scenario.name}, ${copies} shell(s)`, async () => {
      vi.stubGlobal("matchMedia", () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      const mobileAction = vi.fn();
      const desktopAction = vi.fn();
      const mobileReload = vi.fn();
      const desktopReload = vi.fn();
      const MobileOwner = ({ children }: ShellNavigationOwnerProps) =>
        children({
          model: nav([
            item("mobile.row", {
              label: "Mobile row",
              effect: { kind: "action", effectId: "visit" },
            }),
          ]),
          effects: [
            {
              id: "visit",
              kind: "action",
              actionName: "Visit mobile",
              run: mobileAction,
            },
            {
              id: "reload",
              kind: "action",
              actionName: "Reload mobile",
              run: mobileReload,
              pending: "pending" in scenario && scenario.pending,
            },
          ],
          host: {
            pathname: "/mobile",
            generatedOwners: {
              region: ({ header, children }) => (
                <div data-nav-owner="mobile">
                  {header}
                  {children}
                </div>
              ),
            },
          },
        });
      const model: ShellModel = {
        frame: { key: "region", routeRuleId: "test" },
        navigation: nav([item("desktop.row", { label: "Desktop row" })]),
        mobileNavigation: { ownerKey: "mobile", open: { value: true } },
        regions: [
          {
            id: "nav",
            part: "app-shell",
            subPart: "app-shell.nav",
            containerId: "root",
            order: 0,
            title: "Navigation region",
            content: { owner: "kit", key: "nav" },
            composition: { ownerKey: "region" },
            actions: [
              item("region.action", {
                label: "Region action",
                effect: { kind: "action", effectId: "visit" },
              }),
            ],
            ...scenario.extra,
          },
        ],
        effects: [
          {
            id: "visit",
            kind: "action",
            actionName: "Visit desktop",
            run: desktopAction,
          },
          {
            id: "reload",
            kind: "action",
            actionName: "Reload desktop",
            run: desktopReload,
          },
        ],
        shortcuts: [],
        preferences: [],
      };
      mount(
        <>
          {Array.from({ length: copies }, (_, index) => (
            <HouseAppShell key={index} model={model} />
          ))}
        </>,
        {
          pathname: "/desktop",
          navigationOwners: { mobile: MobileOwner },
          generatedOwners: {
            region: ({ header, children }) => (
              <div data-nav-owner="desktop">
                {header}
                {children}
              </div>
            ),
          },
        },
      );
      const dialogs = [
        ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ];
      expect(dialogs).toHaveLength(copies);
      for (const dialog of dialogs) {
        const region = dialog.querySelector('[data-rid="nav"]');
        expect(Boolean(region)).toBe(scenario.visible);
        const action = dialog.querySelector<HTMLButtonElement>(
          'button[data-rid="mobile.row"]',
        );
        const header = dialog.querySelector<HTMLButtonElement>(
          'button[data-rid="region.action"]',
        );
        const interactive = scenario.visible && scenario.ready;
        expect(region?.getAttribute("data-part")).toBe(
          scenario.visible ? "app-shell.nav" : undefined,
        );
        expect(dialog.querySelector('[data-nav-owner="mobile"]') !== null).toBe(
          interactive,
        );
        expect(dialog.querySelector('[data-nav-owner="desktop"]')).toBeNull();
        expect(action?.disabled).toBe(
          interactive ? scenario.disabled : undefined,
        );
        expect(header?.disabled).toBe(
          interactive ? scenario.disabled : undefined,
        );
        if (interactive)
          await act(async () => {
            fireEvent.click(required(action, "generated navigation action"));
            fireEvent.click(required(header, "generated navigation header"));
          });
        expect(
          dialog.querySelector('[role="status"][aria-label="Loading nav"]') !==
            null,
        ).toBe(scenario.name === "loading");
        expect(
          dialog
            .querySelector('[role="alert"]')
            ?.textContent.includes("Nav unavailable") === true,
        ).toBe(
          scenario.name.includes("error") || scenario.name.includes("retry"),
        );
        const recoverable = scenario.name.includes("retry");
        const retry = dialog.querySelector<HTMLButtonElement>(
          'button[aria-label="Recover nav"]',
        );
        expect(retry?.disabled).toBe(
          recoverable
            ? scenario.disabled || ("pending" in scenario && scenario.pending)
            : undefined,
        );
        if (recoverable)
          await act(async () => {
            fireEvent.click(required(retry, "navigation recovery control"));
          });
      }
      expect(mobileAction).toHaveBeenCalledTimes(
        scenario.visible && scenario.ready && !scenario.disabled
          ? copies * 2
          : 0,
      );
      expect(desktopAction).not.toHaveBeenCalled();
      expect(desktopReload).not.toHaveBeenCalled();
      expect(mobileReload).toHaveBeenCalledTimes(
        scenario.name === "retry" ? copies : 0,
      );
      const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
