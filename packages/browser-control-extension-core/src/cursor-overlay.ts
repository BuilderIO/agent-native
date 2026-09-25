import { sendDebuggerCommand, type DebuggerSource } from "./chrome-debugger";

export type CursorOverlayAction =
  | { type: "show"; x: number; y: number; click?: boolean }
  | { type: "hide" };

export const CURSOR_OVERLAY_VISIBLE_MS = 1_800;
export const CURSOR_OVERLAY_FADE_MS = 420;
export const CURSOR_OVERLAY_MAX_LIFETIME_MS =
  CURSOR_OVERLAY_VISIBLE_MS + CURSOR_OVERLAY_FADE_MS;

const CURSOR_OVERLAY_ID = "agent-native-phantom-cursor";

// This is a fixed extension-owned expression. Coordinates are the only values
// interpolated into it; the browser-control protocol never accepts page code.
const CURSOR_OVERLAY_SOURCE = String.raw`(action => {
  const id = "${CURSOR_OVERLAY_ID}";
  const candidate = document.getElementById(id);
  const existing = candidate?.getAttribute("data-agent-native-owned") === "true" ? candidate : null;
  if (candidate && !existing) return;
  const clearTimers = node => {
    if (!node) return;
    if (node.__agentNativeCursorTimer) {
      clearTimeout(node.__agentNativeCursorTimer);
      node.__agentNativeCursorTimer = undefined;
    }
    if (node.__agentNativeCursorRemoveTimer) {
      clearTimeout(node.__agentNativeCursorRemoveTimer);
      node.__agentNativeCursorRemoveTimer = undefined;
    }
  };
  const remove = node => {
    if (!node) return;
    clearTimers(node);
    node.remove();
  };

  if (action.type === "hide") {
    remove(existing);
    return;
  }

  if (!document.documentElement) return;
  const x = Math.max(0, Math.min(action.x, Math.max(0, window.innerWidth - 1)));
  const y = Math.max(0, Math.min(action.y, Math.max(0, window.innerHeight - 1)));
  let host = existing;
  if (!host) {
    host = document.createElement("div");
    host.id = id;
    host.setAttribute("data-agent-native-owned", "true");
    host.setAttribute("aria-hidden", "true");
    host.attachShadow({ mode: "open" });
    const shadow = host.shadowRoot;
    if (!shadow) return;
    const style = document.createElement("style");
    style.textContent = [
      ":host {",
      "  position: fixed;",
      "  left: 0;",
      "  top: 0;",
      "  width: 70px;",
      "  height: 44px;",
      "  z-index: 2147483647;",
      "  pointer-events: none;",
      "  contain: layout style;",
      "  opacity: 0;",
      "  --agent-native-pointer-x: 0px;",
      "  --agent-native-pointer-y: 0px;",
      "  --agent-native-label-x: 16px;",
      "  --agent-native-label-y: 20px;",
      "  transform: translate3d(var(--agent-native-x), var(--agent-native-y), 0);",
      "  transition: opacity 140ms ease-out;",
      "}",
      ":host([data-state=visible]) { opacity: 1; }",
      ":host([data-state=fading]) { opacity: 0; transition-duration: 420ms; }",
      ".pointer-outline {",
      "  position: absolute;",
      "  left: var(--agent-native-pointer-x);",
      "  top: var(--agent-native-pointer-y);",
      "  width: 19px;",
      "  height: 23px;",
      "  background: white;",
      "  clip-path: polygon(0 0, 0 19px, 5px 15px, 9.5px 23px, 13.5px 20.5px, 9px 14px, 18.5px 14px);",
      // guard:allow-raw-color — the isolated overlay has no app theme tokens.
      "  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .22));",
      "}",
      ".pointer {",
      "  position: absolute;",
      "  left: var(--agent-native-pointer-x);",
      "  top: var(--agent-native-pointer-y);",
      "  width: 17px;",
      "  height: 21px;",
      // guard:allow-raw-color — the isolated overlay has no app theme tokens.
      "  background: #7b61ff;",
      "  clip-path: polygon(0 0, 0 17px, 5px 13px, 9px 20px, 12px 18px, 8px 12px, 16px 12px);",
      // guard:allow-raw-color — the isolated overlay has no app theme tokens.
      "  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .26));",
      "}",
      ".pointer {",
      "  z-index: 1;",
      "}",
      ".label {",
      "  position: absolute;",
      "  left: var(--agent-native-label-x);",
      "  top: var(--agent-native-label-y);",
      "  box-sizing: border-box;",
      "  min-height: 20px;",
      "  padding: 2px 6px;",
      // guard:allow-raw-color — the isolated overlay has no app theme tokens.
      "  background: #7b61ff;",
      "  color: white;",
      "  border-radius: 2px;",
      // guard:allow-raw-color — the isolated overlay has no app theme tokens.
      "  box-shadow: 0 1px 2px rgba(0, 0, 0, .22);",
      "  font: 12px/16px -apple-system, BlinkMacSystemFont, \"Inter\", \"Helvetica Neue\", sans-serif;",
      "  white-space: nowrap;",
      "  z-index: 2;",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  :host { transition: none; }",
      "}",
    ].join("");
    const pointerOutline = document.createElement("span");
    pointerOutline.className = "pointer-outline";
    const pointer = document.createElement("span");
    pointer.className = "pointer";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Agent";
    shadow.append(style, pointerOutline, pointer, label);
    document.documentElement.append(host);
  }

  clearTimers(host);
  const overlayWidth = 70;
  const overlayHeight = 44;
  const pointerWidth = 17;
  const pointerHeight = 21;
  const labelWidth = 48;
  const labelHeight = 20;
  const labelGap = 2;
  const labelOnLeft = x + pointerWidth + labelGap + labelWidth > window.innerWidth;
  const labelAbove =
    y + pointerHeight + labelGap + labelHeight > window.innerHeight;
  const desiredOriginX = labelOnLeft ? x - 52 : x;
  const desiredOriginY = labelAbove ? y - 22 : y;
  const originX = Math.max(
    0,
    Math.min(desiredOriginX, window.innerWidth - overlayWidth),
  );
  const originY = Math.max(
    0,
    Math.min(desiredOriginY, window.innerHeight - overlayHeight),
  );
  // Keep the arrow tip anchored to the action point. The viewport clips only
  // the artwork that naturally extends beyond a physical page edge.
  const pointerX = x - originX;
  const pointerY = y - originY;
  const labelX = labelOnLeft ? Math.max(0, pointerX - labelWidth - labelGap) : 16;
  const labelY = labelAbove ? Math.max(0, pointerY - labelHeight - labelGap) : 20;
  host.style.setProperty("--agent-native-x", originX + "px");
  host.style.setProperty("--agent-native-y", originY + "px");
  host.style.setProperty("--agent-native-pointer-x", pointerX + "px");
  host.style.setProperty("--agent-native-pointer-y", pointerY + "px");
  host.style.setProperty("--agent-native-label-x", labelX + "px");
  host.style.setProperty("--agent-native-label-y", labelY + "px");
  host.dataset.action = action.click ? "click" : "move";
  host.dataset.state = "visible";
  void host.offsetWidth;
  host.__agentNativeCursorTimer = setTimeout(() => {
    host.dataset.state = "fading";
    host.__agentNativeCursorRemoveTimer = setTimeout(() => remove(host), ${CURSOR_OVERLAY_FADE_MS});
  }, ${CURSOR_OVERLAY_VISIBLE_MS});
})`;

function finiteCoordinate(value: number, label: "x" | "y"): number {
  if (!Number.isFinite(value) || value < 0 || value > 100_000) {
    throw new Error(`Cursor overlay ${label} must be a finite coordinate.`);
  }
  return value;
}

export function cursorOverlayExpression(action: CursorOverlayAction): string {
  const normalized =
    action.type === "hide"
      ? action
      : {
          type: "show" as const,
          x: finiteCoordinate(action.x, "x"),
          y: finiteCoordinate(action.y, "y"),
          ...(action.click ? { click: true } : {}),
        };
  return `(${CURSOR_OVERLAY_SOURCE})(${JSON.stringify(normalized)})`;
}

export async function showCursorOverlay(
  source: DebuggerSource,
  action: Exclude<CursorOverlayAction, { type: "hide" }>,
): Promise<void> {
  await sendDebuggerCommand(source, "Runtime.evaluate", {
    expression: cursorOverlayExpression(action),
    awaitPromise: false,
    returnByValue: true,
  });
}

export async function hideCursorOverlay(source: DebuggerSource): Promise<void> {
  await sendDebuggerCommand(source, "Runtime.evaluate", {
    expression: cursorOverlayExpression({ type: "hide" }),
    awaitPromise: false,
    returnByValue: true,
  });
}
