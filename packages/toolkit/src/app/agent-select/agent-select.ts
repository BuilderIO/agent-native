import {
  AGENT_SELECTION_STATE_KEY,
  agentSelectionContextKey,
  getAgentChatContextState,
  listAgentChatContext,
  parseAgentSelectionContextKey,
  removeAgentChatContextItem,
  setAgentChatContextItem,
  subscribeAgentChatContext,
  type AgentSelectionState,
  type AgentSelectionStateItem,
} from "@agent-native/core/client/agent-chat";
import {
  getBrowserTabId,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import {
  COMPOSER_CONTEXT_MAX_ITEMS,
  composerContextFits,
} from "@agent-native/toolkit/composer";

/**
 * An on-screen object the user can pick with the composer's Select mode.
 * Picked objects become ordinary agent chat context items, keyed by
 * `agentSelectionContextKey(kind, id)`; there is no second selection store.
 */
export interface AgentSelectable {
  /** Short, stable object type such as `slide`, `element`, `panel`, `screen`. */
  kind: string;
  /** Stable id within `kind`. */
  id: string;
  /** Chip label. Read when the object is picked. */
  readonly title: string;
  /** The context payload the agent receives. Read when the object is picked. */
  getContext(): string;
  /**
   * The element, or elements (a slide's canvas and its thumbnail), that
   * outline and hit-test this object. An element may live in a same-origin
   * iframe; it is then measured through the frame.
   */
  getElement(): Element | readonly Element[] | null;
  /**
   * The registered object this one lives inside, such as a layer's screen.
   * Its pick is released with the parent's.
   */
  parent?: { kind: string; id: string };
}

/**
 * Resolves content that is too dynamic to register element by element, such
 * as the nodes of a rendered slide or a design screen, into selectables.
 */
export interface AgentSelectableSource {
  /**
   * Given an element under the pointer (inside same-origin iframes too),
   * return the object it belongs to, or null. Elements are offered topmost
   * first until one resolves.
   */
  resolve(target: Element): AgentSelectable | null;
}

export type AgentSelectToggleResult =
  | "added"
  | "removed"
  | "too-many-items"
  | "too-large"
  | "not-registered";

export interface AgentSelectSnapshot {
  active: boolean;
  /** Registered selectables and sources; Select is offered only when > 0. */
  available: number;
}

export interface AgentSelectRejection {
  reason: "too-many-items" | "too-large";
  target: Pick<AgentSelectable, "kind" | "id" | "title">;
}

// Kept on the window so a toolkit copy bundled twice (an app's own build and a
// linked package) still shares one registry and one pick mode.
interface AgentSelectStore {
  selectables: Map<string, AgentSelectable>;
  sources: Set<AgentSelectableSource>;
  /** Source-resolved objects that were hovered or picked, by context key. */
  resolved: Map<string, AgentSelectable>;
  listeners: Set<() => void>;
  rejectionListeners: Set<(rejection: AgentSelectRejection) => void>;
  snapshot: AgentSelectSnapshot;
  teardownPickMode: (() => void) | null;
  teardownMirror: (() => void) | null;
}

const STORE_KEY = "__agentNativeAgentSelectStore";
const MIRROR_DELAY_MS = 150;

function createStore(): AgentSelectStore {
  return {
    selectables: new Map(),
    sources: new Set(),
    resolved: new Map(),
    listeners: new Set(),
    rejectionListeners: new Set(),
    snapshot: { active: false, available: 0 },
    teardownPickMode: null,
    teardownMirror: null,
  };
}

let fallbackStore: AgentSelectStore | null = null;

function store(): AgentSelectStore {
  if (typeof window === "undefined") {
    fallbackStore ??= createStore();
    return fallbackStore;
  }
  const host = window as unknown as Record<
    string,
    AgentSelectStore | undefined
  >;
  host[STORE_KEY] ??= createStore();
  return host[STORE_KEY];
}

function emit(next: Partial<AgentSelectSnapshot>): void {
  const current = store();
  const snapshot = { ...current.snapshot, ...next };
  if (
    snapshot.active === current.snapshot.active &&
    snapshot.available === current.snapshot.available
  ) {
    return;
  }
  current.snapshot = snapshot;
  for (const listener of Array.from(current.listeners)) listener();
}

export function subscribeAgentSelect(listener: () => void): () => void {
  store().listeners.add(listener);
  return () => {
    store().listeners.delete(listener);
  };
}

export function getAgentSelectSnapshot(): AgentSelectSnapshot {
  return store().snapshot;
}

/** Called when a pick is refused because the composer context is full. */
export function subscribeAgentSelectRejections(
  listener: (rejection: AgentSelectRejection) => void,
): () => void {
  store().rejectionListeners.add(listener);
  return () => {
    store().rejectionListeners.delete(listener);
  };
}

function availableCount(current: AgentSelectStore): number {
  return current.selectables.size + current.sources.size;
}

function released(current: AgentSelectStore): void {
  const available = availableCount(current);
  if (available === 0) setAgentSelectMode(false);
  emit({ available });
}

export function registerAgentSelectable(
  selectable: AgentSelectable,
): () => void {
  const key = agentSelectionContextKey(selectable.kind, selectable.id);
  const current = store();
  current.selectables.set(key, selectable);
  current.teardownMirror ??= startSelectionMirror();
  emit({ available: availableCount(current) });
  return () => {
    const latest = store();
    // A remount can register the same key before the old cleanup runs.
    if (latest.selectables.get(key) !== selectable) return;
    latest.selectables.delete(key);
    released(latest);
    releasePickIfGone(latest, key);
  };
}

/**
 * Once an object unregisters and does not come back in the same task (a
 * remount or a list re-render registers it again first), the object is gone:
 * release its pick, and the picks of objects resolved inside it, so the agent
 * is never told to target something no longer on screen.
 */
function releasePickIfGone(owner: AgentSelectStore, key: string): void {
  setTimeout(() => {
    if (store() !== owner || owner.selectables.has(key)) return;
    const picked = new Set(
      getAgentChatContextState().items.map((item) => item.key),
    );
    if (picked.has(key)) removeAgentChatContextItem(key);
    for (const [childKey, child] of owner.resolved) {
      if (
        child.parent &&
        picked.has(childKey) &&
        agentSelectionContextKey(child.parent.kind, child.parent.id) === key
      ) {
        removeAgentChatContextItem(childKey);
      }
    }
  }, 0);
}

export function registerAgentSelectableSource(
  source: AgentSelectableSource,
): () => void {
  const current = store();
  current.sources.add(source);
  current.teardownMirror ??= startSelectionMirror();
  emit({ available: availableCount(current) });
  return () => {
    const latest = store();
    if (!latest.sources.delete(source)) return;
    released(latest);
  };
}

function lookupSelectable(key: string): AgentSelectable | undefined {
  const current = store();
  return current.selectables.get(key) ?? current.resolved.get(key);
}

function selectableElements(selectable: AgentSelectable): Element[] {
  const result = selectable.getElement();
  if (!result) return [];
  const elements = Array.isArray(result) ? result : [result as Element];
  return elements.filter((element) => element?.isConnected);
}

export function getAgentSelectables(): AgentSelectable[] {
  return [...store().selectables.values()];
}

export function isAgentSelectableSelected(kind: string, id: string): boolean {
  const key = agentSelectionContextKey(kind, id);
  return getAgentChatContextState().items.some((item) => item.key === key);
}

/** Every picked object currently in the composer context, registered or not. */
export function listAgentSelection(): AgentSelectionStateItem[] {
  const items: AgentSelectionStateItem[] = [];
  for (const item of getAgentChatContextState().items) {
    const reference = parseAgentSelectionContextKey(item.key);
    if (reference) items.push({ ...reference, title: item.title });
  }
  return items;
}

export type AgentSelectionTarget = Pick<
  AgentSelectable,
  "kind" | "id" | "title" | "getContext"
>;

export interface AgentSelectOptions {
  /** Release other picked objects of the same kind first. */
  exclusive?: boolean;
  openSidebar?: boolean;
  focus?: boolean;
}

function addSelection(
  key: string,
  target: AgentSelectionTarget,
  options: AgentSelectOptions = {},
): AgentSelectToggleResult {
  const item = {
    key,
    title: target.title.trim() || target.id,
    context: target.getContext(),
  };
  const existing = listAgentChatContext().filter(
    (candidate) =>
      candidate.key !== key &&
      !(options.exclusive && isSameKindSelection(candidate.key, target.kind)),
  );
  if (!composerContextFits([...existing, item])) {
    const reason =
      existing.length >= COMPOSER_CONTEXT_MAX_ITEMS
        ? "too-many-items"
        : "too-large";
    for (const listener of Array.from(store().rejectionListeners)) {
      listener({ reason, target });
    }
    return reason;
  }
  if (options.exclusive) {
    for (const picked of listAgentSelection()) {
      if (picked.kind === target.kind && picked.id !== target.id) {
        removeAgentChatContextItem(
          agentSelectionContextKey(picked.kind, picked.id),
        );
      }
    }
  }
  setAgentChatContextItem({
    ...item,
    openSidebar: options.openSidebar === true,
    focus: options.focus ?? false,
  });
  return "added";
}

function isSameKindSelection(key: string, kind: string): boolean {
  return parseAgentSelectionContextKey(key)?.kind === kind;
}

export function toggleAgentSelectable(
  kind: string,
  id: string,
): AgentSelectToggleResult {
  const key = agentSelectionContextKey(kind, id);
  const selectable = lookupSelectable(key);
  if (isAgentSelectableSelected(kind, id)) {
    removeAgentChatContextItem(key);
    return "removed";
  }
  if (!selectable) return "not-registered";
  return addSelection(key, selectable);
}

/**
 * Pick one object outside Select mode, as a plain click on it would. The
 * target need not be registered, so an app can stage an object it describes.
 */
export function selectAgentSelectable(
  target: AgentSelectionTarget,
  options: AgentSelectOptions = {},
): AgentSelectToggleResult {
  return addSelection(
    agentSelectionContextKey(target.kind, target.id),
    target,
    options,
  );
}

export function deselectAgentSelectable(kind: string, id: string): void {
  removeAgentChatContextItem(agentSelectionContextKey(kind, id));
}

export function setAgentSelectMode(active: boolean): void {
  const current = store();
  const next = active && availableCount(current) > 0;
  if (next === current.snapshot.active) return;
  if (next) {
    current.teardownPickMode = startPickMode();
  } else {
    current.teardownPickMode?.();
    current.teardownPickMode = null;
  }
  emit({ active: next });
}

export function toggleAgentSelectMode(): void {
  setAgentSelectMode(!store().snapshot.active);
}

// ---------------------------------------------------------------------------
// application_state mirror
// ---------------------------------------------------------------------------

/**
 * The mirror is tab-scoped like `navigation`: actions read it with
 * `readAppStateForCurrentTab(AGENT_SELECTION_STATE_KEY)`, so one tab's
 * selection never overwrites another's.
 */
function agentSelectionStateKeyForThisTab(): string {
  return `${AGENT_SELECTION_STATE_KEY}:${getBrowserTabId()}`;
}

function startSelectionMirror(): () => void {
  if (typeof window === "undefined") return () => {};
  let lastWritten: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (!store().snapshot.active) pruneResolved(null);
    const items = listAgentSelection();
    const serialized = JSON.stringify(items);
    if (serialized === lastWritten) return;
    lastWritten = serialized;
    const state: AgentSelectionState = { items, updatedAt: Date.now() };
    void writeClientAppState(agentSelectionStateKeyForThisTab(), state, {
      keepalive: true,
    }).catch((error: unknown) => {
      // Let the next change retry instead of believing this write landed.
      lastWritten = null;
      console.warn("[agent-select] Could not mirror the selection.", error);
    });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, MIRROR_DELAY_MS);
  };
  schedule();
  return subscribeAgentChatContext(schedule);
}

// ---------------------------------------------------------------------------
// Pick mode
// ---------------------------------------------------------------------------

export const AGENT_SELECT_MODE_ATTRIBUTE = "data-agent-select-mode";
const HOVER_ATTRIBUTE = "data-agent-select-hover";
/** Mark a region (the agent sidebar, dialogs) that pick mode must not touch. */
export const AGENT_SELECT_IGNORE_ATTRIBUTE = "data-agent-select-ignore";
const IGNORE_SELECTOR = `[${AGENT_SELECT_IGNORE_ATTRIBUTE}], .agent-sidebar-panel, [data-agent-composer-slot], [role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]`;
const STYLE_ID = "agent-native-agent-select-style";
const OVERLAY_Z_INDEX = "2147483000";

// Iframes swallow pointer events, so pick mode turns them off; hit testing
// then lands on the frame's host element and measures into the frame.
const PICK_MODE_CSS = `
html[${AGENT_SELECT_MODE_ATTRIBUTE}] iframe:not(${IGNORE_SELECTOR.split(", ")
  .map((selector) => `${selector} iframe`)
  .join(", ")}) { pointer-events: none !important; }
html[${HOVER_ATTRIBUTE}] body, html[${HOVER_ATTRIBUTE}] body * { cursor: pointer !important; }
`;

export interface AgentSelectBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The element's box in the top document's viewport, through one iframe. */
export function measureAgentSelectElement(
  element: Element,
): AgentSelectBox | null {
  const rect = element.getBoundingClientRect();
  const doc = element.ownerDocument;
  if (doc === document) {
    return rect.width > 0 || rect.height > 0
      ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      : null;
  }
  const frame = doc.defaultView?.frameElement;
  if (!frame || frame.ownerDocument !== document) return null;
  const frameRect = frame.getBoundingClientRect();
  const layoutWidth = (frame as HTMLElement).clientWidth;
  const layoutHeight = (frame as HTMLElement).clientHeight;
  const scaleX = layoutWidth > 0 ? frameRect.width / layoutWidth : 1;
  const scaleY = layoutHeight > 0 ? frameRect.height / layoutHeight : 1;
  const originX = frameRect.left + (frame as HTMLElement).clientLeft * scaleX;
  const originY = frameRect.top + (frame as HTMLElement).clientTop * scaleY;
  return {
    left: originX + rect.left * scaleX,
    top: originY + rect.top * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

function boxContains(box: AgentSelectBox, x: number, y: number): boolean {
  return (
    x >= box.left &&
    x <= box.left + box.width &&
    y >= box.top &&
    y <= box.top + box.height
  );
}

function sameOriginFrameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    // coercion-ok: a cross-origin frame is opaque; hit testing stops at its host
    return null;
  }
}

/**
 * The elements under a viewport point, topmost first, descending into a
 * same-origin iframe; empty over chrome pick mode ignores. Pick mode turns
 * iframe pointer events off, so the top document's hit lands on the frame's
 * host. Inside a frame the whole stack is kept: editors often lay a
 * transparent interaction overlay over the content.
 */
function elementsUnderPoint(x: number, y: number): Element[] {
  const top = document.elementFromPoint(x, y);
  if (!top || top.closest(IGNORE_SELECTOR)) return [];
  const frames = [
    ...(top instanceof HTMLIFrameElement ? [top] : []),
    ...Array.from(top.querySelectorAll("iframe")),
  ];
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    const box = measureAgentSelectElement(frame);
    if (!box || !boxContains(box, x, y)) continue;
    const frameDocument = sameOriginFrameDocument(frame);
    if (!frameDocument) return [top];
    const scaleX = frame.clientWidth > 0 ? box.width / frame.clientWidth : 1;
    const scaleY = frame.clientHeight > 0 ? box.height / frame.clientHeight : 1;
    const inner = frameDocument.elementsFromPoint(
      (x - box.left) / scaleX - frame.clientLeft,
      (y - box.top) / scaleY - frame.clientTop,
    );
    if (inner[0]?.closest(IGNORE_SELECTOR)) return [];
    return inner.length > 0 ? inner : [top];
  }
  return [top];
}

/** Whether `element` contains `target`, looking out through iframes. */
function containsAcrossFrames(element: Element, target: Element): boolean {
  let node: Element | null | undefined = target;
  while (node) {
    if (element.contains(node)) return true;
    node = node.ownerDocument.defaultView?.frameElement;
  }
  return false;
}

/**
 * The innermost registered or source-resolved object under a viewport point,
 * or null when the point is over chrome pick mode ignores or over nothing.
 */
export function hitTestAgentSelectable(
  x: number,
  y: number,
): AgentSelectable | null {
  const targets = elementsUnderPoint(x, y);
  const target = targets[0];
  if (!target) return null;
  const current = store();
  let best: AgentSelectable | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  const consider = (selectable: AgentSelectable, hit: Element) => {
    for (const element of selectableElements(selectable)) {
      if (!containsAcrossFrames(element, hit)) continue;
      const box = measureAgentSelectElement(element);
      if (!box || !boxContains(box, x, y)) continue;
      const area = box.width * box.height;
      if (area < bestArea) {
        best = selectable;
        bestArea = area;
      }
    }
  };
  for (const selectable of current.selectables.values()) {
    consider(selectable, target);
  }
  for (const source of current.sources) {
    for (const candidate of targets) {
      const resolved = source.resolve(candidate);
      if (!resolved) continue;
      current.resolved.set(
        agentSelectionContextKey(resolved.kind, resolved.id),
        resolved,
      );
      consider(resolved, candidate);
      break;
    }
  }
  return best;
}

/** Forget source-resolved objects that are neither picked nor hovered. */
function pruneResolved(hovered: AgentSelectable | null): void {
  const keep = new Set(getAgentChatContextState().items.map(({ key }) => key));
  if (hovered) keep.add(agentSelectionContextKey(hovered.kind, hovered.id));
  const { resolved } = store();
  for (const key of resolved.keys()) {
    if (!keep.has(key)) resolved.delete(key);
  }
}

function ensurePickModeStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PICK_MODE_CSS;
  document.head.appendChild(style);
}

function createOutline(kind: "hover" | "selected"): HTMLDivElement {
  const outline = document.createElement("div");
  outline.dataset.agentSelectOutline = kind;
  Object.assign(outline.style, {
    position: "fixed",
    pointerEvents: "none",
    boxSizing: "border-box",
    borderRadius: "2px",
    border:
      kind === "hover"
        ? "1px solid hsl(var(--ring))"
        : "2px solid hsl(var(--ring))",
    background: kind === "selected" ? "hsl(var(--ring) / 0.06)" : "transparent",
  } satisfies Partial<CSSStyleDeclaration>);
  return outline;
}

function placeOutline(outline: HTMLElement, box: AgentSelectBox): void {
  outline.style.transform = `translate(${box.left}px, ${box.top}px)`;
  outline.style.left = "0px";
  outline.style.top = "0px";
  outline.style.width = `${box.width}px`;
  outline.style.height = `${box.height}px`;
}

function startPickMode(): () => void {
  if (typeof window === "undefined") return () => {};
  ensurePickModeStyle();
  const root = document.documentElement;
  root.setAttribute(AGENT_SELECT_MODE_ATTRIBUTE, "");

  const layer = document.createElement("div");
  layer.dataset.agentSelectLayer = "";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: OVERLAY_Z_INDEX,
  } satisfies Partial<CSSStyleDeclaration>);
  const hoverOutline = createOutline("hover");
  const hoverLabel = document.createElement("div");
  hoverLabel.dataset.agentSelectLabel = "";
  Object.assign(hoverLabel.style, {
    position: "absolute",
    bottom: "100%",
    left: "-1px",
    marginBottom: "2px",
    padding: "0 4px",
    borderRadius: "2px",
    font: "500 11px/16px system-ui, sans-serif",
    whiteSpace: "nowrap",
    background: "hsl(var(--ring))",
    color: "hsl(var(--background))",
  } satisfies Partial<CSSStyleDeclaration>);
  hoverOutline.appendChild(hoverLabel);
  hoverOutline.style.display = "none";
  layer.appendChild(hoverOutline);
  document.body.appendChild(layer);

  const selectedOutlines = new Map<string, HTMLDivElement>();
  let hovered: AgentSelectable | null = null;
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;

  const render = () => {
    frame = 0;
    if (pointer) hovered = hitTestAgentSelectable(pointer.x, pointer.y);
    const hoveredElement = hovered ? selectableElements(hovered)[0] : null;
    const hoveredBox = hoveredElement
      ? measureAgentSelectElement(hoveredElement)
      : null;
    if (hovered && hoveredBox) {
      hoverOutline.style.display = "";
      placeOutline(hoverOutline, hoveredBox);
      hoverLabel.textContent = hovered.title;
      root.setAttribute(HOVER_ATTRIBUTE, "");
    } else {
      hoverOutline.style.display = "none";
      root.removeAttribute(HOVER_ATTRIBUTE);
    }

    const seen = new Set<string>();
    for (const item of getAgentChatContextState().items) {
      const selectable = lookupSelectable(item.key);
      if (!selectable) continue;
      selectableElements(selectable).forEach((element, index) => {
        const box = measureAgentSelectElement(element);
        if (!box) return;
        const outlineKey = `${item.key}\u0000${index}`;
        seen.add(outlineKey);
        let outline = selectedOutlines.get(outlineKey);
        if (!outline) {
          outline = createOutline("selected");
          selectedOutlines.set(outlineKey, outline);
          layer.insertBefore(outline, hoverOutline);
        }
        placeOutline(outline, box);
      });
    }
    for (const [key, outline] of selectedOutlines) {
      if (seen.has(key)) continue;
      outline.remove();
      selectedOutlines.delete(key);
    }
    pruneResolved(hovered);
  };
  const scheduleRender = () => {
    frame ||= requestAnimationFrame(render);
  };

  const onPointerMove = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    scheduleRender();
  };
  // Swallow the whole press over an object so the app underneath does not
  // also select, drag, or open it; the click alone toggles the pick.
  // A press that starts on an object belongs to pick mode through its release
  // and click; one that starts elsewhere (an app drag) stays the app's even if
  // it ends over an object.
  let pressedKey: string | null = null;
  const keyOf = (selectable: AgentSelectable | null) =>
    selectable
      ? agentSelectionContextKey(selectable.kind, selectable.id)
      : null;
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPressStart = (event: MouseEvent) => {
    pressedKey = keyOf(hitTestAgentSelectable(event.clientX, event.clientY));
    if (pressedKey) swallow(event);
  };
  const onPressEnd = (event: MouseEvent) => {
    if (pressedKey) swallow(event);
  };
  const onClick = (event: MouseEvent) => {
    const key = pressedKey;
    pressedKey = null;
    if (!key) return;
    swallow(event);
    const target = hitTestAgentSelectable(event.clientX, event.clientY);
    if (keyOf(target) !== key || !target) return;
    toggleAgentSelectable(target.kind, target.id);
    scheduleRender();
  };
  const onPress = (event: MouseEvent) => {
    if (hitTestAgentSelectable(event.clientX, event.clientY)) swallow(event);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setAgentSelectMode(false);
  };
  const onPointerLeave = () => {
    pointer = null;
    hovered = null;
    scheduleRender();
  };

  const capture = { capture: true } as const;
  const passiveCapture = { capture: true, passive: true } as const;
  window.addEventListener("pointermove", onPointerMove, passiveCapture);
  window.addEventListener("pointerdown", onPressStart, capture);
  window.addEventListener("mousedown", onPressStart, capture);
  window.addEventListener("pointerup", onPressEnd, capture);
  window.addEventListener("mouseup", onPressEnd, capture);
  window.addEventListener("dblclick", onPress, capture);
  window.addEventListener("contextmenu", onPress, capture);
  window.addEventListener("click", onClick, capture);
  window.addEventListener("keydown", onKeyDown, capture);
  window.addEventListener("scroll", scheduleRender, passiveCapture);
  window.addEventListener("resize", scheduleRender);
  document.documentElement.addEventListener("pointerleave", onPointerLeave);
  const unsubscribeContext = subscribeAgentChatContext(scheduleRender);
  const unsubscribeRegistry = subscribeAgentSelect(scheduleRender);
  // Canvases pan and zoom without scroll events; keep outlines attached.
  const interval = setInterval(scheduleRender, 250);
  scheduleRender();

  return () => {
    window.removeEventListener("pointermove", onPointerMove, passiveCapture);
    window.removeEventListener("pointerdown", onPressStart, capture);
    window.removeEventListener("mousedown", onPressStart, capture);
    window.removeEventListener("pointerup", onPressEnd, capture);
    window.removeEventListener("mouseup", onPressEnd, capture);
    window.removeEventListener("dblclick", onPress, capture);
    window.removeEventListener("contextmenu", onPress, capture);
    window.removeEventListener("click", onClick, capture);
    window.removeEventListener("keydown", onKeyDown, capture);
    window.removeEventListener("scroll", scheduleRender, passiveCapture);
    window.removeEventListener("resize", scheduleRender);
    document.documentElement.removeEventListener(
      "pointerleave",
      onPointerLeave,
    );
    unsubscribeContext();
    unsubscribeRegistry();
    clearInterval(interval);
    if (frame) cancelAnimationFrame(frame);
    layer.remove();
    root.removeAttribute(AGENT_SELECT_MODE_ATTRIBUTE);
    root.removeAttribute(HOVER_ATTRIBUTE);
  };
}

/** Test-only reset of the shared registry and pick mode. */
export function _resetAgentSelectForTests(): void {
  const current = store();
  current.teardownPickMode?.();
  current.teardownMirror?.();
  const fresh = createStore();
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, AgentSelectStore>)[STORE_KEY] = fresh;
  } else {
    fallbackStore = fresh;
  }
}
