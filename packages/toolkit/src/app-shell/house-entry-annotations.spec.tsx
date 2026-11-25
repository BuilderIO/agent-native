// @vitest-environment jsdom
import { fireEvent, getByRole, getRoles } from "@testing-library/react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  NavigationEntry,
  NavigationModel,
  ShellActionEffect,
} from "./contracts.js";
import { HouseSidebar } from "./house-frames.js";
vi.mock("../design-system/whole-parts.js", () => ({
  useWholePart: () => undefined,
}));
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
let root: Root;
let container: HTMLDivElement;
const entry = (kind: NavigationEntry["kind"]): NavigationEntry => ({
  id: "entry",
  part: "sidebar",
  subPart: "sidebar.item",
  containerId: "navigation",
  order: 0,
  kind,
  label: "Messages",
});
const model = (entries: readonly NavigationEntry[]): NavigationModel => ({
  entries,
  sections: [],
  presentation: {
    collapsed: { value: false },
    mobileOpen: { value: false },
    peekOpen: false,
    profile: "fixture",
    themeFamily: "house",
    visibility: "visible",
    width: 240,
  },
});
const mount = (item: NavigationEntry, compact = false) =>
  act(() =>
    root.render(
      <HouseSidebar
        model={{
          ...model([item]),
          presentation: {
            ...model([]).presentation,
            collapsed: { value: compact },
          },
        }}
        effects={[]}
      />,
    ),
  );
const named = (name: string) => {
  const role = Object.entries(getRoles(container)).find(([, elements]) =>
    elements.includes(row()),
  )?.[0];
  if (!role) throw new Error("Missing row role");
  return getByRole(container, role, { name });
};
function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Missing ${what}`);
  return value;
}
const row = () =>
  required(
    container.querySelector<HTMLElement>(
      '[data-rid="entry"]:is(button,a,input,select,h3,[role])',
    ),
    "entry row",
  );
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
describe("entry read annotations", () => {
  for (const kind of kinds) {
    for (const compact of [false, true]) {
      it(`${kind} draws pinned only when true, compact=${compact}`, () => {
        const item = {
          ...entry(kind),
          ...(kind === "filter" ? { binding: { value: "" } } : {}),
        };
        for (const pinned of [undefined, false, true, false]) {
          mount(
            { ...item, metadata: { pinned, secondaryText: "Yesterday" } },
            compact,
          );
          expect(
            container.querySelectorAll("[data-shell-pinned]"),
          ).toHaveLength(pinned ? 1 : 0);
          expect(
            container
              .querySelector("[data-shell-pinned]")
              ?.getAttribute("aria-hidden"),
          ).toBe(pinned ? "true" : undefined);
        }
      });
    }
    for (const explicit of [false, true]) {
      it(`${kind} names rendered label and badge unless explicit=${explicit}`, () => {
        const item = {
          ...entry(kind),
          ...(kind === "filter" ? { binding: { value: "" } } : {}),
          controlLabel: "Fallback",
          ...(explicit ? { accessibleLabel: "Explicit name" } : {}),
        };
        for (const badge of [
          undefined,
          { kind: "count" as const, visible: true, value: 9 },
          { kind: "text" as const, visible: true, text: "Set up" },
          { kind: "count" as const, visible: false, value: 9 },
          {
            kind: "count" as const,
            visible: true,
            value: 10,
            accessibleLabel: "Ten unread",
          },
        ]) {
          mount({ ...item, badge });
          const suffix = !badge?.visible
            ? ""
            : (badge.accessibleLabel ?? badge.text ?? String(badge.value));
          expect(
            named(
              explicit
                ? "Explicit name"
                : ["Messages", suffix].filter(Boolean).join(" "),
            ),
          ).toBe(row());
        }
      });
    }
  }
  for (const effect of [
    { kind: "navigate" as const, to: "/messages" },
    {
      kind: "external" as const,
      href: "https://example.com/messages",
      target: "_blank" as const,
    },
  ]) {
    it(`${effect.kind} link preserves the badge in its name`, () => {
      mount({
        ...entry("destination"),
        effect,
        badge: { kind: "count", visible: true, value: 9 },
      });
      expect(named("Messages 9")).toBe(row());
      mount({
        ...entry("destination"),
        effect,
        badge: { kind: "count", visible: true, value: 9 },
        accessibleLabel: "Explicit link",
      });
      expect(named("Explicit link")).toBe(row());
    });
  }
  it("choice input names the rendered label and badge", () => {
    mount({
      ...entry("choice"),
      binding: { value: "all" },
      choices: [{ value: "all", label: "All" }],
      badge: { kind: "count", visible: true, value: 9 },
    });
    expect(named("Messages 9")).toBe(row());
  });
  it("action expanded is read-only and creates no surface or writes", () => {
    const run = vi.fn();
    const write = vi.spyOn(Storage.prototype, "setItem");
    const effects: ShellActionEffect[] = [
      { id: "toggle", kind: "action", actionName: "toggle", run },
    ];
    for (const expanded of [undefined, false, true]) {
      const item = {
        ...entry("action"),
        expanded,
        effect: {
          kind: "action" as const,
          effectId: "toggle",
          input: "payload",
        },
      };
      act(() =>
        root.render(<HouseSidebar model={model([item])} effects={effects} />),
      );
      expect(row().getAttribute("aria-expanded")).toBe(
        expanded === undefined ? null : String(expanded),
      );
      expect(row().hasAttribute("aria-controls")).toBe(false);
      expect(row().hasAttribute("aria-haspopup")).toBe(false);
      expect(row().hasAttribute("aria-checked")).toBe(false);
      act(() => {
        row().focus();
        fireEvent.keyDown(row(), { key: "Escape" });
      });
      expect(row().getAttribute("aria-expanded")).toBe(
        expanded === undefined ? null : String(expanded),
      );
      expect(run).not.toHaveBeenCalled();
      act(() => {
        fireEvent.click(row());
      });
      expect(run).toHaveBeenCalledExactlyOnceWith("payload");
      run.mockClear();
      expect(
        container.querySelector(
          '[role="dialog"],[role="region"], [data-shell-surface]',
        ),
      ).toBeNull();
      expect(write).not.toHaveBeenCalled();
    }
  });
});
describe("inline rename keyboard ownership", () => {
  for (const kind of kinds) {
    for (const parent of ["section", "entry"] as const) {
      for (const headerOnly of [false, true]) {
        it(`${kind} rename owns Escape inside ${parent} disclosure${headerOnly ? " (header-only)" : ""}`, () => {
          const save = vi.fn();
          function Fixture() {
            const [open, setOpen] = useState(true);
            const [editing, setEditing] = useState(true);
            const [title, setTitle] = useState("Messages");
            const item: NavigationEntry = {
              ...entry(kind),
              ...(kind === "filter" ? { binding: { value: "" } } : {}),
              label: title,
              rename: {
                binding: { value: title, set: setTitle },
                editing: { value: editing, set: setEditing },
                controlLabel: "Rename item",
                trim: true,
                ignoreEmpty: true,
                ignoreUnchanged: true,
                commitOnBlur: true,
                cancelKey: "Escape",
                submitKey: "Enter",
                commitEffectId: "save",
                autoFocus: true,
                blurBoundary: "row",
              },
            };
            const disclosure = {
              binding: { value: open, set: setOpen },
              unmountWhenClosed: true,
              ...(headerOnly ? { dismissal: "header-only" as const } : {}),
            };
            const navigation =
              parent === "section"
                ? {
                    ...model([]),
                    sections: [
                      {
                        id: "parent",
                        part: "sidebar" as const,
                        subPart: "sidebar.section" as const,
                        containerId: "navigation",
                        order: 0,
                        label: "Parent",
                        hideIfEmpty: false,
                        disclosure,
                        entries: [item],
                      },
                    ],
                  }
                : model([
                    {
                      ...entry("disclosure"),
                      id: "parent",
                      label: "Parent",
                      disclosure,
                      children: [item],
                    },
                  ]);
            return (
              <HouseSidebar
                model={navigation}
                effects={[
                  { id: "save", kind: "action", actionName: "save", run: save },
                ]}
              />
            );
          }
          act(() => root.render(<Fixture />));
          const input = required(
            container.querySelector<HTMLInputElement>(
              'input[aria-label="Rename item"]',
            ),
            "rename input",
          );
          act(() => {
            fireEvent.change(input, { target: { value: "Changed" } });
            fireEvent.keyDown(input, { key: "Escape" });
          });
          expect(
            container.querySelector('input[aria-label="Rename item"]'),
          ).toBeNull();
          const trigger = required(
            container.querySelector<HTMLElement>("[aria-expanded]"),
            "disclosure trigger",
          );
          expect(trigger.getAttribute("aria-expanded")).toBe("true");
          expect(named("Messages")).toBe(row());
          expect(save).not.toHaveBeenCalled();
          act(() => {
            fireEvent.keyDown(trigger, { key: "Escape" });
          });
          expect(trigger.getAttribute("aria-expanded")).toBe(
            headerOnly ? "true" : "false",
          );
          act(() => {
            fireEvent.pointerDown(document.body, { button: 0 });
          });
          expect(trigger.getAttribute("aria-expanded")).toBe(
            headerOnly ? "true" : "false",
          );
          act(() => {
            fireEvent.click(trigger);
          });
          expect(trigger.getAttribute("aria-expanded")).toBe(
            headerOnly ? "false" : "true",
          );
        });
      }
    }
  }
});
