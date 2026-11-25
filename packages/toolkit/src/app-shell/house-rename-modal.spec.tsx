// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.js";
import type { NavigationEntry, NavigationModel } from "./contracts.js";
import { HouseAppShell, HouseSidebar } from "./house-frames.js";
function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Missing ${what}`);
  return value;
}
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
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("rename inside modal surfaces", () => {
  for (const kind of kinds)
    for (const surface of ["dialog", "drawer"] as const)
      for (const parent of ["section", "entry"] as const) {
        it(`${kind} consumes Escape before ${surface} dismissal inside ${parent}`, async () => {
          vi.stubGlobal("matchMedia", () => ({
            matches: surface === "drawer",
            addEventListener() {},
            removeEventListener() {},
          }));
          const save = vi.fn();
          let state = {
            open: false,
            section: true,
            editing: false,
            title: "Messages",
          };
          function Fixture() {
            const [open, setOpen] = useState(false),
              [section, setSection] = useState(true),
              [editing, setEditing] = useState(false),
              [title, setTitle] = useState("Messages");
            state = { open, section, editing, title };
            const identity = {
              part: "sidebar" as const,
              subPart: "sidebar.item" as const,
              containerId: "navigation",
              order: 0,
            };
            const item: NavigationEntry = {
              ...identity,
              id: "item",
              kind,
              label: title,
              ...(kind === "filter" ? { binding: { value: "" } } : {}),
              rename: {
                binding: { value: title, set: setTitle },
                editing: { value: editing, set: setEditing },
                controlLabel: "Edit title",
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
              trailingActions: [
                {
                  ...identity,
                  id: "begin",
                  kind: "action",
                  label: "Rename item",
                  effect: { kind: "action", effectId: "begin" },
                },
              ],
            };
            const disclosure = {
              binding: { value: section, set: setSection },
              unmountWhenClosed: true,
            };
            const navigation: NavigationModel = {
              entries:
                parent === "entry"
                  ? [
                      {
                        ...identity,
                        id: "parent",
                        kind: "disclosure",
                        label: "Parent",
                        disclosure,
                        children: [item],
                      },
                    ]
                  : [],
              sections:
                parent === "section"
                  ? [
                      {
                        ...identity,
                        subPart: "sidebar.section",
                        id: "parent",
                        label: "Parent",
                        hideIfEmpty: false,
                        disclosure,
                        entries: [item],
                      },
                    ]
                  : [],
              presentation: {
                collapsed: { value: false },
                mobileOpen: { value: open, set: setOpen },
                peekOpen: false,
                profile: "fixture",
                themeFamily: "house",
                visibility: "visible",
                width: 240,
              },
            };
            const effects = [
              {
                id: "begin",
                kind: "action" as const,
                actionName: "begin",
                run: () => setEditing(true),
              },
              {
                id: "save",
                kind: "action" as const,
                actionName: "save",
                run: save,
              },
            ];
            return (
              <>
                <button onClick={() => setOpen(true)}>Open editor</button>
                {surface === "dialog" ? (
                  <Dialog open={open} onOpenChange={setOpen}>
                    <DialogContent aria-describedby={undefined}>
                      <DialogTitle>Editor</DialogTitle>
                      <HouseSidebar model={navigation} effects={effects} />
                    </DialogContent>
                  </Dialog>
                ) : (
                  <HouseAppShell
                    model={{
                      frame: { key: "frame", routeRuleId: "fixture" },
                      navigation,
                      regions: [
                        {
                          id: "nav",
                          part: "app-shell",
                          subPart: "app-shell.nav",
                          containerId: "frame",
                          order: 0,
                          content: { owner: "kit", key: "navigation" },
                        },
                        {
                          id: "main",
                          part: "app-shell",
                          subPart: "app-shell.main",
                          containerId: "frame",
                          order: 1,
                          content: { owner: "kit", key: "main" },
                        },
                      ],
                      effects,
                      shortcuts: [],
                      preferences: [],
                    }}
                  />
                )}
              </>
            );
          }
          await act(async () => root.render(<Fixture />));
          await act(async () =>
            fireEvent.click(
              required(container.querySelector("button"), "row button"),
            ),
          );
          await act(async () =>
            fireEvent.click(
              required(
                document.querySelector('button[data-rid="begin"]'),
                "rename button",
              ),
            ),
          );
          const input = required(
            document.querySelector<HTMLInputElement>(
              'input[aria-label="Edit title"]',
            ),
            "title input",
          );
          expect(input).not.toBeNull();
          await act(async () => {
            fireEvent.change(input, { target: { value: "Changed" } });
            fireEvent.keyDown(input, { key: "Escape" });
          });
          expect(state).toEqual({
            open: true,
            section: true,
            editing: false,
            title: "Messages",
          });
          expect(
            document.querySelector('input[aria-label="Edit title"]'),
          ).toBeNull();
          expect(save).not.toHaveBeenCalled();
          expect(
            document.querySelectorAll('[role="dialog"][data-state="open"]'),
          ).toHaveLength(1);
          expect(document.activeElement).not.toBe(document.body);
          const trigger = required(
            document.querySelector<HTMLElement>('button[aria-expanded="true"]'),
            "expanded trigger",
          );
          await act(async () => {
            trigger.focus();
            fireEvent.keyDown(trigger, { key: "Escape" });
          });
          expect(state.open).toBe(true);
          expect(state.section).toBe(false);
          await act(async () =>
            fireEvent.keyDown(
              required(document.querySelector('[role="dialog"]'), "dialog"),
              {
                key: "Escape",
              },
            ),
          );
          expect(state.open).toBe(false);
        });
      }
});
