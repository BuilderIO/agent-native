import { IconDots } from "@tabler/icons-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { IconButton } from "./button.js";
import {
  canPlaceDockTab,
  dockLeaves,
  dockLeafPanel,
  type DockLeaf,
  isDockLayout,
  moveDockTab,
  updateDockNode,
  type DockGroup,
  type DockLayout,
  type DockPosition,
} from "./dock-layout.js";
import { requireItem } from "./indexed-item.js";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  MenuSubmenuRoot,
  MenuSubmenuTrigger,
  MenuSubmenuPopup,
} from "./menu.js";
import { SplitPane, type SplitPaneProps } from "./split-pane.js";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./tabs.js";
export {
  restoreDockSurface,
  isDockLayout,
  moveDockTab,
  type DockLayout,
  type DockPosition,
} from "./dock-layout.js";

export interface DockPanel {
  id: string;
  label: string;
  content: React.ReactNode;
}
export interface DockWorkspaceProps extends Pick<
  SplitPaneProps,
  "step" | "snapToStep"
> {
  panels: readonly DockPanel[];
  layout: DockLayout;
  onLayoutChange: (layout: DockLayout) => void;
  label: string;
  onReset?: () => void;
  className?: string;
  style?: React.CSSProperties;
  labels?: Partial<typeof defaultLabels>;
}
interface Target {
  tab: string;
  position: DockPosition;
  size: number;
}
const edges = {
  start: "Split at start",
  end: "Split at end",
  above: "Split above",
  below: "Split below",
};
type Edge = keyof typeof edges;
const defaultLabels = {
  arrange: (panel: string) => `Arrange ${panel}`,
  resize: (panels: string) => `Resize ${panels}`,
  earlier: "Move tab earlier",
  later: "Move tab later",
  split: "Split this group",
  join: "Join tab group",
  reset: "Reset layout",
  ...edges,
};

function dockTracks(node: DockLayout, axis: "inline" | "block"): number {
  if (node.type !== "split") return 1;
  const first = dockTracks(node.first, axis);
  const second = dockTracks(node.second, axis);
  return node.axis === axis ? first + second : Math.max(first, second);
}

function dockMinimum(node: DockLayout, axis: "inline" | "block") {
  const tracks = dockTracks(node, axis);
  return (separatorSize: number) => tracks * 80 + (tracks - 1) * separatorSize;
}

function revealDockTab(list: HTMLElement, tab: HTMLElement) {
  if (list.scrollWidth <= list.clientWidth) return;
  const left = tab.offsetLeft - list.scrollLeft;
  const right = left + tab.offsetWidth - list.clientWidth;
  if (left < 0 && right <= 0)
    list.scrollLeft += tab.offsetWidth > list.clientWidth ? right : left;
  else if (right > 0 && left >= 0)
    list.scrollLeft += tab.offsetWidth > list.clientWidth ? left : right;
}

function railRectAt(rail: HTMLElement, x: number, y: number) {
  const rect = rail.getBoundingClientRect();
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
    ? rect
    : null;
}

function DockTabList({
  tabs,
  label,
  children,
}: {
  tabs: readonly string[];
  label: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const list = ref.current;
    const Observer = list?.ownerDocument.defaultView?.ResizeObserver;
    if (!list || !Observer) return;
    function measure(rail: HTMLElement) {
      rail.toggleAttribute(
        "data-overflowing",
        rail.scrollWidth > rail.clientWidth,
      );
      const active =
        rail.querySelector<HTMLElement>('[role="tab"]:focus') ??
        rail.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (active) revealDockTab(rail, active);
    }
    measure(list);
    const observer = new Observer(() => measure(list));
    observer.observe(list);
    for (const tab of list.children) observer.observe(tab);
    return () => observer.disconnect();
  }, [tabs]);
  return (
    <TabsList ref={ref} aria-label={label}>
      {children}
    </TabsList>
  );
}

function ownedElement(root: HTMLElement | null, selector: string) {
  if (!root) return;
  for (const match of root.querySelectorAll<HTMLElement>(selector)) {
    if (match.closest(".dock-workspace") === root) return match;
  }
}
function splitSize(group: HTMLElement, position: DockPosition) {
  const length =
    position === "above" || position === "below"
      ? group.offsetHeight
      : group.offsetWidth;
  return length / 2;
}

interface DropTarget {
  tab: string;
  position: DockPosition;
  element: HTMLElement;
  revealIn?: HTMLElement | null;
}
function scrollDockRail(
  root: HTMLElement,
  hit: Element | null,
  x: number,
  elapsedMs: number,
) {
  const rail = hit?.closest<HTMLElement>('[role="tablist"]');
  if (
    !rail?.parentElement?.classList.contains("dock-workspace-group") ||
    rail.closest(".dock-workspace") !== root ||
    rail.scrollWidth <= rail.clientWidth
  )
    return false;
  const rect = rail.getBoundingClientRect();
  if (!rect.width) return false;
  const localX = ((x - rect.left) * rail.offsetWidth) / rect.width;
  const edge = Math.min(24, rail.clientWidth / 4);
  if (!edge) return false;
  const distance =
    localX < edge
      ? localX - edge
      : Math.max(0, localX - (rail.clientWidth - edge));
  if (!distance) return false;
  const before = rail.scrollLeft;
  rail.scrollLeft +=
    Math.sign(distance) *
    Math.max(1, (Math.abs(distance) / edge) * 0.6 * elapsedMs);
  return before !== rail.scrollLeft;
}

function dropTarget(
  root: HTMLElement,
  el: Element | null,
  x: number,
  y: number,
): DropTarget | null {
  const group = el?.closest<HTMLElement>("[data-dock-group]");
  if (!group || group.closest(".dock-workspace") !== root) return null;
  const first = group.firstElementChild;
  const rail = first?.getAttribute("role") === "tablist" ? first : null;
  const railBounds = rail?.getBoundingClientRect();
  const rtl = getComputedStyle(group).direction === "rtl";
  if (rail && railBounds && y >= railBounds.top && y < railBounds.bottom) {
    const tabs = rail.getElementsByTagName("button");
    if (rtl ? x < railBounds.left : x >= railBounds.right) {
      const last = tabs.item(tabs.length - 1);
      if (!last || last.dataset.dockTab === undefined) return null;
      return {
        tab: last.dataset.dockTab,
        position: "after",
        element: last,
        revealIn: last.parentElement,
      };
    }
    let header = el?.closest<HTMLElement>("[data-dock-tab]");
    if (header?.parentElement !== rail) header = undefined;
    if (!header) {
      let low = 0;
      let high = tabs.length - 1;
      let nearest = Infinity;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const tab = tabs.item(middle);
        if (!tab) break;
        const bounds = tab.getBoundingClientRect();
        const distance = Math.max(bounds.left - x, x - bounds.right, 0);
        if (distance < nearest) {
          nearest = distance;
          header = tab;
        }
        if (distance === 0) break;
        if (x < bounds.left !== rtl) high = middle - 1;
        else low = middle + 1;
      }
    }
    if (header?.dataset.dockTab === undefined) return null;
    const rect = header.getBoundingClientRect();
    return {
      tab: header.dataset.dockTab,
      position: x < rect.left + rect.width / 2 !== rtl ? "before" : "after",
      element: header,
    };
  }
  const rect = group.getBoundingClientRect(),
    nx = (x - rect.left) / rect.width,
    top = railBounds?.bottom ?? rect.top,
    ny = (y - top) / (rect.bottom - top);
  const nearest = Math.min(nx, 1 - nx, ny, 1 - ny);
  if (nearest >= 0.25) return null;
  let position: DockPosition;
  if (nearest === ny) position = "above";
  else if (nearest === 1 - ny) position = "below";
  else position = (nearest === nx) !== rtl ? "start" : "end";
  const tab = group.dataset.activeTab;
  if (tab === undefined) return null;
  return {
    tab,
    position,
    element: group,
  };
}

function PanelContent({
  panel,
  layout,
  root,
}: {
  panel: DockPanel;
  layout: DockLayout;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const elementRef = React.useRef<HTMLDivElement | null>(null);
  const scrollPositions = React.useRef(new Map<Element, ScrollToOptions>());
  const slotPosition = React.useRef<ScrollToOptions | null>(null);
  const restoreScroll = React.useRef(false);
  const [host, setHost] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => () => elementRef.current?.remove(), []);
  React.useLayoutEffect(() => {
    const slot = ownedElement(
      root.current,
      `[data-dock-slot="${CSS.escape(panel.id)}"]`,
    );
    if (!slot || (!host && slot.hidden)) return;
    const element = (elementRef.current ??=
      slot.ownerDocument.createElement("div"));
    if (element.parentElement !== slot) {
      slot.appendChild(element);
      restoreScroll.current = true;
    }
    const positions = scrollPositions.current;
    if (restoreScroll.current && !slot.hidden) {
      for (const [target, offset] of positions) {
        if (element.contains(target)) target.scrollTo(offset);
        else positions.delete(target);
      }
      if (slotPosition.current) slot.scrollTo(slotPosition.current);
      restoreScroll.current = false;
    }
    const ElementCtor = slot.ownerDocument.defaultView?.Element;
    const remember = (event: Event) => {
      const target = event.target;
      if (!ElementCtor || !(target instanceof ElementCtor) || slot.hidden)
        return;
      const offset = {
        left: target.scrollLeft,
        top: target.scrollTop,
        behavior: "instant" as const,
      };
      if (target === slot) slotPosition.current = offset;
      else if (offset.left || offset.top) {
        if (!positions.has(target)) {
          for (const previous of positions.keys()) {
            if (!element.contains(previous)) positions.delete(previous);
          }
        }
        positions.set(target, offset);
      } else positions.delete(target);
    };
    slot.addEventListener("scroll", remember, true);
    if (!host) setHost(element);
    return () => slot.removeEventListener("scroll", remember, true);
  }, [layout, root, host, panel.id]);
  return host ? createPortal(panel.content, host) : null;
}

interface DockFocusProps {
  root: React.RefObject<HTMLDivElement | null>;
  layout: DockLayout;
  children: React.ReactNode;
}
type DockFocusSnapshot = {
  element: HTMLElement;
  panel: string;
  group: string;
} | null;

class DockFocus extends React.Component<
  DockFocusProps,
  unknown,
  DockFocusSnapshot
> {
  override getSnapshotBeforeUpdate(
    previous: DockFocusProps,
  ): DockFocusSnapshot {
    const root = this.props.root.current;
    if (previous.layout === this.props.layout || !root) return null;
    const element = (root.getRootNode() as Document | ShadowRoot).activeElement;
    const HTMLElementCtor = root.ownerDocument.defaultView?.HTMLElement;
    if (
      !HTMLElementCtor ||
      !(element instanceof HTMLElementCtor) ||
      !root.contains(element)
    )
      return null;
    let owner = element.closest<HTMLElement>(
      "[data-dock-slot], [data-dock-tab]",
    );
    while (owner && owner.closest(".dock-workspace") !== root) {
      owner =
        owner
          .closest(".dock-workspace")
          ?.parentElement?.closest<HTMLElement>(
            "[data-dock-slot], [data-dock-tab]",
          ) ?? null;
    }
    const panel = owner?.dataset.dockSlot ?? owner?.dataset.dockTab;
    const group =
      owner?.closest<HTMLElement>("[data-dock-group]")?.dataset.dockGroup;
    return panel === undefined || group === undefined
      ? null
      : { element, panel, group };
  }

  override componentDidUpdate(
    _previous: DockFocusProps,
    _state: unknown,
    snapshot: DockFocusSnapshot,
  ) {
    const root = this.props.root.current;
    if (
      !snapshot ||
      !root ||
      root.ownerDocument.activeElement !== root.ownerDocument.body
    )
      return;
    if (
      root.contains(snapshot.element) &&
      !snapshot.element.closest("[hidden], [inert]")
    ) {
      snapshot.element.focus({ preventScroll: true });
      return;
    }
    const tab = ownedElement(
      root,
      `[data-dock-tab="${CSS.escape(snapshot.panel)}"]`,
    );
    const group =
      tab?.closest<HTMLElement>("[data-dock-group]") ??
      ownedElement(root, `[data-dock-group="${CSS.escape(snapshot.group)}"]`);
    const activeId = group?.dataset.activeTab;
    const activeTab =
      activeId === undefined
        ? undefined
        : ownedElement(root, `[data-dock-tab="${CSS.escape(activeId)}"]`);
    (activeTab ?? root).focus({ preventScroll: true });
  }

  override render() {
    return this.props.children;
  }
}

/** Controlled, serializable tab groups and resizable splits. */
export function DockWorkspace({
  panels,
  layout,
  onLayoutChange,
  label,
  onReset,
  className,
  style,
  labels,
  step = 8,
  snapToStep = false,
}: DockWorkspaceProps) {
  const text = { ...defaultLabels, ...labels };
  const root = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    id: number;
    tab: string;
    x: number;
    y: number;
    mode: "pending" | "pan" | "dock";
    panRail: {
      element: HTMLElement;
      startX: number;
      startScroll: number;
    } | null;
  } | null>(null);
  const pendingFrame = React.useRef<number | null>(null);
  const focus = React.useRef<{
    tab: string;
    group: DockGroup;
    fromMenu: boolean;
  } | null>(null);
  const menuMovedTab = React.useRef(false);
  const suppressClick = React.useRef(false);
  const preview = React.useRef<DropTarget | null>(null);
  const paintedPoint = React.useRef<{ x: number; y: number } | null>(null);
  function showPreview(next: DropTarget | null) {
    if (next?.revealIn && next.revealIn.scrollWidth > next.revealIn.clientWidth)
      revealDockTab(next.revealIn, next.element);
    const previous = preview.current;
    if (
      previous?.tab === next?.tab &&
      previous?.element === next?.element &&
      previous?.position === next?.position
    )
      return;
    if (previous) {
      delete previous.element.dataset.dockDrop;
      delete previous.element.dataset.dockInsert;
    }
    if (next) {
      const insertion = next.position === "before" || next.position === "after";
      next.element.dataset[insertion ? "dockInsert" : "dockDrop"] =
        next.position;
    }
    preview.current = next;
  }
  const byId = React.useMemo(
    () => new Map(panels.map((p) => [p.id, p])),
    [panels],
  );
  const groups = React.useMemo(() => {
    if (
      !isDockLayout(
        layout,
        panels.map((p) => p.id),
      )
    )
      throw new Error(
        "Dock layout must contain every registered panel exactly once.",
      );
    return dockLeaves(layout);
  }, [layout, panels]);
  const panelLeaves = React.useMemo(() => {
    const map = new Map<string, DockLeaf>();
    for (const leaf of groups) {
      if (leaf.type === "surface") map.set(leaf.panel, leaf);
      else for (const tab of leaf.tabs) map.set(tab, leaf);
    }
    return map;
  }, [groups]);
  function allowedTarget(tab: string, hit: DropTarget | null) {
    if (!hit) return null;
    const source = panelLeaves.get(tab),
      destination = panelLeaves.get(hit.tab);
    return source &&
      destination &&
      canPlaceDockTab(source, tab, destination, hit.tab, hit.position)
      ? hit
      : null;
  }
  const name = (id: string) => byId.get(id)?.label ?? id;
  function cancel() {
    if (drag.current && drag.current.mode !== "pending")
      suppressClick.current = true;
    if (pendingFrame.current !== null)
      root.current?.ownerDocument.defaultView?.cancelAnimationFrame(
        pendingFrame.current,
      );
    pendingFrame.current = null;
    drag.current = null;
    paintedPoint.current = null;
    showPreview(null);
  }
  function cancelPointer(event: React.PointerEvent) {
    if (event.pointerId === drag.current?.id) cancel();
  }
  React.useEffect(() => {
    const win = root.current?.ownerDocument.defaultView;
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        cancel();
      }
    }
    function cancelOnPinch(e: PointerEvent) {
      if (drag.current && e.pointerType === "touch" && !e.isPrimary) cancel();
    }
    win?.addEventListener("pointerdown", cancelOnPinch, true);
    win?.addEventListener("keydown", escape);
    win?.addEventListener("blur", cancel);
    return () => {
      win?.removeEventListener("pointerdown", cancelOnPinch, true);
      win?.removeEventListener("keydown", escape);
      win?.removeEventListener("blur", cancel);
      if (pendingFrame.current !== null)
        win?.cancelAnimationFrame(pendingFrame.current);
    };
  }, []);
  React.useLayoutEffect(() => {
    const pending = focus.current;
    focus.current = null;
    if (!pending) return;
    const group = panelLeaves.get(pending.tab);
    if (
      group?.type === "group" &&
      group.id === pending.group.id &&
      group.active === pending.tab &&
      group.tabs.indexOf(pending.tab) ===
        pending.group.tabs.indexOf(pending.tab)
    ) {
      if (pending.fromMenu) menuMovedTab.current = true;
      const tab = ownedElement(
        root.current,
        `[data-dock-tab="${CSS.escape(pending.tab)}"]`,
      );
      if (tab) {
        tab.focus({ preventScroll: true });
        const list = tab.closest<HTMLElement>('[role="tablist"]');
        if (list) revealDockTab(list, tab);
      }
    }
  }, [panelLeaves]);
  function move(tab: string, target: Target, fromMenu = false) {
    const increment = snapToStep && step > 0 ? step : 1;
    const next = moveDockTab(
      layout,
      tab,
      target.tab,
      target.position,
      Math.round(target.size / increment) * increment,
    );
    if (next !== layout) {
      const group = dockLeaves(next).find(
        (leaf): leaf is DockGroup =>
          leaf.type === "group" && leaf.tabs.includes(tab),
      );
      if (group) focus.current = { tab, group, fromMenu };
      onLayoutChange(next);
    }
  }
  function command(
    group: DockGroup,
    dest: DockLeaf,
    tab: string,
    position: DockPosition,
  ) {
    const element =
      root.current &&
      ownedElement(root.current, `[data-dock-group="${CSS.escape(dest.id)}"]`);
    move(
      group.active,
      {
        tab,
        position,
        size: element ? splitSize(element, position) : 280,
      },
      true,
    );
  }
  function renderNode(node: DockLayout): React.ReactNode {
    if (node.type === "split") {
      const start = node.side === "start";
      return (
        <SplitPane
          className="dock-workspace-split"
          key={node.id}
          axis={node.axis}
          side={node.side}
          size={node.size}
          step={step}
          snapToStep={snapToStep}
          label={text.resize(
            dockLeaves(start ? node.first : node.second)
              .map((g) => name(dockLeafPanel(g)))
              .join(", "),
          )}
          minSize={dockMinimum(start ? node.first : node.second, node.axis)}
          minContentSize={dockMinimum(
            start ? node.second : node.first,
            node.axis,
          )}
          onSizeChange={(size, { phase }) => {
            if (phase === "commit")
              onLayoutChange(
                updateDockNode(layout, node.id, (n) =>
                  n.type === "split" ? { ...n, size } : n,
                ),
              );
          }}
          pane={renderNode(start ? node.first : node.second)}
        >
          {renderNode(start ? node.second : node.first)}
        </SplitPane>
      );
    }
    if (node.type === "surface")
      return (
        <div
          key={node.id}
          className="dock-workspace-surface"
          data-dock-group={node.id}
          data-active-tab={node.panel}
          data-dock-slot={node.panel}
        />
      );
    const index = node.tabs.indexOf(node.active);
    return (
      <Tabs
        key={node.id}
        className="dock-workspace-group"
        variant="framed"
        data-dock-group={node.id}
        data-active-tab={node.active}
        value={node.active}
        onValueChange={(value) => {
          if (typeof value === "string" && value !== node.active)
            onLayoutChange(
              updateDockNode(layout, node.id, () => ({
                ...node,
                active: value,
              })),
            );
        }}
      >
        <DockTabList tabs={node.tabs} label={node.tabs.map(name).join(", ")}>
          {node.tabs.map((tab) => (
            <TabsTab
              key={tab}
              value={tab}
              title={name(tab)}
              data-dock-tab={tab}
              onPointerDown={(e) => {
                if (drag.current || e.button !== 0 || !e.isPrimary) return;
                suppressClick.current = false;
                const rail = e.currentTarget.parentElement;
                drag.current = {
                  tab,
                  id: e.pointerId,
                  x: e.clientX,
                  y: e.clientY,
                  mode: "pending",
                  panRail:
                    e.pointerType === "touch" &&
                    rail?.hasAttribute("data-overflowing")
                      ? {
                          element: rail,
                          startX: e.clientX,
                          startScroll: rail.scrollLeft,
                        }
                      : null,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onLostPointerCapture={cancelPointer}
            >
              <span>{name(tab)}</span>
            </TabsTab>
          ))}
        </DockTabList>
        {(panels.length > 1 || onReset) && (
          <div className="dock-workspace-actions">
            <Menu
              onOpenChange={(open) => {
                if (open) menuMovedTab.current = false;
              }}
            >
              <MenuTrigger
                render={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    aria-label={text.arrange(name(node.active))}
                  />
                }
              >
                <IconDots />
              </MenuTrigger>
              <MenuPopup finalFocus={() => !menuMovedTab.current}>
                {index > 0 && (
                  <MenuItem
                    onClick={() =>
                      command(
                        node,
                        node,
                        requireItem(node.tabs, index - 1),
                        "before",
                      )
                    }
                  >
                    {text.earlier}
                  </MenuItem>
                )}
                {index < node.tabs.length - 1 && (
                  <MenuItem
                    onClick={() =>
                      command(
                        node,
                        node,
                        requireItem(node.tabs, index + 1),
                        "after",
                      )
                    }
                  >
                    {text.later}
                  </MenuItem>
                )}
                {groups
                  .filter((g) => g !== node || node.tabs.length > 1)
                  .map((dest) => (
                    <MenuSubmenuRoot key={dest.id}>
                      <MenuSubmenuTrigger>
                        {dest === node ? text.split : name(dockLeafPanel(dest))}
                      </MenuSubmenuTrigger>
                      <MenuSubmenuPopup>
                        {dest !== node && dest.type === "group" && (
                          <MenuItem
                            onClick={() =>
                              command(node, dest, dest.active, "center")
                            }
                          >
                            {text.join}
                          </MenuItem>
                        )}
                        {(Object.keys(edges) as Edge[]).map((pos) => (
                          <MenuItem
                            key={pos}
                            onClick={() =>
                              command(node, dest, dockLeafPanel(dest), pos)
                            }
                          >
                            {text[pos]}
                          </MenuItem>
                        ))}
                      </MenuSubmenuPopup>
                    </MenuSubmenuRoot>
                  ))}
                {onReset && <MenuItem onClick={onReset}>{text.reset}</MenuItem>}
              </MenuPopup>
            </Menu>
          </div>
        )}
        {node.tabs.map((tab) => (
          <TabsPanel key={tab} value={tab} keepMounted data-dock-slot={tab} />
        ))}
      </Tabs>
    );
  }
  return (
    <DockFocus root={root} layout={layout}>
      <div
        className={["dock-workspace", className].filter(Boolean).join(" ")}
        style={style}
        ref={root}
        role="region"
        tabIndex={-1}
        aria-label={label}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const el = e.currentTarget;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (d.mode === "pending") {
            if (Math.hypot(dx, dy) < 5) return;
            d.mode = d.panRail && Math.abs(dx) > Math.abs(dy) ? "pan" : "dock";
          }
          d.x = e.clientX;
          d.y = e.clientY;
          if (d.mode === "pan" && d.panRail) {
            const { element: rail, startX, startScroll } = d.panRail;
            const rect = railRectAt(rail, d.x, d.y);
            if (rect) {
              rail.scrollLeft =
                startScroll - ((d.x - startX) * rail.offsetWidth) / rect.width;
              return;
            }
            d.mode = "dock";
          }
          const win = el.ownerDocument.defaultView;
          if (!win || pendingFrame.current !== null) return;
          const scope = el.getRootNode() as Document | ShadowRoot;
          let lastFrame = win.performance.now();
          const paint = (time: number) => {
            pendingFrame.current = null;
            if (drag.current !== d) return;
            let hit = scope.elementFromPoint(d.x, d.y);
            if (
              scrollDockRail(
                el,
                hit,
                d.x,
                Math.min(32, Math.max(0, time - lastFrame)),
              )
            ) {
              hit = scope.elementFromPoint(d.x, d.y);
              lastFrame = time;
              pendingFrame.current = win.requestAnimationFrame(paint);
            }
            paintedPoint.current = { x: d.x, y: d.y };
            showPreview(allowedTarget(d.tab, dropTarget(el, hit, d.x, d.y)));
          };
          pendingFrame.current = win.requestAnimationFrame(paint);
        }}
        onPointerCancel={cancelPointer}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          if (
            d.mode === "dock" ||
            (d.mode === "pan" &&
              d.panRail &&
              !railRectAt(d.panRail.element, e.clientX, e.clientY))
          ) {
            suppressClick.current = true;
            const scope = e.currentTarget.getRootNode() as
              | Document
              | ShadowRoot;
            const release = scope.elementFromPoint(e.clientX, e.clientY);
            const current = dropTarget(
              e.currentTarget,
              release,
              e.clientX,
              e.clientY,
            );
            const shown = preview.current;
            const point = paintedPoint.current;
            let target = current;
            if (
              point &&
              shown &&
              current?.element === shown.element &&
              current.tab === shown.tab
            ) {
              const previous = dropTarget(
                e.currentTarget,
                scope.elementFromPoint(point.x, point.y),
                point.x,
                point.y,
              );
              if (
                previous?.element === shown.element &&
                previous.tab === shown.tab &&
                previous.position === shown.position
              )
                target = shown;
            }
            const accepted = allowedTarget(d.tab, target);
            if (accepted)
              move(d.tab, {
                tab: accepted.tab,
                position: accepted.position,
                size: splitSize(accepted.element, accepted.position),
              });
          }
          cancel();
        }}
        onClickCapture={(e) => {
          if (suppressClick.current && e.detail > 0) {
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onPointerDownCapture={(e) => {
          if (e.isPrimary) suppressClick.current = false;
        }}
      >
        {renderNode(layout)}
      </div>
      {panels.map((panel) => (
        <PanelContent
          key={panel.id}
          panel={panel}
          root={root}
          layout={layout}
        />
      ))}
    </DockFocus>
  );
}
