/**
 * Content-size reporter injected into every canvas iframe (primary + each
 * breakpoint) so a frame can grow to fit its own content instead of inheriting
 * the primary frame's aspect ratio. The iframes are sandbox="allow-scripts"
 * (opaque origin), so the parent can't read contentDocument — this measures
 * scrollHeight inside the frame and posts { type, width, height } out, keyed by
 * event.source. It first pins full-height utilities to a fixed per-frame
 * --agent-native-device-vh so a min-h-screen hero can't chase the growing frame
 * (runaway); raw inline 100vh is not remapped.
 */

const CONTENT_SIZE_REPORT_BRIDGE = `
<style data-agent-native-content-size-guard>
  .min-h-screen { min-height: var(--agent-native-device-vh, 100vh) !important; }
  .h-screen { height: var(--agent-native-device-vh, 100vh) !important; }
  .min-h-dvh { min-height: var(--agent-native-device-vh, 100dvh) !important; }
  .h-dvh { height: var(--agent-native-device-vh, 100dvh) !important; }
  .min-h-svh { min-height: var(--agent-native-device-vh, 100svh) !important; }
  .h-svh { height: var(--agent-native-device-vh, 100svh) !important; }
</style>
<script data-agent-native-content-size-bridge>
(function () {
  if (window.__agentNativeContentSizeReport) return;
  window.__agentNativeContentSizeReport = true;

  // Must match deviceViewportFloorForWidth in frame-geometry.ts.
  function deviceViewportHeight(widthPx) {
    if (widthPx <= 640) return 844; // phone
    if (widthPx <= 1024) return 1024; // tablet
    return 900; // desktop
  }

  // Idempotent: only writes when the value changes. The MutationObserver below
  // watches documentElement attributes, so an unconditional re-write here would
  // observe its own style change and loop forever (~60fps) on static content.
  var lastVh = "";
  function applyDeviceVh() {
    var vh = deviceViewportHeight(window.innerWidth || 0) + "px";
    if (vh === lastVh) return;
    lastVh = vh;
    document.documentElement.style.setProperty("--agent-native-device-vh", vh);
  }

  function measure() {
    var doc = document.documentElement;
    var body = document.body;
    return Math.max(
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
    );
  }

  var lastHeight = -1;
  var lastWidth = -1;
  var frame = 0;
  function report() {
    frame = 0;
    applyDeviceVh();
    var height = measure();
    var width = window.innerWidth || 0;
    if (height === lastHeight && width === lastWidth) return;
    lastHeight = height;
    lastWidth = width;
    try {
      window.parent.postMessage(
        { type: "agent-native:content-size", width: width, height: height },
        "*",
      );
    } catch (err) {
      /* cross-origin parent — ignore */
    }
  }
  function scheduleReport() {
    if (frame) return;
    frame = window.requestAnimationFrame(report);
  }

  applyDeviceVh();

  if (typeof ResizeObserver === "function") {
    var ro = new ResizeObserver(scheduleReport);
    if (document.documentElement) ro.observe(document.documentElement);
  }
  if (typeof MutationObserver === "function") {
    var mo = new MutationObserver(scheduleReport);
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }
  window.addEventListener("resize", scheduleReport);
  window.addEventListener("load", scheduleReport);
  // Late webfont / Tailwind-JIT reflows: a few settle passes catch height
  // changes that land after the initial paint without a permanent timer.
  [0, 120, 400, 1000].forEach(function (delay) {
    window.setTimeout(scheduleReport, delay);
  });
  scheduleReport();
})();
</script>
`;

export const CONTENT_SIZE_REPORT_MESSAGE_TYPE = "agent-native:content-size";

/** Appends the reporter + full-height guard, mirroring appendHitTestResponder's
 * marker handling so it runs regardless of document structure. */
export function appendContentSizeReporter(html: string): string {
  // Replacer must be a function, not a string: by this point `html` already
  // has the other bridge scripts spliced in, and their compiled source can
  // contain literal "$&" (e.g. editor-chrome's escapeIdent). A string
  // replacement arg makes String.replace treat "$&" as the special "insert
  // the matched text" pattern, so a stray "</body>" lands mid-script and
  // truncates its <script> tag early. A function replacer inserts its return
  // value verbatim.
  if (html.includes("</body>")) {
    return html.replace(
      "</body>", // i18n-ignore generated iframe HTML marker
      () => CONTENT_SIZE_REPORT_BRIDGE + "</body>", // i18n-ignore generated iframe HTML injection
    );
  }
  if (html.includes("</html>")) {
    return html.replace(
      "</html>", // i18n-ignore generated iframe HTML marker
      () => CONTENT_SIZE_REPORT_BRIDGE + "</html>", // i18n-ignore generated iframe HTML injection
    );
  }
  return html + CONTENT_SIZE_REPORT_BRIDGE;
}
