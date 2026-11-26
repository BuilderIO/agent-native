import {
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
} from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";
import { isComposingKey } from "../is-composing-key.js";
import { IconButton } from "./button.js";
import { useControlledValue } from "./controlled-value.js";
import { indexedItem, requireItem } from "./indexed-item.js";
import { Input } from "./input.js";
import {
  selectedAncestorLookup,
  indexLayers,
  visibleLayers,
  createLayerMovePlanner,
  createSiblingMoveTarget,
  planLayerMove,
  resolveLayerMove,
  type LayerRecord,
  type LayerMove,
  type LayerPlacement,
} from "./layer-tree-model.js";
import { activeElementInRoot, surfaceTarget } from "./surface-target.js";

export type {
  LayerRecord,
  LayerMove,
  LayerPlacement,
} from "./layer-tree-model.js";
export type LayerAction =
  | "expand"
  | "collapse"
  | "rename"
  | "show"
  | "hide"
  | "lock"
  | "unlock";
export type LayerMoveDirection = "up" | "down" | "in" | "out";
export interface LayerRowCommands {
  rename: () => void;
  canRename: boolean;
  canMove: (direction: LayerMoveDirection) => boolean;
  move: (direction: LayerMoveDirection) => void;
  tabIndex: number;
}
export interface LayerTreeProps<T extends LayerRecord> extends Omit<
  React.ComponentPropsWithRef<"div">,
  "children" | "onChange"
> {
  /** Opt into a scrollable, windowed tree of uniformly sized rows. Height is in CSS pixels.
   * Set --layer-tree-row-height to change the row size across themes. */
  viewportHeight?: number;
  /** On mount focus the selected visible row, or the first row when none is selected. */
  autoFocus?: boolean;
  items: readonly T[];
  onItemsChange: (items: T[]) => void;
  selection?: readonly string[];
  defaultSelection?: readonly string[];
  onSelectionChange?: (ids: readonly string[]) => void;
  expanded?: readonly string[];
  defaultExpanded?: readonly string[];
  onExpandedChange?: (ids: readonly string[]) => void;
  /** Accessible row name. Defaults to the visible layer name. */
  getItemLabel?: (item: T) => string;
  getActionLabel: (action: LayerAction, item: T) => string;
  renderIcon?: (item: T) => React.ReactNode;
  renderLabel?: (item: T) => React.ReactNode;
  renderActions?: (item: T, commands: LayerRowCommands) => React.ReactNode;
}

const windowStep = 4;
const overscan = 3;
const emptySelection: ReadonlySet<string> = new Set();
const arrowMoves = new Map<string, LayerMoveDirection>([
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowRight", "in"],
  ["ArrowLeft", "out"],
]);

/** A controlled document hierarchy. Each item has a stable id. Slots supply
 * document-specific icons, labels and supplementary row actions.
 * @import import { LayerTree } from "@agent-native/toolkit/ui/base-ui/layer-tree";
 */
export function LayerTree<T extends LayerRecord>({
  items,
  viewportHeight,
  autoFocus,
  onItemsChange,
  selection,
  defaultSelection = [],
  onSelectionChange,
  expanded,
  defaultExpanded = [],
  onExpandedChange,
  getItemLabel,
  getActionLabel,
  renderIcon,
  renderLabel,
  renderActions,
  className,
  ref,
  ...props
}: LayerTreeProps<T>) {
  const index = React.useMemo(() => indexLayers(items), [items]);
  const [selected, setSelected] = useControlledValue(
    selection,
    defaultSelection,
    onSelectionChange,
  );
  const [opened, setOpened] = useControlledValue(
    expanded,
    defaultExpanded,
    onExpandedChange,
  );
  const open = React.useMemo(() => new Set(opened), [opened]);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const windowed = viewportHeight !== undefined;
  const indexedSelection = windowed ? emptySelection : selectedSet;
  const hasSelectedAncestor = React.useMemo(() => {
    if (!windowed || !selectedSet.size) return undefined;
    return selectedAncestorLookup(index, selectedSet);
  }, [windowed, selectedSet, index]);
  const rows = React.useMemo(
    () => visibleLayers(index, open, indexedSelection),
    [index, open, indexedSelection],
  );
  const searchName = React.useMemo(() => {
    const names: string[] = [];
    return (position: number) =>
      (names[position] ??= requireItem(rows, position)
        .item.name.normalize()
        .toLocaleLowerCase());
  }, [rows]);
  const [active, setActive] = React.useState<string | null>(null);
  const anchor = React.useRef<string | null>(null);
  const tree = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(
    ref,
    () => tree.current,
    [],
  );
  const focusedRow = React.useRef<HTMLDivElement | null>(null);
  const focusedPosition = React.useRef<{ id: string; index: number } | null>(
    null,
  );
  const detachedFocus = React.useRef<{ id: string; position: number } | null>(
    null,
  );
  const elements = React.useRef(new Map<string, HTMLDivElement>());
  const [editing, setEditing] = React.useState<string | null>(null);
  const dragSource = React.useRef<string | null>(null);
  const [dragging, setDragging] = React.useState<readonly string[]>([]);
  const [candidate, setDrop] = React.useState<{
    index: typeof index;
    id: string;
    placement: LayerPlacement;
  } | null>(null);
  const siblingMoveTarget = React.useMemo(
    () => createSiblingMoveTarget(index, selectedSet),
    [index, selectedSet],
  );
  const planSelectionMove = React.useMemo(
    () => createLayerMovePlanner(index, selectedSet),
    [index, selectedSet],
  );
  const planDrop = React.useMemo(
    () => createLayerMovePlanner(index, dragging),
    [index, dragging],
  );
  const drop = React.useMemo(() => {
    if (!candidate || candidate.index === index) return candidate;
    return planDrop(candidate.id, candidate.placement) ? candidate : null;
  }, [candidate, index, planDrop]);
  const search = React.useRef({ prefix: "", at: 0 });
  const rowMeasure = React.useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = React.useState(32);
  const [windowAnchor, setWindowAnchor] = React.useState(0);
  const latestAnchor = React.useRef(0);
  const updateWindow = React.useCallback((offset: number, height: number) => {
    const next = Math.max(
      0,
      Math.floor(offset / (height * windowStep)) * windowStep,
    );
    if (next !== latestAnchor.current) {
      latestAnchor.current = next;
      setWindowAnchor(next);
    }
  }, []);
  const pendingFocus = React.useRef<string | null>(null);
  const rowIndices = React.useMemo(
    () => new Map(rows.map((row, i) => [row.item.id, i])),
    [rows],
  );
  React.useLayoutEffect(() => {
    const previous = focusedPosition.current;
    if (!previous) return;
    const position = rowIndices.get(previous.id);
    if (position === undefined || position === previous.index) return;
    focusedPosition.current = { id: previous.id, index: position };
    const row = elements.current.get(previous.id);
    if (row?.contains(activeElementInRoot(row)))
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [rowIndices]);
  React.useLayoutEffect(() => {
    const probe = rowMeasure.current;
    if (!probe) return;
    function measure() {
      const height = probe
        ? Number.parseFloat(getComputedStyle(probe).height)
        : 0;
      if (height > 0) {
        setRowHeight(height);
        updateWindow(tree.current?.scrollTop ?? 0, height);
      }
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [windowed, updateWindow]);
  const focusId = React.useMemo(() => {
    if (active !== null && rowIndices.has(active)) return active;
    let first = Infinity;
    for (const id of selectedSet) {
      const i = rowIndices.get(id);
      if (i !== undefined && i < first) first = i;
      if (first === 0) break;
    }
    return indexedItem(rows, first === Infinity ? 0 : first)?.item.id;
  }, [active, rowIndices, rows, selectedSet]);
  const focusOnMount = React.useRef(autoFocus);
  const focusedEmptyTree = React.useRef(false);
  React.useLayoutEffect(() => {
    if (dragSource.current !== null && !rowIndices.has(dragSource.current))
      endDrag();
    const detached = detachedFocus.current;
    detachedFocus.current = null;
    const root = tree.current;
    if (focusedRow.current && !focusedRow.current.isConnected)
      focusedRow.current = null;
    if (editing !== null) {
      const position = rowIndices.get(editing);
      const row =
        position === undefined ? undefined : requireItem(rows, position);
      if (!row || row.locked || row.item.fixed) {
        setEditing(null);
        if (
          position !== undefined &&
          root &&
          elements.current.get(editing)?.contains(activeElementInRoot(root))
        ) {
          pendingFocus.current = editing;
          return;
        }
      }
    }
    if (
      root &&
      detached &&
      !rowIndices.has(detached.id) &&
      root.ownerDocument.activeElement === root.ownerDocument.body
    ) {
      let parent = index.byId.get(detached.id)?.parentId;
      while (parent != null && !rowIndices.has(parent))
        parent = index.byId.get(parent)?.parentId;
      const next =
        parent ?? rows[Math.min(detached.position, rows.length - 1)]?.item.id;
      if (next) focus(next);
      else {
        focusedRow.current = null;
        focusedEmptyTree.current = true;
        root.focus();
      }
      return;
    }
    const id =
      pendingFocus.current ??
      (focusOnMount.current ||
      (focusedEmptyTree.current && root && activeElementInRoot(root) === root)
        ? focusId
        : undefined);
    focusOnMount.current = false;
    if (rows.length) focusedEmptyTree.current = false;
    if (id) elements.current.get(id)?.focus();
    pendingFocus.current = null;
  });
  function focus(id: string) {
    setActive(id);
    const mounted = elements.current.get(id);
    if (mounted) {
      mounted.focus();
      return;
    }
    pendingFocus.current = id;
    const root = tree.current;
    const position = rowIndices.get(id);
    if (windowed && root && position !== undefined) {
      const top = position * rowHeight;
      const bottom = top + rowHeight;
      const offset = root.scrollTop;
      const height = root.clientHeight;
      if (top < offset || bottom > offset + height) {
        root.scrollTop = top < offset ? top : bottom - height;
        updateWindow(root.scrollTop, rowHeight);
      }
    }
  }
  function toggle(id: string) {
    setOpened(open.has(id) ? opened.filter((v) => v !== id) : [...opened, id]);
  }
  function patch(
    id: string,
    change: Partial<Pick<LayerRecord, "name" | "locked" | "hidden">>,
  ) {
    onItemsChange(items.map((n) => (n.id === id ? { ...n, ...change } : n)));
  }
  function pick(id: string, range: boolean, add: boolean) {
    const to = rowIndices.get(id);
    if (to === undefined) return;
    if (range) {
      let from =
        anchor.current === null ? undefined : rowIndices.get(anchor.current);
      if (from === undefined) {
        anchor.current = focusId ?? id;
        from = rowIndices.get(anchor.current) ?? to;
      }
      const ids: string[] = [];
      const last = Math.max(from, to);
      for (let i = Math.min(from, to); i <= last; i++)
        ids.push(requireItem(rows, i).item.id);
      setSelected(add ? [...new Set([...selected, ...ids])] : ids);
    } else {
      anchor.current = id;
      setSelected(
        add
          ? selectedSet.has(id)
            ? selected.filter((v) => v !== id)
            : [...selected, id]
          : [id],
      );
    }
  }
  function moveIds(id: string) {
    return selectedSet.has(id) ? selected : [id];
  }
  function relativeMove(
    item: T,
    direction: LayerMoveDirection,
  ): LayerMove | null {
    const ids = moveIds(item.id);
    if (direction === "out")
      return item.parentId === null
        ? null
        : { ids, targetId: item.parentId, placement: "after" };
    const step = direction === "up" || direction === "in" ? -1 : 1;
    const target = siblingMoveTarget(item, step);
    if (!target) return null;
    return {
      ids,
      targetId: target.id,
      placement: direction === "in" ? "inside" : step < 0 ? "before" : "after",
    };
  }
  function commitMove(move: LayerMove) {
    const next = resolveLayerMove(index, move);
    if (!next) return;
    if (move.placement === "inside" && !open.has(move.targetId))
      setOpened([...opened, move.targetId]);
    onItemsChange(next);
  }
  function ownsRowClick(event: React.MouseEvent<HTMLDivElement>) {
    return (
      !event.defaultPrevented &&
      surfaceTarget(
        event.currentTarget,
        event.target,
        "[data-layer-actions]",
      ) !== null
    );
  }
  function keyboard(event: React.KeyboardEvent<HTMLDivElement>, i: number) {
    if (
      event.defaultPrevented ||
      event.currentTarget !== event.target ||
      isComposingKey(event)
    )
      return;
    const row = indexedItem(rows, i);
    if (!row) return;
    const { item, locked } = row;
    const id = item.id;
    let key = event.key;
    if (
      (key === "ArrowLeft" || key === "ArrowRight") &&
      event.currentTarget.matches(":dir(rtl)")
    ) {
      key = key === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    }
    const altGraphText =
      event.getModifierState("AltGraph") &&
      /^.$/u.test(key.normalize()) &&
      key !== " ";
    const command = event.metaKey || (event.ctrlKey && !altGraphText);
    if (event.altKey && !altGraphText) {
      const direction = arrowMoves.get(key);
      if (!direction || command || event.shiftKey) return;
      event.preventDefault();
      const move = relativeMove(item, direction);
      if (move) commitMove(move);
      return;
    }
    if (
      (key === "a" || key === "A") &&
      event.ctrlKey !== event.metaKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      search.current.prefix = "";
      anchor.current = id;
      if (
        !event.repeat &&
        (selectedSet.size !== rows.length ||
          selected.some((layer) => !rowIndices.has(layer)))
      )
        setSelected(Array.from(rowIndices.keys()));
      return;
    }
    let next: T | undefined;
    switch (key) {
      case "ArrowDown":
        next = rows[Math.min(rows.length - 1, i + 1)]?.item;
        break;
      case "ArrowUp":
        next = rows[Math.max(0, i - 1)]?.item;
        break;
      case "PageDown":
      case "PageUp": {
        const root = tree.current;
        if (!windowed || !root || command) return;
        const pageRows = Math.max(1, Math.floor(root.clientHeight / rowHeight));
        const offset = key === "PageDown" ? pageRows : -pageRows;
        const target = Math.max(0, Math.min(rows.length - 1, i + offset));
        root.scrollTop += (target - i) * rowHeight;
        updateWindow(root.scrollTop, rowHeight);
        next = rows[target]?.item;
        break;
      }
      case "Home":
        next = rows[0]?.item;
        break;
      case "End":
        next = rows.at(-1)?.item;
        break;
      case "ArrowRight":
        if (item.container && !open.has(id)) toggle(id);
        else next = index.children.get(id)?.[0];
        break;
      case "ArrowLeft":
        if (item.container && open.has(id)) toggle(id);
        else if (item.parentId !== null) next = index.byId.get(item.parentId);
        break;
      case "Enter":
      case " ":
        pick(id, event.shiftKey, command);
        break;
      case "F2":
        if (!locked && !item.fixed) setEditing(id);
        break;
      default: {
        const character = key.normalize();
        if (command || !/^.$/u.test(character)) return;
        const now = performance.now();
        const letter = character.toLocaleLowerCase();
        const previous =
          now - search.current.at < 700 ? search.current.prefix : "";
        const prefix =
          previous === letter ? letter : (previous + letter).normalize();
        search.current = { at: now, prefix };
        const start = previous && previous !== letter ? i : i + 1;
        for (let step = 0; step < rows.length; step++) {
          const position = (start + step) % rows.length;
          if (searchName(position).startsWith(prefix)) {
            focus(requireItem(rows, position).item.id);
            break;
          }
        }
        event.preventDefault();
        return;
      }
    }
    search.current.prefix = "";
    event.preventDefault();
    if (next) {
      if (event.shiftKey) pick(next.id, true, command);
      focus(next.id);
    }
  }
  function placement(event: React.DragEvent, item: T): LayerPlacement {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    return item.container && ratio >= 0.25 && ratio <= 0.75
      ? "inside"
      : ratio < 0.5
        ? "before"
        : "after";
  }
  function endDrag() {
    dragSource.current = null;
    setDragging([]);
    setDrop(null);
  }
  const maxScroll = Math.max(
    0,
    rows.length * rowHeight - (viewportHeight ?? 0),
  );
  const start = Math.max(
    0,
    Math.min(windowAnchor, Math.floor(maxScroll / rowHeight)) - overscan,
  );
  const end = Math.min(
    rows.length,
    start +
      Math.ceil((viewportHeight ?? 0) / rowHeight) +
      2 * overscan +
      windowStep,
  );
  const inView = windowed
    ? Array.from({ length: end - start }, (_, n) => start + n)
    : [];
  if (windowed) {
    for (const id of [focusId, editing, dragSource.current]) {
      const i = id == null ? undefined : rowIndices.get(id);
      if (i !== undefined && !inView.includes(i)) inView.push(i);
    }
    inView.sort((a, b) => a - b);
  }
  return (
    <div
      {...props}
      ref={tree}
      tabIndex={
        props.tabIndex ??
        (!rows.length || focusedEmptyTree.current ? -1 : undefined)
      }
      data-windowed={windowed || undefined}
      style={
        windowed ? { ...props.style, height: viewportHeight } : props.style
      }
      onScroll={
        windowed
          ? (event) => {
              updateWindow(event.currentTarget.scrollTop, rowHeight);
              props.onScroll?.(event);
            }
          : props.onScroll
      }
      role="tree"
      aria-multiselectable="true"
      className={cn("layer-tree", className)}
      onDragLeave={(event) => {
        props.onDragLeave?.(event);
        if (
          !event.currentTarget.contains(
            event.relatedTarget instanceof Node ? event.relatedTarget : null,
          )
        )
          setDrop(null);
      }}
    >
      {windowed && (
        <div ref={rowMeasure} className="layer-tree-measure" aria-hidden />
      )}
      {windowed && (
        <div aria-hidden style={{ height: rows.length * rowHeight }} />
      )}
      {Array.from(windowed ? inView : rows.keys(), (i) => {
        const {
          item,
          depth,
          position,
          count,
          locked,
          parentLocked,
          selectedAncestor,
        } = requireItem(rows, i);
        const id = item.id;
        const edit = editing === id;
        const tab = focusId === id ? 0 : -1;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) elements.current.set(id, el);
              else {
                const node = elements.current.get(id);
                if (
                  node &&
                  focusedRow.current === node &&
                  node.contains(activeElementInRoot(node))
                )
                  detachedFocus.current = { id, position: i };
                elements.current.delete(id);
              }
            }}
            role="treeitem"
            tabIndex={tab}
            aria-label={getItemLabel?.(item) ?? item.name}
            aria-level={depth + 1}
            aria-posinset={position}
            aria-setsize={count}
            aria-selected={selectedSet.has(id)}
            aria-expanded={item.container ? open.has(id) : undefined}
            data-in-selection={
              (hasSelectedAncestor?.(item) ?? selectedAncestor) || undefined
            }
            data-hidden={item.hidden || undefined}
            data-drop={drop?.id === id ? drop.placement : undefined}
            className="layer-tree-row"
            style={
              {
                "--layer-depth": depth,
                top: windowed ? i * rowHeight : undefined,
              } as React.CSSProperties
            }
            onKeyDown={(e) => keyboard(e, i)}
            onFocus={(event) => {
              focusedRow.current = event.currentTarget;
              focusedPosition.current = { id, index: i };
              setActive(id);
            }}
            onClick={(e) => {
              if (!ownsRowClick(e)) return;
              focus(id);
              pick(id, e.shiftKey, e.ctrlKey || e.metaKey);
            }}
            onDoubleClick={(e) => {
              if (!locked && !item.fixed && ownsRowClick(e)) setEditing(id);
            }}
            draggable={!item.fixed && !locked && !edit}
            onDragStart={(e) => {
              if (e.target !== e.currentTarget || e.defaultPrevented) return;
              const ids = moveIds(id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.name);
              dragSource.current = id;
              setDragging(ids);
              if (!selectedSet.has(id)) pick(id, false, false);
            }}
            onDragEnd={(e) => {
              if (e.target === e.currentTarget) endDrag();
            }}
            onDragOver={(e) => {
              if (!dragging.length) return;
              const p = placement(e, item);
              if (drop?.id === id && drop.placement === p) {
                e.preventDefault();
                return;
              }
              if (!planDrop(id, p)) {
                setDrop(null);
                return;
              }
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDrop({ index, id, placement: p });
            }}
            onDrop={(e) => {
              if (!dragging.length) return;
              e.preventDefault();
              commitMove({
                ids: dragging,
                targetId: id,
                placement: placement(e, item),
              });
              endDrag();
            }}
          >
            <span className="layer-tree-disclosure">
              {item.container && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={getActionLabel(
                    open.has(id) ? "collapse" : "expand",
                    item,
                  )}
                  onClick={() => {
                    focus(id);
                    toggle(id);
                  }}
                >
                  <IconChevronRight aria-hidden />
                </button>
              )}
            </span>
            {renderIcon && (
              <span className="layer-tree-icon" aria-hidden>
                {renderIcon(item)}
              </span>
            )}
            {edit ? (
              <NameEditor
                item={item}
                label={getActionLabel("rename", item)}
                finish={(value, restore) => {
                  setEditing(null);
                  if (value && value !== item.name) patch(id, { name: value });
                  if (restore) focus(id);
                }}
              />
            ) : (
              <span className="layer-tree-label" title={item.name}>
                {renderLabel?.(item) ?? <bdi>{item.name}</bdi>}
              </span>
            )}
            {!edit && (
              <span className="layer-tree-actions" data-layer-actions="">
                {renderActions?.(item, {
                  tabIndex: tab,
                  canRename: !item.fixed && !locked,
                  rename: () => {
                    if (!item.fixed && !locked) setEditing(id);
                  },
                  canMove: (direction) => {
                    const move = relativeMove(item, direction);
                    if (!move) return false;
                    return move.ids === selected
                      ? planSelectionMove(move.targetId, move.placement) !==
                          null
                      : planLayerMove(index, move) !== null;
                  },
                  move: (direction) => {
                    const move = relativeMove(item, direction);
                    if (move) commitMove(move);
                  },
                })}
                {!item.fixed && (
                  <IconButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    color="gray"
                    tabIndex={tab}
                    aria-label={getActionLabel(
                      item.hidden ? "show" : "hide",
                      item,
                    )}
                    data-persistent={item.hidden || undefined}
                    onClick={() => patch(id, { hidden: !item.hidden })}
                  >
                    {item.hidden ? (
                      <IconEyeOff aria-hidden />
                    ) : (
                      <IconEye aria-hidden />
                    )}
                  </IconButton>
                )}
                {!item.fixed && (
                  <IconButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    color="gray"
                    tabIndex={tab}
                    aria-label={getActionLabel(
                      locked ? "unlock" : "lock",
                      item,
                    )}
                    disabled={parentLocked}
                    data-persistent={locked || undefined}
                    onClick={() => patch(id, { locked: !item.locked })}
                  >
                    {locked ? (
                      <IconLock aria-hidden />
                    ) : (
                      <IconLockOpen aria-hidden />
                    )}
                  </IconButton>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NameEditor({
  item,
  label,
  finish,
}: {
  item: LayerRecord;
  label: string;
  finish: (name: string | null, restore: boolean) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const finished = React.useRef(false);
  function done(save: boolean, restore: boolean) {
    if (!finished.current) {
      finished.current = true;
      finish(save && draft !== null ? draft.trim() : null, restore);
    }
  }
  return (
    <Input
      aria-label={label}
      dir="auto"
      size="sm"
      autoFocus
      value={draft ?? item.name}
      onFocus={(e) => e.target.select()}
      onChange={(e) =>
        setDraft(e.target.value === item.name ? null : e.target.value)
      }
      onBlur={() => done(true, false)}
      onKeyDown={(e) => {
        if (e.defaultPrevented || isComposingKey(e)) return;
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          done(e.key === "Enter", true);
        }
      }}
    />
  );
}
