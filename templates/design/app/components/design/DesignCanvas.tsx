import { sendToAgentChat, usePinchZoom, useT } from "@agent-native/core/client";
import { useRef, useEffect, useCallback, useMemo, useState } from "react";

// NOTE: This wires up the NEW shared visual-editor DrawOverlay + comment-pin
// components from `@/components/visual-editor`. The legacy iframe-only
// DrawOverlay at `./DrawOverlay.tsx` is intentionally NOT used here — both
// exist for now and can be reconciled in a follow-up. Don't import both.
import {
  DrawOverlay as SharedDrawOverlay,
  CanvasCommentPins,
  type CanvasPin,
} from "@/components/visual-editor";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";
import { embeddedWheelBridgeScript } from "../../../.generated/bridge/embedded-wheel.generated";
import { hitTestBridgeScript } from "../../../.generated/bridge/hit-test.generated";
import { motionPreviewBridgeScript } from "../../../.generated/bridge/motion-preview.generated";
import { navBridgeScript } from "../../../.generated/bridge/nav.generated";
import { shaderFillPreviewBridgeScript } from "../../../.generated/bridge/shader-fill-preview.generated";
import { tweakBridgeScript } from "../../../.generated/bridge/tweak.generated";
import { zoomBridgeScript } from "../../../.generated/bridge/zoom.generated";
import { isTrustedCanvasBridgeMessage } from "./bridge-security";
import { DeviceFrame } from "./DeviceFrame";
import type { ElementInfo, DeviceFrameType } from "./types";

/**
 * Allowlist check for Fusion (Builder-hosted) frame origins.
 *
 * Fusion frames are served cross-origin from the Builder-hosted app, so the
 * strict `origin === parentOrigin` bridge check can never match. Before relaxing
 * trust to window-identity only, we must confirm the message origin is actually
 * a Builder host — the exact origin of the `fusionUrl` we were asked to render,
 * or any `*.builder.io` host (plus the bare `builder.io`), over https. This
 * prevents the relaxed-trust path from accepting messages from an arbitrary
 * cross-origin frame that merely shares our iframe's window reference.
 */
function isAllowedFusionOrigin(
  origin: string,
  fusionUrl: string | undefined,
): boolean {
  if (!origin || origin === "null") return false;
  let host: string;
  let protocol: string;
  try {
    const parsed = new URL(origin);
    host = parsed.hostname.toLowerCase();
    protocol = parsed.protocol;
  } catch {
    return false;
  }
  // Only allow secure (https) Builder origins.
  if (protocol !== "https:") return false;
  // Exact match against the configured fusion URL's origin.
  if (fusionUrl) {
    try {
      if (new URL(fusionUrl).origin === origin) return true;
    } catch {
      // Malformed fusionUrl — fall through to the host-family allowlist.
    }
  }
  // Builder host family: builder.io and any subdomain of it.
  return host === "builder.io" || host.endsWith(".builder.io");
}

/**
 * Wire shape for a single motion track sent via the `motion-load-tracks`
 * postMessage. Matches the serialisable subset of `MotionTrack` from
 * `shared/motion-timeline.ts` without requiring an import at the UI layer.
 */
export interface MotionTrackWire {
  targetNodeId: string;
  property: string;
  keyframes: Array<{ t: number; value: string; ease?: string }>;
}

/**
 * Motion-preview bridge. Injected alongside the other bridge scripts so the
 * MotionDock's scrubbing preview works in ALL editor modes without writing
 * anything to the DB, Yjs state, or source files.
 *
 * Source: app/components/design/bridge/motion-preview.bridge.ts
 * Compiled: .generated/bridge/motion-preview.generated.ts (run bridge/codegen.ts to update)
 */
const MOTION_PREVIEW_BRIDGE_SCRIPT = `
<script data-agent-native-motion-preview-bridge>
${motionPreviewBridgeScript}
</script>
`;

/**
 * Shader-fill preview bridge. ALWAYS injected alongside the other bridge
 * scripts so the parent can apply a CSS gradient approximation of a shader
 * fill to the currently-selected element without persisting anything.
 *
 * Source: app/components/design/bridge/shader-fill-preview.bridge.ts
 * Compiled: .generated/bridge/shader-fill-preview.generated.ts (run bridge/codegen.ts to update)
 */
const SHADER_FILL_PREVIEW_BRIDGE_SCRIPT = `
<script data-agent-native-shader-fill-preview-bridge>
${shaderFillPreviewBridgeScript}
</script>
`;

/**
 * Tweak bridge. ALWAYS injected so the parent's postMessage (`tweak-values`)
 * can update CSS custom properties on the iframe's :root regardless of which
 * editor mode is active.
 *
 * Source: app/components/design/bridge/tweak.bridge.ts
 * Compiled: .generated/bridge/tweak.generated.ts (run bridge/codegen.ts to update)
 */
const TWEAK_BRIDGE_SCRIPT = `
<script data-agent-native-tweak-bridge>
${tweakBridgeScript}
</script>
`;

/**
 * Pinch-zoom bridge: forwards trackpad pinch / Cmd-Ctrl+scroll wheel events
 * from inside the iframe to the parent window.
 *
 * Source: app/components/design/bridge/zoom.bridge.ts
 * Compiled: .generated/bridge/zoom.generated.ts (run bridge/codegen.ts to update)
 */
const ZOOM_BRIDGE_SCRIPT = `
<script data-agent-native-zoom-bridge>
${zoomBridgeScript}
</script>
`;

/**
 * Embedded overview bridge. Forwards wheel events from embedded screen iframes
 * to the parent canvas handler so pan/zoom works over design content.
 *
 * Source: app/components/design/bridge/embedded-wheel.bridge.ts
 * Compiled: .generated/bridge/embedded-wheel.generated.ts (run bridge/codegen.ts to update)
 */
const EMBEDDED_WHEEL_BRIDGE_SCRIPT = `
<script data-agent-native-embedded-wheel-bridge>
${embeddedWheelBridgeScript}
</script>
`;

/**
 * Navigation bridge. ALWAYS injected. Intercepts link clicks and relative form
 * submits inside prototype iframes so they route to the parent instead of
 * navigating the iframe to the Design app itself.
 *
 * Source: app/components/design/bridge/nav.bridge.ts
 * Compiled: .generated/bridge/nav.generated.ts (run bridge/codegen.ts to update)
 */
const NAV_BRIDGE_SCRIPT = `
<script data-agent-native-nav-bridge>
${navBridgeScript}
</script>
`;

/**
 * Lightweight hit-test bridge: injected into every screen srcdoc iframe so
 * MultiScreenCanvas can ask "what container is under this point?" during a
 * cross-screen drag without needing to synthesise DOM events.
 *
 * Protocol (parent → iframe via postMessage):
 *   { type: 'agent-native:hit-test', correlationId: string, x: number, y: number }
 *   where x/y are in this iframe's viewport coordinate space.
 *
 * Reply (iframe → window.parent):
 *   { type: 'agent-native:hit-test-result', correlationId: string,
 *     anchorNodeId: string, placement: 'before'|'after'|'inside' }
 *
 * Reads DOM only — no mutations, no event interception. The container-drop and
 * placement logic is intentionally kept in sync with the corresponding helpers
 * inside editor-chrome.bridge.ts (search for "// keep in sync with
 * hit-test.bridge.ts" comments there).
 *
 * Source: app/components/design/bridge/hit-test.bridge.ts
 * Compiled: .generated/bridge/hit-test.generated.ts (run bridge/codegen.ts to update)
 */
export const LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT = `
<script data-agent-native-hit-test-bridge>
${hitTestBridgeScript}
</script>
`;

/**
 * Append the LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT into a complete HTML string.
 * Injects before </body> when present, before </html> as a fallback, or appends
 * at the end. This is the seam MultiScreenCanvas uses to add the hit-test
 * responder to each screen srcdoc without rebuilding the entire document.
 */
export function appendHitTestResponder(html: string): string {
  if (html.includes("</body>")) {
    return html.replace(
      "</body>", // i18n-ignore generated iframe HTML marker
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT + "</body>", // i18n-ignore generated iframe HTML injection
    );
  }
  if (html.includes("</html>")) {
    return html.replace(
      "</html>", // i18n-ignore generated iframe HTML marker
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT + "</html>", // i18n-ignore generated iframe HTML injection
    );
  }
  return html + LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT;
}

const EDITOR_BRIDGE_VAR_NAMES = [
  "--design-editor-accent-color",
  "--design-editor-accent-hover-color",
  "--design-editor-selection-color",
  "--design-editor-accent-strong-color",
  "--design-editor-accent-contrast-color",
  "--design-editor-measure-color",
  "--background",
  "--foreground",
  "--border",
];

function readEditorBridgeThemeVars(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const styles = window.getComputedStyle(document.documentElement);
  return Object.fromEntries(
    EDITOR_BRIDGE_VAR_NAMES.map((name) => [
      name,
      styles.getPropertyValue(name).trim(),
    ]).filter(([, value]) => value.length > 0),
  );
}

function createEditorBridgeThemeScript(vars: Record<string, string>) {
  const serializedVars = JSON.stringify(vars).replace(/</g, "\\u003c");
  return `
<script data-agent-native-editor-theme>
(function() {
  var vars = ${serializedVars};
  var root = document.documentElement;
  Object.keys(vars).forEach(function(name) {
    root.style.setProperty(name, vars[name]);
  });
})();
</script>
`;
}

/**
 * Editor chrome bridge: blocks native iframe app interaction outside Interact
 * mode and replaces it with element hover/selection overlays. Double-click text
 * editing is enabled only while the editor is specifically in Edit mode.
 */
const EDITOR_CHROME_BRIDGE_SCRIPT = `
<script data-agent-native-editor-chrome-bridge>
${editorChromeBridgeScript}
</script>
`;

interface DesignCanvasProps {
  content: string;
  contentKey?: string;
  /**
   * The runtime source tier for this canvas.
   *
   * - `"inline"` (default) — HTML/Alpine `srcdoc` iframe; same-origin null
   *   origin; all bridge scripts injected by DesignCanvas.
   * - `"localhost"` — `src=devServerUrl`; dev server is same-origin in most
   *   setups; bridge trust: origin must match parent or be "null".
   * - `"fusion"` — `src=builderHostedUrl`; cross-origin Builder-hosted app;
   *   bridge trust is relaxed to window-identity only (no origin check) so
   *   the Builder-hosted iframe can communicate with the editor.  The sandbox
   *   grants `allow-same-origin` so the Builder app can reach its own resources.
   *
   * When omitted, DesignCanvas infers the tier from the content value:
   * a value that passes `getExternalPreviewUrl` is treated as `"localhost"`;
   * otherwise `"inline"`.  Pass `sourceType="fusion"` explicitly when the
   * content URL is a Builder-hosted (cross-origin) app so the bridge security
   * model uses window-identity trust instead of same-origin trust.
   */
  sourceType?: "inline" | "localhost" | "fusion";
  /**
   * Explicit Builder-hosted app URL for fusion source rendering.
   *
   * When `sourceType === "fusion"` and this prop is provided, the iframe uses
   * this URL as `src` regardless of what `content` contains.  This lets the
   * caller hold the original inline HTML in `content` (for collab/history
   * purposes) while pointing the canvas at the migrated Builder-hosted app.
   *
   * When absent and `sourceType === "fusion"`, the component falls back to
   * the existing external-URL detection on `content` (i.e. if `content` is
   * itself a URL it is used as-is, which is the pattern when the branch URL
   * has been written into the design file content).
   *
   * For `"inline"` and `"localhost"` sources this prop is ignored.
   */
  fusionUrl?: string;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  deviceFrame: DeviceFrameType;
  embeddedFrame?: {
    viewportWidth: number;
    viewportHeight: number;
    displayWidth: number;
    displayHeight: number;
    fluid?: boolean;
  };
  editorChromeScaleX?: number;
  editorChromeScaleY?: number;
  editMode: boolean;
  interactMode: boolean;
  readOnly?: boolean;
  scaleMode?: boolean;
  onElementSelect: (info: ElementInfo) => void;
  onElementHover: (info: ElementInfo | null) => void;
  onClearSelection?: () => void;
  onVisualStyleChange?: (
    selector: string,
    styles: Record<string, string>,
    info?: ElementInfo,
  ) => void;
  onTextContentChange?: (
    selector: string,
    value: string,
    info?: ElementInfo,
    details?: { html?: string },
  ) => void;
  onTextEditingStateChange?: (state: {
    active: boolean;
    selector?: string;
    hasRange?: boolean;
  }) => void;
  onElementDblClickText?: (info: ElementInfo) => void;
  onIframeHotkey?: (event: IframeHotkeyPayload) => void;
  onIframeContextMenu?: (event: IframeContextMenuPayload) => void;
  onVisualStructureChange?: (
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      requestId?: string;
    },
  ) => boolean | void;
  onVisualDuplicateChange?: (
    selector: string,
    cloneHtml: string,
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSelector?: string;
      anchorSourceId?: string;
      placement?: "before" | "after" | "inside";
    },
  ) => boolean | void;
  tweakValues: Record<string, string>;
  /** Whether draw-to-prompt mode is active (overlays the iframe). */
  drawMode?: boolean;
  /** Called when the user exits draw mode (X / Escape / after Send). */
  onExitDrawMode?: () => void;
  /** Whether comment-pin drop mode is active. */
  pinMode?: boolean;
  selectedSelector?: string | null;
  selectedSelectorCandidates?: string[];
  hoveredSelector?: string | null;
  hoveredSelectorCandidates?: string[];
  lockedSelectors?: string[];
  hiddenSelectors?: string[];
  clearSelectionRequest?: number;
  registerRuntimeBridge?: boolean;
  /** Called when the user exits pin mode. */
  onExitPinMode?: () => void;
  /** Stable id of the open design (used for pin scoping + agent prompt). */
  designId?: string;
  /** Human-readable label for the design (used in agent prompt). */
  designTitle?: string;
  /** Stable id for comment pins, usually scoped to the active screen. */
  commentContextId?: string;
  /** Stable id of the screen containing this canvas when rendered in overview. */
  screenId?: string;
  /** Human-readable label for comment-pin prompts. */
  commentContextLabel?: string;
  /**
   * Called when a link inside the prototype points to another screen (a
   * relative href or `data-screen`). Lets the editor switch the active screen
   * instead of letting the iframe navigate to the app. External links are
   * opened in a new tab by the iframe itself and never reach this callback.
   */
  onPrototypeNavigate?: (screen: string, href: string) => void;
  /**
   * Motion tracks to load into the iframe's motion-preview bridge.  Sent via
   * `motion-load-tracks` whenever this prop changes.  When cleared
   * (`undefined` or `[]`) a `motion-preview-clear` message is sent to remove
   * any applied preview overrides.
   *
   * The MotionDock sends scrub ticks as `{ type: 'motion-preview', t,
   * durationMs }` directly from its `canvasIframeRef`.  DesignCanvas only
   * needs the tracks so the bridge can interpolate values at each tick.
   */
  motionTracks?: MotionTrackWire[];
  /**
   * Explicit iframe width in pixels.  When provided it overrides the width
   * derived from `deviceFrame`, enabling per-breakpoint preview (e.g. Mobile
   * 390 / Tablet 768 / Desktop 1280 side-by-side frames in the overview).
   * The height still comes from `deviceFrame`; `deviceFrame="none"` keeps
   * 100% height.
   */
  previewWidthPx?: number;
  /**
   * Shader-fill CSS preview to apply to a selected element inside the iframe.
   *
   * When set, the canvas sends a `shader-fill-preview` bridge message that
   * applies the CSS `background` value on the target element **without
   * persisting anything**.  When cleared (`null` / `undefined`) a
   * `shader-fill-preview-clear` message is sent to restore the original
   * background.
   *
   * Preview-only — never writes to DB, Yjs, or source.  Part of the §6.7
   * shader-fill PREVIEW path; the apply path remains gated until runtime
   * rendering + source-write + diff proof are all in place.
   */
  shaderFillPreview?: {
    /** CSS selector for the target element (preferred over nodeId). */
    selector?: string;
    /** data-agent-native-node-id value for the target element. */
    nodeId?: string;
    /** The CSS `background` value returned by preview-shader-fill. */
    css: string;
  } | null;
  /**
   * Called when the user clicks the component-instance source tag (the
   * "ComponentName →" pill that floats above a selected component root).
   * The parent should invoke `open-component-source` with these params.
   */
  onComponentSourceJump?: (params: {
    nodeId: string;
    componentName: string;
  }) => void;
}

function getExternalPreviewUrl(content: string): string | null {
  const trimmed = content.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export interface IframeHotkeyPayload {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

export interface IframeContextMenuPayload {
  clientX: number;
  clientY: number;
  viewportClientX?: number;
  viewportClientY?: number;
  info?: ElementInfo | null;
}

export function DesignCanvas({
  content,
  contentKey,
  sourceType,
  fusionUrl,
  zoom,
  onZoomChange,
  deviceFrame,
  embeddedFrame,
  editorChromeScaleX = 1,
  editorChromeScaleY = editorChromeScaleX,
  editMode,
  interactMode,
  readOnly = false,
  scaleMode = false,
  clearSelectionRequest,
  onElementSelect,
  onElementHover,
  onClearSelection,
  onVisualStyleChange,
  onTextContentChange,
  onTextEditingStateChange,
  onElementDblClickText,
  onIframeHotkey,
  onIframeContextMenu,
  onVisualStructureChange,
  onVisualDuplicateChange,
  tweakValues,
  drawMode,
  onExitDrawMode,
  pinMode,
  selectedSelector,
  selectedSelectorCandidates = [],
  hoveredSelector,
  hoveredSelectorCandidates = [],
  lockedSelectors = [],
  hiddenSelectors = [],
  onExitPinMode,
  registerRuntimeBridge = true,
  designId,
  designTitle,
  commentContextId,
  screenId,
  commentContextLabel,
  onPrototypeNavigate,
  motionTracks,
  previewWidthPx,
  onComponentSourceJump,
  shaderFillPreview,
}: DesignCanvasProps) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const previousContentKeyRef = useRef(contentKey);
  const [renderedContent, setRenderedContent] = useState(content);
  const [annotationPins, setAnnotationPins] = useState<CanvasPin[]>([]);
  const [pinSubmitSignal, setPinSubmitSignal] = useState(0);
  const isEmbeddedFrame = Boolean(embeddedFrame);
  // Resolve the URL to render in the iframe:
  // 1. When sourceType === "fusion" and fusionUrl is set, prefer the explicit
  //    Builder-hosted URL over whatever is in `content` (which may still be the
  //    original inline HTML).
  // 2. Otherwise fall back to the content-based URL detection (handles the case
  //    where the branch URL has been written into the design file content, or
  //    where the localhost URL is the file content).
  const externalPreviewUrl = useMemo(() => {
    if (sourceType === "fusion" && fusionUrl) {
      try {
        const url = new URL(fusionUrl);
        url.hash = "";
        return url.toString();
      } catch {
        // fall through to content detection below
      }
    }
    return getExternalPreviewUrl(renderedContent);
  }, [fusionUrl, renderedContent, sourceType]);
  zoomRef.current = zoom;

  const queuedAnnotationPins = useMemo(
    () =>
      annotationPins.filter(
        (pin) => pin.queued && !pin.submitted && (pin.draft || "").trim(),
      ),
    [annotationPins],
  );

  useEffect(() => {
    if (previousContentKeyRef.current !== contentKey) {
      previousContentKeyRef.current = contentKey;
      setRenderedContent(content);
    }
    // Same-screen visual edits are already applied optimistically inside the
    // iframe before the source write is queued. Rebuilding srcdoc for that echo
    // reloads the iframe, flashes unstyled content, and drops selection. Only a
    // content-key change (screen switch / explicit remount) should replace the
    // iframe document here; the bridge replays inspector state after that load.
  }, [content, contentKey]);

  usePinchZoom({
    containerRef: scrollContainerRef,
    zoom,
    setZoom: onZoomChange ?? (() => {}),
    min: 10,
    max: 500,
    zoomToCursor: deviceFrame === "none",
    enabled: Boolean(onZoomChange),
  });

  // Build the srcdoc. The tweak bridge ALWAYS goes in so the panel works
  // outside Edit mode. The editor chrome bridge is omitted for Interact mode
  // so preview/app users can interact with the app normally.
  //
  // readOnly is intentionally NOT a dep here: the bridge is injected whenever
  // !interactMode and the initial __READ_ONLY__ placeholder is baked from the
  // *first* render only. After that, live readOnly changes flow through the
  // set-read-only postMessage (see the useEffect below) so switching the active
  // surface (board ↔ screen) never rebuilds srcdoc / reloads the iframe.
  const srcdoc = useMemo(() => {
    if (externalPreviewUrl) return undefined;
    const editorChromeBridge = interactMode
      ? ""
      : createEditorBridgeThemeScript(readEditorBridgeThemeVars()) +
        EDITOR_CHROME_BRIDGE_SCRIPT.replace(
          "__READ_ONLY__",
          readOnly ? "true" : "false",
        )
          .replace("__TEXT_EDITING_ENABLED__", editMode ? "true" : "false")
          .replace("__EDITOR_CHROME_SCALE_X__", String(editorChromeScaleX))
          .replace("__EDITOR_CHROME_SCALE_Y__", String(editorChromeScaleY));
    const embeddedWheelBridge = EMBEDDED_WHEEL_BRIDGE_SCRIPT.replace(
      "__EMBEDDED_WHEEL_FORWARDING_ENABLED__",
      isEmbeddedFrame ? "true" : "false",
    );
    const bridgeToInject =
      MOTION_PREVIEW_BRIDGE_SCRIPT +
      SHADER_FILL_PREVIEW_BRIDGE_SCRIPT +
      TWEAK_BRIDGE_SCRIPT +
      ZOOM_BRIDGE_SCRIPT +
      NAV_BRIDGE_SCRIPT +
      embeddedWheelBridge +
      editorChromeBridge;
    if (renderedContent.includes("</body>")) {
      return renderedContent.replace("</body>", bridgeToInject + "</body>"); // i18n-ignore generated iframe HTML injection
    }
    if (renderedContent.includes("</html>")) {
      return renderedContent.replace("</html>", bridgeToInject + "</html>"); // i18n-ignore generated iframe HTML injection
    }
    // No body/html tags — wrap it
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${renderedContent}${bridgeToInject}</body></html>`;
    // editorChromeScaleX/Y are intentionally NOT deps: they only seed the initial
    // baked chrome scale. Live zoom updates flow through the set-editor-chrome-scale
    // postMessage above. Including them here rebuilds srcdoc on every zoom commit,
    // which reloads the iframe and flashes the screen content white.
    // readOnly is intentionally NOT a dep: live changes flow through set-read-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editMode,
    externalPreviewUrl,
    interactMode,
    isEmbeddedFrame,
    renderedContent,
  ]);

  // Listen for messages from the iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      const iframeWindow = iframeRef.current?.contentWindow;
      // For fusion sources the Builder-hosted app is cross-origin, so the strict
      // `origin === parentOrigin` check can never match. We still require window
      // identity (the message must come from our own iframe window, not any
      // arbitrary cross-origin frame), AND we validate the message origin
      // against a Builder-host allowlist (the configured fusionUrl origin or the
      // *.builder.io family) before relaxing the origin check. If the origin is
      // not on the allowlist we keep the strict check so a hostile frame that
      // somehow shares our window reference still can't be trusted.
      const trusted =
        sourceType === "fusion"
          ? iframeWindow != null &&
            e.source === iframeWindow &&
            isAllowedFusionOrigin(e.origin, fusionUrl)
          : isTrustedCanvasBridgeMessage({
              source: e.source,
              origin: e.origin,
              iframeWindow,
              parentOrigin: window.location.origin,
            });
      if (!trusted) {
        return;
      }
      if (!e.data || !e.data.type) return;
      if (e.data.type === "clear-selection") {
        onClearSelection?.();
        return;
      }
      if (e.data.type === "element-select") {
        onElementSelect(e.data.payload);
      }
      if (e.data.type === "element-hover") {
        onElementHover(e.data.payload);
      }
      if (e.data.type === "visual-style-change") {
        const selector = String(e.data.selector || "");
        const styles =
          e.data.styles && typeof e.data.styles === "object"
            ? (e.data.styles as Record<string, string>)
            : {};
        if (selector && Object.keys(styles).length > 0) {
          onVisualStyleChange?.(selector, styles, e.data.payload);
        }
        return;
      }
      if (e.data.type === "text-content-change") {
        const selector = String(e.data.selector || "");
        const value = String(e.data.value ?? "");
        const html =
          typeof e.data.html === "string" ? String(e.data.html) : undefined;
        if (selector) {
          onTextContentChange?.(selector, value, e.data.payload, { html });
        }
        return;
      }
      if (e.data.type === "visual-structure-change") {
        const selector = String(e.data.selector || "");
        const anchorSelector = String(e.data.anchorSelector || "");
        const placement = String(e.data.placement || "after");
        const requestId =
          typeof e.data.requestId === "string" ? e.data.requestId : undefined;
        const sourceId =
          typeof e.data.sourceId === "string" ? e.data.sourceId : undefined;
        const anchorSourceId =
          typeof e.data.anchorSourceId === "string"
            ? e.data.anchorSourceId
            : undefined;
        if (
          (selector || sourceId) &&
          (anchorSelector || anchorSourceId) &&
          (placement === "before" ||
            placement === "after" ||
            placement === "inside")
        ) {
          const applied = onVisualStructureChange?.(
            selector,
            anchorSelector,
            placement,
            e.data.payload,
            {
              requestId,
              sourceId,
              anchorSourceId,
            },
          );
          if (requestId) {
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "visual-structure-ack",
                requestId,
                applied: applied !== false,
              },
              "*",
            );
          }
        }
        return;
      }
      if (e.data.type === "visual-duplicate-change") {
        const selector = String(e.data.selector || "");
        const cloneHtml =
          typeof e.data.cloneHtml === "string" ? String(e.data.cloneHtml) : "";
        const placement = String(e.data.placement || "after");
        if (
          selector &&
          cloneHtml &&
          (placement === "before" ||
            placement === "after" ||
            placement === "inside")
        ) {
          onVisualDuplicateChange?.(selector, cloneHtml, e.data.payload, {
            sourceId:
              typeof e.data.sourceId === "string" ? e.data.sourceId : undefined,
            anchorSelector:
              typeof e.data.anchorSelector === "string"
                ? e.data.anchorSelector
                : undefined,
            anchorSourceId:
              typeof e.data.anchorSourceId === "string"
                ? e.data.anchorSourceId
                : undefined,
            placement,
          });
        }
        return;
      }
      if (e.data.type === "text-editing-state") {
        onTextEditingStateChange?.({
          active: Boolean(e.data.active),
          selector:
            typeof e.data.selector === "string" ? e.data.selector : undefined,
          hasRange: Boolean(e.data.hasRange),
        });
        return;
      }
      if (e.data.type === "element-dblclick-text") {
        onElementDblClickText?.(e.data.payload);
        return;
      }
      if (e.data.type === "design-hotkey") {
        onIframeHotkey?.({
          key: String(e.data.key || ""),
          code: String(e.data.code || ""),
          metaKey: Boolean(e.data.metaKey),
          ctrlKey: Boolean(e.data.ctrlKey),
          shiftKey: Boolean(e.data.shiftKey),
          altKey: Boolean(e.data.altKey),
          repeat: Boolean(e.data.repeat),
        });
        return;
      }
      if (e.data.type === "element-contextmenu") {
        const clientX = Number(e.data.clientX);
        const clientY = Number(e.data.clientY);
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
          const iframe = iframeRef.current;
          const iframeRect = iframe?.getBoundingClientRect();
          const scaleX =
            iframe && iframeRect && iframe.clientWidth > 0
              ? iframeRect.width / iframe.clientWidth
              : 1;
          const scaleY =
            iframe && iframeRect && iframe.clientHeight > 0
              ? iframeRect.height / iframe.clientHeight
              : 1;
          onIframeContextMenu?.({
            clientX,
            clientY,
            viewportClientX: (iframeRect?.left ?? 0) + clientX * scaleX,
            viewportClientY: (iframeRect?.top ?? 0) + clientY * scaleY,
            info: e.data.payload ?? null,
          });
        }
        return;
      }
      if (e.data.type === "prototype-navigate") {
        // External links are opened inside the iframe (sandbox allow-popups);
        // only internal screen switches reach the parent.
        onPrototypeNavigate?.(
          String(e.data.screen || ""),
          String(e.data.href || ""),
        );
        return;
      }
      if (e.data.type === "component-source-jump") {
        // The user clicked the component-instance tag ("ComponentName →").
        // Relay to the parent so it can invoke open-component-source.
        const nodeId = String(e.data.nodeId || "");
        const componentName = String(e.data.componentName || "");
        if (nodeId && componentName) {
          onComponentSourceJump?.({ nodeId, componentName });
        }
        return;
      }
      if (e.data.type === "embedded-canvas-wheel") {
        if (!isEmbeddedFrame) return;
        const iframe = iframeRef.current;
        if (!iframe) return;
        const rect = iframe.getBoundingClientRect();
        const scaleX =
          iframe.clientWidth > 0 ? rect.width / iframe.clientWidth : 1;
        const scaleY =
          iframe.clientHeight > 0 ? rect.height / iframe.clientHeight : 1;
        const clientX = rect.left + Number(e.data.clientX || 0) * scaleX;
        const clientY = rect.top + Number(e.data.clientY || 0) * scaleY;
        const forwarded = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: Math.max(-240, Math.min(240, Number(e.data.deltaX) || 0)),
          deltaY: Math.max(-240, Math.min(240, Number(e.data.deltaY) || 0)),
          deltaZ: Math.max(-240, Math.min(240, Number(e.data.deltaZ) || 0)),
          deltaMode: Number(e.data.deltaMode) || WheelEvent.DOM_DELTA_PIXEL,
          clientX,
          clientY,
          ctrlKey: Boolean(e.data.ctrlKey),
          metaKey: Boolean(e.data.metaKey),
          shiftKey: Boolean(e.data.shiftKey),
          altKey: Boolean(e.data.altKey),
        });
        iframe.dispatchEvent(forwarded);
        return;
      }
      if (e.data.type === "pinch-zoom-wheel") {
        if (!onZoomChange) return;
        const iframe = iframeRef.current;
        const scroll = scrollContainerRef.current;
        if (!iframe || !scroll) return;
        // Mirror usePinchZoom's algorithm here. We can't reliably re-dispatch
        // a synthetic WheelEvent to trigger the hook's listener — untrusted
        // events are inconsistent across browsers — so just compute the
        // next zoom directly using the same exponential factor + cursor-anchor
        // math. Clamp range matches the usePinchZoom call above (10–500).
        const currentZoom = zoomRef.current;
        const clampedDelta = Math.max(-50, Math.min(50, e.data.deltaY));
        const factor = Math.exp(-clampedDelta * 0.01);
        const nextZoom = Math.max(10, Math.min(500, currentZoom * factor));
        if (nextZoom === currentZoom) return;
        if (deviceFrame === "none") {
          // The iframe lives inside a `transform: scale(zoom/100)` wrapper, so
          // its visual scale relative to viewport is currentZoom / 100. Convert
          // the iframe-document point under the cursor → viewport point →
          // scroll-content point, then preserve cursor anchoring while zooming.
          const iframeRect = iframe.getBoundingClientRect();
          const scrollRect = scroll.getBoundingClientRect();
          const scale = currentZoom / 100;
          const viewportX = iframeRect.left + e.data.clientX * scale;
          const viewportY = iframeRect.top + e.data.clientY * scale;
          const cx = viewportX - scrollRect.left + scroll.scrollLeft;
          const cy = viewportY - scrollRect.top + scroll.scrollTop;
          const ratio = nextZoom / currentZoom;
          const dx = cx * (ratio - 1);
          const dy = cy * (ratio - 1);
          onZoomChange(nextZoom);
          requestAnimationFrame(() => {
            scroll.scrollLeft += dx;
            scroll.scrollTop += dy;
          });
        } else {
          onZoomChange(nextZoom);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    onElementSelect,
    onElementHover,
    onClearSelection,
    onVisualStyleChange,
    onTextContentChange,
    onTextEditingStateChange,
    onElementDblClickText,
    onIframeHotkey,
    onIframeContextMenu,
    onVisualStructureChange,
    onVisualDuplicateChange,
    onZoomChange,
    deviceFrame,
    onPrototypeNavigate,
    onComponentSourceJump,
    isEmbeddedFrame,
    sourceType,
    fusionUrl,
  ]);

  const replayIframeEditorState = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.contentWindow?.postMessage(
      { type: "tweak-values", values: tweakValues },
      "*",
    );
    iframe.contentWindow?.postMessage(
      { type: "layer-states", lockedSelectors, hiddenSelectors },
      "*",
    );
    iframe.contentWindow?.postMessage(
      { type: "scale-tool-mode", enabled: scaleMode },
      "*",
    );
    iframe.contentWindow?.postMessage(
      selectedSelector
        ? {
            type: "select-element",
            selector: selectedSelector,
            selectorCandidates: selectedSelectorCandidates,
          }
        : { type: "clear-selection" },
      "*",
    );
    iframe.contentWindow?.postMessage(
      hoveredSelector
        ? {
            type: "hover-element",
            selector: hoveredSelector,
            selectorCandidates: hoveredSelectorCandidates,
          }
        : { type: "hover-element", selector: "", selectorCandidates: [] },
      "*",
    );
    // Re-send motion tracks so the preview bridge is ready after a reload.
    if (motionTracks && motionTracks.length > 0) {
      iframe.contentWindow?.postMessage(
        { type: "motion-load-tracks", tracks: motionTracks },
        "*",
      );
    } else {
      iframe.contentWindow?.postMessage({ type: "motion-preview-clear" }, "*");
    }
    // Re-apply the shader-fill preview after a reload so the preview survives
    // screen switches.  Preview-only — never writes to DB, Yjs, or source.
    if (shaderFillPreview) {
      iframe.contentWindow?.postMessage(
        {
          type: "shader-fill-preview",
          selector: shaderFillPreview.selector ?? "",
          nodeId: shaderFillPreview.nodeId ?? "",
          css: shaderFillPreview.css,
        },
        "*",
      );
    } else {
      iframe.contentWindow?.postMessage(
        { type: "shader-fill-preview-clear" },
        "*",
      );
    }
  }, [
    hoveredSelector,
    hoveredSelectorCandidates,
    hiddenSelectors,
    lockedSelectors,
    motionTracks,
    scaleMode,
    selectedSelector,
    selectedSelectorCandidates,
    shaderFillPreview,
    tweakValues,
  ]);

  // Replay the editor state whenever it changes OR the iframe (re)loads. The
  // load case matters for screen switches and mode changes; without replaying
  // selection/layer state here, the freshly mounted document looks deselected.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    replayIframeEditorState();
    iframe.addEventListener("load", replayIframeEditorState);
    return () => iframe.removeEventListener("load", replayIframeEditorState);
  }, [replayIframeEditorState]);

  useEffect(() => {
    if (clearSelectionRequest === undefined) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "clear-selection" },
      "*",
    );
  }, [clearSelectionRequest]);

  // Sync motion tracks to the iframe bridge whenever they change.
  // When motionTracks is empty/undefined, clear any preview overrides so the
  // design returns to its authored state (no stale inline styles).
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (!motionTracks || motionTracks.length === 0) {
      win.postMessage({ type: "motion-preview-clear" }, "*");
    } else {
      win.postMessage(
        { type: "motion-load-tracks", tracks: motionTracks },
        "*",
      );
    }
  }, [motionTracks]);

  // Sync shader-fill preview to the iframe whenever the prop changes.
  // When cleared (null / undefined) send a clear message so the bridge
  // restores the original background on the previously-patched element.
  // Preview-only — never writes to DB, Yjs, or source.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (!shaderFillPreview) {
      win.postMessage({ type: "shader-fill-preview-clear" }, "*");
    } else {
      win.postMessage(
        {
          type: "shader-fill-preview",
          selector: shaderFillPreview.selector ?? "",
          nodeId: shaderFillPreview.nodeId ?? "",
          css: shaderFillPreview.css,
        },
        "*",
      );
    }
  }, [shaderFillPreview]);

  // Push the constant-size chrome scale into the iframe LIVE (CSS vars only) when
  // overview zoom settles. This is intentionally separate from the srcdoc build so
  // a scale change never rebuilds srcdoc / reloads the iframe (which flashes the
  // content white). The baked __EDITOR_CHROME_SCALE__ values cover first paint.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "set-editor-chrome-scale",
        scaleX: editorChromeScaleX,
        scaleY: editorChromeScaleY,
      },
      "*",
    );
  }, [editorChromeScaleX, editorChromeScaleY]);

  // Sync readOnly to the bridge IN-PLACE via postMessage so switching the active
  // surface (board ↔ screen) does not rebuild srcdoc / reload the iframe.
  // The initial baked __READ_ONLY__ placeholder covers first paint; subsequent
  // changes arrive here. Also re-send on iframe load so the bridge is in sync
  // after any content-key-driven reload.
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    function sendReadOnly() {
      iframe!.contentWindow?.postMessage(
        { type: "set-read-only", readOnly: readOnlyRef.current },
        "*",
      );
    }
    sendReadOnly();
    iframe.addEventListener("load", sendReadOnly);
    return () => iframe.removeEventListener("load", sendReadOnly);
    // Only re-run when readOnly changes; iframe identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  /**
   * Trigger immediate text-editing mode for a specific node inside the iframe,
   * identified by its data-agent-native-node-id value.  Call this after
   * programmatically creating a TEXT primitive so the user can type right away
   * without a second click.
   *
   * Posts { type: 'begin-text-edit', nodeId } to the iframe bridge.
   * The bridge enters the same contenteditable text-editing path used on dblclick.
   */
  const beginTextEdit = useCallback((nodeId: string) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !nodeId) return;
    iframe.contentWindow.postMessage(
      { type: "begin-text-edit", nodeId, force: true },
      "*",
    );
  }, []);

  const sendStyleChange = useCallback(
    (
      selector: string,
      property: string,
      value: string,
      options?: { selectorCandidates?: string[]; nodeId?: string | null },
    ) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;
      iframe.contentWindow.postMessage(
        {
          type: "style-change",
          selector,
          property,
          value,
          selectorCandidates: options?.selectorCandidates ?? [],
          nodeId: options?.nodeId ?? "",
        },
        "*",
      );
    },
    [],
  );

  /**
   * Send a motion-preview scrub tick to the iframe.  `t` is the normalised
   * playhead position in [0, 1].  Tracks must have been loaded first via the
   * `motionTracks` prop (or an explicit `motion-load-tracks` message).
   * Preview-only — never writes to DB/Yjs/source.
   */
  const sendMotionPreview = useCallback((t: number, durationMs?: number) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: "motion-preview", t: Math.max(0, Math.min(1, t)), durationMs },
      "*",
    );
  }, []);

  /**
   * Clear all motion-preview inline-style overrides in the iframe and remove
   * the in-memory track list.  Call when the Motion dock is closed.
   */
  const clearMotionPreview = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "motion-preview-clear" },
      "*",
    );
  }, []);

  /**
   * Send a shader-fill CSS preview to the iframe.  Targets the element
   * identified by `selector` (preferred) or `nodeId`.  Preview-only — the
   * bridge script restores the original background on clear.
   */
  const sendShaderFillPreview = useCallback(
    (selector: string, nodeId: string, css: string) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(
        { type: "shader-fill-preview", selector, nodeId, css },
        "*",
      );
    },
    [],
  );

  /**
   * Clear the shader-fill preview in the iframe, restoring the original
   * background on the patched element.  Call when the preview is dismissed
   * or when the selection changes to a different element.
   */
  const clearShaderFillPreview = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "shader-fill-preview-clear" },
      "*",
    );
  }, []);

  const replacePreviewContent = useCallback(
    (nextContent: string, selector?: string | null, candidates?: string[]) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      iframe.contentWindow.postMessage(
        {
          type: "replace-document-content",
          content: nextContent,
          selectedSelector: selector ?? "",
          selectorCandidates: candidates ?? [],
        },
        "*",
      );
      return true;
    },
    [],
  );

  const deleteRuntimeElement = useCallback(
    (selector?: string | null, candidates?: string[]) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      iframe.contentWindow.postMessage(
        {
          type: "delete-element",
          selector: selector ?? "",
          selectorCandidates: candidates ?? [],
        },
        "*",
      );
      return true;
    },
    [],
  );

  // Expose iframe runtime mutations for the editor orchestrator.
  useEffect(() => {
    if (!registerRuntimeBridge) return;
    (window as any).__designCanvasSendStyle = sendStyleChange;
    (window as any).__designCanvasReplaceContent = replacePreviewContent;
    (window as any).__designCanvasDeleteElement = deleteRuntimeElement;
    (window as any).__designCanvasSendMotionPreview = sendMotionPreview;
    (window as any).__designCanvasClearMotionPreview = clearMotionPreview;
    // Shader-fill preview helpers (preview-only, §6.7 gating applies to apply).
    (window as any).__designCanvasSendShaderFillPreview = sendShaderFillPreview;
    (window as any).__designCanvasClearShaderFillPreview =
      clearShaderFillPreview;
    // Imperative text-edit entry — call after creating a TEXT primitive so the
    // user can type immediately without a second click.
    (window as any).__designCanvasBeginTextEdit = beginTextEdit;
    return () => {
      // Identity-guard each delete so a stale unmounting instance never clobbers
      // a freshly mounted instance's bridge during a remount race.
      if ((window as any).__designCanvasSendStyle === sendStyleChange) {
        delete (window as any).__designCanvasSendStyle;
      }
      if (
        (window as any).__designCanvasReplaceContent === replacePreviewContent
      ) {
        delete (window as any).__designCanvasReplaceContent;
      }
      if (
        (window as any).__designCanvasDeleteElement === deleteRuntimeElement
      ) {
        delete (window as any).__designCanvasDeleteElement;
      }
      if (
        (window as any).__designCanvasSendMotionPreview === sendMotionPreview
      ) {
        delete (window as any).__designCanvasSendMotionPreview;
      }
      if (
        (window as any).__designCanvasClearMotionPreview === clearMotionPreview
      ) {
        delete (window as any).__designCanvasClearMotionPreview;
      }
      if (
        (window as any).__designCanvasSendShaderFillPreview ===
        sendShaderFillPreview
      ) {
        delete (window as any).__designCanvasSendShaderFillPreview;
      }
      if (
        (window as any).__designCanvasClearShaderFillPreview ===
        clearShaderFillPreview
      ) {
        delete (window as any).__designCanvasClearShaderFillPreview;
      }
      if ((window as any).__designCanvasBeginTextEdit === beginTextEdit) {
        delete (window as any).__designCanvasBeginTextEdit;
      }
    };
  }, [
    deleteRuntimeElement,
    registerRuntimeBridge,
    replacePreviewContent,
    sendStyleChange,
    sendMotionPreview,
    clearMotionPreview,
    sendShaderFillPreview,
    clearShaderFillPreview,
    beginTextEdit,
  ]);

  // Device dimensions match real-world devices. iframes are replaced elements
  // with an intrinsic 300×150 size, so `aspect-ratio` + `height: auto` doesn't
  // reliably compute height from width — explicit pixel heights are required.
  const deviceDimensions: Record<
    DeviceFrameType,
    { width: string; height: string | null }
  > = {
    none: { width: "100%", height: null },
    desktop: { width: "1280px", height: "800px" }, // 16:10
    tablet: { width: "768px", height: "1024px" }, // iPad
    mobile: { width: "390px", height: "844px" }, // iPhone 14
  };

  const { width: iframeWidth, height: iframeHeight } =
    deviceDimensions[deviceFrame];
  const embeddedFrameFluid = embeddedFrame?.fluid === true;

  // Per-breakpoint override: when previewWidthPx is set it takes priority over
  // the deviceFrame width so the caller can render the same source at an
  // explicit viewport width (e.g. 390 / 768 / 1280 side-by-side breakpoints).
  const resolvedWidth =
    previewWidthPx != null ? `${previewWidthPx}px` : iframeWidth;

  // Wrap the iframe in a positioned container so DrawOverlay /
  // CanvasCommentPins can absolutely-position themselves on top of the
  // iframe. The pin component anchors to `.design-canvas-iframe-wrapper`
  // via canvasSelector.
  //
  // The wrapper carries a faint outline + soft shadow so the frame edge stays
  // visible when a design background matches the editor canvas.
  const iframeElement = (
    <div
      className="design-canvas-iframe-wrapper relative inline-block ring-1 ring-border/60 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.45)]"
      style={{
        width: embeddedFrame
          ? embeddedFrameFluid
            ? "100%"
            : embeddedFrame.viewportWidth
          : resolvedWidth,
        height: embeddedFrame
          ? embeddedFrameFluid
            ? "100%"
            : embeddedFrame.viewportHeight
          : deviceFrame === "none"
            ? "100%"
            : (iframeHeight ?? undefined),
      }}
    >
      <iframe
        ref={iframeRef}
        src={externalPreviewUrl ?? undefined}
        srcDoc={externalPreviewUrl ? undefined : srcdoc}
        sandbox={
          externalPreviewUrl
            ? "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"
            : "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        }
        data-design-preview-iframe
        data-screen-iframe-id={screenId ?? undefined}
        data-design-source-type={
          sourceType ??
          (externalPreviewUrl
            ? "localhost" // inferred — content is a URL
            : "inline")
        }
        className="block h-full w-full border-0 bg-transparent"
        title={t("designEditor.designPreview")}
      />
      {/* Draw-to-prompt overlay — sits over the iframe, NOT inside it. */}
      <SharedDrawOverlay
        visible={!!drawMode}
        canvasInteractive={!pinMode}
        queuedAnnotationCount={queuedAnnotationPins.length}
        zoom={zoom}
        onClose={() => onExitDrawMode?.()}
        onSend={(annotations, instruction, canvasSize) => {
          const summary = annotations
            .map((a) =>
              a.type === "path"
                ? `[stroke ${a.color} w=${a.lineWidth}] ${a.pathData}`
                : `[label "${a.text}" at ${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}]`,
            )
            .join("\n");
          const pinSummary = queuedAnnotationPins
            .flatMap((pin, index) => {
              const lines = [
                `[${index + 1}] Comment pin on ${commentContextLabel || designTitle || commentContextId || designId || "design"}`,
                `Position: ${pin.xPct.toFixed(1)}% from left, ${pin.yPct.toFixed(1)}% from top`,
              ];
              if (pin.targetAnchorId)
                lines.push(`Anchor id: ${pin.targetAnchorId}`);
              if (pin.targetSelector)
                lines.push(`Element: ${pin.targetSelector}`);
              if (pin.targetText)
                lines.push(`Nearby text: "${pin.targetText}"`);
              lines.push("");
              lines.push((pin.draft || "").trim());
              return [...lines, ""];
            })
            .join("\n");
          const lines = [
            `[Annotations on design ${designId || ""}${designTitle ? ` (${designTitle})` : ""}]`,
            `Canvas size: ${canvasSize.width.toFixed(0)}x${canvasSize.height.toFixed(0)}`,
            ...(summary ? ["", "[Drawing]", summary] : []),
            ...(pinSummary ? ["", "[Comment pins]", pinSummary] : []),
            "",
            instruction || "Apply these annotations to the design.",
          ];
          try {
            sendToAgentChat({
              message: lines.join("\n"),
              submit: true,
              openSidebar: true,
            });
          } catch (err) {
            console.error("[DesignCanvas] failed to submit drawing:", err);
          }
          if (queuedAnnotationPins.length > 0) {
            setPinSubmitSignal((signal) => signal + 1);
          }
          onExitDrawMode?.();
        }}
      />
    </div>
  );

  if (embeddedFrame) {
    if (embeddedFrameFluid) {
      return (
        <div
          ref={scrollContainerRef}
          className="relative h-full w-full overflow-hidden"
        >
          {iframeElement}
        </div>
      );
    }

    const scaleX =
      embeddedFrame.displayWidth / Math.max(1, embeddedFrame.viewportWidth);
    const scaleY =
      embeddedFrame.displayHeight / Math.max(1, embeddedFrame.viewportHeight);
    return (
      <div
        ref={scrollContainerRef}
        className="relative h-full w-full overflow-hidden"
        style={{
          width: embeddedFrame.displayWidth,
          height: embeddedFrame.displayHeight,
        }}
      >
        <div
          style={{
            width: embeddedFrame.viewportWidth,
            height: embeddedFrame.viewportHeight,
            transform: `scale(${scaleX}, ${scaleY})`,
            transformOrigin: "top left",
          }}
        >
          {iframeElement}
        </div>
      </div>
    );
  }

  const wrappedContent =
    deviceFrame === "none" ? (
      iframeElement
    ) : (
      <DeviceFrame type={deviceFrame}>{iframeElement}</DeviceFrame>
    );

  return (
    <div
      ref={scrollContainerRef}
      className="relative flex-1 h-full overflow-auto"
    >
      {/* Canvas area. "none" mode fills the canvas (responsive preview);
          framed modes are centered inside the canvas with zoom applied. */}
      {deviceFrame === "none" ? (
        <div className="relative flex h-full w-full items-center justify-center">
          <div
            className="h-full w-full"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "center center",
            }}
          >
            {wrappedContent}
          </div>
        </div>
      ) : (
        <div className="relative flex items-center justify-center min-h-full">
          <div
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "center center",
            }}
          >
            {wrappedContent}
          </div>
        </div>
      )}

      {/* Canvas comment pins — anchored to the iframe wrapper. The pins
          themselves render via fixed positioning, so we mount them outside
          the zoom-transformed container to keep coordinates stable. */}
      <CanvasCommentPins
        active={!!pinMode}
        submitMode={drawMode ? "queue" : "direct"}
        onPinsChange={setAnnotationPins}
        submitQueuedSignal={pinSubmitSignal}
        clickPlaneUnderToolbar={!!drawMode}
        onClose={() => onExitPinMode?.()}
        canvasSelector=".design-canvas-iframe-wrapper"
        contextId={commentContextId || designId || "design"}
        contextLabel={
          commentContextLabel || designTitle || commentContextId || designId
        }
      />
    </div>
  );
}
