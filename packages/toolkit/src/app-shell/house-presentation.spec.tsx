import { fireEvent, within } from "@testing-library/react";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { HousePresentationFixture } from "./house-presentation-fixtures.js";
import {
  captureShellSymbols,
  compareShellSnapshots,
  type ShellSemanticSnapshot,
} from "./shell-testing.js";
import {
  ModelSidebar,
  ShellHostProvider,
  type NavigationModel,
} from "./sidebar-shell.js";
function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Missing ${what}`);
  return value;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
function snapshots(
  results: Readonly<Record<string, string>> = {},
): ShellSemanticSnapshot[] {
  return Array.from(
    node.querySelectorAll<HTMLElement>(
      "button[data-rid],a[data-rid],input[data-rid]",
    ),
  ).map((el, order) => ({
    id: required(el.dataset.rid, "row identity"),
    part: "sidebar.item",
    containerId: "presentation",
    order,
    present: true,
    family:
      el.tagName === "INPUT" ? "text" : el.tagName === "A" ? "link" : "action",
    role:
      el.tagName === "INPUT"
        ? "searchbox"
        : el.tagName === "A"
          ? "link"
          : "button",
    expanded: null,
    name: el.getAttribute("aria-label") ?? el.textContent,
    value: el.tagName === "INPUT" ? (el as HTMLInputElement).value : null,
    choices: [],
    enabled: !el.hasAttribute("disabled"),
    selected: null,
    checked: null,
    shortcut: null,
    badge: null,
    effect: {
      kind: el.hasAttribute("href")
        ? "route"
        : el.dataset.shellAction
          ? "action"
          : "none",
      target: el.getAttribute("href") ?? el.dataset.shellAction ?? null,
      result: results[required(el.dataset.rid, "row identity")] ?? null,
    },
    read: { status: "ready", message: null, recovery: null },
    action: { pending: false, error: null, recovery: null },
    keyboard: { reachable: el.tabIndex >= 0, operable: el.tabIndex >= 0 },
    symbols: captureShellSymbols(
      el.tagName === "INPUT" ? (el.closest(".relative") ?? el) : el,
    ),
  }));
}
it("compares independently rendered names, values, symbols and order in both looks", async () => {
  const results: ShellSemanticSnapshot[][] = [];
  const drawn: (string | null)[] = [];
  for (const look of ["alternate", "house"] as const) {
    await act(async () =>
      root.render(<HousePresentationFixture key={look} look={look} />),
    );
    const ui = within(node);
    expect(node.querySelectorAll("[data-shell-symbol-fallback]")).toHaveLength(
      0,
    );
    expect(captureShellSymbols(node)).toHaveLength(10);
    expect(
      Array.from(
        node.querySelectorAll("[data-presentation-header] button"),
      ).map((e) => e.getAttribute("aria-label") ?? e.textContent),
    ).toEqual(["Example workspace", "Search", "Compose"]);
    await act(async () =>
      fireEvent.change(ui.getByRole("searchbox"), {
        target: { value: "display" },
      }),
    );
    await act(async () =>
      fireEvent.click(ui.getByRole("button", { name: "Help" })),
    );
    expect(ui.getByLabelText("Fixture actions").textContent).toBe("help");
    expect(
      node.querySelector("[data-presentation-header] fieldset"),
    ).toBeNull();
    expect(node.querySelector('[data-rid="footer"] fieldset')).toBeNull();
    const observed: Record<string, string> = {};
    for (const control of node.querySelectorAll<HTMLElement>(
      "button[data-rid],a[data-rid]",
    )) {
      const before = ui.getByLabelText("Fixture actions").textContent;
      await act(async () => fireEvent.click(control));
      const after = ui.getByLabelText("Fixture actions").textContent;
      observed[required(control.dataset.rid, "control identity")] = after
        .slice(before.length)
        .replace(/^,/, "");
    }
    expect(observed.inbox).toBe("inbox");
    results.push(snapshots(observed));
    drawn.push(
      node.querySelector("[data-look]")?.getAttribute("data-look") ?? null,
    );
  }
  expect(drawn).toEqual(["alternate", "house"]);
  expect(compareShellSnapshots(results[0], results[1]).differences).toEqual([]);
  const changed = results[1].map((row, index) =>
    index ? row : { ...row, symbols: [{ key: "search", fallback: true }] },
  );
  expect(compareShellSnapshots(results[0], changed).differences).toContain(
    '["search",null]: symbols',
  );
});
const base: NavigationModel = {
  entries: [
    {
      id: "symbol",
      part: "sidebar",
      subPart: "sidebar.item",
      containerId: "nav",
      order: 0,
      kind: "action",
      label: "Symbol",
      icon: { kind: "symbol", key: "unknown" },
    },
  ],
  sections: [],
  presentation: {
    collapsed: { value: false },
    mobileOpen: { value: false },
    peekOpen: false,
    profile: "fixture",
    themeFamily: "fixture",
    visibility: "visible",
    width: 244,
  },
};
it("retains the point for unknown and inherited keys and marks fallbacks only when opted in", async () => {
  for (const key of ["unknown", "toString", "__proto__"]) {
    const model = {
      ...base,
      entries: [{ ...base.entries[0], icon: { kind: "symbol" as const, key } }],
    };
    await act(async () =>
      root.render(
        <ShellHostProvider value={{ pathname: "/", symbols: {} }}>
          <ModelSidebar model={model} effects={[]} />
        </ShellHostProvider>,
      ),
    );
    expect(captureShellSymbols(node)).toEqual([{ key, fallback: true }]);
    expect(node.querySelector(".tabler-icon-point")).not.toBeNull();
  }
  await act(async () =>
    root.render(
      <ShellHostProvider value={{ pathname: "/" }}>
        <ModelSidebar model={base} effects={[]} />
      </ShellHostProvider>,
    ),
  );
  expect(node.querySelector("[data-shell-symbol-fallback]")).toBeNull();
  expect(node.querySelector(".tabler-icon-point")).not.toBeNull();
});
it("keeps an explicit icon control small, hides only its visual label, and preserves pending disablement", async () => {
  const model = {
    ...base,
    entries: [
      {
        ...base.entries[0],
        iconOnly: true,
        effect: { kind: "action" as const, effectId: "run" },
      },
    ],
  };
  await act(async () =>
    root.render(
      <ModelSidebar
        model={model}
        effects={[
          {
            id: "run",
            kind: "action",
            actionName: "run",
            pending: true,
            run: () => {},
          },
        ]}
      />,
    ),
  );
  const control = within(node).getByRole("button", { name: "Symbol" });
  expect(control.hasAttribute("disabled")).toBe(true);
  expect(control.className).toContain("w-7");
  expect(control.querySelector(".sr-only")?.textContent).toBe("Symbol");
});
it("detects point fallback while an unknown symbol image is loading or failed, then clears it on load", async () => {
  const model: NavigationModel = {
    ...base,
    entries: [
      {
        ...base.entries[0],
        icon: {
          kind: "symbol",
          key: "missing",
          image: { src: "/missing.png", alt: "" },
        },
      },
    ],
  };
  await act(async () =>
    root.render(
      <ShellHostProvider value={{ pathname: "/", symbols: {} }}>
        <ModelSidebar model={model} effects={[]} />
      </ShellHostProvider>,
    ),
  );
  expect(captureShellSymbols(node)).toEqual([
    { key: "missing", fallback: true },
  ]);
  await act(async () =>
    fireEvent.error(required(node.querySelector("img"), "image")),
  );
  expect(captureShellSymbols(node)).toEqual([
    { key: "missing", fallback: true },
  ]);
  await act(async () =>
    fireEvent.load(required(node.querySelector("img"), "image")),
  );
  expect(captureShellSymbols(node)).toEqual([
    { key: "missing", fallback: false },
  ]);
});
for (const look of ["alternate", "house"] as const)
  it(`${look} destination exposes a link and performs the observed navigation`, async () => {
    await act(async () =>
      root.render(<HousePresentationFixture look={look} />),
    );
    const link = within(node).getByRole("link", { name: "Inbox" });
    expect(link.getAttribute("href")).toBe("/inbox");
    await act(async () => fireEvent.click(link));
    expect(within(node).getByLabelText("Fixture actions").textContent).toBe(
      "inbox",
    );
  });
