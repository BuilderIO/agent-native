/**
 * Pinch-zoom bridge — injected into every canvas iframe.
 *
 * Forwards trackpad pinch / Cmd-Ctrl+scroll wheel events from inside the
 * iframe to the parent window. Wheel events don't naturally bubble out of an
 * iframe, so without this the user can only pinch in the empty area around the
 * canvas, not over the design itself.
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
  // Attach to documentElement (not window/document) so { passive: false }
  // is honored consistently and the browser doesn't natively pinch-zoom the
  // iframe's own document alongside the parent's zoom.
  var target: EventTarget =
    document.documentElement || document.body || document;
  function onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    // A fling's wheel events are not cancelable; cancelling one logs a browser
    // Intervention per event and scrolls anyway.
    if (e.cancelable) e.preventDefault();
    try {
      (window.parent as Window).postMessage(
        {
          type: "pinch-zoom-wheel",
          deltaY: e.deltaY,
          clientX: e.clientX,
          clientY: e.clientY,
          // The parent classifies and scales from these three. Dropping the
          // modifiers puts every pinch on the notch curve; dropping the mode
          // makes a Firefox line tick read as 3px of travel.
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
