// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import {
  runShellAction,
  useShellShortcuts,
  type ShellShortcutEvent,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";

import {
  button,
  click,
  dispose,
  init,
  mount,
  normalize,
} from "../../../testing/sidebar-shell/harness";
import { useWorkspaceJourneyModel } from "../../../testing/sidebar-shell/models/lifecycle";
import { publishedModel } from "../../../testing/sidebar-shell/models/owners";
import { AppShell } from "./AppShell";

afterEach(dispose);
let delegate: ReturnType<typeof useShellShortcuts>;
function Fixture({
  search,
  published = false,
}: {
  search: () => void;
  published?: boolean;
}) {
  const workspace = useWorkspaceJourneyModel({
    name: "shortcut-owner",
    props: { onOpenSearch: search },
  });
  const model = published ? publishedModel() : workspace;
  delegate = useShellShortcuts("workspace", model.shortcuts, (name) => {
    void runShellAction(model.effects, name);
  });
  return <AppShell model={model} />;
}
const context = {
  platform: "mac" as const,
  scope: "home",
  phase: "bubble" as const,
  focusKind: "page",
  overlayOpen: false,
  pausedOwners: [],
};
function compareSearchRegion(name: string) {
  const capture = JSON.parse(
    readFileSync(
      `app/testing/sidebar-shell/reference-fixtures/${name}.json`,
      "utf8",
    ),
  ) as { markup: string };
  const baseline = document.createElement("div");
  baseline.innerHTML = capture.markup;
  const markup = (root: ParentNode) =>
    normalize(root.querySelector(".ws-search-slot")?.outerHTML ?? "");
  expect(baseline.querySelector(".ws-search-slot")).not.toBeNull();
  expect(markup(document.body)).toBe(markup(baseline));
}

it("delegates both header and sidebar search to one owner and retires home shortcuts outside that frame", async () => {
  init({ width: 420 });
  const add = vi.spyOn(window, "addEventListener");
  const search = vi.fn();
  const mounted = await mount(<Fixture search={search} />);
  compareSearchRegion("shortcut-owner");
  expect(add.mock.calls.filter(([type]) => type === "keydown")).toEqual([]);
  const frozen = JSON.parse(
    readFileSync(
      "app/testing/sidebar-shell/reference-fixtures/shortcut-owner.json",
      "utf8",
    ),
  ) as { inputs: { effectsPerShortcut: number; collapseShortcut: string } };
  for (const [key, modifiers] of [
    ["k", { metaKey: true }],
    ["K", { ctrlKey: true }],
    ["/", {}],
  ] as const) {
    search.mockClear();
    const event = new KeyboardEvent("keydown", { key, ...modifiers });
    await act(async () => {
      expect(delegate(event, { ...context, phase: "capture" })).toBe(false);
      expect(delegate(event, context)).toBe(true);
      expect(delegate(event, context)).toBe(false);
    });
    expect(search).toHaveBeenCalledTimes(frozen.inputs.effectsPerShortcut);
  }
  search.mockClear();
  const mobile = document.querySelector(".ws-mobile-nav");
  const sidebar = document.querySelector(".ws-sidebar");
  if (!mobile || !sidebar) throw new Error("Missing search presentations");
  await click(button("Search", mobile));
  await click(button("Search", sidebar));
  expect(search).toHaveBeenCalledTimes(2);
  expect(frozen.inputs.collapseShortcut).toBe("absent");
  search.mockClear();
  for (const key of ["[", "\\"])
    expect(
      delegate(
        new KeyboardEvent("keydown", { key, metaKey: key === "\\" }),
        context,
      ),
    ).toBe(false);
  await mounted.update(<Fixture search={search} published />);
  expect(
    delegate(
      new KeyboardEvent("keydown", { key: "k", metaKey: true }),
      context,
    ),
  ).toBe(false);
  expect(search).not.toHaveBeenCalled();
  expect(document.querySelector(".ws-sidebar,.ws-mobile-nav")).toBeNull();
});

it("retains the frozen contenteditable, repeat and defaultPrevented policy on delegated events", async () => {
  init();
  const search = vi.fn();
  await mount(<Fixture search={search} />);
  compareSearchRegion("shortcut-existing-guards");
  const frozen = JSON.parse(
    readFileSync(
      "app/testing/sidebar-shell/reference-fixtures/shortcut-existing-guards.json",
      "utf8",
    ),
  ) as {
    inputs: {
      repeat: string;
      alreadyPrevented: string;
      contenteditable: string;
    };
  };
  expect(frozen.inputs).toMatchObject({
    repeat: "handled",
    alreadyPrevented: "handled",
    contenteditable: "ignored",
  });
  for (const focusKind of ["input", "textarea", "select", "contenteditable"])
    expect(
      delegate(new KeyboardEvent("keydown", { key: "k", metaKey: true }), {
        ...context,
        focusKind,
      }),
    ).toBe(false);
  const event: ShellShortcutEvent = {
    key: "k",
    code: "KeyK",
    metaKey: true,
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
    repeat: true,
    isComposing: true,
    defaultPrevented: true,
  };
  await act(async () => {
    expect(delegate(event, context)).toBe(true);
  });
  expect(search).toHaveBeenCalledTimes(1);
});
