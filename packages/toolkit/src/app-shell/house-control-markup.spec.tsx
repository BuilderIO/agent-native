import { Slot } from "@radix-ui/react-slot";
// @vitest-environment happy-dom
import {
  act,
  cloneElement,
  type ReactNode,
  type ReactElement,
  type HTMLAttributes,
} from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { houseShellParts } from "../design-system/house-shell.js";
import { AGENT_NATIVE_PART_SET } from "../design-system/parts.js";
import { ToolkitProvider } from "../provider.js";
import type { NavigationEntry, ShellReadState } from "./contracts.js";
import {
  houseFixtureKinds,
  useHouseFixture,
  type HouseFixtureKind,
} from "./house-fixtures.js";
import { AppShell, HouseSidebar } from "./house-frames.js";
import {
  ShellHostProvider,
  ShellMenuControl,
  type ShellMenuControlProps,
} from "./house-shell-host.js";

const states = [
  "ready",
  "loading",
  "error",
  "reload",
  "pending",
  "retry",
  "hidden",
  "disabled",
  "gate-hidden",
  "gate-disabled",
  "rename",
  "open",
] as const;
type State = (typeof states)[number];
const presentations = ["expanded", "collapsed", "peek", "drawer"] as const;
function Fixture({
  kind,
  state,
  presentation,
}: {
  kind: HouseFixtureKind;
  state: State;
  presentation: (typeof presentations)[number];
}) {
  const source = useHouseFixture(kind);
  const read: ShellReadState =
    state === "loading"
      ? { status: "loading", label: "Loading row" }
      : state === "error" || state === "reload"
        ? {
            status: "error",
            message: "Unavailable",
            ...(state === "reload"
              ? { reloadEffectId: "reload", retryLabel: "Retry row" }
              : {}),
          }
        : { status: "ready" };
  const entry = (value: NavigationEntry): NavigationEntry => ({
    ...value,
    state: read,
    visible: state !== "hidden",
    disabled: state === "disabled",
    gate: state.startsWith("gate-")
      ? {
          key: "allowed",
          allowed: false,
          denied: state === "gate-hidden" ? "hidden" : "disabled",
        }
      : undefined,
    ...(value.rename
      ? { rename: { ...value.rename, editing: { value: state === "rename" } } }
      : {}),
    ...(value.effect?.kind === "open"
      ? { effect: { ...value.effect, open: { value: state === "open" } } }
      : {}),
    ...(value.children ? { children: value.children.map(entry) } : {}),
  });
  const model = {
    ...source.model,
    effects: source.model.effects.map((effect) => ({
      ...effect,
      pending: state === "pending",
      ...(state === "retry" ? { error: "Write failed", retry: () => {} } : {}),
    })),
    navigation: {
      ...source.model.navigation,
      entries: source.model.navigation.entries.map(entry),
      sections: source.model.navigation.sections.map((section) => ({
        ...section,
        entries: section.entries.map(entry),
      })),
      presentation: {
        ...source.model.navigation.presentation,
        collapsed: {
          value: presentation === "collapsed" || presentation === "peek",
        },
        peekOpen: presentation === "peek",
        mobileOpen: { value: presentation === "drawer" },
      },
    },
  };
  return (
    <ShellHostProvider value={source.host}>
      <AppShell model={model} />
    </ShellHostProvider>
  );
}
function RetainedTrigger({ children }: ShellMenuControlProps) {
  return cloneElement(
    children as ReactElement<HTMLAttributes<HTMLElement>>,
    {
      "aria-haspopup": "dialog",
      "aria-expanded": false,
      "data-state": "closed",
    } as HTMLAttributes<HTMLElement>,
  );
}
function MenuFixture() {
  const source = useHouseFixture("tracker");
  return (
    <ShellHostProvider
      value={{ ...source.host, menuControls: { retained: RetainedTrigger } }}
    >
      <HouseSidebar
        effects={source.model.effects}
        model={{
          ...source.model.navigation,
          resize: undefined,
          menu: { ownerKey: "retained" },
          sections: [],
          entries: source.model.navigation.entries.filter(
            (entry) =>
              ["destination", "action", "choice", "disclosure"].includes(
                entry.kind,
              ) &&
              !entry.rename &&
              !entry.search &&
              !entry.choices &&
              typeof entry.binding?.value !== "string",
          ),
        }}
      />
    </ShellHostProvider>
  );
}
const nativeShapes = ["bare", "class", "id", "aria"] as const;
function NativeSlot({ children }: ShellMenuControlProps) {
  return (
    <Slot
      className="retained-control"
      id="retained-control"
      role="option"
      aria-selected={false}
      aria-haspopup="dialog"
      aria-expanded={false}
      aria-controls="retained-panel"
      data-state="closed"
    >
      {children}
    </Slot>
  );
}
function NativeFixture({ shape }: { shape: (typeof nativeShapes)[number] }) {
  const entry: NavigationEntry = {
    id: "native-control",
    part: "sidebar",
    subPart: "sidebar.item",
    containerId: "navigation",
    order: 0,
    kind: "action",
    label: "Retained control",
    effect: { kind: "none" },
  };
  const leaf =
    shape === "class" ? (
      <div data-rid="native-control" className="generated-control">
        Row
      </div>
    ) : shape === "id" ? (
      <div data-rid="native-control" id="retained-control">
        Row
      </div>
    ) : shape === "aria" ? (
      <button
        data-rid="native-control"
        aria-haspopup="dialog"
        aria-expanded={false}
        aria-controls="retained-panel"
      >
        Row
      </button>
    ) : (
      <div data-rid="native-control">Row</div>
    );
  return (
    <ShellHostProvider
      value={{ pathname: "/", menuControls: { native: NativeSlot } }}
    >
      <ShellMenuControl entry={entry} ownerKey="native" disabled={false}>
        {leaf}
      </ShellMenuControl>
      <div id="retained-panel" hidden />
    </ShellHostProvider>
  );
}

function openingTags(container: Element) {
  const ids = new Map<string, string>();
  return [
    ...container.querySelectorAll(
      'button,a,input,select,textarea,option,[role="separator"],[role="button"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
    ),
  ].map((element) => {
    const tag = element.outerHTML.match(/^<(?:[^">]|"[^"]*")*>/)?.[0];
    if (!tag) throw new Error("Missing serialized control opening tag");
    return tag.replace(/«r[^»]+»|_r_[\w]+_|:r[0-9a-z]+:/g, (id) => {
      if (!ids.has(id)) ids.set(id, `react-id-${ids.size}`);
      const token = ids.get(id);
      if (token === undefined) throw new Error("Missing canonical ID");
      return token;
    });
  });
}
it("preserves generated control opening-tag bytes across the supported fixture matrix", async () => {
  const tags: string[] = [];
  const cases: Record<string, number[]> = {};
  const indexes = new Map<string, number>();
  const capture = async (
    name: string,
    node: ReactNode,
    look: string,
    theme: string,
  ) => {
    const drawerCount = name.includes("/drawer/")
      ? Number(name.split("/").at(-1))
      : 0;
    vi.stubGlobal("matchMedia", () => ({
      matches: drawerCount > 0,
      addEventListener() {},
      removeEventListener() {},
    }));
    const host = document.createElement("div");
    host.className = theme;
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          look === "house" ? (
            <ToolkitProvider
              designSystem={{
                parts: {
                  name: "house",
                  parts: AGENT_NATIVE_PART_SET.parts,
                  whole: houseShellParts,
                },
              }}
            >
              {node}
            </ToolkitProvider>
          ) : (
            <ToolkitProvider>{node}</ToolkitProvider>
          ),
        ),
      );
      expect(
        document.querySelectorAll('[role="dialog"][id$="-drawer"]'),
      ).toHaveLength(drawerCount);
      const captured = openingTags(document.body);
      cases[name] = captured.map((tag) => {
        let index = indexes.get(tag);
        if (index === undefined) {
          index = tags.length;
          tags.push(tag);
          indexes.set(tag, index);
        }
        return index;
      });
      return {
        nativeOptions: document.querySelectorAll(
          '[data-rid="native-control"][role="option"]',
        ),
        openingTags: captured,
      };
    } finally {
      await act(async () => root.unmount());
      host.remove();
      window.sessionStorage.clear();
      vi.unstubAllGlobals();
    }
  };
  for (const look of ["default", "house"])
    for (const theme of ["light", "dark"]) {
      for (const kind of houseFixtureKinds)
        for (const presentation of presentations)
          for (const state of states)
            for (const count of [1, 2]) {
              const name = [look, theme, kind, presentation, state, count].join(
                "/",
              );
              await capture(
                name,
                <>
                  {Array.from({ length: count }, (_, i) => (
                    <Fixture
                      key={i}
                      kind={kind}
                      state={state}
                      presentation={presentation}
                    />
                  ))}
                </>,
                look,
                theme,
              );
            }
      await capture(
        `${look}/${theme}/retained-trigger`,
        <MenuFixture />,
        look,
        theme,
      );
      for (const shape of nativeShapes) {
        const native = await capture(
          `${look}/${theme}/retained-native/${shape}`,
          <NativeFixture shape={shape} />,
          look,
          theme,
        );
        expect(native.nativeOptions).toHaveLength(1);
        expect(native.openingTags).toHaveLength(1);
      }
    }
  expect({ tags, cases }).toMatchSnapshot();
}, 600_000);
