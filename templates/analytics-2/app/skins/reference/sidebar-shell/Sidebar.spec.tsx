// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import {
  captureShellSnapshot,
  compareShellSnapshots,
  shellTags,
  type ShellSemanticSnapshot,
} from "@agent-native/toolkit/app-shell/shell-testing";
import {
  runShellAction,
  useShellShortcuts,
  type ShellModel,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  button,
  click,
  dispose,
  init,
  input,
  key,
  mount,
  normalize,
  route,
  storageEvents,
} from "../../../testing/sidebar-shell/harness";
import { setupFixtures } from "../../../testing/sidebar-shell/models/setup";
import {
  useWorkspaceModel,
  workspaceFixtures,
  type WorkspaceFixture,
} from "../../../testing/sidebar-shell/models/workspace";
import { Sidebar } from "./Sidebar";

afterEach(dispose);
let model: ShellModel;
let delegateShortcuts: ReturnType<typeof useShellShortcuts>;
function Fixture({ fixture }: { fixture: WorkspaceFixture }) {
  model = useWorkspaceModel(fixture);
  delegateShortcuts = useShellShortcuts(
    "workspace",
    model.shortcuts,
    (actionName) => {
      void runShellAction(model.effects, actionName);
    },
  );
  return <Sidebar model={model.navigation} effects={model.effects} />;
}
function baseline(name: string) {
  const capture = JSON.parse(
    readFileSync(
      `app/testing/sidebar-shell/reference-fixtures/${name}.json`,
      "utf8",
    ),
  ) as { markup: string };
  const root = document.createElement("div");
  root.innerHTML = capture.markup;
  return root;
}
function markup(root: ParentNode, selector: string) {
  return normalize(
    [...root.querySelectorAll(selector)]
      .map((element) => element.outerHTML)
      .join(""),
  );
}
async function render(fixture: WorkspaceFixture) {
  init({
    ...(fixture.width === undefined ? {} : { width: fixture.width }),
    ...(fixture.dark === undefined ? {} : { dark: fixture.dark }),
    storage: fixture.theme ? { theme: fixture.theme } : {},
  });
  const mounted = await mount(
    <Fixture
      fixture={
        fixture.name.startsWith("route-")
          ? { ...fixture, path: "/home" }
          : fixture
      }
    />,
    fixture.path,
  );
  if (fixture.name.startsWith("route-"))
    await mounted.update(<Fixture fixture={fixture} />);
  return mounted;
}
const selectors = [
  ".ws-sidebar-header",
  ".ws-quick-create",
  ".ws-search-slot",
  ".ws-tabs",
  ".ws-tabs-scroll > a",
  ".ws-tabs-scroll > button",
  ".ws-sections",
  ".ws-footer",
  ".ws-popover",
];
describe("frozen workspace regions", () => {
  it.each(workspaceFixtures)(
    "matches $name header, menus and navigation regions",
    async (fixture) => {
      await render(fixture);
      const expected = baseline(fixture.name);
      for (const selector of selectors) {
        const expectedRoot =
          selector === ".ws-popover"
            ? expected
            : (expected.querySelector(".ws-sidebar") ?? expected);
        expect(
          markup(document.body, selector),
          `${fixture.name}: ${selector}`,
        ).toBe(markup(expectedRoot, selector));
      }
      expect(
        document.querySelector(".ws-sidebar")?.getAttribute("data-closed"),
      ).toBe(
        expected.querySelector(".ws-sidebar")?.getAttribute("data-closed"),
      );
    },
  );
});
it("keeps exact section-header markup including the existing inline chevron", async () => {
  await render({ name: "desktop-default" });
  expect(markup(document.body, ".ws-section-header")).toBe(
    markup(baseline("desktop-default"), ".ws-section-header"),
  );
});
function observeControls(root: ParentNode) {
  const surface = document.createElement("div");
  const sidebar = root.querySelector(".ws-sidebar");
  if (!sidebar) throw new Error("Missing sidebar observation root");
  surface.append(sidebar.cloneNode(true));
  for (const [index, element] of [
    ...surface.querySelectorAll("a,button,input"),
  ].entries()) {
    const id =
      element.getAttribute("href") ??
      element.getAttribute("aria-label") ??
      element.textContent?.trim() ??
      "";
    for (const [name, value] of Object.entries(
      shellTags(
        { id, entityKey: String(index) },
        "sidebar.item",
        "workspace-sidebar",
      ),
    ))
      element.setAttribute(name, value);
  }
  return captureShellSnapshot(surface, {
    visible: () => true,
    observe(identity, elements, order): ShellSemanticSnapshot {
      const control = elements[0];
      if (!control) throw new Error("Missing observed control");
      const href = control.getAttribute("href");
      const expanded = control.getAttribute("aria-expanded");
      return {
        ...identity,
        part: "sidebar.item",
        containerId: "workspace-sidebar",
        order,
        present: true,
        family: control.tagName.toLowerCase(),
        role: control.getAttribute("role"),
        expanded: expanded === null ? null : expanded === "true",
        name:
          control.getAttribute("aria-label") ??
          control.textContent?.trim() ??
          "",
        value: control instanceof HTMLInputElement ? control.value : null,
        choices: [],
        enabled: !control.hasAttribute("disabled"),
        selected: control.getAttribute("aria-current") === "page",
        checked: null,
        shortcut: control.querySelector(".ws-keycap")?.textContent ?? null,
        badge: null,
        effect: { kind: href ? "route" : "none", target: href, result: null },
        read: { status: "ready", message: null, recovery: null },
        action: { pending: false, error: null, recovery: null },
        keyboard: { reachable: true, operable: true },
      };
    },
  });
}
it("compares independently observed controls with the neutral semantic helper", async () => {
  await render({ name: "desktop-default" });
  expect(
    compareShellSnapshots(
      observeControls(baseline("desktop-default")),
      observeControls(document.body),
    ).differences,
  ).toEqual([]);
});
it("uses model effects once for quick create", async () => {
  const project = vi.fn(),
    thread = vi.fn(),
    upload = vi.fn(),
    search = vi.fn();
  await render({
    name: "desktop-default",
    props: {
      onCreateProject: project,
      onCreateThread: thread,
      onOpenSearch: search,
      quickCreate: { onImportProject: upload },
    },
  });
  await click(button("Project"));
  await click(button("Thread"));
  await click(button("Search"));
  await click(button("Create new"));
  await click(button("Upload project"));
  expect(project).toHaveBeenCalledTimes(1);
  expect(thread).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".ws-popover")).toBeNull();
  expect(
    storageEvents.filter((event) => event.operation === "setItem"),
  ).toEqual([]);
});
it("discloses sections from the shared binding without writing preferences", async () => {
  await render({ name: "desktop-default" });
  for (const label of [
    "RECENTS",
    "Favorite projects",
    "Favorite collections",
    "Favorite data",
  ])
    await click(button(label));
  expect(document.querySelectorAll(".ws-section-row")).toHaveLength(0);
  expect(markup(document.body, ".ws-section-list")).toBe(
    markup(baseline("sections-closed"), ".ws-section-list"),
  );
  await click(button("RECENTS"));
  expect(
    [...document.querySelectorAll(".ws-section-row")].map((item) =>
      item.getAttribute("href"),
    ),
  ).toEqual([
    "/project/project-a/latest",
    "/threads/thread-a",
    "/home/collections/collection-a",
    "/home/data/data-a",
  ]);
  expect(
    document.querySelectorAll(
      ".ws-section-row[aria-current],.ws-section-row.is-active",
    ),
  ).toHaveLength(0);
  expect(
    storageEvents.filter((event) => event.operation === "setItem"),
  ).toEqual([]);
});
it("retains workspace search, current selection and unbound disabled alternatives", async () => {
  await render({ name: "desktop-default" });
  await click(button("Test workspace"));
  expect(
    [...document.querySelectorAll<HTMLButtonElement>(".ws-workspace-row")].map(
      (row) => row.disabled,
    ),
  ).toEqual([false, true, true, true]);
  for (const label of [
    "Add a new workspace",
    "Log out of Test workspace",
    "Log out of all workspaces",
  ])
    expect(button(label).disabled).toBe(true);
  await input(document.querySelector("input") as HTMLInputElement, "missing");
  expect(document.querySelectorAll(".ws-workspace-row")).toHaveLength(0);
  await input(document.querySelector("input") as HTMLInputElement, " TEST ");
  expect(document.querySelectorAll(".ws-workspace-row")).toHaveLength(1);
  await click(document.querySelector(".ws-workspace-row") as HTMLElement);
  expect(document.querySelector(".ws-popover")).toBeNull();
});
it("preserves menu focus, Escape restoration and Tab dismissal", async () => {
  await render({ name: "desktop-default" });
  const trigger = button("More");
  await key(trigger, "ArrowDown");
  expect(document.activeElement?.textContent).toBe("Components");
  await key(document.activeElement as HTMLElement, "End");
  expect(document.activeElement?.textContent).toBe("Agent Dev Tools");
  await key(document.activeElement as HTMLElement, "ArrowDown");
  expect(document.activeElement?.textContent).toBe("Components");
  await key(document.activeElement as HTMLElement, "Escape");
  expect(document.activeElement).toBe(trigger);
  await click(trigger);
  await key(document.activeElement as HTMLElement, "Tab");
  expect(document.querySelector(".ws-popover")).toBeNull();
});
it("delegates theme persistence and preserves disabled Help and filter gaps", async () => {
  await render({ name: "desktop-default" });
  await click(button("Test Person account menu"));
  for (const label of [
    "Documentation",
    "Changelog",
    "Service status",
    "Email support",
    "Copy debug info...",
  ])
    expect(button(label).disabled).toBe(true);
  await click(button("Theme"));
  for (const label of ["Dark", "Light", "System (Light)"])
    await click(button(label));
  expect(
    storageEvents
      .filter((event) => event.operation === "setItem" && event.key === "theme")
      .map((event) => event.value),
  ).toEqual(["dark", "light", "system"]);
  await key(document.querySelector(".ws-popover") as HTMLElement, "Escape");
  await click(button("Notifications"));
  await click(button("All notifications"));
  const unread = button("Unread only");
  unread.focus();
  await key(unread, "ArrowDown");
  expect(document.activeElement).toBe(unread);
  await click(unread);
  expect(button("Mark all as read").disabled).toBe(true);
  expect(markup(document.body, ".ws-popover")).toBe(
    markup(baseline("notifications-unread"), ".ws-popover"),
  );
});
it("does not own a global keyboard listener, collapse, resize or reorder persistence", async () => {
  init();
  const listeners = vi.spyOn(window, "addEventListener");
  await mount(<Fixture fixture={{ name: "desktop-default" }} />);
  expect(listeners.mock.calls.filter(([name]) => name === "keydown")).toEqual(
    [],
  );
  expect(model.navigation.resize).toBeUndefined();
  expect(
    model.navigation.sections.every((section) => section.reorder === undefined),
  ).toBe(true);
  expect(model.navigation.presentation.collapsed.value).toBe(false);
  expect(model.preferences.map((preference) => preference.key)).toEqual([
    "theme",
  ]);
  expect(
    storageEvents.filter((event) => event.operation === "setItem"),
  ).toEqual([]);
});

it("leaves the setup card body in its named custom slot", async () => {
  await render({
    name: "setup-0",
    props: { contextSetup: { progressPercent: 0, completedSteps: [] } },
  });
  const slot = model.navigation.entries.find(
    (entry) => entry.id === "sidebar.context-setup",
  );
  expect(slot?.effect).toMatchObject({
    kind: "open",
    body: { owner: "custom", key: "context-setup" },
  });
  expect(document.querySelector(".ws-context-card")).toBeNull();
  expect(document.body.textContent).not.toContain("Connect");
});

it.each(setupFixtures)(
  "isolates the complete navigation difference to the custom card in $name",
  async (fixture) => {
    await render({
      name: fixture.name,
      closedSections: ["recents"],
      props: { contextSetup: fixture.state },
    });
    const expected = baseline(fixture.name);
    const card = expected.querySelector(".ws-context-card");
    if (!card) throw new Error("Missing frozen custom setup card");
    expect(markup(document.body, ".ws-sidebar")).not.toBe(
      markup(expected, ".ws-sidebar"),
    );
    expect(document.querySelector(".ws-context-card")).toBeNull();
    card.remove();
    expect(markup(document.body, ".ws-sidebar")).toBe(
      markup(expected, ".ws-sidebar"),
    );
  },
);

it("closes the narrow drawer through its supplied intent without storing a collapse value", async () => {
  await render({ name: "viewport-420-open", width: 420, drawerOpen: true });
  await click(button("Close navigation"));
  expect(
    document.querySelector(".ws-sidebar")?.getAttribute("data-closed"),
  ).toBe("true");
  expect(
    storageEvents.filter((event) => event.operation === "setItem"),
  ).toEqual([]);
});

it("navigates to All preferences and closes both workspace surfaces", async () => {
  await render({ name: "viewport-420-open", width: 420, drawerOpen: true });
  await click(button("Test workspace"));
  await click(button("Preferences"));
  const link = document.querySelector<HTMLAnchorElement>(
    'a[href="/settings/preferences"]',
  );
  if (!link) throw new Error("Missing preferences destination");
  await click(link);
  expect(route).toBe("/settings/preferences");
  expect(document.querySelector(".ws-popover")).toBeNull();
  expect(
    document.querySelector(".ws-sidebar")?.getAttribute("data-closed"),
  ).toBe("true");
});

it("delegates the existing shortcut guard and modifier behavior without adding a listener", async () => {
  const search = vi.fn();
  await render({ name: "desktop-default", props: { onOpenSearch: search } });
  const context = {
    platform: "mac" as const,
    scope: "home",
    phase: "bubble" as const,
    focusKind: "page",
    overlayOpen: false,
    pausedOwners: [],
  };
  for (const modifiers of [
    { metaKey: true },
    { ctrlKey: true },
    { metaKey: true, ctrlKey: true, shiftKey: true, altKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ...modifiers,
      repeat: true,
      isComposing: true,
      cancelable: true,
    });
    event.preventDefault();
    search.mockClear();
    await act(async () => {
      expect(delegateShortcuts(event, { ...context, phase: "capture" })).toBe(
        false,
      );
      expect(delegateShortcuts(event, context)).toBe(true);
      expect(delegateShortcuts(event, context)).toBe(false);
    });
    expect(search).toHaveBeenCalledTimes(1);
  }
  for (const shiftKey of [false, true]) {
    search.mockClear();
    await act(async () => {
      expect(
        delegateShortcuts(
          new KeyboardEvent("keydown", { key: "/", shiftKey }),
          context,
        ),
      ).toBe(true);
    });
    expect(search).toHaveBeenCalledTimes(1);
  }
  search.mockClear();
  for (const focusKind of ["input", "textarea", "select", "contenteditable"])
    expect(
      delegateShortcuts(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
        { ...context, focusKind },
      ),
    ).toBe(false);
  expect(
    delegateShortcuts(
      new KeyboardEvent("keydown", { key: "/", altKey: true }),
      context,
    ),
  ).toBe(false);
  expect(search).not.toHaveBeenCalled();
});

it("keeps the complete section-header structure exact", async () => {
  await render({ name: "desktop-default" });
  const reference = [
    ...baseline("desktop-default").querySelectorAll(".ws-section-header"),
  ];
  const actual = [...document.querySelectorAll(".ws-section-header")].map(
    (element) => element.cloneNode(true) as HTMLElement,
  );
  expect(actual).toHaveLength(reference.length);
  expect(actual.map((element) => element.outerHTML)).toEqual(
    reference.map((element) => element.outerHTML),
  );
});
