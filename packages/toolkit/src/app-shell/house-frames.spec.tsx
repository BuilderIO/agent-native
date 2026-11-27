import { fireEvent } from "@testing-library/react";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { houseShellParts } from "../design-system/house-shell.js";
import {
  AGENT_NATIVE_PART_SET,
  withDesignSystemParts,
} from "../design-system/parts.js";
import { ToolkitProvider } from "../provider.js";
import type {
  NavigationEntry,
  NavigationSection,
  ShellIdentity,
  ShellReadState,
  ShellRegion,
  ShellSubPart,
} from "./contracts.js";
import {
  houseFixtureKinds,
  useHouseFixture,
  type HouseFixture,
  type HouseFixtureKind,
} from "./house-fixtures.js";
import { AppShell, HouseAppShell } from "./house-frames.js";
import { ShellHostProvider } from "./house-shell-host.js";
import {
  captureShellSnapshot,
  compareShellSnapshots,
  type ShellSemanticSnapshot,
  type ShellSnapshotIdentity,
} from "./shell-testing.js";

const visible = (element: Element) =>
  !element.closest('[hidden],[inert],[aria-hidden="true"],[data-shell-slot]');
const key = (row: ShellSnapshotIdentity) =>
  JSON.stringify([row.id, row.entityKey ?? null]);
const baseline = (
  id: ShellSnapshotIdentity,
  part: ShellSubPart,
  containerId: string,
  order: number,
): ShellSemanticSnapshot => ({
  ...id,
  part,
  containerId,
  order,
  present: true,
  family: "structure",
  role: null,
  expanded: null,
  name: "",
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
  keyboard: { reachable: false, operable: false },
});
function observedRole(element: Element): string | null {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  if (element.matches("main")) return "main";
  if (element.matches("nav")) return "navigation";
  if (element.matches("aside")) return "complementary";
  if (element.matches("header")) return "banner";
  if (element.matches("section[aria-label]")) return "region";
  if (element.matches("h1,h2,h3,h4,h5,h6")) return "heading";
  return null;
}
function observeDOM(
  id: ShellSnapshotIdentity,
  elements: readonly Element[],
  order: number,
): ShellSemanticSnapshot {
  const row = elements[0];
  const data = baseline(
    id,
    row.getAttribute("data-part") as ShellSubPart,
    row.getAttribute("data-rid-container") ?? "",
    order,
  );
  data.name = row.getAttribute("aria-label") ?? "";
  data.enabled = row.getAttribute("aria-disabled") !== "true";
  const own = row.closest("[data-shell-entry]") ?? row;
  const isOwned = (candidate: Element) => {
    const owner = candidate.closest("[data-rid]");
    return (
      owner?.getAttribute("data-rid") === id.id &&
      owner.getAttribute("data-rid-key") === (id.entityKey ?? null)
    );
  };
  const control = [
    row,
    ...row.querySelectorAll('button,a,input,select,[role="separator"]'),
  ].find(
    (candidate) =>
      candidate.matches('button,a,input,select,[role="separator"]') &&
      isOwned(candidate) &&
      visible(candidate),
  );
  const semanticNode =
    control ??
    [
      row,
      ...row.querySelectorAll("main,nav,aside,header,section,[role],h1,h2,h3"),
    ].find(
      (candidate) =>
        isOwned(candidate) &&
        visible(candidate) &&
        observedRole(candidate) !== null,
    );
  data.role = semanticNode ? observedRole(semanticNode) : null;
  data.name =
    control?.getAttribute("aria-label") ??
    semanticNode?.getAttribute("aria-label") ??
    row.getAttribute("aria-label") ??
    "";
  const owned = (selector: string) =>
    [...own.querySelectorAll(selector)].filter(
      (candidate) =>
        isOwned(candidate) &&
        !candidate.closest("[hidden],[inert],[data-shell-slot]"),
    );
  if (control) {
    data.family =
      control.tagName === "A"
        ? "link"
        : control.tagName === "SELECT"
          ? "select"
          : control.tagName === "INPUT"
            ? "input"
            : control.getAttribute("role") === "separator"
              ? "separator"
              : "button";
    data.role =
      control.getAttribute("role") ??
      (data.family === "link"
        ? "link"
        : data.family === "input"
          ? control.getAttribute("type") === "search"
            ? "searchbox"
            : "textbox"
          : data.family === "select"
            ? "combobox"
            : "button");
    data.name ||= control.textContent;
    data.enabled = !control.matches(
      ':disabled,[disabled],[aria-disabled="true"]',
    );
    data.expanded = control.hasAttribute("aria-expanded")
      ? control.getAttribute("aria-expanded") === "true"
      : null;
    data.selected = control.hasAttribute("aria-current")
      ? control.getAttribute("aria-current") === "page"
      : null;
    data.checked = control.hasAttribute("aria-checked")
      ? control.getAttribute("aria-checked") === "true"
      : null;
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement
    )
      data.value = control.value;
    if (control.getAttribute("role") === "separator")
      data.value = Number(control.getAttribute("aria-valuenow"));
    if (control instanceof HTMLSelectElement)
      data.choices = [...control.options].map((option) => ({
        value: option.value,
        label: option.textContent,
        enabled: !option.disabled,
      }));
    data.keyboard = {
      reachable: data.enabled && (control as HTMLElement).tabIndex >= 0,
      operable: data.enabled && (control as HTMLElement).tabIndex >= 0,
    };
    const route = control.getAttribute("href");
    if (route)
      data.effect = {
        kind: control.hasAttribute("data-shell-external")
          ? "external"
          : "route",
        target: route,
        result: null,
      };
    else if (control.getAttribute("data-shell-action"))
      data.effect = {
        kind: "action",
        target: control.getAttribute("data-shell-action"),
        result: null,
      };
    else if (control.getAttribute("data-shell-write"))
      data.effect = {
        kind: "write",
        target: control.getAttribute("data-shell-write"),
        result: null,
      };
    else if (control.getAttribute("data-shell-surface"))
      data.effect = {
        kind: "surface",
        target: control.getAttribute("data-shell-surface"),
        result: null,
      };
  }
  data.shortcut = owned("kbd")[0]?.textContent ?? null;
  const badge = owned("[data-shell-badge]").at(0);
  if (badge) {
    const kind = badge.getAttribute("data-shell-badge") as
      | "count"
      | "dot"
      | "text";
    data.badge = {
      kind,
      value:
        kind === "dot"
          ? null
          : kind === "count"
            ? badge.textContent.trim() !== "" &&
              Number.isFinite(Number(badge.textContent))
              ? Number(badge.textContent)
              : badge.textContent
            : badge.textContent,
      accessibleLabel: badge.getAttribute("aria-label"),
    };
  }
  const busy = owned('[aria-busy="true"]').at(0);
  const alert = owned('[role="alert"]').find(
    (element) => !element.closest("[data-shell-effect]"),
  );
  if (busy)
    data.read = {
      status: "loading",
      message: busy.getAttribute("aria-label"),
      recovery: null,
    };
  else if (alert && !alert.closest("[data-shell-effect]"))
    data.read = {
      status: "error",
      message: alert.textContent,
      recovery:
        own.querySelector(`[data-rid="${id.id}.reload"]`)?.textContent ?? null,
    };
  const feedbackRoot =
    own === row && control === row ? (row.parentElement ?? row) : own;
  const feedback = [
    ...feedbackRoot.querySelectorAll("[data-shell-effect]"),
  ].find(
    (element) => element.getAttribute("data-shell-effect-for") === key(id),
  );
  if (feedback)
    data.action = {
      pending: Boolean(feedback.querySelector('[role="status"]')),
      error: feedback.querySelector('[role="alert"]')?.textContent ?? null,
      recovery: feedback.querySelector("button")?.textContent ?? null,
    };
  if (semanticNode?.matches("h1,h2,h3,h4,h5,h6")) {
    data.family = "heading";
    data.role = "heading";
  }
  if (!control && row.getAttribute("role") === "status") data.role = "status";
  return data;
}
function expectedModel(fixture: HouseFixture) {
  const result: ShellSemanticSnapshot[] = [];
  const model = fixture.model;
  const allowed = (item: {
    visible?: boolean;
    gate?: { allowed: boolean; denied: string };
  }) =>
    item.visible !== false &&
    !(item.gate?.allowed === false && item.gate.denied === "hidden");
  const blocked = (item: {
    disabled?: boolean;
    disabledReason?: string;
    gate?: { allowed: boolean; denied: string };
  }) =>
    Boolean(
      item.disabled ||
      item.disabledReason ||
      (item.gate?.allowed === false && item.gate.denied === "disabled"),
    );
  const effect = (id: string) => {
    const value = model.effects.find((item) => item.id === id);
    if (!value) throw new Error(id);
    return value;
  };
  const row = (item: ShellIdentity) =>
    baseline(
      {
        id: item.id,
        ...(item.entityKey === undefined ? {} : { entityKey: item.entityKey }),
      },
      item.subPart,
      item.containerId,
      result.length,
    );
  const auxiliary = (parent: ShellSemanticSnapshot, id: string) =>
    baseline(
      {
        id,
        ...(parent.entityKey === undefined
          ? {}
          : { entityKey: parent.entityKey }),
      },
      parent.part,
      parent.containerId,
      result.length,
    );
  const sorted = <T extends { order: number }>(items: readonly T[]) =>
    [...items].sort((a, b) => a.order - b.order);
  const flatten = (items: readonly NavigationEntry[]): NavigationEntry[] =>
    items.flatMap((item) => [
      item,
      ...flatten(item.children ?? []),
      ...flatten(item.trailingActions ?? []),
    ]);
  const destinations = (items: readonly NavigationEntry[]) =>
    flatten(items).flatMap((item) =>
      item.active?.kind === "longest-match" ? [item.active.destination] : [],
    );
  const navDestinations = destinations([
    ...model.navigation.entries,
    ...model.navigation.sections.flatMap((section) => section.entries),
  ]);
  const references = (item: NavigationEntry) => [
    ...new Set(
      [
        item.effect?.kind === "action" ? item.effect.effectId : undefined,
        item.effect?.kind === "open"
          ? item.effect.open.changeEffectId
          : undefined,
        item.binding?.changeEffectId,
        item.search?.binding.changeEffectId,
        item.disclosure?.binding.changeEffectId,
        item.rename?.commitEffectId,
      ].filter((id): id is string => id !== undefined),
    ),
  ];
  const feedback = (
    snapshot: ShellSemanticSnapshot,
    ids: readonly string[],
    disabled: boolean,
  ) => {
    const actions = ids.map(effect);
    const active = actions.find((action) => action.pending || action.error);
    if (active)
      snapshot.action = {
        pending: Boolean(active.pending),
        error: active.error ?? null,
        recovery: active.error && active.retry ? "Retry" : null,
      };
    for (const action of actions)
      if (action.error && action.retry) {
        const retry = auxiliary(snapshot, `${snapshot.id}.retry.${action.id}`);
        retry.family = "button";
        retry.role = "button";
        retry.name = "Retry";
        retry.enabled = !disabled && !action.pending;
        retry.keyboard = { reachable: retry.enabled, operable: retry.enabled };
        result.push(retry);
      }
  };
  const read = (
    snapshot: ShellSemanticSnapshot,
    state: ShellReadState | undefined,
    disabled: boolean,
  ) => {
    if (!state || state.status === "ready") return false;
    snapshot.read = {
      status: state.status,
      message: state.status === "loading" ? state.label : state.message,
      recovery:
        state.status === "error" && state.reloadEffectId
          ? (state.retryLabel ?? "Retry")
          : null,
    };
    if (state.status === "error" && state.reloadEffectId) {
      const reload = auxiliary(snapshot, `${snapshot.id}.reload`);
      reload.family = "button";
      reload.role = "button";
      reload.name = state.retryLabel ?? "Retry";
      reload.enabled = !disabled && !effect(state.reloadEffectId).pending;
      reload.keyboard = { reachable: reload.enabled, operable: reload.enabled };
      result.push(reload);
      feedback(reload, [state.reloadEffectId], disabled);
    }
    return true;
  };
  const decoration = (
    snapshot: ShellSemanticSnapshot,
    item: NavigationEntry,
  ) => {
    snapshot.shortcut = item.shortcut?.displayLabel ?? null;
    if (!item.badge?.visible) return;
    const display =
      item.badge.text ?? item.badge.maxText ?? item.badge.value ?? null;
    const value =
      item.badge.kind === "dot"
        ? null
        : item.badge.kind === "count" &&
            display !== null &&
            String(display).trim() !== "" &&
            Number.isFinite(Number(display))
          ? Number(display)
          : display;
    snapshot.badge = {
      kind: item.badge.kind,
      value,
      accessibleLabel: item.badge.accessibleLabel ?? null,
    };
  };
  const entry = (
    item: NavigationEntry,
    inherited = false,
    paths: readonly string[] = navDestinations,
  ) => {
    if (!allowed(item)) return;
    const snapshot = row(item);
    result.push(snapshot);
    // oracle-change: default names include the rendered badge; explicit labels win.
    const badgeText = !item.badge?.visible
      ? ""
      : (item.badge.accessibleLabel ??
        (item.badge.kind === "dot"
          ? ""
          : String(
              item.badge.text ?? item.badge.maxText ?? item.badge.value ?? "",
            )));
    snapshot.name =
      item.accessibleLabel ??
      [item.label ?? item.controlLabel ?? "", badgeText]
        .filter(Boolean)
        .join(" ");
    const disabled = inherited || blocked(item);
    snapshot.enabled = !disabled;
    const refs = [
      ...new Set([
        ...references(item),
        ...(item.subPart === "sidebar.resize-handle" && model.navigation.resize
          ? [model.navigation.resize.finishEffectId]
          : []),
      ]),
    ].filter(
      (id) =>
        item.state?.status !== "error" || item.state.reloadEffectId !== id,
    );
    if (read(snapshot, item.state, disabled)) {
      snapshot.role = "group";
      feedback(snapshot, refs, disabled);
      return;
    }
    const enabled = !disabled && !refs.some((id) => effect(id).pending);
    if (item.subPart === "sidebar.resize-handle" && model.navigation.resize) {
      const resize = model.navigation.resize;
      snapshot.family = "separator";
      snapshot.role = "separator";
      snapshot.value = resize.width.value;
      snapshot.enabled = enabled && !effect(resize.finishEffectId).pending;
      snapshot.keyboard = {
        reachable: snapshot.enabled,
        operable: snapshot.enabled,
      };
      feedback(snapshot, refs, disabled);
      return;
    }
    if (item.kind === "heading") {
      snapshot.family = "heading";
      snapshot.role = "heading";
      feedback(snapshot, refs, disabled);
      return;
    }
    if (item.kind === "controller") {
      snapshot.role = "note";
      feedback(snapshot, refs, disabled);
      return;
    }
    if (
      (item.kind === "identity" || item.kind === "status") &&
      (!item.effect || item.effect.kind === "none") &&
      !item.binding &&
      !item.disclosure
    ) {
      snapshot.role = item.kind === "status" ? "status" : "group";
      decoration(snapshot, item);
      feedback(snapshot, refs, disabled);
      return;
    }
    const editing = Boolean(item.rename?.editing.value);
    const text = Boolean(
      item.search ||
      item.kind === "filter" ||
      (typeof item.binding?.value === "string" && !item.choices) ||
      editing,
    );
    snapshot.family = text
      ? "input"
      : item.choices
        ? "select"
        : item.disclosure
          ? "button"
          : item.effect?.kind === "navigate" || item.effect?.kind === "external"
            ? "link"
            : "button";
    snapshot.role = text
      ? item.search || item.kind === "filter"
        ? "searchbox"
        : "textbox"
      : snapshot.family === "select"
        ? "combobox"
        : snapshot.family === "link"
          ? "link"
          : typeof item.binding?.value === "boolean"
            ? "checkbox"
            : "button";
    snapshot.enabled = enabled;
    snapshot.keyboard = { reachable: enabled, operable: enabled };
    if (typeof item.binding?.value === "string")
      snapshot.value = item.binding.value;
    if (item.search) snapshot.value = item.search.binding.value;
    if (editing && item.rename) {
      snapshot.name = item.rename.controlLabel;
      snapshot.value = item.rename.binding.value;
    }
    if (typeof item.binding?.value === "boolean")
      snapshot.checked = item.binding.value;
    if (item.choices)
      snapshot.choices = item.choices.map((choice) => ({
        value: choice.value,
        label: choice.label,
        enabled: !choice.disabled,
      }));
    if (item.disclosure) snapshot.expanded = item.disclosure.binding.value;
    if (snapshot.family === "link" && item.active) {
      const rule = item.active;
      const matches = (path: string) =>
        fixture.host.pathname === path ||
        fixture.host.pathname.startsWith(
          path.endsWith("/") ? path : `${path}/`,
        );
      const active =
        rule.kind === "exact"
          ? rule.paths.includes(fixture.host.pathname)
          : rule.kind === "resolved"
            ? rule.value
            : rule.kind === "prefix"
              ? matches(rule.path)
              : rule.kind === "longest-match"
                ? [rule.destination, ...paths]
                    .filter(matches)
                    .sort((a, b) => b.length - a.length)[0] === rule.destination
                : false;
      snapshot.selected = active ? true : null;
    }
    const write =
      item.search?.binding.changeEffectId ??
      item.disclosure?.binding.changeEffectId ??
      item.binding?.changeEffectId;
    if (!editing) {
      if (snapshot.family === "link" && item.effect?.kind === "navigate")
        snapshot.effect = {
          kind: "route",
          target: item.effect.to,
          result: null,
        };
      else if (snapshot.family === "link" && item.effect?.kind === "external")
        snapshot.effect = {
          kind: "external",
          target: item.effect.href,
          result: null,
        };
      else if (item.effect?.kind === "action")
        snapshot.effect = {
          kind: "action",
          target: effect(item.effect.effectId).actionName,
          result: null,
        };
      else if (write)
        snapshot.effect = {
          kind: "write",
          target: effect(write).actionName,
          result: null,
        };
      else if (item.effect?.kind === "open")
        snapshot.effect = {
          kind: "surface",
          target: item.effect.surfaceId,
          result: null,
        };
    }
    if (item.effect?.kind === "open" && !editing)
      snapshot.expanded = item.effect.open.value;
    decoration(snapshot, item);
    if (!item.disclosure || item.disclosure.binding.value)
      sorted(item.children ?? [])
        .filter(
          (child) =>
            item.search?.match !== "label-substring" ||
            (child.label ?? "")
              .toLocaleLowerCase()
              .includes(item.search.binding.value.toLocaleLowerCase()),
        )
        .forEach((child) => entry(child, disabled, paths));
    sorted(item.trailingActions ?? []).forEach((child) =>
      entry(child, disabled, paths),
    );
    feedback(snapshot, refs, disabled);
  };
  const section = (item: NavigationSection, inherited = false) => {
    const children = sorted(item.entries).filter(allowed).slice(0, item.limit);
    if (
      !allowed(item) ||
      (item.hideIfEmpty &&
        !children.length &&
        (!item.state || item.state.status === "ready"))
    )
      return;
    const snapshot = row(item);
    result.push(snapshot);
    snapshot.name = item.label ?? "";
    snapshot.role = item.label ? "region" : null;
    const disabled =
      inherited ||
      blocked(item) ||
      Boolean(
        item.disclosure?.binding.changeEffectId &&
        effect(item.disclosure.binding.changeEffectId).pending,
      );
    const ids = [
      ...new Set(
        [
          item.disclosure?.binding.changeEffectId,
          item.reorder?.commitEffectId,
        ].filter((id): id is string => id !== undefined),
      ),
    ];
    if (item.disclosure) {
      snapshot.family = "button";
      snapshot.role = "button";
      snapshot.expanded = item.disclosure.binding.value;
      snapshot.enabled = !disabled;
      snapshot.keyboard = { reachable: !disabled, operable: !disabled };
    }
    feedback(snapshot, ids, disabled);
    if (item.disclosure && !item.disclosure.binding.value) return;
    if (read(snapshot, item.state, disabled)) return;
    for (const child of children) {
      entry(child, disabled);
      if (item.reorder) {
        const handle = auxiliary(snapshot, `${item.id}.reorder`);
        handle.entityKey = child.entityKey ?? child.id;
        handle.family = "button";
        handle.role = "button";
        handle.name = `Reorder ${child.accessibleLabel ?? child.controlLabel ?? child.label}`;
        handle.enabled =
          !disabled &&
          !(
            item.reorder.policy.disableWhileEffectPending &&
            effect(item.reorder.commitEffectId).pending
          );
        handle.keyboard = {
          reachable: handle.enabled,
          operable: handle.enabled,
        };
        result.push(handle);
      }
    }
  };
  const region = (item: ShellRegion) => {
    if (!allowed(item)) return;
    const snapshot = row(item);
    result.push(snapshot);
    snapshot.name =
      item.subPart === "app-shell.nav"
        ? (item.title ?? fixture.host.labels?.navigation ?? "")
        : (item.title ?? "");
    snapshot.role =
      item.subPart === "app-shell.nav"
        ? "navigation"
        : item.subPart === "app-shell.main"
          ? "main"
          : item.subPart === "app-shell.aside"
            ? "complementary"
            : item.subPart === "app-shell.topbar"
              ? "banner"
              : item.title
                ? "region"
                : null;
    snapshot.enabled = !blocked(item);
    if (read(snapshot, item.state, blocked(item))) {
      if (item.subPart === "app-shell.nav") {
        snapshot.name =
          item.title ??
          (item.state?.status === "loading" ? item.state.label : "");
        snapshot.role = item.title
          ? "region"
          : item.state?.status === "loading"
            ? "status"
            : "alert";
      }
      return;
    }
    sorted(item.actions ?? []).forEach((child) =>
      entry(child, blocked(item), destinations(item.actions ?? [])),
    );
    if (item.subPart === "app-shell.nav") {
      if (model.navigation.presentation.visibility !== "visible") {
        snapshot.role = null;
        snapshot.name = item.title ?? "";
        return;
      }
      sorted([
        ...model.navigation.entries,
        ...model.navigation.sections,
      ]).forEach((child) =>
        "entries" in child
          ? section(child, blocked(item))
          : entry(child, blocked(item)),
      );
    }
  };
  const regions = sorted(model.regions);
  regions.filter((item) => item.subPart === "app-shell.nav").forEach(region);
  regions
    .filter((item) =>
      ["app-shell.topbar", "app-shell.banner"].includes(item.subPart),
    )
    .forEach(region);
  regions
    .filter(
      (item) =>
        ![
          "app-shell.nav",
          "app-shell.topbar",
          "app-shell.banner",
          "app-shell.overlays",
        ].includes(item.subPart),
    )
    .forEach(region);
  regions
    .filter((item) => item.subPart === "app-shell.overlays")
    .forEach(region);
  return result;
}

describe("house frames", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fixture: HouseFixture;
  const render = (
    kind: HouseFixtureKind = "tracker",
    transform?: (fixture: HouseFixture) => HouseFixture,
  ) => {
    function Fixture() {
      const value = useHouseFixture(kind);
      fixture = transform ? transform(value) : value;
      return (
        <ShellHostProvider value={fixture.host}>
          <AppShell model={fixture.model} />
        </ShellHostProvider>
      );
    }
    act(() => root.render(<Fixture />));
  };
  const get = (id: string) => {
    const node = container.querySelector<HTMLElement>(`[data-rid="${id}"]`);
    if (!node) throw new Error(`Missing ${id}`);
    const nested = [
      ...node.querySelectorAll<HTMLElement>(`[data-rid="${id}"]`),
    ].filter(
      (candidate) =>
        candidate.getAttribute("data-rid-key") ===
        node.getAttribute("data-rid-key"),
    );
    return nested.at(-1) ?? node;
  };
  const click = async (id: string) => {
    await act(async () => get(id).click());
  };
  const press = async (node: HTMLElement, key: string, shiftKey = false) => {
    await act(async () =>
      node.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  };
  beforeEach(() => {
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  it.each(houseFixtureKinds)(
    "captures every visible %s row against its independent model projection",
    (kind) => {
      render(kind);
      const actual = captureShellSnapshot(container, {
        visible,
        observe: observeDOM,
      });
      const expected = expectedModel(fixture);
      expect(actual.length).toBeGreaterThan(35);
      expect(compareShellSnapshots(expected, actual).differences).toEqual([]);
      expect(actual.map(key)).toEqual(expected.map(key));
    },
  );
  it("delegates collapse and peek, with one guarded shortcut owner", async () => {
    vi.useFakeTimers();
    render();
    await click("collapse");
    expect(fixture.model.navigation.presentation.collapsed.value).toBe(true);
    expect(container.querySelector('[data-collapsed="true"]')).not.toBeNull();
    act(() => fixture.peek.enter());
    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(fixture.model.navigation.presentation.peekOpen).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fixture.model.navigation.presentation.peekOpen).toBe(true);
    const event = {
      key: "\\",
      code: "Backslash",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
    };
    act(() => {
      expect(
        fixture.shortcuts(event, {
          platform: "mac",
          scope: "shell",
          phase: "bubble",
          focusKind: "page",
          overlayOpen: false,
          pausedOwners: [],
        }),
      ).toBe(true);
    });
    expect(fixture.model.navigation.presentation.collapsed.value).toBe(false);
  });
  it("resizes by arrows, Shift, Home and End with separator values", async () => {
    render();
    const handle = get("resize");
    handle.focus();
    expect(document.activeElement).toBe(handle);
    await press(handle, "ArrowRight");
    expect(handle.getAttribute("aria-valuenow")).toBe("252");
    await press(handle, "ArrowRight", true);
    expect(handle.getAttribute("aria-valuenow")).toBe("268");
    await press(handle, "End");
    expect(handle.getAttribute("aria-valuenow")).toBe("360");
    await press(handle, "Home");
    expect(handle.getAttribute("aria-valuenow")).toBe("200");
    expect(
      fixture.log
        .filter((item) => item.action === "resize")
        .map((item) => item.input),
    ).toEqual([252, 268, 360, 200]);
  });
  it("reorders with Space/arrows/Space and restores on Escape", async () => {
    render();
    const handle = get("favorites.reorder");
    await press(handle, " ");
    await press(handle, "ArrowDown");
    expect(
      fixture.model.navigation.sections
        .find((item) => item.id === "favorites")
        ?.entries.map((item) => item.entityKey),
    ).toEqual(["research", "plan", "release"]);
    await press(handle, " ");
    expect(
      fixture.log.find((item) => item.action === "reorder")?.input,
    ).toEqual(["research", "plan", "release"]);
    const first = get("favorites.reorder");
    await press(first, " ");
    await press(first, "ArrowDown");
    await press(first, "Escape");
    expect(
      fixture.model.navigation.sections
        .find((item) => item.id === "favorites")
        ?.entries.map((item) => item.entityKey),
    ).toEqual(["research", "plan", "release"]);
  });
  it("renames through Enter, Escape, and row-boundary blur", async () => {
    render("notes");
    await click("rename");
    const input = get("rename-title") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    await act(async () => {
      fireEvent.change(input, { target: { value: "  Edited notes  " } });
    });
    await press(input, "Enter");
    expect(fixture.log.some((item) => item.action === "rename")).toBe(true);
    await click("rename");
    await press(get("rename-title"), "Escape");
    expect(get("rename-title").tagName).toBe("BUTTON");
  });
  it("discloses teams with the keyboard and exposes a unique panel relation", async () => {
    render();
    const section = get("teams");
    const button = section.querySelector("button");
    expect(button).not.toBeNull();
    const control = button as HTMLButtonElement;
    expect(control.getAttribute("aria-expanded")).toBe("true");
    await act(async () => control.click());
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-rid="team-design"]')).toBeNull();
    await act(async () => control.click());
    expect(container.querySelector('[data-rid="team-design"]')).not.toBeNull();
  });
  it("keeps effect pending/error/retry separate from read loading/error/reload", async () => {
    render();
    expect((get("sync") as HTMLButtonElement).disabled).toBe(true);
    expect(get("publish").closest("[data-shell-entry]")?.textContent).toContain(
      "The update was not saved",
    );
    await click("publish.retry.publish");
    expect(container.textContent).not.toContain("The update was not saved");
    expect(get("loading").querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(get("folders").textContent).toContain("Folders could not be loaded");
    await click("folders.reload");
    expect(get("folders").textContent).toContain("Ideas");
    expect(fixture.log.some((item) => item.action === "reload")).toBe(true);
  });
  it("applies choice values, ordered choices, checked state, and label search", async () => {
    render();
    const select = get("scope") as HTMLSelectElement;
    expect(
      [...select.options].map((option) => [
        option.textContent,
        option.disabled,
      ]),
    ).toEqual([
      ["All items", false],
      ["Assigned to me", false],
      ["Archived", true],
    ]);
    await act(async () => {
      select.value = "mine";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.value).toBe("mine");
    await click("unread");
    expect(get("unread").getAttribute("aria-checked")).toBe("false");
    expect(
      fixture.log.some(
        (item) => item.action === "choice" && item.input === "mine",
      ),
    ).toBe(true);
  });
  it("mounts two shells without duplicate generated ids or panel relationships", () => {
    function Pair() {
      const a = useHouseFixture("tracker");
      const b = useHouseFixture("notes");
      return (
        <>
          <ShellHostProvider value={a.host}>
            <HouseAppShell model={a.model} />
          </ShellHostProvider>
          <ShellHostProvider value={b.host}>
            <HouseAppShell model={b.model} />
          </ShellHostProvider>
        </>
      );
    }
    act(() => root.render(<Pair />));
    const ids = [...container.querySelectorAll("[id]")].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const control of container.querySelectorAll("[aria-controls]"))
      expect(
        container.querySelectorAll(
          `[id="${control.getAttribute("aria-controls")}"]`,
        ),
      ).toHaveLength(1);
  });
  it("selects registered parts and preserves the house fallback", () => {
    let calls = 0;
    render();
    act(() =>
      root.render(
        <ToolkitProvider
          designSystem={{
            parts: {
              name: "registered",
              parts: AGENT_NATIVE_PART_SET.parts,
              whole: {
                ...houseShellParts,
                "app-shell": () => {
                  calls++;
                  return <p>Registered frame</p>;
                },
              },
            },
          }}
        >
          <AppShell model={fixture.model} />
        </ToolkitProvider>,
      ),
    );
    expect(calls).toBe(1);
    expect(container.textContent).toBe("Registered frame");
  });
  it("draws a frame registered under its earlier name", () => {
    render();
    act(() =>
      root.render(
        <ToolkitProvider
          designSystem={withDesignSystemParts("earlier", {
            AppShell: () => <p>Earlier frame</p>,
          })}
        >
          <AppShell model={fixture.model} />
        </ToolkitProvider>,
      ),
    );
    expect(container.textContent).toBe("Earlier frame");
  });
  it("commits rename on leaving the row and keeps internal focus changes in the draft", async () => {
    render("notes");
    await click("rename");
    const input = get("rename-title") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Renamed by blur" } });
    });
    await act(async () => {
      fireEvent.blur(input, { relatedTarget: get("rename") });
    });
    expect(fixture.log.filter((item) => item.action === "rename")).toHaveLength(
      0,
    );
    await act(async () => {
      fireEvent.blur(input, { relatedTarget: get("inbox") });
    });
    expect(fixture.log.find((item) => item.action === "rename")?.input).toBe(
      "Renamed by blur",
    );
    expect(get("rename-title").textContent).toContain("Renamed by blur");
  });
  it("filters resolved choices by the controlled search binding", async () => {
    render();
    await act(async () => {
      fireEvent.change(get("search"), { target: { value: "Research" } });
    });
    expect(container.querySelector('[data-rid="search-plan"]')).toBeNull();
    expect(get("search-research").textContent).toBe("Research");
    expect(fixture.log.find((item) => item.action === "search")?.input).toBe(
      "Research",
    );
    await act(async () => {
      fireEvent.change(get("search"), { target: { value: "unmatched" } });
    });
    expect(container.textContent).toContain("No matches");
  });
  it.each(["search", "choice", "checked"])(
    "takes %s pending and error from the binding effect",
    async (effectId) => {
      render("tracker", (value) => ({
        ...value,
        model: {
          ...value.model,
          effects: value.model.effects.map((effect) =>
            effect.id === effectId
              ? {
                  ...effect,
                  pending: true,
                  error: "Binding failed",
                  retry: () => {},
                }
              : effect,
          ),
        },
      }));
      const id =
        effectId === "choice"
          ? "scope"
          : effectId === "checked"
            ? "unread"
            : "search";
      expect((get(id) as HTMLButtonElement).disabled).toBe(true);
      expect(get(id).closest("[data-shell-entry]")?.textContent).toContain(
        "Binding failed",
      );
      expect(
        (get(`${id}.retry.${effectId}`) as HTMLButtonElement).disabled,
      ).toBe(true);
    },
  );
  it("disables nested links with their section and region", async () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          sections: value.model.navigation.sections.map((section) =>
            section.id === "teams" ? { ...section, disabled: true } : section,
          ),
        },
        regions: value.model.regions.map((region) =>
          region.id === "topbar" ? { ...region, disabled: true } : region,
        ),
      },
    }));
    expect(get("team-design").getAttribute("aria-disabled")).toBe("true");
    expect(get("team-design").tabIndex).toBe(-1);
    await click("team-design");
    expect(fixture.log.some((item) => item.action === "navigate")).toBe(false);
    expect((get("open-navigation") as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps pointer-only resize and reorder accessible through the registered house choices", async () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          resize: value.model.navigation.resize
            ? {
                ...value.model.navigation.resize,
                policy: {
                  ...value.model.navigation.resize.policy,
                  keyboard: false,
                },
              }
            : undefined,
          sections: value.model.navigation.sections.map((section) =>
            section.reorder
              ? {
                  ...section,
                  reorder: {
                    ...section.reorder,
                    policy: { ...section.reorder.policy, keyboard: false },
                  },
                }
              : section,
          ),
        },
      },
    }));
    await press(get("resize"), "End");
    expect(get("resize").getAttribute("aria-valuenow")).toBe("360");
    await press(get("favorites.reorder"), " ");
    await press(get("favorites.reorder"), "ArrowDown");
    await press(get("favorites.reorder"), " ");
    expect(fixture.log.some((item) => item.action === "reorder")).toBe(true);
  });
  it("renders region loading and errors, and dispatches recovery from its effect", async () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        regions: value.model.regions.map((region) =>
          region.id === "main"
            ? {
                ...region,
                state: {
                  status: "error",
                  message: "Page unavailable",
                  reloadEffectId: "reload",
                  retryLabel: "Reload page",
                },
              }
            : region.id === "skeleton"
              ? { ...region, visible: true }
              : region,
        ),
      },
    }));
    expect(get("main").textContent).toContain("Page unavailable");
    expect(
      get("skeleton").querySelector('[aria-label="Loading workspace"]'),
    ).not.toBeNull();
    await click("main.reload");
    expect(fixture.log.some((item) => item.action === "reload")).toBe(true);
  });
  it("detects changed names, missing rows, wrong choices and wrong checked state", () => {
    render();
    const expected = expectedModel(fixture);
    get("inbox").setAttribute("aria-label", "Wrong name");
    get("unread").setAttribute("aria-checked", "false");
    get("scope").querySelector("option")?.setAttribute("disabled", "");
    get("activity").closest("[data-shell-entry]")?.remove();
    const differences = compareShellSnapshots(
      expected,
      captureShellSnapshot(container, { visible, observe: observeDOM }),
    ).differences;
    expect(differences).toContain('["inbox",null]: name');
    expect(differences).toContain('["unread",null]: checked');
    expect(differences).toContain('["scope",null]: choices');
    expect(differences).toContain('["activity",null]: missing in house');
  });
  it("omits hidden resize entries and replaces loading resize controls", () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          entries: value.model.navigation.entries.map((entry) =>
            entry.id === "resize" ? { ...entry, visible: false } : entry,
          ),
        },
      },
    }));
    expect(container.querySelector('[data-rid="resize"]')).toBeNull();
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          entries: value.model.navigation.entries.map((entry) =>
            entry.id === "resize"
              ? {
                  ...entry,
                  state: { status: "loading", label: "Loading size" },
                }
              : entry,
          ),
        },
      },
    }));
    expect(get("resize").querySelector('[role="separator"]')).toBeNull();
    expect(get("resize").getAttribute("role")).not.toBe("separator");
    expect(get("resize").textContent).not.toContain("Resize navigation");
  });
  it("blocks disabled resize reset and keyboard writes", async () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          entries: value.model.navigation.entries.map((entry) =>
            entry.id === "resize" ? { ...entry, disabled: true } : entry,
          ),
        },
      },
    }));
    await act(async () => fireEvent.doubleClick(get("resize")));
    await press(get("resize"), "End");
    expect(fixture.log.filter((item) => item.action === "resize")).toHaveLength(
      0,
    );
  });
  it("disables the complete navigation region including destinations", async () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        regions: value.model.regions.map((region) =>
          region.id === "frame-nav" ? { ...region, disabled: true } : region,
        ),
      },
    }));
    expect(get("inbox").getAttribute("aria-disabled")).toBe("true");
    await click("inbox");
    expect(fixture.log.some((item) => item.action === "navigate")).toBe(false);
  });
  it.each(["blur", "explicit"] as const)(
    "commits boolean and section disclosure bindings on %s",
    async (commit) => {
      render("tracker", (value) => ({
        ...value,
        model: {
          ...value.model,
          navigation: {
            ...value.model.navigation,
            entries: value.model.navigation.entries.map((entry) =>
              entry.id === "unread" && entry.binding
                ? { ...entry, binding: { ...entry.binding, commit } }
                : entry,
            ),
            sections: value.model.navigation.sections.map((section) =>
              section.id === "teams" && section.disclosure
                ? {
                    ...section,
                    disclosure: {
                      ...section.disclosure,
                      binding: {
                        ...section.disclosure.binding,
                        changeEffectId: "choice",
                        commit,
                      },
                    },
                  }
                : section,
            ),
          },
        },
      }));
      await click("unread");
      if (commit === "blur")
        await act(async () => fireEvent.blur(get("unread")));
      expect(
        fixture.log.some(
          (item) => item.action === "checked" && item.input === false,
        ),
      ).toBe(true);
      const button = get("teams").querySelector("button") as HTMLButtonElement;
      await act(async () => button.click());
      if (commit === "blur") await act(async () => fireEvent.blur(button));
      expect(
        fixture.log.some(
          (item) => item.action === "choice" && item.input === false,
        ),
      ).toBe(true);
    },
  );
  it("gives concurrent read and action failures distinct recovery rows", () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          entries: value.model.navigation.entries.map((entry) =>
            entry.id === "publish"
              ? {
                  ...entry,
                  state: {
                    status: "error",
                    message: "Read failed",
                    reloadEffectId: "reload",
                  },
                }
              : entry,
          ),
        },
        effects: value.model.effects.map((effect) =>
          effect.id === "reload"
            ? { ...effect, error: "Reload failed", retry: () => {} }
            : effect,
        ),
      },
    }));
    expect(() =>
      captureShellSnapshot(container, { visible, observe: observeDOM }),
    ).not.toThrow();
    expect(
      [
        ...(get("publish")
          .closest("[data-shell-entry]")
          ?.querySelectorAll("button") ?? []),
      ].filter((button) => button.textContent === "Retry"),
    ).toHaveLength(3);
  });
  it("renders pending and recovery for an open-surface binding effect", () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          entries: value.model.navigation.entries.map((entry) =>
            entry.id === "help" && entry.effect?.kind === "open"
              ? {
                  ...entry,
                  effect: {
                    ...entry.effect,
                    open: { ...entry.effect.open, changeEffectId: "publish" },
                  },
                }
              : entry,
          ),
        },
      },
    }));
    expect(get("help").closest("[data-shell-entry]")?.textContent).toContain(
      "The update was not saved",
    );
  });
  it("honors reorder pending policy when it permits a preview", async () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          sections: value.model.navigation.sections.map((section) =>
            section.reorder
              ? {
                  ...section,
                  reorder: {
                    ...section.reorder,
                    policy: {
                      ...section.reorder.policy,
                      disableWhileEffectPending: false,
                    },
                  },
                }
              : section,
          ),
        },
        effects: value.model.effects.map((effect) =>
          effect.id === "reorder" ? { ...effect, pending: true } : effect,
        ),
      },
    }));
    const handle = get("favorites.reorder") as HTMLButtonElement;
    expect(handle.disabled).toBe(false);
    await press(handle, " ");
    await press(handle, "ArrowDown");
    expect(
      fixture.model.navigation.sections.find(
        (section) => section.id === "favorites",
      )?.entries[0].entityKey,
    ).toBe("research");
  });
  it("restores row focus after cancelling an inline rename", async () => {
    render("notes");
    await click("rename");
    expect(document.activeElement).toBe(get("rename-title"));
    await press(get("rename-title"), "Escape");
    expect(document.activeElement).toBe(get("rename-title"));
  });
  it("locks recovery inside a disabled entry", async () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        navigation: {
          ...value.model.navigation,
          entries: value.model.navigation.entries.map((entry) =>
            entry.id === "publish"
              ? {
                  ...entry,
                  disabled: true,
                  state: {
                    status: "error",
                    message: "Read failed",
                    reloadEffectId: "reload",
                  },
                }
              : entry,
          ),
        },
      },
    }));
    expect((get("publish.reload") as HTMLButtonElement).disabled).toBe(true);
    expect((get("publish.retry.publish") as HTMLButtonElement).disabled).toBe(
      true,
    );
    await click("publish.reload");
    await click("publish.retry.publish");
    expect(fixture.log).toHaveLength(0);
  });
  it.each(["blur", "explicit"] as const)(
    "commits an open binding on %s",
    async (commit) => {
      render("tracker", (value) => ({
        ...value,
        model: {
          ...value.model,
          navigation: {
            ...value.model.navigation,
            entries: value.model.navigation.entries.map((entry) =>
              entry.id === "help" && entry.effect?.kind === "open"
                ? {
                    ...entry,
                    effect: {
                      ...entry.effect,
                      open: {
                        ...entry.effect.open,
                        changeEffectId: "choice",
                        commit,
                      },
                    },
                  }
                : entry,
            ),
          },
        },
      }));
      await click("help");
      if (commit === "blur") await act(async () => fireEvent.blur(get("help")));
      expect(
        fixture.log.some(
          (item) => item.action === "choice" && item.input === true,
        ),
      ).toBe(true);
    },
  );
  it("commits the mobile open binding when the sheet closes", async () => {
    const original = window.matchMedia;
    window.matchMedia = () =>
      ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList;
    try {
      render("notes", (value) => ({
        ...value,
        model: {
          ...value.model,
          navigation: {
            ...value.model.navigation,
            presentation: {
              ...value.model.navigation.presentation,
              mobileOpen: {
                ...value.model.navigation.presentation.mobileOpen,
                value: true,
                changeEffectId: "choice",
              },
            },
          },
        },
      }));
      const close = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button',
        ),
      ].find((button) => button.textContent === "Close");
      expect(close).toBeDefined();
      await act(async () => close?.click());
      expect(
        fixture.log.some(
          (item) => item.action === "choice" && item.input === false,
        ),
      ).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
  it("commits rename when focus leaves a trailing row action", async () => {
    render("notes");
    await click("rename");
    await act(async () =>
      fireEvent.change(get("rename-title"), {
        target: { value: "A row draft" },
      }),
    );
    await act(async () =>
      fireEvent.blur(get("rename-title"), { relatedTarget: get("rename") }),
    );
    expect(fixture.log.filter((item) => item.action === "rename")).toHaveLength(
      0,
    );
    await act(async () =>
      fireEvent.blur(get("rename"), { relatedTarget: get("inbox") }),
    );
    expect(fixture.log.find((item) => item.action === "rename")?.input).toBe(
      "A row draft",
    );
  });
  it.each(["text", "prefix", "external", "editing"] as const)(
    "compares valid %s state independently",
    (state) => {
      render("tracker", (value) => ({
        ...value,
        model: {
          ...value.model,
          navigation: {
            ...value.model.navigation,
            entries: value.model.navigation.entries.map((entry) =>
              state === "editing" && entry.id === "rename-title" && entry.rename
                ? {
                    ...entry,
                    rename: {
                      ...entry.rename,
                      editing: { ...entry.rename.editing, value: true },
                    },
                  }
                : entry.id !== "inbox"
                  ? entry
                  : state === "text"
                    ? {
                        ...entry,
                        kind: "choice",
                        effect: undefined,
                        binding: { value: "Draft", set: () => {} },
                      }
                    : state === "prefix"
                      ? {
                          ...entry,
                          active: {
                            kind: "prefix",
                            path: "/inbox",
                            boundary: "segment",
                          },
                        }
                      : state === "external"
                        ? {
                            ...entry,
                            effect: {
                              kind: "external",
                              href: "https://example.test/guide",
                              target: "_blank",
                            },
                          }
                        : entry,
            ),
          },
        },
      }));
      const actual = captureShellSnapshot(container, {
        visible,
        observe: observeDOM,
      });
      expect(
        compareShellSnapshots(expectedModel(fixture), actual).differences,
      ).toEqual([]);
    },
  );
  it("rejects a missing main landmark even if its contents and tags survive", () => {
    render();
    const main = get("main");
    const div = document.createElement("div");
    for (const attribute of main.attributes)
      div.setAttribute(attribute.name, attribute.value);
    while (main.firstChild) div.append(main.firstChild);
    main.replaceWith(div);
    expect(
      compareShellSnapshots(
        expectedModel(fixture),
        captureShellSnapshot(container, { visible, observe: observeDOM }),
      ).differences,
    ).toContain('["main",null]: role');
  });
  it("bounds named page content outside the shell comparison surface", () => {
    render("tracker", (value) => ({
      ...value,
      host: {
        ...value.host,
        slots: {
          ...value.host.slots,
          page: (
            <div>
              <button type="button">Page filter</button>
              <button type="button">Page create</button>
            </div>
          ),
        },
      },
    }));
    expect(
      container.querySelectorAll('[data-shell-slot="page"] button'),
    ).toHaveLength(2);
    expect(
      compareShellSnapshots(
        expectedModel(fixture),
        captureShellSnapshot(container, { visible, observe: observeDOM }),
      ).differences,
    ).toEqual([]);
  });
  it("inherits navigation disabling at the resize separator", async () => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        regions: value.model.regions.map((region) =>
          region.id === "frame-nav" ? { ...region, disabled: true } : region,
        ),
      },
    }));
    expect(get("resize").getAttribute("aria-disabled")).toBe("true");
    expect(get("resize").tabIndex).toBe(-1);
    await press(get("resize"), "End");
    expect(fixture.log.some((item) => item.action === "resize")).toBe(false);
  });
  it("renders resize entries inside a section through the same controller", async () => {
    render("tracker", (value) => {
      const resize = value.model.navigation.entries.find(
        (entry) => entry.id === "resize",
      );
      if (!resize) throw new Error("No resize entry");
      return {
        ...value,
        model: {
          ...value.model,
          navigation: {
            ...value.model.navigation,
            entries: value.model.navigation.entries.filter(
              (entry) => entry.id !== "resize",
            ),
            sections: value.model.navigation.sections.map((section) =>
              section.id === "empty"
                ? { ...section, entries: [{ ...resize, containerId: "empty" }] }
                : section,
            ),
          },
        },
      };
    });
    expect(get("resize").getAttribute("role")).toBe("separator");
    await press(get("resize"), "End");
    expect(fixture.log.find((item) => item.action === "resize")?.input).toBe(
      360,
    );
  });
  it.each(["open-error", "section-disabled", "longest", "badge-cap"] as const)(
    "projects %s from the model rather than renderer metadata",
    (variant) => {
      render("tracker", (value) => ({
        ...value,
        host: {
          ...value.host,
          pathname:
            variant === "longest" ? "/inbox/detail" : value.host.pathname,
        },
        model: {
          ...value.model,
          navigation: {
            ...value.model.navigation,
            entries: value.model.navigation.entries.map((entry) =>
              variant === "open-error" &&
              entry.id === "help" &&
              entry.effect?.kind === "open"
                ? {
                    ...entry,
                    effect: {
                      ...entry.effect,
                      open: { ...entry.effect.open, changeEffectId: "publish" },
                    },
                  }
                : variant === "longest" &&
                    ["inbox", "activity"].includes(entry.id)
                  ? {
                      ...entry,
                      active: {
                        kind: "longest-match",
                        destination:
                          entry.id === "inbox" ? "/inbox" : "/inbox/detail",
                      },
                    }
                  : variant === "badge-cap" && entry.id === "inbox"
                    ? {
                        ...entry,
                        badge: {
                          kind: "count",
                          value: 123,
                          text: "99+",
                          visible: true,
                          accessibleLabel: "123 unread",
                        },
                      }
                    : entry,
            ),
            sections: value.model.navigation.sections.map((section) =>
              variant === "section-disabled" && section.id === "teams"
                ? { ...section, disabled: true }
                : section,
            ),
          },
        },
      }));
      expect(
        compareShellSnapshots(
          expectedModel(fixture),
          captureShellSnapshot(container, { visible, observe: observeDOM }),
        ).differences,
      ).toEqual([]);
    },
  );
  it("detects visible count corruption independently of renderer attributes", () => {
    render();
    const expected = expectedModel(fixture);
    const badge = get("inbox").querySelector("[data-shell-badge]");
    if (!badge) throw new Error("No count badge");
    badge.textContent = "999 unread";
    expect(
      compareShellSnapshots(
        expected,
        captureShellSnapshot(container, { visible, observe: observeDOM }),
      ).differences,
    ).toContain('["inbox",null]: badge');
  });
  it("keeps resize action recovery beside a read failure", async () => {
    const retry = vi.fn();
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        effects: value.model.effects.map((effect) =>
          effect.id === "resize"
            ? { ...effect, error: "Width was not saved", retry }
            : effect,
        ),
        navigation: {
          ...value.model.navigation,
          entries: value.model.navigation.entries.map((entry) =>
            entry.id === "resize"
              ? {
                  ...entry,
                  state: {
                    status: "error" as const,
                    message: "Width unavailable",
                  },
                }
              : entry,
          ),
        },
      },
    }));
    expect(get("resize").textContent).toContain("Width unavailable");
    expect(container.textContent).toContain("Width was not saved");
    await click("resize.retry.resize");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(
      compareShellSnapshots(
        expectedModel(fixture),
        captureShellSnapshot(container, { visible, observe: observeDOM }),
      ).differences,
    ).toEqual([]);
  });
  it("abandons active resize without writing when navigation becomes disabled", async () => {
    let disabled = false;
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        regions: value.model.regions.map((region) =>
          region.id === "frame-nav" ? { ...region, disabled } : region,
        ),
      },
    }));
    const handle = get("resize");
    handle.setPointerCapture = vi.fn();
    await act(async () =>
      fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 }),
    );
    disabled = true;
    act(() => fixture.setCollapsed(true));
    await act(async () =>
      fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 }),
    );
    await act(async () =>
      fireEvent.pointerUp(handle, { clientX: 140, pointerId: 1 }),
    );
    expect(fixture.model.navigation.resize?.width.value).toBe(248);
    expect(fixture.log.filter((item) => item.action === "resize")).toEqual([]);
    disabled = false;
    act(() => fixture.setCollapsed(false));
    await press(get("resize"), "ArrowRight");
    expect(
      fixture.log
        .filter((item) => item.action === "resize")
        .map((item) => item.input),
    ).toEqual([252]);
  });
  it.each([
    "nested-disabled",
    "reload-pending",
    "reload-error",
    "nav-loading",
    "nav-error",
  ] as const)("compares supported %s state to the model", (state) => {
    render("tracker", (value) => ({
      ...value,
      model: {
        ...value.model,
        effects: value.model.effects.map((effect) =>
          effect.id === "reload"
            ? {
                ...effect,
                ...(state === "reload-pending"
                  ? { pending: true }
                  : state === "reload-error"
                    ? { error: "Reload failed", retry: () => {} }
                    : {}),
              }
            : effect,
        ),
        regions: value.model.regions.map((region) =>
          region.id === "frame-nav" && state.startsWith("nav-")
            ? {
                ...region,
                state:
                  state === "nav-loading"
                    ? {
                        status: "loading" as const,
                        label: "Loading navigation",
                      }
                    : {
                        status: "error" as const,
                        message: "Navigation failed",
                      },
              }
            : region,
        ),
        navigation: {
          ...value.model.navigation,
          sections: value.model.navigation.sections.map((section) => ({
            ...section,
            entries: section.entries.map((entry) =>
              entry.id === "team-design" && state === "nested-disabled"
                ? { ...entry, disabled: true }
                : entry,
            ),
          })),
        },
      },
    }));
    expect(
      compareShellSnapshots(
        expectedModel(fixture),
        captureShellSnapshot(container, { visible, observe: observeDOM }),
      ).differences,
    ).toEqual([]);
  });
  it("dismisses a mobile drawer while its write effect is pending", async () => {
    const original = window.matchMedia;
    window.matchMedia = () =>
      ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList;
    try {
      render("notes", (value) => ({
        ...value,
        model: {
          ...value.model,
          effects: value.model.effects.map((effect) =>
            effect.id === "choice" ? { ...effect, pending: true } : effect,
          ),
          navigation: {
            ...value.model.navigation,
            presentation: {
              ...value.model.navigation.presentation,
              mobileOpen: {
                ...value.model.navigation.presentation.mobileOpen,
                changeEffectId: "choice",
              },
            },
          },
        },
      }));
      await click("open-navigation");
      const close = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button',
        ),
      ].find((button) => button.textContent === "Close");
      expect(close).toBeDefined();
      await act(async () => close?.click());
      expect(fixture.model.navigation.presentation.mobileOpen.value).toBe(
        false,
      );
      expect(fixture.log.some((item) => item.action === "choice")).toBe(false);
      await click("open-navigation");
      await act(async () =>
        fireEvent.keyDown(document.activeElement ?? document.body, {
          key: "Escape",
        }),
      );
      expect(fixture.model.navigation.presentation.mobileOpen.value).toBe(
        false,
      );
    } finally {
      window.matchMedia = original;
    }
  });
  it("shows mobile binding errors and retry even after dismissal", async () => {
    const retry = vi.fn();
    const original = window.matchMedia;
    window.matchMedia = () =>
      ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList;
    try {
      render("notes", (value) => ({
        ...value,
        model: {
          ...value.model,
          effects: value.model.effects.map((effect) =>
            effect.id === "choice"
              ? { ...effect, error: "Drawer update failed", retry }
              : effect,
          ),
          navigation: {
            ...value.model.navigation,
            presentation: {
              ...value.model.navigation.presentation,
              mobileOpen: {
                ...value.model.navigation.presentation.mobileOpen,
                changeEffectId: "choice",
              },
            },
          },
        },
      }));
      expect(document.body.textContent).toContain("Drawer update failed");
      const retryButton = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.closest('[data-shell-effect="choice"]'));
      expect(retryButton).toBeDefined();
      await act(async () => retryButton?.click());
      expect(retry).toHaveBeenCalledTimes(1);
      await click("open-navigation");
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain("Drawer update failed");
      const insideRetry = dialog?.querySelector<HTMLButtonElement>(
        '[data-shell-effect="choice"] button',
      );
      await act(async () => insideRetry?.click());
      expect(retry).toHaveBeenCalledTimes(2);
    } finally {
      window.matchMedia = original;
    }
  });
  it("restores the mobile opener after the drawer closes", async () => {
    const original = window.matchMedia;
    window.matchMedia = () =>
      ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList;
    try {
      render("notes");
      const opener = get("open-navigation");
      opener.focus();
      await click("open-navigation");
      const close = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button',
        ),
      ].find((button) => button.textContent === "Close");
      await act(async () => close?.click());
      await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    } finally {
      window.matchMedia = original;
    }
  });

  it.each(["pointer", "keyboard"] as const)(
    "cancels active %s reorder when navigation becomes disabled",
    async (mode) => {
      let disabled = false;
      render("tracker", (value) => ({
        ...value,
        model: {
          ...value.model,
          regions: value.model.regions.map((region) =>
            region.id === "frame-nav" ? { ...region, disabled } : region,
          ),
        },
      }));
      const handle = get("favorites.reorder");
      const list = handle.closest("[data-reorder-key]")?.parentElement;
      if (!list) throw new Error("Missing reorder list");
      handle.setPointerCapture = vi.fn();
      Object.defineProperty(list, "getBoundingClientRect", {
        value: () => new DOMRect(0, 0, 200, 120),
      });
      [...list.querySelectorAll<HTMLElement>("[data-reorder-key]")].forEach(
        (node, index) =>
          Object.defineProperty(node, "getBoundingClientRect", {
            value: () => new DOMRect(0, index * 40, 200, 40),
          }),
      );
      if (mode === "pointer")
        await act(async () =>
          fireEvent.pointerDown(handle, {
            button: 0,
            clientX: 190,
            clientY: 20,
            pointerId: 1,
          }),
        );
      else {
        await press(handle, " ");
        await press(handle, "ArrowDown");
      }
      disabled = true;
      act(() => fixture.setCollapsed(true));
      if (mode === "pointer") {
        await act(async () =>
          fireEvent.pointerMove(list, {
            clientX: 190,
            clientY: 60,
            pointerId: 1,
          }),
        );
        await act(async () =>
          fireEvent.pointerUp(list, {
            clientX: 190,
            clientY: 60,
            pointerId: 1,
          }),
        );
      } else await press(handle, " ");
      expect(fixture.log.filter((item) => item.action === "reorder")).toEqual(
        [],
      );
      expect(
        fixture.model.navigation.sections
          .find((section) => section.id === "favorites")
          ?.entries.map((entry) => entry.entityKey),
      ).toEqual(["plan", "research", "release"]);
    },
  );
  it.each(["change", "blur", "explicit"] as const)(
    "dismisses an open surface during a pending %s write",
    async (commit) => {
      let pending = false;
      render("tracker", (value) => ({
        ...value,
        model: {
          ...value.model,
          effects: value.model.effects.map((effect) =>
            effect.id === "choice" ? { ...effect, pending } : effect,
          ),
          navigation: {
            ...value.model.navigation,
            entries: value.model.navigation.entries.map((entry) =>
              entry.id === "help" && entry.effect?.kind === "open"
                ? {
                    ...entry,
                    effect: {
                      ...entry.effect,
                      open: {
                        ...entry.effect.open,
                        changeEffectId: "choice",
                        commit,
                      },
                    },
                  }
                : entry,
            ),
          },
        },
      }));
      const isOpen = () => {
        const entry = fixture.model.navigation.entries.find(
          (entry) => entry.id === "help",
        );
        return entry?.effect?.kind === "open" && entry.effect.open.value;
      };
      await click("help");
      pending = true;
      act(() => fixture.setCollapsed(true));
      const before = fixture.log.filter(
        (item) => item.action === "choice",
      ).length;
      const close = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button',
        ),
      ].find((button) => button.textContent === "Close");
      expect(close).toBeDefined();
      await act(async () => close?.click());
      expect(isOpen()).toBe(false);
      expect(
        fixture.log.filter((item) => item.action === "choice"),
      ).toHaveLength(before);
      pending = false;
      act(() => fixture.setCollapsed(false));
      await click("help");
      pending = true;
      act(() => fixture.setCollapsed(true));
      await act(async () =>
        fireEvent.keyDown(document.activeElement ?? document.body, {
          key: "Escape",
        }),
      );
      expect(isOpen()).toBe(false);
    },
  );

  it("keeps dialog focus on its opener after closed-layer cleanup", async () => {
    vi.useFakeTimers();
    render("tracker");
    const opener = get("help");
    opener.focus();
    await click("help");
    await act(async () =>
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      }),
    );
    await act(async () => vi.advanceTimersByTime(700));
    expect(document.activeElement).toBe(opener);
  });
});
