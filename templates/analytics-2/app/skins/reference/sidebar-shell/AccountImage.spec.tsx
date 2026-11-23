// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import {
  captureShellSnapshot,
  compareShellSnapshots,
  shellTags,
  type ShellSemanticSnapshot,
} from "@agent-native/toolkit/app-shell/shell-testing";
import type { ShellModel } from "@agent-native/toolkit/app-shell/sidebar-shell";
import { afterEach, expect, it } from "vitest";

import {
  button,
  dispose,
  envelope,
  init,
  key,
  mount,
  normalize,
} from "../../../testing/sidebar-shell/harness";
import { ScopedWorkspaceController } from "../../../testing/sidebar-shell/models/scoped-workspace";
import {
  workspaceFixtures,
  type WorkspaceFixture,
} from "../../../testing/sidebar-shell/models/workspace";
import { AppShell } from "./AppShell";

afterEach(dispose);
const imageFixture = workspaceFixtures.find(
  (fixture) => fixture.name === "account-identity-image",
);
if (!imageFixture) throw new Error("Missing account image fixture");
const fixture: WorkspaceFixture = imageFixture;
let model: ShellModel;
function Fixture({ value = fixture }: { value?: WorkspaceFixture }) {
  return (
    <ScopedWorkspaceController fixture={value}>
      {(current) => {
        model = current;
        return <AppShell model={current} />;
      }}
    </ScopedWorkspaceController>
  );
}
function baseline(surface = false) {
  const frozen = JSON.parse(
    readFileSync(
      `app/testing/sidebar-shell/reference-fixtures/account-identity-image${surface ? "-surface" : ""}.json`,
      "utf8",
    ),
  ) as { markup: string; root: ReturnType<typeof envelope> };
  const root = document.createElement("div");
  root.innerHTML = frozen.markup;
  return { root, frozen };
}
function markup(root: ParentNode, selector: string) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing image-state region: ${selector}`);
  return normalize(element.outerHTML);
}
function observeAccount(root: ParentNode) {
  const account = root.querySelector<HTMLButtonElement>(".ws-account-button");
  if (!account) throw new Error("Missing account control");
  const surface = document.createElement("div");
  const clone = account.cloneNode(true) as HTMLButtonElement;
  for (const [name, value] of Object.entries(
    shellTags({ id: "sidebar.account.open" }, "sidebar.item", "footer"),
  ))
    clone.setAttribute(name, value);
  surface.append(clone);
  return captureShellSnapshot(surface, {
    visible: () => true,
    observe(identity, elements, order): ShellSemanticSnapshot {
      const control = elements[0];
      if (!(control instanceof HTMLButtonElement))
        throw new Error("Missing observed account button");
      return {
        ...identity,
        part: "sidebar.item",
        containerId: "footer",
        order,
        present: true,
        family: "button",
        role: control.getAttribute("role"),
        expanded: control.hasAttribute("aria-expanded")
          ? control.getAttribute("aria-expanded") === "true"
          : null,
        name: control.getAttribute("aria-label") ?? "",
        images: [...control.querySelectorAll("img")].map((img) => ({
          alt: img.getAttribute("alt"),
        })),
        value: null,
        choices: [],
        enabled: !control.disabled,
        selected: null,
        checked: null,
        shortcut: null,
        badge: null,
        effect: {
          kind: "surface",
          target: control.getAttribute("aria-haspopup"),
          result: null,
        },
        read: { status: "ready", message: null, recovery: null },
        action: { pending: false, error: null, recovery: null },
        keyboard: {
          reachable: control.tabIndex !== -1,
          operable: !control.disabled,
        },
      };
    },
  });
}

it.each([false, true])(
  "matches the frozen account image, footer, full navigation and root envelope (surface=%s)",
  async (surface) => {
    init();
    await mount(<Fixture />);
    const expected = baseline(surface);
    for (const selector of [".ws-account-button", ".ws-footer", ".ws-sidebar"])
      expect(markup(document.body, selector), selector).toBe(
        markup(expected.root, selector),
      );
    expect(envelope()).toEqual(expected.frozen.root);
    expect(
      compareShellSnapshots(
        observeAccount(expected.root),
        observeAccount(document.body),
      ).differences,
    ).toEqual([]);
    const footer = model.navigation.entries.find(
      (entry) => entry.id === "sidebar.footer",
    );
    expect(
      footer?.children?.find((entry) => entry.id === "sidebar.account.open")
        ?.icon,
    ).toEqual({
      kind: "initial",
      text: "T",
      image: { src: "/fixture-avatar.svg", alt: "" },
    });
  },
);

it("observes decorative image removal and missing alt as exact semantic differences", async () => {
  init();
  await mount(<Fixture />);
  const expected = observeAccount(baseline().root);
  const img = document.querySelector(".ws-account-button img");
  if (!img) throw new Error("Missing account image");
  img.removeAttribute("alt");
  expect(
    compareShellSnapshots(expected, observeAccount(document.body)).differences,
  ).toEqual(['["sidebar.account.open",null]: images']);
  img.remove();
  expect(
    compareShellSnapshots(expected, observeAccount(document.body)).differences,
  ).toEqual(['["sidebar.account.open",null]: images']);
});

it("updates the supplied image source and restores the original initial avatar when removed", async () => {
  init();
  const mounted = await mount(<Fixture />);
  await mounted.update(
    <Fixture
      value={{
        ...fixture,
        props: {
          user: {
            id: "person-a",
            name: "Test Person",
            email: "person@example.test",
            avatarUrl: "/replacement-avatar.svg",
          },
        },
      }}
    />,
  );
  expect(document.querySelector(".ws-avatar img")?.getAttribute("src")).toBe(
    "/replacement-avatar.svg",
  );
  expect(document.querySelector(".ws-avatar img")?.getAttribute("alt")).toBe(
    "",
  );
  await mounted.update(<Fixture value={{ name: "desktop-default" }} />);
  expect(document.querySelector(".ws-avatar img")).toBeNull();
  expect(document.querySelector(".ws-avatar")?.outerHTML).toBe(
    '<span class="ws-avatar" aria-hidden="true">T</span>',
  );
});

it("preserves the image account opener's keyboard menu and focus return", async () => {
  init();
  await mount(<Fixture />);
  const opener = button("Test Person account menu");
  await key(opener, "ArrowDown");
  expect(
    document.querySelector('[role="menu"][aria-label="Account menu"]'),
  ).not.toBeNull();
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) throw new Error("Missing menu focus");
  await key(focused, "Escape");
  expect(document.querySelector(".ws-popover")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(document.querySelector(".ws-avatar img")?.getAttribute("alt")).toBe(
    "",
  );
});
