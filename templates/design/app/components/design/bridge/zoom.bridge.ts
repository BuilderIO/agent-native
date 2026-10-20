/**
 * Pinch-zoom bridge — injected into every Edit canvas iframe. Interact's document carries only the theme and links bridges.
 *
 * Forwards trackpad pinch / Cmd-Ctrl+scroll wheel events from inside the
 * iframe to the parent window. Wheel events don't naturally bubble out of an
 * iframe, so without this the user can only pinch in the empty area around the
 * canvas, not over the design itself.
 *
 * Interact hands the page its own wheel: the host posts `set-interaction-mode`
 * and, while it is on, a Cmd/Ctrl wheel is neither cancelled nor forwarded.
 *
 * Protocol (iframe → parent):
 *
 *   { type: 'pinch-zoom-wheel', deltaY, deltaMode, clientX, clientY,
 *     ctrlKey, metaKey }
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  var target: EventTarget =
    document.documentElement || document.body || document;
  var interactionMode = false;
  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent || !e.data) return;
    if (e.data.type === "set-interaction-mode") {
      interactionMode = e.data.interact === true;
    }
  });
  function onWheel(e: WheelEvent): void {
    if (interactionMode || !(e.ctrlKey || e.metaKey)) return;
    if (e.cancelable) e.preventDefault();
    try {
      (window.parent as Window).postMessage(
        {
          type: "pinch-zoom-wheel",
          deltaY: e.deltaY,
          clientX: e.clientX,
          clientY: e.clientY,
          deltaMode: e.deltaMode,
          ctrlKey: !!e.ctrlKey,
          metaKey: !!e.metaKey,
        },
        "*",
      );
    } catch (_err) {}
  }
  target.addEventListener("wheel", onWheel as EventListener, {
    passive: false,
    capture: true,
  });
})();
