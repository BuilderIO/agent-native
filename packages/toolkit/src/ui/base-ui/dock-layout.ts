import { requireItem } from "./indexed-item.js";

export type DockGroup = {
  type: "group";
  id: string;
  tabs: readonly string[];
  active: string;
};
export type DockSplit = {
  type: "split";
  id: string;
  axis: "inline" | "block";
  side: "start" | "end";
  size: number;
  first: DockLayout;
  second: DockLayout;
};
export type DockSurface = { type: "surface"; id: string; panel: string };
export type DockLeaf = DockGroup | DockSurface;
export type DockLayout = DockLeaf | DockSplit;
export type DockPosition =
  | "before"
  | "after"
  | "center"
  | "start"
  | "end"
  | "above"
  | "below";

export function dockLeaves(node: DockLayout): DockLeaf[] {
  return node.type === "split"
    ? [...dockLeaves(node.first), ...dockLeaves(node.second)]
    : [node];
}
export function dockGroups(node: DockLayout): DockGroup[] {
  return dockLeaves(node).filter(
    (leaf): leaf is DockGroup => leaf.type === "group",
  );
}
export function dockLeafPanel(leaf: DockLeaf) {
  return leaf.type === "surface" ? leaf.panel : leaf.active;
}

/** Validates a saved layout against the panels available in this workspace. */
export function isDockLayout(
  value: unknown,
  panels: readonly string[],
): value is DockLayout {
  const ids = new Set<string>(),
    tabs = new Set<string>(),
    allowed = new Set(panels);
  const pending: unknown[] = [value];
  let splits = 0;
  while (pending.length) {
    const node = pending.pop();
    if (
      !node ||
      typeof node !== "object" ||
      !("id" in node) ||
      typeof node.id !== "string" ||
      ids.has(node.id)
    )
      return false;
    ids.add(node.id);
    if (!("type" in node)) return false;
    if (node.type === "surface") {
      if (
        !("panel" in node) ||
        typeof node.panel !== "string" ||
        !allowed.has(node.panel) ||
        tabs.has(node.panel)
      )
        return false;
      tabs.add(node.panel);
      continue;
    }
    if (node.type === "split") {
      splits++;
      if (
        splits >= allowed.size ||
        !("axis" in node) ||
        (node.axis !== "block" && node.axis !== "inline") ||
        !("side" in node) ||
        (node.side !== "start" && node.side !== "end") ||
        !("size" in node) ||
        typeof node.size !== "number" ||
        !Number.isFinite(node.size) ||
        node.size < 0 ||
        !("first" in node) ||
        !("second" in node)
      )
        return false;
      pending.push(node.second, node.first);
      continue;
    }
    if (
      node.type !== "group" ||
      !("tabs" in node) ||
      !Array.isArray(node.tabs) ||
      !("active" in node) ||
      !node.tabs.includes(node.active)
    )
      return false;
    for (const tab of node.tabs) {
      if (!allowed.has(tab) || tabs.has(tab)) return false;
      tabs.add(tab);
    }
  }
  return tabs.size === panels.length;
}

export function updateDockNode(
  node: DockLayout,
  id: string,
  update: (node: DockLayout) => DockLayout,
): DockLayout {
  if (node.id === id) return update(node);
  if (node.type !== "split") return node;
  const first = updateDockNode(node.first, id, update),
    second = updateDockNode(node.second, id, update);
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
}

function dockIdAllocator(layout: DockLayout) {
  const nodes = new Set<string>();
  function collect(node: DockLayout) {
    nodes.add(node.id);
    if (node.type === "split") {
      collect(node.first);
      collect(node.second);
    }
  }
  collect(layout);
  return (prefix: string) => {
    let i = 1;
    while (nodes.has(prefix + i)) i++;
    const id = prefix + i;
    nodes.add(id);
    return id;
  };
}

/** Restores a fixed work surface from a layout that allowed its panel to be tabbed. */
export function restoreDockSurface(
  layout: DockLayout,
  panel: string,
): DockLayout {
  const leaf = dockLeaves(layout).find((item) =>
    item.type === "surface" ? item.panel === panel : item.tabs.includes(panel),
  );
  if (!leaf) throw new Error("Unknown dock panel");
  if (leaf.type === "surface") return layout;
  const surface: DockSurface = { type: "surface", id: leaf.id, panel };
  const tabs = leaf.tabs.filter((tab) => tab !== panel);
  const firstTab = tabs.at(0);
  if (firstTab === undefined)
    return updateDockNode(layout, leaf.id, () => surface);
  const nextId = dockIdAllocator(layout);
  return updateDockNode(layout, leaf.id, () => ({
    type: "split",
    id: nextId("split"),
    axis: "block",
    side: "end",
    size: 240,
    first: surface,
    second: {
      type: "group",
      id: nextId("group"),
      tabs,
      active: leaf.active === panel ? firstTab : leaf.active,
    },
  }));
}

export function canPlaceDockTab(
  source: DockLeaf,
  tab: string,
  destination: DockLeaf,
  target: string,
  position: DockPosition,
): boolean {
  if (source.type === "surface") return false;
  if (position !== "center" && position !== "before" && position !== "after")
    return source !== destination || source.tabs.length > 1;
  if (destination.type === "surface") return false;
  if (source !== destination) return true;
  if (tab === target) return false;
  const index = source.tabs.indexOf(tab);
  if (position === "center") return index !== source.tabs.length - 1;
  return (
    source.tabs.indexOf(target) !== index + (position === "before" ? 1 : -1)
  );
}

/** Moves a tab, pruning empty groups and the split that used to contain them. */
export function moveDockTab(
  layout: DockLayout,
  tab: string,
  target: string,
  position: DockPosition,
  size = 280,
): DockLayout {
  const leaves = dockLeaves(layout);
  const find = (id: string) =>
    leaves.find((leaf) =>
      leaf.type === "surface" ? leaf.panel === id : leaf.tabs.includes(id),
    );
  const source = find(tab),
    destination = find(target);
  if (!source || !destination)
    throw new Error("Unknown dock tab or destination");
  const split = !["before", "after", "center"].includes(position);
  if (source.type === "surface" || (!split && destination.type === "surface"))
    return layout;
  if (split && (!Number.isFinite(size) || size < 0))
    throw new RangeError("Dock split size must be finite and non-negative");
  if (!canPlaceDockTab(source, tab, destination, target, position))
    return layout;
  const remaining = source.tabs.filter((id) => id !== tab);
  const remainingGroup: DockGroup | null = remaining.length
    ? {
        ...source,
        tabs: remaining,
        active:
          source.active === tab
            ? requireItem(
                remaining,
                Math.min(source.tabs.indexOf(tab), remaining.length - 1),
              )
            : source.active,
      }
    : null;
  const nextId = split ? dockIdAllocator(layout) : undefined;
  function transform(node: DockLayout): DockLayout | null {
    if (node.type === "split") {
      const first = transform(node.first),
        second = transform(node.second);
      if (!first || !second) return first ?? second;
      return first === node.first && second === node.second
        ? node
        : { ...node, first, second };
    }
    const group = node === source ? remainingGroup : node;
    if (node !== destination || !group) return group;
    if (!nextId) {
      if (group.type === "surface") return group;
      const tabs = [...group.tabs];
      const index =
        position === "center"
          ? tabs.length
          : tabs.indexOf(target) + (position === "after" ? 1 : 0);
      tabs.splice(index, 0, tab);
      return { ...group, tabs, active: tab };
    }
    const moved: DockGroup = {
      type: "group",
      id: nextId("group"),
      tabs: [tab],
      active: tab,
    };
    const start = position === "start" || position === "above";
    return {
      type: "split",
      id: nextId("split"),
      axis: position === "above" || position === "below" ? "block" : "inline",
      side: start ? "start" : "end",
      size,
      first: start ? moved : group,
      second: start ? group : moved,
    };
  }
  const result = transform(layout);
  if (!result) throw new Error("A dock layout must retain its moved panel");
  return result;
}
