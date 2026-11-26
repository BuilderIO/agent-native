// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NavigationEntry, ShellReadState } from "./contracts.js";
import {
  houseFixtureKinds,
  useHouseFixture,
  type HouseFixtureKind,
} from "./house-fixtures.js";
import { HouseAppShell } from "./house-frames.js";
import { ShellHostProvider } from "./house-shell-host.js";
import { runShellAction } from "./shell-policies.js";
vi.mock("../design-system/whole-parts.js", () => ({
  useWholePart: () => undefined,
}));
const surfaces = [
  "dialog",
  "popover",
  "menu",
  "disclosure",
  "section",
  "drawer",
  "peek",
] as const;
type Surface = (typeof surfaces)[number];
type OpenerState = "enabled" | "disabled" | "pending" | "removed";
const states = [
  "ready",
  "loading",
  "read-error",
  "reload-error",
  "pending",
  "effect-error",
  "hidden",
  "disabled",
  "gate-hidden",
  "gate-disabled",
] as const;
type State = (typeof states)[number];
const presentations = ["expanded", "collapsed", "peek", "drawer"] as const;
let change: (state: OpenerState) => void;
let finish: () => void;
let openSurface: () => void;
let getOpen: () => boolean;
const openers: (() => void)[] = [];
const closers: (() => void)[] = [];
let root: Root;
let container: HTMLDivElement;
let mobile = false;
function Fixture({
  kind,
  surface,
  state = "ready",
  presentation = "expanded",
  theme = "light",
  index = 0,
  nested = false,
}: {
  kind: HouseFixtureKind;
  surface: Surface;
  state?: State;
  presentation?: (typeof presentations)[number];
  theme?: string;
  index?: number;
  nested?: boolean;
}) {
  const source = useHouseFixture(kind);
  const [open, setOpen] = useState(false);
  const [openerState, setOpenerState] = useState<OpenerState>("enabled");
  if (index === 0) {
    getOpen = () => open;
    change = setOpenerState;
    finish = () => setOpen(false);
    openSurface = () => setOpen(true);
  }
  openers[index] = () => setOpen(true);
  closers[index] = () => setOpen(false);
  const read: ShellReadState =
    state === "loading"
      ? { status: "loading", label: "Loading surface" }
      : state === "read-error" || state === "reload-error"
        ? {
            status: "error",
            message: "Surface unavailable",
            ...(state === "reload-error" ? { reloadEffectId: "reload" } : {}),
          }
        : { status: "ready" };
  const pending = state === "pending" || openerState === "pending";
  const effects = source.model.effects.map((effect) =>
    effect.id === "choice"
      ? {
          ...effect,
          pending,
          ...(state === "effect-error"
            ? { error: "Surface update failed", retry: () => {} }
            : {}),
        }
      : effect.id === "mobile" || effect.id === "collapse"
        ? { ...effect, run: () => setOpen((value) => !value), pending }
        : effect,
  );
  effects.push({
    id: "surface-complete",
    kind: "action",
    actionName: "Complete surface",
    run: async () => {
      await Promise.resolve();
      setOpen(false);
    },
  });
  const help = source.model.navigation.entries.find(
    (entry) => entry.id === "help",
  );
  if (!help || help.effect?.kind !== "open")
    throw new Error("Missing fixture surface");
  const binding = { value: open, set: setOpen, changeEffectId: "choice" };
  const entry: NavigationEntry = {
    ...help,
    id: "surface",
    description: "Surface description",
    state: read,
    visible: state !== "hidden",
    disabled: state === "disabled" || openerState === "disabled",
    ...(state.startsWith("gate-")
      ? {
          gate: {
            key: "surface",
            allowed: false,
            denied:
              state === "gate-hidden"
                ? ("hidden" as const)
                : ("disabled" as const),
          },
        }
      : {}),
    effect:
      surface === "disclosure"
        ? undefined
        : { ...help.effect, surfaceId: surface, open: binding },
    ...(surface === "disclosure"
      ? { disclosure: { binding, unmountWhenClosed: true }, children: [] }
      : {}),
  };
  const navigation = {
    ...source.model.navigation,
    entries: [
      ...source.model.navigation.entries
        .filter((item) => item.id !== "help")
        .map((item) =>
          item.id === "collapse"
            ? { ...item, disabled: openerState === "disabled" }
            : item,
        ),
      ...(surface !== "section" && surface !== "drawer" && surface !== "peek"
        ? [entry]
        : []),
    ],
    sections:
      surface === "section"
        ? [
            {
              ...source.model.navigation.sections[0],
              id: "surface-section",
              label: "Surface section",
              state: read,
              visible: entry.visible,
              gate: entry.gate,
              disabled: openerState === "disabled",
              disclosure: { binding, unmountWhenClosed: true },
            },
          ]
        : [],
    presentation: {
      ...source.model.navigation.presentation,
      collapsed: {
        value: presentation === "collapsed" || surface === "peek",
        set: source.setCollapsed,
      },
      peekOpen: surface === "peek" ? open : presentation === "peek",
      mobileOpen:
        surface === "drawer"
          ? binding
          : nested || presentation === "drawer"
            ? { value: true, set: () => {} }
            : source.model.navigation.presentation.mobileOpen,
    },
  };
  const model = {
    ...source.model,
    effects,
    navigation,
    regions: source.model.regions.map((region) => ({
      ...region,
      ...(nested &&
      region.subPart === "app-shell.nav" &&
      openerState === "disabled"
        ? { disabled: true }
        : {}),
      ...(region.subPart === "app-shell.nav" &&
      (surface === "drawer" || surface === "peek")
        ? {
            state: read,
            visible: entry.visible,
            disabled: entry.disabled,
            gate: entry.gate,
          }
        : {}),
      actions: region.actions?.map((item) =>
        item.id === "open-navigation"
          ? { ...item, disabled: openerState === "disabled" }
          : item,
      ),
    })),
  };
  const host = {
    ...source.host,
    close: () => setOpen(false),
    slots: {
      ...source.host.slots,
      shortcuts: (
        <>
          <button onClick={() => setOpen(false)}>Close surface</button>
          <button
            onClick={() => {
              void runShellAction(effects, "surface-complete");
            }}
          >
            Complete surface
          </button>
        </>
      ),
    },
  };
  return (
    <div data-fixture={index} data-theme={theme}>
      <ShellHostProvider value={host}>
        <HouseAppShell model={model} />
      </ShellHostProvider>
      <button data-close onClick={() => setOpen(false)}>
        Close controlled surface
      </button>
      <button
        data-complete
        onClick={() => {
          void runShellAction(effects, "surface-complete");
        }}
      >
        Complete controlled surface
      </button>
    </div>
  );
}
const settle = async (milliseconds = 25) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};
const assertIds = () => {
  const ids = [...document.querySelectorAll("[id]")].map(
    (element) => element.id,
  );
  expect(new Set(ids).size).toBe(ids.length);
  for (const node of document.querySelectorAll(
    "[aria-controls],[aria-labelledby],[aria-describedby]",
  ))
    for (const attribute of [
      "aria-controls",
      "aria-labelledby",
      "aria-describedby",
    ])
      for (const id of (node.getAttribute(attribute) ?? "")
        .split(/\s+/)
        .filter(Boolean))
        expect(
          ids.filter((value) => value === id),
          `${attribute}=${id}`,
        ).toHaveLength(1);
};
const opener = (surface: Surface) => {
  const selector =
    surface === "drawer"
      ? '[data-rid="open-navigation"]'
      : surface === "peek"
        ? '[data-rid="collapse"]'
        : surface === "section"
          ? '[data-rid="surface-section"] button'
          : '[data-rid="surface"]';
  const node = [...document.querySelectorAll<HTMLElement>(selector)].at(-1);
  if (!node) throw new Error(`Missing opener: ${surface}`);
  return node;
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: mobile,
    addEventListener() {},
    removeEventListener() {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  await settle();
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mobile = false;
});
const kindSurfaces = houseFixtureKinds.flatMap((kind) =>
  surfaces.map((surface) => [kind, surface] as const),
);
describe("generated house surface invariants", () => {
  it.each(kindSurfaces)(
    "keeps IDs unique and ARIA references singular across states, presentations and themes: %s / %s",
    async (kind, surface) => {
      for (const state of states)
        for (const presentation of presentations)
          for (const theme of ["light", "dark"]) {
            mobile = surface === "drawer" || presentation === "drawer";
            for (const shellCount of [1, 2]) {
              act(() =>
                root.render(
                  <div
                    key={`${kind}-${surface}-${state}-${presentation}-${theme}-${shellCount}`}
                  >
                    {Array.from({ length: shellCount }, (_, index) => (
                      <Fixture
                        key={index}
                        {...{
                          kind,
                          surface,
                          state,
                          presentation,
                          theme,
                          index,
                        }}
                      />
                    ))}
                  </div>,
                ),
              );
              await settle(1);
              assertIds();
              act(() => {
                for (let index = 0; index < shellCount; index++)
                  openers[index]();
              });
              await settle(1);
              assertIds();
              act(() => {
                for (let index = 0; index < shellCount; index++)
                  closers[index]();
              });
              await settle(1);
              assertIds();
            }
          }
    },
    90_000,
  );
  it.each(kindSurfaces)(
    "returns focus for every dismissal path × opener state: %s / %s",
    async (kind, surface) => {
      for (const nested of surface === "drawer" ? [false] : [false, true])
        for (const path of [
          "escape",
          "outside",
          "close",
          "completion",
        ] as const)
          for (const state of [
            "enabled",
            "disabled",
            "pending",
            "removed",
          ] as const) {
            mobile = surface === "drawer" || nested;
            act(() =>
              root.render(
                <Fixture
                  key={`${kind}-${surface}-${path}-${state}-${nested}`}
                  {...{ kind, surface, nested }}
                />,
              ),
            );
            const trigger = opener(surface);
            act(() => {
              trigger.focus();
              trigger.click();
            });
            await settle();
            act(() => change(state));
            if (state === "removed") trigger.remove();
            if (state === "disabled" || state === "pending")
              act(() => {
                if (trigger.matches(":disabled")) trigger.blur();
              });
            const modalSurface = [
              "dialog",
              "popover",
              "menu",
              "drawer",
            ].includes(surface);
            const panel = modalSurface
              ? [
                  ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
                ].at(-1)
              : surface === "peek"
                ? document.querySelector<HTMLElement>("nav")
                : document.getElementById(
                    trigger.getAttribute("aria-controls") ?? "",
                  );
            if (!panel)
              throw new Error(
                `Missing panel: ${kind}/${surface}/${path}/${state}`,
              );
            if (path === "escape")
              act(() => {
                fireEvent.keyDown(document.activeElement ?? document.body, {
                  key: "Escape",
                });
              });
            if (path === "outside") {
              await vi.advanceTimersByTimeAsync(10);
              act(() => {
                fireEvent.pointerDown(document.body, {
                  button: 0,
                  pointerType: "mouse",
                });
                fireEvent.pointerUp(document.body, {
                  button: 0,
                  pointerType: "mouse",
                });
                fireEvent.click(document.body, { button: 0 });
              });
            }
            if (path === "close" || path === "completion") {
              const control = container.querySelector<HTMLElement>(
                path === "close" ? "[data-close]" : "[data-complete]",
              );
              const nativeClose =
                path === "close"
                  ? [
                      ...panel.querySelectorAll<HTMLButtonElement>("button"),
                    ].find((button) => button.textContent.trim() === "Close")
                  : null;
              await act(async () => (nativeClose ?? control)?.click());
            }
            await settle();
            expect(getOpen(), `${kind}/${surface}/${path}/${state} state`).toBe(
              false,
            );
            expect(
              document.querySelectorAll('[role="dialog"]').length,
              `${kind}/${surface}/${path}/${state}/${nested} dismissed`,
            ).toBe(nested ? 1 : 0);
            expect(
              document.activeElement,
              `${kind}/${surface}/${path}/${state}`,
            ).not.toBe(document.body);
            expect(document.activeElement === trigger).toBe(
              state === "enabled",
            );
            const expected =
              state === "enabled"
                ? trigger
                : surface === "drawer" ||
                    (surface === "peek" && state === "disabled" && !nested)
                  ? container.querySelector('[data-part="app-shell"]')
                  : nested && state === "disabled"
                    ? document.querySelector('[role="dialog"] > button')
                    : document.querySelector(
                        `[data-rid="${state === "removed" && surface !== "peek" ? "collapse" : "search"}"]:not(:has([data-rid]))`,
                      );
            expect(
              document.activeElement,
              `${kind}/${surface}/${path}/${state}/${nested} nearest landmark control`,
            ).toBe(expected);
            assertIds();
          }
    },
    30_000,
  );
});
