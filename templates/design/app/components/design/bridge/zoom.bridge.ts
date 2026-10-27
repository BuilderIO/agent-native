/**
 * Pinch-zoom bridge — injected into every Edit canvas iframe except an overview screen's srcdoc, whose wheels go through the embedded gesture bridge. Interact's document carries only the theme and links bridges.
 *
 * A running app served from a URL carries it on the overview as well, since
 * Full view reuses the same registered bridge script. There the host's
 * `embedded-canvas-gesture-mode` turns wheel forwarding on, and this bridge
 * stays quiet so each pinch step goes out once.
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
 * Protocol (parent → iframe):
 *
 *   { type: 'set-interaction-mode', interact }
 *   { type: 'embedded-canvas-gesture-mode', wheelEnabled }
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
  // On the overview the gesture bridge forwards Cmd/Ctrl wheels too.
  var overviewForwardsWheels = false;
  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent || !e.data) return;
    if (e.data.type === "set-interaction-mode") {
      interactionMode = e.data.interact === true;
    }
    if (e.data.type === "embedded-canvas-gesture-mode") {
      overviewForwardsWheels = e.data.wheelEnabled === true;
    }
  });
  function onWheel(e: WheelEvent): void {
    if (interactionMode || overviewForwardsWheels) return;
    if (!(e.ctrlKey || e.metaKey)) return;
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
