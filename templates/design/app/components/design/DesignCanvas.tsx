import { usePinchZoom, useT } from "@agent-native/core/client";
import {
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  getDraftGeometryFromPoints,
} from "@shared/canvas-math";
import { ensureCodeLayerNodeIdsInHtml } from "@shared/code-layer";
import {
  appendPenNode,
  clonePenPath,
  closePenPath,
  constrainPointTo45Degrees,
  createCornerNode,
  createSmoothNode,
  isPenCloseTarget,
  serializePenPath,
  translatePenPath,
  type PenPath,
  type PenPoint,
} from "@shared/pen-path";
import { IconPlugConnectedX, IconRefresh } from "@tabler/icons-react";
import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
// NOTE: This wires up the NEW shared visual-editor DrawOverlay + comment-pin
// components from `@/components/visual-editor`. The legacy iframe-only
// DrawOverlay at `./DrawOverlay.tsx` is intentionally NOT used here — both
// exist for now and can be reconciled in a follow-up. Don't import both.
import {
  DrawOverlay as SharedDrawOverlay,
  CanvasCommentPins,
  type CanvasPin,
} from "@/components/visual-editor";
import { sendToDesignAgentChatAndConfirm } from "@/lib/agent-chat";
import {
  resolveDesktopDesignSnapshotLayer,
  useDesktopDesignNativePreview,
} from "@/lib/desktop-design-preview";
import { cn } from "@/lib/utils";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";
import { embeddedWheelBridgeScript } from "../../../.generated/bridge/embedded-wheel.generated";
import { motionPreviewBridgeScript } from "../../../.generated/bridge/motion-preview.generated";
import { navBridgeScript } from "../../../.generated/bridge/nav.generated";
import { shaderFillPreviewBridgeScript } from "../../../.generated/bridge/shader-fill-preview.generated";
import { shaderRuntimeBridgeScript } from "../../../.generated/bridge/shader-runtime.generated";
import { tweakBridgeScript } from "../../../.generated/bridge/tweak.generated";
import { zoomBridgeScript } from "../../../.generated/bridge/zoom.generated";
import { isTrustedCanvasBridgeMessage } from "./bridge-security";
import { captureAnnotatedScreenshot } from "./design-canvas/annotation-snapshot";
import { submitDesignAnnotations } from "./design-canvas/annotation-submit";
import {
  getScreenContentPointFromClient,
  getZoomToCursorScrollDelta,
} from "./design-canvas/coordinate-transforms";
import {
  collapseDoubleClickPenAnchor,
  type CreatePrimitiveSpec,
  type CreationTool,
} from "./design-canvas/creation";
import { isElementInfoPayload } from "./design-canvas/element-payload";
import {
  embeddedContentOffsetCss,
  embeddedContentOffsetStyle,
  getEmbeddedFrameBackgroundStyle,
  getEmbeddedFrameDocumentContent,
  getEmbeddedIframeBackgroundColor,
} from "./design-canvas/embedded-frame";
import {
  getDesignCanvasIframeSandbox,
  getSnapshotRetryDelayMs,
  resolveLiveEditPreviewUrl,
  sanitizeLocalhostSourceSnapshotHtml,
  shouldFetchExternalSourceSnapshot,
  shouldUseIframeLoadReadyFallback,
} from "./design-canvas/external-preview";
import { isOsFileDragEvent } from "./design-canvas/file-drop";
import { LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT } from "./design-canvas/hit-test";
import type {
  IframeContextMenuPayload,
  IframeFigmaClipboardPastePayload,
  IframeHotkeyPayload,
} from "./design-canvas/iframe-events";
import {
  forwardEmbeddedCanvasPanMessage,
  type EmbeddedCanvasPanSession,
} from "./design-canvas/iframe-pan";
import type { MotionTrackWire } from "./design-canvas/motion-types";
import {
  PENDING_TEXT_EDIT_TIMEOUT_MS,
  routePendingTextEditKey,
  schedulePendingTextEditActivation,
} from "./design-canvas/pending-text-edit";
import { DeviceFrame } from "./DeviceFrame";
import { shapeClosingHandles } from "./multi-screen/draft-primitives";
import type {
  ElementInfo,
  ElementSelectionIntent,
  DeviceFrameType,
  RuntimeStructureMoveRequest,
  RuntimeVerificationRequest,
} from "./types";

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
  /** Stable local/Fusion connection scope for desktop session isolation. */
  connectionId?: string;
  /** Only the active focused/overview screen may own the desktop native backend. */
  nativePreviewActive?: boolean;
  /**
   * HTML snapshot for a URL-backed localhost screen. When present, DesignCanvas
   * renders this as editable srcdoc while the persisted design file can remain
   * the original URL.
   */
  externalSnapshotHtml?: string;
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
  }) => void;
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
  /**
   * Optional live document replacement channel. When paired with
   * `runtimeReplacementKey`, this lets callers update iframe DOM through the
   * editor bridge without changing `srcDoc` and reloading the iframe.
   */
  runtimeReplacementContent?: string;
  runtimeReplacementKey?: string;
  styleRevertRequest?: {
    requestId: number;
    patches: Array<{
      selector: string;
      sourceId?: string | null;
      styles: Record<string, string>;
      interactionState?: string;
    }>;
  } | null;
  styleBaselineResetRequest?: number | null;
  textRevertRequest?: {
    requestId: number;
    patches: Array<{
      selector: string;
      sourceId?: string | null;
      value: string;
      html?: string;
    }>;
  } | null;
  structureAckRequest?: {
    requestId: number;
    acks: Array<{ requestId: string; applied: boolean }>;
  } | null;
  /** One-shot host request to optimistically move a runtime-only layer. */
  runtimeStructureMoveRequest?: RuntimeStructureMoveRequest | null;
  /** Mounts a separate hidden runtime only after a guarded source hash
   * changes. The editable iframe remains untouched and fully undoable. */
  runtimeVerificationRequest?: RuntimeVerificationRequest | null;
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
  editorChromeScaleX?: number;
  editorChromeScaleY?: number;
  editMode: boolean;
  interactMode: boolean;
  readOnly?: boolean;
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
    metadata?: { originalStyles?: Record<string, string> },
  ) => void;
  onTextContentChange?: (
    selector: string,
    value: string,
    info?: ElementInfo,
    details?: {
      html?: string;
      originalValue?: string;
      originalHtml?: string;
    },
  ) => void;
  onTextEditingStateChange?: (state: {
    active: boolean;
    selector?: string;
    hasRange?: boolean;
  }) => void;
  onElementDblClickText?: (info: ElementInfo) => void;
  onIframeHotkey?: (event: IframeHotkeyPayload) => void;
  onFigmaClipboardPaste?: (event: IframeFigmaClipboardPastePayload) => void;
  onIframeContextMenu?: (event: IframeContextMenuPayload) => void;
  onEditorDragStateChange?: (active: boolean) => void;
  onVisualStructureChange?: (
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      requestId?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      anchorElementInfo?: ElementInfo;
    },
  ) => boolean | "pending" | void;
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
   * Figma-style Shift+C "hide comments" toggle in single-screen mode). Only
   * affects pin *visibility* — pin drop mode (`pinMode`) still behaves
   * normally underneath so toggling this back off doesn't lose anything.
   */
  commentPinsHidden?: boolean;
  selectedSelector?: string | null;
  selectedSelectorCandidates?: string[];
  selectedSelectorGroups?: string[][];
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
  /**
   * Host-side iframe identity when several responsive previews render the
   * same screen. The bridge still reports `screenId`; only DOM targeting uses
   * this distinct value.
   */
  previewFrameId?: string;
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
  /**
   * Fired once per completed click or drag gesture while `activeCreationTool`
   * is set. Geometry is in SCREEN-CONTENT coordinates — the screen's own
   * pixel coordinate system, matching what `getDraftGeometryFromPoints` and
   * `draftPrimitiveToInsert` already use in MultiScreenCanvas — NOT viewport
   * pixels. The parent (DesignEditor) is responsible for turning this into a
   * persisted primitive (see `appendCanvasPrimitiveToHtml` /
   * `draftPrimitiveToInsert` on the overview side).
   */
  onCreatePrimitive?: (spec: CreatePrimitiveSpec) => void;
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
// not to one React DesignCanvas instance. Overview -> Full view currently
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
  );
}

function contentHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `${value.length}:${hash >>> 0}`;
}

const SCRIPT_ELEMENT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi; // i18n-ignore non-UI regex

/**
 * Runtime document replacement uses `head.innerHTML` / `body.innerHTML`, which
 * intentionally preserves the iframe browsing context but cannot execute
 * newly inserted or changed scripts. Reload only when source script elements
 * change; ordinary markup/style edits continue through the no-flash bridge.
 */
function runtimeDocumentNeedsReload(
  previousContent: string,
  nextContent: string,
): boolean {
  const scriptSignature = (html: string) =>
    Array.from(html.matchAll(SCRIPT_ELEMENT_RE), (match) => match[0]).join(
      "\n",
    );
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

export function DesignCanvas({
  content,
  contentKey,
  sourceType,
  bridgeUrl,
  connectionId,
  nativePreviewActive = true,
  externalSnapshotHtml,
  onExternalContentSnapshot,
  onRuntimeLayerSnapshot,
  onRuntimeVerificationSnapshot,
  fusionUrl,
  previewToken,
  zoom,
  onZoomChange,
  deviceFrame,
  embeddedFrame,
  boardSurface = false,
  runtimeReplacementContent,
  runtimeReplacementKey,
  styleRevertRequest,
  styleBaselineResetRequest,
  textRevertRequest,
  structureAckRequest,
  runtimeStructureMoveRequest,
  runtimeVerificationRequest,
  embeddedFrameBackground,
  transparentBackground = false,
  editorChromeScaleX = 1,
  editorChromeScaleY = editorChromeScaleX,
  editMode,
  interactMode,
  readOnly = false,
  scaleMode = false,
  clearSelectionRequest,
  onElementSelect,
  onElementMarqueeSelect,
  onElementHover,
  onClearSelection,
  onVisualStyleChange,
  onTextContentChange,
  onTextEditingStateChange,
  onElementDblClickText,
  onIframeHotkey,
  onFigmaClipboardPaste,
  onIframeContextMenu,
  onEditorDragStateChange,
  onVisualStructureChange,
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
  selectedSelectorCandidates = [],
  selectedSelectorGroups = [],
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
  previewFrameId,
  commentContextLabel,
  onPrototypeNavigate,
  motionTracks,
  motionDefaultEase,
  motionDurationMs,
  previewWidthPx,
  onComponentSourceJump,
  shaderFillPreview,
  gradientEditTarget,
  onGradientEditChange,
  statePreviewTarget,
  activeCreationTool = null,
  onCreatePrimitive,
  onDropFiles,
  handToolActive = false,
  spacePanActive = false,
}: DesignCanvasProps) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runtimeVerificationIframeRef = useRef<HTMLIFrameElement>(null);
  const embeddedCanvasPanSessionRef = useRef<EmbeddedCanvasPanSession | null>(
    null,
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
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
  const runtimeReplacementKeyRef = useRef(runtimeReplacementKey);
  const lastRuntimeReplacementKeyRef = useRef(runtimeReplacementKey);
  // The key also includes updatedAt, so a save acknowledgement can change it
  // while the rendered bytes are identical. Track the bytes separately to
  // avoid a redundant forced document replacement that would terminate an
  // in-progress text edit/caret after every save echo.
  const lastRuntimeReplacementContentRef = useRef(runtimeReplacementContent);
  // Bridge-ready handshake (see EDITOR_CHROME_BRIDGE_SCRIPT's
  // agent-native:editor-chrome-ready post on install). One-shot commands —
  // begin-text-edit, set-editor-chrome-scale, style-change, delete-element,
  // replace-document-content — are fire-and-forget postMessages with no retry:
  // if the iframe document is still loading (fresh srcdoc, screen switch, or a
  // mid-flight reload) the bridge script hasn't attached its message listener
  // yet and the command is silently dropped. replayIframeEditorState only
  // re-sends steady-state selection/hover/tweak/motion values, never these
  // one-shot commands, so a dropped one-shot never recovers on its own.
  // Queue them here until ready fires (or the iframe finishes loading, as a
  // fallback for older/interact-mode documents that never inject the chrome
  // bridge and thus never post ready) and flush in order.
  const bridgeReadyRef = useRef(false);
  const [readyIframeDocumentIdentity, setReadyIframeDocumentIdentity] =
    useState<string | null>(null);
  const previousIframeDocumentIdentityRef = useRef<string | null>(null);
  const pendingOneShotMessagesRef = useRef<unknown[]>([]);
  const flushPendingOneShotMessages = useCallback(() => {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow;
    if (!win) return;
    const queued = pendingOneShotMessagesRef.current;
    if (queued.length === 0) return;
    pendingOneShotMessagesRef.current = [];
    queued.forEach((message) => win.postMessage(message, "*"));
  }, []);
  const postOneShotBridgeMessage = useCallback((message: unknown) => {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow;
    // A one-shot prop can arrive in the same render that first creates the
    // iframe. Keep it queued even when the ref/contentWindow is not attached
    // yet; otherwise the effect records its request id as handled and the
    // command is lost permanently before the bridge can announce readiness.
    if (!win || !bridgeReadyRef.current) {
      pendingOneShotMessagesRef.current.push(message);
      return true;
    }
    win.postMessage(message, "*");
    return true;
  }, []);
  const [renderedContent, setRenderedContent] = useState(content);
  const [annotationPins, setAnnotationPins] = useState<CanvasPin[]>([]);
  const [pinSubmitSignal, setPinSubmitSignal] = useState(0);
  // True while a drawing send is capturing/compositing/uploading the
  // annotated screenshot (see design-canvas/annotation-snapshot.ts). Drives
  // SharedDrawOverlay's busy Send state so a slow capture can't be triggered
  // twice from the same drawing.
  const [annotationCaptureBusy, setAnnotationCaptureBusy] = useState(false);
  const annotationCaptureBusyRef = useRef(false);
  const [fetchedExternalSnapshot, setFetchedExternalSnapshot] = useState<{
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
  const [bridgeRegistrationRetryNonce, setBridgeRegistrationRetryNonce] =
    useState(0);
  const [bridgeRegistrationError, setBridgeRegistrationError] = useState<{
    bridgeKey: string;
    message: string;
  } | null>(null);
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
  // Set on unmount so the async /health probe (and its escalation re-arm
  // timer) never touches state after this component is gone.
  const isUnmountedRef = useRef(false);
  useEffect(
    () => () => {
      isUnmountedRef.current = true;
      if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
        window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
        liveEditSameInstanceRearmTimerRef.current = undefined;
      }
    },
    [],
  );
  const onExternalContentSnapshotRef = useRef(onExternalContentSnapshot);
  const isEmbeddedFrame = Boolean(embeddedFrame);
  // Resolve the URL to render in the iframe:
  // 1. When sourceType === "fusion" and fusionUrl is set, prefer the explicit
  //    Builder-hosted URL over whatever is in `content` (which may still be the
  //    original inline HTML).
  // 2. Otherwise fall back to the content-based URL detection (handles the case
  //    where the branch URL has been written into the design file content, or
  //    where the localhost URL is the file content).
  const rawExternalPreviewUrl = useMemo(() => {
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
  const runtimeLayerSnapshotEnabled =
    sourceType === "localhost" &&
    Boolean(rawExternalPreviewUrl) &&
    Boolean(onRuntimeLayerSnapshot);
  const activeExternalSnapshotHtml =
    externalSnapshotHtml ??
    (fetchedExternalSnapshot?.url === rawExternalPreviewUrl
      ? fetchedExternalSnapshot.html
      : undefined);
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
      buildEditorChromeBridgeScript({
        readOnly,
        editMode,
        editorChromeScaleX: 1,
        editorChromeScaleY: 1,
        screenId: screenId ?? contentKey ?? "",
        boardSurface,
        contentOffsetX: embeddedFrame?.contentOffsetX ?? 0,
        contentOffsetY: embeddedFrame?.contentOffsetY ?? 0,
        runtimeLayerSnapshotEnabled,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardSurface, contentKey, runtimeLayerSnapshotEnabled, screenId],
  );
  // Keep the installed gesture script identical between overview and focused
  // mode. The live flags are posted below; baking `isEmbeddedFrame` into the
  // script changed the bridge key during Full view and defeated the
  // registration handoff cache, forcing an avoidable iframe navigation.
  const embeddedGestureBridgeForCurrentState = useMemo(
    () =>
      EMBEDDED_WHEEL_BRIDGE_SCRIPT.replace(
        "__EMBEDDED_WHEEL_FORWARDING_ENABLED__",
        "false",
      )
        .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "false")
        .replace("__EDITING_SAFETY_ENABLED__", interactMode ? "false" : "true"),
    [interactMode],
  );
  const includeLiveEditEditorChrome = !interactMode && !readOnly;
  const liveEditBridgeScript = useMemo(
    () =>
      includeLiveEditEditorChrome
        ? MOTION_PREVIEW_BRIDGE_SCRIPT +
          SHADER_FILL_PREVIEW_BRIDGE_SCRIPT +
          TWEAK_BRIDGE_SCRIPT +
          ZOOM_BRIDGE_SCRIPT +
          LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT +
          embeddedGestureBridgeForCurrentState +
          editorChromeBridgeForCurrentState
        : embeddedGestureBridgeForCurrentState,
    [
      editorChromeBridgeForCurrentState,
      embeddedGestureBridgeForCurrentState,
      includeLiveEditEditorChrome,
    ],
  );
  const liveEditBridgeKey = useMemo(
    () => contentHash(liveEditBridgeScript),
    [liveEditBridgeScript],
  );
  const registrationHandoffKey = liveEditRegistrationHandoffKey(
    bridgeUrl,
    liveEditBridgeKey,
  );
  const hasLiveEditExternalFrame =
    sourceType === "localhost" && Boolean(bridgeUrl && rawExternalPreviewUrl);
  const hasAuthenticatedLiveEditExternalFrame =
    hasLiveEditExternalFrame && Boolean(previewToken);
  const usesLiveEditInjectedBridge =
    sourceType === "localhost" &&
    Boolean(bridgeUrl && previewToken && rawExternalPreviewUrl);
  const usesLiveEditEditorBridge =
    usesLiveEditInjectedBridge && includeLiveEditEditorChrome;
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
    previewToken,
    previewUrl: rawExternalPreviewUrl,
    hasSnapshotConsumer: Boolean(onExternalContentSnapshot),
  });
  const liveEditExternalPreviewUrl = resolveLiveEditPreviewUrl({
    sourceType,
    bridgeUrl,
    previewToken,
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
  const iframeRenderContent =
    !hasAuthenticatedLiveEditExternalFrame && activeExternalSnapshotHtml
      ? activeExternalSnapshotHtml
      : interactMode
        ? content
        : renderedContent;

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
  const externalPreviewUrl =
    liveEditExternalPreviewUrl ??
    (hasLiveEditExternalFrame
      ? null
      : activeExternalSnapshotHtml
        ? null
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
  zoomRef.current = zoom;
  runtimeReplacementContentRef.current = runtimeReplacementContent;
  runtimeReplacementKeyRef.current = runtimeReplacementKey;

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
  useEffect(() => {
    if (!usesLiveEditInjectedBridge || !bridgeUrl || !previewToken) {
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
      setLiveEditSameInstanceStalledError(null);
      lateLiveEditReadyRecoveryRef.current = null;
      return;
    }
    let cancelled = false;
    let retryTimer: number | undefined;
    setRegisteredLiveEditBridgeKey((current) =>
      current === liveEditBridgeKey ? current : null,
    );
    const scheduleRetry = () => {
      if (cancelled) return;
      const delay = getSnapshotRetryDelayMs(
        bridgeRegistrationRetryAttemptRef.current,
      );
      bridgeRegistrationRetryAttemptRef.current += 1;
      retryTimer = window.setTimeout(() => {
        setBridgeRegistrationRetryNonce((nonce) => nonce + 1);
      }, delay);
    };
    void (async () => {
      const endpoint = new URL("/live-edit-bridge", bridgeUrl).toString();
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-design-preview-token": previewToken,
          },
          body: JSON.stringify({
            script: liveEditBridgeScript,
            bridgeKey: liveEditBridgeKey,
          }),
        });
        if (!response.ok) {
          throw new Error(`Bridge registration failed (${response.status})`);
        }
        const payload = (await response.json().catch(() => null)) as {
          bridgeInstanceId?: string;
        } | null;
        if (payload && typeof payload.bridgeInstanceId === "string") {
          // Cache the instance id from THIS successful registration so a
          // later suspected-restart probe (see handleSuspectedBridgeRestart)
          // can tell a genuinely restarted bridge process apart from the same
          // process rejecting a stale key.
          bridgeInstanceIdRef.current = payload.bridgeInstanceId;
        }
        if (cancelled) return;
        bridgeRegistrationRetryAttemptRef.current = 0;
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
        lateLiveEditReadyRecoveryRef.current = null;
        setRegisteredLiveEditBridgeKey(liveEditBridgeKey);
      } catch (error) {
        if (!cancelled) {
          if (registrationHandoffKey) {
            liveEditRegistrationHandoff.delete(registrationHandoffKey);
          }
          console.warn("live-edit bridge registration failed", error);
          setRegisteredLiveEditBridgeKey(null);
          setBridgeRegistrationError({
            bridgeKey: liveEditBridgeKey,
            message: error instanceof Error ? error.message : String(error),
          });
          scheduleRetry();
        }
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [
    bridgeRegistrationRetryNonce,
    bridgeUrl,
    liveEditBridgeKey,
    liveEditBridgeScript,
    previewToken,
    registrationHandoffKey,
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

  // Manual retry (offline-state "Retry" button): reset the backoff so the
  // user-initiated attempt fires immediately, mirroring
  // handleManualSnapshotRetry below. Also clears the non-destructive
  // same-instance-id stalled-error card and its escalation state, since a
  // manual retry (from either error card) should start every counter fresh.
  const handleManualBridgeRegistrationRetry = useCallback(() => {
    bridgeRegistrationRetryAttemptRef.current = 0;
    liveEditRestartAttemptRef.current = 0;
    liveEditSameInstanceElapsedMsRef.current = 0;
    liveEditSameInstanceDelayRef.current = LIVE_EDIT_READY_TIMEOUT_MS;
    if (liveEditSameInstanceRearmTimerRef.current !== undefined) {
      window.clearTimeout(liveEditSameInstanceRearmTimerRef.current);
      liveEditSameInstanceRearmTimerRef.current = undefined;
    }
    setLiveEditSameInstanceStalledError(null);
    setBridgeRegistrationRetryNonce((nonce) => nonce + 1);
  }, []);

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
    if (!bridgeUrl || !previewToken) return;
    if (liveEditRestartInFlightRef.current) return;
    liveEditRestartInFlightRef.current = true;
    try {
      const response = await fetch(healthEndpointUrl(bridgeUrl));
      const payload = (await response.json().catch(() => null)) as {
        bridgeInstanceId?: string;
      } | null;
      if (isUnmountedRef.current) return;
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
          setBridgeRegistrationError({
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
        setBridgeRegistrationError(null);
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
          if (isUnmountedRef.current || bridgeReadyRef.current) return;
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
      setBridgeRegistrationError({
        bridgeKey: liveEditBridgeKey,
        message: t("designCanvas.localBridge.connectionNotConfirmed"),
      });
    } catch (error) {
      if (isUnmountedRef.current) return;
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
      setBridgeRegistrationError({
        bridgeKey: liveEditBridgeKey,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      liveEditRestartInFlightRef.current = false;
    }
  }, [bridgeUrl, liveEditBridgeKey, previewToken, registrationHandoffKey, t]);

  // Manual retry for the NON-destructive same-instance-id stalled card only
  // (see liveEditSameInstanceStalledError below): unlike
  // handleManualBridgeRegistrationRetry, registeredLiveEditBridgeKey was
  // never nulled here, so bumping bridgeRegistrationRetryNonce would not
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
      !previewToken ||
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
            "x-design-preview-token": previewToken,
          },
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          url?: string;
          html?: string;
          status?: number;
          contentType?: string;
          error?: string;
        } | null;
        if (cancelled) return;
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
        const stamped = ensureCodeLayerNodeIdsInHtml(sourceHtml, {
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
    previewToken,
  ]);

  // Manual retry (offline-state "Retry" button): reset the backoff so the
  // user-initiated attempt fires immediately rather than waiting out
  // whatever delay the auto-retry loop had climbed to, then trigger the
  // fetch effect above via the nonce dependency.
  const handleManualSnapshotRetry = useCallback(() => {
    snapshotRetryAttemptRef.current = 0;
    setExternalSnapshotRetryNonce((nonce) => nonce + 1);
  }, []);

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
      lastRuntimeReplacementKeyRef.current = runtimeReplacementKey;
      lastRuntimeReplacementContentRef.current = runtimeReplacementContent;
      // A content-key change rebuilds srcdoc, which reloads the iframe with a
      // brand-new document. The previous document's ready handshake (and any
      // one-shot commands still queued against it) no longer apply — reset
      // synchronously here rather than on the iframe's `load` event, since
      // `load` fires AFTER the freshly (re)injected editor-chrome bridge script
      // has already run and posted its own new ready message; resetting on
      // `load` would incorrectly clobber that just-arrived ready signal.
      bridgeReadyRef.current = false;
      pendingOneShotMessagesRef.current = [];
      setRenderedContent(content);
    }
    // Same-screen visual edits are already applied optimistically inside the
    // iframe before the source write is queued. Rebuilding srcdoc for that echo
    // reloads the iframe, flashes unstyled content, and drops selection. Only a
    // content-key change (screen switch / explicit remount) should replace the
    // iframe document here; the bridge replays inspector state after that load.
  }, [content, contentKey, runtimeReplacementContent, runtimeReplacementKey]);

  useEffect(() => {
    if (!interactMode) return;
    // Interact renders the authoritative persisted source because the editor
    // bridge is intentionally absent. Keep that same source as the next
    // edit-mode baseline so leaving Interact cannot resurrect the older
    // bridge-managed snapshot and make the design visibly jump backward.
    setRenderedContent(content);
  }, [content, interactMode]);

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
    zoomToCursor: deviceFrame === "none",
    enabled: Boolean(onZoomChange),
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
    if (deviceFrame !== "none") return;
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
  }, [deviceFrame, contentKey, previewWidthPx]);

  // Build the srcdoc. The tweak bridge ALWAYS goes in so the panel works
  // outside Edit mode. The editor chrome bridge is omitted for Interact mode
  // so preview/app users can interact with the app normally.
  //
  // readOnly and editMode are intentionally NOT deps here: the bridge is
  // injected whenever !interactMode and the initial __READ_ONLY__ /
  // __TEXT_EDITING_ENABLED__ placeholders are baked from the *first* render
  // only (so first paint never flashes the wrong mode). After that, live
  // readOnly / editMode changes flow through the set-read-only and
  // set-text-editing-enabled postMessages (see the useEffects below) so
  // switching the active surface (board ↔ screen) or toggling Edit ⇄ Preview
  // never rebuilds srcdoc / reloads every screen iframe.
  const srcdoc = useMemo(() => {
    if (externalPreviewUrl) return undefined;
    // Never boot the raw localhost URL (or an editor-enabled srcdoc) while
    // the keyed live-edit bridge is still registering. The opaque placeholder
    // stays behind the visible loading surface; the real iframe mounts once,
    // directly at the authenticated proxied document.
    if (waitingForLiveEditBridge) {
      return '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
    }
    const editorChromeBridge = interactMode
      ? ""
      : createEditorBridgeThemeScript(readEditorBridgeThemeVars()) +
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
          .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
    // ALWAYS injected (like the other always-on bridges above) so
    // MultiScreenCanvas's cross-screen drag hit-testing
    // (agent-native:hit-test / agent-native:hit-test-result) resolves an
    // anchor+placement against this screen's live DOM too, not only the
    // static-fallback board thumbnails that call appendHitTestResponder.
    // Without this, a drop onto a live/active screen has no responder and
    // always falls through to the 50ms request timeout.
    const bridgeToInject =
      MOTION_PREVIEW_BRIDGE_SCRIPT +
      SHADER_FILL_PREVIEW_BRIDGE_SCRIPT +
      TWEAK_BRIDGE_SCRIPT +
      ZOOM_BRIDGE_SCRIPT +
      NAV_BRIDGE_SCRIPT +
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT +
      embeddedGestureBridgeForCurrentState +
      editorChromeBridge;
    const frameContent = getEmbeddedFrameDocumentContent({
      content: iframeRenderContent,
      embeddedFrameBackground,
      transparentBackground,
      contentOffsetX: embeddedFrame?.contentOffsetX ?? 0,
      contentOffsetY: embeddedFrame?.contentOffsetY ?? 0,
    });
    if (frameContent.includes("</body>")) {
      return frameContent.replace("</body>", bridgeToInject + "</body>"); // i18n-ignore generated iframe HTML injection
    }
    if (frameContent.includes("</html>")) {
      return frameContent.replace("</html>", bridgeToInject + "</html>"); // i18n-ignore generated iframe HTML injection
    }
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
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${frameStyle}</head><body>${iframeRenderContent}${bridgeToInject}</body></html>`;
    // editorChromeScaleX/Y are intentionally NOT deps: they only seed the initial
    // baked chrome scale. Live zoom updates flow through the set-editor-chrome-scale
    // postMessage above. Including them here rebuilds srcdoc on every zoom commit,
    // which reloads the iframe and flashes the screen content white.
    // readOnly and editMode are intentionally NOT deps: live changes flow
    // through set-read-only / set-text-editing-enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    boardSurface,
    externalPreviewUrl,
    interactMode,
    isEmbeddedFrame,
    embeddedFrameBackground,
    embeddedGestureBridgeForCurrentState,
    iframeRenderContent,
    transparentBackground,
    waitingForLiveEditBridge,
  ]);

  // PERF (soak measurement 2): contentHash walks the full srcdoc string
  // char-by-char. `srcdoc` is already memoized above, but this call site
  // was NOT — so every board-wide re-render (e.g. `renderScreenContent`'s
  // identity churns on any screen's hover/selection change, invalidating
  // every screen's cached content node — see MultiScreenCanvas.tsx's PF21
  // comment) re-hashed every unaffected screen's full content again, with
  // cost scaling with total board content rather than the actual edit.
  // Profiling a 10-click selection sequence over a 31-screen board (one
  // screen with ~30KB of HTML) showed `contentHash` alone consuming
  // 300-2300ms of self time depending on board content size, and was the
  // single largest named JS contributor to the resulting 300-600ms
  // long tasks. Memoizing on the (already-stable) `srcdoc` reference
  // makes unrelated re-renders skip this entirely.
  const srcdocHash = useMemo(() => contentHash(srcdoc ?? ""), [srcdoc]);
  const iframeDocumentIdentity = externalPreviewUrl
    ? `src:${externalPreviewUrl}`
    : waitingForLiveEditBridge
      ? `live-edit-pending:${liveEditBridgeKey}`
      : `srcdoc:${contentKey ?? ""}:${srcdocHash}`;
  if (previousIframeDocumentIdentityRef.current !== iframeDocumentIdentity) {
    previousIframeDocumentIdentityRef.current = iframeDocumentIdentity;
    bridgeReadyRef.current = false;
  }
  const liveEditDocumentPending =
    usesLiveEditEditorBridge &&
    Boolean(externalPreviewUrl) &&
    readyIframeDocumentIdentity !== iframeDocumentIdentity;
  const liveEditTransitionFallbackHtml = liveEditDocumentPending
    ? activeExternalSnapshotHtml
    : undefined;

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
          allowedOrigins:
            sourceType === "localhost" && bridgeUrl
              ? [originFromUrl(bridgeUrl)].filter((origin): origin is string =>
                  Boolean(origin),
                )
              : [],
        });
      if (trustedRuntimeVerificationFrame) {
        if (e.data?.type !== "agent-native:runtime-layer-snapshot") return;
        const payload = e.data.payload;
        if (
          payload &&
          typeof payload.html === "string" &&
          payload.html.length <= 2_000_000 &&
          Number.isFinite(payload.nodeCount)
        ) {
          onRuntimeVerificationSnapshot?.({
            requestId: runtimeVerificationRequest.requestId,
            html: payload.html,
            nodeCount: Math.max(0, Math.floor(payload.nodeCount)),
            documentId:
              typeof payload.documentId === "string"
                ? payload.documentId
                : undefined,
          });
        }
        return;
      }
      const lateReadyRecovery =
        e.data?.type === "agent-native:editor-chrome-ready"
          ? lateLiveEditReadyRecoveryRef.current
          : null;
      // For fusion sources the Builder-hosted app is cross-origin, so the strict
      // `origin === parentOrigin` check can never match. We still require window
      // identity (the message must come from our own iframe window, not any
      // arbitrary cross-origin frame), AND we validate the message origin
      // against a Builder-host allowlist (the configured fusionUrl origin or the
      // *.builder.io family) before relaxing the origin check. If the origin is
      // not on the allowlist we keep the strict check so a hostile frame that
      // somehow shares our window reference still can't be trusted.
      const trustedCurrentFrame =
        sourceType === "fusion"
          ? iframeWindow !== null &&
            e.source === iframeWindow &&
            isAllowedFusionOrigin(e.origin, fusionUrl)
          : isTrustedCanvasBridgeMessage({
              source: e.source,
              origin: e.origin,
              iframeWindow,
              parentOrigin: window.location.origin,
              allowedOrigins:
                sourceType === "localhost" && bridgeUrl
                  ? [originFromUrl(bridgeUrl)].filter(
                      (origin): origin is string => Boolean(origin),
                    )
                  : [],
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
          allowedOrigins: [originFromUrl(bridgeUrl)].filter(
            (origin): origin is string => Boolean(origin),
          ),
        });
      const trusted = trustedCurrentFrame || trustedLateLiveEditReady;
      if (!trusted) {
        return;
      }
      if (!e.data || !e.data.type) return;
      if (e.data.type === "agent-native:runtime-reloading") {
        // A local dev server full reload is unavoidable after some source
        // writes. Keep the last authenticated snapshot painted instead of
        // exposing the iframe's blank navigation frame; the replacement
        // document's ready handshake clears this fallback again.
        if (usesLiveEditEditorBridge) {
          setReadyIframeDocumentIdentity(null);
        }
        return;
      }
      if (e.data.type === "agent-native:runtime-layer-snapshot") {
        const payload = e.data.payload;
        if (
          payload &&
          typeof payload.html === "string" &&
          payload.html.length <= 2_000_000 &&
          Number.isFinite(payload.nodeCount)
        ) {
          onRuntimeLayerSnapshot?.({
            html: payload.html,
            nodeCount: Math.max(0, Math.floor(payload.nodeCount)),
            documentId:
              typeof payload.documentId === "string"
                ? payload.documentId
                : undefined,
          });
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
          setBridgeRegistrationError((current) =>
            current?.bridgeKey === lateReadyRecovery.bridgeKey ? null : current,
          );
          setRegisteredLiveEditBridgeKey(lateReadyRecovery.bridgeKey);
          return;
        }
        lateLiveEditReadyRecoveryRef.current = null;
        bridgeReadyRef.current = true;
        setReadyIframeDocumentIdentity(iframeDocumentIdentity);
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
        return;
      }
      if (e.data.type === "clear-selection") {
        onClearSelection?.();
        return;
      }
      if (e.data.type === "element-select") {
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
        onEditorDragStateChange?.(Boolean(e.data.active));
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
              originalStyles,
            },
          );
        }
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
        if (selector) {
          onTextContentChange?.(selector, value, e.data.payload, {
            html,
            originalValue,
            originalHtml,
          });
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
          const applied = onVisualStructureChange?.(
            selector,
            anchorSelector,
            placement,
            e.data.payload,
            {
              requestId,
              sourceId,
              anchorSourceId,
              dropMode,
              forceFlowPositionOverride:
                e.data.forceFlowPositionOverride === true,
              sourceRect,
              anchorRect,
              anchorElementInfo: isElementInfoPayload(e.data.anchorPayload)
                ? e.data.anchorPayload
                : undefined,
            },
          );
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
      if (e.data.type === "text-edit-pending") {
        // The bridge is waiting for a just-created node before it can enter
        // text-edit mode (begin-text-edit arrived first). Arm the host-side
        // keystroke buffer for the window — repeated pending:true re-posts
        // for the same node (DesignEditor's T6 retry loop) only extend the
        // wait, never reset an in-progress buffer.
        const pendingNodeId =
          typeof e.data.nodeId === "string" ? e.data.nodeId : "";
        const currentPending = pendingTextEditRef.current;
        if (e.data.pending && pendingNodeId) {
          if (currentPending && currentPending.nodeId === pendingNodeId) {
            currentPending.startedAt = Date.now();
          } else {
            pendingTextEditRef.current = {
              nodeId: pendingNodeId,
              buffer: "",
              startedAt: Date.now(),
            };
          }
        } else if (currentPending?.nodeId === pendingNodeId) {
          pendingTextEditRef.current = null;
        }
        return;
      }
      if (e.data.type === "text-editing-state") {
        // Creation-race replay: the bridge just armed the session for the
        // node we were waiting on — flush any keystrokes the host buffered
        // during the round-trip window into the now-live editable.
        if (e.data.active && pendingTextEditRef.current) {
          const pendingBuffer = pendingTextEditRef.current.buffer;
          pendingTextEditRef.current = null;
          if (pendingBuffer) {
            postOneShotBridgeMessage({
              type: "text-edit-insert-text",
              text: pendingBuffer,
            });
          }
        }
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
      if (e.data.type === "figma-clipboard-paste") {
        const content =
          typeof e.data.content === "string" ? e.data.content : "";
        if (content) onFigmaClipboardPaste?.({ content });
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
        // Mirror usePinchZoom's algorithm here. We can't reliably re-dispatch
        // a synthetic WheelEvent to trigger the hook's listener — untrusted
        // events are inconsistent across browsers — so just compute the
        // next zoom directly using the same exponential factor + cursor-anchor
        // math. Clamp range matches the usePinchZoom call above
        // (DEFAULT_CANVAS_MIN_ZOOM–DEFAULT_CANVAS_MAX_ZOOM).
        const currentZoom = zoomRef.current;
        const clampedDelta = Math.max(-50, Math.min(50, rawDeltaY));
        const factor = Math.exp(-clampedDelta * 0.01);
        const nextZoom = Math.max(
          DEFAULT_CANVAS_MIN_ZOOM,
          Math.min(DEFAULT_CANVAS_MAX_ZOOM, currentZoom * factor),
        );
        if (!Number.isFinite(nextZoom) || nextZoom === currentZoom) return;
        if (deviceFrame === "none") {
          const rawClientX = Number(e.data.clientX);
          const rawClientY = Number(e.data.clientY);
          if (!Number.isFinite(rawClientX) || !Number.isFinite(rawClientY)) {
            onZoomChange(nextZoom);
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
    onRuntimeLayerSnapshot,
    onRuntimeVerificationSnapshot,
    onElementMarqueeSelect,
    onElementHover,
    onClearSelection,
    onVisualStyleChange,
    onGradientEditChange,
    onTextContentChange,
    onTextEditingStateChange,
    onElementDblClickText,
    onIframeHotkey,
    onFigmaClipboardPaste,
    onIframeContextMenu,
    onEditorDragStateChange,
    onVisualStructureChange,
    onVisualDuplicateChange,
    onZoomChange,
    deviceFrame,
    onPrototypeNavigate,
    onComponentSourceJump,
    isEmbeddedFrame,
    sourceType,
    bridgeUrl,
    liveEditBridgeKey,
    runtimeVerificationRequest,
    fusionUrl,
    flushPendingOneShotMessages,
    postOneShotBridgeMessage,
  ]);

  const replayIframeEditorState = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
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
      {
        type: "select-elements",
        selectorGroups: selectedSelectorGroups,
      },
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
    hoveredSelector,
    hoveredSelectorCandidates,
    hiddenSelectors,
    lockedSelectors,
    motionTracks,
    motionDefaultEase,
    motionDurationMs,
    scaleMode,
    selectedSelector,
    selectedSelectorCandidates,
    selectedSelectorGroups,
    shaderFillPreview,
    spacePanActive,
    statePreviewTarget,
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
      if (bridgeReadyRef.current) return;
      bridgeReadyRef.current = true;
      flushPendingOneShotMessages();
    }
    iframe.addEventListener("load", handleLoadReadyFallback);
    return () => iframe.removeEventListener("load", handleLoadReadyFallback);
  }, [flushPendingOneShotMessages, usesLiveEditEditorBridge]);

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

  // Push the constant-size chrome scale into the iframe LIVE (CSS vars only) when
  // overview zoom settles. This is intentionally separate from the srcdoc build so
  // a scale change never rebuilds srcdoc / reloads the iframe (which flashes the
  // content white). The baked __EDITOR_CHROME_SCALE__ values cover first paint.
  // Routed through the one-shot queue too: a zoom settle that lands while the
  // iframe is mid-reload would otherwise be silently dropped, leaving the
  // chrome at a stale scale until the next zoom change.
  useEffect(() => {
    postOneShotBridgeMessage({
      type: "set-editor-chrome-scale",
      scaleX: effectiveEditorChromeScaleX,
      scaleY: effectiveEditorChromeScaleY,
    });
  }, [
    effectiveEditorChromeScaleX,
    effectiveEditorChromeScaleY,
    postOneShotBridgeMessage,
  ]);

  // Overview/focused placement is presentation state, not document identity.
  // Update gesture routing in place so entering Full view reuses the same
  // registered bridge key instead of rebuilding the injected script.
  useEffect(() => {
    postOneShotBridgeMessage({
      type: "embedded-canvas-gesture-mode",
      wheelEnabled: isEmbeddedFrame,
      spaceKeyForwardingEnabled: interactMode || readOnly,
    });
  }, [interactMode, isEmbeddedFrame, postOneShotBridgeMessage, readOnly]);

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

  // Sync editMode to the bridge IN-PLACE via postMessage so toggling Edit ⇄
  // Preview does not rebuild srcdoc / reload every screen iframe (which was
  // PF21: __TEXT_EDITING_ENABLED__ used to be baked into srcdoc, so flipping
  // edit/preview mode reloaded every iframe — white flash + lost in-iframe
  // Alpine state). The initial baked __TEXT_EDITING_ENABLED__ placeholder
  // covers first paint; subsequent changes arrive here. Also re-send on
  // iframe load so the bridge is in sync after any content-key-driven reload.
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
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
  const beginTextEdit = useCallback(
    (nodeId: string, options?: { afterPointerGesture?: boolean }) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || !nodeId) return;
      // Arm the creation-race keystroke buffer (see routePendingTextEditKey):
      // until the bridge reports text-editing-state active for this command,
      // host keystrokes are buffered/swallowed instead of hitting host
      // shortcuts, then replayed into the editable. Re-arming for the same
      // node preserves an in-progress buffer.
      if (pendingTextEditRef.current?.nodeId !== nodeId) {
        pendingTextEditRef.current = {
          nodeId,
          buffer: "",
          startedAt: Date.now(),
        };
      }
      schedulePendingTextEditActivation(
        () => {
          postOneShotBridgeMessage({
            type: "begin-text-edit",
            nodeId,
            force: true,
          });
        },
        { afterPointerGesture: options?.afterPointerGesture },
      );
    },
    [postOneShotBridgeMessage],
  );

  // Creation-race keystroke routing (host side). Active only while a
  // beginTextEdit() command is pending; see routePendingTextEditKey's doc
  // comment for the exact policy. Capture-phase on window so it runs before
  // the editor's own shortcut handlers.
  const pendingTextEditRef = useRef<{
    nodeId: string;
    buffer: string;
    startedAt: number;
  } | null>(null);
  useEffect(() => {
    function onPendingTextEditKeyDown(e: KeyboardEvent) {
      const pending = pendingTextEditRef.current;
      if (!pending) return;
      if (Date.now() - pending.startedAt > PENDING_TEXT_EDIT_TIMEOUT_MS) {
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
        pendingTextEditRef.current = null;
      }
    }
    function onPendingTextEditPointerDown() {
      // The user clicked somewhere else in the host — stand down so buffered
      // keys are never replayed into an edit they've abandoned.
      pendingTextEditRef.current = null;
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
      options?: { selectorCandidates?: string[]; nodeId?: string | null },
    ) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;
      postOneShotBridgeMessage({
        type: "style-change",
        selector,
        property,
        value,
        selectorCandidates: options?.selectorCandidates ?? [],
        nodeId: options?.nodeId ?? "",
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
    }) => {
      postOneShotBridgeMessage({
        type: "interaction-state-style-preview",
        selector: args.selector,
        selectorCandidates: args.selectorCandidates ?? [],
        nodeId: args.nodeId ?? "",
        state: args.state,
        styles: args.styles,
      });
    },
    [postOneShotBridgeMessage],
  );

  const lastStyleRevertRequestIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!styleRevertRequest) return;
    if (lastStyleRevertRequestIdRef.current === styleRevertRequest.requestId) {
      return;
    }
    lastStyleRevertRequestIdRef.current = styleRevertRequest.requestId;
    for (const patch of styleRevertRequest.patches) {
      const selectorCandidates = [
        patch.selector,
        patch.sourceId
          ? `[data-agent-native-node-id="${String(patch.sourceId)
              .replace(/\\/g, "\\\\")
              .replace(/"/g, '\\"')}"]`
          : "",
      ].filter(Boolean);
      if (patch.interactionState) {
        sendInteractionStatePreviewStyle({
          selector: patch.selector,
          selectorCandidates,
          nodeId: patch.sourceId,
          state: patch.interactionState,
          styles: patch.styles,
        });
        continue;
      }
      for (const [property, value] of Object.entries(patch.styles)) {
        postOneShotBridgeMessage({
          type: "style-change",
          selector: patch.selector,
          property,
          value,
          selectorCandidates,
          nodeId: patch.sourceId ?? "",
        });
      }
    }
  }, [
    postOneShotBridgeMessage,
    sendInteractionStatePreviewStyle,
    styleRevertRequest,
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
    postOneShotBridgeMessage({
      type: "runtime-structure-move",
      subjectSelector: runtimeStructureMoveRequest.subject.selector,
      subjectSourceId: runtimeStructureMoveRequest.subject.sourceId,
      anchorSelector: runtimeStructureMoveRequest.anchor.selector,
      anchorSourceId: runtimeStructureMoveRequest.anchor.sourceId,
      placement: runtimeStructureMoveRequest.placement,
    });
  }, [postOneShotBridgeMessage, runtimeStructureMoveRequest]);

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
      },
    ) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      return postOneShotBridgeMessage({
        type: "replace-document-content",
        content: nextContent,
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
      nextContent: string,
      selector?: string | null,
      candidates?: string[],
      options?: {
        forceFullDocument?: boolean;
        preserveTextEditingSession?: boolean;
      },
    ) => {
      const replaced = replacePreviewContent(
        nextContent,
        selector,
        candidates,
        options,
      );
      if (replaced) {
        // The orchestrator applied these exact bytes imperatively before the
        // React props carrying their new runtimeReplacementKey rendered.
        // Remember them so that render can acknowledge the new key without
        // applying the same forced replacement a second time.
        lastRuntimeReplacementContentRef.current = nextContent;
      }
      return replaced;
    },
    [replacePreviewContent],
  );

  const replaceRuntimeContentInPlace = useCallback(
    (nextContent: string) => {
      if (externalPreviewUrl) return false;
      return replacePreviewContent(
        getEmbeddedFrameDocumentContent({
          content: nextContent,
          embeddedFrameBackground,
          transparentBackground,
          contentOffsetX: embeddedFrame?.contentOffsetX ?? 0,
          contentOffsetY: embeddedFrame?.contentOffsetY ?? 0,
        }),
        null,
        [],
        {
          forceFullDocument: true,
          // Prop/save echoes are synchronization, not a user command. If a
          // text draft is active, buffer the newest generation until commit
          // instead of tearing down its caret mid-keystroke.
          preserveTextEditingSession: true,
        },
      );
    },
    [
      embeddedFrame?.contentOffsetX,
      embeddedFrame?.contentOffsetY,
      embeddedFrameBackground,
      externalPreviewUrl,
      replacePreviewContent,
      transparentBackground,
    ],
  );

  useEffect(() => {
    if (
      runtimeReplacementKey === undefined ||
      runtimeReplacementContent === undefined ||
      lastRuntimeReplacementKeyRef.current === runtimeReplacementKey
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
      pendingOneShotMessagesRef.current = [];
      setRenderedContent(runtimeReplacementContent);
      return;
    }
    if (replaceRuntimeContentInPlace(runtimeReplacementContent)) {
      lastRuntimeReplacementKeyRef.current = runtimeReplacementKey;
      lastRuntimeReplacementContentRef.current = runtimeReplacementContent;
    }
  }, [
    replaceRuntimeContentInPlace,
    renderedContent,
    runtimeReplacementContent,
    runtimeReplacementKey,
  ]);

  const runtimeReplacementEnabled = runtimeReplacementKey !== undefined;
  useEffect(() => {
    if (!runtimeReplacementEnabled) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const replaceLatestRuntimeContent = () => {
      const nextContent = runtimeReplacementContentRef.current;
      if (nextContent === undefined) return;
      if (replaceRuntimeContentInPlace(nextContent)) {
        lastRuntimeReplacementKeyRef.current = runtimeReplacementKeyRef.current;
        lastRuntimeReplacementContentRef.current = nextContent;
      }
    };
    iframe.addEventListener("load", replaceLatestRuntimeContent);
    return () =>
      iframe.removeEventListener("load", replaceLatestRuntimeContent);
  }, [replaceRuntimeContentInPlace, runtimeReplacementEnabled]);

  const deleteRuntimeElement = useCallback(
    (selector?: string | null, candidates?: string[]) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      return postOneShotBridgeMessage({
        type: "delete-element",
        selector: selector ?? "",
        selectorCandidates: candidates ?? [],
      });
    },
    [postOneShotBridgeMessage],
  );

  // Expose iframe runtime mutations for the editor orchestrator.
  useEffect(() => {
    if (!registerRuntimeBridge) return;
    (window as any).__designCanvasSendStyle = sendStyleChange;
    (window as any).__designCanvasSendInteractionStatePreviewStyle =
      sendInteractionStatePreviewStyle;
    (window as any).__designCanvasReplaceContent =
      replacePreviewContentFromHost;
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
        (window as any).__designCanvasSendInteractionStatePreviewStyle ===
        sendInteractionStatePreviewStyle
      ) {
        delete (window as any).__designCanvasSendInteractionStatePreviewStyle;
      }
      if (
        (window as any).__designCanvasReplaceContent ===
        replacePreviewContentFromHost
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
    replacePreviewContentFromHost,
    sendStyleChange,
    sendInteractionStatePreviewStyle,
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
  const focusScrollSurface = useCallback(() => {
    const surface = scrollContainerRef.current;
    if (!surface || document.activeElement === surface) return;
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
      className="design-canvas-iframe-wrapper relative inline-block ring-1 ring-border/60 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.45)]"
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
          : deviceFrame === "none"
            ? "100%"
            : (iframeHeight ?? undefined),
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
      {liveEditTransitionFallbackHtml ? (
        <iframe
          data-live-edit-transition-fallback
          srcDoc={liveEditTransitionFallbackHtml}
          sandbox=""
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 block h-full w-full border-0 bg-transparent"
          style={{
            background: iframeBackgroundColor,
            backgroundColor: iframeBackgroundColor,
          }}
          title=""
        />
      ) : null}
      <iframe
        key={iframeDocumentIdentity}
        ref={iframeRef}
        src={externalPreviewUrl ?? undefined}
        srcDoc={externalPreviewUrl ? undefined : srcdoc}
        sandbox={getDesignCanvasIframeSandbox({
          externalPreview: Boolean(externalPreviewUrl),
          readOnly,
        })}
        data-design-preview-iframe
        data-screen-iframe-id={
          boardSurface ? undefined : (previewFrameId ?? screenId ?? undefined)
        }
        data-design-source-type={
          sourceType ??
          (externalPreviewUrl
            ? "localhost" // inferred — content is a URL
            : "inline")
        }
        className={cn(
          "relative block h-full w-full border-0 bg-transparent",
          liveEditTransitionFallbackHtml && "pointer-events-none opacity-0",
        )}
        style={{
          background: iframeBackgroundColor,
          backgroundColor: iframeBackgroundColor,
        }}
        title={t("designEditor.designPreview")}
      />
      {runtimeVerificationUrl ? (
        <iframe
          key={`${runtimeVerificationUrl}::${runtimeVerificationRequest?.requestId ?? 0}`}
          ref={runtimeVerificationIframeRef}
          src={runtimeVerificationUrl}
          sandbox={getDesignCanvasIframeSandbox({
            externalPreview: true,
            readOnly: true,
          })}
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
      {/* Single-screen click-to-place creation overlay — sits over the
          iframe, NOT inside it, mirroring the SharedDrawOverlay pattern
          below. Only mounts while a creation tool is active so it never
          changes existing behavior otherwise (T14: single-screen mode
          previously had no creation capability at all). */}
      {activeCreationTool ? (
        <SingleScreenCreationOverlay
          tool={activeCreationTool}
          iframeRef={iframeRef}
          onCreatePrimitive={onCreatePrimitive}
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
      {waitingForEditableExternalSnapshot ||
      waitingForLiveEditBridge ||
      (liveEditDocumentPending && !liveEditTransitionFallbackHtml) ? (
        <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-background/85 px-4 text-center text-sm text-muted-foreground">
          {waitingForLiveEditBridge &&
          bridgeRegistrationError?.bridgeKey === liveEditBridgeKey ? (
            // Mirrors the snapshot-fetch offline card below: a stuck
            // registration used to look identical to ordinary "still
            // registering" with no explanation and no way to recover short
            // of a full page reload. Only shown for the CURRENT
            // liveEditBridgeKey — a stale error from a previous script
            // revision must not linger after content/mode changes move on
            // to registering a new one.
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
                {bridgeRegistrationError.message}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleManualBridgeRegistrationRetry}
              >
                <IconRefresh className="size-3.5" />
                {"Retry" /* i18n-ignore local dev bridge retry button */}
              </Button>
            </div>
          ) : waitingForLiveEditBridge ? (
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
        queuedAnnotationCount={queuedAnnotationPins.length}
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
          const message = lines.join("\n");
          const hasQueuedPins = queuedAnnotationPins.length > 0;

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
          captureAnnotatedScreenshot({
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
                hasQueuedPins,
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
                markQueuedPinsSubmitted: () => {
                  setPinSubmitSignal((signal) => signal + 1);
                },
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

  if (embeddedFrame) {
    if (embeddedFrameFluid) {
      return (
        <div
          ref={scrollContainerRef}
          tabIndex={-1}
          onPointerEnter={focusScrollSurface}
          onMouseEnter={focusScrollSurface}
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
        tabIndex={-1}
        onPointerEnter={focusScrollSurface}
        onMouseEnter={focusScrollSurface}
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
      {deviceFrame === "none" ? (
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
            transform:
              zoom < 100
                ? `translate(${(100 - zoom) / 2}%, ${(100 - zoom) / 2}%) scale(${zoom / 100})`
                : `scale(${zoom / 100})`,
            transformOrigin: "top left",
          }}
        >
          {wrappedContent}
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
          the zoom-transformed container to keep coordinates stable.
          Suppressed entirely when commentPinsHidden (Figma-style Shift+C
          "hide comments" toggle) is set — existing pins disappear and pin
          drop-mode has nothing to render into until it's toggled back on. */}
      {!commentPinsHidden && (
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
      )}
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
}

const SINGLE_SCREEN_PEN_HIT_RADIUS_PX = 10;

interface SingleScreenCreationOverlayProps {
  tool: CreationTool;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onCreatePrimitive?: (spec: CreatePrimitiveSpec) => void;
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
  onCreatePrimitive,
}: SingleScreenCreationOverlayProps) {
  const [drag, setDrag] = useState<CreationDragState | null>(null);
  const dragRef = useRef<CreationDragState | null>(null);
  const [penPath, setPenPath] = useState<PenPath | null>(null);
  const penPathRef = useRef<PenPath | null>(null);
  const [penGesturePreview, setPenGesturePreview] = useState<PenPath | null>(
    null,
  );
  const penGestureRef = useRef<SingleScreenPenGestureState | null>(null);
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
    updatePenPath(null);
    penGestureRef.current = null;
    setPenGesturePreview(null);
    setPenPointer(null);
    setPenCloseHover(false);
  }, [updatePenPath]);

  const finishPenPath = useCallback(
    (
      path: PenPath | null = penPathRef.current,
      options?: { preserveActiveTool?: boolean },
    ) => {
      const committed = path ? clonePenPath(path) : null;
      clearPenPath();
      if (!committed || committed.nodes.length < 2 || !onCreatePrimitive) {
        return;
      }
      onCreatePrimitive({
        tool: "pen",
        points: committed.nodes.map((node) => node.point),
        penPath: committed,
        fromClick: false,
        preserveActiveTool: options?.preserveActiveTool,
      });
    },
    [clearPenPath, onCreatePrimitive],
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
        const currentPath = penPathRef.current?.closed
          ? null
          : penPathRef.current;
        const pathBefore = currentPath ? clonePenPath(currentPath) : null;
        const rawPoint = toContentPoint(e.clientX, e.clientY);
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
                ? createSmoothNode(gesture.anchor, handleOut, {
                    breakSymmetry: e.altKey,
                  })
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
                ? createSmoothNode(gesture.anchor, handleOut, {
                    breakSymmetry: e.altKey,
                  })
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
      finishPenPath(path, { preserveActiveTool: true });
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
