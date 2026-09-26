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
  if (protocol !== "https:") {
    const loopbackDev =
      isLoopbackPreviewAllowed() &&
      (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
    if (!loopbackDev) return false;
    return true;
  }
  if (fusionUrl) {
    try {
      if (new URL(fusionUrl).origin === origin) return true;
    } catch {
      // Malformed fusionUrl — fall through to the host-family allowlist.
    }
  }
  return host === "builder.io" || host.endsWith(".builder.io");
}

const EDITABLE_FOCUS_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="textbox"], [data-agent-native-text-editing]';

const MOTION_PREVIEW_BRIDGE_SCRIPT = `
<script data-agent-native-motion-preview-bridge>
${motionPreviewBridgeScript}
</script>
`;

const SHADER_FILL_PREVIEW_BRIDGE_SCRIPT = `
<script data-agent-native-shader-runtime data-runtime-version="1">
${shaderRuntimeBridgeScript}
</script>
<script data-agent-native-shader-fill-preview-bridge>
${shaderFillPreviewBridgeScript}
</script>
`;

const TWEAK_BRIDGE_SCRIPT = `
<script data-agent-native-tweak-bridge>
${tweakBridgeScript}
</script>
`;

const ZOOM_BRIDGE_SCRIPT = `
<script data-agent-native-zoom-bridge>
${zoomBridgeScript}
</script>
`;

const EMBEDDED_WHEEL_BRIDGE_SCRIPT = `
<script data-agent-native-embedded-wheel-bridge>
${embeddedWheelBridgeScript}
</script>
`;

const NAV_BRIDGE_SCRIPT = `
<script data-agent-native-nav-bridge>
${navBridgeScript}
</script>
`;

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

const EDITOR_CHROME_BRIDGE_SCRIPT = `
<script type="module" data-agent-native-editor-chrome-bridge>
${editorChromeBridgeScript}
</script>
`;

const LIVE_REFLOW_ENABLED = true;

const SELECTED_LAYER_DRAG_PRIORITY_ENABLED = true;

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
  bridgeUrl?: string;
  previewUrlOverride?: string;
  connectionId?: string;
  nativePreviewActive?: boolean;
  sharedSnapshotPollActive?: boolean;
  externalSnapshotHtml?: string;
  snapshotOnly?: boolean;
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
  onBridgeReady?: () => void;
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
  onRoutePathChange?: (screenId: string | undefined, routePath: string) => void;
  onBootStart?: () => void;
  onBootReady?: () => void;
  onScreenRootComputedStyles?: (computedStyles: Record<string, string>) => void;
  onRuntimeVerificationSnapshot?: (snapshot: {
    requestId: number;
    html: string;
    nodeCount: number;
    documentId?: string;
  }) => void;
  fusionUrl?: string;
  /** Read-only localhost bridge credential. Filesystem write tokens never enter
   * this browser component. */
  previewToken?: string;
  /** Design-bound credential for live-edit bridge operations only. */
  liveEditCapability?: string;
  liveEditRegistrationCapability?: string;
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
  fitRootBodyToFrame?: boolean;
  runtimeReplacementContent?: string;
  authoredSourceContent?: string;
  runtimeReplacementKey?: string;
  styleRevertRequest?: {
    requestId: number;
    patches: Array<StyleReplayPatch>;
  } | null;
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
  runtimeStructureMoveRequest?: RuntimeStructureMoveRequest | null;
  runtimeStructureInsertRequest?: RuntimeStructureInsertRequest | null;
  runtimeStructureDeleteRequest?: RuntimeStructureDeleteRequest | null;
  runtimeStructureRollbackRequest?: RuntimeStructureRollbackRequest | null;
  runtimeStructureTargetTransactionId?: string | null;
  runtimeLayerRenameRequest?: RuntimeLayerRenameRequest | null;
  runtimeLayerSnapshotRequest?: number | null;
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
    sourcePresent?: boolean;
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
  runtimeVerificationRequest?: RuntimeVerificationRequest | null;
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
  editorChromeScaleX?: number;
  editorChromeScaleY?: number;
  editMode: boolean;
  interactMode: boolean;
  centerInteractPreview?: boolean;
  readOnly?: boolean;
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
      insertedHtml?: string;
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
  drawMode?: boolean;
  onExitDrawMode?: () => void;
  drawOverlayResetSignal?: number;
  retainDrawOverlayWhenHidden?: boolean;
  onAnnotationSendingChange?: (sending: boolean) => void;
  pinMode?: boolean;
  commentPinsHidden?: boolean;
  selectedSelector?: string | null;
  selectedSelectorCandidates?: string[];
  selectedSelectorGroups?: string[][];
  passiveSelectionStyle?: "default" | "soft";
  hoveredSelector?: string | null;
  hoveredSelectorCandidates?: string[];
  lockedSelectors?: string[];
  hiddenSelectors?: string[];
  clearSelectionRequest?: number;
  registerRuntimeBridge?: boolean;
  onExitPinMode?: () => void;
  designId?: string;
  reviewCanPost?: boolean;
  reviewCanResolve?: boolean;
  reviewTargetId?: string | null;
  reviewBoardGeometry?: ReviewBoardGeometry | null;
  onReviewFocusBoardPoint?: (point: ReviewAnchorWorldPoint) => boolean | void;
  reviewCurrentUserEmail?: string | null;
  reviewFocusRequest?: ReviewFocusRequest | null;
  onDispatchCommentToAgent?: (comment: ReviewComment) => void;
  onSendThreadToAgent?: (thread: ReviewThread) => void;
  reviewSendingThreadId?: string | null;
  designTitle?: string;
  commentContextId?: string;
  screenId?: string;
  previewFrameId?: string;
  commentContextLabel?: string;
  repromptDraftRequest?: RepromptDraftRequest | null;
  onRepromptDraftConsumed?: (nonce: number) => void;
  nodeRewriteCanvasTarget?: boolean;
  onPrototypeNavigate?: (screen: string, href: string) => void;
  motionTracks?: MotionTrackWire[];
  motionDefaultEase?: string;
  motionDurationMs?: number;
  previewWidthPx?: number;
  previewHeightPx?: number;
  shaderFillPreview?: {
    selector?: string;
    nodeId?: string;
    css: string;
  } | null;
  gradientEditTarget?: {
    nodeId: string;
    cssValue: string;
  } | null;
  onGradientEditChange?: (
    nodeId: string,
    cssValue: string,
    phase: "preview" | "commit",
  ) => void;
  statePreviewTarget?: {
    nodeId: string;
    state: string;
    selector?: string | null;
    selectorCandidates?: string[];
    previewStyles?: Record<string, string> | null;
  } | null;
  onComponentSourceJump?: (params: {
    nodeId: string;
    componentName: string;
  }) => void;
  activeCreationTool?: CreationTool | null;
  selectedPenPathNodeId?: string | null;
  onCreatePrimitive?: (spec: CreatePrimitiveSpec) => string | false | void;
  onUpdatePenPath?: (
    nodeId: string,
    path: PenPath,
    nextTool?: "move",
  ) => boolean;
  onDropFiles?: (
    files: File[],
    target: {
      screenContentPoint: { x: number; y: number };
      screenId?: string;
    },
  ) => void;
  handToolActive?: boolean;
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

const LIVE_EDIT_READY_TIMEOUT_MS = 4000;
const MAX_LIVE_EDIT_RESTART_ATTEMPTS = 3;
const LIVE_EDIT_SAME_INSTANCE_MAX_REARM_DELAY_MS = 16_000;
const LIVE_EDIT_SAME_INSTANCE_ERROR_CEILING_MS = 48_000;

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

function sourceHeadInnerHtml(html: string): string {
  return /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html)?.[1] ?? "";
}

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
  const effectiveEditorChromeScaleX = (zoom / 100) * editorChromeScaleX;
  const effectiveEditorChromeScaleY = (zoom / 100) * editorChromeScaleY;
  const previousContentKeyRef = useRef(contentKey);
  const runtimeReplacementContentRef = useRef(runtimeReplacementContent);
  const runtimeReplacementSourceRef = useRef(
    authoredSourceContent ?? runtimeReplacementContent,
  );
  const runtimeReplacementKeyRef = useRef(runtimeReplacementKey);
  const lastRuntimeReplacementKeyRef = useRef(runtimeReplacementKey);
  const lastRuntimeReplacementContentRef = useRef(runtimeReplacementContent);
  const pinchZoomDeviceRef = useRef<ZoomGestureDevice | null>(null);
  const bridgeReadyRef = useRef(false);
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
  const lastRuntimeStructureDeleteCancelRequestRef = useRef<{
    requestId: string;
    retryCount: number;
  } | null>(null);
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
      if (!win || !bridgeReadyRef.current || !editorChromeReadyRef.current) {
        pendingOneShotMessagesRef.current.push(message);
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
  const snapshotRetryAttemptRef = useRef(0);
  const bridgeRegistrationRetryAttemptRef = useRef(0);
  const bridgeRegistrationRetryTimerRef = useRef<number | undefined>(undefined);
  const bridgeRegistrationAttemptGenerationRef = useRef(0);
  const previewTokenRefreshAttemptRef = useRef<string | null>(null);
  const [bridgeRegistrationRetryNonce, setBridgeRegistrationRetryNonce] =
    useState(0);
  const [bridgeRegistrationError, setBridgeRegistrationError] = useState<{
    bridgeKey: string;
    message: string;
  } | null>(null);
  const [bridgeConnectionLostError, setBridgeConnectionLostError] = useState<{
    bridgeKey: string;
    message: string;
  } | null>(null);
  const [bridgeRegistrationFailureKind, setBridgeRegistrationFailureKind] =
    useState<BridgeRegistrationFailureKind | null>(null);
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
  const bridgeInstanceIdRef = useRef<string | null>(null);
  const lateLiveEditReadyRecoveryRef = useRef<{
    source: Window;
    bridgeKey: string;
    registrationHandoffKey: string | null;
  } | null>(null);
  const liveEditRestartInFlightRef = useRef(false);
  const liveEditRestartAttemptRef = useRef(0);
  const liveEditSameInstanceElapsedMsRef = useRef(0);
  const liveEditSameInstanceDelayRef = useRef(LIVE_EDIT_READY_TIMEOUT_MS);
  const liveEditSameInstanceRearmTimerRef = useRef<number | undefined>(
    undefined,
  );
  const [
    liveEditSameInstanceStalledError,
    setLiveEditSameInstanceStalledError,
  ] = useState<{
    bridgeKey: string;
    message: string;
  } | null>(null);
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

  const urlBackedFrame = Boolean(rawExternalPreviewUrl);

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
            initialSourceHead: "",
          })
        : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardSurface, runtimeLayerSnapshotEnabled, screenId, urlBackedFrame],
  );
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

  const containerPreview = useMemo(() => {
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
      target.postMessage(
        {
          type: "agentNative.installBridge",
          key: liveEditBridgeKey,
          script: liveEditBridgeScript,
        },
        origin,
      );
    } catch (error) {
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
  useEffect(() => {
    if (!containerPreview) return;
    function onBootstrapMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
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

  const scheduleBridgeRegistrationRetry = useCallback(() => {
    const delay = getSnapshotRetryDelayMs(
      bridgeRegistrationRetryAttemptRef.current,
    );
    bridgeRegistrationRetryAttemptRef.current += 1;
    bridgeRegistrationRetryTimerRef.current = window.setTimeout(() => {
      setBridgeRegistrationRetryNonce((nonce) => nonce + 1);
    }, delay);
  }, []);
  useEffect(
    () => () => {
      bridgeRegistrationAttemptGenerationRef.current += 1;
    },
    [],
  );
  // superseded this one. Callers must treat null and stale-token as "nothing to
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
      const isCurrent = () =>
        bridgeRegistrationAttemptGenerationRef.current === generation;
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
          // read-only credential automatically so a reboot is a recoverable
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
        const payload = (await response.json().catch(() => null)) as {
          bridgeInstanceId?: string;
        } | null;
        if (!isCurrent()) return null;
        if (payload && typeof payload.bridgeInstanceId === "string") {
          bridgeInstanceIdRef.current = payload.bridgeInstanceId;
        }
        bridgeRegistrationRetryAttemptRef.current = 0;
        previewTokenRefreshAttemptRef.current = null;
        if (registrationHandoffKey) {
          liveEditRegistrationHandoff.set(registrationHandoffKey, Date.now());
        }
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

  const handleSuspectedBridgeRestart = useCallback(async () => {
    if (!bridgeUrl || !effectivePreviewToken) return;
    if (liveEditRestartInFlightRef.current) return;
    liveEditRestartInFlightRef.current = true;
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
        bridgeInstanceIdRef.current = responseBridgeInstanceId;
        setRegisteredLiveEditBridgeKey(null);
        setBridgeConnectionLostError(null);
        setLiveEditSameInstanceStalledError(null);
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

  const handleManualSnapshotRetry = useCallback(() => {
    snapshotRetryAttemptRef.current = 0;
    setExternalSnapshotRetryNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    if (previousContentKeyRef.current !== contentKey) {
      previousContentKeyRef.current = contentKey;
      lastRuntimeReplacementKeyRef.current = runtimeReplacementKey;
      lastRuntimeReplacementContentRef.current = runtimeReplacementContent;
      if (!externalPreviewUrl) {
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
    setRenderedDocument({
      content,
      sourceContent: authoredSourceContent ?? content,
    });
  }, [content, interactMode, authoredSourceContent]);

  usePinchZoom({
    containerRef: scrollContainerRef,
    zoom,
    setZoom: onZoomChange ?? (() => {}),
    min: DEFAULT_CANVAS_MIN_ZOOM,
    max: DEFAULT_CANVAS_MAX_ZOOM,
    zoomToCursor: deviceFrame === "none" && !centerInteractPreview,
    enabled: Boolean(onZoomChange) && !interactMode,
    onZoomFrame: onZoomChange ? applyZoomFrame : undefined,
    onZoomEnd: onZoomChange ? commitZoom : undefined,
  });

  useEffect(() => {
    if (deviceFrame !== "none" || centerInteractPreview) return;
    const scroll = scrollContainerRef.current;
    const layer = zoomLayerRef.current;
    if (!scroll || !layer) return;
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

  const srcdoc = useMemo(() => {
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

  const srcdocVersionRef = useRef({ srcdoc, version: 0 });
  if (srcdocVersionRef.current.srcdoc !== srcdoc) {
    srcdocVersionRef.current = {
      srcdoc,
      version: srcdocVersionRef.current.version + 1,
    };
  }
  const srcdocHash = srcdocVersionRef.current.version;
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
  const liveEditDocumentPending =
    usesLiveEditEditorBridge &&
    Boolean(externalPreviewUrl) &&
    !usingRawFallbackPreview &&
    readyIframeDocumentIdentity !== iframeDocumentIdentity;
  // denied local-network permission can never hand clicks to the app.
  const liveEditRegistrationFailurePending =
    liveEditFrameRequiresBridge && bridgeRegistrationFailedForCurrentKey;
  const sameOriginBridgePending =
    containerPreview &&
    includeLiveEditEditorChrome &&
    readyIframeDocumentIdentity !== iframeDocumentIdentity;

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
        liveEditRestartAttemptRef.current = 0;
        if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
          window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
          liveEditSameInstanceRearmTimerRef.current = undefined;
        }
        liveEditSameInstanceElapsedMsRef.current = 0;
        liveEditSameInstanceDelayRef.current = LIVE_EDIT_READY_TIMEOUT_MS;
        setLiveEditSameInstanceStalledError(null);
        flushPendingOneShotMessages();
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
      if (e.data.type === "runtime-structure-delete-cancelled") {
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
          reason: "cancelled",
          sourcePresent: e.data.sourcePresent === true,
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
        const pendingNodeId =
          typeof e.data.nodeId === "string" ? e.data.nodeId : "";
        const currentPending = pendingTextEditRef.current;
        const capturedOwner = capturedOwnerRef.current;
        if (e.data.pending && pendingNodeId) {
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
            pendingTextEditRef.current = {
              nodeId: pendingNodeId,
              buffer:
                takePendingTextCapture(capturedOwner, pendingNodeId) ?? "",
              startedAt: Date.now(),
            };
          }
        } else if (pendingNodeId) {
          const abandonedByUser =
            e.data.reason === "escape" ||
            e.data.reason === "pointerdown" ||
            e.data.reason === "superseded";
          if (abandonedByUser && currentPending?.nodeId === pendingNodeId) {
            pendingTextEditRef.current = null;
          }
          if (!capturedOwner) return;
          if (abandonedByUser) {
            cancelPendingTextCapture(capturedOwner, pendingNodeId);
          } else if (e.data.reason === "committed") {
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
        const MAX_DATA_URL_BYTES = 20 * 1024 * 1024;
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
        onPrototypeNavigate?.(
          String(e.data.screen || ""),
          String(e.data.href || ""),
        );
        return;
      }
      if (e.data.type === "component-source-jump") {
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
        if (isEmbeddedFrame) return;
        if (interactMode) return;
        if (!onZoomChange) return;
        const iframe = iframeRef.current;
        const scroll = scrollContainerRef.current;
        if (!iframe || !scroll) return;
        const rawDeltaY = Number(e.data.deltaY);
        if (!Number.isFinite(rawDeltaY)) return;
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

  const lastSelectionMirrorSignatureRef = useRef<string | null>(null);
  const forceSelectionMirrorResyncRef = useRef(true);
  const suppressMirrorSelectorsRef = useRef<string[] | null>(null);
  const iframeClearedSelectorRef = useRef<string | null>(null);
  const replayIframeEditorStateRef = useRef<(() => void) | null>(null);
  const interactModeRef = useRef(interactMode);
  interactModeRef.current = interactMode;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
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
  replayIframeEditorStateRef.current = replayIframeEditorState;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const replayAfterLoad = () => {
      forceSelectionMirrorResyncRef.current = true;
      replayIframeEditorState();
    };
    replayIframeEditorState();
    iframe.addEventListener("load", replayAfterLoad);
    return () => iframe.removeEventListener("load", replayAfterLoad);
  }, [replayIframeEditorState]);

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

  useEffect(() => {
    postOneShotBridgeMessage({
      type: "embedded-canvas-gesture-mode",
      wheelEnabled: isEmbeddedFrame && !interactMode,
      spaceKeyForwardingEnabled: interactMode || isEmbeddedFrame || readOnly,
      editingSafetyEnabled: !interactMode,
    });
  }, [
    interactMode,
    isEmbeddedFrame,
    postOneShotBridgeMessage,
    readOnly,
    readyIframeDocumentIdentity,
  ]);

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

  const capturedOwnerRef = useRef<string | null>(null);
  capturedOwnerRef.current = previewFrameId ? null : (screenId ?? null);

  const beginTextEdit = useCallback(
    (nodeId: string, options?: BeginTextEditOptions): boolean => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || !nodeId) return false;
      const owner = capturedOwnerRef.current;
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
      const previousActivation = pendingTextEditActivationRef.current;
      if (previousActivation?.nodeId === nodeId) {
        previousActivation.cancelTimer();
      } else {
        previousActivation?.cancelRequest();
      }
      if (options?.commitImmediately || options?.deliverOwed) {
        const commitImmediately = options.commitImmediately === true;
        const local = pendingTextEditRef.current;
        const localText = local?.nodeId === nodeId ? local.buffer : "";
        if (local?.nodeId === nodeId) pendingTextEditRef.current = null;
        const insertText = owner
          ? (owePendingTextCapture(owner, nodeId, localText, {
              commit: commitImmediately,
            }) ?? localText)
          : localText;
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
      const cancelRequest = () => {
        cancelTimer();
        dropQueuedBeginTextEdit(nodeId);
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
  const beginTextEditRef = useRef(beginTextEdit);
  beginTextEditRef.current = beginTextEdit;

  useEffect(() => {
    if (previewFrameId) return;
    const owner = screenId;
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
      const pending = pendingTextEditRef.current;
      if (owner && pending) {
        returnPendingTextCapture(owner, pending.nodeId, pending.buffer);
      }
      pendingTextEditRef.current = null;
      pendingTextEditActivationRef.current?.cancelTimer();
      pendingTextEditActivationRef.current = null;
    };
  }, [previewFrameId, screenId]);

  // Creation-race keystroke routing (host side). Active only while a
  const pendingTextEditRef = useRef<{
    nodeId: string;
    buffer: string;
    startedAt: number;
  } | null>(null);
  const pendingTextEditActivationRef = useRef<{
    nodeId: string;
    cancelTimer: () => void;
    cancelRequest: () => void;
  } | null>(null);
  useEffect(() => {
    function onPendingTextEditKeyDown(e: KeyboardEvent) {
      const pending = pendingTextEditRef.current;
      if (!pending) return;
      const interceptOwner = capturedOwnerRef.current;
      if (interceptOwner) {
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
        const escapedNodeId = pending.nodeId;
        const escapedText = pending.buffer;
        pendingTextEditActivationRef.current?.cancelTimer();
        pendingTextEditActivationRef.current = null;
        if (escapedText) {
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
    if (!request || request.waitForInsertTransaction) return;
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
      lastRuntimeStructureDeleteCancelRequestRef.current = null;
      return;
    }
    if (readyIframeDocumentIdentity !== iframeDocumentIdentity) {
      lastRuntimeStructureDeleteCancelRequestRef.current = null;
      return;
    }
    const retryCount = request.cancellationRetryCount ?? 0;
    if (
      lastRuntimeStructureDeleteCancelRequestRef.current?.requestId ===
        request.requestId &&
      lastRuntimeStructureDeleteCancelRequestRef.current.retryCount ===
        retryCount
    ) {
      return;
    }
    lastRuntimeStructureDeleteCancelRequestRef.current = {
      requestId: request.requestId,
      retryCount,
    };
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
      cancelRuntimeStructureDelete: {
        transactionId: request.transactionId,
        selector: request.selector,
        selectorCandidates: request.selectorCandidates ?? [],
      },
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

  const sendMotionPreview = useCallback((t: number, durationMs?: number) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: "motion-preview", t: Math.max(0, Math.min(1, t)), durationMs },
      "*",
    );
  }, []);

  const clearMotionPreview = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "motion-preview-clear" },
      "*",
    );
  }, []);

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
      const nextContent = boardSurface
        ? getBoardSurfaceRenderContent(rawNextContent, resolvedTheme === "dark")
        : rawNextContent;
      return replacePreviewContent(
        getEmbeddedFrameDocumentContent({
          content: withLocalRuntimes(nextContent),
          embeddedFrameBackground,
          transparentBackground,
          contentOffsetX: embeddedFrame?.contentOffsetX ?? 0,
          contentOffsetY: embeddedFrame?.contentOffsetY ?? 0,
          fitBodyToFrame: fitRootBodyToFrame ?? !boardSurface,
        }),
        selectedSelectorRef.current,
        selectedSelectorCandidatesRef.current ?? [],
        {
          forceFullDocument: true,
          sourceProvenance: createSourceDocumentProvenance(rawSourceContent),
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

  useEffect(() => {
    if (!registerRuntimeBridge) return;
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
    (window as any).__designCanvasSendShaderFillPreview = sendShaderFillPreview;
    (window as any).__designCanvasClearShaderFillPreview =
      clearShaderFillPreview;
    return () => {
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
  const embeddedPaintScale =
    Math.max(1, embeddedFramePaintScaleX, embeddedFramePaintScaleY) *
    Math.max(1, editorChromeScaleX, editorChromeScaleY);
  const iframeBackgroundColor = getEmbeddedIframeBackgroundColor({
    embeddedFrameBackground,
    transparentBackground,
  });

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
  const focusScrollSurface = useCallback(
    (fromIframeLoad = false) => {
      const surface = scrollContainerRef.current;
      if (
        !surface ||
        document.activeElement === surface ||
        !editMode ||
        interactMode
      )
        return;
      if (
        textEditingStateRef.current.active ||
        document.activeElement?.closest("[data-radix-popper-content-wrapper]")
      ) {
        return;
      }
      const focusedElement = document.activeElement;
      if (
        fromIframeLoad &&
        focusedElement !== document.body &&
        focusedElement !== iframeRef.current
      ) {
        return;
      }
      if (focusedElement instanceof HTMLIFrameElement) {
        try {
          const frameDocument = focusedElement.contentDocument;
          if (!frameDocument) {
            if (!fromIframeLoad) return;
          } else if (
            frameDocument.activeElement?.closest(EDITABLE_FOCUS_SELECTOR)
          ) {
            return;
          }
        } catch (error) {
          if (
            !(error instanceof DOMException) ||
            error.name !== "SecurityError"
          ) {
            throw error;
          }
          return;
        }
      }
      if (focusedElement?.closest(EDITABLE_FOCUS_SELECTOR)) return;
      surface.focus({ preventScroll: true });
    },
    [editMode, interactMode],
  );
  const handleCanvasPointerEnter = useCallback(
    () => focusScrollSurface(),
    [focusScrollSurface],
  );
  useLayoutEffect(() => focusScrollSurface(), [focusScrollSurface]);

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
            focusScrollSurface(true);
            event.currentTarget.contentWindow?.postMessage(
              { type: "agent-native:editor-chrome-ready-probe" },
              "*",
            );
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
              ? "localhost"
              : "inline")
          }
          className="relative block h-full w-full border-0 bg-transparent"
          style={{
            background: iframeBackgroundColor,
            backgroundColor: iframeBackgroundColor,
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
      {/* Keep the overlay mounted while Move is active so a rejected Pen
          commit remains available to retry; without a creation tool it is
          transparent to pointer events. */}
      <SingleScreenCreationOverlay
        key={screenId}
        tool={interactMode ? null : (activeCreationTool ?? null)}
        iframeRef={iframeRef}
        selectedPenPathNodeId={selectedPenPathNodeId}
        onCreatePrimitive={onCreatePrimitive}
        onUpdatePenPath={onUpdatePenPath}
      />
      {/* OS file drag-over capture overlay — sits over the iframe, NOT
          inside it. Only mounts while a native OS file drag is actually in
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
          onPointerEnter={handleCanvasPointerEnter}
          onMouseEnter={handleCanvasPointerEnter}
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
        onPointerEnter={handleCanvasPointerEnter}
        onMouseEnter={handleCanvasPointerEnter}
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
      onPointerEnter={handleCanvasPointerEnter}
      onMouseEnter={handleCanvasPointerEnter}
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

const CREATION_CLICK_MOVE_THRESHOLD_PX = 4;

const CREATION_DEFAULT_SIZE: Record<
  Exclude<CreationTool, "line" | "arrow" | "pen">,
  { width: number; height: number }
> = {
  rectangle: { width: 160, height: 100 },
  ellipse: { width: 120, height: 120 },
  text: { width: 160, height: 32 },
  frame: { width: 100, height: 100 },
};

const CREATION_DEFAULT_LINE_LENGTH = 120;

interface CreationDragState {
  tool: CreationTool;
  startContent: { x: number; y: number };
  currentContent: { x: number; y: number };
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
  tool: CreationTool | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  selectedPenPathNodeId?: string | null;
  onCreatePrimitive?: (spec: CreatePrimitiveSpec) => string | false | void;
  onUpdatePenPath?: (
    nodeId: string,
    path: PenPath,
    nextTool?: "move",
  ) => boolean;
}

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
        const restoreDraft = () => {
          updatePenPath(committed);
          setPenGesturePreview(null);
          setPenPointer(null);
          setPenCloseHover(false);
        };
        let nodeId: string | false | void;
        try {
          nodeId = onCreatePrimitive({
            tool: "pen",
            points: committed.nodes.map((node) => node.point),
            penPath: committed,
            fromClick: false,
            preserveActiveTool: options?.preserveActiveTool,
            nextTool: options?.nextTool,
          });
        } catch (error) {
          restoreDraft();
          throw error;
        }
        if (nodeId === false) {
          restoreDraft();
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
    if (!tool) {
      dragRef.current = null;
      setDrag(null);
      setPenPointer(null);
      setPenCloseHover(false);
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
      if (e.button !== 0 || !tool) return;
      if (tool === "pen") {
        e.preventDefault();
        e.stopPropagation();
        seedSelectedPenContinuation();
        const currentPath = penPathRef.current;
        if (currentPath?.closed) return;
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
        const pathBefore = penGestureRef.current.pathBefore;
        clearPenPath();
        updatePenPath(pathBefore);
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

  const cursorClass =
    tool === null
      ? "pointer-events-none"
      : cn(
          "pointer-events-auto",
          tool === "text" ? "cursor-text" : "cursor-crosshair",
        );
  const isLineTool = tool === "line" || tool === "arrow";
  const displayedPenPath =
    penGesturePreview ??
    (penPath && penPointer
      ? penCloseHover
        ? closePenPath(penPath)
        : appendPenNode(penPath, createCornerNode(penPointer))
      : penPath);

  const previewScrollOffset = readIframeScrollOffset(iframeRef.current);
  const toOverlayLocal = (point: { x: number; y: number }) => ({
    x: point.x - previewScrollOffset.left,
    y: point.y - previewScrollOffset.top,
  });
  const previewRect =
    tool && drag && drag.moved && !isLineTool && tool !== "pen"
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
      className={cn("absolute inset-0 z-20", cursorClass)}
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
      {displayedPenPathOverlay ? (
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
