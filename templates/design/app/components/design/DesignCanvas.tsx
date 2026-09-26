import {
  callAction,
  useActionQuery,
  usePinchZoom,
} from "@agent-native/core/client/hooks";
import {
  injectSessionReplayIframeBootstrap,
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
} from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { type ReviewThread } from "@agent-native/core/client/review";
import {
  clampZoomFactor,
  normalizeWheelDeltaPx,
  resolveZoomGestureDevice,
  zoomFactorForWheelDelta,
  type ZoomGestureDevice,
} from "@agent-native/core/client/zoom-gesture";
import type { ReviewComment } from "@agent-native/core/review";
import { injectDocumentMarkup } from "@agent-native/core/shared";
import { isLoopbackPreviewAllowed } from "@shared/builder-preview-url";
import {
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  getDraftGeometryFromPoints,
} from "@shared/canvas-math";
import type { InteractionState } from "@shared/interaction-states";
import {
  appendPenNode,
  clonePenPath,
  closePenPath,
  constrainPointTo45Degrees,
  createCornerNode,
  createPenCuspLatch,
  createPenDragNode,
  isPenCloseTarget,
  parsePenNodes,
  resumePenPathAtEnd,
  serializePenPath,
  translatePenPath,
  type PenCuspLatch,
  type PenPath,
  type PenPoint,
} from "@shared/pen-path";
import {
  createSourceDocumentProvenance,
  type SourceDocumentProvenance,
} from "@shared/preview-source-provenance";
import { normalizeScreenHtml } from "@shared/screen-annotation";
import { sourceContentHash } from "@shared/source-workspace";
import { sanitizeVisualEditSnapshotHtml } from "@shared/visual-edit-snapshot";
import { IconPlugConnectedX, IconRefresh } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
// NOTE: This wires up the NEW shared visual-editor DrawOverlay + comment-pin
// components from `@/components/visual-editor`. The legacy iframe-only
// DrawOverlay at `./DrawOverlay.tsx` is intentionally NOT used here — both
// exist for now and can be reconciled in a follow-up. Don't import both.
import {
  DrawOverlay as SharedDrawOverlay,
  ReviewCanvasPins,
  type RepromptDraftRequest,
  type ReviewFocusRequest,
} from "@/components/visual-editor";
import { sendToDesignAgentChatAndConfirm } from "@/lib/agent-chat";
import {
  resolveDesktopDesignSnapshotLayer,
  useDesktopDesignNativePreview,
} from "@/lib/desktop-design-preview";
import { cn } from "@/lib/utils";
import { penPathScreenContentOffset } from "@/pages/design-editor/clone-and-pen-edit";
import {
  pendingVisualStyleRouteMatches,
  runtimeStyleTarget,
} from "@/pages/design-editor/pending-edits";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";
import { embeddedWheelBridgeScript } from "../../../.generated/bridge/embedded-wheel.generated";
import { motionPreviewBridgeScript } from "../../../.generated/bridge/motion-preview.generated";
import { navBridgeScript } from "../../../.generated/bridge/nav.generated";
import { shaderFillPreviewBridgeScript } from "../../../.generated/bridge/shader-fill-preview.generated";
import { shaderRuntimeBridgeScript } from "../../../.generated/bridge/shader-runtime.generated";
import { tweakBridgeScript } from "../../../.generated/bridge/tweak.generated";
import { zoomBridgeScript } from "../../../.generated/bridge/zoom.generated";
import type {
  ReviewAnchorWorldPoint,
  ReviewBoardGeometry,
} from "../../../shared/review-anchor";
import { isTrustedCanvasBridgeMessage } from "./bridge-security";
import { isCanvasOverlayInteractionTarget } from "./canvas-interactions/review-overlay-interaction";
import { captureAnnotatedScreenshot } from "./design-canvas/annotation-snapshot";
import { submitDesignAnnotations } from "./design-canvas/annotation-submit";
import { appendContentSizeReporter } from "./design-canvas/content-size-report";
import {
  getScreenContentPointFromClient,
  getZoomToCursorScrollDelta,
} from "./design-canvas/coordinate-transforms";
import {
  collapseDoubleClickPenAnchor,
  type CreatePrimitiveSpec,
  type CreationTool,
} from "./design-canvas/creation";
import {
  isComputedStyleMap,
  isElementInfoPayload,
  parseRuntimeSnapshotHtml,
} from "./design-canvas/element-payload";
import {
  embeddedContentOffsetCss,
  embeddedContentOffsetStyle,
  getEmbeddedFrameBackgroundStyle,
  getEmbeddedFrameDocumentContent,
  getEmbeddedIframeBackgroundColor,
} from "./design-canvas/embedded-frame";
import {
  classifyBridgeRegistrationFailure,
  getDesignCanvasIframeSandbox,
  getDesignCanvasIframeAllow,
  getLocalNetworkAccessPermissionState,
  getSnapshotRetryDelayMs,
  isPreviewTokenStaleStatus,
  resolveLiveEditPreviewUrl,
  sanitizeLocalhostSourceSnapshotHtml,
  shouldFetchExternalSourceSnapshot,
  shouldUseIframeLoadReadyFallback,
  type BridgeRegistrationFailureKind,
  type LocalNetworkAccessPermissionState,
  useBrowserOrigin,
} from "./design-canvas/external-preview";
import { isOsFileDragEvent } from "./design-canvas/file-drop";
import {
  LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT,
  sourceProvenanceBootstrap,
} from "./design-canvas/hit-test";
import type {
  IframeContextMenuPayload,
  IframeFigmaClipboardPastePayload,
  IframeHotkeyPayload,
  IframeImagePastePayload,
} from "./design-canvas/iframe-events";
import {
  forwardEmbeddedCanvasPanMessage,
  type EmbeddedCanvasPanSession,
} from "./design-canvas/iframe-pan";
import { withLocalRuntimes } from "./design-canvas/local-runtime";
import { LocalNetworkAccessPrompt } from "./design-canvas/LocalNetworkAccessPrompt";
import type { MotionTrackWire } from "./design-canvas/motion-types";
import {
  acknowledgePendingTextInsert,
  beginPendingTextDelivery,
  type BeginTextEditOptions,
  cancelPendingTextCapture,
  isPendingTextInterceptionOpen,
  onPendingTextCaptureCancel,
  owePendingTextCapture,
  registerTextEditOwner,
  releasePendingTextCapture,
  returnPendingTextCapture,
  takePendingTextCapture,
} from "./design-canvas/pending-text-capture";
import {
  BRIDGE_READINESS_PROBE_ATTEMPTS,
  BRIDGE_READINESS_PROBE_INTERVAL_MS,
  PENDING_TEXT_EDIT_TIMEOUT_MS,
  routePendingTextEditKey,
  schedulePendingTextEditActivation,
} from "./design-canvas/pending-text-edit";
import { DeviceFrame } from "./DeviceFrame";
import { dndHostLog } from "./dnd-debug";
import type { RelativeStyleOperation } from "./edit-panel/style-change-types";
import { getBoardSurfaceRenderContent } from "./multi-screen/board-surface-html";
import { shapeClosingHandles } from "./multi-screen/draft-primitives";
import {
  registerLinkedScreenPreviewHandlers,
  replaceLinkedScreenPreviewContent,
  sendLinkedScreenPreviewStyleChange,
} from "./multi-screen/linked-screen-preview";
import type { KScaleStyleChange } from "./multi-screen/types";
import {
  getIframePaintRetentionStyle,
  SCALED_IFRAME_PAINT_RETENTION_STYLE,
} from "./scaled-iframe-paint";
import type {
  ElementInfo,
  GridGroupStructureMove,
  ElementSelectionIntent,
  DeviceFrameType,
  RuntimeStructureDeleteRequest,
  RuntimeLayerRenameRequest,
  RuntimeStructureInsertRequest,
  RuntimeStructureMoveRequest,
  RuntimeStructureRollbackRequest,
  RuntimeVerificationRequest,
  TextEditingState,
} from "./types";

function getSingleScreenZoomTransform(
  zoom: number,
  deviceFrame: DeviceFrameType,
  centerInteractPreview: boolean,
) {
  const scale = zoom / 100;
  if (centerInteractPreview || deviceFrame !== "none") {
    return `scale(${scale})`;
  }
  return zoom < 100
    ? `translate(${(100 - zoom) / 2}%, ${(100 - zoom) / 2}%) scale(${scale})`
    : `scale(${scale})`;
}

function parseKScaleStyleChangeBatch(
  value: unknown,
): KScaleStyleChange[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const changes: KScaleStyleChange[] = [];
  for (const change of value) {
    if (!change || typeof change !== "object" || Array.isArray(change))
      return null;
    const candidate = change as Record<string, unknown>;
    if (
      typeof candidate.selector !== "string" ||
      candidate.selector.trim() === "" ||
      (candidate.sourceId !== undefined &&
        (typeof candidate.sourceId !== "string" ||
          candidate.sourceId.trim() === "")) ||
      !candidate.styles ||
      typeof candidate.styles !== "object" ||
      Array.isArray(candidate.styles)
    ) {
      return null;
    }
    const rawStyles = candidate.styles as Record<string, unknown>;
    const styleEntries = Object.entries(rawStyles);
    if (
      styleEntries.length === 0 ||
      styleEntries.some(
        ([property, styleValue]) =>
          property.trim() === "" ||
          typeof styleValue !== "string" ||
          styleValue.trim() === "",
      )
    ) {
      return null;
    }
    let originalStyles: Record<string, string> | undefined;
    if (candidate.originalStyles !== undefined) {
      if (
        !candidate.originalStyles ||
        typeof candidate.originalStyles !== "object" ||
        Array.isArray(candidate.originalStyles)
      ) {
        return null;
      }
      const originalEntries = Object.entries(candidate.originalStyles);
      if (
        originalEntries.some(
          ([property, styleValue]) =>
            property.trim() === "" || typeof styleValue !== "string",
        )
      ) {
        return null;
      }
      originalStyles = Object.fromEntries(originalEntries) as Record<
        string,
        string
      >;
    }
    let elementInfo: ElementInfo | undefined;
    if (candidate.elementInfo !== undefined) {
      if (!isElementInfoPayload(candidate.elementInfo)) return null;
      elementInfo = candidate.elementInfo;
    }
    if (
      candidate.preserveSelection !== undefined &&
      typeof candidate.preserveSelection !== "boolean"
    ) {
      return null;
    }
    changes.push({
      selector: candidate.selector,
      ...(typeof candidate.sourceId === "string"
        ? { sourceId: candidate.sourceId }
        : {}),
      ...(elementInfo ? { elementInfo } : {}),
      styles: Object.fromEntries(styleEntries) as Record<string, string>,
      ...(originalStyles ? { originalStyles } : {}),
      ...(candidate.preserveSelection === true
        ? { preserveSelection: true }
        : {}),
    });
  }
  return changes;
}

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
  // Only allow secure (https) Builder origins. Loopback is a development-only
  // exception: without it every bridge message from a local proxy is dropped.
  if (protocol !== "https:") {
    const loopbackDev =
      isLoopbackPreviewAllowed() &&
      (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
    if (!loopbackDev) return false;
    return true;
  }
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
 * Motion-preview bridge. Injected alongside the other bridge scripts so the
 * MotionDock's scrubbing preview works in ALL editor modes without writing
 * anything to the DB, Yjs state, or source files.
 *
 * Source: app/components/design/bridge/motion-preview.bridge.ts
 * Compiled: .generated/bridge/motion-preview.generated.ts (run bridge/codegen.ts to update)
 */
/** Focus here is the user's text-entry intent, not incidental chrome focus. */
const EDITABLE_FOCUS_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="textbox"], [data-agent-native-text-editing]';

const MOTION_PREVIEW_BRIDGE_SCRIPT = `
<script data-agent-native-motion-preview-bridge>
${motionPreviewBridgeScript}
</script>
`;

/**
 * Shader scripts. ALWAYS injected alongside the other bridge scripts:
 *
 * 1. The code-backed GLSL shader RUNTIME (window.__anShaders) — renders
 *    persisted `<script type="application/x-agent-native-shader">` blocks
 *    onto annotated elements via WebGL, and powers live GLSL previews.
 *    Persisted screens embed their own copy for standalone export; the
 *    runtime is idempotent so double-injection is safe. Source of truth:
 *    app/components/design/bridge/shader-runtime.bridge.ts (also embedded
 *    into saved HTML by shared/shader-fills.ts ensureShaderRuntime()).
 *
 * 2. The shader-fill preview BRIDGE — postMessage protocol handler. Legacy
 *    messages apply a CSS gradient approximation of a shader fill to the
 *    selected element; `glsl-shader-*` messages delegate to the runtime for
 *    live WebGL previews, knob scrubbing, and rescans. Nothing persists.
 *
 * Source: app/components/design/bridge/shader-fill-preview.bridge.ts
 * Compiled: .generated/bridge/*.generated.ts (run bridge/codegen.ts to update)
 */
const SHADER_FILL_PREVIEW_BRIDGE_SCRIPT = `
<script data-agent-native-shader-runtime data-runtime-version="1">
${shaderRuntimeBridgeScript}
</script>
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

// URL-backed frames keep running their app in Interact mode, so the editor
// chrome is intentionally absent there. Report client-side router changes
// through the same trusted frame channel so returning to Edit reopens the
// route the user was actually viewing instead of the screen's seed URL.
const LIVE_ROUTE_BRIDGE_SCRIPT = `
<script data-agent-native-live-route-bridge>
(function () {
  function report() {
    try {
      window.parent.postMessage({
        type: "agent-native:live-route-path",
        routePath: window.location.pathname + window.location.search + window.location.hash
      }, "*");
    // A frame can be torn down while reporting navigation; there is no parent
    // message to recover or retry after that document disappears.
    // coercion-ok: frame teardown makes this best-effort report unreachable.
    } catch (_) {}
  }
  var pushState = window.history.pushState;
  var replaceState = window.history.replaceState;
  window.history.pushState = function () {
    var result = pushState.apply(this, arguments);
    report();
    return result;
  };
  window.history.replaceState = function () {
    var result = replaceState.apply(this, arguments);
    report();
    return result;
  };
  window.addEventListener("popstate", report);
  window.addEventListener("hashchange", report);
  report();
})();
</script>
`;

const EDITOR_BRIDGE_VAR_NAMES = [
  "--design-editor-accent-color",
  "--design-editor-accent-hover-color",
  "--design-editor-selection-color",
  "--design-editor-accent-strong-color",
  "--design-editor-accent-contrast-color",
  "--design-editor-component-color",
  "--design-editor-component-hover-color",
  "--design-editor-component-selection-color",
  "--design-editor-component-strong-color",
  "--design-editor-component-contrast-color",
  "--design-editor-measure-color",
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
  window.__anEditorBridgeThemeVars = vars;
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
<script type="module" data-agent-native-editor-chrome-bridge>
${editorChromeBridgeScript}
</script>
`;

/**
 * Master switch for the Figma-parity live-reflow drag (hysteresis-stabilized
 * targeting + size guard in Phase 0; transform lift/follow, live sibling
 * reflow, and exact absolute commit in Phase 1). Flip to `true` to try the new
 * drag feel; flip back to `false` for the previous behavior without a revert.
 * Baked into the injected bridge as `__LIVE_REFLOW_ENABLED__`.
 */
const LIVE_REFLOW_ENABLED = true;

/**
 * Rollout gate: when on, a pointerdown inside the current selection's box keeps
 * the selected element as the drag target even when an overlapping
 * non-descendant sibling wins the hit test. Baked into the bridge as
 * `__SELECTED_LAYER_DRAG_PRIORITY__`; flip to `false` for descendant-only
 * behavior.
 */
const SELECTED_LAYER_DRAG_PRIORITY_ENABLED = true;

/**
 * A style replay into the live iframe. `runtimeSelector`/`runtimeSourceId` are
 * the only pair that resolves in a localhost document — see
 * `runtimeStyleTarget` for the two-namespace problem they exist for.
 */
type StyleReplayPatch = {
  selector: string;
  sourceId?: string | null;
  runtimeSelector?: string | null;
  runtimeSourceId?: string | null;
  routePath?: string;
  styles: Record<string, string>;
  interactionState?: InteractionState;
};

type BridgeRegistrationAttemptResult = boolean | "stale-preview-token" | null;

export type EditorDragStateChange = {
  active: boolean;
  screenId?: string;
  dragId?: string;
  eventAt?: number;
  preview?: {
    phase: "preview" | "clear";
    sourceId?: string;
    anchorId?: string;
    placement?: "before" | "after" | "inside";
    insert?: boolean;
  };
};

interface DesignCanvasProps {
  content: string;
  contentKey?: string;
  /**
   * The runtime source tier for this canvas.
   *
   * - `"inline"` (default) — HTML/Alpine `srcdoc` iframe; all bridge scripts
   *   injected by DesignCanvas. Read-only frames get an opaque origin;
   *   editable frames temporarily retain the parent origin for the live-DOM
   *   editor features documented by getDesignCanvasIframeSandbox.
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
  /** Local design-connect bridge URL used to fetch editable snapshots for URL-backed localhost screens. */
  bridgeUrl?: string;
  /** Authoritative URL for a live screen when its persisted source is changing. */
  previewUrlOverride?: string;
  /** Stable local/Fusion connection scope for desktop session isolation. */
  connectionId?: string;
  /** Only the active focused/overview screen may own the desktop native backend. */
  nativePreviewActive?: boolean;
  /** Only the focused shared screen polls for new owner snapshots. */
  sharedSnapshotPollActive?: boolean;
  /**
   * HTML snapshot for a URL-backed localhost screen. When present, DesignCanvas
   * renders this as editable srcdoc while the persisted design file can remain
   * the original URL.
   */
  externalSnapshotHtml?: string;
  /** Render the shared snapshot without ever navigating to a viewer's localhost. */
  snapshotOnly?: boolean;
  /** Prevent an Interact frame from taking input while shared edits are pending. */
  blockPreviewInteraction?: boolean;
  onExternalContentSnapshot?: (snapshot: {
    url: string;
    html: string;
    status?: number;
    contentType?: string;
  }) => void;
  onRuntimeLayerSnapshot?: (snapshot: {
    html: string;
    nodeCount: number;
    documentId?: string;
    reservationToken?: string;
  }) => void;
  onReserveVisualEditSnapshot?: (screenId?: string) => Promise<{
    reservationToken: string;
  }>;
  /** Called once when this document has a usable runtime bridge. */
  onBridgeReady?: () => void;
  /** Publishes a refreshed localhost preview credential to the host editor. */
  onPreviewTokenChange?: (
    screenId: string | undefined,
    previewToken: string,
  ) => void;
  onLiveEditCapabilityChange?: (
    screenId: string | undefined,
    capability: string,
  ) => void;
  onLiveEditRegistrationCapabilityChange?: (
    screenId: string | undefined,
    capability: string,
  ) => void;
  /** Keeps route-scoped pending edits aligned with the live document. */
  onRoutePathChange?: (screenId: string | undefined, routePath: string) => void;
  /** Called once when the live document finishes its browser load. */
  onBootStart?: () => void;
  onBootReady?: () => void;
  onScreenRootComputedStyles?: (computedStyles: Record<string, string>) => void;
  onRuntimeVerificationSnapshot?: (snapshot: {
    requestId: number;
    html: string;
    nodeCount: number;
    documentId?: string;
  }) => void;
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
  /** Read-only localhost bridge credential. Filesystem write tokens never enter
   * this browser component. */
  previewToken?: string;
  /** Design-bound credential for live-edit bridge operations only. */
  liveEditCapability?: string;
  /** Design-bound credential for registering the ephemeral editor chrome. */
  liveEditRegistrationCapability?: string;
  /** The public visual-edit surface may refresh its connection credentials. */
  publicVisualEdit?: boolean;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  deviceFrame: DeviceFrameType;
  embeddedFrame?: {
    viewportWidth: number;
    viewportHeight: number;
    displayWidth: number;
    displayHeight: number;
    fluid?: boolean;
    contentOffsetX?: number;
    contentOffsetY?: number;
  };
  boardSurface?: boolean;
  /** Override the overview default so an explicitly Hug-sized Screen can
   * report natural body height instead of inheriting its current frame. */
  fitRootBodyToFrame?: boolean;
  /**
   * Optional live document replacement channel. When paired with
   * `runtimeReplacementKey`, this lets callers update iframe DOM through the
   * editor bridge without changing `srcDoc` and reloading the iframe.
   */
  runtimeReplacementContent?: string;
  /** Exact authored bytes before board/frame/runtime display wrappers. */
  authoredSourceContent?: string;
  runtimeReplacementKey?: string;
  styleRevertRequest?: {
    requestId: number;
    patches: Array<StyleReplayPatch>;
  } | null;
  /** Steady-state live style previews replayed after this iframe document
   * announces readiness. Entries are screen-scoped so a sibling canvas can
   * never receive another screen's pending edit. */
  pendingStylePreviewPatches?: Array<StyleReplayPatch & { screenId: string }>;
  styleBaselineResetRequest?: number | null;
  textRevertRequest?: {
    requestId: number;
    patches: Array<{
      selector: string;
      sourceId?: string | null;
      value: string;
      html?: string;
      routePath?: string;
    }>;
  } | null;
  structureAckRequest?: {
    requestId: number;
    acks: Array<{ requestId: string; applied: boolean; routePath?: string }>;
  } | null;
  /** One-shot host request to optimistically move a runtime-only layer. */
  runtimeStructureMoveRequest?: RuntimeStructureMoveRequest | null;
  /** One-shot host request to insert new markup into the running DOM. */
  runtimeStructureInsertRequest?: RuntimeStructureInsertRequest | null;
  /** One-shot host request to delete a runtime layer in this screen. */
  runtimeStructureDeleteRequest?: RuntimeStructureDeleteRequest | null;
  /** One-shot cleanup for a destination whose paired source delete failed. */
  runtimeStructureRollbackRequest?: RuntimeStructureRollbackRequest | null;
  /** Transaction whose destination this canvas currently owns. */
  runtimeStructureTargetTransactionId?: string | null;
  runtimeLayerRenameRequest?: RuntimeLayerRenameRequest | null;
  runtimeLayerSnapshotRequest?: number | null;
  /** The bridge could not honor a runtimeStructureInsertRequest. */
  onRuntimeStructureInsertRejected?: (
    reason: string,
    transactionId?: string,
  ) => void;
  onRuntimeStructureInsertApplied?: (details: {
    requestId: string;
    transactionId?: string;
    routePath?: string;
    selector: string;
    sourceId?: string;
    applied?: boolean;
  }) => void;
  onRuntimeStructureDeleteApplied?: (details: {
    screenId?: string;
    requestId: string;
    selector: string;
    sourceId?: string;
    routePath?: string;
    info?: ElementInfo;
  }) => void;
  onRuntimeStructureDeleteRejected?: (details: {
    screenId?: string;
    requestId: string;
    transactionId?: string;
    routePath?: string;
    reason: string;
  }) => void;
  onRuntimeStructureRollbackResult?: (details: {
    requestId: string;
    transactionId?: string;
    applied: boolean;
    reason?: string;
  }) => void;
  onRuntimeLayerRenameApplied?: (details: {
    requestId: number;
    selector: string;
    sourceId?: string;
    routePath?: string;
    name: string;
    previousName?: string;
  }) => void;
  /** Mounts a separate hidden runtime only after a guarded source hash
   * changes. The editable iframe remains untouched and fully undoable. */
  runtimeVerificationRequest?: RuntimeVerificationRequest | null;
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
  editorChromeScaleX?: number;
  editorChromeScaleY?: number;
  editMode: boolean;
  interactMode: boolean;
  /** Centers the focused responsive preview without resetting its camera. */
  centerInteractPreview?: boolean;
  readOnly?: boolean;
  /** This screen's layout grid step in content px. 1 (or absent) means no grid,
   *  which leaves the whole-pixel floor every gesture already lands on. */
  layoutGridStep?: number;
  scaleMode?: boolean;
  onElementSelect: (info: ElementInfo, intent?: ElementSelectionIntent) => void;
  onElementMarqueeSelect?: (
    infos: ElementInfo[],
    intent?: ElementSelectionIntent,
  ) => void;
  onElementHover: (info: ElementInfo | null) => void;
  onClearSelection?: () => void;
  onVisualStyleChange?: (
    selector: string,
    styles: Record<string, string>,
    info?: ElementInfo,
    metadata?: {
      phase?: "preview" | "commit";
      originalStyles?: Record<string, string>;
      preserveSelection?: boolean;
      routePath?: string;
    },
  ) => void;
  onVisualStyleBatchChange?: (changes: KScaleStyleChange[]) => boolean | void;
  onTextContentChange?: (
    selector: string,
    value: string,
    info?: ElementInfo,
    details?: {
      html?: string;
      originalValue?: string;
      originalHtml?: string;
      routePath?: string;
      relativeOperations?: Record<string, RelativeStyleOperation>;
    },
  ) => void;
  onTextEditingStateChange?: (
    state: Omit<TextEditingState, "screenId">,
  ) => void;
  onElementDblClickText?: (info: ElementInfo) => void;
  onIframeHotkey?: (event: IframeHotkeyPayload) => void;
  onFigmaClipboardPaste?: (event: IframeFigmaClipboardPastePayload) => void;
  onImagePaste?: (event: IframeImagePastePayload) => void;
  onIframeContextMenu?: (event: IframeContextMenuPayload) => void;
  onEditorDragStateChange?: (state: EditorDragStateChange) => void;
  onVisualStructureChange?: (
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      requestId?: string;
      transactionId?: string;
      routePath?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      gridPlacement?: {
        column: number;
        columnEnd: number;
        row: number;
        rowEnd: number;
      };
      gridDisplacements?: Array<{
        sourceId?: string;
        selector?: string;
        placement: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
      }>;
      anchorElementInfo?: ElementInfo;
      /** Set when the subject is markup this change introduced, not an
       * element the running app already had. */
      insertedHtml?: string;
      /** The inserted subject replaced the anchor as one undoable gesture. */
      replaced?: true;
      replacementSelector?: string;
      replacementSourceId?: string;
      replacementElementInfo?: ElementInfo;
      replacementSnapshotHtml?: string;
    },
  ) => boolean | "pending" | void;
  onVisualGridGroupChange?: (
    moves: GridGroupStructureMove[],
  ) => boolean | "pending" | void;
  onVisualDuplicateChange?: (
    selector: string,
    cloneHtml: string,
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
      anchorSelector?: string;
      anchorSourceId?: string;
      anchorElementInfo?: ElementInfo;
      requestId?: string;
      transactionId?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      placement?: "before" | "after" | "inside";
    },
  ) => boolean | "pending" | void;
  tweakValues: Record<string, string>;
  /** Whether draw-to-prompt mode is active (overlays the iframe). */
  drawMode?: boolean;
  /** Called when the user exits draw mode (X / Escape / after Send). */
  onExitDrawMode?: () => void;
  /**
   * Bumped by the parent exactly when the user deliberately discards the
   * current annotation batch (the same moment `onExitDrawMode` fires from
   * the overlay's own X button or a confirmed Send). SharedDrawOverlay only
   * clears its strokes/text annotations when this changes — NOT merely
   * because `drawMode` toggled off for some other reason (switching tools,
   * views, or side panels) — so unsent annotation work survives an
   * unrelated exit instead of being silently discarded.
   */
  drawOverlayResetSignal?: number;
  /** Keeps the active focused overlay bitmap alive across mode/view hides. */
  retainDrawOverlayWhenHidden?: boolean;
  /** Reports focused annotation delivery state so global Escape stays inert too. */
  onAnnotationSendingChange?: (sending: boolean) => void;
  /** Whether comment-pin drop mode is active. */
  pinMode?: boolean;
  /**
   * When true, suppresses rendering of comment pins on this canvas (e.g. the
   * Figma-style Shift+C "hide comments" toggle in single-screen mode). Hiding
   * comments while pin mode is active also exits pin mode so an invisible
   * click target cannot keep intercepting canvas interactions.
   */
  commentPinsHidden?: boolean;
  selectedSelector?: string | null;
  selectedSelectorCandidates?: string[];
  selectedSelectorGroups?: string[][];
  /** Visual treatment for selection mirrors in responsive peer previews. */
  passiveSelectionStyle?: "default" | "soft";
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
  /** Whether the current signed-in viewer may create review comments. */
  reviewCanPost?: boolean;
  /** Whether the current viewer may resolve review threads. */
  reviewCanResolve?: boolean;
  /** Override the review target; null scopes comments to the board surface. */
  reviewTargetId?: string | null;
  /** Current finite board window used to resolve stable board-world anchors. */
  reviewBoardGeometry?: ReviewBoardGeometry | null;
  /** Re-centers the overview camera on a stable board-world review anchor. */
  onReviewFocusBoardPoint?: (point: ReviewAnchorWorldPoint) => boolean | void;
  /** Current viewer email used for author-only comment editing. */
  reviewCurrentUserEmail?: string | null;
  /** A panel-driven request to focus an anchored review comment. */
  reviewFocusRequest?: ReviewFocusRequest | null;
  /** Dispatch a newly created agent-targeted comment to the local agent chat. */
  onDispatchCommentToAgent?: (comment: ReviewComment) => void;
  /** Dispatch one existing review thread to the local agent chat. */
  onSendThreadToAgent?: (thread: ReviewThread) => void;
  /** Thread currently being routed to the agent. */
  reviewSendingThreadId?: string | null;
  /** Human-readable label for the design (used in agent prompt). */
  designTitle?: string;
  /** Stable id for comment pins, usually scoped to the active screen. */
  commentContextId?: string;
  /** Stable id of the screen containing this canvas when rendered in overview. */
  screenId?: string;
  /**
   * Host-side iframe identity when several responsive previews render the
   * same screen. The bridge still reports `screenId`; only DOM targeting uses
   * this distinct value.
   */
  previewFrameId?: string;
  /** Human-readable label for comment-pin prompts. */
  commentContextLabel?: string;
  /** Opens an ephemeral, pre-anchored regenerate composer for this screen. */
  repromptDraftRequest?: RepromptDraftRequest | null;
  onRepromptDraftConsumed?: (nonce: number) => void;
  /** Marks the one base canvas used for pending rewrite previews. */
  nodeRewriteCanvasTarget?: boolean;
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
   * Timeline-level default easing applied to any keyframe that omits its own
   * `ease`. Threaded to the motion-preview bridge alongside the tracks so the
   * scrub/playback preview matches the persisted CSS (the compiler uses the
   * same `defaultEase` fallback when emitting `animation-timing-function`).
   * When omitted the bridge falls back to "ease".
   */
  motionDefaultEase?: string;
  /**
   * Timeline duration in ms, threaded to the motion-preview bridge with the
   * tracks so per-track `delayMs`/`durationMs` offsets can be mapped before
   * the first scrub tick arrives (ticks also carry it). Optional — without
   * it, offset tracks preview correctly from the first `motion-preview`
   * message onward.
   */
  motionDurationMs?: number;
  /**
   * Explicit iframe width in pixels.  When provided it overrides the width
   * derived from `deviceFrame`, enabling per-breakpoint preview (e.g. Mobile
   * 390 / Tablet 768 / Desktop 1280 side-by-side frames in the overview).
   * The height still comes from `deviceFrame`; `deviceFrame="none"` keeps
   * 100% height.
   */
  previewWidthPx?: number;
  previewHeightPx?: number;
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
   * On-canvas gradient-edit handles (Figma parity) for a gradient fill on an
   * element INSIDE this screen's iframe content (as opposed to a board/draft
   * primitive or the screen-frame's own background, which MultiScreenCanvas
   * already draws chrome for directly — see DesignEditor's gradientEditTarget
   * derivation). When set, posts `{ type: "gradient-edit-target", nodeId,
   * cssValue }` into the iframe so the editor-chrome bridge renders drag
   * handles on that element; `null`/`undefined` posts `{ type:
   * "gradient-edit-clear" }`. `nodeId` must be a `data-agent-native-node-id`
   * value. See editor-chrome.bridge.ts's gradientEditTarget doc comment for
   * the full contract this implements.
   */
  gradientEditTarget?: {
    nodeId: string;
    cssValue: string;
  } | null;
  /**
   * Called with the bridge's `gradient-edit-change` postMessages while a
   * gradient-edit drag on an in-screen element (gradientEditTarget above) is
   * live — `phase: "preview"` on every drag tick, `"commit"` once on
   * pointerup, mirroring GradientEditOverlayTarget's onChange contract in
   * MultiScreenCanvas.tsx so the parent can route both through the same
   * style-apply path `visual-style-change` uses.
   */
  onGradientEditChange?: (
    nodeId: string,
    cssValue: string,
    phase: "preview" | "commit",
  ) => void;
  /**
   * Interaction-state forced preview (Figma/Webflow parity, phase 2 — see
   * `shared/interaction-states.ts`'s "Forced-preview mechanism" doc comment).
   * When set, posts `{ type: "state-preview", ... }` into the iframe so the
   * editor-chrome bridge sets `data-an-state-preview="<state>"` on the exact
   * selected element. Inline HTML uses the persisted twin CSS rule written by
   * `duplicateStatePreviewRules`; localhost screens can additionally pass
   * `previewStyles`, which the bridge holds in a temporary CSSOM rule until
   * the guarded source handoff is applied or discarded.
   * `null`/`undefined` posts `{ type: "state-preview", nodeId: null, state:
   * null }`, clearing whichever element is currently force-previewing.
   * Mirrors `gradientEditTarget`'s postMessage-sync-effect pattern exactly —
   * see that prop's doc comment above.
   */
  statePreviewTarget?: {
    nodeId: string;
    state: string;
    selector?: string | null;
    selectorCandidates?: string[];
    previewStyles?: Record<string, string> | null;
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
  /**
   * Figma-style click-to-place primitive creation while focused on a single
   * screen. When set to a non-null tool, DesignCanvas mounts a transparent
   * capture overlay above the iframe so pointer gestures draw a new
   * primitive instead of reaching the iframe's own content/editor-chrome
   * bridge. `null`/`undefined` fully restores prior (pre-creation-tool)
   * behavior — the overlay never mounts.
   */
  activeCreationTool?: CreationTool | null;
  selectedPenPathNodeId?: string | null;
  /**
   * Fired once per completed click or drag gesture while `activeCreationTool`
   * is set. Geometry is in SCREEN-CONTENT coordinates — the screen's own
   * pixel coordinate system, matching what `getDraftGeometryFromPoints` and
   * `draftPrimitiveToInsert` already use in MultiScreenCanvas — NOT viewport
   * pixels. The parent (DesignEditor) is responsible for turning this into a
   * persisted primitive (see `appendCanvasPrimitiveToHtml` /
   * `draftPrimitiveToInsert` on the overview side).
   */
  onCreatePrimitive?: (spec: CreatePrimitiveSpec) => string | false | void;
  onUpdatePenPath?: (
    nodeId: string,
    path: PenPath,
    nextTool?: "move",
  ) => boolean;
  /**
   * OS file drag-and-drop (Figma parity): fired when the user drops native
   * OS files (e.g. images dragged from Finder/Explorer) onto this single-
   * screen canvas. `target.screenContentPoint` is the drop point converted to
   * SCREEN-CONTENT coordinates via `getScreenContentPointFromClient` — the
   * same space `onCreatePrimitive` geometry and `draftPrimitiveToInsert` use
   * — NOT viewport pixels. `target.screenId` echoes this canvas's own
   * `screenId` prop (when set) so a caller wiring both MultiScreenCanvas and
   * DesignCanvas can use one shared handler keyed on screen id. This
   * component only resolves WHERE the drop landed — it does NOT read file
   * contents, upload, or insert anything; that remains the caller's job
   * (DesignEditor's paste-image pipeline), matching `onCreatePrimitive`'s own
   * division of responsibility.
   */
  onDropFiles?: (
    files: File[],
    target: {
      screenContentPoint: { x: number; y: number };
      screenId?: string;
    },
  ) => void;
  /**
   * Contract for DesignEditor: when true, the Figma-style "hand" tool is
   * armed, so a plain left-button drag anywhere on this canvas (over the
   * scroll-container background OR over the iframe/creation-overlay area)
   * pans instead of selecting/drawing. Mirrors MultiScreenCanvas's own
   * `tool === "hand"` → `beginPan` gating (see `e.button === 0 && tool ===
   * "hand"` in MultiScreenCanvas). Middle-mouse-button drag always pans
   * regardless of this prop, matching MultiScreenCanvas's unconditional
   * `e.button === 1` branch. Defaults to `false` (no behavior change when
   * omitted) — DesignEditor should pass `activeTool === "hand"` (or its
   * equivalent tool-state) once wired.
   */
  handToolActive?: boolean;
  /**
   * Contract for DesignEditor: when true, the spacebar is currently held
   * down, which — Figma-style — temporarily activates the same pan-on-drag
   * behavior as `handToolActive` without changing the active tool. This
   * component does not listen for the spacebar itself (keydown/keyup would
   * need to be captured at a level that already reaches this component
   * reliably, e.g. a window-level listener in DesignEditor gated on not
   * being in a text-editing context); DesignEditor should track pressed
   * state there and pass it through here. Defaults to `false` (no behavior
   * change when omitted).
   */
  spacePanActive?: boolean;
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

function isCurrentLiveEditReadyMessage(
  liveEditUrl: string,
  routePath: unknown,
  previousRoutePath: string | null,
): "current" | "stale" | "invalid" {
  try {
    const liveEdit = new URL(liveEditUrl);
    const targetUrl = liveEdit.searchParams.get("url");
    const targetPathParam = liveEdit.searchParams.get("path");
    const targetPath = targetUrl
      ? new URL(targetUrl)
      : targetPathParam
        ? new URL(targetPathParam, liveEdit.origin)
        : null;
    if (!targetPath) return "invalid";
    const expectedRoutePath = targetPath.pathname + targetPath.search;
    if (typeof routePath === "string" && routePath) {
      return routePath === expectedRoutePath ? "current" : "stale";
    }
    return previousRoutePath === null || previousRoutePath === expectedRoutePath
      ? "current"
      : "stale";
  } catch {
    return "invalid";
  }
}

function liveEditDocumentIdentityForRoute(
  liveEditUrl: string,
  routePath: string,
): { status: "ready"; identity: string } | { status: "invalid" } {
  try {
    const liveEdit = new URL(liveEditUrl);
    const targetUrl = liveEdit.searchParams.get("url");
    if (!targetUrl) return { status: "invalid" };
    const target = new URL(targetUrl);
    const route = new URL(routePath, target.origin);
    if (route.origin !== target.origin) return { status: "invalid" };
    target.pathname = route.pathname;
    target.search = route.search;
    target.hash = route.hash;
    liveEdit.searchParams.set("url", target.toString());
    return { status: "ready", identity: `src:${liveEdit.toString()}` };
  } catch {
    return { status: "invalid" };
  }
}

function snapshotEndpointUrl(bridgeUrl: string, previewUrl: string): string {
  const endpoint = new URL("/snapshot", bridgeUrl);
  endpoint.searchParams.set("url", previewUrl);
  return endpoint.toString();
}

function healthEndpointUrl(bridgeUrl: string): string {
  return new URL("/health", bridgeUrl).toString();
}

/**
 * Classifies a suspected `unknown-bridge-key` failure on the localhost
 * live-edit bridge, based on a `/health` probe fired when the
 * "agent-native:editor-chrome-ready" handshake hasn't arrived in time.
 *
 * The bridge mints a fresh `bridgeInstanceId` every time its process boots
 * (see `startDesignConnectBridge` in packages/core/src/cli/design-connect.ts)
 * and echoes it on `/health`, on a successful `/live-edit-bridge`
 * registration, and on the "unknown bridge key" 409 from `/live-edit`. The
 * 409 itself is usually unreadable here: the live iframe navigates directly
 * to the bridge's `/live-edit` URL (a real cross-origin request), so this
 * component can't inspect the response body or status code the way a
 * same-origin `fetch` could. Instead, callers probe `/health` — a route that
 * never requires the preview token — and pass its `bridgeInstanceId` in as
 * `responseBridgeInstanceId`.
 *
 * - Different id than what we last registered with ⇒ the bridge PROCESS
 *   restarted (crash, machine sleep/wake, manual restart) since our last
 *   successful registration. That's not a caller bug: silently re-POST the
 *   same script/key and reload the frame with no user-facing error
 *   ("reregister").
 * - Same id ⇒ the process that accepted our registration is still running
 *   and reachable — the iframe just hasn't finished loading yet (e.g. a
 *   6-10s cold dev-server compile), NOT a genuine failure. Callers must NOT
 *   tear the iframe down for this outcome: re-arm the ready-handshake
 *   watchdog with a longer wait instead ("escalate") — see
 *   handleSuspectedBridgeRestart's escalation loop, which only gives up and
 *   shows a (non-destructive) error after a generous total ceiling.
 * - No id at all (missing from either side) ⇒ inconclusive — `/health`
 *   responded but we can't confirm process identity either way. Treat this
 *   like a real, unresolved failure and surface the existing error/Retry UI
 *   ("error").
 *
 * Deliberately NOT exported: every other pure helper in this file
 * (getExternalPreviewUrl, snapshotEndpointUrl, buildEditorChromeBridgeScript,
 * contentHash, isAllowedFusionOrigin, originFromUrl, ...) stays module-private
 * so DesignCanvas.tsx keeps exporting only the DesignCanvas component itself
 * — see DesignCanvas.refreshBoundary.test.ts, which guards the Fast Refresh
 * boundary this file relies on given how often it's edited during live design
 * sessions. Its decision logic is covered by behavioral tests in
 * DesignCanvas.bridge-restart.test.tsx instead of a direct unit import.
 */
function classifyLiveEditHealthProbe(
  cachedBridgeInstanceId: string | null | undefined,
  responseBridgeInstanceId: string | null | undefined,
): "reregister" | "escalate" | "error" {
  if (!cachedBridgeInstanceId || !responseBridgeInstanceId) return "error";
  return cachedBridgeInstanceId === responseBridgeInstanceId
    ? "escalate"
    : "reregister";
}

// Grace period after the live-edit bridge is (re)registered and the real
// iframe document is mounted before a missing "agent-native:editor-chrome-ready"
// handshake is treated as a suspected bridge restart rather than an in-flight
// page load. Generous relative to typical localhost load times so a slow but
// healthy dev server is never misdiagnosed as restarted.
const LIVE_EDIT_READY_TIMEOUT_MS = 4000;
// Caps the silent auto-reregister loop below so a pathological bridge that
// keeps minting a new bridgeInstanceId on every probe (or that never manages
// to actually register) can't retry forever without ever surfacing an error.
const MAX_LIVE_EDIT_RESTART_ATTEMPTS = 3;
// When a /health probe confirms the SAME bridgeInstanceId as last registered
// (bridge process healthy, page just slow to post ready), each re-arm of the
// watchdog waits longer than the last — 4s, 8s, 16s — capped here so the
// backoff doesn't grow unbounded on a very long-running compile.
const LIVE_EDIT_SAME_INSTANCE_MAX_REARM_DELAY_MS = 16_000;
// Total cumulative time to keep silently re-arming on a same-instance-id
// "still healthy" response before finally surfacing a non-destructive error
// affordance. Generous relative to even a slow cold dev-server compile so a
// genuinely-loading page is never misdiagnosed as failed; a legitimately
// long compile that finishes after this point still clears the error the
// moment the ready handshake arrives (see the message-handler branch below).
const LIVE_EDIT_SAME_INSTANCE_ERROR_CEILING_MS = 48_000;

// Successful bridge registrations belong to the localhost bridge process,
// not to one React DesignCanvas instance. Canvas -> responsive Interact
// replaces the overview canvas component with a focused canvas component; a
// component-local registration flag made that transition mount an empty
// srcdoc first and then replace it with the live URL after an identical POST.
// Keep a deliberately short handoff cache so the focused instance can mount
// the already-registered live document exactly once. A stale entry during
// HMR is harmless: the ready watchdog probes the bridge instance and silently
// re-registers, while the ready-gated fallback below prevents blank content.
const LIVE_EDIT_REGISTRATION_HANDOFF_TTL_MS = 30_000;
const liveEditRegistrationHandoff = new Map<string, number>();

function liveEditRegistrationHandoffKey(
  bridgeUrl: string | undefined,
  bridgeKey: string,
): string | null {
  if (!bridgeUrl) return null;
  try {
    return `${new URL(bridgeUrl).origin}|${bridgeKey}`;
  } catch {
    return null;
  }
}

function hasRecentLiveEditRegistration(key: string | null): boolean {
  if (!key) return false;
  const registeredAt = liveEditRegistrationHandoff.get(key);
  if (registeredAt === undefined) return false;
  if (Date.now() - registeredAt <= LIVE_EDIT_REGISTRATION_HANDOFF_TTL_MS) {
    return true;
  }
  liveEditRegistrationHandoff.delete(key);
  return false;
}

function originFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * JSON for embedding inside an inline `<script>`. A bare `JSON.stringify` keeps
 * `</script>` verbatim, and the HTML parser closes the surrounding script the
 * moment it sees that sequence — truncating the bridge for any design whose
 * head legitimately contains one (JSON-LD, a templating snippet).
 */
function inlineScriptJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function buildEditorChromeBridgeScript(args: {
  readOnly: boolean;
  editMode: boolean;
  editorChromeScaleX: number;
  editorChromeScaleY: number;
  screenId: string;
  boardSurface: boolean;
  contentOffsetX: number;
  contentOffsetY: number;
  runtimeLayerSnapshotEnabled: boolean;
  initialSourceHead: string;
}) {
  return (
    createEditorBridgeThemeScript(readEditorBridgeThemeVars()) +
    EDITOR_CHROME_BRIDGE_SCRIPT.replace(
      "__READ_ONLY__",
      args.readOnly ? "true" : "false",
    )
      .replace("__TEXT_EDITING_ENABLED__", args.editMode ? "true" : "false")
      .replace("__EDITOR_CHROME_SCALE_X__", String(args.editorChromeScaleX))
      .replace("__EDITOR_CHROME_SCALE_Y__", String(args.editorChromeScaleY))
      .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify(args.screenId))
      .replace(
        "__DESIGN_CANVAS_BOARD_SURFACE__",
        args.boardSurface ? "true" : "false",
      )
      .replace(
        "__DESIGN_CANVAS_CONTENT_OFFSET_X__",
        String(Math.round(args.contentOffsetX)),
      )
      .replace(
        "__DESIGN_CANVAS_CONTENT_OFFSET_Y__",
        String(Math.round(args.contentOffsetY)),
      )
      .replace(
        "__RUNTIME_LAYER_SNAPSHOT_ENABLED__",
        args.runtimeLayerSnapshotEnabled ? "true" : "false",
      )
      .replace(
        "__LIVE_REFLOW_ENABLED__",
        LIVE_REFLOW_ENABLED ? "true" : "false",
      )
      .replace(
        "__SELECTED_LAYER_DRAG_PRIORITY__",
        SELECTED_LAYER_DRAG_PRIORITY_ENABLED ? "true" : "false",
      )
      .replace(/__INITIAL_SOURCE_HEAD__/g, () =>
        inlineScriptJson(args.initialSourceHead),
      )
  );
}

/** The `<head>` the bridge's own srcdoc will render, so its first in-place
 *  patch diffs against what is actually in the document. */
function sourceHeadInnerHtml(html: string): string {
  return /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html)?.[1] ?? "";
}

// Stable defaults: a fresh `[]` per render re-runs every effect that replays
// selection state into the iframe.
const NO_SELECTORS = Object.freeze([]) as unknown as string[];
const NO_SELECTOR_GROUPS = Object.freeze([]) as unknown as string[][];

function contentHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `${value.length}:${hash >>> 0}`;
}

const SCRIPT_ELEMENT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi; // i18n-ignore non-UI regex

/**
 * A structural edit's `nextContent` can come from a live-DOM round trip (the
 * bridge resolves the moved/edited node against the running iframe, not
 * against the original source bytes). The browser's own attribute serializer
 * normalizes a bare boolean attribute like `defer` to `defer=""` on that trip
 * even though nothing about the script changed — comparing raw markup would
 * read that as a script edit and force a spurious reload. Re-parse each match
 * through an inert `<template>` (its content never executes or attaches to
 * the document) so both sides compare the DOM's own canonical serialization
 * instead of whichever byte-for-byte form the source happened to be in.
 */
function normalizeScriptMarkup(scriptHtml: string): string {
  const template = document.createElement("template");
  template.innerHTML = scriptHtml;
  return template.content.firstElementChild?.outerHTML ?? scriptHtml;
}

/**
 * Runtime document replacement morphs the live DOM, which preserves the iframe
 * browsing context but cannot execute newly inserted or changed scripts.
 * Reload only when source script elements change.
 *
 * A changed `<head>` is NOT a reload trigger: the bridge swaps only the nodes
 * the previous source head contributed (replaceSourceHeadNodes), leaving what
 * the page's own runtime injected in place. Treating any head edit as a reload
 * meant every breakpoint override, motion track and token write — all of which
 * persist into a managed `<style>` in the head — reloaded the whole frame.
 */
function runtimeDocumentNeedsReload(
  previousContent: string,
  nextContent: string,
): boolean {
  const scriptSignature = (html: string) => {
    const headEnd = html.search(/<\/head\s*>/i);
    const boundary = headEnd === -1 ? 0 : headEnd;
    return Array.from(
      html.matchAll(SCRIPT_ELEMENT_RE),
      (match) =>
        `${(match.index ?? 0) < boundary ? "head" : "body"}:${normalizeScriptMarkup(match[0])}`,
    ).join("\n");
  };
  return scriptSignature(previousContent) !== scriptSignature(nextContent);
}

/**
 * Safely reads an embedded screen iframe's own internal document scroll
 * position, in the iframe's own unscaled content pixels — the same units
 * `getScreenContentPointFromClient`'s `scrollOffset` param folds in. Inline
 * (srcdoc) screens are same-origin, so the happy path below is the common
 * case, but externally-hosted localhost/fusion previews can be cross-origin,
 * and `contentWindow.scrollX`/`scrollY` THROWS (it is not merely
 * `undefined`) when accessed cross-origin. Always degrade to `{0, 0}` rather
 * than letting that throw escape into a render or event handler.
 */
function readIframeScrollOffset(iframe: HTMLIFrameElement | null | undefined): {
  left: number;
  top: number;
} {
  try {
    const win = iframe?.contentWindow;
    if (!win) return { left: 0, top: 0 };
    return { left: win.scrollX || 0, top: win.scrollY || 0 };
  } catch {
    return { left: 0, top: 0 };
  }
}

// Inspector selects and pickers portal outside the right panel; while a text
// range is being styled they are still part of that inspector gesture.
const INSPECTOR_POPUP_SELECTOR =
  '[role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper], [data-slot="popover-content"]';

type VisualEditSharedSnapshot = {
  designId: string;
  fileId: string;
  html: string | null;
  updatedAt: string | null;
  captureRevision: string;
  publishedRevision: string;
};

function SharedSnapshotPoller({
  designId,
  fileId,
  knownPublishedRevision,
  active,
  onSnapshot,
}: {
  designId: string;
  fileId: string;
  knownPublishedRevision: string | null;
  active: boolean;
  onSnapshot: (snapshot: VisualEditSharedSnapshot | null) => void;
}) {
  const { data, refetch } = useActionQuery<{
    designId: string;
    fileId: string;
    html: string | null;
    updatedAt: string | null;
    captureRevision: string | null;
    publishedRevision: string | null;
    unchanged: boolean;
  }>(
    "get-visual-edit-snapshot",
    { designId, fileId, knownPublishedRevision },
    {
      // request-storm-allow: Anonymous viewers cannot receive owner sync events; only the focused shared canvas polls, and inactive screens refetch when focused.
      refetchInterval: active ? 2_000 : false,
    },
  );
  const wasActiveRef = useRef(active);
  const latestCaptureRevisionRef = useRef({ designId, fileId, revision: 0n });

  useEffect(() => {
    if (active && !wasActiveRef.current) void refetch();
    wasActiveRef.current = active;
  }, [active, refetch]);

  useEffect(() => {
    if (!data || data.designId !== designId || data.fileId !== fileId) {
      return;
    }
    if (
      latestCaptureRevisionRef.current.designId !== designId ||
      latestCaptureRevisionRef.current.fileId !== fileId
    ) {
      latestCaptureRevisionRef.current = { designId, fileId, revision: 0n };
    }
    const captureRevision = BigInt(data.captureRevision ?? "0");
    if (captureRevision < latestCaptureRevisionRef.current.revision) return;
    latestCaptureRevisionRef.current.revision = captureRevision;
    if (!data.publishedRevision) {
      onSnapshot(null);
      return;
    }
    if (data.unchanged) return;
    onSnapshot({
      designId,
      fileId,
      html: data.html,
      updatedAt: data.updatedAt,
      captureRevision: data.captureRevision ?? "0",
      publishedRevision: data.publishedRevision,
    });
  }, [data, designId, fileId, onSnapshot]);

  return null;
}

export function DesignCanvas({
  content,
  contentKey,
  sourceType,
  bridgeUrl,
  previewUrlOverride,
  connectionId,
  nativePreviewActive = true,
  sharedSnapshotPollActive = true,
  externalSnapshotHtml,
  snapshotOnly = false,
  blockPreviewInteraction = false,
  onExternalContentSnapshot,
  onRuntimeLayerSnapshot,
  onReserveVisualEditSnapshot,
  onBridgeReady,
  onPreviewTokenChange,
  onLiveEditCapabilityChange,
  onLiveEditRegistrationCapabilityChange,
  onRoutePathChange,
  onBootStart,
  onBootReady,
  onScreenRootComputedStyles,
  onRuntimeVerificationSnapshot,
  fusionUrl,
  previewToken,
  liveEditCapability,
  liveEditRegistrationCapability,
  zoom,
  onZoomChange,
  deviceFrame,
  embeddedFrame,
  boardSurface = false,
  fitRootBodyToFrame,
  runtimeReplacementContent,
  authoredSourceContent,
  runtimeReplacementKey,
  styleRevertRequest,
  pendingStylePreviewPatches,
  styleBaselineResetRequest,
  textRevertRequest,
  structureAckRequest,
  runtimeStructureMoveRequest,
  runtimeStructureInsertRequest,
  runtimeStructureDeleteRequest,
  runtimeStructureRollbackRequest,
  runtimeStructureTargetTransactionId,
  runtimeLayerRenameRequest,
  runtimeLayerSnapshotRequest,
  onRuntimeStructureInsertRejected,
  onRuntimeStructureInsertApplied,
  onRuntimeStructureDeleteApplied,
  onRuntimeStructureDeleteRejected,
  onRuntimeStructureRollbackResult,
  onRuntimeLayerRenameApplied,
  runtimeVerificationRequest,
  embeddedFrameBackground,
  transparentBackground = false,
  editorChromeScaleX = 1,
  editorChromeScaleY = editorChromeScaleX,
  editMode,
  interactMode,
  centerInteractPreview = false,
  layoutGridStep,
  readOnly = false,
  scaleMode = false,
  clearSelectionRequest,
  onElementSelect,
  onElementMarqueeSelect,
  onElementHover,
  onClearSelection,
  onVisualStyleChange,
  onVisualStyleBatchChange,
  onTextContentChange,
  onTextEditingStateChange,
  onElementDblClickText,
  onIframeHotkey,
  onFigmaClipboardPaste,
  onImagePaste,
  onIframeContextMenu,
  onEditorDragStateChange,
  onVisualStructureChange,
  onVisualGridGroupChange,
  onVisualDuplicateChange,
  tweakValues,
  drawMode,
  onExitDrawMode,
  drawOverlayResetSignal,
  retainDrawOverlayWhenHidden = false,
  onAnnotationSendingChange,
  pinMode,
  commentPinsHidden,
  selectedSelector,
  selectedSelectorCandidates = NO_SELECTORS,
  selectedSelectorGroups = NO_SELECTOR_GROUPS,
  passiveSelectionStyle = "default",
  hoveredSelector,
  hoveredSelectorCandidates = NO_SELECTORS,
  lockedSelectors = NO_SELECTORS,
  hiddenSelectors = NO_SELECTORS,
  onExitPinMode,
  registerRuntimeBridge = true,
  designId,
  publicVisualEdit = false,
  reviewCanPost = false,
  reviewCanResolve = false,
  reviewTargetId,
  reviewBoardGeometry,
  onReviewFocusBoardPoint,
  reviewCurrentUserEmail,
  reviewFocusRequest,
  onDispatchCommentToAgent,
  onSendThreadToAgent,
  reviewSendingThreadId,
  designTitle,
  commentContextId,
  screenId,
  previewFrameId,
  repromptDraftRequest,
  onRepromptDraftConsumed,
  nodeRewriteCanvasTarget = false,
  onPrototypeNavigate,
  motionTracks,
  motionDefaultEase,
  motionDurationMs,
  previewWidthPx,
  previewHeightPx,
  onComponentSourceJump,
  shaderFillPreview,
  gradientEditTarget,
  onGradientEditChange,
  statePreviewTarget,
  activeCreationTool = null,
  selectedPenPathNodeId,
  onCreatePrimitive,
  onUpdatePenPath,
  onDropFiles,
  handToolActive = false,
  spacePanActive = false,
}: DesignCanvasProps) {
  const t = useT();
  const { resolvedTheme } = useTheme();
  const browserOrigin = useBrowserOrigin();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const restoreKScalePreviewRef = useRef<(() => void) | null>(null);
  const textEditingStateRef = useRef<Omit<TextEditingState, "screenId">>({
    active: false,
  });
  const textEditInspectorFocusedRef = useRef(false);
  const pendingTextEditResumeRef = useRef<{
    origin: HTMLElement;
    iframe: HTMLIFrameElement;
    contentWindow: Window;
    screenId: string;
    selector: string;
    sourceId?: string;
    phase: "waiting" | "resuming";
    frameId: number;
  } | null>(null);
  const runtimeVerificationIframeRef = useRef<HTMLIFrameElement>(null);
  const embeddedCanvasPanSessionRef = useRef<EmbeddedCanvasPanSession | null>(
    null,
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const reviewCanvasId = useId();
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const zoomSizeLayerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const imperativeZoomRef = useRef<number | null>(null);
  const zoomPropRef = useRef(zoom);
  const zoomGestureGenerationRef = useRef(0);
  const zoomCommitTimerRef = useRef<number | null>(null);
  const applyZoomFrame = useCallback(
    (nextZoom: number) => {
      imperativeZoomRef.current = nextZoom;
      zoomRef.current = nextZoom;
      const layer = zoomLayerRef.current;
      if (layer) {
        layer.style.transform = getSingleScreenZoomTransform(
          nextZoom,
          deviceFrame,
          centerInteractPreview,
        );
      }
      const sizeLayer = zoomSizeLayerRef.current;
      if (sizeLayer && centerInteractPreview) {
        if (previewWidthPx === undefined) {
          sizeLayer.style.removeProperty("width");
        } else {
          sizeLayer.style.width = `${previewWidthPx * (nextZoom / 100)}px`;
        }
        if (previewHeightPx === undefined) {
          sizeLayer.style.removeProperty("height");
        } else {
          sizeLayer.style.height = `${previewHeightPx * (nextZoom / 100)}px`;
        }
      }
    },
    [centerInteractPreview, deviceFrame, previewHeightPx, previewWidthPx],
  );
  const commitZoom = useCallback(
    (nextZoom: number) => {
      if (nextZoom !== zoomRef.current) return;
      if (zoomCommitTimerRef.current !== null) {
        window.clearTimeout(zoomCommitTimerRef.current);
        zoomCommitTimerRef.current = null;
      }
      imperativeZoomRef.current = nextZoom;
      zoomRef.current = nextZoom;
      zoomPropRef.current = nextZoom;
      onZoomChange?.(nextZoom);
    },
    [onZoomChange],
  );
  const scheduleZoomCommit = useCallback(
    (nextZoom: number) => {
      applyZoomFrame(nextZoom);
      const generation = zoomGestureGenerationRef.current;
      if (zoomCommitTimerRef.current !== null) {
        window.clearTimeout(zoomCommitTimerRef.current);
      }
      zoomCommitTimerRef.current = window.setTimeout(() => {
        zoomCommitTimerRef.current = null;
        if (
          generation !== zoomGestureGenerationRef.current ||
          zoomRef.current !== nextZoom
        ) {
          return;
        }
        commitZoom(zoomRef.current);
      }, 120);
    },
    [applyZoomFrame, commitZoom],
  );
  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current !== null) {
        window.clearTimeout(zoomCommitTimerRef.current);
      }
    };
  }, []);
  // Zoom-invariant chrome: the non-embedded-frame render path below wraps the
  // iframe in its own CSS `transform: scale(zoom / 100)` (see the
  // `deviceFrame === "none"` and framed branches further down) — a purely
  // visual, OUTER scale the bridge running INSIDE the iframe has no way to
  // observe. `editorChromeScaleX/Y` is the only channel that tells the bridge
  // what scale its own chrome (selection borders, resize handles, spacing
  // overlays) must counter-scale by to stay a constant on-screen size, Figma-
  // style, instead of visually shrinking/growing with content as the user
  // zooms. The overview caller already folds its own zoom into the
  // editorChromeScaleX/Y it passes down for exactly this reason; this
  // component must do the same with its OWN `zoom` prop for single-view,
  // multiplying in whatever scale the caller passed (default 1) rather than
  // assuming the caller already accounted for it — single-view's caller
  // historically didn't pass either prop at all, so the bridge always
  // computed with scale=1 and chrome scaled with content on every zoom.
  const effectiveEditorChromeScaleX = (zoom / 100) * editorChromeScaleX;
  const effectiveEditorChromeScaleY = (zoom / 100) * editorChromeScaleY;
  const previousContentKeyRef = useRef(contentKey);
  const runtimeReplacementContentRef = useRef(runtimeReplacementContent);
  const runtimeReplacementSourceRef = useRef(
    authoredSourceContent ?? runtimeReplacementContent,
  );
  const runtimeReplacementKeyRef = useRef(runtimeReplacementKey);
  const lastRuntimeReplacementKeyRef = useRef(runtimeReplacementKey);
  // The key also includes updatedAt, so a save acknowledgement can change it
  // while the rendered bytes are identical. Track the bytes separately to
  // avoid a redundant forced document replacement that would terminate an
  // in-progress text edit/caret after every save echo.
  const lastRuntimeReplacementContentRef = useRef(runtimeReplacementContent);
  // Bridge-ready handshake (see EDITOR_CHROME_BRIDGE_SCRIPT's
  // agent-native:editor-chrome-ready post on install). One-shot commands —
  // begin-text-edit, style-change, delete-element,
  // replace-document-content — are fire-and-forget postMessages with no retry:
  // if the iframe document is still loading (fresh srcdoc, screen switch, or a
  // mid-flight reload) the bridge script hasn't attached its message listener
  // yet and the command is silently dropped. Persistent editor state, including
  // chrome scale, is replayed on every ready handshake.
  // Queue them here until ready fires (or the iframe finishes loading, as a
  // fallback for older/interact-mode documents that never inject the chrome
  // bridge and thus never post ready) and flush in order.
  const pinchZoomDeviceRef = useRef<ZoomGestureDevice | null>(null);
  const bridgeReadyRef = useRef(false);
  // A trusted message can arrive from the lightweight hit-test/runtime bridge
  // before the full editor-chrome listener has attached. Keep every one-shot
  // editor mutation behind the explicit editor-chrome handshake; otherwise an
  // empty board can consume a command before its listener exists.
  const editorChromeReadyRef = useRef(false);
  const bootReadyRef = useRef(false);
  const [readyIframeDocumentIdentity, setReadyIframeDocumentIdentity] =
    useState<string | null>(null);
  const liveRoutePathRef = useRef<string | null>(null);
  const liveEditDocumentIdsRef = useRef(new Set<string>());
  const liveEditDocumentIdRef = useRef<string | null>(null);
  const previousIframeDocumentIdentityRef = useRef<string | null>(null);
  const pendingOneShotMessagesRef = useRef<unknown[]>([]);
  const pendingRuntimeDeletePreviewRef = useRef<{
    requestId: string;
    selector: string;
    selectorCandidates: string[];
    transactionId?: string;
    documentIdentity: string | null;
    awaitingTransaction: boolean;
  } | null>(null);
  const lastRuntimeStructureDeleteRequestIdRef = useRef<string | null>(null);
  const lastRuntimeStructureDeleteCancelRequestIdRef = useRef<string | null>(
    null,
  );
  const lastRuntimeStructureTargetReloadTransactionIdRef = useRef<
    string | null
  >(null);
  if (
    lastRuntimeStructureTargetReloadTransactionIdRef.current !==
    runtimeStructureTargetTransactionId
  ) {
    lastRuntimeStructureTargetReloadTransactionIdRef.current = null;
  }
  const flushPendingOneShotMessages = useCallback(() => {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow;
    if (!win) return;
    const queued = pendingOneShotMessagesRef.current;
    if (queued.length === 0) return;
    // Keep the queue as one ordered transaction. Partitioning only the
    // runtime-insert messages lets a later style/delete/rename command pass
    // the still-unready chrome and overtake the insert it depends on.
    if (!editorChromeReadyRef.current) return;
    pendingOneShotMessagesRef.current = [];
    queued.forEach((message) => win.postMessage(message, "*"));
  }, []);
  const bridgeReadinessProbeTimerRef = useRef<number | undefined>(undefined);
  const probeBridgeReadinessUntilDrained = useCallback(() => {
    if (bridgeReadinessProbeTimerRef.current !== undefined) return;
    let attempts = 0;
    const probe = () => {
      const win = iframeRef.current?.contentWindow;
      const drained = pendingOneShotMessagesRef.current.length === 0;
      // The schedule covers a frame still finishing navigation without leaving
      // a timer running against a frame that has no bridge at all (interact-mode
      // documents never inject one, and must keep queueing as before).
      if (!win || drained || attempts >= BRIDGE_READINESS_PROBE_ATTEMPTS) {
        window.clearInterval(bridgeReadinessProbeTimerRef.current);
        bridgeReadinessProbeTimerRef.current = undefined;
        return;
      }
      attempts += 1;
      win.postMessage(
        {
          type: "agent-native:text-edit-status",
          correlationId: "",
          nodeId: "",
        },
        "*",
      );
    };
    probe();
    if (pendingOneShotMessagesRef.current.length === 0) return;
    bridgeReadinessProbeTimerRef.current = window.setInterval(
      probe,
      BRIDGE_READINESS_PROBE_INTERVAL_MS,
    );
  }, []);
  useEffect(
    () => () => {
      if (bridgeReadinessProbeTimerRef.current !== undefined) {
        window.clearInterval(bridgeReadinessProbeTimerRef.current);
        bridgeReadinessProbeTimerRef.current = undefined;
      }
    },
    [],
  );
  /** Removes a not-yet-flushed begin-text-edit for `nodeId` from the one-shot
   *  ready queue. Identity-scoped so a cancelled creation cannot take a live
   *  one's command with it. */
  const dropQueuedBeginTextEdit = useCallback((nodeId: string) => {
    pendingOneShotMessagesRef.current =
      pendingOneShotMessagesRef.current.filter((message) => {
        const queued = message as { type?: unknown; nodeId?: unknown } | null;
        return !(
          queued?.type === "begin-text-edit" && queued.nodeId === nodeId
        );
      });
  }, []);
  const postOneShotBridgeMessage = useCallback(
    (message: unknown) => {
      const iframe = iframeRef.current;
      const win = iframe?.contentWindow;
      // A one-shot prop can arrive in the same render that first creates the
      // iframe. Keep it queued even when the ref/contentWindow is not attached
      // yet; otherwise the effect records its request id as handled and the
      // command is lost permanently before the bridge can announce readiness.
      if (!win || !bridgeReadyRef.current || !editorChromeReadyRef.current) {
        pendingOneShotMessagesRef.current.push(message);
        // The readiness recovery in the message handler below is PASSIVE: it
        // waits for the frame to say something first. A live-edit screen keeps
        // its already-loaded iframe across a canvas remount, so a replacement
        // instance never sees `editor-chrome-ready`, and an idle frame says
        // nothing on its own — every inspector style commit then sat here
        // reporting success while the running app never changed, until some
        // unrelated hover/selection happened to talk and flushed the backlog.
        // Ask instead of waiting: `agent-native:text-edit-status` is the
        // cheapest bridge round trip (no DOM walk with an empty nodeId), its
        // reply is a trusted message from the current frame, and that reply is
        // what marks the bridge ready and drains this queue. A frame with no
        // bridge attached simply never answers, so the queue keeps its original
        // meaning.
        // ...and keep asking. A single probe is fire-and-forget: if it lands
        // while the frame is mid-navigation (or before its bridge listener is
        // attached) nothing answers, and because the frame is otherwise idle
        // nothing ever asks again — the queue strands and every queued command
        // keeps reporting success. Undo of a live style edit is the visible
        // case: the revert never reaches the running app. Retry on a bounded
        // schedule and stop as soon as the queue drains.
        if (win) probeBridgeReadinessUntilDrained();
        return true;
      }
      win.postMessage(message, "*");
      return true;
    },
    [probeBridgeReadinessUntilDrained],
  );
  const requestRuntimeLayerSnapshot = useCallback(() => {
    postOneShotBridgeMessage({ type: "request-runtime-layer-snapshot" });
  }, [postOneShotBridgeMessage]);
  const sharedSnapshotRequestTimerRef = useRef<number | undefined>(undefined);
  const requestSharedSnapshotAfterEdit = useCallback(() => {
    if (sourceType !== "localhost" || snapshotOnly) return;
    if (sharedSnapshotRequestTimerRef.current !== undefined) {
      window.clearTimeout(sharedSnapshotRequestTimerRef.current);
    }
    sharedSnapshotRequestTimerRef.current = window.setTimeout(() => {
      sharedSnapshotRequestTimerRef.current = undefined;
      requestRuntimeLayerSnapshot();
    }, 100);
  }, [requestRuntimeLayerSnapshot, snapshotOnly, sourceType]);
  useEffect(
    () => () => {
      if (sharedSnapshotRequestTimerRef.current !== undefined) {
        window.clearTimeout(sharedSnapshotRequestTimerRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (interactMode) return;
    const isInspectorTarget = (target: EventTarget | null): boolean =>
      target instanceof Element &&
      (!!target.closest('[data-design-chrome-region="right-panel"]') ||
        (textEditInspectorFocusedRef.current &&
          !!target.closest(INSPECTOR_POPUP_SELECTOR)));
    const isTextEntry = (target: Element | null): boolean =>
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable) ||
      (target instanceof HTMLInputElement &&
        !["button", "checkbox", "radio", "range", "color"].includes(
          target.type,
        ));
    let focusVisitedInspectorPopup = false;
    const cancelPendingTextEditResume = () => {
      const pending = pendingTextEditResumeRef.current;
      if (pending) window.cancelAnimationFrame(pending.frameId);
      pendingTextEditResumeRef.current = null;
    };
    const setInspectorFocus = (focused: boolean) => {
      if (!focused && pendingTextEditResumeRef.current) return;
      if (
        textEditInspectorFocusedRef.current === focused &&
        (focused || !textEditingStateRef.current.hasRange)
      ) {
        return;
      }
      textEditInspectorFocusedRef.current = focused;
      postOneShotBridgeMessage({
        type: "text-edit-inspector-focus",
        focused,
      });
    };
    const scheduleTextEditResume = (origin: HTMLElement) => {
      const state = textEditingStateRef.current;
      const owningScreenId = screenId ?? contentKey ?? "";
      const iframe = iframeRef.current;
      const contentWindow = iframe?.contentWindow;
      if (
        !owningScreenId ||
        !textEditInspectorFocusedRef.current ||
        !state.hasRange ||
        !state.selector ||
        !iframe ||
        !contentWindow
      ) {
        return;
      }

      cancelPendingTextEditResume();
      const resumeIntent: NonNullable<typeof pendingTextEditResumeRef.current> =
        {
          origin,
          iframe,
          contentWindow,
          screenId: owningScreenId,
          selector: state.selector,
          sourceId: state.sourceId,
          phase: "waiting",
          frameId: 0,
        };
      pendingTextEditResumeRef.current = resumeIntent;
      resumeIntent.frameId = window.requestAnimationFrame(() => {
        if (pendingTextEditResumeRef.current !== resumeIntent) return;
        const latest = textEditingStateRef.current;
        const currentScreenId = screenId ?? contentKey ?? "";
        const focused = document.activeElement;
        if (
          isTextEntry(focused) ||
          !!focused?.closest(INSPECTOR_POPUP_SELECTOR) ||
          iframeRef.current !== iframe ||
          iframe.contentWindow !== contentWindow ||
          currentScreenId !== resumeIntent.screenId ||
          !registerRuntimeBridge ||
          !latest.hasRange ||
          latest.selector !== resumeIntent.selector ||
          latest.sourceId !== resumeIntent.sourceId
        ) {
          cancelPendingTextEditResume();
          return;
        }

        resumeIntent.phase = "resuming";
        textEditInspectorFocusedRef.current = false;
        iframe.focus();
        postOneShotBridgeMessage({
          type: "resume-text-edit",
          screenId: resumeIntent.screenId,
          selector: resumeIntent.selector,
          sourceId: resumeIntent.sourceId,
        });
        pendingTextEditResumeRef.current = null;
      });
    };
    const handleFocusIn = (event: FocusEvent) => {
      const pending = pendingTextEditResumeRef.current;
      if (
        pending?.phase === "waiting" &&
        !isInspectorTarget(event.target) &&
        event.target !== document.body &&
        event.target !== document.documentElement
      ) {
        cancelPendingTextEditResume();
      }
      if (!textEditingStateRef.current.hasRange) return;
      if (isInspectorTarget(event.target)) {
        if (pending?.phase === "waiting" && event.target !== pending.origin) {
          cancelPendingTextEditResume();
        }
        setInspectorFocus(true);
        // A closing select or picker hands focus back to its trigger (after
        // unmounting, so relatedTarget is null): the range style is
        // committed, so return the keyboard to the text.
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest(INSPECTOR_POPUP_SELECTOR)
        ) {
          focusVisitedInspectorPopup = true;
        } else if (
          focusVisitedInspectorPopup &&
          target instanceof HTMLElement &&
          !isTextEntry(target)
        ) {
          focusVisitedInspectorPopup = false;
          scheduleTextEditResume(target);
        }
      } else if (textEditInspectorFocusedRef.current) {
        setInspectorFocus(false);
      }
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (
        textEditInspectorFocusedRef.current &&
        event.relatedTarget !== null &&
        !isInspectorTarget(event.relatedTarget)
      ) {
        setInspectorFocus(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      cancelPendingTextEditResume();
      if (isInspectorTarget(event.target)) {
        if (textEditingStateRef.current.hasRange) setInspectorFocus(true);
      } else {
        focusVisitedInspectorPopup = false;
        if (
          textEditingStateRef.current.hasRange ||
          textEditInspectorFocusedRef.current
        ) {
          setInspectorFocus(false);
        }
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const pendingResume = pendingTextEditResumeRef.current;
      if (
        pendingResume?.phase === "waiting" &&
        event.target !== pendingResume.origin
      ) {
        cancelPendingTextEditResume();
      }
      if (
        !registerRuntimeBridge ||
        event.key !== "Enter" ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }
      const target = event.target;
      if (
        !(target instanceof HTMLInputElement) ||
        (target.type !== "text" && target.type !== "number") ||
        target.disabled ||
        target.readOnly ||
        !isInspectorTarget(target) ||
        target.closest(
          '[role="menu"], [role="listbox"], [role="combobox"], [role="dialog"], [data-radix-popper-content-wrapper], [data-slot="popover-content"]',
        )
      ) {
        return;
      }
      scheduleTextEditResume(target);
    };
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancelPendingTextEditResume();
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    contentKey,
    interactMode,
    postOneShotBridgeMessage,
    registerRuntimeBridge,
    screenId,
  ]);
  const [renderedDocument, setRenderedDocument] = useState(() => ({
    content,
    sourceContent: authoredSourceContent ?? content,
  }));
  const [effectivePreviewToken, setEffectivePreviewToken] =
    useState(previewToken);
  const [effectiveLiveEditCapability, setEffectiveLiveEditCapability] =
    useState(liveEditCapability);
  const [
    effectiveLiveEditRegistrationCapability,
    setEffectiveLiveEditRegistrationCapability,
  ] = useState(liveEditRegistrationCapability);
  useEffect(() => {
    setEffectivePreviewToken(previewToken);
    if (previewToken) onPreviewTokenChange?.(screenId, previewToken);
  }, [onPreviewTokenChange, previewToken]);
  useEffect(() => {
    setEffectiveLiveEditCapability(liveEditCapability);
  }, [liveEditCapability]);
  useEffect(() => {
    setEffectiveLiveEditRegistrationCapability(liveEditRegistrationCapability);
  }, [liveEditRegistrationCapability]);
  const renderedContent = renderedDocument.content;
  // What a freshly loaded document already contains, since srcdoc is built from
  // it. The load handler below needs this to skip redundant pushes.
  const renderedContentRef = useRef(renderedContent);
  renderedContentRef.current = renderedContent;
  const pendingRuntimeLayerSnapshotReservationsRef = useRef(
    new Map<
      string,
      {
        promise: Promise<{ reservationToken: string } | { error: unknown }>;
        timeout: number;
      }
    >(),
  );
  useEffect(
    () => () => {
      for (const reservation of pendingRuntimeLayerSnapshotReservationsRef.current.values()) {
        window.clearTimeout(reservation.timeout);
      }
      pendingRuntimeLayerSnapshotReservationsRef.current.clear();
    },
    [],
  );
  // True while a drawing send is capturing/compositing/uploading the
  // annotated screenshot (see design-canvas/annotation-snapshot.ts). Drives
  // SharedDrawOverlay's busy Send state so a slow capture can't be triggered
  // twice from the same drawing.
  const [annotationCaptureBusy, setAnnotationCaptureBusy] = useState(false);
  const annotationCaptureBusyRef = useRef(false);
  const [, setFetchedExternalSnapshot] = useState<{
    url: string;
    html: string;
  } | null>(null);
  const [externalSnapshotState, setExternalSnapshotState] = useState<{
    url: string;
    status: "loading" | "error";
    message?: string;
  } | null>(null);
  const [registeredLiveEditBridgeKey, setRegisteredLiveEditBridgeKey] =
    useState<string | null>(null);
  const [externalSnapshotRetryNonce, setExternalSnapshotRetryNonce] =
    useState(0);
  // Exponential backoff for the auto-retry loop below: 1.5s → 3s → 6s →
  // capped at ~15s, so a genuinely-down dev server doesn't get hammered with
  // a fixed 1.5s-forever retry loop. Resets to 0 on a successful fetch or a
  // manual retry click (see handleManualSnapshotRetry) so the next failure
  // starts the backoff over rather than continuing to climb.
  const snapshotRetryAttemptRef = useRef(0);
  // Mirrors the snapshot fetch's own retry/error state above: the
  // /live-edit-bridge registration POST used to have no retry/backoff or
  // error surface at all — a transient failure (dev server hiccup, brief
  // network blip) left registeredLiveEditBridgeKey stuck at null forever,
  // which pins waitingForLiveEditBridge true and the user stares at
  // "Preparing live editor..." with no explanation and no way to recover
  // short of reloading the whole page.
  const bridgeRegistrationRetryAttemptRef = useRef(0);
  const bridgeRegistrationRetryTimerRef = useRef<number | undefined>(undefined);
  // Two registration attempts can be in flight at once — the automatic
  // effect-driven one and a manually-triggered "Connect" click (see
  // attemptBridgeRegistration/handleConnectLocalNetworkAccess below) — and
  // they can resolve out of order. Only the most recent attempt's result may
  // ever be written to state, or an earlier failure resolving after a later
  // success would incorrectly flip the UI back to "still blocked".
  const bridgeRegistrationAttemptGenerationRef = useRef(0);
  const previewTokenRefreshAttemptRef = useRef<string | null>(null);
  const [bridgeRegistrationRetryNonce, setBridgeRegistrationRetryNonce] =
    useState(0);
  // Scoped strictly to the registration fetch() itself failing — drives
  // externalPreviewUrl's raw-URL fallback and the floating
  // LocalNetworkAccessPrompt card below. Deliberately separate from
  // bridgeConnectionLostError: a fetch failure and "the live document never
  // confirmed ready after a successful registration" (handleSuspectedBridge
  // Restart's destructive paths) are different failure modes — the latter
  // proves the bridge WAS reachable, so a permission-flavored "maybe you need
  // to grant local network access" message would be actively misleading
  // there, and unlike a fetch failure there's no still-reachable raw
  // dev-server document to fall back to showing (the live document itself is
  // what stopped responding).
  const [bridgeRegistrationError, setBridgeRegistrationError] = useState<{
    bridgeKey: string;
    message: string;
  } | null>(null);
  // handleSuspectedBridgeRestart's destructive terminal states (retry budget
  // exhausted, or /health itself confirms the process is unreachable) keep
  // their original full-cover blocking card and retry action, untouched by
  // the raw-fallback/floating-card behavior above — see
  // bridgeRegistrationError's comment for why these must not share state.
  const [bridgeConnectionLostError, setBridgeConnectionLostError] = useState<{
    bridgeKey: string;
    message: string;
  } | null>(null);
  // Distinguishes "Chrome's Local Network Access permission is blocking this
  // request" from "the dev server is genuinely down" — see
  // classifyBridgeRegistrationFailure. Drives which copy/icon the floating
  // LocalNetworkAccessPrompt card shows; null while unclassified or resolved.
  const [bridgeRegistrationFailureKind, setBridgeRegistrationFailureKind] =
    useState<BridgeRegistrationFailureKind | null>(null);
  // Dismissing the floating connect card is per-script-revision: keyed by the
  // liveEditBridgeKey it was shown for, so a genuinely new script/mode change
  // re-surfaces the card instead of leaving it permanently dismissed.
  const [
    localNetworkAccessDismissedForKey,
    setLocalNetworkAccessDismissedForKey,
  ] = useState<string | null>(null);
  const [connectingLocalNetworkAccess, setConnectingLocalNetworkAccess] =
    useState(false);
  const [
    localNetworkAccessPermissionState,
    setLocalNetworkAccessPermissionState,
  ] = useState<LocalNetworkAccessPermissionState | null>(null);
  // Cache of the bridgeInstanceId returned by the client's LAST successful
  // /live-edit-bridge registration POST (see the registration effect below).
  // Compared against a later /health probe's bridgeInstanceId to tell "the
  // bridge process restarted since we registered" apart from "the same
  // process really doesn't know this key" — see classifyLiveEditHealthProbe
  // above.
  const bridgeInstanceIdRef = useRef<string | null>(null);
  // A destructive watchdog outcome replaces the live iframe with the neutral
  // pending document. The live document can still have queued its ready
  // handshake immediately before that replacement; once unmounted, its
  // WindowProxy no longer equals iframeRef.current.contentWindow and would be
  // rejected by the normal bridge trust check. Preserve exactly that retired
  // generation so its late ready can restore the matching bridge key. Both
  // source-window identity and bridge-key identity must match, preventing a
  // stale document from reviving a different screen/script generation.
  const lateLiveEditReadyRecoveryRef = useRef<{
    source: Window;
    bridgeKey: string;
    registrationHandoffKey: string | null;
  } | null>(null);
  // Guards the auto-reregister probe below against overlapping runs and bounds
  // how many times it will silently retry before giving up and surfacing the
  // existing error/Retry UI (MAX_LIVE_EDIT_RESTART_ATTEMPTS). This budget is
  // specific to the "reregister" (different bridgeInstanceId, genuine bridge
  // restart) loop — the same-instance-id "escalate" loop below has its own,
  // separate ceiling and does not consume this budget.
  const liveEditRestartInFlightRef = useRef(false);
  const liveEditRestartAttemptRef = useRef(0);
  // Same-instance-id ("escalate") loop state: how long we've cumulatively
  // waited on THIS bridge key while /health keeps confirming the bridge
  // process is healthy, the current per-arm wait, and the pending re-arm
  // timer (so it can be cancelled on ready/unmount/key-change). See
  // handleSuspectedBridgeRestart and classifyLiveEditHealthProbe above.
  const liveEditSameInstanceElapsedMsRef = useRef(0);
  const liveEditSameInstanceDelayRef = useRef(LIVE_EDIT_READY_TIMEOUT_MS);
  const liveEditSameInstanceRearmTimerRef = useRef<number | undefined>(
    undefined,
  );
  // Non-destructive counterpart to bridgeRegistrationError: shown as an
  // overlay error/Retry card WITHOUT nulling registeredLiveEditBridgeKey, so
  // the still-loading iframe is never torn down while it's shown. Only set
  // once the same-instance-id escalation loop above exceeds its ceiling; a
  // late ready handshake clears it (see the message-handler branch below).
  const [
    liveEditSameInstanceStalledError,
    setLiveEditSameInstanceStalledError,
  ] = useState<{
    bridgeKey: string;
    message: string;
  } | null>(null);
  // Clears the escalation re-arm timer on unmount so it can't fire and
  // schedule a fetch after this component is gone. (A stray fetch would be a
  // no-op anyway — every /health probe checkpoint is generation-guarded via
  // bridgeRegistrationAttemptGenerationRef, see handleSuspectedBridgeRestart
  // — but there's no reason to let the timer fire in the first place.)
  useEffect(
    () => () => {
      if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
        window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
        liveEditSameInstanceRearmTimerRef.current = undefined;
      }
    },
    [],
  );
  const onExternalContentSnapshotRef = useRef(onExternalContentSnapshot);
  const isEmbeddedFrame = Boolean(embeddedFrame);
  const [cachedSharedSnapshot, setCachedSharedSnapshot] = useState<{
    designId: string;
    fileId: string;
    html: string | null;
    updatedAt: string | null;
    captureRevision: string;
    publishedRevision: string;
  } | null>(null);
  const matchingSharedSnapshot =
    cachedSharedSnapshot?.designId === designId &&
    cachedSharedSnapshot?.fileId === screenId
      ? cachedSharedSnapshot
      : null;
  const handleSharedSnapshot = useCallback(
    (snapshot: VisualEditSharedSnapshot | null) =>
      setCachedSharedSnapshot(snapshot),
    [],
  );
  // The screen's own URL wins: it carries the route path and may address the
  // container through a same-origin proxy. `fusionUrl` only covers fusion
  // screens whose content is still the original inline HTML.
  const rawExternalPreviewUrl = useMemo(() => {
    if (snapshotOnly && sourceType === "localhost") return null;
    const overrideUrl = getExternalPreviewUrl(previewUrlOverride ?? "");
    if (overrideUrl) return overrideUrl;
    const contentUrl = getExternalPreviewUrl(
      sourceType === "localhost" ? renderedContent : content,
    );
    if (contentUrl) return contentUrl;
    if (sourceType === "fusion" && fusionUrl) {
      try {
        const url = new URL(fusionUrl);
        url.hash = "";
        return url.toString();
      } catch {
        // coercion-ok: an unparseable URL has no frame to render; the screen
        // falls back to its own content, as it did before any fusion linkage.
        return null;
      }
    }
    return null;
  }, [
    content,
    fusionUrl,
    previewUrlOverride,
    renderedContent,
    snapshotOnly,
    sourceType,
  ]);
  const runtimeLayerSnapshotEnabled =
    (sourceType === "localhost" || sourceType === "fusion") &&
    Boolean(rawExternalPreviewUrl) &&
    Boolean(onRuntimeLayerSnapshot);

  // Only a URL-backed frame installs the live-edit bundle built below. An
  // inline screen carries its bridge in srcdoc, and building plus hashing
  // ~800KB per screen is not free.
  const urlBackedFrame = Boolean(rawExternalPreviewUrl);

  // Bake a neutral scale of 1 here (not the zoom-folded scale): this script is
  // registered with the localhost bridge via a large POST, so folding live zoom
  // in would re-fire the registration effect on every zoom tick. Live scale is
  // pushed separately over the `set-editor-chrome-scale` postMessage below.
  //
  // readOnly and editMode are ALSO intentionally excluded from the deps below
  // (only read for their FIRST-render baked value) — mirroring the srcdoc
  // useMemo's own "readOnly and editMode are intentionally NOT deps" comment
  // for inline screens further down this file. Before this fix, this memo
  // (unlike the inline srcdoc one) DID list them as deps: every readOnly/
  // editMode change rebuilt this script, which changed liveEditBridgeKey
  // (its contentHash), which is embedded in the localhost iframe's `src` via
  // resolveLiveEditPreviewUrl — so a routine Edit ⇄ Preview toggle (or a
  // canEditDesign permission flip) forced a real cross-origin navigation of
  // the embedded dev-server iframe, losing its in-app route/scroll/state.
  // Live readOnly/editMode changes flow through the set-read-only and
  // set-text-editing-enabled postMessages (see the useEffects below) exactly
  // like the inline path, so no live-update behavior is lost by removing
  // them here.
  const editorChromeBridgeForCurrentState = useMemo(
    () =>
      urlBackedFrame
        ? buildEditorChromeBridgeScript({
            readOnly,
            editMode,
            editorChromeScaleX: 1,
            editorChromeScaleY: 1,
            screenId: screenId ?? "",
            boardSurface,
            contentOffsetX: embeddedFrame?.contentOffsetX ?? 0,
            contentOffsetY: embeddedFrame?.contentOffsetY ?? 0,
            runtimeLayerSnapshotEnabled,
            // A live/localhost screen's document is the running app, not
            // content this canvas rendered, so there is no source head to
            // diff against.
            initialSourceHead: "",
          })
        : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardSurface, runtimeLayerSnapshotEnabled, screenId, urlBackedFrame],
  );
  // Keep the installed gesture script identical between overview and focused
  // mode. The live flags are posted below; baking `isEmbeddedFrame` into the
  // script changed the bridge key during responsive Interact and defeated the
  // registration handoff cache, forcing an avoidable iframe navigation.
  // Interaction ownership is switched in-place after the bridge handshake;
  // baking the mode into this script changes the live bridge key and reloads
  // the running app.
  const embeddedGestureBridgeForCurrentState = useMemo(
    () =>
      EMBEDDED_WHEEL_BRIDGE_SCRIPT.replace(
        "__EMBEDDED_WHEEL_FORWARDING_ENABLED__",
        "false",
      )
        .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "false")
        .replace("__EDITING_SAFETY_ENABLED__", "true"),
    [],
  );
  // srcdoc is rebuilt per document, so unlike the keyed live-edit bundle above
  // it can carry the real first-paint value: forwarding that arrives only by
  // postMessage stays dead until the handshake, and is stranded by a swap.
  const initialInteractModeRef = useRef(interactMode);
  const embeddedGestureBridgeForSrcdoc = useMemo(
    () =>
      EMBEDDED_WHEEL_BRIDGE_SCRIPT.replace(
        "__EMBEDDED_WHEEL_FORWARDING_ENABLED__",
        isEmbeddedFrame && !initialInteractModeRef.current ? "true" : "false",
      )
        .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "false")
        .replace(
          "__EDITING_SAFETY_ENABLED__",
          initialInteractModeRef.current ? "false" : "true",
        ),
    [isEmbeddedFrame],
  );
  const includeLiveEditEditorChrome = !readOnly;
  const liveEditBridgeScript = useMemo(() => {
    if (!urlBackedFrame) return "";
    return (
      LIVE_ROUTE_BRIDGE_SCRIPT +
      (includeLiveEditEditorChrome
        ? MOTION_PREVIEW_BRIDGE_SCRIPT +
          SHADER_FILL_PREVIEW_BRIDGE_SCRIPT +
          TWEAK_BRIDGE_SCRIPT +
          ZOOM_BRIDGE_SCRIPT +
          LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT +
          embeddedGestureBridgeForCurrentState +
          editorChromeBridgeForCurrentState
        : embeddedGestureBridgeForCurrentState)
    );
  }, [
    editorChromeBridgeForCurrentState,
    embeddedGestureBridgeForCurrentState,
    includeLiveEditEditorChrome,
    urlBackedFrame,
  ]);
  const liveEditBridgeKey = useMemo(
    () => contentHash(liveEditBridgeScript),
    [liveEditBridgeScript],
  );
  const registrationHandoffKey = liveEditRegistrationHandoffKey(
    bridgeUrl,
    liveEditBridgeKey,
  );
  const usesLiveEditInjectedBridge =
    sourceType === "localhost" &&
    Boolean(bridgeUrl && effectivePreviewToken && rawExternalPreviewUrl);
  useEffect(() => {
    if (!usesLiveEditInjectedBridge) {
      setLocalNetworkAccessPermissionState(null);
      return;
    }
    let cancelled = false;
    void getLocalNetworkAccessPermissionState().then((state) => {
      if (!cancelled) setLocalNetworkAccessPermissionState(state);
    });
    return () => {
      cancelled = true;
    };
  }, [usesLiveEditInjectedBridge]);
  // Hoisted above usesLiveEditEditorBridge (rather than declared next to
  // externalPreviewUrl/usingRawFallbackPreview below, which reuse it) because
  // a failed registration's raw-URL fallback document has no injected editor
  // bridge script and can never answer an editor command or post the ready
  // handshake — usesLiveEditEditorBridge must already reflect that, or the
  // still-"editable" chrome above it (selection, inspector, hover) lets the
  // user attempt edits that silently queue forever against a frame that will
  // never respond (see postOneShotBridgeMessage's queueing above).
  const bridgeRegistrationFailedForCurrentKey =
    bridgeRegistrationError?.bridgeKey === liveEditBridgeKey;
  const usesLiveEditEditorBridge =
    usesLiveEditInjectedBridge &&
    includeLiveEditEditorChrome &&
    !bridgeRegistrationFailedForCurrentKey;
  const effectiveRegisteredLiveEditBridgeKey =
    registeredLiveEditBridgeKey ??
    (hasRecentLiveEditRegistration(registrationHandoffKey)
      ? liveEditBridgeKey
      : null);
  const liveEditBridgeRegistered =
    usesLiveEditInjectedBridge &&
    effectiveRegisteredLiveEditBridgeKey === liveEditBridgeKey;
  // The live iframe and the editable source model are deliberately separate:
  // render exactly one authenticated /live-edit document while fetching
  // /snapshot in parallel so DesignEditor patches real HTML rather than the
  // persisted URL string. The snapshot never replaces the live iframe.
  const requiresExternalSourceSnapshot = shouldFetchExternalSourceSnapshot({
    sourceType,
    bridgeUrl,
    previewToken: effectivePreviewToken,
    previewUrl: rawExternalPreviewUrl,
    hasSnapshotConsumer: Boolean(onExternalContentSnapshot),
  });
  const liveEditExternalPreviewUrl = resolveLiveEditPreviewUrl({
    sourceType,
    bridgeUrl,
    previewToken: effectivePreviewToken,
    previewUrl: rawExternalPreviewUrl,
    bridgeKey: liveEditBridgeKey,
    registeredBridgeKey: effectiveRegisteredLiveEditBridgeKey,
  });
  // Edit mode deliberately keeps `renderedContent` stable while same-screen
  // source writes echo back, because the bridge already applied them and a
  // srcdoc rebuild would flash/reload the canvas. Interact mode has no editor
  // bridge, so crossing that boundary must use the latest persisted `content`
  // or native hover/focus/pressed behavior would run against the stale HTML
  // from before the inspector edits.
  //
  // The owner uses the running localhost app. A shared Visual Edit viewer gets
  // the last published snapshot and never attempts to load its own localhost.
  // A source-mode transition is also an authoritative content boundary. A
  // URL cached by the edit-mode bridge must not keep a URL-backed iframe alive
  // after URL -> static, or the canvas shows the old live app behind a
  // permanent bridge-loading surface. Same-mode localhost edits still keep
  // their cached URL so the live document is not needlessly reloaded. Keep the
  // legacy inline baseline stable for same-screen runtime replacements; only a
  // stale URL marker needs the new source bytes immediately.
  const useCurrentIframeContent =
    interactMode ||
    (sourceType !== "localhost" &&
      Boolean(getExternalPreviewUrl(renderedContent)));
  const snapshotSourceContent = snapshotOnly
    ? matchingSharedSnapshot
      ? (matchingSharedSnapshot.html ?? "")
      : (externalSnapshotHtml ?? "")
    : (externalSnapshotHtml ?? renderedContent);
  const iframeRenderContent = useMemo(() => {
    if (snapshotOnly) {
      return !snapshotSourceContent.trim() ||
        getExternalPreviewUrl(snapshotSourceContent)
        ? ""
        : sanitizeVisualEditSnapshotHtml(snapshotSourceContent);
    }
    return useCurrentIframeContent ? content : renderedContent;
  }, [
    content,
    renderedContent,
    snapshotOnly,
    snapshotSourceContent,
    useCurrentIframeContent,
  ]);
  const iframeSourceContent = useCurrentIframeContent
    ? (authoredSourceContent ?? content)
    : renderedDocument.sourceContent;
  const iframeSourceProvenance = useMemo(
    () => createSourceDocumentProvenance(iframeSourceContent),
    [iframeSourceContent],
  );

  const desktopNativeSnapshot = useDesktopDesignNativePreview({
    iframeRef,
    url: rawExternalPreviewUrl,
    workspaceId: designId,
    connectionId,
    screenId,
    enabled:
      nativePreviewActive &&
      interactMode &&
      !embeddedFrame &&
      !boardSurface &&
      Boolean(rawExternalPreviewUrl),
    mode: interactMode
      ? "interact"
      : drawMode
        ? "draw"
        : pinMode
          ? "comment"
          : "edit",
    presentation: embeddedFrame || boardSurface ? "overview" : "focused",
    scale: zoom / 100,
    active: nativePreviewActive,
  });
  const desktopNativeSnapshotLayer = resolveDesktopDesignSnapshotLayer({
    hasSnapshot: Boolean(desktopNativeSnapshot),
    interactMode,
    editMode,
    hasLiveEditorBridge: usesLiveEditEditorBridge,
  });
  // Null only while an entitled viewer's keyed bridge is still registering.
  // During that interval the loading surface renders without an iframe; once
  // registration succeeds, the one real proxied document mounts directly.
  // A viewer with no previewToken has no bridge to wait for, so it loads the
  // dev server directly rather than degrading to a snapshot.
  //
  // A FAILED registration (most commonly Chrome's Local Network Access
  // permission blocking the fetch — see classifyBridgeRegistrationFailure)
  // falls back the same way: the dev server URL remains the honest live
  // fallback, although Chrome may gate this loopback iframe navigation behind
  // the same Local Network Access permission. The iframe's explicit policy
  // allows that prompt; LocalNetworkAccessPrompt offers the way to enable
  // editing from here.
  const usingRawFallbackPreview =
    usesLiveEditInjectedBridge &&
    !liveEditExternalPreviewUrl &&
    bridgeRegistrationFailedForCurrentKey;
  const externalPreviewUrl =
    liveEditExternalPreviewUrl ??
    (usesLiveEditInjectedBridge
      ? bridgeRegistrationFailedForCurrentKey
        ? rawExternalPreviewUrl
        : null
      : rawExternalPreviewUrl);
  const runtimeVerificationUrl = useMemo(() => {
    if (!runtimeVerificationRequest || !externalPreviewUrl) return null;
    return externalPreviewUrl;
  }, [externalPreviewUrl, runtimeVerificationRequest]);
  // Source hydration is parallel and must never block or replace the one live
  // iframe. Apply-to-source remains guarded until the callback has populated
  // DesignEditor's source snapshot.
  const waitingForEditableExternalSnapshot = false;
  const waitingForLiveEditBridge =
    usesLiveEditInjectedBridge && !liveEditBridgeRegistered;
  const showProactiveLocalNetworkAccessPrompt =
    usesLiveEditInjectedBridge &&
    localNetworkAccessPermissionState === "prompt" &&
    !liveEditBridgeRegistered &&
    localNetworkAccessDismissedForKey !== liveEditBridgeKey;
  useLayoutEffect(() => {
    if (zoomPropRef.current === zoom) return;
    zoomPropRef.current = zoom;
    if (imperativeZoomRef.current === zoom) {
      imperativeZoomRef.current = null;
      return;
    }
    if (zoomCommitTimerRef.current !== null) {
      window.clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    imperativeZoomRef.current = null;
    zoomRef.current = zoom;
    zoomGestureGenerationRef.current += 1;
  }, [zoom]);
  if (imperativeZoomRef.current === zoom) imperativeZoomRef.current = null;
  zoomRef.current = imperativeZoomRef.current ?? zoom;
  runtimeReplacementContentRef.current = runtimeReplacementContent;
  runtimeReplacementSourceRef.current =
    authoredSourceContent ?? runtimeReplacementContent;
  runtimeReplacementKeyRef.current = runtimeReplacementKey;

  // A framed container has no dev-server bridge to register the editor chrome
  // with, so it goes over postMessage to the bootstrap its proxy injects.
  const containerPreview = useMemo(() => {
    // Not the localhost live-edit path: there the bridge server injects the
    // bridge into its own proxied document, so nothing is posted from here.
    if (usesLiveEditInjectedBridge) return false;
    if (!externalPreviewUrl || typeof window === "undefined") return false;
    try {
      return (
        new URL(externalPreviewUrl, window.location.href).origin !==
        window.location.origin
      );
      // coercion-ok: an unparseable URL frames nothing to bridge into.
    } catch {
      return false;
    }
  }, [externalPreviewUrl, usesLiveEditInjectedBridge]);
  const installedBridgeKeyRef = useRef<string | null>(null);
  const sendBridgeToContainer = useCallback(() => {
    if (!containerPreview || !includeLiveEditEditorChrome) return;
    const target = iframeRef.current?.contentWindow;
    if (!target || !externalPreviewUrl) return;
    if (installedBridgeKeyRef.current === liveEditBridgeKey) return;
    let origin: string;
    try {
      origin = new URL(externalPreviewUrl, window.location.href).origin;
      // coercion-ok: without a parseable origin there is nowhere safe to post.
    } catch {
      return;
    }
    try {
      // Never "*": the bridge carries editor internals, and the container is
      // the only window that should receive it.
      target.postMessage(
        {
          type: "agentNative.installBridge",
          key: liveEditBridgeKey,
          script: liveEditBridgeScript,
        },
        origin,
      );
    } catch (error) {
      // Leave the key unmarked: `bridgeReady` drives the real install, and
      // marking a failed attempt disables the bridge for the document's life.
      console.error("[design:bridge] install post threw", origin, error);
      return;
    }
    console.log(
      "[design:bridge] install posted from",
      window.location.origin,
      "to",
      origin,
    );
    installedBridgeKeyRef.current = liveEditBridgeKey;
  }, [
    containerPreview,
    externalPreviewUrl,
    includeLiveEditEditorChrome,
    liveEditBridgeKey,
    liveEditBridgeScript,
  ]);
  // The bootstrap announces itself on every document load, which is also how a
  // reload or in-frame navigation asks for the bridge again.
  useEffect(() => {
    if (!containerPreview) return;
    function onBootstrapMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      // A failed install must not read as an installed one, or the retry below
      // never fires and the canvas silently loses selection and inline editing.
      if (event.data?.type === "agentNative.bridgeFailed") {
        installedBridgeKeyRef.current = null;
        console.error(
          "[design] editor bridge failed to install in the preview:",
          event.data?.message,
        );
        return;
      }
      if (event.data?.type === "agentNative.bridgeRejected") {
        installedBridgeKeyRef.current = null;
        console.error(
          `[design] the preview container refused the editor bridge from ${window.location.origin}. ` +
            "Containers install it only for https://design.agent-native.com, so selection " +
            "and inline editing are dead anywhere else.",
        );
        return;
      }
      if (event.data?.type === "agentNative.bridgeInstalled") {
        console.log("[design:bridge] installed", event.data?.key);
        return;
      }
      if (event.data?.type !== "agentNative.bridgeReady") return;
      console.log("[design:bridge] container reported ready");
      installedBridgeKeyRef.current = null;
      sendBridgeToContainer();
    }
    window.addEventListener("message", onBootstrapMessage);
    return () => window.removeEventListener("message", onBootstrapMessage);
  }, [containerPreview, sendBridgeToContainer]);

  useEffect(() => {
    onExternalContentSnapshotRef.current = onExternalContentSnapshot;
  }, [onExternalContentSnapshot]);

  // Register the editor bridge script with the localhost live-edit bridge so
  // it gets injected into the proxied preview. Re-runs only when the script
  // content (liveEditBridgeKey) or the bridge target changes (or a retry —
  // auto or manual — bumps bridgeRegistrationRetryNonce).
  //
  // Mirrors the external-source-snapshot fetch effect's own retry/backoff:
  // a transient failure used to leave registeredLiveEditBridgeKey stuck at
  // null forever (console.warn only, no retry, no error UI), pinning
  // waitingForLiveEditBridge true with no way to recover short of a full
  // page reload.
  const scheduleBridgeRegistrationRetry = useCallback(() => {
    const delay = getSnapshotRetryDelayMs(
      bridgeRegistrationRetryAttemptRef.current,
    );
    bridgeRegistrationRetryAttemptRef.current += 1;
    bridgeRegistrationRetryTimerRef.current = window.setTimeout(() => {
      setBridgeRegistrationRetryNonce((nonce) => nonce + 1);
    }, delay);
  }, []);
  // Invalidates any registration attempt still in flight when THIS effect
  // instance unmounts — deliberately not a one-way "isUnmounted" flag: that
  // shape never resets, so under StrictMode's dev-only mount→cleanup→mount
  // replay it would stay stuck true after the first (intentionally
  // discarded) cleanup and permanently block every later, genuinely-live
  // attempt. Bumping the generation counter here instead only invalidates
  // the specific attempt that was in
  // flight at THIS cleanup; the next mount's own attempt captures a fresh
  // generation and is unaffected.
  useEffect(
    () => () => {
      bridgeRegistrationAttemptGenerationRef.current += 1;
    },
    [],
  );
  // Single source of truth for a registration attempt, shared by the
  // automatic effect below and the manual "Connect" button (see
  // handleConnectLocalNetworkAccess) — see bridgeRegistrationAttemptGeneration
  // Ref's comment for why a shared, generation-guarded function is required
  // instead of each caller firing its own independent fetch.
  // Returns true/false for a transient definite outcome, a terminal stale-token
  // outcome, or null when a newer attempt (effect-driven or manual) has already
  // superseded this one. Callers must treat null and stale-token as "nothing to
  // retry", or a stale attempt could schedule a redundant retry after a later
  // attempt already succeeded.
  const attemptBridgeRegistration =
    useCallback(async (): Promise<BridgeRegistrationAttemptResult> => {
      if (
        !usesLiveEditInjectedBridge ||
        !bridgeUrl ||
        !effectivePreviewToken ||
        !(
          effectiveLiveEditRegistrationCapability ?? effectiveLiveEditCapability
        )
      ) {
        return null;
      }
      const generation = ++bridgeRegistrationAttemptGenerationRef.current;
      // Unmount is covered by the dedicated cleanup-only effect above, which
      // bumps this same counter — a manual Connect click's fetch has no effect
      // cleanup of its own to cancel it, but that effect's bump still
      // invalidates it the same way a superseded attempt is invalidated.
      const isCurrent = () =>
        bridgeRegistrationAttemptGenerationRef.current === generation;
      // A fresh attempt — whether auto-retry or a manual Connect click,
      // including one retried from the destructive bridgeConnectionLostError
      // card's own Retry button (see handleConnectLocalNetworkAccess) — means
      // we're no longer in "connection lost, needs a click" limbo. Clear it now
      // rather than only on success/failure, or the full-cover destructive card
      // stays visible (it takes priority in the overlay below) even once this
      // attempt resolves as an ordinary registration-fetch failure instead.
      setBridgeConnectionLostError(null);
      const endpoint = new URL("/live-edit-bridge", bridgeUrl).toString();
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-design-preview-token": effectivePreviewToken,
            "x-agent-native-live-edit-registration-capability":
              effectiveLiveEditRegistrationCapability ??
              effectiveLiveEditCapability!,
          },
          body: JSON.stringify({
            script: liveEditBridgeScript,
            bridgeKey: liveEditBridgeKey,
            designId,
          }),
        });
        if (isPreviewTokenStaleStatus(response.status)) {
          if (!isCurrent()) return null;
          // A public viewer may outlive the local bridge process. Refresh the
          // read-only credential automatically so a reboot is a recoverable
          // registration event, not a dead iframe that waits for a manual
          // reconnect click. The action never returns the write-capable bridge
          // token; it derives the paired preview credential server-side.
          if (designId && connectionId) {
            try {
              const refreshAttemptKey = `${liveEditBridgeKey}:${effectivePreviewToken}`;
              if (previewTokenRefreshAttemptRef.current === refreshAttemptKey) {
                throw new Error("preview token refresh already retried");
              }
              const refreshed = await callAction<{
                previewToken?: string;
                liveEditCapability?: string;
                liveEditRegistrationCapability?: string;
              }>(
                "refresh-localhost-preview-token",
                { designId, connectionId, publicVisualEdit },
                { method: "GET" },
              );
              const nextPreviewToken = refreshed?.previewToken;
              const nextLiveEditCapability = refreshed?.liveEditCapability;
              const nextRegistrationCapability =
                refreshed?.liveEditRegistrationCapability;
              if (
                isCurrent() &&
                nextPreviewToken &&
                (nextRegistrationCapability || nextLiveEditCapability)
              ) {
                previewTokenRefreshAttemptRef.current = refreshAttemptKey;
                if (registrationHandoffKey) {
                  liveEditRegistrationHandoff.delete(registrationHandoffKey);
                }
                setRegisteredLiveEditBridgeKey(null);
                setBridgeRegistrationError(null);
                setBridgeRegistrationFailureKind(null);
                setConnectingLocalNetworkAccess(false);
                if (nextPreviewToken !== effectivePreviewToken) {
                  setEffectivePreviewToken(nextPreviewToken);
                  onPreviewTokenChange?.(screenId, nextPreviewToken);
                } else {
                  // State equality would otherwise suppress the retry after a
                  // bridge reboot that preserved its deterministic token.
                  setBridgeRegistrationRetryNonce((nonce) => nonce + 1);
                }
                if (nextLiveEditCapability) {
                  setEffectiveLiveEditCapability(nextLiveEditCapability);
                  onLiveEditCapabilityChange?.(
                    screenId,
                    nextLiveEditCapability,
                  );
                }
                if (nextRegistrationCapability) {
                  setEffectiveLiveEditRegistrationCapability(
                    nextRegistrationCapability,
                  );
                  onLiveEditRegistrationCapabilityChange?.(
                    screenId,
                    nextRegistrationCapability,
                  );
                }
                return true;
              }
            } catch (refreshError) {
              // Keep the explicit stale-token error below when the public
              // refresh endpoint cannot recover this connection.
              console.debug(
                "[design:bridge] preview token refresh failed",
                refreshError instanceof Error
                  ? refreshError.message
                  : String(refreshError),
              );
            }
          }
          if (registrationHandoffKey) {
            liveEditRegistrationHandoff.delete(registrationHandoffKey);
          }
          setRegisteredLiveEditBridgeKey(null);
          setBridgeRegistrationError({
            bridgeKey: liveEditBridgeKey,
            message:
              "The local bridge rejected this screen's preview token (401). Reconnect this screen before retrying.",
          });
          setBridgeRegistrationFailureKind("stalePreviewToken");
          setConnectingLocalNetworkAccess(false);
          return "stale-preview-token";
        }
        if (!response.ok) {
          throw new Error(`Bridge registration failed (${response.status})`);
        }
        // coercion-ok: response.ok already confirmed the registration itself
        // succeeded above; bridgeInstanceId is supplementary metadata for the
        // restart-detection heuristic only (see classifyLiveEditHealthProbe),
        // and the null/missing case below is checked explicitly, not treated
        // as equivalent to a present value.
        const payload = (await response.json().catch(() => null)) as {
          bridgeInstanceId?: string;
        } | null;
        if (!isCurrent()) return null;
        if (payload && typeof payload.bridgeInstanceId === "string") {
          // Cache the instance id from THIS successful registration so a
          // later suspected-restart probe (see handleSuspectedBridgeRestart)
          // can tell a genuinely restarted bridge process apart from the same
          // process rejecting a stale key. Written only after isCurrent()
          // passes: an older overlapping request resolving after a newer one
          // must not overwrite the current attempt's instance id, or the
          // watchdog misdiagnoses a restart and burns its reload/retry budget.
          bridgeInstanceIdRef.current = payload.bridgeInstanceId;
        }
        bridgeRegistrationRetryAttemptRef.current = 0;
        previewTokenRefreshAttemptRef.current = null;
        if (registrationHandoffKey) {
          liveEditRegistrationHandoff.set(registrationHandoffKey, Date.now());
        }
        // liveEditRestartAttemptRef is intentionally NOT reset here: a
        // successful registration POST only proves the bridge accepted the
        // script, not that the live document actually loaded it (that's what
        // the ready-handshake watchdog below still has to confirm). Resetting
        // the restart budget on every registration success — rather than only
        // on a genuine agent-native:editor-chrome-ready — would let a
        // pathological bridge that keeps minting a new bridgeInstanceId
        // reregister forever, defeating MAX_LIVE_EDIT_RESTART_ATTEMPTS.
        setBridgeRegistrationError(null);
        setBridgeRegistrationFailureKind(null);
        setBridgeConnectionLostError(null);
        setConnectingLocalNetworkAccess(false);
        lateLiveEditReadyRecoveryRef.current = null;
        setRegisteredLiveEditBridgeKey(liveEditBridgeKey);
        return true;
      } catch (error) {
        if (!isCurrent()) return null;
        if (registrationHandoffKey) {
          liveEditRegistrationHandoff.delete(registrationHandoffKey);
        }
        console.warn("live-edit bridge registration failed", error);
        setRegisteredLiveEditBridgeKey(null);
        setBridgeRegistrationError({
          bridgeKey: liveEditBridgeKey,
          message: error instanceof Error ? error.message : String(error),
        });
        setConnectingLocalNetworkAccess(false);
        void classifyBridgeRegistrationFailure().then((kind) => {
          if (isCurrent()) setBridgeRegistrationFailureKind(kind);
        });
        return false;
      }
    }, [
      bridgeUrl,
      liveEditBridgeKey,
      liveEditBridgeScript,
      effectivePreviewToken,
      effectiveLiveEditCapability,
      effectiveLiveEditRegistrationCapability,
      registrationHandoffKey,
      usesLiveEditInjectedBridge,
      onPreviewTokenChange,
      onLiveEditCapabilityChange,
      onLiveEditRegistrationCapabilityChange,
      designId,
      connectionId,
      publicVisualEdit,
      screenId,
    ]);
  useEffect(() => {
    if (
      !usesLiveEditInjectedBridge ||
      !bridgeUrl ||
      !effectivePreviewToken ||
      !(effectiveLiveEditRegistrationCapability ?? effectiveLiveEditCapability)
    ) {
      // Invalidate any attempt still in flight from before this branch was
      // entered (previous bridge key/mode) BEFORE clearing state below —
      // otherwise that stale attempt's isCurrent() check would still pass
      // when it resolves and could restore registeredLiveEditBridgeKey,
      // failure state, or handoff data after we've already left this
      // localhost/bridge configuration.
      bridgeRegistrationAttemptGenerationRef.current += 1;
      bridgeRegistrationRetryAttemptRef.current = 0;
      liveEditRestartAttemptRef.current = 0;
      liveEditSameInstanceElapsedMsRef.current = 0;
      liveEditSameInstanceDelayRef.current = LIVE_EDIT_READY_TIMEOUT_MS;
      if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
        window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
        liveEditSameInstanceRearmTimerRef.current = undefined;
      }
      setRegisteredLiveEditBridgeKey(null);
      setBridgeRegistrationError(null);
      setBridgeRegistrationFailureKind(null);
      setBridgeConnectionLostError(null);
      setLiveEditSameInstanceStalledError(null);
      lateLiveEditReadyRecoveryRef.current = null;
      return;
    }
    setRegisteredLiveEditBridgeKey((current) =>
      current === liveEditBridgeKey ? current : null,
    );
    let cancelled = false;
    void attemptBridgeRegistration().then((result) => {
      // result === false is a definite, still-applicable failure; null means
      // a newer attempt already superseded this one (see
      // attemptBridgeRegistration's return-type comment) and must not
      // schedule a redundant retry.
      if (result === false && !cancelled) scheduleBridgeRegistrationRetry();
    });
    return () => {
      cancelled = true;
      if (bridgeRegistrationRetryTimerRef.current !== undefined) {
        window.clearTimeout(bridgeRegistrationRetryTimerRef.current);
        bridgeRegistrationRetryTimerRef.current = undefined;
      }
    };
  }, [
    attemptBridgeRegistration,
    bridgeRegistrationRetryNonce,
    bridgeUrl,
    liveEditBridgeKey,
    effectivePreviewToken,
    scheduleBridgeRegistrationRetry,
    usesLiveEditInjectedBridge,
  ]);

  // A liveEditBridgeKey change means the registered script content changed
  // (different screen, mode, or scale bake) — a completely new registration
  // target. Reset the reregister-attempt budget and the same-instance-id
  // escalation state (elapsed wait, backoff delay, pending re-arm timer, and
  // any stalled-error card) so a previous screen's exhausted retries/backoff
  // never leak into this new screen's fresh watchdog cycle. Deliberately
  // separate from the watchdog-arm effect below, which resets the escalation
  // state on every successful (re)registration INCLUDING same-key reregister
  // cycles — liveEditRestartAttemptRef must NOT reset on those, or the
  // MAX_LIVE_EDIT_RESTART_ATTEMPTS budget it guards would never trip (see
  // that effect's own comment).
  useEffect(() => {
    previewTokenRefreshAttemptRef.current = null;
    liveEditRestartAttemptRef.current = 0;
    liveEditSameInstanceElapsedMsRef.current = 0;
    liveEditSameInstanceDelayRef.current = LIVE_EDIT_READY_TIMEOUT_MS;
    if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
      window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
      liveEditSameInstanceRearmTimerRef.current = undefined;
    }
    setLiveEditSameInstanceStalledError(null);
    lateLiveEditReadyRecoveryRef.current = null;
  }, [liveEditBridgeKey]);

  // Chrome only offers its Local Network Access permission dialog for a
  // fetch made within an active user-gesture window, so this calls the
  // SAME attemptBridgeRegistration used by the automatic retry effect
  // directly and synchronously — not through a nonce bump, which would
  // defer the actual fetch() past the click's gesture window and lose the
  // ability to trigger Chrome's permission prompt. Also resets the backoff
  // and same-instance escalation state, mirroring the offline-state "Retry"
  // buttons elsewhere in this file, so the user-initiated attempt starts
  // every counter fresh and any already-scheduled auto-retry doesn't fire a
  // second, redundant attempt shortly after this one.
  const handleConnectLocalNetworkAccess = useCallback(async () => {
    setConnectingLocalNetworkAccess(true);
    bridgeRegistrationRetryAttemptRef.current = 0;
    liveEditRestartAttemptRef.current = 0;
    liveEditSameInstanceElapsedMsRef.current = 0;
    liveEditSameInstanceDelayRef.current = LIVE_EDIT_READY_TIMEOUT_MS;
    if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
      window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
      liveEditSameInstanceRearmTimerRef.current = undefined;
    }
    setLiveEditSameInstanceStalledError(null);
    if (bridgeRegistrationRetryTimerRef.current !== undefined) {
      window.clearTimeout(bridgeRegistrationRetryTimerRef.current);
      bridgeRegistrationRetryTimerRef.current = undefined;
    }
    if (
      bridgeRegistrationFailureKind === "stalePreviewToken" &&
      designId &&
      connectionId
    ) {
      try {
        const refreshed = await callAction<{
          previewToken?: string;
          liveEditCapability?: string;
          liveEditRegistrationCapability?: string;
        }>(
          "refresh-localhost-preview-token",
          {
            designId,
            connectionId,
            publicVisualEdit,
          },
          { method: "GET" },
        );
        const nextPreviewToken = refreshed?.previewToken;
        const nextLiveEditCapability = refreshed?.liveEditCapability;
        const nextRegistrationCapability =
          refreshed?.liveEditRegistrationCapability;
        if (!nextPreviewToken) {
          throw new Error(
            "The refreshed preview token is empty. Run design connect again, then retry.",
          );
        }
        if (!nextRegistrationCapability && !nextLiveEditCapability) {
          throw new Error(
            "The refreshed design-scoped registration capability is missing. Reconnect this localhost source and retry.",
          );
        }
        previewTokenRefreshAttemptRef.current = `${liveEditBridgeKey}:${effectivePreviewToken}`;
        if (nextPreviewToken !== effectivePreviewToken) {
          setEffectivePreviewToken(nextPreviewToken);
          onPreviewTokenChange?.(screenId, nextPreviewToken);
        }
        if (nextLiveEditCapability) {
          setEffectiveLiveEditCapability(nextLiveEditCapability);
          onLiveEditCapabilityChange?.(screenId, nextLiveEditCapability);
        }
        if (nextRegistrationCapability) {
          setEffectiveLiveEditRegistrationCapability(
            nextRegistrationCapability,
          );
          onLiveEditRegistrationCapabilityChange?.(
            screenId,
            nextRegistrationCapability,
          );
        }
        if (registrationHandoffKey) {
          liveEditRegistrationHandoff.delete(registrationHandoffKey);
        }
        setRegisteredLiveEditBridgeKey(null);
        setBridgeRegistrationError(null);
        setBridgeRegistrationFailureKind(null);
        setBridgeRegistrationRetryNonce((nonce) => nonce + 1);
        setConnectingLocalNetworkAccess(false);
        return;
      } catch (error) {
        setConnectingLocalNetworkAccess(false);
        setBridgeRegistrationError({
          bridgeKey: liveEditBridgeKey,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    // A failed manual attempt (still-refused permission, dev server still
    // down) must not silently stop automatic recovery — schedule the same
    // backoff retry the automatic path uses. null means a newer attempt
    // (effect-driven or another click) already superseded this one, which
    // already has its own outcome to handle; only a definite false schedules
    // here.
    void attemptBridgeRegistration().then((result) => {
      if (result === false) scheduleBridgeRegistrationRetry();
    });
  }, [
    attemptBridgeRegistration,
    bridgeRegistrationFailureKind,
    connectionId,
    designId,
    effectivePreviewToken,
    effectiveLiveEditCapability,
    effectiveLiveEditRegistrationCapability,
    liveEditBridgeKey,
    onPreviewTokenChange,
    onLiveEditCapabilityChange,
    onLiveEditRegistrationCapabilityChange,
    publicVisualEdit,
    screenId,
    scheduleBridgeRegistrationRetry,
  ]);
  const handleDismissLocalNetworkAccessPrompt = useCallback(() => {
    setLocalNetworkAccessDismissedForKey(liveEditBridgeKey);
  }, [liveEditBridgeKey]);

  // The registered iframe's `src` is a real cross-origin navigation straight
  // to the bridge's authenticated /live-edit URL, so this component can never
  // read that response's status or body (a 409 "unknown-bridge-key" looks
  // identical to any other document from here). What IS observable is
  // whether the editor-chrome bridge's "agent-native:editor-chrome-ready"
  // handshake (see the message handler below) arrives within a reasonable
  // window after we mounted the real document. A healthy load posts ready
  // almost immediately; a 409 never injects the bridge script at all, so
  // ready never arrives. Treat a stuck non-ready state as a suspected restart
  // and settle it with a /health probe instead of guessing from the error UI.
  const handleSuspectedBridgeRestart = useCallback(async () => {
    if (!bridgeUrl || !effectivePreviewToken) return;
    if (liveEditRestartInFlightRef.current) return;
    liveEditRestartInFlightRef.current = true;
    // Captured once per call, not re-read at each checkpoint below: a probe
    // started against an old screen/key can resolve after a NEW screen has
    // already registered successfully (bumping this same counter via
    // attemptBridgeRegistration or the unmount-cleanup effect above) — this
    // guards every mutating branch below against silently tearing down or
    // re-registering that newer, unrelated registration.
    // Deliberately not gated on a one-way "isUnmounted" flag: that shape
    // never resets, so it would stay stuck true after StrictMode's dev-only
    // mount→cleanup→mount replay and silently stop every later health probe
    // from ever resolving (see attemptBridgeRegistration's identical fix
    // above). The dedicated unmount-cleanup effect there bumps this same
    // counter on a real
    // unmount, which isHealthProbeCurrent() already covers correctly.
    const healthProbeGeneration =
      bridgeRegistrationAttemptGenerationRef.current;
    const isHealthProbeCurrent = () =>
      bridgeRegistrationAttemptGenerationRef.current === healthProbeGeneration;
    try {
      const response = await fetch(healthEndpointUrl(bridgeUrl));
      const payload = (await response.json().catch(() => null)) as {
        bridgeInstanceId?: string;
      } | null;
      if (!isHealthProbeCurrent()) return;
      const responseBridgeInstanceId =
        payload && typeof payload.bridgeInstanceId === "string"
          ? payload.bridgeInstanceId
          : null;
      const decision = classifyLiveEditHealthProbe(
        bridgeInstanceIdRef.current,
        responseBridgeInstanceId,
      );
      if (decision === "reregister") {
        if (
          liveEditRestartAttemptRef.current >= MAX_LIVE_EDIT_RESTART_ATTEMPTS
        ) {
          if (registrationHandoffKey) {
            liveEditRegistrationHandoff.delete(registrationHandoffKey);
          }
          const lateReadySource = iframeRef.current?.contentWindow;
          lateLiveEditReadyRecoveryRef.current = lateReadySource
            ? {
                source: lateReadySource,
                bridgeKey: liveEditBridgeKey,
                registrationHandoffKey,
              }
            : null;
          setRegisteredLiveEditBridgeKey(null);
          setBridgeConnectionLostError({
            bridgeKey: liveEditBridgeKey,
            message: t("designCanvas.localBridge.confirmationRetryExhausted"),
          });
          return;
        }
        liveEditRestartAttemptRef.current += 1;
        if (registrationHandoffKey) {
          liveEditRegistrationHandoff.delete(registrationHandoffKey);
        }
        // The bridge process restarted since our last registration — silently
        // re-POST the same script/key and reload the frame. Resetting
        // registeredLiveEditBridgeKey (without setting an error) re-arms the
        // "Preparing live editor..." placeholder — the same neutral state
        // already shown on first connect — and bumping the retry nonce
        // re-triggers the registration effect above.
        bridgeInstanceIdRef.current = responseBridgeInstanceId;
        setRegisteredLiveEditBridgeKey(null);
        setBridgeConnectionLostError(null);
        setLiveEditSameInstanceStalledError(null);
        // A genuine restart makes any same-instance-id wait we'd accumulated
        // against the OLD process meaningless — reset the escalation clock so
        // the fresh document this reregister produces gets the full ceiling,
        // not whatever was left over from the previous one.
        liveEditSameInstanceElapsedMsRef.current = 0;
        liveEditSameInstanceDelayRef.current = LIVE_EDIT_READY_TIMEOUT_MS;
        if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
          window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
          liveEditSameInstanceRearmTimerRef.current = undefined;
        }
        setBridgeRegistrationRetryNonce((nonce) => nonce + 1);
        return;
      }
      if (decision === "escalate") {
        // Same bridge process, still healthy and reachable — the page is
        // just slow (e.g. a cold dev-server compile), not actually failing.
        // Do NOT touch registeredLiveEditBridgeKey or bridgeRegistrationError
        // here: that would tear down the still-legitimately-loading iframe
        // (the regression this fix addresses). Re-arm with a longer wait
        // instead, up to a generous total ceiling, before finally surfacing a
        // separate NON-destructive error card that leaves the iframe alone.
        liveEditSameInstanceElapsedMsRef.current +=
          liveEditSameInstanceDelayRef.current;
        if (
          liveEditSameInstanceElapsedMsRef.current >=
          LIVE_EDIT_SAME_INSTANCE_ERROR_CEILING_MS
        ) {
          setLiveEditSameInstanceStalledError({
            bridgeKey: liveEditBridgeKey,
            message: t("designCanvas.localBridge.connectionNotConfirmed"),
          });
          return;
        }
        const nextDelay = Math.min(
          liveEditSameInstanceDelayRef.current * 2,
          LIVE_EDIT_SAME_INSTANCE_MAX_REARM_DELAY_MS,
        );
        liveEditSameInstanceDelayRef.current = nextDelay;
        if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
          window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
        }
        liveEditSameInstanceRearmTimerRef.current = window.setTimeout(() => {
          liveEditSameInstanceRearmTimerRef.current = undefined;
          if (bridgeReadyRef.current || !isHealthProbeCurrent()) return;
          void handleSuspectedBridgeRestart();
        }, nextDelay);
        return;
      }
      // decision === "error": no bridgeInstanceId on one or both sides, so we
      // can't confirm the same-process-still-healthy story above. Treat this
      // as a genuine, unresolved failure and surface the existing
      // (destructive) error/Retry UI instead of looping forever.
      if (registrationHandoffKey) {
        liveEditRegistrationHandoff.delete(registrationHandoffKey);
      }
      const lateReadySource = iframeRef.current?.contentWindow;
      lateLiveEditReadyRecoveryRef.current = lateReadySource
        ? {
            source: lateReadySource,
            bridgeKey: liveEditBridgeKey,
            registrationHandoffKey,
          }
        : null;
      setRegisteredLiveEditBridgeKey(null);
      setBridgeConnectionLostError({
        bridgeKey: liveEditBridgeKey,
        message: t("designCanvas.localBridge.connectionNotConfirmed"),
      });
    } catch (error) {
      if (!isHealthProbeCurrent()) return;
      // /health itself is unreachable (network error / thrown before a
      // response) — the dev server process is actually down, not just slow.
      // This destructive path (tear down + surface the error) is justified.
      if (registrationHandoffKey) {
        liveEditRegistrationHandoff.delete(registrationHandoffKey);
      }
      const lateReadySource = iframeRef.current?.contentWindow;
      lateLiveEditReadyRecoveryRef.current = lateReadySource
        ? {
            source: lateReadySource,
            bridgeKey: liveEditBridgeKey,
            registrationHandoffKey,
          }
        : null;
      setRegisteredLiveEditBridgeKey(null);
      setBridgeConnectionLostError({
        bridgeKey: liveEditBridgeKey,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      liveEditRestartInFlightRef.current = false;
    }
  }, [
    bridgeUrl,
    effectivePreviewToken,
    liveEditBridgeKey,
    registrationHandoffKey,
    t,
  ]);

  // Manual retry for the NON-destructive same-instance-id stalled card only
  // (see liveEditSameInstanceStalledError below): unlike
  // handleConnectLocalNetworkAccess, registeredLiveEditBridgeKey was never
  // nulled here, so calling attemptBridgeRegistration again would not
  // reschedule a fresh watchdog probe (liveEditBridgeRegistered never flips
  // false→true to rearm that effect). Reset the backoff and probe /health
  // again directly instead.
  const handleManualLiveEditSameInstanceRetry = useCallback(() => {
    liveEditSameInstanceElapsedMsRef.current = 0;
    liveEditSameInstanceDelayRef.current = LIVE_EDIT_READY_TIMEOUT_MS;
    if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
      window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
      liveEditSameInstanceRearmTimerRef.current = undefined;
    }
    setLiveEditSameInstanceStalledError(null);
    void handleSuspectedBridgeRestart();
  }, [handleSuspectedBridgeRestart]);

  // Arm the ready-handshake watchdog whenever the real authenticated live-edit
  // document is (re)mounted in editor-chrome mode (the only mode that ever
  // posts agent-native:editor-chrome-ready — see usesLiveEditEditorBridge).
  // liveEditBridgeRegistered flips false→true on every fresh mount (including
  // the reregister cycle above), so this effect reliably rearms each time.
  //
  // NOTE: deliberately does NOT reset the same-instance-id escalation refs
  // (liveEditSameInstance*) here even though this effect conceptually marks a
  // fresh mount: handleSuspectedBridgeRestart depends on `t`, whose identity
  // is not guaranteed stable across renders (see useT), so this effect's own
  // dependency array can cause it to re-run on unrelated re-renders — not
  // only on a genuine fresh mount. Resetting escalation state here would
  // then race with (and can clobber) the very state update that triggered
  // that extra re-render, e.g. immediately wiping the non-destructive stalled
  // error the moment it's set. The escalation refs are instead reset from
  // known-good, less-churny signals: the liveEditBridgeKey-keyed effect below
  // (genuinely new script/screen) and the "reregister" branch inside
  // handleSuspectedBridgeRestart itself (genuine bridge-process restart).
  useEffect(() => {
    if (
      !usesLiveEditEditorBridge ||
      !liveEditBridgeRegistered ||
      !externalPreviewUrl
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || bridgeReadyRef.current) return;
      void handleSuspectedBridgeRestart();
    }, LIVE_EDIT_READY_TIMEOUT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    usesLiveEditEditorBridge,
    liveEditBridgeRegistered,
    externalPreviewUrl,
    handleSuspectedBridgeRestart,
  ]);

  useEffect(() => {
    const previewUrl = rawExternalPreviewUrl;
    if (
      !requiresExternalSourceSnapshot ||
      sourceType !== "localhost" ||
      !bridgeUrl ||
      !effectivePreviewToken ||
      !previewUrl
    ) {
      snapshotRetryAttemptRef.current = 0;
      setFetchedExternalSnapshot((current) =>
        current?.url === previewUrl ? current : null,
      );
      setExternalSnapshotState(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    let retryTimer: number | undefined;
    const endpoint = snapshotEndpointUrl(bridgeUrl, previewUrl);
    const scheduleRetry = () => {
      if (!requiresExternalSourceSnapshot || cancelled) return;
      const delay = getSnapshotRetryDelayMs(snapshotRetryAttemptRef.current);
      snapshotRetryAttemptRef.current += 1;
      retryTimer = window.setTimeout(() => {
        setExternalSnapshotRetryNonce((nonce) => nonce + 1);
      }, delay);
    };
    setExternalSnapshotState({ url: previewUrl, status: "loading" });
    void (async () => {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-design-preview-token": effectivePreviewToken,
          },
          signal: controller.signal,
        });
        if (isPreviewTokenStaleStatus(response.status)) {
          if (cancelled) return;
          setExternalSnapshotState({
            url: previewUrl,
            status: "error",
            message:
              "The local bridge rejected this screen's preview token (401). Reconnect this screen before retrying.",
          });
          return;
        }
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          url?: string;
          html?: string;
          status?: number;
          contentType?: string;
          error?: string;
        } | null;
        if (cancelled) return;
        if (isPreviewTokenStaleStatus(payload?.status ?? 0)) {
          setExternalSnapshotState({
            url: previewUrl,
            status: "error",
            message:
              "The local bridge rejected this screen's preview token (401). Reconnect this screen before retrying.",
          });
          return;
        }
        if (!response.ok || !payload?.ok) {
          setExternalSnapshotState({
            url: previewUrl,
            status: "error",
            message:
              payload?.error ||
              `Bridge snapshot failed (${payload?.status ?? response.status})`,
          });
          scheduleRetry();
          return;
        }
        const sourceUrl = payload.url || previewUrl;
        const sourceHtml = sanitizeLocalhostSourceSnapshotHtml(
          payload.html ?? "",
        );
        const stamped = normalizeScreenHtml(sourceHtml, {
          source: {
            kind: "remote-url",
            sourceType: "localhost",
            url: sourceUrl,
            bridgeUrl,
          },
        }).content;
        if (cancelled) return;
        snapshotRetryAttemptRef.current = 0;
        setFetchedExternalSnapshot({ url: previewUrl, html: stamped });
        setExternalSnapshotState(null);
        onExternalContentSnapshotRef.current?.({
          url: previewUrl,
          html: stamped,
          status: payload.status,
          contentType: payload.contentType,
        });
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException)) {
          console.warn("[DesignCanvas] preview snapshot failed", error);
          setExternalSnapshotState({
            url: previewUrl,
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          scheduleRetry();
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [
    bridgeUrl,
    externalSnapshotRetryNonce,
    rawExternalPreviewUrl,
    requiresExternalSourceSnapshot,
    sourceType,
    effectivePreviewToken,
  ]);

  // Manual retry (offline-state "Retry" button): reset the backoff so the
  // user-initiated attempt fires immediately rather than waiting out
  // whatever delay the auto-retry loop had climbed to, then trigger the
  // fetch effect above via the nonce dependency.
  const handleManualSnapshotRetry = useCallback(() => {
    snapshotRetryAttemptRef.current = 0;
    setExternalSnapshotRetryNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    if (previousContentKeyRef.current !== contentKey) {
      previousContentKeyRef.current = contentKey;
      lastRuntimeReplacementKeyRef.current = runtimeReplacementKey;
      lastRuntimeReplacementContentRef.current = runtimeReplacementContent;
      // A content-key change rebuilds srcdoc, but a URL-backed preview keeps
      // its live document. Its bridge readiness and queued edits remain valid.
      if (!externalPreviewUrl) {
        // Reset synchronously rather than on `load`: load fires after the new
        // srcdoc bridge has already posted its ready handshake.
        bridgeReadyRef.current = false;
        editorChromeReadyRef.current = false;
        bootReadyRef.current = false;
        pendingOneShotMessagesRef.current = [];
      }
      setRenderedDocument({
        content,
        sourceContent: authoredSourceContent ?? content,
      });
    }
    // Same-screen visual edits are already applied optimistically inside the
    // iframe before the source write is queued. Rebuilding srcdoc for that echo
    // reloads the iframe, flashes unstyled content, and drops selection. Only a
    // content-key change (screen switch / explicit remount) should replace the
    // iframe document here; the bridge replays inspector state after that load.
  }, [
    content,
    contentKey,
    externalPreviewUrl,
    runtimeReplacementContent,
    runtimeReplacementKey,
    authoredSourceContent,
  ]);

  useEffect(() => {
    if (!interactMode) return;
    // Interact renders the authoritative persisted source because the editor
    // bridge is intentionally absent. Keep that same source as the next
    // edit-mode baseline so leaving Interact cannot resurrect the older
    // bridge-managed snapshot and make the design visibly jump backward.
    setRenderedDocument({
      content,
      sourceContent: authoredSourceContent ?? content,
    });
  }, [content, interactMode, authoredSourceContent]);

  usePinchZoom({
    containerRef: scrollContainerRef,
    zoom,
    setZoom: onZoomChange ?? (() => {}),
    // Match the overview's Figma-parity zoom range (2%–25600%) rather than a
    // narrower single-screen-only clamp. Both the "none" (fills-canvas) and
    // framed (desktop/tablet/mobile DeviceFrame) render paths share this same
    // `zoom` prop/state and hook call today — there's no separate framed-mode
    // clamp to preserve. DeviceFrame chrome (title bars, home indicator) and
    // the iframe both scale proportionally via the outer `transform: scale()`
    // wrapper, so extreme zoom just renders very small/very large, it doesn't
    // break layout or clip content (fixed-px chrome scales with everything
    // else). Verified 1280px-wide desktop frame at 256x (25600%) renders at
    // ~327,680px, comfortably under browser max-element-size limits.
    min: DEFAULT_CANVAS_MIN_ZOOM,
    max: DEFAULT_CANVAS_MAX_ZOOM,
    zoomToCursor: deviceFrame === "none" && !centerInteractPreview,
    enabled: Boolean(onZoomChange) && !interactMode,
    onZoomFrame: onZoomChange ? applyZoomFrame : undefined,
    onZoomEnd: onZoomChange ? commitZoom : undefined,
  });

  // T-zoom-anchor: the "none"-mode zoom layer now uses `transform-origin: top
  // left` (see the render below) so Cmd/Ctrl+wheel and pinch zoom correctly
  // keep the point under the cursor stationary — usePinchZoom's own
  // zoomToCursor math and the pinch-zoom-wheel handler above both assume that
  // invariant. That means the layout is no longer flex-centered, so on first
  // mount (and whenever the content is re-keyed, e.g. a screen switch) we
  // imperatively center the scroll position once here — mirroring what the
  // flex-centering used to give us "for free" at rest — without touching
  // scroll position during an actual zoom gesture (those already apply their
  // own precise scroll deltas above).
  //
  // BP-DEEP item 2: also re-center when `previewWidthPx` changes (a
  // breakpoint chip is clicked). Without this, switching to a narrower
  // breakpoint shrinks the wrapper's rendered width in place — the scroll
  // container's existing scrollLeft (from whatever it was showing at the
  // WIDER content's width) is left untouched, so the narrower frame renders
  // pinned to the left edge of the visible area instead of centered. This is
  // the single-screen equivalent of the device-preview control's centered
  // `deviceFrame !== "none"` branch below, without giving up the top-left
  // transform-origin the zoom-anchor math above depends on.
  useEffect(() => {
    if (deviceFrame !== "none" || centerInteractPreview) return;
    const scroll = scrollContainerRef.current;
    const layer = zoomLayerRef.current;
    if (!scroll || !layer) return;
    // Read the SCROLL CONTAINER's own scrollWidth/scrollHeight, not the zoom
    // layer's: `transform: scale()` never changes an element's own layout
    // size (scrollWidth/scrollHeight of the transformed element itself stay
    // at its pre-transform size), but it DOES change how much scrollable
    // overflow it contributes to its ancestor — which is exactly the
    // post-transform visual bounds we need here.
    scroll.scrollLeft = Math.max(
      0,
      (scroll.scrollWidth - scroll.clientWidth) / 2,
    );
    scroll.scrollTop = Math.max(
      0,
      (scroll.scrollHeight - scroll.clientHeight) / 2,
    );
    // Only re-center on a genuine content swap (screen switch / remount) or a
    // breakpoint width change, not on every zoom change — an active zoom
    // gesture manages its own scroll delta and would otherwise be fought by
    // this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerInteractPreview, deviceFrame, contentKey, previewWidthPx]);

  // Build the srcdoc. Both mode bridges stay installed; live postMessages
  // switch pointer ownership without replacing the iframe document.
  //
  // readOnly and editMode are intentionally NOT deps here: the initial
  // __READ_ONLY__ / __TEXT_EDITING_ENABLED__ placeholders are baked from the
  // first render only (so first paint never flashes the wrong mode). After
  // that, live readOnly / editMode changes flow through set-read-only and
  // set-text-editing-enabled postMessages (see the useEffects below) so
  // switching the active surface (board ↔ screen) or toggling Edit ⇄ Preview
  // never rebuilds srcdoc / reloads every screen iframe.
  const srcdoc = useMemo(() => {
    // A URL-backed screen is never an inline document, including while its
    // keyed bridge registration is pending. The loading surface waits without
    // mounting an iframe, then mounts the real `src` exactly once.
    if (rawExternalPreviewUrl) return undefined;
    const localizedContent = withLocalRuntimes(iframeRenderContent);
    const editorChromeBridge =
      createEditorBridgeThemeScript(readEditorBridgeThemeVars()) +
      EDITOR_CHROME_BRIDGE_SCRIPT.replace(
        "__READ_ONLY__",
        readOnly ? "true" : "false",
      )
        .replace("__TEXT_EDITING_ENABLED__", editMode ? "true" : "false")
        .replace(
          "__EDITOR_CHROME_SCALE_X__",
          String(effectiveEditorChromeScaleX),
        )
        .replace(
          "__EDITOR_CHROME_SCALE_Y__",
          String(effectiveEditorChromeScaleY),
        )
        .replace(
          "__DESIGN_CANVAS_SCREEN_ID__",
          JSON.stringify(screenId ?? contentKey ?? ""),
        )
        .replace(
          "__DESIGN_CANVAS_BOARD_SURFACE__",
          boardSurface ? "true" : "false",
        )
        .replace(
          "__DESIGN_CANVAS_CONTENT_OFFSET_X__",
          String(Math.round(embeddedFrame?.contentOffsetX ?? 0)),
        )
        .replace(
          "__DESIGN_CANVAS_CONTENT_OFFSET_Y__",
          String(Math.round(embeddedFrame?.contentOffsetY ?? 0)),
        )
        .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
        .replace(
          "__LIVE_REFLOW_ENABLED__",
          LIVE_REFLOW_ENABLED ? "true" : "false",
        )
        .replace(
          "__SELECTED_LAYER_DRAG_PRIORITY__",
          SELECTED_LAYER_DRAG_PRIORITY_ENABLED ? "true" : "false",
        )
        .replace(/__INITIAL_SOURCE_HEAD__/g, () =>
          inlineScriptJson(sourceHeadInnerHtml(localizedContent)),
        );
    // ALWAYS injected (like the other always-on bridges above) so
    // MultiScreenCanvas's cross-screen drag hit-testing
    // (agent-native:hit-test / agent-native:hit-test-result) resolves an
    // anchor+placement against this screen's live DOM too, not only the
    // static-fallback board thumbnails that call appendHitTestResponder.
    // Without this, a drop onto a live/active screen has no responder and
    // always falls through to the 50ms request timeout.
    const imageDiagBridge = "";
    const bridgeToInject =
      sourceProvenanceBootstrap(iframeSourceProvenance) +
      MOTION_PREVIEW_BRIDGE_SCRIPT +
      SHADER_FILL_PREVIEW_BRIDGE_SCRIPT +
      TWEAK_BRIDGE_SCRIPT +
      ZOOM_BRIDGE_SCRIPT +
      NAV_BRIDGE_SCRIPT +
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT +
      embeddedGestureBridgeForSrcdoc +
      editorChromeBridge +
      imageDiagBridge;
    const frameContent = getEmbeddedFrameDocumentContent({
      content: localizedContent,
      embeddedFrameBackground,
      transparentBackground,
      contentOffsetX: embeddedFrame?.contentOffsetX ?? 0,
      contentOffsetY: embeddedFrame?.contentOffsetY ?? 0,
      fitBodyToFrame: fitRootBodyToFrame ?? !boardSurface,
    });
    let frameDocument: string;
    if (/<\/(?:body|html)\s*>/i.test(frameContent)) {
      frameDocument = injectDocumentMarkup(frameContent, bridgeToInject);
    } else {
      // No body/html tags — wrap it
      const frameStyle = [
        getEmbeddedFrameBackgroundStyle({
          embeddedFrameBackground,
          transparentBackground,
        }),
        embeddedContentOffsetStyle(
          embeddedFrame?.contentOffsetX ?? 0,
          embeddedFrame?.contentOffsetY ?? 0,
        ),
      ].join("");
      frameDocument = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${frameStyle}</head><body>${localizedContent}${bridgeToInject}</body></html>`;
    }
    // Overview frames report their own content height so the canvas can
    // content-fit them (Framer-style). Embedded (overview) frames only — a
    // focused single-screen view fills the viewport and must keep native
    // 100vh/min-h-screen, which the reporter's guard would otherwise pin.
    if (isEmbeddedFrame) {
      frameDocument = appendContentSizeReporter(frameDocument);
    }
    return injectSessionReplayIframeBootstrap(frameDocument);
    // editorChromeScaleX/Y are intentionally NOT deps: they only seed the initial
    // baked chrome scale. Live zoom updates flow through the set-editor-chrome-scale
    // postMessage above. Including them here rebuilds srcdoc on every zoom commit,
    // which reloads the iframe and flashes the screen content white.
    // readOnly and editMode are intentionally NOT deps: live changes flow
    // through set-read-only / set-text-editing-enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    boardSurface,
    fitRootBodyToFrame,
    rawExternalPreviewUrl,
    isEmbeddedFrame,
    embeddedFrameBackground,
    embeddedGestureBridgeForSrcdoc,
    iframeRenderContent,
    iframeSourceProvenance,
    transparentBackground,
  ]);

  // The document identity only has to change when the srcdoc text does. A
  // rebuild from unchanged inputs yields an equal string, and string equality
  // is a native compare, where hashing walked ~900KB per screen in JS.
  const srcdocVersionRef = useRef({ srcdoc, version: 0 });
  if (srcdocVersionRef.current.srcdoc !== srcdoc) {
    srcdocVersionRef.current = {
      srcdoc,
      version: srcdocVersionRef.current.version + 1,
    };
  }
  const srcdocHash = srcdocVersionRef.current.version;
  /**
   * A container we framed ourselves is cross-origin, so its messages match
   * neither `parentOrigin` nor the localhost bridge origin. Without its origin
   * here every selection, hover and layer message from the editor bridge is
   * dropped as untrusted while the bootstrap handshake still succeeds.
   */
  const canvasBridgeAllowedOrigins = useMemo(
    () =>
      [
        sourceType === "localhost" && bridgeUrl
          ? originFromUrl(bridgeUrl)
          : null,
        externalPreviewUrl ? originFromUrl(externalPreviewUrl) : null,
      ].filter((origin): origin is string => Boolean(origin)),
    [bridgeUrl, externalPreviewUrl, sourceType],
  );

  const iframeDocumentIdentity = externalPreviewUrl
    ? `src:${externalPreviewUrl}`
    : waitingForLiveEditBridge
      ? `live-edit-pending:${liveEditBridgeKey}`
      : `srcdoc:${contentKey ?? ""}:${srcdocHash}`;
  const iframeDocumentIdentityRef = useRef(iframeDocumentIdentity);
  iframeDocumentIdentityRef.current = iframeDocumentIdentity;
  const externalPreviewUrlRef = useRef(externalPreviewUrl);
  externalPreviewUrlRef.current = externalPreviewUrl;
  // Route navigation inside a live URL updates `externalPreviewUrl`, but it
  // must not replace the host iframe. Keeping the element stable lets the
  // running app navigate in place while the document identity below still
  // resets readiness and re-arms the edit shield for the new route.
  const iframeElementIdentity = externalPreviewUrl
    ? `external:${previewFrameId ?? screenId ?? contentKey ?? "screen"}:${
        usesLiveEditInjectedBridge ? liveEditBridgeKey : ""
      }`
    : iframeDocumentIdentity;
  if (previousIframeDocumentIdentityRef.current !== iframeDocumentIdentity) {
    previousIframeDocumentIdentityRef.current = iframeDocumentIdentity;
    if (readyIframeDocumentIdentity !== iframeDocumentIdentity) {
      bridgeReadyRef.current = false;
      editorChromeReadyRef.current = false;
      bootReadyRef.current = false;
    }
  }
  // Edit mode must never let a live URL receive native app input before the
  // injected editor bridge has proved that it owns the document. A cached
  // registration can outlive a bridge restart, and a 401/409 can otherwise
  // leave an ordinary app iframe interactive while the canvas looks editable.
  // Interact mode is the deliberate exception: it is the one mode where the
  // running app, rather than the editor, owns pointer and keyboard input.
  // A URL-backed localhost frame in Edit mode is never allowed to receive
  // native app input until the editor bridge is ready. This also covers the
  // short window before the public visual-edit token query resolves: the raw
  // URL is useful as a loading surface, but releasing it early makes a failed
  // registration look like a working editor and lets clicks mutate the app.
  const liveEditFrameRequiresBridge =
    sourceType === "localhost" &&
    Boolean(rawExternalPreviewUrl) &&
    !interactMode &&
    !readOnly;
  const liveEditInteractionBlocked =
    liveEditFrameRequiresBridge &&
    (!usesLiveEditInjectedBridge ||
      bridgeRegistrationFailedForCurrentKey ||
      !liveEditBridgeRegistered ||
      readyIframeDocumentIdentity !== iframeDocumentIdentity);
  const liveEditBridgeConfigurationPending =
    liveEditFrameRequiresBridge && !usesLiveEditInjectedBridge;
  // Only a URL-backed frame boots: srcdoc paints synchronously, so gating it on
  // an onLoad that already fired would strand a spinner over finished content.
  const [previewFrameLoaded, setPreviewFrameLoaded] = useState(false);
  const markPreviewFrameReady = useCallback(() => {
    setPreviewFrameLoaded(true);
    if (!onBootReady || bootReadyRef.current) return;
    bootReadyRef.current = true;
    onBootReady();
  }, [onBootReady]);
  useEffect(() => {
    if (!externalPreviewUrl) return;
    setPreviewFrameLoaded(
      readyIframeDocumentIdentity === iframeDocumentIdentity,
    );
  }, [externalPreviewUrl, iframeDocumentIdentity, readyIframeDocumentIdentity]);
  // No snapshot is ever painted over the live frame, not even for the few
  // frames of a document swap. Covering the real iframe with a frozen copy is
  // the same false-success shape as rendering the snapshot outright: when the
  // swap stalls, the canvas keeps showing a screen that looks correct and
  // responds to nothing. A brief flash is the honest signal.
  // A raw fallback document (see usingRawFallbackPreview above) never gets an
  // injected editor-chrome bridge, so it can never post the ready handshake
  // this waits for — without excluding it here, the fallback iframe would
  // stay marked "pending" (and thus blocked by the overlay below) forever.
  const liveEditDocumentPending =
    usesLiveEditEditorBridge &&
    Boolean(externalPreviewUrl) &&
    !usingRawFallbackPreview &&
    readyIframeDocumentIdentity !== iframeDocumentIdentity;
  // A failed registration may still leave the raw dev-server URL mounted as a
  // visual fallback. In Edit mode that fallback is not an editor: cover it
  // with the same blocking surface used during bridge boot, so a 401/409 or a
  // denied local-network permission can never hand clicks to the app.
  const liveEditRegistrationFailurePending =
    liveEditFrameRequiresBridge && bridgeRegistrationFailedForCurrentKey;
  // A proxied container paints its own app immediately, so without this the
  // canvas looks ready while hover, selection and layers are still dead.
  const sameOriginBridgePending =
    containerPreview &&
    includeLiveEditEditorChrome &&
    readyIframeDocumentIdentity !== iframeDocumentIdentity;

  // Listen for messages from the iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      const iframeWindow = iframeRef.current?.contentWindow;
      const runtimeVerificationWindow =
        runtimeVerificationIframeRef.current?.contentWindow;
      const trustedRuntimeVerificationFrame =
        runtimeVerificationRequest !== null &&
        runtimeVerificationRequest !== undefined &&
        runtimeVerificationWindow !== null &&
        isTrustedCanvasBridgeMessage({
          source: e.source,
          origin: e.origin,
          iframeWindow: runtimeVerificationWindow,
          parentOrigin: window.location.origin,
          allowedOrigins: canvasBridgeAllowedOrigins,
        });
      if (trustedRuntimeVerificationFrame) {
        if (e.data?.type === "agent-native:runtime-layer-snapshot-error") {
          onRuntimeStructureInsertRejected?.(
            e.data.payload?.reason === "snapshot-too-large"
              ? "verification-snapshot-too-large"
              : "verification-snapshot-unavailable",
          );
          return;
        }
        if (e.data?.type !== "agent-native:runtime-layer-snapshot") return;
        const payload = e.data.payload;
        const snapshot = parseRuntimeSnapshotHtml(payload?.html);
        if (!snapshot.ok || !Number.isFinite(payload?.nodeCount)) {
          onRuntimeStructureInsertRejected?.(
            snapshot.ok
              ? "verification-snapshot-unavailable"
              : `verification-${snapshot.reason}`,
          );
          return;
        }
        onRuntimeVerificationSnapshot?.({
          requestId: runtimeVerificationRequest.requestId,
          html: snapshot.html,
          nodeCount: Math.max(0, Math.floor(payload.nodeCount)),
          documentId:
            typeof payload.documentId === "string"
              ? payload.documentId
              : undefined,
        });
        return;
      }
      const lateReadyRecovery =
        e.data?.type === "agent-native:editor-chrome-ready"
          ? lateLiveEditReadyRecoveryRef.current
          : null;
      // A cross-origin fusion frame can never satisfy `origin === parentOrigin`,
      // so trust there rests on window identity plus a Builder-host allowlist.
      // A proxied one is same-origin and takes the strict path unchanged.
      const trustedCurrentFrame =
        sourceType === "fusion" && e.origin !== window.location.origin
          ? iframeWindow !== null &&
            e.source === iframeWindow &&
            isAllowedFusionOrigin(e.origin, fusionUrl)
          : isTrustedCanvasBridgeMessage({
              source: e.source,
              origin: e.origin,
              iframeWindow,
              parentOrigin: window.location.origin,
              allowedOrigins: canvasBridgeAllowedOrigins,
            });
      const trustedLateLiveEditReady =
        sourceType === "localhost" &&
        lateReadyRecovery !== null &&
        lateReadyRecovery.bridgeKey === liveEditBridgeKey &&
        isTrustedCanvasBridgeMessage({
          source: e.source,
          origin: e.origin,
          iframeWindow: lateReadyRecovery.source,
          parentOrigin: window.location.origin,
          allowedOrigins: canvasBridgeAllowedOrigins,
        });
      const trusted = trustedCurrentFrame || trustedLateLiveEditReady;
      if (!trusted) {
        return;
      }
      let readyDocumentIdentity = iframeDocumentIdentityRef.current;
      if (
        trustedCurrentFrame &&
        sourceType === "localhost" &&
        e.data?.type === "agent-native:editor-chrome-ready" &&
        externalPreviewUrlRef.current
      ) {
        const documentId =
          typeof e.data.documentId === "string" && e.data.documentId
            ? e.data.documentId
            : null;
        const knownDocumentId =
          documentId !== null && liveEditDocumentIdsRef.current.has(documentId);
        if (
          documentId !== null &&
          knownDocumentId &&
          documentId !== liveEditDocumentIdRef.current
        ) {
          return;
        }
        if (documentId === null || knownDocumentId) {
          if (
            isCurrentLiveEditReadyMessage(
              externalPreviewUrlRef.current,
              e.data.routePath,
              liveRoutePathRef.current,
            ) !== "current"
          ) {
            return;
          }
        } else {
          if (typeof e.data.routePath === "string" && e.data.routePath) {
            const routeIdentity = liveEditDocumentIdentityForRoute(
              externalPreviewUrlRef.current,
              e.data.routePath,
            );
            if (routeIdentity.status === "invalid") return;
            readyDocumentIdentity = routeIdentity.identity;
          }
          if (liveEditDocumentIdRef.current !== null) {
            bridgeReadyRef.current = false;
            editorChromeReadyRef.current = false;
            bootReadyRef.current = false;
            pendingOneShotMessagesRef.current = [];
          }
          liveEditDocumentIdsRef.current.add(documentId);
          liveEditDocumentIdRef.current = documentId;
        }
      }
      // A srcdoc editor has booted once its chrome bridge, the last script in
      // the body, reports ready; `load` would also wait for every image. Not
      // any message: the session-replay bootstrap posts a probe from <head>.
      if (
        trustedCurrentFrame &&
        e.data?.type === "agent-native:editor-chrome-ready" &&
        !externalPreviewUrl &&
        onBootReady &&
        !bootReadyRef.current
      ) {
        bootReadyRef.current = true;
        onBootReady();
      }
      if (
        trustedCurrentFrame &&
        e.data?.type === "agent-native:editor-chrome-ready" &&
        sourceType === "localhost" &&
        externalPreviewUrl
      ) {
        markPreviewFrameReady();
      }
      if (!e.data || !e.data.type) return;
      if (
        e.data.type === "agent-native:runtime-layer-snapshot-error" ||
        e.data.type === "agent-native:runtime-layer-snapshot-unchanged"
      ) {
        const requestId = e.data.payload?.requestId;
        const documentId = e.data.payload?.documentId;
        if (
          Number.isSafeInteger(requestId) &&
          typeof documentId === "string" &&
          typeof e.data.payload?.reservationToken === "string"
        ) {
          const reservationKey = `${documentId}:${requestId as number}`;
          const pending =
            pendingRuntimeLayerSnapshotReservationsRef.current.get(
              reservationKey,
            );
          if (pending) {
            window.clearTimeout(pending.timeout);
            pendingRuntimeLayerSnapshotReservationsRef.current.delete(
              reservationKey,
            );
          }
        }
        return;
      }
      if (
        e.data.type ===
        "agent-native:runtime-layer-snapshot-reservation-request"
      ) {
        if (!Number.isSafeInteger(e.data.requestId)) return;
        const requestId = e.data.requestId as number;
        const documentId =
          typeof e.data.documentId === "string" ? e.data.documentId : "";
        if (!documentId) {
          postOneShotBridgeMessage({
            type: "grant-runtime-layer-snapshot-reservation",
            requestId,
          });
          return;
        }
        const reservationKey = `${documentId}:${requestId}`;
        const grantSnapshot = (reservationToken?: string) =>
          postOneShotBridgeMessage({
            type: "grant-runtime-layer-snapshot-reservation",
            requestId,
            documentId,
            ...(reservationToken ? { reservationToken } : {}),
          });
        if (
          sourceType === "localhost" &&
          !snapshotOnly &&
          onReserveVisualEditSnapshot &&
          !pendingRuntimeLayerSnapshotReservationsRef.current.has(
            reservationKey,
          )
        ) {
          const promise = Promise.resolve()
            .then(() => onReserveVisualEditSnapshot(screenId))
            .then(
              ({ reservationToken }) => ({ reservationToken }),
              (error: unknown) => ({ error }),
            );
          const timeout = window.setTimeout(() => {
            const current =
              pendingRuntimeLayerSnapshotReservationsRef.current.get(
                reservationKey,
              );
            if (current?.promise === promise) {
              pendingRuntimeLayerSnapshotReservationsRef.current.delete(
                reservationKey,
              );
            }
          }, 15_000);
          pendingRuntimeLayerSnapshotReservationsRef.current.set(
            reservationKey,
            { promise, timeout },
          );
          void promise.then((result) => {
            const pending =
              pendingRuntimeLayerSnapshotReservationsRef.current.get(
                reservationKey,
              );
            if (pending?.promise !== promise) return;
            window.clearTimeout(pending.timeout);
            pendingRuntimeLayerSnapshotReservationsRef.current.delete(
              reservationKey,
            );
            if (!("reservationToken" in result)) {
              console.warn(
                "[design:visual-edit] shared snapshot reservation failed",
                { screenId, error: result.error },
              );
              return;
            }
            grantSnapshot(result.reservationToken);
          });
        }
        // Local Layers must not wait for the owner-only shared snapshot reservation.
        // The iframe captures again with its reservation token before publishing.
        grantSnapshot();
        return;
      }
      if (e.data.type === "agent-native:live-route-path") {
        if (typeof e.data.routePath === "string" && e.data.routePath) {
          liveRoutePathRef.current = e.data.routePath;
          onRoutePathChange?.(screenId, e.data.routePath);
          requestSharedSnapshotAfterEdit();
        }
        return;
      }
      if (e.data.type === "agent-native:screen-root-computed-styles") {
        const rawStyles = e.data.computedStyles;
        if (!isComputedStyleMap(rawStyles)) return;
        if (Object.keys(rawStyles).length > 0) {
          onScreenRootComputedStyles?.(
            Object.fromEntries(
              Object.entries(rawStyles).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ),
          );
        }
        return;
      }
      if (e.data.type === "agent-native:runtime-reloading") {
        const targetTransactionId = runtimeStructureTargetTransactionId;
        if (
          targetTransactionId &&
          lastRuntimeStructureTargetReloadTransactionIdRef.current !==
            targetTransactionId
        ) {
          lastRuntimeStructureTargetReloadTransactionIdRef.current =
            targetTransactionId;
          onRuntimeStructureInsertRejected?.(
            "target-document-replaced",
            targetTransactionId,
          );
        }
        // A local dev server full reload is unavoidable after some source
        // writes. Keep the last authenticated snapshot painted instead of
        // exposing the iframe's blank navigation frame; the replacement
        // document's ready handshake clears this fallback again.
        if (usesLiveEditEditorBridge) {
          bootReadyRef.current = false;
          bridgeReadyRef.current = false;
          editorChromeReadyRef.current = false;
          liveRoutePathRef.current = null;
          onBootStart?.();
          setReadyIframeDocumentIdentity(null);
          const pendingDelete =
            runtimeStructureDeleteRequest ??
            pendingRuntimeDeletePreviewRef.current;
          if (pendingDelete) {
            const queueOnce = (message: Record<string, unknown>) => {
              const alreadyQueued = pendingOneShotMessagesRef.current.some(
                (queued) =>
                  (
                    queued as {
                      type?: unknown;
                      requestId?: unknown;
                      documentId?: unknown;
                    } | null
                  )?.type === message.type &&
                  (
                    queued as {
                      requestId?: unknown;
                      documentId?: unknown;
                    } | null
                  )?.requestId === message.requestId &&
                  (queued as { documentId?: unknown } | null)?.documentId ===
                    message.documentId,
              );
              if (!alreadyQueued) {
                pendingOneShotMessagesRef.current.push(message);
              }
            };
            queueOnce({
              type: "pending-delete-element",
              selector: pendingDelete.selector,
              selectorCandidates: pendingDelete.selectorCandidates ?? [],
              requestId: pendingDelete.requestId,
              transactionId: pendingDelete.transactionId,
            });
            if (
              runtimeStructureDeleteRequest &&
              !runtimeStructureDeleteRequest.waitForInsertTransaction
            ) {
              queueOnce({
                type: "delete-element",
                selector: pendingDelete.selector,
                selectorCandidates: pendingDelete.selectorCandidates ?? [],
                requestId: pendingDelete.requestId,
                transactionId: pendingDelete.transactionId,
              });
              lastRuntimeStructureDeleteRequestIdRef.current =
                pendingDelete.requestId;
            }
            pendingRuntimeDeletePreviewRef.current = {
              requestId: pendingDelete.requestId,
              selector: pendingDelete.selector,
              selectorCandidates: pendingDelete.selectorCandidates ?? [],
              transactionId: pendingDelete.transactionId,
              documentIdentity: null,
              awaitingTransaction:
                runtimeStructureDeleteRequest === null ||
                runtimeStructureDeleteRequest === undefined
                  ? pendingRuntimeDeletePreviewRef.current
                      ?.awaitingTransaction === true
                  : false,
            };
          }
        }
        return;
      }
      // Any other trusted message from the CURRENT frame proves the chrome
      // bridge is live in the document that is in the iframe right now.
      // Readiness must follow the document, not the one-time handshake: a
      // live-edit screen keeps its already-loaded iframe across a canvas
      // remount, so a later instance never sees `editor-chrome-ready` and
      // `bridgeReadyRef` stays false forever. Every one-shot command then
      // lands in `pendingOneShotMessagesRef` and nothing ever flushes it —
      // the drop, the text edit, the delete all report success and do
      // nothing. Re-derive readiness here so the queue always drains.
      if (trustedCurrentFrame && !bridgeReadyRef.current) {
        bridgeReadyRef.current = true;
        onBridgeReady?.();
        setReadyIframeDocumentIdentity(readyDocumentIdentity);
        flushPendingOneShotMessages();
      }
      if (typeof e.data.routePath === "string" && e.data.routePath) {
        liveRoutePathRef.current = e.data.routePath;
        onRoutePathChange?.(screenId, e.data.routePath);
      }
      if (e.data.type === "agent-native:runtime-layer-snapshot") {
        const payload = e.data.payload;
        if (
          payload &&
          typeof payload.html === "string" &&
          payload.html.length <= 2_000_000 &&
          Number.isFinite(payload.nodeCount)
        ) {
          const snapshot = {
            html: payload.html,
            nodeCount: Math.max(0, Math.floor(payload.nodeCount)),
            documentId:
              typeof payload.documentId === "string"
                ? payload.documentId
                : undefined,
          };
          const reservationToken =
            typeof payload.reservationToken === "string"
              ? payload.reservationToken
              : undefined;
          const requestId = Number.isSafeInteger(payload.requestId)
            ? (payload.requestId as number)
            : undefined;
          onRuntimeLayerSnapshot?.({ ...snapshot, reservationToken });
          if (
            reservationToken &&
            requestId !== undefined &&
            snapshot.documentId
          ) {
            const reservationKey = `${snapshot.documentId}:${requestId}`;
            const pending =
              pendingRuntimeLayerSnapshotReservationsRef.current.get(
                reservationKey,
              );
            if (pending) {
              window.clearTimeout(pending.timeout);
              pendingRuntimeLayerSnapshotReservationsRef.current.delete(
                reservationKey,
              );
            }
          }
        }
        return;
      }
      if (e.data.type === "agent-native:editor-chrome-ready") {
        if (trustedLateLiveEditReady && lateReadyRecovery) {
          // This handshake belongs to the one retired live document saved by
          // the destructive watchdog path, not the pending iframe now in the
          // DOM. Restore its exact registration generation and let the newly
          // mounted live document send the normal ready signal; do not mark
          // the pending document ready or flush one-shot messages into it.
          lateLiveEditReadyRecoveryRef.current = null;
          if (lateReadyRecovery.registrationHandoffKey) {
            liveEditRegistrationHandoff.set(
              lateReadyRecovery.registrationHandoffKey,
              Date.now(),
            );
          }
          setBridgeConnectionLostError((current) =>
            current?.bridgeKey === lateReadyRecovery.bridgeKey ? null : current,
          );
          setRegisteredLiveEditBridgeKey(lateReadyRecovery.bridgeKey);
          return;
        }
        lateLiveEditReadyRecoveryRef.current = null;
        bridgeReadyRef.current = true;
        editorChromeReadyRef.current = true;
        onBridgeReady?.();
        setReadyIframeDocumentIdentity(readyDocumentIdentity);
        // A confirmed ready handshake proves this bridgeInstanceId/key pair
        // is genuinely live — clear the suspected-restart attempt counter so
        // a later transient hiccup gets the full retry budget again instead
        // of inheriting an already-elevated count from an unrelated earlier
        // load.
        liveEditRestartAttemptRef.current = 0;
        // A late ready handshake wins even after the same-instance-id
        // escalation loop gave up and showed its non-destructive error card:
        // cancel any pending re-arm timer, reset the backoff, and clear the
        // error so the now-loaded iframe (which was never torn down) reads
        // as fully connected.
        if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
          window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
          liveEditSameInstanceRearmTimerRef.current = undefined;
        }
        liveEditSameInstanceElapsedMsRef.current = 0;
        liveEditSameInstanceDelayRef.current = LIVE_EDIT_READY_TIMEOUT_MS;
        setLiveEditSameInstanceStalledError(null);
        flushPendingOneShotMessages();
        // Re-send every persistent editor mode after the queue is flushed.
        // This covers a ready handshake that wins the race with the initial
        // effects, including the bridge's baked-off wheel default.
        forceSelectionMirrorResyncRef.current = true;
        replayIframeEditorStateRef.current?.();
        return;
      }
      if (e.data.type === "clear-selection") {
        iframeClearedSelectorRef.current = selectedSelectorRef.current ?? null;
        onClearSelection?.();
        return;
      }
      if (e.data.type === "element-select") {
        const reported = e.data.payload as
          | { selector?: string; sourceId?: string; runtimeSourceId?: string }
          | undefined;
        const reportedCandidates: string[] = [];
        if (reported?.selector) reportedCandidates.push(reported.selector);
        if (reported?.sourceId) {
          reportedCandidates.push(
            `[data-agent-native-node-id="${reported.sourceId}"]`,
          );
        }
        const reportedRuntimeSourceId = reported?.runtimeSourceId?.trim();
        if (e.data.intent) {
          // User click (carries intent): iframe already shows it — suppress the
          // echo-back to avoid the fast-click bounce.
          suppressMirrorSelectorsRef.current =
            reportedCandidates.length > 0 ? reportedCandidates : null;
        } else if (
          !reportedRuntimeSourceId &&
          selectedSelectorRef.current &&
          reportedCandidates.length > 0 &&
          !reportedCandidates.includes(selectedSelectorRef.current) &&
          !(selectedSelectorCandidatesRef.current ?? []).some((c) =>
            reportedCandidates.includes(c),
          )
        ) {
          // Intent-less echo ≠ committed selection: iframe drifted; force a
          // resync (dedup would otherwise block the corrective mirror).
          forceSelectionMirrorResyncRef.current = true;
          replayIframeEditorStateRef.current?.();
        }
        onElementSelect(e.data.payload, e.data.intent);
        return;
      }
      if (
        e.data.type === "agent-native:layer-marquee-selection" ||
        e.data.type === "element-marquee-select"
      ) {
        onElementMarqueeSelect?.(
          Array.isArray(e.data.payload) ? e.data.payload : [],
          e.data.intent,
        );
        return;
      }
      if (e.data.type === "element-hover") {
        onElementHover(e.data.payload);
      }
      if (e.data.type === "agent-native:editor-drag-state") {
        onEditorDragStateChange?.({
          active: Boolean(e.data.active),
          screenId:
            typeof e.data.screenId === "string" ? e.data.screenId : undefined,
          dragId: typeof e.data.dragId === "string" ? e.data.dragId : undefined,
          eventAt:
            typeof e.data.eventAt === "number" ? e.data.eventAt : undefined,
          preview:
            e.data.preview && typeof e.data.preview === "object"
              ? {
                  phase:
                    e.data.preview.phase === "preview" ? "preview" : "clear",
                  sourceId:
                    typeof e.data.preview.sourceId === "string"
                      ? e.data.preview.sourceId
                      : undefined,
                  anchorId:
                    typeof e.data.preview.anchorId === "string"
                      ? e.data.preview.anchorId
                      : undefined,
                  placement:
                    e.data.preview.placement === "before" ||
                    e.data.preview.placement === "after" ||
                    e.data.preview.placement === "inside"
                      ? e.data.preview.placement
                      : undefined,
                  insert:
                    typeof e.data.preview.insert === "boolean"
                      ? e.data.preview.insert
                      : undefined,
                }
              : undefined,
        });
        return;
      }
      if (e.data.type === "visual-style-change") {
        const selector = String(e.data.selector || "");
        const styles =
          e.data.styles && typeof e.data.styles === "object"
            ? (e.data.styles as Record<string, string>)
            : {};
        const originalStyles =
          e.data.originalStyles && typeof e.data.originalStyles === "object"
            ? (e.data.originalStyles as Record<string, string>)
            : undefined;
        if (selector && Object.keys(styles).length > 0) {
          onVisualStyleChange?.(
            selector,
            styles,
            isElementInfoPayload(e.data.payload) ? e.data.payload : undefined,
            {
              phase: e.data.phase === "preview" ? "preview" : "commit",
              originalStyles,
              preserveSelection: e.data.preserveSelection === true,
              routePath:
                typeof e.data.routePath === "string"
                  ? e.data.routePath
                  : (liveRoutePathRef.current ?? undefined),
            },
          );
          if (e.data.phase !== "preview") {
            requestSharedSnapshotAfterEdit();
          }
        }
        return;
      }
      if (e.data.type === "visual-style-batch-change") {
        const changes = parseKScaleStyleChangeBatch(e.data.changes);
        if (!changes || !onVisualStyleBatchChange) {
          restoreKScalePreviewRef.current?.();
          return;
        }
        const accepted = onVisualStyleBatchChange(changes);
        if (accepted !== true) restoreKScalePreviewRef.current?.();
        else requestSharedSnapshotAfterEdit();
        return;
      }
      if (e.data.type === "gradient-edit-change") {
        const nodeId = String(e.data.nodeId || "");
        const cssValue = String(e.data.cssValue || "");
        const phase = e.data.phase === "commit" ? "commit" : "preview";
        if (nodeId && cssValue) {
          onGradientEditChange?.(nodeId, cssValue, phase);
        }
        return;
      }
      if (e.data.type === "text-content-change") {
        const selector = String(e.data.selector || "");
        const value = String(e.data.value ?? "");
        const html =
          typeof e.data.html === "string" ? String(e.data.html) : undefined;
        const originalValue =
          typeof e.data.originalValue === "string"
            ? String(e.data.originalValue)
            : undefined;
        const originalHtml =
          typeof e.data.originalHtml === "string"
            ? String(e.data.originalHtml)
            : undefined;
        const relativeOperations =
          e.data.relativeOperations &&
          typeof e.data.relativeOperations === "object"
            ? e.data.relativeOperations
            : undefined;
        if (selector) {
          onTextContentChange?.(selector, value, e.data.payload, {
            html,
            originalValue,
            originalHtml,
            relativeOperations,
            routePath:
              typeof e.data.routePath === "string"
                ? e.data.routePath
                : (liveRoutePathRef.current ?? undefined),
          });
          requestSharedSnapshotAfterEdit();
        }
        return;
      }
      if (e.data.type === "runtime-structure-insert-rejected") {
        onRuntimeStructureInsertRejected?.(
          String(e.data.reason || "unknown"),
          typeof e.data.transactionId === "string"
            ? e.data.transactionId
            : undefined,
        );
        return;
      }
      if (e.data.type === "runtime-structure-insert-applied") {
        const requestId = String(e.data.requestId || "");
        if (!requestId) return;
        onRuntimeStructureInsertApplied?.({
          requestId,
          transactionId:
            typeof e.data.transactionId === "string"
              ? e.data.transactionId
              : undefined,
          routePath:
            typeof e.data.routePath === "string"
              ? e.data.routePath
              : (liveRoutePathRef.current ?? undefined),
          selector: typeof e.data.selector === "string" ? e.data.selector : "",
          sourceId:
            typeof e.data.sourceId === "string" ? e.data.sourceId : undefined,
          applied: e.data.applied !== false,
        });
        // Keep the bridge's optimistic insert record alive. The host records
        // this as a pending live edit, and Apply or Undo owns the eventual
        // visual-structure-ack. Sending an applied:true ack here would discard
        // the bridge's rollback record before Cmd+Z can remove the inserted
        // node from the running DOM.
        return;
      }
      if (e.data.type === "runtime-element-deleted") {
        const requestId =
          typeof e.data.requestId === "string" ? e.data.requestId : "";
        if (!requestId) return;
        onRuntimeStructureDeleteApplied?.({
          screenId,
          requestId,
          selector: typeof e.data.selector === "string" ? e.data.selector : "",
          sourceId:
            typeof e.data.sourceId === "string" ? e.data.sourceId : undefined,
          routePath:
            typeof e.data.routePath === "string"
              ? e.data.routePath
              : (liveRoutePathRef.current ?? undefined),
          info: isElementInfoPayload(e.data.payload)
            ? e.data.payload
            : undefined,
        });
        return;
      }
      if (e.data.type === "runtime-element-delete-rejected") {
        const requestId = String(e.data.requestId || "");
        if (!requestId) return;
        onRuntimeStructureDeleteRejected?.({
          screenId,
          requestId,
          transactionId:
            typeof e.data.transactionId === "string"
              ? e.data.transactionId
              : undefined,
          routePath:
            typeof e.data.routePath === "string"
              ? e.data.routePath
              : (liveRoutePathRef.current ?? undefined),
          reason: String(e.data.reason || "unknown"),
        });
        return;
      }
      if (e.data.type === "runtime-structure-rollback-result") {
        const requestId = String(e.data.requestId || "");
        if (!requestId) return;
        onRuntimeStructureRollbackResult?.({
          requestId,
          transactionId:
            typeof e.data.transactionId === "string"
              ? e.data.transactionId
              : undefined,
          applied: e.data.applied === true,
          reason: typeof e.data.reason === "string" ? e.data.reason : undefined,
        });
        return;
      }
      if (e.data.type === "runtime-layer-name-applied") {
        const requestId = Number(e.data.requestId);
        const name = typeof e.data.name === "string" ? e.data.name : "";
        if (!Number.isFinite(requestId) || !name) return;
        onRuntimeLayerRenameApplied?.({
          requestId,
          selector: typeof e.data.selector === "string" ? e.data.selector : "",
          sourceId:
            typeof e.data.sourceId === "string" ? e.data.sourceId : undefined,
          routePath:
            typeof e.data.routePath === "string"
              ? e.data.routePath
              : (liveRoutePathRef.current ?? undefined),
          name,
          previousName:
            typeof e.data.previousName === "string"
              ? e.data.previousName
              : undefined,
        });
        return;
      }
      if (e.data.type === "visual-grid-group-change") {
        const rawMoves = e.data.moves;
        const validPlacement = (value: any) =>
          value &&
          ["column", "columnEnd", "row", "rowEnd"].every(
            (key) => Number.isInteger(value[key]) && value[key] > 0,
          ) &&
          value.columnEnd > value.column &&
          value.rowEnd > value.row;
        const valid =
          Array.isArray(rawMoves) &&
          rawMoves.length >= 2 &&
          rawMoves.length <= 100 &&
          rawMoves.every(
            (move: any) =>
              move?.type === "visual-structure-change" &&
              typeof move.requestId === "string" &&
              typeof move.selector === "string" &&
              typeof move.sourceId === "string" &&
              typeof move.anchorSelector === "string" &&
              typeof move.anchorSourceId === "string" &&
              (move.placement === "before" ||
                move.placement === "after" ||
                move.placement === "inside") &&
              move.dropMode === "flow-insert" &&
              validPlacement(move.gridPlacement) &&
              Array.isArray(move.gridDisplacements) &&
              move.gridDisplacements.every(
                (entry: any) =>
                  typeof entry.sourceId === "string" &&
                  typeof entry.selector === "string" &&
                  validPlacement(entry.placement),
              ),
          );
        const applied = valid
          ? onVisualGridGroupChange?.(rawMoves as GridGroupStructureMove[])
          : false;
        if (applied !== false) requestSharedSnapshotAfterEdit();
        if (applied !== "pending" && Array.isArray(rawMoves)) {
          for (const move of rawMoves) {
            if (typeof move?.requestId !== "string") continue;
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "visual-structure-ack",
                requestId: move.requestId,
                applied: applied === true,
              },
              "*",
            );
          }
        }
        return;
      }
      if (e.data.type === "visual-structure-change") {
        const selector = String(e.data.selector || "");
        const anchorSelector = String(e.data.anchorSelector || "");
        const placement = String(e.data.placement || "after");
        const replaced = e.data.replaced === true;
        const runtimeInsert = e.data.runtimeInsert === true;
        dndHostLog("recv:structure-change", {
          selector,
          anchorSelector,
          placement,
          dropMode: e.data.dropMode,
        });
        const requestId =
          typeof e.data.requestId === "string" ? e.data.requestId : undefined;
        const replacementSnapshot = replaced
          ? parseRuntimeSnapshotHtml(e.data.replacementSnapshotHtml)
          : undefined;
        if (replacementSnapshot?.ok === false) {
          if (requestId) {
            iframeRef.current?.contentWindow?.postMessage(
              { type: "visual-structure-ack", requestId, applied: false },
              "*",
            );
          }
          onRuntimeStructureInsertRejected?.(
            `replacement-${replacementSnapshot.reason}`,
          );
          return;
        }
        const sourceId =
          typeof e.data.sourceId === "string" ? e.data.sourceId : undefined;
        const anchorSourceId =
          typeof e.data.anchorSourceId === "string"
            ? e.data.anchorSourceId
            : undefined;
        const dropMode =
          e.data.dropMode === "flow-insert" ||
          e.data.dropMode === "absolute-container"
            ? e.data.dropMode
            : undefined;
        const sourceRect =
          e.data.sourceRect &&
          typeof e.data.sourceRect === "object" &&
          Number.isFinite(e.data.sourceRect.x) &&
          Number.isFinite(e.data.sourceRect.y) &&
          Number.isFinite(e.data.sourceRect.width) &&
          Number.isFinite(e.data.sourceRect.height)
            ? {
                x: Number(e.data.sourceRect.x),
                y: Number(e.data.sourceRect.y),
                width: Number(e.data.sourceRect.width),
                height: Number(e.data.sourceRect.height),
              }
            : undefined;
        const anchorRect =
          e.data.anchorRect &&
          typeof e.data.anchorRect === "object" &&
          Number.isFinite(e.data.anchorRect.x) &&
          Number.isFinite(e.data.anchorRect.y) &&
          Number.isFinite(e.data.anchorRect.width) &&
          Number.isFinite(e.data.anchorRect.height)
            ? {
                x: Number(e.data.anchorRect.x),
                y: Number(e.data.anchorRect.y),
                width: Number(e.data.anchorRect.width),
                height: Number(e.data.anchorRect.height),
              }
            : undefined;
        if (
          (selector || sourceId) &&
          (anchorSelector || anchorSourceId) &&
          (placement === "before" ||
            placement === "after" ||
            placement === "inside")
        ) {
          const applied = runtimeInsert
            ? "pending"
            : onVisualStructureChange?.(
                replaced ? anchorSelector : selector,
                replaced ? "" : anchorSelector,
                placement,
                replaced && isElementInfoPayload(e.data.anchorPayload)
                  ? e.data.anchorPayload
                  : e.data.payload,
                {
                  requestId,
                  transactionId:
                    typeof e.data.transactionId === "string"
                      ? e.data.transactionId
                      : undefined,
                  routePath:
                    typeof e.data.routePath === "string"
                      ? e.data.routePath
                      : (liveRoutePathRef.current ?? undefined),
                  sourceId: replaced ? anchorSourceId : sourceId,
                  anchorSourceId: replaced ? undefined : anchorSourceId,
                  dropMode,
                  forceFlowPositionOverride:
                    e.data.forceFlowPositionOverride === true,
                  sourceRect,
                  anchorRect,
                  gridPlacement:
                    e.data.gridPlacement &&
                    Number.isFinite(e.data.gridPlacement.column) &&
                    Number.isFinite(e.data.gridPlacement.columnEnd) &&
                    Number.isFinite(e.data.gridPlacement.row) &&
                    Number.isFinite(e.data.gridPlacement.rowEnd)
                      ? {
                          column: Number(e.data.gridPlacement.column),
                          columnEnd: Number(e.data.gridPlacement.columnEnd),
                          row: Number(e.data.gridPlacement.row),
                          rowEnd: Number(e.data.gridPlacement.rowEnd),
                        }
                      : undefined,
                  gridDisplacements: Array.isArray(e.data.gridDisplacements)
                    ? e.data.gridDisplacements.map(
                        (entry: {
                          sourceId?: unknown;
                          selector?: unknown;
                          placement: {
                            column: number;
                            columnEnd: number;
                            row: number;
                            rowEnd: number;
                          };
                        }) => ({
                          sourceId:
                            typeof entry.sourceId === "string"
                              ? entry.sourceId
                              : undefined,
                          selector:
                            typeof entry.selector === "string"
                              ? entry.selector
                              : undefined,
                          placement: {
                            column: Number(entry.placement.column),
                            columnEnd: Number(entry.placement.columnEnd),
                            row: Number(entry.placement.row),
                            rowEnd: Number(entry.placement.rowEnd),
                          },
                        }),
                      )
                    : undefined,
                  anchorElementInfo: isElementInfoPayload(e.data.anchorPayload)
                    ? e.data.anchorPayload
                    : undefined,
                  insertedHtml:
                    typeof e.data.insertedHtml === "string"
                      ? e.data.insertedHtml
                      : undefined,
                  ...(replaced
                    ? {
                        replaced: true as const,
                        replacementSelector: selector,
                        replacementSourceId: sourceId,
                        replacementSnapshotHtml: replacementSnapshot?.ok
                          ? replacementSnapshot.html
                          : undefined,
                        replacementElementInfo: isElementInfoPayload(
                          e.data.payload,
                        )
                          ? e.data.payload
                          : undefined,
                      }
                    : {}),
                },
              );
          if (applied !== false) requestSharedSnapshotAfterEdit();
          dndHostLog("persist:result", {
            applied,
            requestId,
            willAck: Boolean(requestId) && applied !== "pending",
          });
          if (requestId && applied !== "pending") {
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
        const requestId =
          typeof e.data.requestId === "string" ? e.data.requestId : "";
        const rawSourceNodeIdMap = e.data.sourceNodeIdMap;
        const sourceNodeIdMap =
          rawSourceNodeIdMap === undefined
            ? undefined
            : Array.isArray(rawSourceNodeIdMap) &&
                rawSourceNodeIdMap.every(
                  (entry) =>
                    Array.isArray(entry) &&
                    entry.length === 2 &&
                    typeof entry[0] === "string" &&
                    typeof entry[1] === "string",
                )
              ? (rawSourceNodeIdMap as [string, string][])
              : null;
        let applied: boolean | "pending" = false;
        if (
          selector &&
          cloneHtml &&
          (placement === "before" ||
            placement === "after" ||
            placement === "inside")
        ) {
          const result =
            typeof onVisualDuplicateChange === "function"
              ? onVisualDuplicateChange(selector, cloneHtml, e.data.payload, {
                  sourceId:
                    typeof e.data.sourceId === "string"
                      ? e.data.sourceId
                      : undefined,
                  sourceNodeIdMap,
                  anchorSelector:
                    typeof e.data.anchorSelector === "string"
                      ? e.data.anchorSelector
                      : undefined,
                  anchorSourceId:
                    typeof e.data.anchorSourceId === "string"
                      ? e.data.anchorSourceId
                      : undefined,
                  anchorElementInfo: isElementInfoPayload(e.data.anchorPayload)
                    ? e.data.anchorPayload
                    : undefined,
                  requestId,
                  dropMode:
                    e.data.dropMode === "flow-insert" ||
                    e.data.dropMode === "absolute-container"
                      ? e.data.dropMode
                      : undefined,
                  forceFlowPositionOverride:
                    e.data.forceFlowPositionOverride === true,
                  sourceRect:
                    e.data.sourceRect &&
                    typeof e.data.sourceRect === "object" &&
                    Number.isFinite(e.data.sourceRect.x) &&
                    Number.isFinite(e.data.sourceRect.y) &&
                    Number.isFinite(e.data.sourceRect.width) &&
                    Number.isFinite(e.data.sourceRect.height)
                      ? {
                          x: Number(e.data.sourceRect.x),
                          y: Number(e.data.sourceRect.y),
                          width: Number(e.data.sourceRect.width),
                          height: Number(e.data.sourceRect.height),
                        }
                      : undefined,
                  anchorRect:
                    e.data.anchorRect &&
                    typeof e.data.anchorRect === "object" &&
                    Number.isFinite(e.data.anchorRect.x) &&
                    Number.isFinite(e.data.anchorRect.y) &&
                    Number.isFinite(e.data.anchorRect.width) &&
                    Number.isFinite(e.data.anchorRect.height)
                      ? {
                          x: Number(e.data.anchorRect.x),
                          y: Number(e.data.anchorRect.y),
                          width: Number(e.data.anchorRect.width),
                          height: Number(e.data.anchorRect.height),
                        }
                      : undefined,
                  placement,
                })
              : false;
          applied = result === "pending" ? "pending" : result !== false;
          if (applied !== false) requestSharedSnapshotAfterEdit();
        }
        if (requestId && applied !== "pending") {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "visual-structure-ack",
              requestId,
              applied: true === applied,
            },
            "*",
          );
        }
        return;
      }
      if (e.data.type === "text-edit-pending") {
        // The bridge is waiting for a just-created node before it can enter
        // text-edit mode (begin-text-edit arrived first). Arm the host-side
        // keystroke buffer for the window — repeated pending:true re-posts
        // for the same node (DesignEditor's T6 retry loop) only extend the
        // wait, never reset an in-progress buffer.
        const pendingNodeId =
          typeof e.data.nodeId === "string" ? e.data.nodeId : "";
        const currentPending = pendingTextEditRef.current;
        // A breakpoint preview renders the SAME screenId as the primary frame
        // (which is why owner registration excludes it). Without the same
        // exclusion here, a preview's reply drains the creation's buffer into
        // a frame that will never own the session.
        const capturedOwner = capturedOwnerRef.current;
        if (e.data.pending && pendingNodeId) {
          // A reply for a request that has already been stood down (pointer
          // away, Escape, undo, superseded) must not re-arm the buffer or keep
          // the abandoned node alive; only this canvas's own live request may.
          // Owed text rides in its own begin-text-edit, so once interception
          // has ended nothing moves it back into a canvas that intercepts.
          // A breakpoint preview deliberately has no owner identity: it can
          // never take this capture, drain it, or acknowledge it, so arming its
          // key listener only swallowed keys nobody could ever deliver.
          if (!capturedOwner) return;
          if (
            currentPending?.nodeId !== pendingNodeId &&
            !isPendingTextInterceptionOpen(capturedOwner, pendingNodeId)
          ) {
            return;
          }
          if (currentPending && currentPending.nodeId === pendingNodeId) {
            currentPending.startedAt = Date.now();
          } else {
            // The retry ladder posts begin-text-edit straight at the iframe,
            // so this can be the first time THIS canvas learns it owns the
            // node — take the creation gesture's buffer here too.
            pendingTextEditRef.current = {
              nodeId: pendingNodeId,
              buffer:
                takePendingTextCapture(capturedOwner, pendingNodeId) ?? "",
              startedAt: Date.now(),
            };
          }
        } else if (pendingNodeId) {
          // pending:false covers two different facts. Escape, a pointerdown in
          // the frame, and a superseding dblclick are the USER abandoning this
          // request, and the host request dies with it. The frame's own
          // pump deadline is not: it only means the node has not arrived there
          // yet, and escalating it to abandonment deletes a node the host's own
          // ladder is still working on. An unlabelled report is treated as the
          // latter — the host's deadline still decides.
          const abandonedByUser =
            e.data.reason === "escape" ||
            e.data.reason === "pointerdown" ||
            e.data.reason === "superseded";
          // The frame's own deadline, a failed takeover, and an unlabelled
          // report all mean "not yet", not "abandoned". Clearing the typed
          // buffer on those discarded everything the user had typed while a
          // slow board mounted.
          if (abandonedByUser && currentPending?.nodeId === pendingNodeId) {
            pendingTextEditRef.current = null;
          }
          if (!capturedOwner) return;
          if (abandonedByUser) {
            cancelPendingTextCapture(capturedOwner, pendingNodeId);
          } else if (e.data.reason === "committed") {
            // The frame has the text; the host copy is no longer the original.
            pendingTextEditRef.current =
              currentPending?.nodeId === pendingNodeId
                ? null
                : pendingTextEditRef.current;
            releasePendingTextCapture(capturedOwner, pendingNodeId);
          }
        }
        return;
      }
      if (e.data.type === "text-edit-insert-result") {
        // The frame is the only place that knows whether handed-over keystrokes
        // reached the document. Until it says so the capture keeps owing them,
        // so a dropped insert is re-delivered instead of vanishing.
        const insertNodeId =
          typeof e.data.nodeId === "string" ? e.data.nodeId : "";
        const owner = capturedOwnerRef.current;
        if (owner && insertNodeId) {
          acknowledgePendingTextInsert(
            owner,
            insertNodeId,
            e.data.inserted === true,
          );
        }
        return;
      }
      if (e.data.type === "text-editing-state") {
        // Creation-race replay: the bridge just armed the session for the
        // node we were waiting on — complete that request and flush everything
        // still held for it into the now-live editable. Keyed on the reported
        // element: a late activation for the PREVIOUS creation used to swallow
        // the next one's buffer, splicing its keystrokes into the wrong layer
        // ("Beta" landing inside "Alpha"). Complete first: a capture that ends
        // interception on this very call reclaims this canvas's buffer.
        const activatedSourceId =
          typeof e.data.sourceId === "string" ? e.data.sourceId : "";
        if (e.data.active && activatedSourceId) {
          const owner = capturedOwnerRef.current;
          const pending = pendingTextEditRef.current;
          let buffered = "";
          if (pending && pending.nodeId === activatedSourceId) {
            buffered = pending.buffer;
            pendingTextEditRef.current = null;
          }
          const delivery = owner
            ? beginPendingTextDelivery(owner, activatedSourceId, buffered)
            : null;
          const text = delivery ? delivery.text : buffered;
          // An owed delivery carried its text in its own begin command, so its
          // result settles the request — a second copy would double the text.
          // The capture keeps owning this one until the frame says it landed.
          if (delivery?.alreadyPosted) {
            // Nothing to send; the begin command's own result decides.
          } else if (text) {
            postOneShotBridgeMessage({
              type: "text-edit-insert-text",
              nodeId: activatedSourceId,
              text,
            });
          } else if (owner && delivery) {
            releasePendingTextCapture(owner, activatedSourceId);
          }
        }
        const textState = {
          active: Boolean(e.data.active),
          selector:
            typeof e.data.selector === "string" ? e.data.selector : undefined,
          sourceId:
            typeof e.data.sourceId === "string" ? e.data.sourceId : undefined,
          hasRange: Boolean(e.data.hasRange),
          computedStyles:
            e.data.computedStyles &&
            typeof e.data.computedStyles === "object" &&
            !Array.isArray(e.data.computedStyles)
              ? (e.data.computedStyles as Record<string, string>)
              : undefined,
          inlineStyles:
            e.data.inlineStyles &&
            typeof e.data.inlineStyles === "object" &&
            !Array.isArray(e.data.inlineStyles)
              ? (e.data.inlineStyles as Record<string, string>)
              : undefined,
          rect:
            Number.isFinite(e.data.rect?.width) &&
            Number.isFinite(e.data.rect?.height)
              ? {
                  width: Number(e.data.rect.width),
                  height: Number(e.data.rect.height),
                }
              : undefined,
        };
        textEditingStateRef.current = textState;
        onTextEditingStateChange?.(textState);
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
      if (e.data.type === "figma-clipboard-paste") {
        const content =
          typeof e.data.content === "string" ? e.data.content : "";
        const svgFileError =
          e.data.svgFileError === "too-large" ||
          e.data.svgFileError === "unreadable"
            ? e.data.svgFileError
            : undefined;
        const svg = typeof e.data.svg === "string" ? e.data.svg : undefined;
        const html = typeof e.data.html === "string" ? e.data.html : "";
        const text = typeof e.data.text === "string" ? e.data.text : "";
        if (content || svg || html || text || svgFileError) {
          onFigmaClipboardPaste?.({
            content,
            sourceScreenId: boardSurface ? undefined : screenId,
            svg,
            svgFileError,
            html,
            text,
          });
        }
        return;
      }
      if (e.data.type === "canvas-image-paste") {
        const raw = Array.isArray(e.data.files) ? e.data.files : [];
        const MAX_IMAGE_PASTE_FILES = 20;
        const MAX_DATA_URL_BYTES = 20 * 1024 * 1024; // 20 MB per file
        const files = raw
          .slice(0, MAX_IMAGE_PASTE_FILES)
          .filter(
            (
              f: unknown,
            ): f is { dataUrl: string; type: string; name: string } => {
              if (!f || typeof f !== "object") return false;
              const dataUrl = (f as { dataUrl?: unknown }).dataUrl;
              if (typeof dataUrl !== "string") return false;
              if (
                !dataUrl.startsWith("data:image/") &&
                !dataUrl.startsWith("data:video/")
              )
                return false;
              if (dataUrl.length > MAX_DATA_URL_BYTES) return false;
              return true;
            },
          );
        if (files.length > 0) {
          onImagePaste?.({
            files,
            screenId: boardSurface ? undefined : screenId,
          });
        }
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
            screenId:
              typeof e.data.screenId === "string" ? e.data.screenId : undefined,
            clientX,
            clientY,
            viewportClientX: (iframeRect?.left ?? 0) + clientX * scaleX,
            viewportClientY: (iframeRect?.top ?? 0) + clientY * scaleY,
            info: e.data.payload ?? null,
            layerCandidates: Array.isArray(e.data.layerCandidates)
              ? e.data.layerCandidates
                  .filter(
                    (candidate: unknown) =>
                      candidate &&
                      typeof candidate === "object" &&
                      isElementInfoPayload(
                        (candidate as { info?: unknown }).info,
                      ),
                  )
                  .map((candidate: any, index: number) => ({
                    key:
                      typeof candidate.key === "string"
                        ? candidate.key
                        : `layer-hit-${index}`,
                    label:
                      typeof candidate.label === "string"
                        ? candidate.label.slice(0, 80)
                        : "Layer",
                    screenId:
                      typeof e.data.screenId === "string"
                        ? e.data.screenId
                        : undefined,
                    info: candidate.info,
                  }))
              : [],
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
      if (e.data.type === "embedded-canvas-pan") {
        const iframe = iframeRef.current;
        if (!iframe) return;
        const result = forwardEmbeddedCanvasPanMessage({
          data: e.data,
          iframe,
          hostWindow: window,
          session: embeddedCanvasPanSessionRef.current,
        });
        embeddedCanvasPanSessionRef.current = result.session;
        // The message type belongs exclusively to the gesture bridge. Even a
        // malformed/reordered packet must not fall through to another bridge
        // protocol handler after validation rejects it.
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
        // An embedded frame's zoom belongs to the parent canvas, which already
        // gets the same gesture as embedded-canvas-wheel. Both bridges are
        // installed in every document, so without this the two apply twice.
        if (isEmbeddedFrame) return;
        if (interactMode) return;
        if (!onZoomChange) return;
        const iframe = iframeRef.current;
        const scroll = scrollContainerRef.current;
        if (!iframe || !scroll) return;
        // Guard against non-finite values (NaN/undefined/string) before they
        // reach Math.max/Math.min/Math.exp — an unguarded NaN here would
        // propagate through nextZoom and silently break zoom (mirrors the
        // Number.isFinite-style validation the embedded-canvas-wheel sibling
        // handler above applies to its own wheel deltas/coordinates).
        const rawDeltaY = Number(e.data.deltaY);
        if (!Number.isFinite(rawDeltaY)) return;
        // A synthetic WheelEvent cannot reliably reach usePinchZoom's listener,
        // so this path computes the factor itself — from the same module, never
        // re-derived by hand, or the two curves drift apart again.
        const forwardedMode = Number(e.data.deltaMode);
        const deltaMode = Number.isFinite(forwardedMode) ? forwardedMode : 0;
        pinchZoomDeviceRef.current = resolveZoomGestureDevice({
          deltaY: rawDeltaY,
          deltaMode,
          ctrlKey: Boolean(e.data.ctrlKey),
          metaKey: Boolean(e.data.metaKey),
          atMs: performance.now(),
          previous: pinchZoomDeviceRef.current,
        });
        const currentZoom = zoomRef.current;
        const factor = clampZoomFactor(
          zoomFactorForWheelDelta(
            normalizeWheelDeltaPx(rawDeltaY, deltaMode),
            pinchZoomDeviceRef.current.pinch,
          ),
        );
        const nextZoom = Math.max(
          DEFAULT_CANVAS_MIN_ZOOM,
          Math.min(DEFAULT_CANVAS_MAX_ZOOM, currentZoom * factor),
        );
        if (!Number.isFinite(nextZoom) || nextZoom === currentZoom) return;
        if (deviceFrame === "none" && !centerInteractPreview) {
          const rawClientX = Number(e.data.clientX);
          const rawClientY = Number(e.data.clientY);
          if (!Number.isFinite(rawClientX) || !Number.isFinite(rawClientY)) {
            scheduleZoomCommit(nextZoom);
            return;
          }
          // The iframe lives inside a `transform: scale(zoom/100)` wrapper, so
          // its visual scale relative to viewport is currentZoom / 100. Convert
          // the iframe-document point under the cursor → viewport point, then
          // preserve cursor anchoring while zooming via
          // getZoomToCursorScrollDelta (requires the zoom layer's
          // transform-origin to be "top left" — see that function's doc
          // comment and the "none"-mode zoom layer render comment).
          const iframeRect = iframe.getBoundingClientRect();
          const scrollRect = scroll.getBoundingClientRect();
          const scale = currentZoom / 100;
          const viewportX = iframeRect.left + rawClientX * scale;
          const viewportY = iframeRect.top + rawClientY * scale;
          const ratio = nextZoom / currentZoom;
          const { dx, dy } = getZoomToCursorScrollDelta(
            { x: viewportX, y: viewportY },
            scrollRect,
            scroll,
            ratio,
          );
          scheduleZoomCommit(nextZoom);
          requestAnimationFrame(() => {
            scroll.scrollLeft += dx;
            scroll.scrollTop += dy;
          });
        } else {
          scheduleZoomCommit(nextZoom);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    onElementSelect,
    onRuntimeLayerSnapshot,
    onReserveVisualEditSnapshot,
    onBridgeReady,
    onBootReady,
    markPreviewFrameReady,
    onBootStart,
    externalPreviewUrl,
    onScreenRootComputedStyles,
    onRuntimeVerificationSnapshot,
    onElementMarqueeSelect,
    onElementHover,
    onClearSelection,
    onVisualStyleChange,
    onVisualStyleBatchChange,
    onGradientEditChange,
    onTextContentChange,
    onTextEditingStateChange,
    onElementDblClickText,
    onIframeHotkey,
    onFigmaClipboardPaste,
    onImagePaste,
    onIframeContextMenu,
    onEditorDragStateChange,
    onVisualStructureChange,
    onVisualGridGroupChange,
    onRuntimeStructureInsertRejected,
    onRuntimeStructureInsertApplied,
    onRuntimeLayerRenameApplied,
    onRuntimeStructureDeleteApplied,
    onRuntimeStructureDeleteRejected,
    onRuntimeStructureRollbackResult,
    onRoutePathChange,
    onVisualDuplicateChange,
    onZoomChange,
    scheduleZoomCommit,
    requestSharedSnapshotAfterEdit,
    centerInteractPreview,
    deviceFrame,
    onPrototypeNavigate,
    onComponentSourceJump,
    isEmbeddedFrame,
    sourceType,
    bridgeUrl,
    liveEditBridgeKey,
    runtimeVerificationRequest,
    runtimeStructureTargetTransactionId,
    fusionUrl,
    flushPendingOneShotMessages,
    postOneShotBridgeMessage,
    iframeDocumentIdentity,
  ]);

  // Mirror the selection down only when it changes, so stale re-posts can't
  // race a fast click and re-highlight the old element.
  const lastSelectionMirrorSignatureRef = useRef<string | null>(null);
  const forceSelectionMirrorResyncRef = useRef(true);
  // Selectors from the iframe's own click; skip mirroring them back once to
  // avoid the fast-click bounce.
  const suppressMirrorSelectorsRef = useRef<string[] | null>(null);
  // The iframe cleared this selection itself. A ready handshake can land
  // before the parent renders the clear, and replaying then re-selects it.
  const iframeClearedSelectorRef = useRef<string | null>(null);
  // Latest replayIframeEditorState, synced during render (below) so the message
  // handler can force a corrective resync without a stale closure.
  const replayIframeEditorStateRef = useRef<(() => void) | null>(null);
  const interactModeRef = useRef(interactMode);
  interactModeRef.current = interactMode;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  // Render-synced committed selection so the message handler reads current
  // values without re-binding the window listener on every selection.
  const selectedSelectorRef = useRef(selectedSelector);
  selectedSelectorRef.current = selectedSelector;
  const selectedSelectorCandidatesRef = useRef(selectedSelectorCandidates);
  selectedSelectorCandidatesRef.current = selectedSelectorCandidates;

  const replayIframeEditorState = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.contentWindow?.postMessage(
      {
        type: "set-editor-chrome-scale",
        scaleX: effectiveEditorChromeScaleX,
        scaleY: effectiveEditorChromeScaleY,
      },
      "*",
    );
    iframe.contentWindow?.postMessage(
      { type: "set-interaction-mode", interact: interactModeRef.current },
      "*",
    );
    iframe.contentWindow?.postMessage({ type: "set-read-only", readOnly }, "*");
    iframe.contentWindow?.postMessage(
      {
        type: "set-text-editing-enabled",
        enabled: editModeRef.current,
      },
      "*",
    );
    iframe.contentWindow?.postMessage(
      {
        type: "embedded-canvas-gesture-mode",
        wheelEnabled: isEmbeddedFrame && !interactModeRef.current,
        spaceKeyForwardingEnabled:
          interactModeRef.current || isEmbeddedFrame || readOnly,
        editingSafetyEnabled: !interactModeRef.current,
      },
      "*",
    );
    iframe.contentWindow?.postMessage(
      {
        type: "embedded-canvas-pan-mode",
        leftButtonEnabled: handToolActive || spacePanActive,
      },
      "*",
    );
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
    const selectionMirrorSignature = JSON.stringify({
      selector: selectedSelector ?? null,
      candidates: selectedSelectorCandidates ?? [],
    });
    // Skip echoing back a selection the iframe just reported (fast-click
    // bounce). One-shot: reload forces a resync; external selection clears it.
    const isIframeOriginatedEcho =
      !forceSelectionMirrorResyncRef.current &&
      !!selectedSelector &&
      (suppressMirrorSelectorsRef.current?.includes(selectedSelector) ?? false);
    const staleIframeClear =
      !!selectedSelector &&
      iframeClearedSelectorRef.current === selectedSelector;
    if (!staleIframeClear) iframeClearedSelectorRef.current = null;
    if (staleIframeClear) {
      // Wait for the parent's clear to render; it mirrors down on its own.
    } else if (isIframeOriginatedEcho) {
      lastSelectionMirrorSignatureRef.current = selectionMirrorSignature;
      suppressMirrorSelectorsRef.current = null;
    } else if (
      forceSelectionMirrorResyncRef.current ||
      selectionMirrorSignature !== lastSelectionMirrorSignatureRef.current
    ) {
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
      lastSelectionMirrorSignatureRef.current = selectionMirrorSignature;
      forceSelectionMirrorResyncRef.current = false;
      // An external selection just went down; pending suppression is now stale.
      suppressMirrorSelectorsRef.current = null;
    }
    iframe.contentWindow?.postMessage(
      {
        type: "select-elements",
        selectorGroups: selectedSelectorGroups,
        passiveSelectionStyle,
      },
      "*",
    );
    iframe.contentWindow?.postMessage(
      hoveredSelector
        ? {
            type: "hover-element",
            selector: hoveredSelector,
            selectorCandidates: hoveredSelectorCandidates,
            hoverStyle: passiveSelectionStyle,
          }
        : {
            type: "hover-element",
            selector: "",
            selectorCandidates: [],
            hoverStyle: passiveSelectionStyle,
          },
      "*",
    );
    // Re-send motion tracks so the preview bridge is ready after a reload.
    if (motionTracks && motionTracks.length > 0) {
      iframe.contentWindow?.postMessage(
        {
          type: "motion-load-tracks",
          tracks: motionTracks,
          defaultEase: motionDefaultEase,
          durationMs: motionDurationMs,
        },
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
    iframe.contentWindow?.postMessage(
      {
        type: "state-preview",
        nodeId: statePreviewTarget?.nodeId ?? null,
        selector: statePreviewTarget?.selector ?? "",
        selectorCandidates: statePreviewTarget?.selectorCandidates ?? [],
        state: statePreviewTarget?.state ?? null,
        previewStyles: statePreviewTarget?.previewStyles ?? null,
      },
      "*",
    );
  }, [
    handToolActive,
    effectiveEditorChromeScaleX,
    effectiveEditorChromeScaleY,
    hoveredSelector,
    hoveredSelectorCandidates,
    hiddenSelectors,
    isEmbeddedFrame,
    lockedSelectors,
    motionTracks,
    motionDefaultEase,
    motionDurationMs,
    scaleMode,
    selectedSelector,
    selectedSelectorCandidates,
    selectedSelectorGroups,
    passiveSelectionStyle,
    readOnly,
    shaderFillPreview,
    spacePanActive,
    statePreviewTarget,
    tweakValues,
  ]);
  // Sync during render (not in an effect) so a drift echo can't invoke a stale
  // closure that reposts the previous selection.
  replayIframeEditorStateRef.current = replayIframeEditorState;

  // Replay the editor state whenever it changes OR the iframe (re)loads. The
  // load case matters for screen switches and mode changes; without replaying
  // selection/layer state here, the freshly mounted document looks deselected.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // A (re)loaded document starts with no selection, so force the next
    // mirror to post even if the selector is unchanged from before the load.
    const replayAfterLoad = () => {
      forceSelectionMirrorResyncRef.current = true;
      replayIframeEditorState();
    };
    replayIframeEditorState();
    iframe.addEventListener("load", replayAfterLoad);
    return () => iframe.removeEventListener("load", replayAfterLoad);
  }, [replayIframeEditorState]);

  // A real top-level focus loss (Cmd+Tab, switching windows, browser chrome)
  // does not reliably produce pointercancel inside every browser's iframe.
  // Explicitly reset the child bridge as well as the host-side packet session
  // so the next middle/hand drag can always start cleanly after focus returns.
  useEffect(() => {
    const handleHostWindowBlur = () => {
      embeddedCanvasPanSessionRef.current = null;
      iframeRef.current?.contentWindow?.postMessage(
        { type: "embedded-canvas-pan-cancel" },
        "*",
      );
    };
    window.addEventListener("blur", handleHostWindowBlur);
    return () => window.removeEventListener("blur", handleHostWindowBlur);
  }, []);

  // Fallback for documents that never inject the editor-chrome bridge (e.g.
  // interactMode, or an external-preview iframe where srcdoc is undefined):
  // those never post agent-native:editor-chrome-ready, so nothing would ever
  // flush a queued one-shot command. Treat the iframe's `load` event as an
  // implicit ready in that case — the queued commands (begin-text-edit,
  // style-change, delete-element, replace-document-content) target the
  // editor-chrome bridge's own message handlers, so with no chrome bridge
  // present there is nothing that would have handled them regardless; this
  // just prevents the queue from growing unbounded across repeated reloads.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    function handleLoadReadyFallback() {
      if (!shouldUseIframeLoadReadyFallback(usesLiveEditEditorBridge)) return;
      if (bridgeReadyRef.current) {
        if (editorChromeReadyRef.current) return;
        editorChromeReadyRef.current = true;
        flushPendingOneShotMessages();
        return;
      }
      bridgeReadyRef.current = true;
      editorChromeReadyRef.current = true;
      onBridgeReady?.();
      flushPendingOneShotMessages();
    }
    iframe.addEventListener("load", handleLoadReadyFallback);
    return () => iframe.removeEventListener("load", handleLoadReadyFallback);
  }, [flushPendingOneShotMessages, onBridgeReady, usesLiveEditEditorBridge]);

  // `load` is a URL-backed frame's boot signal, and the fallback for a srcdoc
  // document with no editor-chrome bridge to report ready (Interact mode).
  useEffect(() => {
    if (!onBootReady) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handleLoad = () => {
      if (bootReadyRef.current) return;
      bootReadyRef.current = true;
      onBootReady();
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [iframeDocumentIdentity, onBootReady]);

  useLayoutEffect(() => {
    onBootStart?.();
  }, [iframeDocumentIdentity, onBootStart]);

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
        {
          type: "motion-load-tracks",
          tracks: motionTracks,
          defaultEase: motionDefaultEase,
          durationMs: motionDurationMs,
        },
        "*",
      );
    }
  }, [motionTracks, motionDefaultEase, motionDurationMs]);

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

  // Item 8 — sync the in-screen gradient-edit target to the iframe whenever
  // the prop changes. Mirrors shaderFillPreview's pattern exactly: cleared
  // (null/undefined) posts gradient-edit-clear, set posts gradient-edit-target
  // so the editor-chrome bridge renders drag handles on that node.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (!gradientEditTarget) {
      win.postMessage({ type: "gradient-edit-clear" }, "*");
    } else {
      win.postMessage(
        {
          type: "gradient-edit-target",
          nodeId: gradientEditTarget.nodeId,
          cssValue: gradientEditTarget.cssValue,
        },
        "*",
      );
    }
  }, [gradientEditTarget]);

  // Interaction-state forced preview (phase 2) — sync statePreviewTarget to
  // the iframe whenever the prop changes, exactly mirroring gradientEditTarget's
  // sync effect above: cleared (null/undefined) posts a clearing
  // state-preview message, set posts the node id + state so the bridge sets
  // `data-an-state-preview` on the matching element (see the
  // `statePreviewTarget` prop doc comment and shared/interaction-states.ts's
  // "Forced-preview mechanism" doc comment for the full contract).
  useEffect(() => {
    postOneShotBridgeMessage({
      type: "state-preview",
      nodeId: statePreviewTarget?.nodeId ?? null,
      selector: statePreviewTarget?.selector ?? "",
      selectorCandidates: statePreviewTarget?.selectorCandidates ?? [],
      state: statePreviewTarget?.state ?? null,
      previewStyles: statePreviewTarget?.previewStyles ?? null,
    });
  }, [postOneShotBridgeMessage, statePreviewTarget]);

  // Overview/focused placement is presentation state, not document identity.
  // Update gesture routing in place when entering responsive Interact.
  // registered bridge key instead of rebuilding the injected script.
  //
  // readyIframeDocumentIdentity is a dep purely to re-fire this on every
  // (re)ready handshake: a document swap resets bridgeReadyRef and wipes
  // pendingOneShotMessagesRef (see the contentKey-change effect above), which
  // silently drops this message if it was still queued when the swap
  // happened. Its own value isn't read here — only bridgeReadyRef.current
  // (already true by the time the ready handler flips this state) matters,
  // so re-running always sends live instead of re-queuing into the
  // just-cleared queue.
  useEffect(() => {
    postOneShotBridgeMessage({
      type: "embedded-canvas-gesture-mode",
      wheelEnabled: isEmbeddedFrame && !interactMode,
      spaceKeyForwardingEnabled: interactMode || isEmbeddedFrame || readOnly,
      // Interact hands the app its own native interaction back; every other
      // mode keeps the editing shield armed.
      editingSafetyEnabled: !interactMode,
    });
  }, [
    interactMode,
    isEmbeddedFrame,
    postOneShotBridgeMessage,
    readOnly,
    readyIframeDocumentIdentity,
  ]);

  // The board iframe is a finite paint window over an infinite logical
  // canvas. Re-centering that window must update its CSS/bridge coordinate
  // offset in place; rebuilding srcdoc here would reload the iframe, flash,
  // and discard transient Alpine state on every chunk crossing.
  const embeddedContentOffsetX = embeddedFrame?.contentOffsetX ?? 0;
  const embeddedContentOffsetY = embeddedFrame?.contentOffsetY ?? 0;
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const applyOffset = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const css = embeddedContentOffsetCss(
            embeddedContentOffsetX,
            embeddedContentOffsetY,
          );
          let style = doc.querySelector<HTMLStyleElement>(
            "style[data-agent-native-content-offset]",
          );
          if (!css) {
            style?.remove();
          } else {
            if (!style) {
              style = doc.createElement("style");
              style.setAttribute("data-agent-native-content-offset", "");
              (doc.head ?? doc.documentElement).appendChild(style);
            }
            style.textContent = css;
          }
        }
      } catch {
        // Cross-origin localhost/fusion frames are updated only through their
        // own bridge below; direct document access is intentionally optional.
      }
      iframe.contentWindow?.postMessage(
        {
          type: "set-content-offset",
          x: embeddedContentOffsetX,
          y: embeddedContentOffsetY,
        },
        "*",
      );
    };
    applyOffset();
    iframe.addEventListener("load", applyOffset);
    return () => iframe.removeEventListener("load", applyOffset);
  }, [embeddedContentOffsetX, embeddedContentOffsetY]);

  // The screen's own layout grid step, in this document's content px. Pushed
  // in-place (never baked into srcdoc) so adding or resizing a grid does not
  // reload the iframe and drop its Alpine state.
  const layoutGridStepRef = useRef(layoutGridStep);
  layoutGridStepRef.current = layoutGridStep;
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    function sendLayoutGridStep() {
      iframe!.contentWindow?.postMessage(
        { type: "set-layout-grid-step", step: layoutGridStepRef.current ?? 1 },
        "*",
      );
    }
    sendLayoutGridStep();
    iframe.addEventListener("load", sendLayoutGridStep);
    return () => iframe.removeEventListener("load", sendLayoutGridStep);
    // Only re-run when the step changes; iframe identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutGridStep]);

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

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    function sendInteractionMode() {
      iframe!.contentWindow?.postMessage(
        { type: "set-interaction-mode", interact: interactModeRef.current },
        "*",
      );
    }
    sendInteractionMode();
    iframe.addEventListener("load", sendInteractionMode);
    return () => iframe.removeEventListener("load", sendInteractionMode);
    // Only re-run when interaction ownership changes; iframe identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactMode]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const sendGridGroupBatching = () =>
      iframe.contentWindow?.postMessage(
        {
          type: "set-grid-group-batching-enabled",
          enabled:
            sourceType !== "localhost" &&
            sourceType !== "fusion" &&
            !rawExternalPreviewUrl,
        },
        "*",
      );
    sendGridGroupBatching();
    iframe.addEventListener("load", sendGridGroupBatching);
    return () => iframe.removeEventListener("load", sendGridGroupBatching);
  }, [sourceType, rawExternalPreviewUrl]);

  // Sync editMode to the bridge IN-PLACE via postMessage so toggling Edit ⇄
  // Preview does not rebuild srcdoc / reload every screen iframe (which was
  // PF21: __TEXT_EDITING_ENABLED__ used to be baked into srcdoc, so flipping
  // edit/preview mode reloaded every iframe — white flash + lost in-iframe
  // Alpine state). The initial baked __TEXT_EDITING_ENABLED__ placeholder
  // covers first paint; subsequent changes arrive here. Also re-send on
  // iframe load so the bridge is in sync after any content-key-driven reload.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    function sendTextEditingEnabled() {
      iframe!.contentWindow?.postMessage(
        {
          type: "set-text-editing-enabled",
          enabled: editModeRef.current,
        },
        "*",
      );
    }
    sendTextEditingEnabled();
    iframe.addEventListener("load", sendTextEditingEnabled);
    return () => iframe.removeEventListener("load", sendTextEditingEnabled);
    // Only re-run when editMode changes; iframe identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  /**
   * Trigger immediate text-editing mode for a specific node inside the iframe,
   * identified by its data-agent-native-node-id value.  Call this after
   * programmatically creating a TEXT primitive so the user can type right away
   * without a second click.
   *
   * Posts { type: 'begin-text-edit', nodeId } to the iframe bridge.
   * The bridge enters the same contenteditable text-editing path used on dblclick.
   */
  // The one identity this canvas owns text-edit requests under. A breakpoint
  // preview renders the SAME screenId and must never own one. Read through a
  // ref because the keystroke listener below installs once while `screenId`
  // mutates in place on the single-screen canvas (no key), and a stale owner
  // made every identity check a silent no-op.
  const capturedOwnerRef = useRef<string | null>(null);
  capturedOwnerRef.current = previewFrameId ? null : (screenId ?? null);

  const beginTextEdit = useCallback(
    (nodeId: string, options?: BeginTextEditOptions): boolean => {
      const iframe = iframeRef.current;
      // Not delivered: the caller keeps the intent so a later render (or the
      // next registration) can post it, instead of losing the creation here.
      if (!iframe?.contentWindow || !nodeId) return false;
      const owner = capturedOwnerRef.current;
      // Take over the creation gesture's host-level buffer (see
      // pending-text-capture.ts) for this node: from here until the bridge
      // reports text-editing-state active, host keystrokes are
      // buffered/swallowed here instead of hitting host shortcuts, then
      // replayed into the editable. Re-arming for the same node preserves an
      // in-progress buffer.
      const adopted = owner ? takePendingTextCapture(owner, nodeId) : null;
      if (pendingTextEditRef.current?.nodeId !== nodeId) {
        pendingTextEditRef.current = {
          nodeId,
          buffer: adopted ?? "",
          startedAt: Date.now(),
        };
      } else if (adopted) {
        pendingTextEditRef.current.buffer += adopted;
      }
      // Re-arming the same node only replaces its timer. Running the full
      // cancel here would drop the buffer this call just adopted and tell the
      // bridge to forget a request we are about to re-issue.
      const previousActivation = pendingTextEditActivationRef.current;
      if (previousActivation?.nodeId === nodeId) {
        previousActivation.cancelTimer();
      } else {
        previousActivation?.cancelRequest();
      }
      if (options?.commitImmediately || options?.deliverOwed) {
        // Escape's commit, or text still owed after interception ended: the
        // buffer travels WITH the command, and the command is only a COPY — the
        // host capture keeps the original until the frame acknowledges it,
        // because this payload dies with an iframe swap or an unmount and
        // nothing downstream would know the text had been lost. Nothing
        // intercepts from here: new keys belong to the host, or to the session.
        const commitImmediately = options.commitImmediately === true;
        const local = pendingTextEditRef.current;
        const localText = local?.nodeId === nodeId ? local.buffer : "";
        if (local?.nodeId === nodeId) pendingTextEditRef.current = null;
        // No live request means no host original to fold into; this canvas's
        // own copy is then the only text there is.
        const insertText = owner
          ? (owePendingTextCapture(owner, nodeId, localText, {
              commit: commitImmediately,
            }) ?? localText)
          : localText;
        // The plain activation for this node may still be queued; letting both
        // flush would open an empty session and then re-open it for the text.
        dropQueuedBeginTextEdit(nodeId);
        postOneShotBridgeMessage({
          type: "begin-text-edit",
          nodeId,
          force: true,
          insertText,
          ...(commitImmediately ? { commitImmediately: true } : {}),
        });
        if (owner) {
          onPendingTextCaptureCancel(owner, nodeId, () => {
            dropQueuedBeginTextEdit(nodeId);
            // Dropping the QUEUED copy is not enough: the frame may already
            // hold this begin, and the host-side commit that follows a
            // stand-down would then be a second copy of the same characters.
            // Revoke it at the frame, identity-scoped, before that commit.
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "agent-native:cancel-text-edit",
                screenId: capturedOwnerRef.current ?? "",
                nodeId,
              },
              "*",
            );
          });
        }
        return true;
      }
      const cancelTimer = schedulePendingTextEditActivation(
        () => {
          postOneShotBridgeMessage({
            type: "begin-text-edit",
            nodeId,
            force: true,
          });
        },
        { afterPointerGesture: options?.afterPointerGesture },
      );
      // Pointer-away stands the creation's whole request down, and this post is
      // part of it. Cancelling the timer is not enough: a post made while the
      // bridge was not ready is sitting in the one-shot queue, and the flush
      // that follows readiness focuses a node the user has already left. Drop
      // it by node id while it is still ours to drop — once the iframe has the
      // message, only the iframe can decide.
      const cancelRequest = () => {
        cancelTimer();
        dropQueuedBeginTextEdit(nodeId);
        // Posted straight at the frame, not through the one-shot queue: a
        // cancel only matters to a bridge that already HAS the begin, and
        // queueing it would just replay behind the begin we dropped.
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "agent-native:cancel-text-edit",
            screenId: capturedOwnerRef.current ?? "",
            nodeId,
          },
          "*",
        );
        if (pendingTextEditRef.current?.nodeId === nodeId) {
          pendingTextEditRef.current = null;
        }
      };
      pendingTextEditActivationRef.current = {
        nodeId,
        cancelTimer,
        cancelRequest,
      };
      if (owner) onPendingTextCaptureCancel(owner, nodeId, cancelRequest);
      return true;
    },
    [dropQueuedBeginTextEdit, postOneShotBridgeMessage],
  );
  // The keystroke listener below is installed once and must still reach the
  // CURRENT beginTextEdit when Escape asks it to commit.
  const beginTextEditRef = useRef(beginTextEdit);
  beginTextEditRef.current = beginTextEdit;

  // Routing target for a just-created node's text edit. Only the PRIMARY frame
  // of a screen registers — a breakpoint preview renders the same screen and
  // would collide on the same key — and the board canvas registers under the
  // board file id. Deliberately NOT gated on `registerRuntimeBridge`: a board
  // canvas is inactive at the moment its own first primitive is created, and
  // an unroutable owner is exactly how the gesture's typing got lost.
  useEffect(() => {
    if (previewFrameId) return;
    const owner = screenId;
    // Registered per OWNER IDENTITY, not per callback identity: beginTextEdit
    // is re-created whenever its own dependencies churn, and re-running this
    // effect for that treated a live creation as an owner going away — handing
    // its buffer back and re-beginning mid-session.
    const unregister = registerTextEditOwner(
      owner,
      (nodeId, options) => Boolean(beginTextEditRef.current?.(nodeId, options)),
      (nodeId) => {
        const pending = pendingTextEditRef.current;
        if (pending?.nodeId !== nodeId) return "";
        pendingTextEditRef.current = null;
        return pending.buffer;
      },
    );
    return () => {
      unregister();
      // Unmounting between the handoff and activation would otherwise destroy
      // the only copy of the gesture's keystrokes; hand them back so a remount
      // (or the retry ladder's own pending-window arming) can still use them.
      // An EMPTY buffer has to go back too: the user may not have typed their
      // first character yet, and a capture left handed-off buffers nothing
      // during the remount window.
      const pending = pendingTextEditRef.current;
      if (owner && pending) {
        returnPendingTextCapture(owner, pending.nodeId, pending.buffer);
      }
      pendingTextEditRef.current = null;
      // Only the timer: the REQUEST outlives this instance, so cancelling it
      // here would tell the bridge to drop a begin the replacement still wants.
      pendingTextEditActivationRef.current?.cancelTimer();
      pendingTextEditActivationRef.current = null;
    };
  }, [previewFrameId, screenId]);

  // Creation-race keystroke routing (host side). Active only while a
  // beginTextEdit() command is pending; see routePendingTextEditKey's doc
  // comment for the exact policy. Capture-phase on window so it runs before
  // the editor's own shortcut handlers.
  const pendingTextEditRef = useRef<{
    nodeId: string;
    buffer: string;
    startedAt: number;
  } | null>(null);
  // The one in-flight delayed begin-text-edit post, kept so pointer-away (and
  // the next creation) can drop it instead of letting it land late.
  const pendingTextEditActivationRef = useRef<{
    nodeId: string;
    /** Drops only this instance's delayed post — what an unmount needs, since
     *  the request itself survives into the replacement canvas. */
    cancelTimer: () => void;
    /** Drops the whole request: timer, queued command, and the bridge's copy. */
    cancelRequest: () => void;
  } | null>(null);
  useEffect(() => {
    function onPendingTextEditKeyDown(e: KeyboardEvent) {
      const pending = pendingTextEditRef.current;
      if (!pending) return;
      const interceptOwner = capturedOwnerRef.current;
      if (interceptOwner) {
        // The creation's capture decides how long keys are held back. Asking it
        // past the cap is what takes this buffer on for delivery, and the key
        // that asked goes to the host like every key after it.
        if (!isPendingTextInterceptionOpen(interceptOwner, pending.nodeId)) {
          return;
        }
      } else if (
        Date.now() - pending.startedAt >
        PENDING_TEXT_EDIT_TIMEOUT_MS
      ) {
        pendingTextEditRef.current = null;
        return;
      }
      const routed = routePendingTextEditKey(e);
      if (routed.action === "pass") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (routed.action === "buffer") {
        pending.buffer += routed.char;
      } else if (routed.action === "drop-last") {
        pending.buffer = pending.buffer.slice(0, -1);
      } else if (routed.action === "clear-and-swallow") {
        // This handler registered on mount, so it runs BEFORE the capture's own
        // listener and stopImmediatePropagation() above means that listener
        // never sees the Escape. Decide it here instead, or the capture and its
        // retry ladder stay live and re-focus the node.
        const escapedNodeId = pending.nodeId;
        const escapedText = pending.buffer;
        pendingTextEditActivationRef.current?.cancelTimer();
        pendingTextEditActivationRef.current = null;
        if (escapedText) {
          // Escape ends the session and KEEPS the text (Figma). The commit
          // rides straight to the bridge; the creation's own exhaustion
          // cleanup then keeps the node because it now has content.
          beginTextEditRef.current?.(escapedNodeId, {
            commitImmediately: true,
          });
          return;
        }
        pendingTextEditRef.current = null;
        pendingTextEditActivationRef.current = null;
        const owner = capturedOwnerRef.current;
        if (owner) cancelPendingTextCapture(owner, escapedNodeId);
      }
    }
    function onPendingTextEditPointerDown() {
      // The user clicked somewhere else in the host — stand down so buffered
      // keys are never replayed into an edit they've abandoned, and so the
      // delayed begin-text-edit cannot arrive after they moved on.
      pendingTextEditRef.current = null;
      pendingTextEditActivationRef.current?.cancelRequest();
      pendingTextEditActivationRef.current = null;
    }
    window.addEventListener("keydown", onPendingTextEditKeyDown, true);
    window.addEventListener("pointerdown", onPendingTextEditPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onPendingTextEditKeyDown, true);
      window.removeEventListener(
        "pointerdown",
        onPendingTextEditPointerDown,
        true,
      );
    };
  }, []);

  const sendStyleChange = useCallback(
    (
      selector: string,
      property: string,
      value: string,
      options?: {
        selectorCandidates?: string[];
        nodeId?: string | null;
        phase?: string;
        relativeOperation?: RelativeStyleOperation;
      },
    ) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      return postOneShotBridgeMessage({
        type: "style-change",
        selector,
        property,
        value,
        selectorCandidates: options?.selectorCandidates ?? [],
        nodeId: options?.nodeId ?? "",
        phase: options?.phase,
        relativeOperation: options?.relativeOperation,
      });
    },
    [postOneShotBridgeMessage],
  );

  const sendInteractionStatePreviewStyle = useCallback(
    (args: {
      selector: string;
      selectorCandidates?: string[];
      nodeId?: string | null;
      state: string;
      styles: Record<string, string>;
      routePath?: string;
      screenId?: string;
    }) => {
      if (!screenId || args.screenId !== screenId) return false;
      if (!pendingVisualStyleRouteMatches(args, liveRoutePathRef.current)) {
        return false;
      }
      postOneShotBridgeMessage({
        type: "interaction-state-style-preview",
        selector: args.selector,
        selectorCandidates: args.selectorCandidates ?? [],
        nodeId: args.nodeId ?? "",
        state: args.state,
        styles: args.styles,
      });
      return true;
    },
    [postOneShotBridgeMessage, screenId],
  );

  const lastStyleRevertRequestIdRef = useRef<number | null>(null);
  const replayStylePatches = useCallback(
    (patches: Array<StyleReplayPatch>) => {
      for (const patch of patches) {
        if (!pendingVisualStyleRouteMatches(patch, liveRoutePathRef.current))
          continue;
        const target = runtimeStyleTarget(patch);
        if (target.selectorCandidates.length === 0) continue;
        if (patch.interactionState) {
          sendInteractionStatePreviewStyle({
            selector: target.selector,
            selectorCandidates: target.selectorCandidates,
            nodeId: target.nodeId,
            state: patch.interactionState,
            styles: patch.styles,
          });
          continue;
        }
        for (const [property, value] of Object.entries(patch.styles)) {
          postOneShotBridgeMessage({
            type: "style-change",
            selector: target.selector,
            property,
            value,
            selectorCandidates: target.selectorCandidates,
            nodeId: target.nodeId ?? "",
          });
        }
      }
    },
    [postOneShotBridgeMessage, sendInteractionStatePreviewStyle],
  );
  useEffect(() => {
    if (!styleRevertRequest) return;
    if (lastStyleRevertRequestIdRef.current === styleRevertRequest.requestId) {
      return;
    }
    lastStyleRevertRequestIdRef.current = styleRevertRequest.requestId;
    replayStylePatches(styleRevertRequest.patches);
  }, [replayStylePatches, styleRevertRequest]);

  useEffect(() => {
    if (!screenId) return;
    replayStylePatches(
      (pendingStylePreviewPatches ?? []).filter(
        (patch) =>
          patch.screenId === screenId &&
          pendingVisualStyleRouteMatches(patch, liveRoutePathRef.current),
      ),
    );
  }, [
    contentKey,
    pendingStylePreviewPatches,
    readyIframeDocumentIdentity,
    replayStylePatches,
    screenId,
  ]);

  const lastStyleBaselineResetRequestRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      styleBaselineResetRequest === null ||
      styleBaselineResetRequest === undefined
    )
      return;
    if (
      lastStyleBaselineResetRequestRef.current === styleBaselineResetRequest
    ) {
      return;
    }
    lastStyleBaselineResetRequestRef.current = styleBaselineResetRequest;
    postOneShotBridgeMessage({
      type: "agent-native:reset-live-visual-edit-baselines",
    });
  }, [postOneShotBridgeMessage, styleBaselineResetRequest]);

  const lastTextRevertRequestIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!textRevertRequest) return;
    if (lastTextRevertRequestIdRef.current === textRevertRequest.requestId) {
      return;
    }
    lastTextRevertRequestIdRef.current = textRevertRequest.requestId;
    for (const patch of textRevertRequest.patches) {
      if (patch.routePath && patch.routePath !== liveRoutePathRef.current) {
        continue;
      }
      const selectorCandidates = [
        patch.selector,
        patch.sourceId
          ? `[data-agent-native-node-id="${String(patch.sourceId).replace(/"/g, '\\"')}"]`
          : "",
      ].filter(Boolean);
      postOneShotBridgeMessage({
        type: "set-text-content",
        selector: patch.selector,
        selectorCandidates,
        value: patch.value,
        html: patch.html,
      });
    }
  }, [postOneShotBridgeMessage, textRevertRequest]);

  const lastStructureAckRequestIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!structureAckRequest) return;
    if (
      lastStructureAckRequestIdRef.current === structureAckRequest.requestId
    ) {
      return;
    }
    lastStructureAckRequestIdRef.current = structureAckRequest.requestId;
    for (const ack of structureAckRequest.acks) {
      if (ack.routePath && ack.routePath !== liveRoutePathRef.current) {
        continue;
      }
      postOneShotBridgeMessage({
        type: "visual-structure-ack",
        requestId: ack.requestId,
        applied: ack.applied,
      });
    }
  }, [postOneShotBridgeMessage, structureAckRequest]);

  const lastRuntimeStructureMoveRequestIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!runtimeStructureMoveRequest) return;
    if (
      lastRuntimeStructureMoveRequestIdRef.current ===
      runtimeStructureMoveRequest.requestId
    ) {
      return;
    }
    lastRuntimeStructureMoveRequestIdRef.current =
      runtimeStructureMoveRequest.requestId;
    const moves = runtimeStructureMoveRequest.moves;
    postOneShotBridgeMessage({
      type: "runtime-structure-move",
      subjectSelector: runtimeStructureMoveRequest.subject.selector,
      subjectSourceId: runtimeStructureMoveRequest.subject.sourceId,
      anchorSelector: runtimeStructureMoveRequest.anchor.selector,
      anchorSourceId: runtimeStructureMoveRequest.anchor.sourceId,
      placement: runtimeStructureMoveRequest.placement,
      transactionId: runtimeStructureMoveRequest.transactionId,
      gridPlacement: runtimeStructureMoveRequest.gridPlacement,
      gridDisplacements: runtimeStructureMoveRequest.gridDisplacements,
      moves: moves?.map((move) => ({
        subjectSelector: move.subject.selector,
        subjectSourceId: move.subject.sourceId,
        anchorSelector: move.anchor.selector,
        anchorSourceId: move.anchor.sourceId,
        placement: move.placement,
        transactionId: move.transactionId,
        gridPlacement: move.gridPlacement,
        gridDisplacements: move.gridDisplacements,
      })),
    });
  }, [postOneShotBridgeMessage, runtimeStructureMoveRequest]);

  const lastRuntimeStructureInsertRequestIdRef = useRef<number | null>(null);
  const insertRequestAtUnmountRef = useRef(runtimeStructureInsertRequest);
  const rollbackRequestAtUnmountRef = useRef(runtimeStructureRollbackRequest);
  const targetTransactionAtUnmountRef = useRef(
    runtimeStructureTargetTransactionId,
  );
  const rejectInsertAtUnmountRef = useRef(onRuntimeStructureInsertRejected);
  const rollbackResultAtUnmountRef = useRef(onRuntimeStructureRollbackResult);
  insertRequestAtUnmountRef.current = runtimeStructureInsertRequest;
  rollbackRequestAtUnmountRef.current = runtimeStructureRollbackRequest;
  targetTransactionAtUnmountRef.current = runtimeStructureTargetTransactionId;
  rejectInsertAtUnmountRef.current = onRuntimeStructureInsertRejected;
  rollbackResultAtUnmountRef.current = onRuntimeStructureRollbackResult;
  useEffect(
    () => () => {
      const rollbackRequest = rollbackRequestAtUnmountRef.current;
      const transactionId = rollbackRequest?.transactionId;
      if (
        rollbackRequest?.transactionId &&
        rollbackResultAtUnmountRef.current
      ) {
        rollbackResultAtUnmountRef.current({
          requestId: rollbackRequest.requestId,
          transactionId,
          applied: false,
          reason: "target-canvas-unmounted",
        });
        return;
      }
      const insertTransactionId =
        transactionId ??
        insertRequestAtUnmountRef.current?.transactionId ??
        targetTransactionAtUnmountRef.current;
      if (insertTransactionId) {
        rejectInsertAtUnmountRef.current?.(
          "target-canvas-unmounted",
          insertTransactionId,
        );
      }
    },
    [],
  );
  useEffect(() => {
    if (!runtimeStructureInsertRequest) return;
    if (
      lastRuntimeStructureInsertRequestIdRef.current ===
      runtimeStructureInsertRequest.requestId
    ) {
      return;
    }
    lastRuntimeStructureInsertRequestIdRef.current =
      runtimeStructureInsertRequest.requestId;
    let anchorSelector = runtimeStructureInsertRequest.anchor.selector;
    let anchorSourceId = runtimeStructureInsertRequest.anchor.sourceId;
    [
      runtimeStructureInsertRequest.html,
      ...(runtimeStructureInsertRequest.additionalHtml ?? []),
    ].forEach((html, index) => {
      postOneShotBridgeMessage({
        type: "runtime-structure-insert",
        screenId: runtimeStructureInsertRequest.screenId,
        sourceScreenId: runtimeStructureInsertRequest.sourceScreenId,
        requestId: runtimeStructureInsertRequest.requestId + index / 1_000,
        transactionId: runtimeStructureInsertRequest.transactionId,
        ...(runtimeStructureInsertRequest.remintCollidingNodeIds === true
          ? { remintCollidingNodeIds: true }
          : {}),
        html,
        anchorSelector,
        anchorSourceId,
        anchorPendingNodeId: runtimeStructureInsertRequest.anchor.pendingNodeId,
        placement: runtimeStructureInsertRequest.placement,
        ...(runtimeStructureInsertRequest.replaceAnchor === true && index === 0
          ? { replaceAnchor: true }
          : {}),
      });
      // Repeated "after" inserts against the original anchor reverse their
      // order. Chain each subsequent root after the clone before it so a
      // multi-layer clipboard lands in the same order the user copied.
      if (runtimeStructureInsertRequest.placement === "after") {
        const root = new DOMParser()
          .parseFromString(`<template>${html}</template>`, "text/html")
          .querySelector("template")?.content.firstElementChild;
        const rootNodeId = root?.getAttribute("data-agent-native-node-id");
        if (rootNodeId) {
          anchorSelector = `[data-agent-native-node-id="${rootNodeId}"]`;
          anchorSourceId = rootNodeId;
        }
      }
    });
  }, [postOneShotBridgeMessage, runtimeStructureInsertRequest]);

  useEffect(() => {
    const request = runtimeStructureDeleteRequest;
    const currentPreview = pendingRuntimeDeletePreviewRef.current;
    const requestMatchesPreview =
      Boolean(request) && request?.requestId === currentPreview?.requestId;
    if (
      currentPreview &&
      !requestMatchesPreview &&
      (request !== null || !currentPreview.awaitingTransaction)
    ) {
      postOneShotBridgeMessage({
        type: "cancel-pending-delete-element",
        selector: currentPreview.selector,
        selectorCandidates: currentPreview.selectorCandidates,
        requestId: currentPreview.requestId,
        transactionId: currentPreview.transactionId,
      });
      pendingRuntimeDeletePreviewRef.current = null;
    }
    if (requestMatchesPreview && currentPreview) {
      currentPreview.transactionId = request?.transactionId;
      currentPreview.awaitingTransaction = false;
    }
    if (!request?.waitForInsertTransaction) return;
    if (readyIframeDocumentIdentity !== iframeDocumentIdentity) {
      if (currentPreview?.requestId === request.requestId) {
        currentPreview.documentIdentity = null;
      }
      return;
    }
    const latestPreview = pendingRuntimeDeletePreviewRef.current;
    if (
      latestPreview?.requestId === request.requestId &&
      latestPreview.documentIdentity === readyIframeDocumentIdentity
    ) {
      return;
    }
    postOneShotBridgeMessage({
      type: "pending-delete-element",
      selector: request.selector,
      selectorCandidates: request.selectorCandidates ?? [],
      requestId: request.requestId,
      transactionId: request.transactionId,
    });
    pendingRuntimeDeletePreviewRef.current = {
      requestId: request.requestId,
      selector: request.selector,
      selectorCandidates: request.selectorCandidates ?? [],
      transactionId: request.transactionId,
      documentIdentity: readyIframeDocumentIdentity,
      awaitingTransaction: false,
    };
  }, [
    iframeDocumentIdentity,
    postOneShotBridgeMessage,
    readyIframeDocumentIdentity,
    runtimeStructureDeleteRequest,
  ]);

  useEffect(() => {
    const request = runtimeStructureDeleteRequest;
    if (!request?.cancelRequested) {
      lastRuntimeStructureDeleteCancelRequestIdRef.current = null;
      return;
    }
    if (readyIframeDocumentIdentity !== iframeDocumentIdentity) {
      lastRuntimeStructureDeleteCancelRequestIdRef.current = null;
      return;
    }
    if (
      lastRuntimeStructureDeleteCancelRequestIdRef.current === request.requestId
    ) {
      return;
    }
    lastRuntimeStructureDeleteCancelRequestIdRef.current = request.requestId;
    postOneShotBridgeMessage({
      type: "cancel-pending-delete-element",
      selector: request.selector,
      selectorCandidates: request.selectorCandidates ?? [],
      requestId: request.requestId,
      transactionId: request.transactionId,
    });
    postOneShotBridgeMessage({
      type: "visual-structure-ack",
      requestId: request.requestId,
      applied: false,
    });
    onRuntimeStructureDeleteRejected?.({
      screenId,
      requestId: request.requestId,
      transactionId: request.transactionId,
      reason: "cancelled",
    });
  }, [
    iframeDocumentIdentity,
    onRuntimeStructureDeleteRejected,
    postOneShotBridgeMessage,
    readyIframeDocumentIdentity,
    runtimeStructureDeleteRequest,
    screenId,
  ]);

  useEffect(() => {
    if (!runtimeStructureDeleteRequest) return;
    if (runtimeStructureDeleteRequest.cancelRequested) return;
    if (runtimeStructureDeleteRequest.waitForInsertTransaction) return;
    if (
      lastRuntimeStructureDeleteRequestIdRef.current ===
      runtimeStructureDeleteRequest.requestId
    ) {
      return;
    }
    lastRuntimeStructureDeleteRequestIdRef.current =
      runtimeStructureDeleteRequest.requestId;
    postOneShotBridgeMessage({
      type: "delete-element",
      selector: runtimeStructureDeleteRequest.selector,
      selectorCandidates:
        runtimeStructureDeleteRequest.selectorCandidates ?? [],
      requestId: runtimeStructureDeleteRequest.requestId,
      transactionId: runtimeStructureDeleteRequest.transactionId,
    });
  }, [postOneShotBridgeMessage, runtimeStructureDeleteRequest]);

  const lastRuntimeStructureRollbackRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!runtimeStructureRollbackRequest) return;
    if (readyIframeDocumentIdentity !== iframeDocumentIdentity) {
      lastRuntimeStructureRollbackRequestIdRef.current = null;
      return;
    }
    if (
      lastRuntimeStructureRollbackRequestIdRef.current ===
      runtimeStructureRollbackRequest.requestId
    ) {
      return;
    }
    lastRuntimeStructureRollbackRequestIdRef.current =
      runtimeStructureRollbackRequest.requestId;
    postOneShotBridgeMessage({
      type: "runtime-structure-rollback-insert",
      selector: runtimeStructureRollbackRequest.selector,
      sourceId: runtimeStructureRollbackRequest.sourceId,
      requestId: runtimeStructureRollbackRequest.requestId,
      transactionId: runtimeStructureRollbackRequest.transactionId,
    });
  }, [
    iframeDocumentIdentity,
    postOneShotBridgeMessage,
    readyIframeDocumentIdentity,
    runtimeStructureRollbackRequest,
  ]);

  const lastRuntimeLayerRenameRequestIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!runtimeLayerRenameRequest) return;
    if (
      runtimeLayerRenameRequest.routePath &&
      runtimeLayerRenameRequest.routePath !== liveRoutePathRef.current
    ) {
      return;
    }
    if (
      lastRuntimeLayerRenameRequestIdRef.current ===
      runtimeLayerRenameRequest.requestId
    ) {
      return;
    }
    lastRuntimeLayerRenameRequestIdRef.current =
      runtimeLayerRenameRequest.requestId;
    postOneShotBridgeMessage({
      type: "runtime-layer-rename",
      requestId: runtimeLayerRenameRequest.requestId,
      selector: runtimeLayerRenameRequest.selector,
      sourceId: runtimeLayerRenameRequest.sourceId,
      name: runtimeLayerRenameRequest.name,
    });
  }, [postOneShotBridgeMessage, runtimeLayerRenameRequest]);

  const lastRuntimeLayerSnapshotRequestIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (runtimeLayerSnapshotRequest == null) return;
    if (
      lastRuntimeLayerSnapshotRequestIdRef.current ===
      runtimeLayerSnapshotRequest
    ) {
      return;
    }
    lastRuntimeLayerSnapshotRequestIdRef.current = runtimeLayerSnapshotRequest;
    requestRuntimeLayerSnapshot();
  }, [requestRuntimeLayerSnapshot, runtimeLayerSnapshotRequest]);

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
    (
      nextContent: string,
      selector?: string | null,
      candidates?: string[],
      options?: {
        forceFullDocument?: boolean;
        preserveTextEditingSession?: boolean;
        sourceProvenance?: SourceDocumentProvenance;
      },
    ) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      return postOneShotBridgeMessage({
        type: "replace-document-content",
        content: nextContent,
        sourceProvenance: options?.sourceProvenance,
        selectedSelector: selector ?? "",
        selectorCandidates: candidates ?? [],
        forceFullDocument: options?.forceFullDocument === true,
        preserveTextEditingSession:
          options?.preserveTextEditingSession === true,
      });
    },
    [postOneShotBridgeMessage],
  );

  const replacePreviewContentFromHost = useCallback(
    (
      rawNextContent: string,
      selector?: string | null,
      candidates?: string[],
      options?: {
        forceFullDocument?: boolean;
        preserveTextEditingSession?: boolean;
      },
    ) => {
      // Raw content here drops the injected offset/background styles, moving a
      // frame authored at a negative offset off screen. Both channels push the
      // same shape.
      //
      // A board surface additionally needs its render-style tag
      // (color-scheme + transparent background) re-applied here: this is raw
      // file content — e.g. an undo/redo content revert — that never passed
      // through MultiScreenCanvas's own `getBoardSurfaceRenderContent` wrap.
      // Skipping it drops `color-scheme:dark` from the live document, and
      // Chrome then paints its opaque light UA base behind the still-
      // transparent iframe — a white canvas in a dark editor.
      const nextContent = boardSurface
        ? getBoardSurfaceRenderContent(rawNextContent, resolvedTheme === "dark")
        : rawNextContent;
      const replaced = replacePreviewContent(
        getEmbeddedFrameDocumentContent({
          content: withLocalRuntimes(nextContent),
          embeddedFrameBackground,
          transparentBackground,
          contentOffsetX: embeddedFrame?.contentOffsetX ?? 0,
          contentOffsetY: embeddedFrame?.contentOffsetY ?? 0,
          fitBodyToFrame: fitRootBodyToFrame ?? !boardSurface,
        }),
        selector,
        candidates,
        {
          ...options,
          sourceProvenance: createSourceDocumentProvenance(rawNextContent),
        },
      );
      if (replaced) {
        // The orchestrator applied these exact bytes imperatively before the
        // React props carrying their new runtimeReplacementKey rendered.
        // Remember the board-wrapped form so the later React-prop comparison
        // (against MultiScreenCanvas's own equally-wrapped
        // `runtimeReplacementContent`) recognizes the live document as
        // already current instead of re-applying the same content again.
        lastRuntimeReplacementContentRef.current = nextContent;
      }
      return replaced;
    },
    [
      boardSurface,
      embeddedFrame?.contentOffsetX,
      embeddedFrame?.contentOffsetY,
      embeddedFrameBackground,
      fitRootBodyToFrame,
      replacePreviewContent,
      resolvedTheme,
      transparentBackground,
    ],
  );

  restoreKScalePreviewRef.current = () => {
    const sourceContent =
      authoredSourceContent ?? runtimeReplacementContent ?? content;
    if (getExternalPreviewUrl(sourceContent)) return;
    const previewWindow = iframeRef.current?.contentWindow as
      | (Window & {
          __designCanvasScaleContents?: (
            factor: number,
            phase: "cancel",
          ) => unknown;
        })
      | null
      | undefined;
    // The source morph preserves unchanged live styles; unwind K's imperative
    // preview first so it cannot be mistaken for a runtime-owned value.
    try {
      previewWindow?.__designCanvasScaleContents?.(1, "cancel");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "SecurityError")) {
        throw error;
      }
    }
    replacePreviewContentFromHost(
      sourceContent,
      selectedSelectorRef.current,
      selectedSelectorCandidatesRef.current,
      { forceFullDocument: true },
    );
  };

  const replaceRuntimeContentInPlace = useCallback(
    (rawNextContent: string, rawSourceContent: string = rawNextContent) => {
      if (externalPreviewUrl) return false;
      // Symmetric with replacePreviewContentFromHost above: this channel's
      // callers (the runtimeReplacementContent effect, the iframe load
      // listener) already pass board-wrapped content today, but relying on
      // every current and future caller to remember that is exactly the
      // stale-cache trap that produced the white-canvas bug there — wrap
      // unconditionally so this channel can never regress the same way.
      const nextContent = boardSurface
        ? getBoardSurfaceRenderContent(rawNextContent, resolvedTheme === "dark")
        : rawNextContent;
      return replacePreviewContent(
        getEmbeddedFrameDocumentContent({
          // The initial srcdoc is normalized through withLocalRuntimes below.
          // Keep the in-place overview replacement on that same local runtime
          // path, otherwise a saved CDN script is reintroduced after the
          // iframe has mounted and can leave the design unstyled when the
          // browser cannot reach the provider.
          content: withLocalRuntimes(nextContent),
          embeddedFrameBackground,
          transparentBackground,
          contentOffsetX: embeddedFrame?.contentOffsetX ?? 0,
          contentOffsetY: embeddedFrame?.contentOffsetY ?? 0,
          fitBodyToFrame: fitRootBodyToFrame ?? !boardSurface,
        }),
        // Carry the host's committed selection so the bridge can re-anchor it
        // after the morph: without it the canvas silently deselects while the
        // inspector still shows the element.
        selectedSelectorRef.current,
        selectedSelectorCandidatesRef.current ?? [],
        {
          forceFullDocument: true,
          sourceProvenance: createSourceDocumentProvenance(rawSourceContent),
          // Prop/save echoes are synchronization, not a user command. If a
          // text draft is active, buffer the newest generation until commit
          // instead of tearing down its caret mid-keystroke.
          preserveTextEditingSession: true,
        },
      );
    },
    [
      boardSurface,
      embeddedFrame?.contentOffsetX,
      embeddedFrame?.contentOffsetY,
      embeddedFrameBackground,
      externalPreviewUrl,
      fitRootBodyToFrame,
      replacePreviewContent,
      resolvedTheme,
      transparentBackground,
    ],
  );

  useEffect(() => {
    if (
      runtimeReplacementKey === undefined ||
      runtimeReplacementContent === undefined ||
      (lastRuntimeReplacementKeyRef.current === runtimeReplacementKey &&
        lastRuntimeReplacementContentRef.current === runtimeReplacementContent)
    ) {
      return;
    }
    if (
      lastRuntimeReplacementContentRef.current === runtimeReplacementContent
    ) {
      lastRuntimeReplacementKeyRef.current = runtimeReplacementKey;
      return;
    }
    const previousRuntimeContent =
      lastRuntimeReplacementContentRef.current ?? renderedContent;
    if (
      runtimeDocumentNeedsReload(
        previousRuntimeContent,
        runtimeReplacementContent,
      )
    ) {
      // `replaceRuntimeDocument` cannot execute scripts introduced through
      // innerHTML. A real srcdoc rebuild is required for transitions such as a
      // static variant becoming an Alpine app with `body[x-cloak]`; otherwise
      // Alpine never starts and the entire editable canvas remains hidden
      // while Interact mode (which does reload) appears to work.
      lastRuntimeReplacementKeyRef.current = runtimeReplacementKey;
      lastRuntimeReplacementContentRef.current = runtimeReplacementContent;
      bridgeReadyRef.current = false;
      editorChromeReadyRef.current = false;
      bootReadyRef.current = false;
      pendingOneShotMessagesRef.current = [];
      setRenderedDocument({
        content: runtimeReplacementContent,
        sourceContent: authoredSourceContent ?? runtimeReplacementContent,
      });
      return;
    }
    if (
      replaceRuntimeContentInPlace(
        runtimeReplacementContent,
        authoredSourceContent ?? runtimeReplacementContent,
      )
    ) {
      lastRuntimeReplacementKeyRef.current = runtimeReplacementKey;
      lastRuntimeReplacementContentRef.current = runtimeReplacementContent;
    }
  }, [
    replaceRuntimeContentInPlace,
    renderedContent,
    runtimeReplacementContent,
    runtimeReplacementKey,
    authoredSourceContent,
  ]);

  const runtimeReplacementEnabled = runtimeReplacementKey !== undefined;
  useEffect(() => {
    if (!runtimeReplacementEnabled) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const replaceLatestRuntimeContent = () => {
      const nextContent = runtimeReplacementContentRef.current;
      if (nextContent === undefined) return;
      // The document that just loaded was built from these bytes; swapping it
      // for itself only costs a blank frame.
      if (renderedContentRef.current === nextContent) return;
      if (
        replaceRuntimeContentInPlace(
          nextContent,
          runtimeReplacementSourceRef.current ?? nextContent,
        )
      ) {
        lastRuntimeReplacementKeyRef.current = runtimeReplacementKeyRef.current;
        lastRuntimeReplacementContentRef.current = nextContent;
      }
    };
    iframe.addEventListener("load", replaceLatestRuntimeContent);
    return () =>
      iframe.removeEventListener("load", replaceLatestRuntimeContent);
  }, [replaceRuntimeContentInPlace, runtimeReplacementEnabled]);

  const deleteRuntimeElement = useCallback(
    (
      selector?: string | null,
      candidates?: string[],
      // Present when the host queued this deletion as a pending live edit; the
      // bridge keeps the detached node under this id so a later
      // visual-structure-ack with applied:false can put it back.
      requestId?: string,
    ) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      return postOneShotBridgeMessage({
        type: "delete-element",
        selector: selector ?? "",
        selectorCandidates: candidates ?? [],
        requestId,
      });
    },
    [postOneShotBridgeMessage],
  );

  // BUG-UNDO-LINKED-BREAKPOINT: every mounted frame for a screen (primary +
  // breakpoint siblings) registers its own replace/style handlers so the
  // orchestrator can fan out undo/redo and base style commits to all of them.
  // `registerRuntimeBridge` still owns the single-active global helpers below;
  // this registry is the multi-frame path those globals cannot reach.
  useEffect(() => {
    const frameId = previewFrameId ?? screenId;
    if (!frameId) return;
    return registerLinkedScreenPreviewHandlers(frameId, {
      replaceContent: replacePreviewContentFromHost,
      sendStyleChange,
      pendingDelete: ({
        selector,
        selectorCandidates,
        requestId,
        transactionId,
      }) => {
        pendingRuntimeDeletePreviewRef.current = {
          requestId,
          selector,
          selectorCandidates,
          transactionId,
          documentIdentity: readyIframeDocumentIdentity,
          awaitingTransaction: !transactionId,
        };
        return postOneShotBridgeMessage({
          type: "pending-delete-element",
          selector,
          selectorCandidates,
          requestId,
          transactionId,
        });
      },
      cancelPendingDelete: ({
        selector,
        selectorCandidates,
        requestId,
        transactionId,
      }) => {
        const current = pendingRuntimeDeletePreviewRef.current;
        if (current?.requestId === requestId) {
          pendingRuntimeDeletePreviewRef.current = null;
        }
        return postOneShotBridgeMessage({
          type: "cancel-pending-delete-element",
          selector: selector ?? current?.selector ?? "",
          selectorCandidates:
            selectorCandidates ?? current?.selectorCandidates ?? [],
          requestId,
          transactionId: transactionId ?? current?.transactionId,
        });
      },
      sendInteractionStatePreviewStyle,
    });
  }, [
    previewFrameId,
    postOneShotBridgeMessage,
    readyIframeDocumentIdentity,
    replacePreviewContentFromHost,
    sendInteractionStatePreviewStyle,
    screenId,
    sendStyleChange,
  ]);

  // Expose iframe runtime mutations for the editor orchestrator.
  useEffect(() => {
    if (!registerRuntimeBridge) return;
    // Fan out base-scope style edits to linked breakpoint iframes so they stay
    // visually in sync (BUG-UNDO-LINKED-BREAKPOINT). Breakpoint-scoped preview
    // frames must only patch themselves — otherwise a Phone edit briefly paints
    // onto Tablet/Desktop siblings before persistence scope is decided.
    const sendStyleChangeLinked = (
      selector: string,
      property: string,
      value: string,
      options?: {
        selectorCandidates?: string[];
        nodeId?: string | null;
        phase?: string;
      },
    ) => {
      const isBreakpointScopedPreview =
        typeof previewFrameId === "string" && previewFrameId.includes("::bp-");
      if (screenId && !isBreakpointScopedPreview) {
        return sendLinkedScreenPreviewStyleChange(
          screenId,
          selector,
          property,
          value,
          options,
        );
      }
      return sendStyleChange(selector, property, value, options);
    };
    const sendStyleChangeForScreenLinked = (
      targetScreenId: string,
      selector: string,
      property: string,
      value: string,
      options?: {
        selectorCandidates?: string[];
        nodeId?: string | null;
        routePath?: string;
        interactionState?: InteractionState;
      },
    ) => {
      if (!screenId || targetScreenId !== screenId) return false;
      if (
        !pendingVisualStyleRouteMatches(options ?? {}, liveRoutePathRef.current)
      ) {
        return false;
      }
      if (options?.interactionState) {
        return sendInteractionStatePreviewStyle({
          selector,
          selectorCandidates: options.selectorCandidates,
          nodeId: options.nodeId,
          state: options.interactionState,
          styles: { [property]: value },
          routePath: options.routePath,
          screenId,
        });
      }
      return sendStyleChangeLinked(
        selector,
        property,
        value,
        options
          ? {
              selectorCandidates: options.selectorCandidates,
              nodeId: options.nodeId,
            }
          : undefined,
      );
    };
    const replacePreviewContentLinked = (
      nextContent: string,
      selector?: string | null,
      candidates?: string[],
      options?: {
        forceFullDocument?: boolean;
        preserveTextEditingSession?: boolean;
      },
    ) => {
      if (screenId) {
        return replaceLinkedScreenPreviewContent(
          screenId,
          nextContent,
          selector,
          candidates,
          options,
        );
      }
      return replacePreviewContentFromHost(
        nextContent,
        selector,
        candidates,
        options,
      );
    };
    (window as any).__designCanvasSendStyle = sendStyleChangeLinked;
    (window as any).__designCanvasSendStyleForScreen =
      sendStyleChangeForScreenLinked;
    (window as any).__designCanvasSendInteractionStatePreviewStyle =
      sendInteractionStatePreviewStyle;
    (window as any).__designCanvasReplaceContent = replacePreviewContentLinked;
    (window as any).__designCanvasDeleteElement = deleteRuntimeElement;
    (window as any).__designCanvasSendMotionPreview = sendMotionPreview;
    (window as any).__designCanvasClearMotionPreview = clearMotionPreview;
    // Shader-fill preview helpers (preview-only, §6.7 gating applies to apply).
    (window as any).__designCanvasSendShaderFillPreview = sendShaderFillPreview;
    (window as any).__designCanvasClearShaderFillPreview =
      clearShaderFillPreview;
    return () => {
      // Identity-guard each delete so a stale unmounting instance never clobbers
      // a freshly mounted instance's bridge during a remount race.
      if ((window as any).__designCanvasSendStyle === sendStyleChangeLinked) {
        delete (window as any).__designCanvasSendStyle;
      }
      if (
        (window as any).__designCanvasSendStyleForScreen ===
        sendStyleChangeForScreenLinked
      ) {
        delete (window as any).__designCanvasSendStyleForScreen;
      }
      if (
        (window as any).__designCanvasSendInteractionStatePreviewStyle ===
        sendInteractionStatePreviewStyle
      ) {
        delete (window as any).__designCanvasSendInteractionStatePreviewStyle;
      }
      if (
        (window as any).__designCanvasReplaceContent ===
        replacePreviewContentLinked
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
    };
  }, [
    deleteRuntimeElement,
    registerRuntimeBridge,
    replacePreviewContentFromHost,
    screenId,
    sendStyleChange,
    sendInteractionStatePreviewStyle,
    sendMotionPreview,
    clearMotionPreview,
    sendShaderFillPreview,
    clearShaderFillPreview,
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
  const embeddedFramePaintScaleX =
    embeddedFrame && !embeddedFrameFluid
      ? embeddedFrame.displayWidth / Math.max(1, embeddedFrame.viewportWidth)
      : 1;
  const embeddedFramePaintScaleY =
    embeddedFrame && !embeddedFrameFluid
      ? embeddedFrame.displayHeight / Math.max(1, embeddedFrame.viewportHeight)
      : 1;
  // One oversized axis can force the whole iframe backing surface onto the
  // compositor path, so use the larger inner and editor scale conservatively.
  const embeddedPaintScale =
    Math.max(1, embeddedFramePaintScaleX, embeddedFramePaintScaleY) *
    Math.max(1, editorChromeScaleX, editorChromeScaleY);
  const iframeBackgroundColor = getEmbeddedIframeBackgroundColor({
    embeddedFrameBackground,
    transparentBackground,
  });

  // Per-breakpoint override: when previewWidthPx is set it takes priority over
  // the deviceFrame width so the caller can render the same source at an
  // explicit viewport width (e.g. 390 / 768 / 1280 side-by-side breakpoints).
  const resolvedWidth =
    previewWidthPx !== null && previewWidthPx !== undefined
      ? `${previewWidthPx}px`
      : iframeWidth;
  const resolvedHeight =
    previewHeightPx !== null && previewHeightPx !== undefined
      ? `${previewHeightPx}px`
      : deviceFrame === "none"
        ? "100%"
        : (iframeHeight ?? undefined);
  const focusScrollSurface = useCallback(() => {
    const surface = scrollContainerRef.current;
    if (!surface || document.activeElement === surface) return;
    // A picker drag ending over the canvas must not take focus from the open
    // picker: losing it ends the inspector gesture and drops a styled text range.
    if (
      textEditingStateRef.current.active ||
      document.activeElement?.closest("[data-radix-popper-content-wrapper]")
    ) {
      return;
    }
    const focusedElement = document.activeElement;
    if (focusedElement instanceof HTMLIFrameElement) {
      try {
        const frameDocument = focusedElement.contentDocument;
        if (
          !frameDocument ||
          frameDocument.activeElement?.closest(EDITABLE_FOCUS_SELECTOR)
        ) {
          return;
        }
      } catch {
        // Keep focus inside a frame we cannot inspect; it may own an editor.
        return;
      }
    }
    // Taking focus for keyboard panning must never outrank a field the user
    // was just handed: a composer that opens under the cursor would otherwise
    // be focused on mount and silently unfocused by the same pointer motion.
    if (focusedElement?.closest(EDITABLE_FOCUS_SELECTOR)) return;
    surface.focus({ preventScroll: true });
  }, []);

  // Single-screen pan (Figma parity §3): middle-mouse-button drag always
  // pans (mirrors MultiScreenCanvas's unconditional `e.button === 1` branch
  // in its own beginPan); a plain left-button drag pans too when the hand
  // tool is armed (`handToolActive`) or the spacebar is held
  // (`spacePanActive` — see the prop doc comment for why DesignCanvas
  // doesn't listen for the spacebar itself). Movement is 1:1 and
  // un-animated (direct scrollLeft/scrollTop deltas each mousemove, no
  // inertia/momentum), matching MultiScreenCanvas's own beginPan feel —
  // plain `mousemove`/`mouseup` window listeners for the drag's lifetime,
  // same pattern as its `installDragListeners(handleMouseMove, handlePanEnd)`.
  //
  // Drags that begin inside the iframe arrive through the generated embedded
  // gesture bridge as a synthetic mousedown on the parent iframe element,
  // followed by window mousemove/mouseup events. That deliberately reuses
  // this exact path, keeping empty-canvas, inline HTML/Alpine, and localhost
  // live-edit panning behavior identical without an iframe-local pan model.
  const [isPanningState, setIsPanningState] = useState(false);

  const handleScrollSurfaceMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isCanvasOverlayInteractionTarget(e.target)) return;
      const isMiddleButton = e.button === 1;
      const isLeftPanGesture =
        e.button === 0 && (handToolActive || spacePanActive);
      if (!isMiddleButton && !isLeftPanGesture) return;
      e.preventDefault();
      let lastClientX = e.clientX;
      let lastClientY = e.clientY;
      setIsPanningState(true);

      const handleMouseMove = (ev: MouseEvent) => {
        const scroll = scrollContainerRef.current;
        if (!scroll) return;
        const dx = ev.clientX - lastClientX;
        const dy = ev.clientY - lastClientY;
        lastClientX = ev.clientX;
        lastClientY = ev.clientY;
        // 1:1 drag-scroll, no inertia: dragging right/down moves the
        // viewport left/up over the content, i.e. subtract the pointer delta
        // from scroll position.
        scroll.scrollLeft -= dx;
        scroll.scrollTop -= dy;
      };
      const handlePanEnd = () => {
        setIsPanningState(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handlePanEnd);
        window.removeEventListener("blur", handlePanEnd);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handlePanEnd);
      window.addEventListener("blur", handlePanEnd);
    },
    [handToolActive, spacePanActive],
  );

  // Clicking the empty grey canvas background deselects the current element.
  // Preview-iframe clicks never bubble to the parent document (that path uses
  // postMessage → onClearSelection), so a plain left click that reaches this
  // scroll surface means the user clicked outside the framed preview.
  const handleScrollSurfaceBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isCanvasOverlayInteractionTarget(e.target)) return;
      if (e.button !== 0) return;
      if (handToolActive || spacePanActive) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(".design-canvas-iframe-wrapper")) return;
      onClearSelection?.();
    },
    [handToolActive, spacePanActive, onClearSelection],
  );

  const panCursor = isPanningState
    ? "grabbing"
    : handToolActive || spacePanActive
      ? "grab"
      : null;
  const externalPreviewPendingOrigin = Boolean(
    externalPreviewUrl && !browserOrigin,
  );

  // OS file drag-and-drop (Figma parity §1): the sandboxed iframe sits on top
  // of the wrapper and is a normal DOM element to the parent document's drag
  // events (dragenter/dragover/drop still bubble through it to the wrapper —
  // unlike mouse clicks, an iframe does not need its own listeners to forward
  // these), but relying on that alone is fragile across browsers/sandbox
  // combinations. Track a native-file-drag-in-progress flag via a
  // dragenter/dragleave depth counter (nested elements each fire enter/leave)
  // so a transparent capture overlay — mirroring the SingleScreenCreationOverlay
  // mount pattern above — mounts ONLY while an OS file drag is actually over
  // this wrapper, guaranteeing the drop lands on our own handler instead of
  // being swallowed by the iframe.
  const [nativeFileDragActive, setNativeFileDragActive] = useState(false);
  const nativeFileDragDepthRef = useRef(0);

  const resetNativeFileDragState = useCallback(() => {
    nativeFileDragDepthRef.current = 0;
    setNativeFileDragActive(false);
  }, []);

  const handleWrapperDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isOsFileDragEvent(e)) return;
      e.preventDefault();
      nativeFileDragDepthRef.current += 1;
      setNativeFileDragActive(true);
    },
    [],
  );

  const handleWrapperDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isOsFileDragEvent(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handleWrapperDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isOsFileDragEvent(e)) return;
      nativeFileDragDepthRef.current = Math.max(
        0,
        nativeFileDragDepthRef.current - 1,
      );
      if (nativeFileDragDepthRef.current === 0) {
        setNativeFileDragActive(false);
      }
    },
    [],
  );

  const handleWrapperDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isOsFileDragEvent(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files ?? []);
      resetNativeFileDragState();
      if (files.length === 0 || !onDropFiles) return;
      const iframe = iframeRef.current;
      const rect = iframe?.getBoundingClientRect();
      const screenContentPoint =
        iframe && rect
          ? getScreenContentPointFromClient(
              e.clientX,
              e.clientY,
              rect,
              { width: iframe.clientWidth, height: iframe.clientHeight },
              readIframeScrollOffset(iframe),
            )
          : { x: e.clientX, y: e.clientY };
      onDropFiles(files, { screenContentPoint, screenId });
    },
    [onDropFiles, resetNativeFileDragState, screenId],
  );

  useEffect(() => resetNativeFileDragState, [resetNativeFileDragState]);

  // Wrap the iframe in a positioned container so DrawOverlay /
  // CanvasCommentPins can absolutely-position themselves on top of the
  // iframe. The pin component anchors to `.design-canvas-iframe-wrapper`
  // via canvasSelector.
  //
  // The wrapper carries a faint outline + soft shadow so the frame edge stays
  // visible when a design background matches the editor canvas.
  const iframeElement = (
    <div
      data-review-canvas-id={reviewCanvasId}
      data-node-rewrite-canvas-target={
        nodeRewriteCanvasTarget ? "true" : undefined
      }
      className="design-canvas-iframe-wrapper relative inline-block ring-1 ring-border/60"
      onDragEnter={handleWrapperDragEnter}
      onDragOver={handleWrapperDragOver}
      onDragLeave={handleWrapperDragLeave}
      onDrop={handleWrapperDrop}
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
          : resolvedHeight,
        // BP-DEEP item 2: when a breakpoint chip constrains the viewport
        // (previewWidthPx) the wrapper is NARROWER than the canvas, so there
        // is no horizontal overflow for the scroll-centering effect above to
        // act on — without a layout-level center the frame pins to the
        // canvas's left edge, which reads as broken next to the
        // device-preview control's flex-centered framed modes. Block + auto
        // margins center it in the zoom layer's LAYOUT space, which is safe
        // for the T-zoom-anchor invariant: the margin inset is constant in
        // layer-local coordinates (transform scale never changes layout), so
        // the cursor-anchored zoom math — which only assumes the zoom
        // layer's own top-left corner stays a fixed point in scroll-content
        // space — is untouched. Base editing (previewWidthPx unset) keeps
        // the original inline-block full-width layout unchanged.
        ...(previewWidthPx !== null &&
        previewWidthPx !== undefined &&
        !embeddedFrame
          ? {
              display: "block",
              marginLeft: "auto",
              marginRight: "auto",
            }
          : null),
      }}
    >
      {snapshotOnly && designId && screenId ? (
        <SharedSnapshotPoller
          designId={designId}
          fileId={screenId}
          knownPublishedRevision={
            matchingSharedSnapshot?.publishedRevision ?? null
          }
          active={sharedSnapshotPollActive}
          onSnapshot={handleSharedSnapshot}
        />
      ) : null}
      {desktopNativeSnapshot && desktopNativeSnapshotLayer !== "none" ? (
        <img
          data-desktop-native-preview-snapshot
          data-desktop-native-preview-snapshot-layer={
            desktopNativeSnapshotLayer
          }
          src={desktopNativeSnapshot.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          onLoad={() => desktopNativeSnapshot.acknowledge()}
          className={cn(
            "pointer-events-none absolute inset-0 block size-full select-none object-fill",
            desktopNativeSnapshotLayer === "page" ? "z-[1]" : "z-0",
          )}
        />
      ) : null}
      {snapshotOnly && !iframeRenderContent.trim() ? (
        <div
          data-design-live-canvas-waiting
          role="status"
          className="absolute inset-0 z-10 flex items-center justify-center bg-background/90 px-4 text-center text-sm text-muted-foreground"
        >
          {t("designEditor.liveCanvasWaitingForOwner")}
        </div>
      ) : rawExternalPreviewUrl &&
        !externalPreviewUrl ? null : externalPreviewPendingOrigin ? null : (
        <iframe
          key={iframeElementIdentity}
          ref={iframeRef}
          src={externalPreviewUrl ?? undefined}
          srcDoc={externalPreviewUrl ? undefined : srcdoc}
          sandbox={getDesignCanvasIframeSandbox({
            externalPreview: Boolean(externalPreviewUrl),
            readOnly: readOnly || snapshotOnly,
            snapshotOnly,
            previewUrl: externalPreviewUrl,
            parentOrigin: browserOrigin ?? undefined,
          })}
          allow={getDesignCanvasIframeAllow(externalPreviewUrl)}
          data-design-preview-iframe
          onLoad={(event) => {
            if (!liveEditFrameRequiresBridge) markPreviewFrameReady();
            sendBridgeToContainer();
            event.currentTarget.contentWindow?.postMessage(
              { type: "agent-native:editor-chrome-ready-probe" },
              "*",
            );
            // The bridge logs into the IFRAME console and cannot read
            // import.meta.env, so dev has to switch it on from out here.
            if (!import.meta.env?.DEV) return;
            try {
              const win = event.currentTarget.contentWindow as
                | (Window & { __DND_DEBUG?: boolean })
                | null;
              if (win) win.__DND_DEBUG = true;
              // coercion-ok: a cross-origin preview exposes no contentWindow
            } catch {}
          }}
          {...{
            [SESSION_REPLAY_IFRAME_ATTRIBUTE]: !externalPreviewUrl
              ? ""
              : undefined,
          }}
          data-screen-iframe-id={
            boardSurface ? undefined : (previewFrameId ?? screenId ?? undefined)
          }
          data-design-source-type={
            sourceType ??
            (externalPreviewUrl
              ? "localhost" // inferred — content is a URL
              : "inline")
          }
          className="relative block h-full w-full border-0 bg-transparent"
          style={{
            background: iframeBackgroundColor,
            backgroundColor: iframeBackgroundColor,
            // An inline screen is light unless it says otherwise; inheriting the dark
            // editor's scheme makes Chrome paint an opaque white base under a no-fill frame.
            colorScheme:
              boardSurface || externalPreviewUrl ? undefined : "light",
            pointerEvents:
              liveEditInteractionBlocked || blockPreviewInteraction
                ? "none"
                : undefined,
            ...SCALED_IFRAME_PAINT_RETENTION_STYLE,
            ...getIframePaintRetentionStyle({
              viewportWidth:
                embeddedFrame?.viewportWidth ??
                previewWidthPx ??
                Number.parseFloat(iframeWidth),
              viewportHeight:
                embeddedFrame?.viewportHeight ??
                previewHeightPx ??
                Number.parseFloat(iframeHeight ?? "900px"),
              effectiveScale: embeddedFrame
                ? embeddedPaintScale
                : (zoom / 100) * editorChromeScaleX,
              effectiveScaleY: embeddedFrame
                ? embeddedPaintScale
                : (zoom / 100) * editorChromeScaleY,
            }),
          }}
          title={t("designEditor.designPreview")}
        />
      )}
      {externalPreviewUrl && !previewFrameLoaded ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center gap-2 bg-background px-2 text-muted-foreground">
          <Spinner className="size-4 shrink-0" />
          <span className="truncate !text-[11px] font-medium">
            {t("multiScreenCanvas.preparingLiveEditor")}
          </span>
        </div>
      ) : null}
      {runtimeVerificationUrl && browserOrigin ? (
        <iframe
          key={`${runtimeVerificationUrl}::${runtimeVerificationRequest?.requestId ?? 0}`}
          ref={runtimeVerificationIframeRef}
          src={runtimeVerificationUrl}
          sandbox={getDesignCanvasIframeSandbox({
            externalPreview: true,
            readOnly: true,
            previewUrl: runtimeVerificationUrl,
            parentOrigin: browserOrigin,
          })}
          allow={getDesignCanvasIframeAllow(runtimeVerificationUrl)}
          data-runtime-verification-iframe
          aria-hidden="true"
          tabIndex={-1}
          // scaled-iframe-paint-ignore -- parked off-viewport and never
          // painted, so promoting it to its own composited layer would only
          // cost memory.
          className="pointer-events-none fixed border-0 opacity-0"
          style={{
            left: -100_000,
            top: -100_000,
            width: embeddedFrame?.viewportWidth ?? previewWidthPx ?? 1280,
            height: embeddedFrame?.viewportHeight ?? 900,
          }}
          title=""
        />
      ) : null}
      {/* Single-screen click-to-place creation overlay — sits over the
          iframe, NOT inside it, mirroring the SharedDrawOverlay pattern
          below. Only mounts while a creation tool is active so it never
          changes existing behavior otherwise (T14: single-screen mode
          previously had no creation capability at all). */}
      {activeCreationTool && !interactMode ? (
        <SingleScreenCreationOverlay
          tool={activeCreationTool}
          iframeRef={iframeRef}
          selectedPenPathNodeId={selectedPenPathNodeId}
          onCreatePrimitive={onCreatePrimitive}
          onUpdatePenPath={onUpdatePenPath}
        />
      ) : null}
      {/* OS file drag-over capture overlay — sits over the iframe, NOT
          inside it, mirroring the SingleScreenCreationOverlay mount pattern
          just above. Only mounts while a native OS file drag is actually in
          progress over this wrapper (see handleWrapperDragEnter/Leave), so it
          never changes existing pointer/click behavior otherwise. Skipped
          while a creation tool is active — the two capture surfaces would
          otherwise compete for the same pointer gestures, and an in-app
          creation-tool drag is never simultaneously an OS file drag. */}
      {nativeFileDragActive && !activeCreationTool ? (
        <div
          data-design-canvas-file-drop-overlay
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)]/5"
        >
          <div className="rounded-md border bg-background/95 px-3 py-2 text-xs font-medium text-foreground shadow-sm">
            {
              "Drop to add to this screen" /* i18n-ignore transient OS-drag overlay, mirrors other short drop-hint literals in this file */
            }
          </div>
        </div>
      ) : null}
      {liveEditSameInstanceStalledError?.bridgeKey === liveEditBridgeKey ? (
        // Non-destructive counterpart to the registration-failure card below:
        // the same-instance-id escalation loop in handleSuspectedBridgeRestart
        // hit its ceiling, but /health confirmed the bridge process is still
        // the one we registered with — registeredLiveEditBridgeKey was never
        // nulled, so the iframe underneath is still the real, still-loading
        // document rather than the blank placeholder. Render as a small
        // floating banner (not an opaque full-cover overlay like the cards
        // below) so that still-loading iframe stays visible, and a late
        // agent-native:editor-chrome-ready handshake clears this card (see
        // the message-handler branch above) even after this point.
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[28rem] flex-col items-center gap-2 rounded-md border bg-card px-4 py-3 shadow-sm">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <IconPlugConnectedX className="size-4 shrink-0 text-destructive" />
              {
                "Live editor connection failed" /* i18n-ignore local dev bridge same-instance stall title, mirrors the registration-failure card's copy */
              }
            </div>
            <div className="text-xs text-muted-foreground">
              {
                "Is the local dev server still running?" /* i18n-ignore local dev bridge same-instance stall subtitle */
              }
            </div>
            <div className="w-full truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {liveEditSameInstanceStalledError.message}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualLiveEditSameInstanceRetry}
            >
              <IconRefresh className="size-3.5" />
              {"Retry" /* i18n-ignore local dev bridge retry button */}
            </Button>
          </div>
        </div>
      ) : null}
      {showProactiveLocalNetworkAccessPrompt ? (
        <LocalNetworkAccessPrompt
          kind={bridgeRegistrationFailureKind ?? "maybePermissionBlocked"}
          connecting={connectingLocalNetworkAccess}
          onConnect={handleConnectLocalNetworkAccess}
          onDismiss={handleDismissLocalNetworkAccessPrompt}
          proactive
        />
      ) : null}
      {bridgeRegistrationFailedForCurrentKey &&
      !showProactiveLocalNetworkAccessPrompt &&
      localNetworkAccessDismissedForKey !== liveEditBridgeKey ? (
        // Deliberately NOT inside the blocking overlay below: usingRawFallback
        // Preview means the iframe right underneath is the real running dev
        // server, so this stays a small, dismissible corner card rather than
        // hiding working content behind an indefinite "preparing" screen.
        <LocalNetworkAccessPrompt
          kind={bridgeRegistrationFailureKind ?? "maybePermissionBlocked"}
          connecting={connectingLocalNetworkAccess}
          onConnect={handleConnectLocalNetworkAccess}
          onDismiss={handleDismissLocalNetworkAccessPrompt}
        />
      ) : null}
      {waitingForEditableExternalSnapshot ||
      liveEditBridgeConfigurationPending ||
      (waitingForLiveEditBridge && !bridgeRegistrationFailedForCurrentKey) ||
      sameOriginBridgePending ||
      (liveEditDocumentPending &&
        liveEditSameInstanceStalledError?.bridgeKey !== liveEditBridgeKey) ||
      liveEditRegistrationFailurePending ? (
        <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-background/85 px-4 text-center text-sm text-muted-foreground">
          {bridgeConnectionLostError?.bridgeKey === liveEditBridgeKey ? (
            // handleSuspectedBridgeRestart's destructive terminal state (see
            // bridgeConnectionLostError's declaration comment): the
            // registration itself succeeded, so unlike the floating
            // LocalNetworkAccessPrompt card above there's no raw dev-server
            // fallback to show underneath — the live document is what
            // stopped responding, not the fetch. Keeps its original
            // full-cover card and copy, unchanged from before this PR.
            <div className="pointer-events-auto flex max-w-[28rem] flex-col items-center gap-2 rounded-md border bg-card px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <IconPlugConnectedX className="size-4 shrink-0 text-destructive" />
                {
                  "Live editor connection failed" /* i18n-ignore local dev bridge registration failure title */
                }
              </div>
              <div className="text-xs text-muted-foreground">
                {
                  "Is the local dev server still running?" /* i18n-ignore local dev bridge registration failure subtitle */
                }
              </div>
              <div className="w-full truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {bridgeConnectionLostError.message}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleConnectLocalNetworkAccess}
              >
                <IconRefresh className="size-3.5" />
                {"Retry" /* i18n-ignore local dev bridge retry button */}
              </Button>
            </div>
          ) : bridgeRegistrationFailedForCurrentKey ? (
            <div className="pointer-events-auto flex max-w-[28rem] flex-col items-center gap-2 rounded-md border bg-card px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <IconPlugConnectedX className="size-4 shrink-0 text-destructive" />
                {
                  "Live editing is waiting for a connection" /* i18n-ignore blocked localhost edit state */
                }
              </div>
              <div className="text-xs text-muted-foreground">
                {
                  "The running app is shielded until Design connects to the local bridge." /* i18n-ignore blocked localhost edit state */
                }
              </div>
              {bridgeRegistrationError?.message ? (
                <div className="w-full truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {bridgeRegistrationError.message}
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleConnectLocalNetworkAccess}
                disabled={connectingLocalNetworkAccess}
              >
                <IconRefresh className="size-3.5" />
                {
                  connectingLocalNetworkAccess
                    ? "Connecting…"
                    : "Retry" /* i18n-ignore blocked localhost edit retry */
                }
              </Button>
            </div>
          ) : waitingForLiveEditBridge ||
            sameOriginBridgePending ||
            liveEditDocumentPending ||
            liveEditBridgeConfigurationPending ? (
            <div className="max-w-[28rem] rounded-md border bg-card px-4 py-3 shadow-sm">
              {
                "Preparing live editor..." /* i18n-ignore transient localhost live-edit bridge loading state */
              }
            </div>
          ) : externalSnapshotState?.status === "error" ? (
            // A real offline dev server previously looked identical to the
            // ordinary "still loading" state and retried forever on a fixed
            // 1.5s timer — see getSnapshotRetryDelayMs for the backoff that
            // now paces the auto-retry loop. Surface the actual failure here
            // (network error / non-2xx / bridge error message) plus a manual
            // retry action so the user isn't staring at an unexplained
            // eternal spinner.
            <div className="pointer-events-auto flex max-w-[28rem] flex-col items-center gap-2 rounded-md border bg-card px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <IconPlugConnectedX className="size-4 shrink-0 text-destructive" />
                {
                  "Local dev server unreachable" /* i18n-ignore local dev bridge offline title */
                }
              </div>
              <div className="text-xs text-muted-foreground">
                {
                  "Is it still running?" /* i18n-ignore local dev bridge offline subtitle */
                }
              </div>
              {externalSnapshotState.message ? (
                <div className="w-full truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {externalSnapshotState.message}
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleManualSnapshotRetry}
              >
                <IconRefresh className="size-3.5" />
                {"Retry" /* i18n-ignore local dev bridge retry button */}
              </Button>
            </div>
          ) : (
            <div className="max-w-[28rem] rounded-md border bg-card px-4 py-3 shadow-sm">
              {
                "Preparing editable preview..." /* i18n-ignore local dev snapshot status */
              }
            </div>
          )}
        </div>
      ) : null}
      {/* Draw-to-prompt overlay — sits over the iframe, NOT inside it. */}
      <SharedDrawOverlay
        visible={!!drawMode}
        clearSignal={drawOverlayResetSignal}
        scopeKey={screenId}
        retainSurfaceWhenHidden={retainDrawOverlayWhenHidden}
        canvasInteractive={!pinMode}
        queuedAnnotationCount={0}
        zoom={zoom}
        sending={annotationCaptureBusy}
        onClose={() => onExitDrawMode?.()}
        onSend={(annotations, instruction, canvasSize) => {
          if (annotationCaptureBusyRef.current) return;
          const summary = annotations
            .map((a) =>
              a.type === "path"
                ? `[stroke ${a.color} w=${a.lineWidth}] ${a.pathData}`
                : `[label "${a.text}" at ${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}]`,
            )
            .join("\n");
          const lines = [
            `[Annotations on design ${designId || ""}${designTitle ? ` (${designTitle})` : ""}]`,
            `Canvas size: ${canvasSize.width.toFixed(0)}x${canvasSize.height.toFixed(0)}`,
            ...(summary ? ["", "[Drawing]", summary] : []),
            "",
            instruction || "Apply these annotations to the design.",
          ];
          const message = lines.join("\n");

          // Best-effort: render the annotated screen + composited drawing as
          // ONE image the agent can see (see design-canvas/annotation-snapshot.ts),
          // then send it alongside the existing text summary in the same chat
          // turn. Never blocks or drops the annotation — any capture failure
          // (no Chromium in hosted deploys, network blip, upload not
          // configured, timeout) silently resolves to `null` and the message
          // still goes out text-only, exactly as it did before this feature.
          annotationCaptureBusyRef.current = true;
          setAnnotationCaptureBusy(true);
          onAnnotationSendingChange?.(true);
          void captureAnnotatedScreenshot({
            designId,
            fileId: screenId,
            sourceType:
              sourceType ?? (externalPreviewUrl ? "localhost" : "inline"),
            annotations,
            canvasSize,
          })
            .catch(() => null)
            .then((imageUrl) =>
              submitDesignAnnotations({
                message,
                hasQueuedPins: false,
                // Ack-confirmed send: only exit draw mode / mark pins
                // submitted once the message is CONFIRMED to have reached
                // the chat (became a visible turn). A fire-and-forget send
                // here would let the overlay tear down and the pins clear
                // even when delivery is silently dropped — e.g. no LLM/agent
                // engine configured, or the panel never finished mounting —
                // discarding the user's drawing with no way to retry it.
                send: async (message) => {
                  const result = await sendToDesignAgentChatAndConfirm({
                    message,
                    images: imageUrl ? [imageUrl] : undefined,
                    submit: true,
                    openSidebar: true,
                  });
                  if (!result.delivered) {
                    throw new Error(
                      `Annotation message was not delivered to the agent chat (${result.reason ?? "unknown"})`,
                    );
                  }
                },
                markQueuedPinsSubmitted: () => {},
                exitDrawMode: () => onExitDrawMode?.(),
                onError: (error) => {
                  console.error(
                    "[DesignCanvas] failed to submit drawing:",
                    error,
                  );
                  toast.error(t("designEditor.toasts.annotationSendError"));
                },
              }),
            )
            .finally(() => {
              annotationCaptureBusyRef.current = false;
              setAnnotationCaptureBusy(false);
              onAnnotationSendingChange?.(false);
            });
        }}
      />
    </div>
  );

  const reviewCanvasPins =
    designId && (screenId || commentContextId) ? (
      <ReviewCanvasPins
        active={!!pinMode}
        hidden={commentPinsHidden}
        onClose={() => onExitPinMode?.()}
        canvasSelector={`[data-review-canvas-id="${reviewCanvasId}"]`}
        resourceType="design"
        resourceId={designId}
        targetId={
          reviewTargetId !== undefined
            ? reviewTargetId
            : (screenId ?? commentContextId ?? null)
        }
        screenId={screenId}
        boardGeometry={reviewBoardGeometry}
        onFocusBoardPoint={onReviewFocusBoardPoint}
        canPost={reviewCanPost}
        canResolve={reviewCanResolve}
        currentUserEmail={reviewCurrentUserEmail}
        focusRequest={reviewFocusRequest}
        onDispatchCommentToAgent={onDispatchCommentToAgent}
        onSendThreadToAgent={onSendThreadToAgent}
        sendingThreadId={reviewSendingThreadId}
        sourceType={sourceType ?? (externalPreviewUrl ? "localhost" : "inline")}
        sourceVersionHash={sourceContentHash(content)}
        repromptDraftRequest={repromptDraftRequest}
        onRepromptDraftConsumed={onRepromptDraftConsumed}
      />
    ) : null;

  if (embeddedFrame) {
    if (embeddedFrameFluid) {
      return (
        <div
          ref={scrollContainerRef}
          tabIndex={-1}
          onPointerEnter={focusScrollSurface}
          onMouseEnter={focusScrollSurface}
          className="relative h-full w-full overflow-clip"
        >
          {iframeElement}
          {reviewCanvasPins}
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
        tabIndex={-1}
        onPointerEnter={focusScrollSurface}
        onMouseEnter={focusScrollSurface}
        className="relative h-full w-full overflow-clip"
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
        {reviewCanvasPins}
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
      tabIndex={-1}
      onPointerEnter={focusScrollSurface}
      onMouseEnter={focusScrollSurface}
      onMouseDown={handleScrollSurfaceMouseDown}
      onClick={handleScrollSurfaceBackgroundClick}
      className="relative flex-1 h-full overflow-auto"
      style={{ cursor: panCursor || undefined }}
    >
      {/* Canvas area. "none" mode fills the canvas (responsive preview);
          framed modes are centered inside the canvas with zoom applied. */}
      {centerInteractPreview ? (
        <div
          ref={zoomSizeLayerRef}
          className="relative flex min-h-full min-w-full items-center justify-center"
          style={{ justifyContent: "safe center", alignItems: "safe center" }}
        >
          <div
            className="shrink-0"
            style={{
              width:
                previewWidthPx === undefined
                  ? undefined
                  : previewWidthPx * (zoom / 100),
              height:
                previewHeightPx === undefined
                  ? undefined
                  : previewHeightPx * (zoom / 100),
            }}
          >
            <div
              ref={zoomLayerRef}
              style={{
                transform: getSingleScreenZoomTransform(
                  zoom,
                  deviceFrame,
                  centerInteractPreview,
                ),
                transformOrigin: "top left",
              }}
            >
              {wrappedContent}
            </div>
          </div>
        </div>
      ) : deviceFrame === "none" ? (
        <div
          ref={zoomLayerRef}
          className="relative h-full w-full"
          style={{
            // T-zoom-anchor: transform-origin MUST be top-left here (not
            // center-center) to match usePinchZoom's documented contract
            // ("Assumes the scaled content uses transform-origin: top left
            // ... Disable for layouts with transform-origin: center center")
            // and the pinch-zoom-wheel bridge-forwarded handler above, both of
            // which compute the cursor-anchored scroll delta assuming the
            // scaled box's own top-left corner is a fixed point in
            // scroll-content space. Centering this box via flexbox instead
            // (the previous approach) re-centers the *painted* box around the
            // container's center on every zoom change, which moves that
            // "fixed" point every time the box's rendered size changes —
            // exactly the invariant the cursor-anchor math depends on, so
            // Cmd/Ctrl+wheel or pinch zoom would drift away from the cursor.
            // Initial centering (and re-centering on a content/screen swap)
            // is instead handled by imperatively setting scrollLeft/scrollTop
            // once — see the effect keyed on [deviceFrame, contentKey] above
            // usePinchZoom — so the layout itself stays simple and
            // top-left-anchored while still looking centered at rest.
            //
            // BP-DEEP v2 item 5 — zoom-out must anchor CENTER: below 100%
            // the painted layer is SMALLER than the container, so there is
            // no scrollable overflow and the old transform shrank the canvas
            // toward the container's top-left corner. The translate() below
            // (only nonzero when zoom < 100) re-centers the painted layer in
            // both axes. This cannot break the cursor-anchor math above:
            // translate percentages resolve against the layer's LAYOUT box
            // (constant, zoom-independent), and in the sub-100% regime where
            // the offset is nonzero the container has no overflow — the
            // anchor math's scroll deltas clamp to 0 regardless — while at
            // >= 100% the offset is exactly 0 and the original top-left
            // contract holds verbatim. The offset is also continuous at
            // 100% (0), so crossing the boundary mid-gesture cannot jump.
            transform: getSingleScreenZoomTransform(
              zoom,
              deviceFrame,
              centerInteractPreview,
            ),
            transformOrigin: "top left",
          }}
        >
          {wrappedContent}
        </div>
      ) : (
        <div className="relative flex items-center justify-center min-h-full">
          <div
            ref={zoomLayerRef}
            style={{
              transform: getSingleScreenZoomTransform(
                zoom,
                deviceFrame,
                centerInteractPreview,
              ),
              transformOrigin: "center center",
            }}
          >
            {wrappedContent}
          </div>
        </div>
      )}

      {reviewCanvasPins}
    </div>
  );
}

/** Minimum pointer movement (in viewport/client px) before a pointerdown→up
 *  gesture counts as a drag instead of a click. Matches the small-threshold
 *  click-vs-drag convention used elsewhere in the editor (e.g. marquee-vs-
 *  click hit-testing) rather than MultiScreenCanvas's own canvas-space
 *  threshold, since this overlay only ever sees viewport-space pointer
 *  events. */
const CREATION_CLICK_MOVE_THRESHOLD_PX = 4;

/** Default click-to-place sizes, in screen-content px, for tools that need a
 *  sensible size when the user clicks instead of drags. Mirrors
 *  MultiScreenCanvas's own DRAFT_*_WIDTH/HEIGHT defaults closely enough for
 *  single-screen placement (kept local — those constants aren't exported). */
const CREATION_DEFAULT_SIZE: Record<
  Exclude<CreationTool, "line" | "arrow" | "pen">,
  { width: number; height: number }
> = {
  rectangle: { width: 160, height: 100 },
  ellipse: { width: 120, height: 120 },
  text: { width: 160, height: 32 },
  // Figma's frame-tool click default is a 100x100 frame.
  frame: { width: 100, height: 100 },
};

/** Default line/arrow length (screen-content px) for a click (no drag). */
const CREATION_DEFAULT_LINE_LENGTH = 120;

interface CreationDragState {
  tool: CreationTool;
  /** Screen-content coordinates of the initial pointerdown. */
  startContent: { x: number; y: number };
  /** Screen-content coordinates of the latest pointer position. */
  currentContent: { x: number; y: number };
  /** Viewport (client) coordinates of the initial pointerdown — kept
   *  alongside startContent so the click-vs-drag movement threshold can be
   *  measured in client space (a constant visual distance regardless of
   *  zoom) without re-deriving it from content-space coordinates. */
  startClient: { x: number; y: number };
  pointerId: number;
  moved: boolean;
}

interface SingleScreenPenGestureState {
  pointerId: number;
  originClient: { x: number; y: number };
  anchor: PenPoint;
  pathBefore: PenPath | null;
  moved: boolean;
  closing: boolean;
  cuspLatch: PenCuspLatch;
}

const SINGLE_SCREEN_PEN_HIT_RADIUS_PX = 10;

interface SingleScreenCreationOverlayProps {
  tool: CreationTool;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  selectedPenPathNodeId?: string | null;
  onCreatePrimitive?: (spec: CreatePrimitiveSpec) => string | false | void;
  onUpdatePenPath?: (
    nodeId: string,
    path: PenPath,
    nextTool?: "move",
  ) => boolean;
}

/**
 * Figma-style click-to-place creation overlay for single-screen mode.
 *
 * Mounts a transparent, `pointer-events: auto` surface above the iframe
 * (matching the `SharedDrawOverlay` mount pattern) that intercepts pointer
 * gestures instead of letting them reach the iframe's own content/editor-
 * chrome bridge. A pointerdown→move→up past `CREATION_CLICK_MOVE_THRESHOLD_PX`
 * is treated as a drag (draws a rect/line via `getDraftGeometryFromPoints`,
 * the same helper MultiScreenCanvas uses for overview drafts); a
 * pointerdown→up with negligible movement is treated as a click (places a
 * default-sized primitive). Pen owns a stateful path until the user presses
 * Enter/Escape, double-clicks, closes on the first anchor, or chooses another
 * tool. Clicks add corner anchors; pointer drags add Bezier handles; primary
 * undo/Delete/Backspace remove the latest active segment. This mirrors the
 * overview pen workflow without forcing a mode switch.
 */
function SingleScreenCreationOverlay({
  tool,
  iframeRef,
  selectedPenPathNodeId,
  onCreatePrimitive,
  onUpdatePenPath,
}: SingleScreenCreationOverlayProps) {
  const [drag, setDrag] = useState<CreationDragState | null>(null);
  const dragRef = useRef<CreationDragState | null>(null);
  const [penPath, setPenPath] = useState<PenPath | null>(null);
  const penPathRef = useRef<PenPath | null>(null);
  const continuationPenPathRef = useRef<{
    nodeId: string;
    path: PenPath;
  } | null>(null);

  const seedSelectedPenContinuation = useCallback(() => {
    if (
      tool !== "pen" ||
      !selectedPenPathNodeId ||
      penPathRef.current ||
      continuationPenPathRef.current
    ) {
      return;
    }
    const document = iframeRef.current?.contentDocument;
    if (!document) return;
    const element = Array.from(
      document.querySelectorAll<SVGElement>("[data-agent-native-node-id]"),
    ).find(
      (candidate) =>
        candidate.getAttribute("data-agent-native-node-id") ===
        selectedPenPathNodeId,
    );
    const sourceElement =
      element?.closest<SVGElement>("[data-an-pen-nodes]") ??
      (document.querySelectorAll<SVGElement>("[data-an-pen-nodes]").length === 1
        ? document.querySelector<SVGElement>("[data-an-pen-nodes]")
        : null);
    const serialized = sourceElement?.getAttribute("data-an-pen-nodes");
    const path = serialized ? parsePenNodes(serialized) : null;
    if (!path || path.closed || path.nodes.length < 2) return;
    const svg = sourceElement?.closest("svg");
    const offset = svg ? penPathScreenContentOffset(svg) : null;
    if (!offset) return;
    continuationPenPathRef.current = {
      nodeId: selectedPenPathNodeId,
      path: translatePenPath(path, offset.x, offset.y),
    };
  }, [iframeRef, selectedPenPathNodeId, tool]);

  useEffect(() => {
    seedSelectedPenContinuation();
  }, [seedSelectedPenContinuation]);
  const [penGesturePreview, setPenGesturePreview] = useState<PenPath | null>(
    null,
  );
  const penGestureRef = useRef<SingleScreenPenGestureState | null>(null);
  const penOverlayRef = useRef<HTMLDivElement>(null);
  const [penPointer, setPenPointer] = useState<PenPoint | null>(null);
  const [penCloseHover, setPenCloseHover] = useState(false);

  // Returns the click/pointer point in SCREEN-CONTENT (document-absolute)
  // coordinates — the same "screen's own pixel coordinate system" contract
  // `onCreatePrimitive` documents, which already folds in the embedded
  // screen's own internal scroll (see `getScreenContentPointFromClient`).
  // Anything that renders these points directly as this overlay's own CSS
  // position (the drag/line preview below, and `SingleScreenPenPathOverlay`)
  // must convert back to overlay-local (viewport-relative) coordinates by
  // subtracting the same scroll offset — the overlay itself never scrolls
  // with the embedded screen's internal document, it only tracks the
  // iframe's host-page box.
  const toContentPoint = useCallback(
    (clientX: number, clientY: number) => {
      const iframe = iframeRef.current;
      const rect = iframe?.getBoundingClientRect();
      if (!iframe || !rect) return { x: clientX, y: clientY };
      return getScreenContentPointFromClient(
        clientX,
        clientY,
        rect,
        { width: iframe.clientWidth, height: iframe.clientHeight },
        readIframeScrollOffset(iframe),
      );
    },
    [iframeRef],
  );

  const penHitRadius = useCallback(() => {
    const iframe = iframeRef.current;
    const rect = iframe?.getBoundingClientRect();
    if (!iframe || !rect || iframe.clientWidth <= 0) {
      return SINGLE_SCREEN_PEN_HIT_RADIUS_PX;
    }
    const scale = rect.width / iframe.clientWidth;
    return SINGLE_SCREEN_PEN_HIT_RADIUS_PX / (scale || 1);
  }, [iframeRef]);

  const updatePenPath = useCallback((nextPath: PenPath | null) => {
    penPathRef.current = nextPath;
    setPenPath(nextPath);
  }, []);

  const clearPenPath = useCallback(() => {
    const gesture = penGestureRef.current;
    penGestureRef.current = null;
    if (
      gesture &&
      penOverlayRef.current?.hasPointerCapture(gesture.pointerId)
    ) {
      penOverlayRef.current.releasePointerCapture(gesture.pointerId);
    }
    updatePenPath(null);
    setPenGesturePreview(null);
    setPenPointer(null);
    setPenCloseHover(false);
  }, [updatePenPath]);

  const finishPenPath = useCallback(
    (
      path: PenPath | null = penPathRef.current,
      options?: {
        preserveActiveTool?: boolean;
        continueAfterCommit?: boolean;
        nextTool?: "move" | "pen";
      },
    ) => {
      const committed = path ? clonePenPath(path) : null;
      if (!committed || committed.nodes.length < 2) {
        clearPenPath();
        return;
      }

      const continuation = continuationPenPathRef.current;
      if (continuation) {
        const updated = onUpdatePenPath?.(
          continuation.nodeId,
          committed,
          options?.preserveActiveTool === false ? "move" : undefined,
        );
        if (!updated) {
          updatePenPath(committed);
          setPenGesturePreview(null);
          return;
        }
        continuationPenPathRef.current =
          committed.closed || !options?.continueAfterCommit
            ? null
            : { ...continuation, path: committed };
      } else {
        if (!onCreatePrimitive) {
          clearPenPath();
          return;
        }
        clearPenPath();
        const nodeId = onCreatePrimitive({
          tool: "pen",
          points: committed.nodes.map((node) => node.point),
          penPath: committed,
          fromClick: false,
          preserveActiveTool: options?.preserveActiveTool,
          nextTool: options?.nextTool,
        });
        if (nodeId === false) {
          updatePenPath(committed);
          return;
        }
        continuationPenPathRef.current =
          typeof nodeId === "string" &&
          !committed.closed &&
          options?.continueAfterCommit
            ? { nodeId, path: committed }
            : null;
        return;
      }
      clearPenPath();
    },
    [clearPenPath, onCreatePrimitive, onUpdatePenPath, updatePenPath],
  );

  const getPenAnchor = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      const point = toContentPoint(clientX, clientY);
      const path = penPathRef.current;
      const lastAnchor = path?.nodes[path.nodes.length - 1]?.point;
      return shiftKey && lastAnchor
        ? constrainPointTo45Degrees(lastAnchor, point)
        : point;
    },
    [toContentPoint],
  );

  const updatePenPointer = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      const path = penPathRef.current;
      if (!path || path.closed) {
        setPenPointer(null);
        setPenCloseHover(false);
        return;
      }
      const rawPoint = toContentPoint(clientX, clientY);
      const closeHover = isPenCloseTarget(path, rawPoint, penHitRadius());
      setPenCloseHover(closeHover);
      setPenPointer(
        closeHover
          ? path.nodes[0]!.point
          : getPenAnchor(clientX, clientY, shiftKey),
      );
    },
    [getPenAnchor, penHitRadius, toContentPoint],
  );

  const previousToolRef = useRef(tool);
  useEffect(() => {
    const previousTool = previousToolRef.current;
    previousToolRef.current = tool;
    if (previousTool === "pen" && tool !== "pen") {
      finishPenPath(penPathRef.current, { preserveActiveTool: true });
      if (!penPathRef.current) continuationPenPathRef.current = null;
    }
  }, [finishPenPath, tool]);

  const emit = useCallback(
    (state: CreationDragState) => {
      if (!onCreatePrimitive) return;
      const { tool: activeTool, startContent, currentContent, moved } = state;

      if (activeTool === "line" || activeTool === "arrow") {
        const end = moved
          ? currentContent
          : {
              x: startContent.x + CREATION_DEFAULT_LINE_LENGTH,
              y: startContent.y,
            };
        onCreatePrimitive({
          tool: activeTool,
          points: [startContent, end],
          fromClick: !moved,
        });
        return;
      }

      // Pen commits through finishPenPath after collecting multiple gestures.
      if (activeTool === "pen") return;

      if (!moved) {
        const size = CREATION_DEFAULT_SIZE[activeTool];
        onCreatePrimitive({
          tool: activeTool,
          rect: {
            x: startContent.x,
            y: startContent.y,
            width: size.width,
            height: size.height,
          },
          fromClick: true,
        });
        return;
      }

      const geometry = getDraftGeometryFromPoints(
        startContent,
        currentContent,
        {
          minWidth: activeTool === "text" ? 24 : 8,
          minHeight: activeTool === "text" ? 18 : 8,
          defaultWidth: CREATION_DEFAULT_SIZE[activeTool].width,
          defaultHeight: CREATION_DEFAULT_SIZE[activeTool].height,
        },
      );
      onCreatePrimitive({
        tool: activeTool,
        rect: geometry,
        fromClick: false,
      });
    },
    [onCreatePrimitive],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (tool === "pen") {
        e.preventDefault();
        e.stopPropagation();
        seedSelectedPenContinuation();
        const currentPath = penPathRef.current?.closed
          ? null
          : penPathRef.current;
        const pathBefore = currentPath ? clonePenPath(currentPath) : null;
        const rawPoint = toContentPoint(e.clientX, e.clientY);
        if (!pathBefore && continuationPenPathRef.current) {
          const continuation = continuationPenPathRef.current;
          const resumed =
            selectedPenPathNodeId === undefined ||
            selectedPenPathNodeId === continuation.nodeId
              ? resumePenPathAtEnd(continuation.path, rawPoint, penHitRadius())
              : null;
          if (resumed) {
            updatePenPath(resumed);
            setPenGesturePreview(null);
            setPenPointer(null);
            setPenCloseHover(false);
            return;
          }
          continuationPenPathRef.current = null;
        }
        const closing = isPenCloseTarget(pathBefore, rawPoint, penHitRadius());
        const anchor = closing
          ? pathBefore!.nodes[0]!.point
          : getPenAnchor(e.clientX, e.clientY, e.shiftKey);
        penGestureRef.current = {
          pointerId: e.pointerId,
          originClient: { x: e.clientX, y: e.clientY },
          anchor,
          pathBefore,
          moved: false,
          closing,
          cuspLatch: createPenCuspLatch(),
        };
        const initialPath = closing
          ? closePenPath(pathBefore!)
          : appendPenNode(pathBefore, createCornerNode(anchor));
        updatePenPath(initialPath);
        setPenGesturePreview(initialPath);
        setPenPointer(null);
        setPenCloseHover(closing);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const point = toContentPoint(e.clientX, e.clientY);
      const next: CreationDragState = {
        tool,
        startContent: point,
        currentContent: point,
        startClient: { x: e.clientX, y: e.clientY },
        pointerId: e.pointerId,
        moved: false,
      };
      dragRef.current = next;
      setDrag(next);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [
      finishPenPath,
      getPenAnchor,
      penHitRadius,
      seedSelectedPenContinuation,
      selectedPenPathNodeId,
      tool,
      toContentPoint,
      updatePenPath,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (tool === "pen") {
        const gesture = penGestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) {
          updatePenPointer(e.clientX, e.clientY, e.shiftKey);
          return;
        }
        const moved =
          gesture.moved ||
          Math.hypot(
            e.clientX - gesture.originClient.x,
            e.clientY - gesture.originClient.y,
          ) > CREATION_CLICK_MOVE_THRESHOLD_PX;
        gesture.moved = moved;
        const rawHandle = toContentPoint(e.clientX, e.clientY);
        const handleOut = e.shiftKey
          ? constrainPointTo45Degrees(gesture.anchor, rawHandle)
          : rawHandle;
        const nextPath = gesture.closing
          ? shapeClosingHandles(gesture.pathBefore!, moved ? handleOut : null)
          : appendPenNode(
              gesture.pathBefore,
              moved
                ? createPenDragNode(
                    gesture.anchor,
                    handleOut,
                    gesture.cuspLatch,
                    e.altKey,
                  )
                : createCornerNode(gesture.anchor),
            );
        updatePenPath(nextPath);
        setPenGesturePreview(nextPath);
        return;
      }
      const current = dragRef.current;
      if (!current || current.pointerId !== e.pointerId) return;
      // Movement threshold measured in client (viewport) space — a constant
      // visual distance regardless of zoom — rather than screen-content
      // space, which would need dividing by scale to mean the same thing at
      // every zoom level.
      const movedPastThreshold =
        Math.hypot(
          e.clientX - current.startClient.x,
          e.clientY - current.startClient.y,
        ) > CREATION_CLICK_MOVE_THRESHOLD_PX;
      const point = toContentPoint(e.clientX, e.clientY);
      const next: CreationDragState = {
        ...current,
        currentContent: point,
        moved: current.moved || movedPastThreshold,
      };
      dragRef.current = next;
      setDrag(next);
    },
    [tool, toContentPoint, updatePenPath, updatePenPointer],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (tool === "pen") {
        const gesture = penGestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        const moved =
          gesture.moved ||
          Math.hypot(
            e.clientX - gesture.originClient.x,
            e.clientY - gesture.originClient.y,
          ) > CREATION_CLICK_MOVE_THRESHOLD_PX;
        const rawHandle = toContentPoint(e.clientX, e.clientY);
        const handleOut = e.shiftKey
          ? constrainPointTo45Degrees(gesture.anchor, rawHandle)
          : rawHandle;
        const nextPath = gesture.closing
          ? shapeClosingHandles(gesture.pathBefore!, moved ? handleOut : null)
          : appendPenNode(
              gesture.pathBefore,
              moved
                ? createPenDragNode(
                    gesture.anchor,
                    handleOut,
                    gesture.cuspLatch,
                    e.altKey,
                  )
                : createCornerNode(gesture.anchor),
            );
        penGestureRef.current = null;
        setPenGesturePreview(null);
        setPenPointer(null);
        setPenCloseHover(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (gesture.closing) {
          finishPenPath(nextPath, { preserveActiveTool: true });
        } else {
          updatePenPath(nextPath);
        }
        return;
      }
      const current = dragRef.current;
      if (!current || current.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      emit(current);
    },
    [emit, finishPenPath, tool, toContentPoint, updatePenPath],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (tool === "pen") {
        const gesture = penGestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        penGestureRef.current = null;
        updatePenPath(gesture.pathBefore);
        setPenGesturePreview(null);
        setPenPointer(null);
        setPenCloseHover(false);
        return;
      }
      const current = dragRef.current;
      if (!current || current.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setDrag(null);
    },
    [tool, updatePenPath],
  );

  useEffect(() => {
    if (tool !== "pen") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const path = penPathRef.current;
      if (!path) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }

      const primary = event.metaKey || event.ctrlKey;
      const undo =
        primary && !event.shiftKey && event.key.toLowerCase() === "z";
      const removeSegment =
        !primary && (event.key === "Delete" || event.key === "Backspace");
      if (undo || removeSegment) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (penGestureRef.current) return;
        const remainingNodes = path.nodes.slice(0, -1);
        if (remainingNodes.length === 0) {
          clearPenPath();
        } else {
          updatePenPath({ nodes: remainingNodes, closed: false });
          setPenGesturePreview(null);
          setPenPointer(null);
          setPenCloseHover(false);
        }
        return;
      }

      if (primary || (event.key !== "Enter" && event.key !== "Escape")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === "Escape" && penGestureRef.current) {
        clearPenPath();
        return;
      }
      const continuesExistingPath =
        event.key === "Enter" && continuationPenPathRef.current !== null;
      finishPenPath(path, {
        preserveActiveTool: event.key === "Escape" || continuesExistingPath,
        continueAfterCommit: continuesExistingPath,
        nextTool:
          event.key === "Enter"
            ? continuesExistingPath
              ? "pen"
              : "move"
            : undefined,
      });
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [clearPenPath, finishPenPath, tool, updatePenPath]);

  const cursorClass = tool === "text" ? "cursor-text" : "cursor-crosshair";
  const isLineTool = tool === "line" || tool === "arrow";
  const displayedPenPath =
    penGesturePreview ??
    (penPath && penPointer
      ? penCloseHover
        ? closePenPath(penPath)
        : appendPenNode(penPath, createCornerNode(penPointer))
      : penPath);

  // Live drag preview, converted back from screen-content space to the
  // overlay's own (unscaled, layout-space) coordinates. The overlay div is
  // sized to the iframe's layout box (via inset-0 on a wrapper that already
  // matches iframe.clientWidth/Height 1:1 before the outer zoom transform),
  // so screen-content coordinates equal this overlay's local coordinates
  // when the screen is unscrolled — no extra scale conversion is needed for
  // the preview's own CSS position. When the embedded screen IS scrolled,
  // `drag.startContent`/`currentContent` (from `toContentPoint`) carry that
  // scroll baked in (screen-content space is document-absolute, per
  // `onCreatePrimitive`'s contract), but this overlay div never scrolls with
  // the iframe's internal document — it only tracks the iframe's fixed host-
  // page box — so the scroll must be subtracted back out here to keep the
  // live preview aligned under the cursor.
  const previewScrollOffset = readIframeScrollOffset(iframeRef.current);
  const toOverlayLocal = (point: { x: number; y: number }) => ({
    x: point.x - previewScrollOffset.left,
    y: point.y - previewScrollOffset.top,
  });
  const previewRect =
    drag && drag.moved && !isLineTool && tool !== "pen"
      ? getDraftGeometryFromPoints(
          toOverlayLocal(drag.startContent),
          toOverlayLocal(drag.currentContent),
          {
            minWidth: tool === "text" ? 24 : 8,
            minHeight: tool === "text" ? 18 : 8,
          },
        )
      : null;
  const previewLine =
    drag && drag.moved && isLineTool
      ? {
          start: toOverlayLocal(drag.startContent),
          end: toOverlayLocal(drag.currentContent),
        }
      : null;
  // Same overlay-local conversion for the live pen path — its anchors/
  // handles are stored in screen-content (document-absolute) space via
  // `toContentPoint`/`getPenAnchor`, but `SingleScreenPenPathOverlay` renders
  // them directly as this overlay's own (unscrolled) SVG/CSS coordinates.
  const displayedPenPathOverlay = displayedPenPath
    ? translatePenPath(
        displayedPenPath,
        -previewScrollOffset.left,
        -previewScrollOffset.top,
      )
    : null;

  return (
    <div
      ref={penOverlayRef}
      data-design-canvas-creation-overlay
      data-creation-tool={tool}
      className={cn("absolute inset-0 z-20 pointer-events-auto", cursorClass)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={(event) => {
        if (tool !== "pen" || !penPathRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        finishPenPath(collapseDoubleClickPenAnchor(penPathRef.current));
      }}
      onPointerLeave={() => {
        if (tool === "pen" && !penGestureRef.current) {
          setPenPointer(null);
          setPenCloseHover(false);
        }
      }}
    >
      {tool === "pen" && displayedPenPathOverlay ? (
        <SingleScreenPenPathOverlay
          path={displayedPenPathOverlay}
          closeHover={penCloseHover}
          iframeRef={iframeRef}
        />
      ) : null}
      {previewRect ? (
        <>
          <div
            data-creation-preview-rect
            className="pointer-events-none absolute rounded-[2px] border-[1.5px] border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)]/10"
            style={{
              left: previewRect.x,
              top: previewRect.y,
              width: Math.max(1, previewRect.width),
              height: Math.max(1, previewRect.height),
              borderRadius: tool === "ellipse" ? "9999px" : undefined,
            }}
          />
          <span
            data-creation-preview-size
            className="pointer-events-none absolute z-10 -translate-x-1/2 translate-y-1 rounded bg-[var(--design-editor-accent-color)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--design-editor-accent-contrast-color)] shadow-sm"
            style={{
              left: previewRect.x + previewRect.width / 2,
              top: previewRect.y + previewRect.height,
            }}
          >
            {Math.round(previewRect.width)} × {Math.round(previewRect.height)}
          </span>
        </>
      ) : null}
      {previewLine ? (
        <svg
          data-creation-preview-line
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          <line
            x1={previewLine.start.x}
            y1={previewLine.start.y}
            x2={previewLine.end.x}
            y2={previewLine.end.y}
            stroke="var(--design-editor-accent-color)"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        </svg>
      ) : null}
    </div>
  );
}

function SingleScreenPenPathOverlay({
  path,
  closeHover,
  iframeRef,
}: {
  path: PenPath;
  closeHover: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  const iframe = iframeRef.current;
  const rect = iframe?.getBoundingClientRect();
  const renderedScale =
    iframe && rect && iframe.clientWidth > 0
      ? rect.width / iframe.clientWidth
      : 1;
  const chromeScale = 1 / (renderedScale || 1);
  const anchorSize = 8 * chromeScale;
  const handleSize = 6 * chromeScale;
  const pathData = serializePenPath(path);

  return (
    <div
      data-pen-path-overlay
      className="pointer-events-none absolute inset-0 z-[90]"
    >
      <svg className="absolute inset-0 size-full overflow-visible">
        {path.nodes.map((node, index) => (
          <g key={`single-screen-pen-handles-${index}`}>
            {node.handleIn ? (
              <line
                x1={node.point.x}
                y1={node.point.y}
                x2={node.handleIn.x}
                y2={node.handleIn.y}
                stroke="var(--design-editor-accent-color)"
                strokeDasharray="3 3"
                strokeWidth={Math.max(1, chromeScale)}
              />
            ) : null}
            {node.handleOut ? (
              <line
                x1={node.point.x}
                y1={node.point.y}
                x2={node.handleOut.x}
                y2={node.handleOut.y}
                stroke="var(--design-editor-accent-color)"
                strokeDasharray="3 3"
                strokeWidth={Math.max(1, chromeScale)}
              />
            ) : null}
          </g>
        ))}
        <path
          d={pathData}
          fill="none"
          stroke="rgba(255,255,255,0.95)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={5 * chromeScale}
        />
        <path
          d={pathData}
          fill="none"
          stroke="var(--design-editor-accent-color)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2 * chromeScale}
        />
      </svg>
      {path.nodes.map((node, index) => (
        <span
          key={`single-screen-pen-anchor-${index}`}
          data-pen-anchor
          className={cn(
            "absolute rounded-[2px] border shadow-sm",
            index === 0 && closeHover
              ? "scale-125 border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] ring-4 ring-[var(--design-editor-selection-color)]"
              : "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)]",
          )}
          style={{
            left: node.point.x - anchorSize / 2,
            top: node.point.y - anchorSize / 2,
            width: anchorSize,
            height: anchorSize,
            borderWidth: Math.max(1, chromeScale),
          }}
        />
      ))}
      {path.nodes.flatMap((node, index) =>
        [node.handleIn, node.handleOut].flatMap((handle, handleIndex) =>
          handle
            ? [
                <span
                  key={`single-screen-pen-handle-${index}-${handleIndex}`}
                  data-pen-handle
                  className="absolute rounded-full border border-[var(--design-editor-accent-color)] bg-background shadow-sm"
                  style={{
                    left: handle.x - handleSize / 2,
                    top: handle.y - handleSize / 2,
                    width: handleSize,
                    height: handleSize,
                    borderWidth: Math.max(1, chromeScale),
                  }}
                />,
              ]
            : [],
        ),
      )}
    </div>
  );
}
