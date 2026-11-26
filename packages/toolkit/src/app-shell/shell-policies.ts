import type {
  ShellActionEffect,
  ShellActiveRule,
  ShellCondition,
  ShellValue,
  SidebarResizePolicy,
} from "./contracts.js";

export type ShellStoredValue<Value> =
  | { status: "absent" }
  | { status: "value"; value: Value }
  | { status: "invalid"; rawValue: string }
  | { status: "unavailable"; error: unknown };
export interface ShellStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type ShellStorageAccess = () => ShellStorage;
export interface SidebarCollapsePolicy {
  key: string;
  encoding: "zero-one" | "true-false";
  defaultCollapsed: boolean;
  /** Existing owners differ on whether they normalize at mount. */
  writeOnReady: "never" | "valid-only" | "always";
  /** Omitted: layout read + ready write. Passive mode writes the initial default
   * after reading, then the loaded value after its commit, without repairing boot.
   * Lazy mode reads in the initializer and writes each committed value passively,
   * including mount, independently of writeOnReady. */
  startup?:
    | "layout-read"
    | "passive-read-initial-write"
    | "lazy-read-passive-write";
  boot: { absent: boolean; invalid: boolean; unavailable: boolean };
  widths: { expanded: number; collapsed: number; bootCollapsed: number };
}
export function readShellPreference<Value>(
  access: ShellStorageAccess,
  key: string,
  decode: (raw: string) => Value | undefined,
): ShellStoredValue<Value> {
  try {
    const rawValue = access().getItem(key);
    if (rawValue === null) return { status: "absent" };
    const value = decode(rawValue);
    return value === undefined
      ? { status: "invalid", rawValue }
      : { status: "value", value };
  } catch (error) {
    return { status: "unavailable", error };
  }
}
export function writeShellPreference<Value>(
  access: ShellStorageAccess,
  key: string,
  value: Value,
  encode: (value: Value) => string,
): ShellStoredValue<Value> {
  try {
    access().setItem(key, encode(value));
    return { status: "value", value };
  } catch (error) {
    return { status: "unavailable", error };
  }
}
export function decodeSidebarCollapse(
  raw: string,
  encoding: SidebarCollapsePolicy["encoding"],
): boolean | undefined {
  if (raw === (encoding === "zero-one" ? "1" : "true")) return true;
  if (raw === (encoding === "zero-one" ? "0" : "false")) return false;
  return undefined;
}
export function encodeSidebarCollapse(
  value: boolean,
  encoding: SidebarCollapsePolicy["encoding"],
): string {
  return encoding === "zero-one" ? (value ? "1" : "0") : String(value);
}
export function sidebarCollapseAtPhase(
  policy: SidebarCollapsePolicy,
  stored: ShellStoredValue<boolean>,
  phase: "boot" | "ready" | "settled",
) {
  const collapsed =
    stored.status === "value"
      ? stored.value
      : phase === "boot"
        ? policy.boot[stored.status]
        : policy.defaultCollapsed;
  return {
    collapsed,
    width: collapsed
      ? phase === "boot"
        ? policy.widths.bootCollapsed
        : policy.widths.collapsed
      : policy.widths.expanded,
  };
}
export function clampSidebarResize(
  width: number,
  policy: SidebarResizePolicy,
): number {
  if (!Number.isFinite(width)) throw new Error("Width must be finite");
  return Math.min(
    policy.max,
    Math.max(
      policy.min,
      policy.growOnlyFrom ?? policy.min,
      policy.round ? Math.round(width) : width,
    ),
  );
}
export function mergeVisibleNavigationOrder(
  complete: readonly string[],
  visible: readonly string[],
): string[] {
  if (
    new Set(complete).size !== complete.length ||
    new Set(visible).size !== visible.length ||
    visible.some((key) => !complete.includes(key))
  )
    throw new Error("Order must contain unique known keys");
  const members = new Set(visible);
  let index = 0;
  return complete.map((key) => {
    if (!members.has(key)) return key;
    const next = visible.at(index++);
    if (next === undefined)
      throw new Error("Order must contain unique known keys");
    return next;
  });
}
export function shellConditionState(condition: ShellCondition) {
  const denied = condition.gate?.allowed === false;
  return {
    visible:
      condition.visible !== false &&
      !(denied && condition.gate?.denied === "hidden"),
    disabled: Boolean(
      condition.disabled ||
      condition.disabledReason ||
      (denied && condition.gate?.denied === "disabled"),
    ),
  };
}
export function isShellRouteActive(
  rule: ShellActiveRule,
  pathname: string,
  destinations: readonly string[] = [],
): boolean {
  const segment = (path: string) =>
    pathname === path ||
    pathname.startsWith(path.endsWith("/") ? path : `${path}/`);
  switch (rule.kind) {
    case "none":
      return false;
    case "resolved":
      return rule.value;
    case "exact":
      return rule.paths.includes(pathname);
    case "prefix":
      return segment(rule.path);
    case "longest-match":
      return (
        [rule.destination, ...destinations]
          .filter(segment)
          .sort((a, b) => b.length - a.length)[0] === rule.destination
      );
  }
}
export function shellAction(
  effects: readonly ShellActionEffect[],
  id: string,
): ShellActionEffect {
  const matches = effects.filter((effect) => effect.id === id);
  const match = matches.at(0);
  if (matches.length !== 1 || match === undefined)
    throw new Error(`Expected one action effect: ${id}`);
  return match;
}
export async function runShellAction(
  effects: readonly ShellActionEffect[],
  id: string,
  input?: ShellValue,
): Promise<boolean> {
  const ordered: ShellActionEffect[] = [];
  const visited = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined) {
    if (visited.has(current))
      throw new Error(`Cyclic action effect order: ${current}`);
    visited.add(current);
    const effect = shellAction(effects, current);
    ordered.unshift(effect);
    current = effect.beforeEffectId;
  }
  if (ordered.some((effect) => effect.pending)) return false;
  for (const effect of ordered) await effect.run(input);
  return true;
}
