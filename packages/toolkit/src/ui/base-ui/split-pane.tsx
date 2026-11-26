import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { isComposingKey } from "../is-composing-key.js";
import { useControlledValue } from "./controlled-value.js";
import { partClassName } from "./part-class.js";

export type SplitPanePhase = "preview" | "commit" | "cancel";
type PaneMinimum = number | ((separatorSize: number) => number);
export interface SplitPaneProps extends Omit<
  useRender.ComponentProps<"div">,
  "onChange"
> {
  pane: React.ReactNode;
  /** Accessible name of the focusable window splitter. */
  label: string;
  axis?: "inline" | "block";
  side?: "start" | "end";
  /** Size of the adjustable pane in CSS pixels. Zero is collapsed when collapsible. */
  size?: number;
  defaultSize?: number;
  /** Minimum in CSS pixels, optionally derived from the measured separator thickness. */
  minSize?: PaneMinimum;
  maxSize?: number;
  minContentSize?: PaneMinimum;
  collapsible?: boolean;
  /** Disable resizing while keeping both panes available. */
  disabled?: boolean;
  step?: number;
  /** Snap pointer resizing to the same increment as keyboard resizing. */
  snapToStep?: boolean;
  /** Preview is delivered at most once per animation frame. Persist only committed sizes. */
  onSizeChange?: (next: number, detail: { phase: SplitPanePhase }) => void;
  getValueText?: (size: number) => string;
  handle?: React.ReactNode;
  /** Focus the separator from a command that hides its pane. */
  separatorRef?: React.Ref<HTMLDivElement>;
}
interface Drag {
  window: Window;
  endListening: () => void;
  id: number;
  startSize: number;
  minimum: number;
  maximum: number;
  collapsible: boolean;
  snapStep: number;
  startCoord: number;
  layoutPerClientPixel: number;
  sign: number;
  horizontal: boolean;
  next: number;
  painted: number;
  frame: number | null;
}
function dimensions(axis: "inline" | "block", node: HTMLElement) {
  const styles = node.ownerDocument.defaultView?.getComputedStyle(node);
  const mode = styles?.writingMode ?? "horizontal-tb";
  const vertical = mode.startsWith("vertical") || mode.startsWith("sideways");
  const reversed =
    axis === "inline"
      ? (styles?.direction === "rtl") !== (mode === "sideways-lr")
      : mode.endsWith("-rl");
  return {
    horizontal: axis === "inline" ? !vertical : vertical,
    sign: reversed ? -1 : 1,
  };
}
function gridNumber(value: number) {
  return Number.isInteger(value) ? value : Number(value.toPrecision(15));
}
function finiteSize(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(name + " must be finite and non-negative.");
}
/** A two-pane layout with a focusable, pixel-valued window splitter. Arrows move the
 * boundary physically, Home/End choose its limits, and Enter collapses or restores.
 * @import import { SplitPane } from "@agent-native/toolkit/ui/base-ui/split-pane";
 */
export function SplitPane({
  pane,
  children,
  label,
  axis = "inline",
  side = "start",
  size,
  defaultSize = 280,
  minSize = 120,
  maxSize,
  minContentSize = 0,
  collapsible = false,
  disabled = false,
  step = 8,
  snapToStep = false,
  onSizeChange,
  getValueText,
  handle,
  separatorRef,
  className,
  style,
  render,
  ref,
  ...props
}: SplitPaneProps) {
  finiteSize(step, "step");
  finiteSize(size ?? defaultSize, "size");
  if (maxSize !== undefined) {
    finiteSize(maxSize, "maxSize");
  }
  const root = React.useRef<HTMLDivElement>(null);
  const grip = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const drag = React.useRef<Drag | null>(null);
  const [own, setOwn] = useControlledValue(size, defaultSize, undefined);
  const [measure, setMeasure] = React.useState<{
    available: number;
    separatorSize: number;
    horizontal: boolean;
  } | null>(null);
  const separatorSize = measure?.separatorSize ?? 0;
  const paneMin =
    typeof minSize === "number" ? minSize : minSize(separatorSize);
  const contentMin =
    typeof minContentSize === "number"
      ? minContentSize
      : minContentSize(separatorSize);
  finiteSize(paneMin, "minSize");
  finiteSize(contentMin, "minContentSize");
  if (maxSize !== undefined && maxSize < paneMin)
    throw new RangeError("maxSize must be at least minSize.");
  const maximum = Math.min(
    maxSize ?? Infinity,
    measure
      ? Math.max(0, measure.available - contentMin)
      : Math.max(maxSize ?? 0, own, paneMin, defaultSize),
  );
  const minimum = Math.min(paneMin, maximum);
  function clamp(value: number) {
    if (collapsible && value < Math.max(1, minimum / 2)) return 0;
    return Math.min(maximum, Math.max(minimum, value));
  }
  const current = clamp(own);
  const snapStep = snapToStep ? step : 0;
  const previous = React.useRef(defaultSize || paneMin || 1);
  const listeners = React.useRef({ onSizeChange, getValueText, size: current });
  React.useLayoutEffect(() => {
    const changed = current !== listeners.current.size;
    listeners.current = { onSizeChange, getValueText, size: current };
    if (changed && drag.current && current !== drag.current.painted)
      discardGesture(true, current);
    if (current > 0 && !drag.current) previous.current = current;
  }, [onSizeChange, getValueText, current]);
  React.useLayoutEffect(() => {
    const node = root.current,
      handle = grip.current;
    if (!node || !handle) return;
    let content: DOMRectReadOnly | undefined;
    let handleBox: ResizeObserverSize | undefined;
    const update = (entries: ResizeObserverEntry[] = []) => {
      for (const entry of entries) {
        if (entry.target === node) content = entry.contentRect;
        if (entry.target === handle) handleBox = entry.borderBoxSize[0];
      }
      const { horizontal } = dimensions(axis, node);
      let extent: number;
      if (content) extent = horizontal ? content.width : content.height;
      else {
        const box = node.ownerDocument.defaultView?.getComputedStyle(node);
        const padding = horizontal
          ? [box?.paddingLeft, box?.paddingRight]
          : [box?.paddingTop, box?.paddingBottom];
        extent =
          (horizontal ? node.clientWidth : node.clientHeight) -
          padding.reduce((sum, side) => sum + parseFloat(side || "0"), 0);
      }
      const separatorSize = handleBox
        ? dimensions("inline", handle).horizontal === horizontal
          ? handleBox.inlineSize
          : handleBox.blockSize
        : horizontal
          ? handle.offsetWidth
          : handle.offsetHeight;
      const available = extent - separatorSize;
      setMeasure((old) =>
        old?.horizontal === horizontal &&
        old.available === available &&
        old.separatorSize === separatorSize
          ? old
          : { horizontal, available, separatorSize },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    observer.observe(handle, { box: "border-box" });
    return () => observer.disconnect();
  }, [axis]);

  React.useLayoutEffect(() => {
    const pane = panel.current;
    if (current !== 0 || !pane) return;
    const scope = pane.getRootNode() as Document | ShadowRoot;
    if (pane.contains(scope.activeElement))
      grip.current?.focus({ preventScroll: true });
  }, [current]);

  function discardGesture(notify: boolean, restoreSize?: number) {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    active.endListening();
    if (active.frame !== null) active.window.cancelAnimationFrame(active.frame);
    root.current?.style.removeProperty("--split-pane-preview");
    const el = grip.current;
    if (el) {
      delete el.dataset.dragging;
      if (el.hasPointerCapture(active.id)) el.releasePointerCapture(active.id);
    }
    if (notify) {
      const restored = restoreSize ?? active.startSize;
      reflect(restored);
      listeners.current.onSizeChange?.(restored, { phase: "cancel" });
    }
  }
  React.useLayoutEffect(() => () => discardGesture(true), [axis, side]);
  React.useLayoutEffect(() => {
    const active = drag.current;
    if (
      active &&
      (disabled ||
        active.snapStep !== snapStep ||
        active.minimum !== minimum ||
        active.maximum !== maximum ||
        active.collapsible !== collapsible)
    ) {
      discardGesture(true, current);
    }
  }, [disabled, minimum, maximum, collapsible, current, snapStep]);
  function reflect(next: number) {
    const el = grip.current;
    if (el) {
      el.setAttribute("aria-valuenow", String(next));
      el.setAttribute(
        "aria-valuetext",
        listeners.current.getValueText?.(next) ?? next + "px",
      );
    }
    const collapsed = next === 0;
    if (panel.current && panel.current.hidden !== collapsed) {
      panel.current.hidden = collapsed;
      panel.current.inert = collapsed;
    }
  }
  function cancel() {
    discardGesture(true, listeners.current.size);
  }
  function commit(next: number, from = current) {
    if (next === 0 && from > 0) previous.current = from;
    setOwn(next);
    listeners.current.onSizeChange?.(next, { phase: "commit" });
  }
  function update(event: React.PointerEvent<HTMLDivElement>, end: boolean) {
    const active = drag.current;
    if (!active || event.pointerId !== active.id) return;
    const coord = active.horizontal ? event.clientX : event.clientY;
    const delta =
      active.sign * (coord - active.startCoord) * active.layoutPerClientPixel;
    const raw = active.startSize + delta;
    active.next = clamp(raw);
    if (active.snapStep && delta && raw > minimum && raw < maximum) {
      const snapped = gridNumber(
        Math.round(gridNumber(raw / active.snapStep)) * active.snapStep,
      );
      active.next = clamp(
        delta > 0
          ? Math.max(active.startSize, snapped)
          : Math.min(active.startSize, snapped),
      );
    }
    if (end) {
      const next = active.next;
      discardGesture(false);
      reflect(current);
      if (next !== active.startSize || active.painted !== active.startSize)
        commit(next, active.startSize);
    } else if (active.frame === null && active.next !== active.painted) {
      active.frame = active.window.requestAnimationFrame(() => {
        active.frame = null;
        if (drag.current !== active || active.next === active.painted) return;
        active.painted = active.next;
        root.current?.style.setProperty(
          "--split-pane-preview",
          active.next + "px",
        );
        reflect(active.next);
        listeners.current.onSizeChange?.(active.next, { phase: "preview" });
      });
    }
  }
  const panelElement = (
    <div
      key="panel"
      className="split-pane-panel"
      ref={panel}
      id={id}
      hidden={current === 0}
      inert={current === 0}
    >
      {pane}
    </div>
  );
  const contentElement = (
    <div key="content" className="split-pane-content">
      {children}
    </div>
  );
  const separator = useRender({
    defaultTagName: "div",
    ref: separatorRef ? [grip, separatorRef] : grip,
    render: (
      <div
        role="separator"
        className="split-pane-handle"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-controls={id}
        aria-orientation={
          (measure?.horizontal ?? axis === "inline") ? "vertical" : "horizontal"
        }
        aria-valuemin={collapsible ? 0 : minimum}
        aria-valuemax={maximum}
        aria-valuenow={current}
        aria-valuetext={getValueText?.(current) ?? current + "px"}
        onPointerDown={(event) => {
          if (
            disabled ||
            drag.current ||
            !event.isPrimary ||
            event.button !== 0 ||
            !root.current
          )
            return;
          const { horizontal, sign } = dimensions(axis, root.current);
          const node = root.current;
          const rect = node.getBoundingClientRect();
          const projected = horizontal ? rect.width : rect.height;
          const layout = horizontal ? node.offsetWidth : node.offsetHeight;
          const layoutPerClientPixel =
            projected > 0 && layout > 0 && Math.abs(projected - layout) > 0.5
              ? layout / projected
              : 1;
          const el = event.currentTarget;
          const win = el.ownerDocument.defaultView;
          if (!win) return;
          el.focus({ preventScroll: true });
          el.setPointerCapture(event.pointerId);
          el.dataset.dragging = "";
          win.addEventListener("blur", cancel);
          drag.current = {
            window: win,
            endListening: () => win.removeEventListener("blur", cancel),
            id: event.pointerId,
            startSize: current,
            layoutPerClientPixel,
            snapStep,
            minimum,
            maximum,
            collapsible,
            startCoord: horizontal ? event.clientX : event.clientY,
            sign: side === "start" ? sign : -sign,
            horizontal,
            next: current,
            painted: current,
            frame: null,
          };
          event.preventDefault();
        }}
        onBlur={cancel}
        onPointerMove={(e) => update(e, false)}
        onPointerUp={(e) => update(e, true)}
        onPointerCancel={(e) => {
          if (e.pointerId === drag.current?.id) cancel();
        }}
        onLostPointerCapture={(e) => {
          if (e.pointerId === drag.current?.id) cancel();
        }}
        onKeyDown={(e) => {
          if (e.defaultPrevented || isComposingKey(e)) return;
          if (e.key === "Escape" && drag.current) {
            e.preventDefault();
            e.stopPropagation();
            cancel();
            return;
          }
          if (
            disabled ||
            drag.current ||
            !root.current ||
            e.altKey ||
            e.metaKey ||
            e.ctrlKey
          )
            return;
          const { horizontal, sign } = dimensions(axis, root.current);
          let next: number;
          if (e.key === "Enter" && collapsible) {
            if (e.repeat) {
              e.preventDefault();
              return;
            }
            next = current > 0 ? 0 : Math.max(minimum, previous.current);
          } else if (e.key === "Home") next = collapsible ? 0 : minimum;
          else if (e.key === "End") next = maximum;
          else {
            const delta =
              e.key === (horizontal ? "ArrowRight" : "ArrowDown")
                ? 1
                : e.key === (horizontal ? "ArrowLeft" : "ArrowUp")
                  ? -1
                  : 0;
            if (!delta) return;
            const direction = delta * sign * (side === "start" ? 1 : -1);
            const round = direction > 0 ? Math.floor : Math.ceil;
            const increments = direction * (e.shiftKey ? 10 : 1);
            next =
              current === 0 && direction > 0
                ? Math.max(minimum, step)
                : snapStep
                  ? gridNumber(
                      (round(gridNumber(current / snapStep)) + increments) *
                        snapStep,
                    )
                  : current + increments * step;
          }
          e.preventDefault();
          next = clamp(next);
          if (next !== current) commit(next);
        }}
      >
        {handle}
      </div>
    ),
  });
  const content = (
    <>
      {side === "start" ? panelElement : contentElement}
      {separator}
      {side === "start" ? contentElement : panelElement}
    </>
  );
  return useRender({
    defaultTagName: "div",
    render,
    ref: ref ? [root, ref] : root,
    props: {
      ...props,
      className: partClassName("split-pane", className),
      "data-axis": axis,
      "data-side": side,
      style: { ...style, "--split-pane-size": current + "px" },
      children: content,
    },
  });
}
