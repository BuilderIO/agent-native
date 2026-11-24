import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  ShellActionEffect,
  ShellBinding,
  ShellRename,
  ShellShortcutDescriptor,
  SidebarReorderPolicy,
  SidebarResizePolicy,
} from "./contracts.js";
import {
  clampSidebarResize,
  decodeSidebarCollapse,
  encodeSidebarCollapse,
  mergeVisibleNavigationOrder,
  readShellPreference,
  runShellAction,
  shellAction,
  sidebarCollapseAtPhase,
  writeShellPreference,
  type ShellStorageAccess,
  type ShellStoredValue,
  type SidebarCollapsePolicy,
} from "./shell-policies.js";

export function useSidebarCollapse(
  policy: SidebarCollapsePolicy,
  access: ShellStorageAccess,
) {
  const source = useRef({ policy, access });
  source.current = { policy, access };
  const lazy = policy.startup === "lazy-read-passive-write";
  const [stored, setStored] = useState<ShellStoredValue<boolean>>(() =>
    lazy
      ? readShellPreference(access, policy.key, (raw) =>
          decodeSidebarCollapse(raw, policy.encoding),
        )
      : {
          status: "unavailable",
          error: "not-read",
        },
  );
  const [collapsed, setValue] = useState(() =>
    lazy
      ? sidebarCollapseAtPhase(policy, stored, "ready").collapsed
      : policy.defaultCollapsed,
  );
  const committedWrite = useRef<{ key: string; value: boolean } | null>(null);
  const current = useRef(collapsed);
  const startupRead = useRef<string | null>(null);
  const startupWrite = useRef<{
    value: boolean;
    failure?: ShellStoredValue<boolean> | undefined;
  } | null>(null);
  const read = useCallback((initialPassive = false) => {
    const { policy, access } = source.current;
    const value = readShellPreference(access, policy.key, (raw) =>
      decodeSidebarCollapse(raw, policy.encoding),
    );
    startupWrite.current = null;
    const ready = sidebarCollapseAtPhase(policy, value, "ready");
    current.current = ready.collapsed;
    setValue(ready.collapsed);
    setStored(value);
    if (
      policy.startup !== "lazy-read-passive-write" &&
      (policy.writeOnReady === "always" ||
        (policy.writeOnReady === "valid-only" && value.status === "value"))
    ) {
      const written = writeShellPreference(
        access,
        policy.key,
        initialPassive ? policy.defaultCollapsed : ready.collapsed,
        (next) => encodeSidebarCollapse(next, policy.encoding),
      );
      if (written.status === "unavailable") setStored(written);
      if (initialPassive && ready.collapsed !== policy.defaultCollapsed)
        startupWrite.current = {
          value: ready.collapsed,
          failure: written.status === "unavailable" ? written : undefined,
        };
    }
  }, []);
  const startupKey = JSON.stringify([
    policy.key,
    policy.encoding,
    policy.defaultCollapsed,
    policy.writeOnReady,
    policy.startup ?? "layout-read",
  ]);
  const passive = policy.startup === "passive-read-initial-write";
  useLayoutEffect(() => {
    if (!passive && !lazy) {
      startupRead.current = null;
      read();
    }
  }, [read, startupKey, passive, lazy]);
  useEffect(() => {
    if (!passive || startupRead.current === startupKey) return;
    startupRead.current = startupKey;
    read(true);
  }, [read, startupKey, passive, lazy]);
  useEffect(() => {
    const pending = startupWrite.current;
    if (!pending || collapsed !== pending.value) return;
    startupWrite.current = null;
    const { policy, access } = source.current;
    const written = writeShellPreference(
      access,
      policy.key,
      collapsed,
      (value) => encodeSidebarCollapse(value, policy.encoding),
    );
    if (pending.failure) setStored(pending.failure);
    else if (written.status === "unavailable") setStored(written);
  }, [collapsed, startupKey]);
  useEffect(() => {
    if (!lazy) return;
    const previous = committedWrite.current;
    if (previous?.key === startupKey && previous.value === collapsed) return;
    committedWrite.current = { key: startupKey, value: collapsed };
    const written = writeShellPreference(
      access,
      policy.key,
      collapsed,
      (value) => encodeSidebarCollapse(value, policy.encoding),
    );
    setStored(written);
  }, [lazy, collapsed, startupKey, access, policy.key, policy.encoding]);
  const setCollapsed = useCallback(
    (next: boolean | ((value: boolean) => boolean)) => {
      const { policy, access } = source.current;
      if (policy.startup === "lazy-read-passive-write") {
        setValue(next);
        return;
      }
      const value = typeof next === "function" ? next(current.current) : next;
      startupWrite.current = null;
      current.current = value;
      setValue(value);
      setStored(
        writeShellPreference(access, policy.key, value, (item) =>
          encodeSidebarCollapse(item, policy.encoding),
        ),
      );
    },
    [],
  );
  const reload = useCallback(() => read(), [read]);
  return { collapsed, setCollapsed, stored, reload };
}

/** Event methods are delegated by the host; this hook installs no document listeners. */
export function useSidebarResize(
  policy: SidebarResizePolicy,
  binding: ShellBinding<number>,
  effects: readonly ShellActionEffect[],
  finishEffectId: string,
) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  const width = useRef(binding.value);
  if (!dragging) width.current = binding.value;
  const preview = (value: number) => {
    width.current = clampSidebarResize(value, policy);
    binding.set?.(width.current);
  };
  const commit = () => runShellAction(effects, finishEffectId, width.current);
  const change = async (value: number) => {
    preview(value);
    if (policy.persist === "change") await commit();
  };
  const finish = async (mode: SidebarResizePolicy["lostPointerCapture"]) => {
    if (!start.current || mode === "unbound") return;
    if (mode === "restore-start-and-commit") preview(start.current.width);
    start.current = null;
    setDragging(false);
    await commit();
  };
  return {
    dragging,
    begin(x: number) {
      if (shellAction(effects, finishEffectId).pending) return false;
      start.current = { x, width: binding.value };
      width.current = binding.value;
      setDragging(true);
      return true;
    },
    async move(x: number) {
      if (start.current)
        await change(start.current.width + x - start.current.x);
    },
    abort() {
      start.current = null;
      setDragging(false);
    },
    end: () => finish("commit-current"),
    cancel: () => finish(policy.pointerCancel),
    lostCapture: () => finish(policy.lostPointerCapture),
    async key(key: string, shift = false) {
      if (!policy.keyboard || shellAction(effects, finishEffectId).pending)
        return false;
      const delta = shift ? (policy.shiftStep ?? policy.step) : policy.step;
      const next =
        key === "Home"
          ? policy.min
          : key === "End"
            ? policy.max
            : key === "ArrowLeft" || key === "ArrowDown"
              ? width.current - delta
              : key === "ArrowRight" || key === "ArrowUp"
                ? width.current + delta
                : null;
      if (next === null) return false;
      preview(next);
      await commit();
      return true;
    },
    async reset() {
      if (
        policy.reset === undefined ||
        shellAction(effects, finishEffectId).pending
      )
        return false;
      preview(policy.reset);
      await commit();
      return true;
    },
  };
}

export function useNavigationOpener({
  initialOpen,
  routeKey,
  dismissOnNavigation,
  returnFocus,
}: {
  initialOpen: boolean;
  routeKey: string;
  dismissOnNavigation: boolean;
  returnFocus?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const previousRoute = useRef(routeKey);
  useEffect(() => {
    if (previousRoute.current !== routeKey && dismissOnNavigation)
      setOpen(false);
    previousRoute.current = routeKey;
  }, [routeKey, dismissOnNavigation]);
  return {
    open,
    setOpen,
    show: () => setOpen(true),
    dismiss() {
      setOpen(false);
      returnFocus?.();
    },
  };
}

export function useSidebarPeek({
  collapsed,
  openDelayMs,
  closeDelayMs,
}: {
  collapsed: boolean;
  openDelayMs: number;
  closeDelayMs: number;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    clear();
    if (!collapsed) setOpen(false);
    return clear;
  }, [collapsed, openDelayMs, closeDelayMs]);
  return {
    open: collapsed && open,
    enter() {
      clear();
      if (collapsed)
        timer.current = setTimeout(() => setOpen(true), openDelayMs);
    },
    leave() {
      clear();
      timer.current = setTimeout(() => setOpen(false), closeDelayMs);
    },
    dismiss() {
      clear();
      setOpen(false);
    },
  };
}

export function useNavigationDisclosure(
  initial: readonly string[],
  policy: { revealActive: boolean; expandNewFavorites: boolean },
  activeKey?: string,
  favoriteKeys: readonly string[] = [],
) {
  const [openKeys, setOpenKeys] = useState(() => new Set(initial));
  const favorites = useRef(favoriteKeys);
  favorites.current = favoriteKeys;
  const previousFavorites = useRef(new Set(favoriteKeys));
  const favoriteSignature = JSON.stringify(favoriteKeys);
  useEffect(() => {
    if (policy.revealActive && activeKey)
      setOpenKeys((previous) =>
        previous.has(activeKey) ? previous : new Set([...previous, activeKey]),
      );
  }, [activeKey, policy.revealActive]);
  useEffect(() => {
    const added = favorites.current.filter(
      (key) => !previousFavorites.current.has(key),
    );
    previousFavorites.current = new Set(favorites.current);
    if (policy.expandNewFavorites && added.length)
      setOpenKeys((previous) => new Set([...previous, ...added]));
  }, [favoriteSignature, policy.expandNewFavorites]);
  return {
    openKeys,
    toggle(key: string, allKeys?: readonly string[]) {
      setOpenKeys((previous) => {
        const next = new Set(previous);
        for (const item of allKeys ?? [key]) {
          if (previous.has(key)) next.delete(item);
          else next.add(item);
        }
        return next;
      });
    },
  };
}

export function useNavigationRename(
  rename: ShellRename,
  effects: readonly ShellActionEffect[],
) {
  const [draft, setDraft] = useState(rename.binding.value);
  const editing = useRef(rename.editing.value);
  editing.current = rename.editing.value;
  useEffect(() => {
    if (!rename.editing.value) setDraft(rename.binding.value);
  }, [rename.binding.value, rename.editing.value]);
  const cancel = () => {
    editing.current = false;
    setDraft(rename.binding.value);
    rename.editing.set?.(false);
  };
  const commit = async () => {
    if (!editing.current || shellAction(effects, rename.commitEffectId).pending)
      return false;
    const value = rename.trim ? draft.trim() : draft;
    if (
      (rename.ignoreEmpty && !value) ||
      (rename.ignoreUnchanged && value === rename.binding.value)
    ) {
      cancel();
      return false;
    }
    editing.current = false;
    rename.binding.set?.(value);
    rename.editing.set?.(false);
    return runShellAction(effects, rename.commitEffectId, value);
  };
  return {
    draft,
    setDraft,
    begin() {
      setDraft(rename.binding.value);
      editing.current = true;
      rename.editing.set?.(true);
    },
    cancel,
    commit,
    key(key: string) {
      if (key === rename.cancelKey) {
        cancel();
        return Promise.resolve(true);
      }
      return key === rename.submitKey ? commit() : Promise.resolve(false);
    },
    blur(stillInsideRow: boolean) {
      return rename.commitOnBlur &&
        !(rename.blurBoundary === "row" && stillInsideRow)
        ? commit()
        : Promise.resolve(false);
    },
  };
}

export interface NavigationReorderOrder {
  complete: readonly string[];
  visible: readonly string[];
}
export function useNavigationReorder(
  policy: SidebarReorderPolicy,
  order: NavigationReorderOrder,
  preview: (keys: readonly string[]) => void,
  effects: readonly ShellActionEffect[],
  commitEffectId: string,
) {
  const session = useRef<{
    initial: readonly string[];
    next: readonly string[];
    visible: readonly string[];
    active: string;
    x: number;
    y: number;
    activated: boolean;
    keyboard: boolean;
  } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const locked = () =>
    policy.disableWhileEffectPending &&
    shellAction(effects, commitEffectId).pending;
  const begin = (key: string, x: number, y: number, keyboard = false) => {
    if (
      locked() ||
      !order.visible.includes(key) ||
      (keyboard && !policy.keyboard)
    )
      return false;
    mergeVisibleNavigationOrder(order.complete, order.visible);
    session.current = {
      initial: [...order.complete],
      next: [...order.complete],
      visible: [...order.visible],
      active: key,
      x,
      y,
      activated: keyboard,
      keyboard,
    };
    setActiveKey(key);
    return true;
  };
  const over = (key: string, x: number, y: number) => {
    const value = session.current;
    if (!value || locked() || !value.visible.includes(key)) return false;
    if (
      !value.activated &&
      Math.hypot(x - value.x, y - value.y) < policy.pointerThreshold
    )
      return false;
    value.activated = true;
    const next = [...value.visible];
    const from = next.indexOf(value.active);
    const to = next.indexOf(key);
    next.splice(from, 1);
    next.splice(to, 0, value.active);
    value.visible = next;
    value.next = mergeVisibleNavigationOrder(value.initial, next);
    preview(value.next);
    return true;
  };
  const cancel = () => {
    if (session.current) preview(session.current.initial);
    session.current = null;
    setActiveKey(null);
  };
  const finish = async (hasDropTarget: boolean) => {
    const value = session.current;
    if (!value) return false;
    if (!hasDropTarget || !value.activated || locked()) {
      cancel();
      return false;
    }
    session.current = null;
    setActiveKey(null);
    return runShellAction(effects, commitEffectId, [...value.next]);
  };
  return {
    activeKey,
    begin,
    over,
    cancel,
    finish,
    previewVisible(keys: readonly string[]) {
      const value = session.current;
      if (!value || locked()) return false;
      if (
        keys.length !== value.visible.length ||
        keys.some((key) => !value.visible.includes(key))
      )
        throw new Error("Visible reorder must preserve membership");
      value.next = mergeVisibleNavigationOrder(value.initial, keys);
      value.visible = [...keys];
      preview(value.next);
      return true;
    },
    async key(key: string, focusedKey: string) {
      if (!policy.keyboard) return false;
      if (key === "Escape" && session.current) {
        cancel();
        return true;
      }
      if (key === " ")
        return session.current ? finish(true) : begin(focusedKey, 0, 0, true);
      const value = session.current;
      if (
        !value?.keyboard ||
        !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)
      )
        return false;
      const index =
        value.visible.indexOf(value.active) +
        (["ArrowUp", "ArrowLeft"].includes(key) ? -1 : 1);
      const target = index < 0 ? undefined : value.visible.at(index);
      return target === undefined ? true : over(target, 0, 0);
    },
  };
}

export interface NavigationLocation {
  pathname: string;
  search?: string;
  hash?: string;
  key?: string;
}
export interface NavigationHistoryPolicy {
  activeKey: string;
  destinationKey: (section: string) => string;
  sections: readonly string[];
  fallbacks: Readonly<Partial<Record<string, string>>>;
  resolveSection: (location: NavigationLocation, previous?: string) => string;
  belongsTo: (to: string, section: string) => boolean;
  restoreScrollPosition: boolean;
}
export type NavigationHistoryTarget =
  | { kind: "current" }
  | {
      kind: "navigate";
      to: string;
      state: { restoreScrollPosition: boolean };
      stored: ShellStoredValue<string>;
    };
export interface NavigationHistory {
  active: string | undefined;
  persistence: ShellStoredValue<string>;
  /** Call from a registry effect used as the navigation effect's prerequisite.
   * An unavailable result must reject that effect to prevent navigation. */
  select(section: string): ShellStoredValue<string>;
  target(section: string): NavigationHistoryTarget;
}
export function useNavigationHistory(
  policy: NavigationHistoryPolicy,
  access: ShellStorageAccess,
  location: NavigationLocation,
): NavigationHistory {
  const accessRef = useRef(access);
  accessRef.current = access;
  const [active, setActive] = useState<string | undefined>();
  const [persistence, setPersistence] = useState<ShellStoredValue<string>>({
    status: "absent",
  });
  const memory = useRef(new Map<string, string>());
  const previous = useRef<string | undefined>(undefined);
  const selectionIntent = useRef<string | undefined>(undefined);
  const lastLocation = useRef<string | undefined>(undefined);
  const policyRef = useRef(policy);
  policyRef.current = policy;
  useLayoutEffect(() => {
    const currentPolicy = policyRef.current;
    const read = readShellPreference(access, currentPolicy.activeKey, (value) =>
      currentPolicy.sections.includes(value) ? value : undefined,
    );
    previous.current = read.status === "value" ? read.value : undefined;
    selectionIntent.current = undefined;
    setActive(previous.current);
    memory.current.clear();
    lastLocation.current = undefined;
    setPersistence(read);
  }, [policy.activeKey]);
  useLayoutEffect(() => {
    const address = `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
    const marker = `${location.key ?? ""}:${address}`;
    if (lastLocation.current === marker) return;
    lastLocation.current = marker;
    const currentPolicy = policyRef.current;
    const section = currentPolicy.resolveSection(
      location,
      selectionIntent.current ?? previous.current,
    );
    selectionIntent.current = undefined;
    if (!currentPolicy.sections.includes(section)) {
      setPersistence({ status: "invalid", rawValue: section });
      return;
    }
    previous.current = section;
    setActive(section);
    memory.current.set(section, address);
    const selected = writeShellPreference(
      accessRef.current,
      currentPolicy.activeKey,
      section,
      (value) => value,
    );
    const saved = writeShellPreference(
      accessRef.current,
      currentPolicy.destinationKey(section),
      address,
      (to) => JSON.stringify({ to }),
    );
    setPersistence(selected.status === "unavailable" ? selected : saved);
  }, [
    location.pathname,
    location.search,
    location.hash,
    location.key,
    policy.activeKey,
  ]);
  return {
    active,
    persistence,
    select(section: string) {
      const currentPolicy = policyRef.current;
      if (!currentPolicy.sections.includes(section))
        throw new Error(`Unknown navigation section: ${section}`);
      const selected = writeShellPreference(
        accessRef.current,
        currentPolicy.activeKey,
        section,
        (value) => value,
      );
      if (selected.status === "value") selectionIntent.current = section;
      setPersistence(selected);
      return selected;
    },
    target(section: string) {
      if (!policy.sections.includes(section))
        throw new Error(`Unknown navigation section: ${section}`);
      if (policy.resolveSection(location, previous.current) === section)
        return { kind: "current" as const };
      const live = memory.current.get(section);
      const stored = readShellPreference(
        access,
        policy.destinationKey(section),
        (raw) => {
          try {
            const value: unknown = JSON.parse(raw);
            return value &&
              typeof value === "object" &&
              "to" in value &&
              typeof value.to === "string" &&
              policy.belongsTo(value.to, section)
              ? value.to
              : undefined;
            // coercion-ok: undefined from decode becomes readShellPreference's typed "invalid" status, distinct from absent and unavailable
          } catch {
            return undefined;
          }
        },
      );
      const fallback = policy.fallbacks[section];
      if (fallback === undefined)
        throw new Error(`Missing fallback: ${section}`);
      const to =
        live && policy.belongsTo(live, section)
          ? live
          : stored.status === "value"
            ? stored.value
            : fallback;
      return {
        kind: "navigate" as const,
        to,
        state: { restoreScrollPosition: policy.restoreScrollPosition },
        stored,
      };
    },
  };
}

export interface ShellShortcutEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}
export interface ShellShortcutContext {
  platform: "mac" | "other";
  scope: string;
  phase: "capture" | "bubble";
  focusKind: string;
  overlayOpen: boolean;
  pausedOwners: readonly string[];
}
export type ShellShortcutResult =
  | { status: "unhandled" }
  | {
      status: "reserved";
      shortcutId: string;
      stage: "prefix" | "unmatched" | "activation";
    }
  | { status: "dispatched"; shortcutId: string };
const SHELL_MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
function rejectedShortcutGuards(
  guard: ShellShortcutDescriptor["guard"],
  event: ShellShortcutEvent,
  context: ShellShortcutContext,
) {
  const rejected: (keyof NonNullable<
    NonNullable<ShellShortcutDescriptor["sequencePolicy"]>["guardRejected"]
  >)[] = [];
  if (!guard.allowRepeat && event.repeat) rejected.push("repeat");
  if (guard.respectDefaultPrevented && event.defaultPrevented)
    rejected.push("defaultPrevented");
  if (guard.composition === "ignore" && event.isComposing)
    rejected.push("composition");
  if (guard.overlay === "ignore" && context.overlayOpen)
    rejected.push("overlay");
  if (!guard.focusKinds.includes(context.focusKind)) rejected.push("focus");
  if (guard.rejectModifiers?.some((modifier) => event[`${modifier}Key`]))
    rejected.push("modifiers");
  if (
    guard.pauseOwner &&
    context.pausedOwners.includes(guard.pauseOwner) &&
    (!guard.pauseKeys ||
      guard.pauseKeys.some(
        (key) => key.toLowerCase() === event.key.toLowerCase(),
      ))
  )
    rejected.push("pause");
  return rejected;
}
/** Delegation lets existing capture/bubble paths share one table, without another listener. */
export function useShellShortcuts(
  ownerId: string,
  descriptors: readonly ShellShortcutDescriptor[],
  dispatch: (actionName: string) => void,
) {
  const sequence = useRef(new Map<string, { index: number; at: number }>());
  const handled = useRef(new WeakSet<object>());
  const reserved = useRef(new WeakMap<object, ShellShortcutDescriptor>());
  const handle = (
    event: ShellShortcutEvent,
    context: ShellShortcutContext,
    now = Date.now(),
  ): ShellShortcutResult => {
    const reservation = reserved.current.get(event);
    if (
      reservation?.activation?.phase === context.phase &&
      reservation.scope === context.scope &&
      (reservation.platform === "all" ||
        reservation.platform === context.platform)
    ) {
      reserved.current.delete(event);
      if (
        rejectedShortcutGuards(reservation.activation.guard, event, context)
          .length
      )
        return { status: "unhandled" };
      dispatch(reservation.actionName);
      return { status: "dispatched", shortcutId: reservation.id };
    }
    if (handled.current.has(event)) return { status: "unhandled" };
    const next = new Map(sequence.current);
    let matched: ShellShortcutDescriptor | undefined;
    let complete: ShellShortcutDescriptor | undefined;
    let unmatched: ShellShortcutDescriptor | undefined;
    const candidates = descriptors
      .filter(
        (item) =>
          item.ownerId === ownerId &&
          item.scope === context.scope &&
          item.phase === context.phase &&
          (item.platform === "all" || item.platform === context.platform),
      )
      .map((item) => {
        const progress = sequence.current.get(item.id);
        const elapsed = progress ? now - progress.at : 0;
        const withinWindow =
          item.sequencePolicy?.expiry === "exclusive"
            ? elapsed < (item.sequenceTimeoutMs ?? 0)
            : elapsed <= (item.sequenceTimeoutMs ?? 0);
        const preserveModifier =
          SHELL_MODIFIER_KEYS.has(event.key) &&
          item.sequencePolicy?.modifiers !== "consume";
        return {
          item,
          progress,
          index: progress && withinWindow ? progress.index : 0,
          rejected: rejectedShortcutGuards(item.guard, event, context),
          preserveModifier,
        };
      });
    const reserving = candidates.some(
      ({ item, index, rejected, preserveModifier }) =>
        index > 0 &&
        item.sequencePolicy?.unmatched === "reserve" &&
        !rejected.length &&
        !preserveModifier,
    );
    for (const {
      item,
      progress,
      index,
      rejected,
      preserveModifier,
    } of candidates) {
      next.delete(item.id);
      if (rejected.length) {
        if (
          progress &&
          rejected.every(
            (guard) =>
              item.sequencePolicy?.guardRejected?.[guard] === "preserve",
          )
        )
          next.set(item.id, progress);
        continue;
      }
      if (reserving && index === 0) continue;
      const matches = (
        chord: ShellShortcutDescriptor["keys"][number] | undefined,
      ) => {
        if (!chord || (!chord.key && !chord.code)) return false;
        const meta =
          chord.meta ?? (chord.mod === true && context.platform === "mac");
        const ctrl =
          chord.ctrl ?? (chord.mod === true && context.platform === "other");
        return (
          (!chord.key || chord.key.toLowerCase() === event.key.toLowerCase()) &&
          (!chord.code || chord.code === event.code) &&
          event.metaKey === meta &&
          event.ctrlKey === ctrl &&
          event.altKey === Boolean(chord.alt) &&
          event.shiftKey === Boolean(chord.shift)
        );
      };
      const matchedIndex = matches(item.keys[index])
        ? index
        : !reserving &&
            !(
              index > 0 &&
              (item.sequencePolicy?.unmatched === "consume" ||
                item.sequencePolicy?.unmatched === "reserve")
            ) &&
            matches(item.keys[0])
          ? 0
          : -1;
      if (matchedIndex < 0) {
        if (progress && index > 0 && preserveModifier)
          next.set(item.id, progress);
        else if (index > 0 && item.sequencePolicy?.unmatched === "reserve")
          unmatched ??= item;
        continue;
      }
      matched ??= item;
      if (matchedIndex + 1 < item.keys.length)
        next.set(item.id, { index: matchedIndex + 1, at: now });
      else complete ??= item;
    }
    sequence.current = next;
    if (complete !== undefined) {
      sequence.current.clear();
      handled.current.add(event);
      if (complete.activation) {
        if (complete.activation.phase !== context.phase) {
          reserved.current.set(event, complete);
          return {
            status: "reserved",
            shortcutId: complete.id,
            stage: "activation",
          };
        }
        if (
          rejectedShortcutGuards(complete.activation.guard, event, context)
            .length
        )
          return { status: "unhandled" };
      }
      dispatch(complete.actionName);
      return { status: "dispatched", shortcutId: complete.id };
    }
    if (matched) {
      handled.current.add(event);
      return { status: "reserved", shortcutId: matched.id, stage: "prefix" };
    }
    if (unmatched) {
      sequence.current.clear();
      handled.current.add(event);
      return {
        status: "reserved",
        shortcutId: unmatched.id,
        stage: "unmatched",
      };
    }
    return { status: "unhandled" };
  };
  return Object.assign(
    (event: ShellShortcutEvent, context: ShellShortcutContext, now?: number) =>
      handle(event, context, now).status !== "unhandled",
    { handle },
  );
}

export interface NavigationPreferenceItem {
  key: string;
  visibility: "always" | "badged" | "more";
  badged: boolean;
}
/** One instance feeds the rail, overflow menu and customizer from the same binding. */
export function useNavigationPreferences(
  items: readonly NavigationPreferenceItem[],
  order: ShellBinding<readonly string[]>,
  read: import("./contracts.js").ShellReadState,
  effects: readonly ShellActionEffect[],
  commitEffectId: string,
) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const keys = [
    ...new Set([...order.value, ...items.map((item) => item.key)]),
  ].filter((key) => byKey.has(key));
  const ordered = keys
    .map((key) => byKey.get(key))
    .filter((item): item is NavigationPreferenceItem => item !== undefined);
  return {
    ordered,
    visible: ordered.filter(
      (item) =>
        item.visibility === "always" ||
        (item.visibility === "badged" && item.badged),
    ),
    more: ordered.filter(
      (item) =>
        item.visibility === "more" ||
        (item.visibility === "badged" && !item.badged),
    ),
    async reorderVisible(next: readonly string[]) {
      if (
        read.status !== "ready" ||
        shellAction(effects, commitEffectId).pending
      )
        return false;
      const merged = mergeVisibleNavigationOrder(keys, next);
      order.set?.(merged);
      return runShellAction(effects, commitEffectId, merged);
    },
    async changeVisibility(
      key: string,
      visibility: NavigationPreferenceItem["visibility"],
      effectId: string,
    ) {
      if (read.status !== "ready" || !byKey.has(key)) return false;
      return runShellAction(effects, effectId, { key, visibility });
    },
  };
}

export function useNavigationFocusHandoff() {
  const target = useRef<{ focus(): void } | null>(null);
  return {
    remember(element: { focus(): void } | null) {
      target.current = element;
    },
    restore() {
      const element = target.current;
      target.current = null;
      element?.focus();
    },
    clear() {
      target.current = null;
    },
  };
}
