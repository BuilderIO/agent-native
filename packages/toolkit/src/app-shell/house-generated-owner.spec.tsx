import * as Context from "@radix-ui/react-context-menu";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
// @vitest-environment happy-dom
import { fireEvent, getByRole, queryAllByRole } from "@testing-library/react";
import { act, useState, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ToolkitProvider } from "../provider.js";
import type {
  NavigationEntry,
  NavigationModel,
  ShellModel,
} from "./contracts.js";
import { HouseSidebar, HouseAppShell } from "./house-frames.js";
import {
  ShellContent,
  ShellGeneratedOwner,
  ShellHostProvider,
  shellFrameAttributes,
  type ShellGeneratedOwnerProps,
  type ShellHost,
} from "./house-shell-host.js";
import {
  compareShellSnapshots,
  type ShellSemanticSnapshot,
} from "./shell-testing.js";
import {
  ShellContextSubTrigger,
  ShellDropdownSubTrigger,
} from "./sidebar-shell.js";
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
const item = (
  id: string,
  extra: Partial<Omit<NavigationEntry, "part" | "subPart">> = {},
): NavigationEntry => ({
  ...identity(id),
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
const shell = (navigation = nav([])): ShellModel => ({
  frame: { key: "test", routeRuleId: "test" },
  navigation,
  regions: [],
  shortcuts: [],
  preferences: [],
  effects: [],
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
function RefEntry({ entry }: { entry: NavigationEntry }) {
  const header = (
    <button
      data-rid={entry.id}
      disabled={entry.disabled}
      onClick={() => {
        if (entry.effect?.kind === "action") calls(entry.effect.effectId);
      }}
    >
      {entry.label}
      {entry.metadata?.current && (
        <span aria-hidden="true" data-shell-current>
          ✓
        </span>
      )}
    </button>
  );
  return (
    <ShellGeneratedOwner
      identity={entry}
      ownerKey={entry.composition?.ownerKey}
      header={header}
    >
      <div hidden={entry.disclosure?.binding.value === false}>
        {entry.children?.map((child) => (
          <RefEntry key={child.id} entry={child} />
        ))}
      </div>
    </ShellGeneratedOwner>
  );
}
function RefSidebar({ model }: { model: NavigationModel }) {
  return (
    <nav data-part="sidebar">
      {model.entries.map((entry) => (
        <RefEntry key={entry.id} entry={entry} />
      ))}
    </nav>
  );
}
let calls = (_id: string) => {};
const owner = ({
  header,
  children,
  identity: id,
}: ShellGeneratedOwnerProps) => (
  <div data-owner={id.id}>
    <div data-leading>{header}</div>
    <div data-body>{children}</div>
  </div>
);
const kinds: NavigationEntry["kind"][] = [
  "destination",
  "action",
  "choice",
  "disclosure",
  "heading",
  "identity",
  "status",
  "filter",
  "controller",
];
for (const compact of [false, true])
  for (const kind of kinds) {
    it(`current annotation ${kind}, compact=${compact}, remains decorative and read-only`, () => {
      const run = vi.fn();
      const storage = vi.spyOn(Storage.prototype, "setItem");
      for (const current of [undefined, false, true, false]) {
        const entry = item("workspace", {
          kind,
          ...(kind === "filter" ? { binding: { value: "" } } : {}),
          metadata: { current, pinned: true },
        });
        const m = nav([entry]);
        m.presentation.collapsed.value = compact;
        mount(<HouseSidebar model={m} effects={[]} />);
        expect(host.querySelectorAll("[data-shell-current]")).toHaveLength(
          current ? 1 : 0,
        );
        expect(
          host
            .querySelector("[data-shell-current]")
            ?.getAttribute("aria-hidden"),
        ).toBe(current ? "true" : undefined);
        expect(
          host.querySelector(
            "[aria-checked],input[type=checkbox],input[type=radio]",
          ),
        ).toBeNull();
      }
      expect(run).not.toHaveBeenCalled();
      expect(storage).not.toHaveBeenCalled();
      storage.mockRestore();
    });
  }
for (const look of ["reference", "house"] as const) {
  for (const disabled of [false, true])
    it(`${look} ordinary generated entry retains its context owner, disabled=${disabled}`, () => {
      calls = vi.fn();
      const m = nav([
        item("destination", {
          disabled,
          composition: { ownerKey: "context" },
          effect: { kind: "action", effectId: "visit" },
        }),
      ]);
      const ContextOwner = ({ header, children }: ShellGeneratedOwnerProps) => (
        <Context.Root>
          <Context.Trigger asChild>{header}</Context.Trigger>
          {children}
          <Context.Portal>
            <Context.Content>
              <Context.Item>Inspect</Context.Item>
            </Context.Content>
          </Context.Portal>
        </Context.Root>
      );
      const controls = {
        pathname: "/",
        generatedOwners: { context: ContextOwner },
      };
      mount(
        look === "house" ? (
          <HouseSidebar
            model={m}
            effects={[
              {
                id: "visit",
                kind: "action",
                actionName: "visit",
                run: () => calls("visit"),
              },
            ]}
          />
        ) : (
          <RefSidebar model={m} />
        ),
        controls,
      );
      const button = getByRole(host, "button", { name: "destination" });
      act(() => {
        fireEvent.click(button);
      });
      expect(calls).toHaveBeenCalledTimes(disabled ? 0 : 1);
      expect(host.querySelectorAll("nav")).toHaveLength(1);
      act(() => {
        fireEvent.contextMenu(button, { clientX: 20, clientY: 20 });
      });
      expect(
        getByRole(document.body, "menuitem", { name: "Inspect" }),
      ).toBeTruthy();
    });
  it(`${look} retained sortable owner encloses header and recursive descendants, with no extra sidebar`, () => {
    const drag = vi.fn();
    const drop = vi.fn();
    const Sortable = ({
      identity: id,
      header,
      children,
    }: ShellGeneratedOwnerProps) => (
      <div
        draggable
        data-sortable={id.id}
        onDragStart={() => drag(id.id)}
        onDrop={() => drop(id.id)}
      >
        {header}
        {children}
      </div>
    );
    const parent = item("parent", {
      composition: { ownerKey: "sortable" },
      disclosure: { binding: { value: true }, unmountWhenClosed: false },
      children: [
        item("second", { order: 2 }),
        item("first", {
          order: 1,
          composition: { ownerKey: "sortable" },
          children: [item("nested")],
        }),
      ],
    });
    const m = nav([
      {
        ...parent,
        children: [...required(parent.children, "parent children")].sort(
          (a, b) => a.order - b.order,
        ),
      },
    ]);
    mount(
      look === "house" ? (
        <HouseSidebar model={m} effects={[]} />
      ) : (
        <RefSidebar model={m} />
      ),
      { pathname: "/", generatedOwners: { sortable: Sortable } },
    );
    const container = required(
      host.querySelector('[data-sortable="parent"]'),
      "sortable parent",
    );
    expect(
      [...container.querySelectorAll("button")].map((x) => x.textContent),
    ).toEqual(["parent", "first", "nested", "second"]);
    act(() => {
      fireEvent.dragStart(container);
      fireEvent.drop(container);
    });
    expect(drag).toHaveBeenCalledWith("parent");
    expect(drop).toHaveBeenCalledWith("parent");
    expect(host.querySelectorAll("nav")).toHaveLength(1);
  });
  it(`${look} body stays mounted while hidden by its retained owner`, () => {
    const lifecycle = vi.fn();
    const Retained = ({ header, children }: ShellGeneratedOwnerProps) => {
      const [open, setOpen] = useState(true);
      useEffect(() => {
        lifecycle("mount");
        return () => lifecycle("unmount");
      }, []);
      return (
        <div>
          <div onClick={() => setOpen(!open)}>{header}</div>
          <div data-retained-body hidden={!open}>
            {children}
          </div>
        </div>
      );
    };
    const m = nav([
      item("favorites", {
        composition: { ownerKey: "retained" },
        children: [item("issue")],
      }),
    ]);
    mount(
      look === "house" ? (
        <HouseSidebar model={m} effects={[]} />
      ) : (
        <RefSidebar model={m} />
      ),
      { pathname: "/", generatedOwners: { retained: Retained } },
    );
    const issue = host.querySelector('[data-rid="issue"]');
    act(() => {
      fireEvent.click(getByRole(host, "button", { name: "favorites" }));
    });
    expect(
      host.querySelector("[data-retained-body]")?.hasAttribute("hidden"),
    ).toBe(true);
    expect(host.querySelector('[data-rid="issue"]')).toBe(issue);
    expect(lifecycle.mock.calls).toEqual([["mount"]]);
  });
  for (const pointerCursors of [undefined, false, true])
    for (const underlineLinks of [undefined, false, true])
      it(`${look} actual root identity/preferences ${pointerCursors}/${underlineLinks}`, () => {
        const m = shell();
        m.frame.identity = {
          id: "workspace",
          part: "app-shell",
          subPart: "app-shell",
          containerId: "root",
          order: 0,
          entityKey: "current",
        };
        m.frame.preferences = { pointerCursors, underlineLinks };
        mount(
          look === "house" ? (
            <HouseAppShell model={m} />
          ) : (
            <div data-part="app-shell" {...shellFrameAttributes(m.frame)} />
          ),
        );
        const frame = required(host.firstElementChild, "frame");
        expect(frame.getAttribute("data-rid")).toBe("workspace");
        expect(frame.getAttribute("data-rid-key")).toBe("current");
        expect(frame.hasAttribute("data-pointer-cursors")).toBe(
          Boolean(pointerCursors),
        );
        expect(frame.hasAttribute("data-underline-links")).toBe(
          Boolean(underlineLinks),
        );
        expect(host.querySelectorAll('[data-rid="workspace"]')).toHaveLength(1);
      });
  it(`${look} retained page-header owner receives generated opener in leading position`, () => {
    const m = shell();
    const run = vi.fn();
    m.effects = [{ id: "mobile", kind: "action", actionName: "mobile", run }];
    const region = {
      id: "header",
      part: "app-shell" as const,
      subPart: "app-shell.topbar" as const,
      containerId: "root",
      order: 0,
      composition: { ownerKey: "page" },
      content: {
        owner: "custom" as const,
        key: "body",
        reason: "Retained page",
      },
      actions: [
        item("open navigation", {
          effect: { kind: "action", effectId: "mobile" },
        }),
      ],
    };
    m.regions = [region];
    const Page = ({ header, children }: ShellGeneratedOwnerProps) => (
      <header data-page>
        <div data-leading>{header}</div>
        <h1>Page title</h1>
        {children}
      </header>
    );
    mount(
      look === "house" ? (
        <HouseAppShell model={m} />
      ) : (
        <ShellGeneratedOwner
          identity={region}
          ownerKey={region.composition.ownerKey}
          header={<button onClick={() => run()}>open navigation</button>}
        >
          <ShellContent content={region.content} />
        </ShellGeneratedOwner>
      ),
      {
        pathname: "/",
        generatedOwners: { page: Page },
        slots: { body: <article>Owned page</article> },
      },
    );
    expect(host.querySelectorAll("header")).toHaveLength(1);
    const page = required(host.querySelector("[data-page]"), "page");
    const button = getByRole(page as HTMLElement, "button", {
      name: "open navigation",
    });
    expect(page.querySelector("[data-leading]")?.contains(button)).toBe(true);
    expect(page.textContent).toContain("Page titleOwned page");
    act(() => {
      fireEvent.click(button);
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("button")).toHaveLength(1);
  });
}
it("missing generated owners fail closed, never falling back to unwrapped controls", () => {
  expect(() =>
    mount(
      <HouseSidebar
        model={nav([item("missing", { composition: { ownerKey: "absent" } })])}
        effects={[]}
      />,
    ),
  ).toThrow("Missing shell generated owner: absent");
});
it("section owner receives header and opened generated body within a single frame", () => {
  const m = nav([]);
  m.sections = [
    {
      ...identity("group"),
      label: "Group",
      entries: [item("child")],
      hideIfEmpty: false,
      composition: { ownerKey: "group" },
    },
  ];
  mount(<HouseSidebar model={m} effects={[]} />, {
    pathname: "/",
    generatedOwners: { group: owner },
  });
  expect(
    host.querySelector('[data-owner="group"] [data-leading]')?.textContent,
  ).toBe("Group");
  expect(
    host.querySelector('[data-owner="group"] [data-body]')?.textContent,
  ).toBe("child");
});
for (const kind of ["dropdown", "context"] as const)
  for (const look of ["house", "reference"] as const)
    it(`${look} ${kind} submenu slots one generated control and keeps keyboard semantics`, () => {
      const Menu = kind === "dropdown" ? Dropdown : Context;
      const Trigger =
        kind === "dropdown" ? ShellDropdownSubTrigger : ShellContextSubTrigger;
      const m = nav([item("submenu")]);
      m.menu = { ownerKey: "menu" };
      const adapter = ({ children }: { children: ReactNode }) => (
        <Trigger>{children as React.ReactElement}</Trigger>
      );
      mount(
        <Menu.Root>
          <Menu.Trigger asChild>
            <button>Menu</button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content>
              <Menu.Sub open>
                <ShellHostProvider
                  value={{ pathname: "/", menuControls: { menu: adapter } }}
                >
                  {look === "house" ? (
                    <HouseSidebar model={m} effects={[]} />
                  ) : (
                    <Trigger>
                      <button>submenu</button>
                    </Trigger>
                  )}
                </ShellHostProvider>
                <Menu.SubContent>
                  <Menu.Item>Child</Menu.Item>
                </Menu.SubContent>
              </Menu.Sub>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>,
      );
      if (kind === "dropdown")
        act(() => {
          fireEvent.pointerDown(getByRole(host, "button", { name: "Menu" }), {
            button: 0,
            ctrlKey: false,
          });
        });
      else
        act(() => {
          fireEvent.contextMenu(getByRole(host, "button", { name: "Menu" }), {
            clientX: 10,
            clientY: 10,
          });
        });
      const submenu = getByRole(document.body, "menuitem", { name: "submenu" });
      expect(submenu.tagName).toBe("BUTTON");
      expect(submenu.querySelectorAll("svg")).toHaveLength(1);
      expect(submenu.querySelector("button")).toBeNull();
      act(() => {
        (submenu as HTMLElement).focus();
        fireEvent.keyDown(submenu, { key: "ArrowRight" });
      });
      expect(
        getByRole(document.body, "menuitem", { name: "Child" }),
      ).toBeTruthy();
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
  ["compositionOwner", "owner"],
  ["annotations", { current: true, pinned: false }],
  ["rootPreferences", { pointerCursors: true, underlineLinks: false }],
] as const)
  it(`comparison helper rejects ${field} difference in both directions`, () => {
    const changed = { ...observation, [field]: value };
    expect(
      compareShellSnapshots([observation], [changed]).differences,
    ).toContain(`["row",null]: ${field}`);
    expect(
      compareShellSnapshots([changed], [observation]).differences,
    ).toContain(`["row",null]: ${field}`);
  });
for (const state of [
  undefined,
  { status: "loading" as const, label: "Loading" },
  { status: "error" as const, message: "Unavailable" },
  { status: "ready" as const },
])
  it(`composed entry keeps the retained controller across read state ${state?.status}`, () => {
    const lifecycle = vi.fn();
    const Owner = ({ header, children }: ShellGeneratedOwnerProps) => {
      useEffect(() => {
        lifecycle("mount");
        return () => lifecycle("unmount");
      }, []);
      return (
        <div data-retained>
          {header}
          {children}
        </div>
      );
    };
    const value = { pathname: "/", generatedOwners: { retained: Owner } };
    mount(
      <HouseSidebar
        model={nav([item("row", { composition: { ownerKey: "retained" } })])}
        effects={[]}
      />,
      value,
    );
    const retained = host.querySelector("[data-retained]");
    mount(
      <HouseSidebar
        model={nav([
          item("row", { composition: { ownerKey: "retained" }, state }),
        ])}
        effects={[]}
      />,
      value,
    );
    expect(host.querySelector("[data-retained]")).toBe(retained);
    expect(lifecycle.mock.calls).toEqual([["mount"]]);
    expect(host.querySelectorAll("[data-retained] button")).toHaveLength(
      state && state.status !== "ready" ? 0 : 1,
    );
  });
it("two composed shells keep ids unique and region-disabled descendants disabled", () => {
  const m = shell(
    nav([
      item("row", {
        composition: { ownerKey: "owner" },
        description: "Description",
      }),
    ]),
  );
  m.regions = [
    {
      id: "header",
      part: "app-shell",
      subPart: "app-shell.topbar",
      containerId: "root",
      order: 0,
      disabled: true,
      composition: { ownerKey: "owner" },
      content: { owner: "custom", key: "page", reason: "Page" },
      actions: [item("action")],
    },
  ];
  mount(
    <>
      <HouseAppShell model={m} />
      <HouseAppShell model={m} />
    </>,
    {
      pathname: "/",
      generatedOwners: { owner },
      slots: { page: <span>Page</span> },
    },
  );
  const ids = [...host.querySelectorAll("[id]")].map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    [...host.querySelectorAll<HTMLButtonElement>("button")].every(
      (n) => n.disabled,
    ),
  ).toBe(true);
});
it("context owner encloses the complete kit-reordered row and handle", () => {
  const m = nav([]);
  const preview = vi.fn();
  const commit = vi.fn();
  const RowOwner = ({ header, children }: ShellGeneratedOwnerProps) => (
    <div data-entire-row>
      {header}
      {children}
    </div>
  );
  m.sections = [
    {
      ...identity("group"),
      entries: [
        item("row", { composition: { ownerKey: "context" }, entityKey: "one" }),
      ],
      hideIfEmpty: false,
      reorder: {
        controllerId: "order",
        commitEffectId: "order",
        preview,
        policy: {
          containerId: "nav",
          pointerThreshold: 5,
          collision: "closestCenter",
          keyboard: {
            start: "Space",
            move: "arrows",
            end: "Space",
            cancel: "Escape",
          },
          cancel: "restore-order",
          missingDropTarget: "no-commit",
          merge: "siblings",
          persist: "none",
          disableWhileEffectPending: true,
        },
      },
    },
  ];
  mount(
    <HouseSidebar
      model={m}
      effects={[
        { id: "order", kind: "action", actionName: "order", run: commit },
      ]}
    />,
    { pathname: "/", generatedOwners: { context: RowOwner } },
  );
  const retained = required(
    host.querySelector("[data-entire-row]"),
    "retained row",
  );
  const sortable = required(
    retained.querySelector('[data-reorder-key="one"]'),
    "sortable row",
  );
  expect(sortable).not.toBeNull();
  expect(retained.querySelectorAll("[data-entire-row]")).toHaveLength(0);
  const handle = getByRole(retained as HTMLElement, "button", {
    name: /Reorder/i,
  });
  expect(sortable.contains(handle)).toBe(true);
  act(() => {
    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "Escape" });
  });
  expect(commit).not.toHaveBeenCalled();
});

for (const kind of kinds)
  for (const condition of ["enabled", "disabled", "denied"] as const)
    for (const variant of ["loading", "error", "reload", "pending"] as const)
      it(`${kind} composed ${variant} retains its named read group, ${condition}`, () => {
        const disabled = condition !== "enabled";
        const effects = [
          {
            id: "reload",
            kind: "action" as const,
            actionName: "Reload",
            run: vi.fn(),
            pending: variant === "pending",
          },
        ];
        const state =
          variant === "loading"
            ? { status: "loading" as const, label: "Loading row" }
            : {
                status: "error" as const,
                message: "Unavailable",
                ...(variant !== "error"
                  ? { reloadEffectId: "reload", retryLabel: "Retry row" }
                  : {}),
              };
        const e = item("row", {
          kind,
          state,
          composition: { ownerKey: "retained" },
          accessibleLabel: "Named row",
          ...(condition === "disabled" ? { disabled: true } : {}),
          ...(condition === "denied"
            ? { gate: { key: "allowed", allowed: false, denied: "disabled" } }
            : {}),
          ...(kind === "filter" ? { binding: { value: "" } } : {}),
        });
        mount(<HouseSidebar model={nav([e])} effects={effects} />, {
          pathname: "/",
          generatedOwners: { retained: owner },
        });
        const group = getByRole(host, "group", { name: "Named row" });
        expect(group.getAttribute("aria-disabled")).toBe(
          disabled ? "true" : null,
        );
        expect(
          queryAllByRole(group, "status", { name: "Loading row" }),
        ).toHaveLength(variant === "loading" ? 1 : 0);
        expect(
          queryAllByRole(group, "alert").map((alert) =>
            alert.textContent.includes("Unavailable"),
          ),
        ).toEqual(variant === "loading" ? [] : [true]);
        expect(
          queryAllByRole<HTMLButtonElement>(group, "button", {
            name: "Retry row",
          }).map((button) => button.disabled),
        ).toEqual(
          variant === "reload" || variant === "pending"
            ? [disabled || variant === "pending"]
            : [],
        );
        expect(group.querySelectorAll("button")).toHaveLength(
          variant === "reload" || variant === "pending" ? 1 : 0,
        );
      });

it("retained context trigger composes through a retained menu collection adapter", () => {
  const opened = vi.fn();
  const m = nav([
    item("hidden destination", { composition: { ownerKey: "context" } }),
  ]);
  m.menu = { ownerKey: "menu" };
  const ContextOwner = ({ header, children }: ShellGeneratedOwnerProps) => (
    <Context.Root onOpenChange={opened}>
      <Context.Trigger asChild>{header}</Context.Trigger>
      {children}
    </Context.Root>
  );
  const MenuOwner = ({ children }: { children: React.ReactElement }) => (
    <Dropdown.Item asChild>{children}</Dropdown.Item>
  );
  mount(
    <Dropdown.Root open>
      <Dropdown.Trigger>More</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content>
          <HouseSidebar model={m} effects={[]} />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>,
    {
      pathname: "/",
      menuControls: { menu: MenuOwner },
      generatedOwners: { context: ContextOwner },
    },
  );
  const control = getByRole(document.body, "menuitem", {
    name: "hidden destination",
  });
  act(() => {
    fireEvent.contextMenu(control, { clientX: 10, clientY: 10 });
  });
  expect(opened).toHaveBeenCalledWith(true);
});

for (const mode of ["house", "content-inline", "content-host"] as const)
  it(`composed ${mode} surface header is the actual trigger with its ref and events`, () => {
    const opened = vi.fn();
    const change = vi.fn();
    let trigger: HTMLElement | null = null;
    const Owner = ({ header, children }: ShellGeneratedOwnerProps) => (
      <Context.Root onOpenChange={opened}>
        <Context.Trigger
          asChild
          ref={(node) => {
            trigger = node;
          }}
        >
          {header}
        </Context.Trigger>
        {children}
      </Context.Root>
    );
    const e = item("opener", {
      composition: { ownerKey: "context" },
      effect: {
        kind: "open",
        surfaceId: "surface",
        open: { value: false, set: change },
        body: { owner: "custom", key: "surface", reason: "Retained body" },
        ...(mode !== "house"
          ? {
              surface: {
                owner: "content",
                kind: "dialog",
                ...(mode === "content-host" ? { mount: "host" as const } : {}),
              },
            }
          : {}),
      },
    });
    mount(<HouseSidebar model={nav([e])} effects={[]} />, {
      pathname: "/",
      generatedOwners: { context: Owner },
      slots: { surface: <div data-owned-body>Body</div> },
    });
    const button = getByRole(host, "button", { name: "opener" });
    expect(trigger).toBe(button);
    act(() => {
      fireEvent.contextMenu(button, { clientX: 10, clientY: 10 });
    });
    expect(opened).toHaveBeenCalledWith(true);
    act(() => {
      fireEvent.click(button);
    });
    expect(change).toHaveBeenCalledExactlyOnceWith(true);
    expect(host.querySelectorAll("[data-owned-body]")).toHaveLength(
      mode === "content-inline" ? 1 : 0,
    );
  });
it("retained context trigger continues to reach an inline rename editor", () => {
  const opened = vi.fn();
  const Owner = ({ header, children }: ShellGeneratedOwnerProps) => (
    <Context.Root onOpenChange={opened}>
      <Context.Trigger asChild>{header}</Context.Trigger>
      {children}
    </Context.Root>
  );
  const e = item("renaming", {
    composition: { ownerKey: "context" },
    rename: {
      binding: { value: "Name" },
      editing: { value: true, set: vi.fn() },
      controlLabel: "Rename row",
      trim: true,
      ignoreEmpty: true,
      ignoreUnchanged: true,
      commitOnBlur: false,
      cancelKey: "Escape",
      submitKey: "Enter",
      commitEffectId: "rename",
      autoFocus: false,
      blurBoundary: "control",
    },
  });
  mount(
    <HouseSidebar
      model={nav([e])}
      effects={[
        { id: "rename", kind: "action", actionName: "Rename", run: vi.fn() },
      ]}
    />,
    { pathname: "/", generatedOwners: { context: Owner } },
  );
  act(() => {
    fireEvent.contextMenu(getByRole(host, "textbox", { name: "Rename row" }), {
      clientX: 10,
      clientY: 10,
    });
  });
  expect(opened).toHaveBeenCalledWith(true);
});

for (const look of ["house", "reference"] as const)
  for (const kind of ["dropdown", "context"] as const)
    for (const expanded of [false, true])
      for (const annotation of [undefined, false, true])
        it(`${look} ${kind} submenu retains controller ARIA/ID linkage open=${expanded}, annotation=${annotation}`, () => {
          const Menu = kind === "dropdown" ? Dropdown : Context;
          const Trigger =
            kind === "dropdown"
              ? ShellDropdownSubTrigger
              : ShellContextSubTrigger;
          const m = nav([item("Linked submenu", { expanded: annotation })]);
          m.menu = { ownerKey: "submenu" };
          const Adapter = ({ children }: { children: React.ReactElement }) => (
            <Trigger>{children}</Trigger>
          );
          mount(
            <Menu.Root>
              <Menu.Trigger asChild>
                <button>Open linked menu</button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content>
                  <Menu.Sub open={expanded}>
                    <ShellHostProvider
                      value={{
                        pathname: "/",
                        menuControls: { submenu: Adapter },
                      }}
                    >
                      <>
                        {look === "house" ? (
                          <HouseSidebar model={m} effects={[]} />
                        ) : (
                          <Trigger>
                            <button>Linked submenu</button>
                          </Trigger>
                        )}
                      </>
                    </ShellHostProvider>
                    <Menu.SubContent>
                      <Menu.Item>Linked child</Menu.Item>
                    </Menu.SubContent>
                  </Menu.Sub>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>,
          );
          const opener = getByRole(host, "button", {
            name: "Open linked menu",
          });
          act(() => {
            if (kind === "dropdown")
              fireEvent.pointerDown(opener, { button: 0, ctrlKey: false });
            else fireEvent.contextMenu(opener, { clientX: 10, clientY: 10 });
          });
          const trigger = getByRole(document.body, "menuitem", {
            name: "Linked submenu",
          });
          expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
          expect(trigger.getAttribute("aria-expanded")).toBe(String(expanded));
          const menus = [...document.body.querySelectorAll('[role="menu"]')];
          expect(menus).toHaveLength(expanded ? 2 : 1);
          const submenu = menus.at(1);
          const labelledBy = submenu?.getAttribute("aria-labelledby") ?? null;
          expect(
            labelledBy === null ? null : document.getElementById(labelledBy),
          ).toBe(expanded ? trigger : null);
          const controlled = trigger.getAttribute("aria-controls");
          expect(
            controlled === null ? null : document.getElementById(controlled),
          ).toBe(submenu ?? null);
          const ids = [...document.querySelectorAll("[id]")].map((n) => n.id);
          expect(new Set(ids).size).toBe(ids.length);
        });
