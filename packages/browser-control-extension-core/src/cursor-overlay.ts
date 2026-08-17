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
      "  width: 30px;",
      "  height: 36px;",
      "  z-index: 2147483647;",
      "  pointer-events: none;",
      "  contain: layout style paint;",
      "  opacity: 0;",
      "  transform: translate3d(var(--agent-native-x), var(--agent-native-y), 0);",
      "  transition: opacity 180ms ease-out;",
      "}",
      ":host([data-state=visible]) { opacity: 1; }",
      ":host([data-state=fading]) { opacity: 0; transition-duration: 420ms; }",
      ".pointer {",
      "  position: absolute;",
      "  inset: 0 auto auto 0;",
      "  width: 26px;",
      "  height: 34px;",
      "  background: white;",
      "  clip-path: polygon(1px 1px, 1px 30px, 9px 22px, 15px 34px, 19px 32px, 13px 20px, 26px 20px);",
      "  filter: drop-shadow(0 1px 2px black);",
      "}",
      ".hotspot {",
      "  position: absolute;",
      "  left: -2px;",
      "  top: -2px;",
      "  width: 12px;",
      "  height: 12px;",
      "  border: 2px solid royalblue;",
      "  border-radius: 999px;",
      "  box-sizing: border-box;",
      "  opacity: .6;",
      "  transform: scale(.9);",
      "}",
      ":host([data-action=click]) .hotspot {",
      "  animation: agent-native-cursor-click 520ms ease-out both;",
      "}",
      "@keyframes agent-native-cursor-click {",
      "  0% { opacity: .85; transform: scale(.75); }",
      "  100% { opacity: 0; transform: scale(2.4); }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  :host { transition: none; }",
      "  :host([data-action=click]) .hotspot { animation: none; opacity: .5; }",
      "}",
    ].join("");
    const pointer = document.createElement("span");
    pointer.className = "pointer";
    const hotspot = document.createElement("span");
    hotspot.className = "hotspot";
    shadow.append(style, pointer, hotspot);
    document.documentElement.append(host);
  }

  clearTimers(host);
  host.style.setProperty("--agent-native-x", x + "px");
  host.style.setProperty("--agent-native-y", y + "px");
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
