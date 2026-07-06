import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import {
  getBreakpointOverrideState,
  type BreakpointOverrideState,
} from "@shared/breakpoint-media";
import {
  composeTransform3D,
  isTransform3DActive,
  parseTransform3DParts,
  type Transform3DParts,
} from "@shared/canvas-math";
import {
  alphaToOpacity,
  parseCssColor,
  rgbaToCss,
  rgbaToHex,
  withColorOpacity,
} from "@shared/color-utils";
import { propNameToDataAttribute } from "@shared/component-model";
import {
  listInteractionStates,
  readStateStyles,
  type InteractionState,
} from "@shared/interaction-states";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconAngle,
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconArrowRight,
  IconAxisX,
  IconAxisY,
  IconBackground,
  IconBlur,
  IconBorderCorners,
  IconBorderRadius,
  IconBorderStyle,
  IconBrush,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconComponents,
  IconExternalLink,
  IconDroplet,
  IconEye,
  IconEyeOff,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFrame,
  IconGridDots,
  IconGripVertical,
  IconLayoutDistributeHorizontal,
  IconLayoutGrid,
  IconLoader2,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLetterCase,
  IconLetterSpacing,
  IconLineHeight,
  IconLink,
  IconLinkOff,
  IconMinus,
  IconPerspective,
  IconPhoto,
  IconPlus,
  IconRadiusBottomLeft,
  IconRadiusBottomRight,
  IconRadiusTopLeft,
  IconRadiusTopRight,
  IconRefresh,
  IconRotate3d,
  IconShadow,
  IconSquare,
  IconTypography,
  IconUnlink,
  IconVector,
  IconWaveSine,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  alpineDataValueLiteral,
  canRebuildAlpineDataLosslessly,
  elementHtmlPreview,
  highlightedHtml,
  isBooleanPropValue,
  normalizedElementTagName,
  openingTagOf,
  parseAlpineDataObject,
  replaceAlpineDataKeyValue,
  serializeAlpineDataObject,
  truncateOpeningTag,
  vscodeDeepLink,
} from "./edit-panel/code-inspect-helpers";
import {
  deriveLockedAspectSize,
  elementIdentityKey,
  useAspectRatioLock,
} from "./edit-panel/element-identity";
import {
  averageGradientOpacity,
  buildFillRows,
  buildGradientLayer,
  DEFAULT_EXPORT_SETTINGS,
  defaultGradientLayer,
  defaultGradientStops,
  clampNumber,
  fillLayerId,
  fillLayerIndex,
  type FillLayerArrays,
  gradientLabel,
  isLayerHiddenBySize,
  joinCssLayers,
  parseGradientLayer,
  removeFillLayerAtIndex,
  SOLID_FILL_ID,
  splitCssLayers,
  withLayerSizeMarker,
} from "./edit-panel/fill-gradient-helpers";
import {
  colorHasVisibleAlpha,
  compactCssValue,
  cssColorOrFallback,
  cssLengthNumber,
  outlineOffsetForPosition,
  readStrokeOutlinePosition,
  readTextStrokeStyle,
  resolveTextStrokeColor,
  roundToOneDecimal,
  strokeHiddenByColor,
  strokeIsVisible,
  swatchStyle,
  textStrokeIsVisible,
} from "./edit-panel/position-helpers";
import {
  mergeRotationValue,
  mergeTranslateFunction,
  normalizeRotationDegrees,
  parseRotationValue,
  parseScaleValue,
} from "./edit-panel/transform-helpers";
import {
  displayFontFamilyName,
  FONT_FAMILY_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  resolveFontFamilySelectValue,
  splitFontFamilyList,
  type TextResizeMode,
} from "./edit-panel/typography-helpers";
import {
  AutoLayoutMatrix,
  BreakpointOverrideIndicator,
  ConstraintsPreview,
  ConstraintsWidget,
  ExportSettingsPanel,
  DesignColorPicker,
  FRAME_SIZE_PRESET_CATEGORIES,
  MotionKeyframeDiamond,
  motionPropertyHasKeyframe,
  ScrubInput,
  SizingField,
  type AlignmentMatrixValue,
  type AutoLayoutMatrixValue,
  type AutoLayoutSizing,
  type AutoLayoutSizingAxis,
  type ConstraintsValue,
  type ExportSettingsValue,
  type FrameSizePreset,
  type FrameSizePresetCategoryKey,
  imageFillToBackgroundStyles,
  InteractionStatePanel,
  type ActiveInteractionState,
  type DesignFillRow,
  type DesignFillRowPatch,
  type DesignGradientStop,
  type DesignGradientStopPatch,
  type DesignGradientType,
  type ImageFillValue,
  type MotionKeyframeCssProperty,
  type ScrubInputChangeMeta,
} from "./inspector";
import { IconLayoutSettings } from "./inspector/design-icons";
import type { DesignPaintType } from "./inspector/DesignColorPicker";
import {
  GlslShaderEffectSection,
  type GlslShaderPanelContext,
} from "./inspector/GlslShaderPanel";
import { ReviewPanel } from "./ReviewPanel";
import type { ReviewPanelProps } from "./ReviewPanel";
import type { StatesPanelProps } from "./StatesPanel";
import { TweaksPanelContent } from "./TweaksPanel";
import type { ElementInfo } from "./types";

export {
  alpineDataValueLiteral,
  canRebuildAlpineDataLosslessly,
  elementHtmlPreview,
  isBooleanPropValue,
  openingTagOf,
  parseAlpineDataObject,
  replaceAlpineDataKeyValue,
  serializeAlpineDataObject,
  truncateOpeningTag,
};
export {
  buildGradientLayer,
  isLayerHiddenBySize,
  joinCssLayers,
  parseGradientLayer,
  removeFillLayerAtIndex,
  splitCssLayers,
  withLayerSizeMarker,
  type FillLayerArrays,
};
export {
  outlineOffsetForPosition,
  readStrokeOutlinePosition,
  readTextStrokeStyle,
  resolveTextStrokeColor,
  roundToOneDecimal,
  strokeHiddenByColor,
  textStrokeIsVisible,
};
export { deriveLockedAspectSize };
export { mergeRotationValue, normalizeRotationDegrees };

export type InspectorTab = "design" | "tweaks";

/**
 * PF12: gesture-lifecycle metadata threaded alongside a style commit.
 *
 * - "preview": a live, in-progress tick (a ScrubInput scrub sample or a
 *   DesignColorPicker drag tick) — cheap to show in the live iframe preview,
 *   but must NOT trigger the expensive source commit (projection parse + HTML
 *   patch + history entry) on every tick.
 * - "commit" (or omitted, for callers that don't pass meta at all): the
 *   gesture's authoritative final value — exactly one per gesture — which
 *   DOES trigger the full source commit. Omitting meta entirely preserves
 *   prior behavior (treated as "commit") for every non-scrub/color call site.
 *
 * - `interactionState`: set on EVERY style commit (regardless of `phase`)
 *   while the inspector's element interaction-state selector
 *   (`InteractionStatePanel`) has a non-default state active — see
 *   `shared/interaction-states.ts` for the persisted format. Omitted (or
 *   `undefined`) means "commit to the element's normal inline style /
 *   class", exactly like today. This is a PHASE-2 CONTRACT: EditPanel only
 *   attaches the field, it never calls the shared upsert helpers itself —
 *   DesignEditor's `onStyleChange`/`onStylesChange` handlers must branch on
 *   `meta.interactionState` and, when present, route the commit through
 *   `upsertStateStyle` / `upsertStateStyles` (targeting `activeContent` +
 *   the selected element's `sourceId` as the node id) instead of the normal
 *   inline-style patch path, then re-derive the forced-preview twins with
 *   `duplicateStatePreviewRules` before persisting — all as ONE history
 *   step, same as any other single style commit today.
 *
 * - `breakpointReset`: set ONLY on the synthetic commit fired by a
 *   `BreakpointOverrideIndicator`'s reset button (see `breakpointContext` on
 *   `EditPanelProps`). Means "clear this property's override at
 *   `maxWidthPx`, don't write a new value" — the accompanying `value`
 *   argument on `onStyleChange`/`onStylesChange` is the CURRENT (base or
 *   wider-scope) value the field falls back to displaying, not a value to
 *   persist. CONTRACT: DesignEditor's handlers must branch on
 *   `meta.breakpointReset` and, when present, call
 *   `removeBreakpointMediaDeclaration` (or clear the matching max-width
 *   utility class — whichever persistence layer
 *   `getBreakpointOverrideState` reported the override on) for `property` at
 *   `maxWidthPx`, instead of writing `value` through the normal inline-style
 *   /  managed-breakpoint-block commit path.
 */
export interface StyleChangeMeta {
  phase?: "preview" | "commit";
  interactionState?: InteractionState;
  breakpointReset?: { property: string; maxWidthPx: number };
}

export type StyleChangeHandler = (
  property: string,
  value: string,
  meta?: StyleChangeMeta,
) => void;

export type StylesChangeHandler = (
  styles: Record<string, string>,
  meta?: StyleChangeMeta,
) => void;

/**
 * Per-render bundle the style-section components below use to render the
 * motion keyframe diamond next to a field — precomputed once in `EditPanel`
 * from `motionKeyframeState`/`onToggleMotionKeyframe` so each section only
 * needs to know its own field's CSS property name. `undefined` (the whole
 * bundle, or `hasTimeline: false`) means "render no diamonds" — sections
 * check this before rendering `MotionKeyframeDiamond` at all.
 */
interface MotionKeyframeFieldContext {
  hasTimeline: boolean;
  keyframedProperties: readonly string[];
  onToggle?: (cssProperty: MotionKeyframeCssProperty) => void;
}

/**
 * Per-render bundle the style-section components below use to render the
 * breakpoint override indicator next to a field — precomputed once in
 * `EditPanel` from `breakpointContext`. `undefined` means "render no
 * indicators" (feature off or editing the base frame).
 */
interface BreakpointOverrideFieldContext {
  nodeId: string | undefined;
  breakpointWidths: readonly number[];
  baseWidthPx: number;
  activeWidthPx: number | null;
  html: string;
  onReset: (property: string, maxWidthPx: number) => void;
}

/**
 * Resolve a single property's override state against
 * `BreakpointOverrideFieldContext`, or `undefined` when the feature is off /
 * there's no stable node id for the current selection. Thin wrapper around
 * `getBreakpointOverrideState` so call sites don't repeat the
 * className/nodeId/html plumbing at every field.
 */
function resolveBreakpointOverride(
  ctx: BreakpointOverrideFieldContext | undefined,
  className: string,
  property: string,
): BreakpointOverrideState | undefined {
  if (!ctx || !ctx.nodeId || ctx.activeWidthPx == null) return undefined;
  return getBreakpointOverrideState({
    className,
    html: ctx.html,
    nodeId: ctx.nodeId,
    property,
    breakpointWidths: ctx.breakpointWidths,
    baseWidthPx: ctx.baseWidthPx,
    activeWidthPx: ctx.activeWidthPx,
  });
}

const MIXED_VALUE = "Mixed";

function isMixedValue(value: string | undefined): boolean {
  return value === MIXED_VALUE;
}

function sameOrMixed(values: string[]): string {
  if (values.length === 0) return "";
  const first = values[0] ?? "";
  return values.every((value) => value === first) ? first : MIXED_VALUE;
}

export function mixedElementFromSelection(
  elements: ElementInfo[],
): ElementInfo | null {
  const base = elements[elements.length - 1];
  if (!base) return null;
  const styleKeys = new Set<string>();
  elements.forEach((element) => {
    Object.keys(element.computedStyles).forEach((key) => styleKeys.add(key));
  });
  const computedStyles = Object.fromEntries(
    Array.from(styleKeys).map((key) => [
      key,
      sameOrMixed(elements.map((element) => element.computedStyles[key] ?? "")),
    ]),
  );
  // Mix inlineStyles the same way as computedStyles so authoredStyleValue()
  // sees a proper Mixed sentinel across a multi-selection instead of
  // silently inheriting the last-selected element's raw inline value
  // (spreading ...base alone would leak that stale single-element value).
  const inlineStyleKeys = new Set<string>();
  elements.forEach((element) => {
    Object.keys(element.inlineStyles ?? {}).forEach((key) =>
      inlineStyleKeys.add(key),
    );
  });
  const inlineStyles =
    inlineStyleKeys.size > 0
      ? Object.fromEntries(
          Array.from(inlineStyleKeys).map((key) => [
            key,
            sameOrMixed(
              elements.map((element) => element.inlineStyles?.[key] ?? ""),
            ),
          ]),
        )
      : undefined;
  const minX = Math.min(...elements.map((element) => element.boundingRect.x));
  const minY = Math.min(...elements.map((element) => element.boundingRect.y));
  const maxX = Math.max(
    ...elements.map(
      (element) => element.boundingRect.x + element.boundingRect.width,
    ),
  );
  const maxY = Math.max(
    ...elements.map(
      (element) => element.boundingRect.y + element.boundingRect.height,
    ),
  );
  return {
    ...base,
    tagName: sameOrMixed(elements.map((element) => element.tagName)),
    id: undefined,
    sourceId: undefined,
    selector: base.selector,
    classes: [],
    computedStyles,
    inlineStyles,
    // Mix like tagName above — otherwise isTextElement() would trust
    // base.primitiveKind alone and misclassify a mixed text+shape selection.
    primitiveKind: sameOrMixed(
      elements.map((element) => element.primitiveKind ?? ""),
    ),
    boundingRect: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    textContent: sameOrMixed(
      elements.map((element) => element.textContent ?? ""),
    ),
    htmlContent: undefined,
    childElementCount: undefined,
    isFlexChild: elements.every((element) => element.isFlexChild),
    isFlexContainer: elements.every((element) => element.isFlexContainer),
  };
}

interface EditPanelProps {
  selectedElement: ElementInfo | null;
  selectedElements?: ElementInfo[];
  selectedScreenGeometry?: ScreenGeometrySelection | null;
  pageStyles?: Record<string, string>;
  zoom?: number;
  headerTrailing?: ReactNode;
  width?: number;
  activeTab?: InspectorTab;
  onActiveTabChange?: (tab: InspectorTab) => void;
  tweaks?: TweakDefinition[];
  tweakValues?: Record<string, string | number | boolean>;
  onTweakChange?: (id: string, value: string | number | boolean) => void;
  onRequestTweaks?: (anchor: HTMLElement) => void;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onExport?: (settings: ExportSettingsValue[]) => void;
  exporting?: boolean;
  /** Active file id — used for component prop editing context. */
  fileId?: string;
  /** Latest active file HTML, used to compose rapid sequential source edits. */
  activeContent?: string;
  /** Server revision for activeContent. */
  activeFileUpdatedAt?: string | null;
  /**
   * Every file's content in the current design (all screens, not just the
   * active one) — used to compute the document-wide "Document colors"
   * palette (see `extractDocumentColorPalette`) so it reflects colors used
   * anywhere in the file, not just the selected element's own color props.
   * Optional: when omitted, the Fill section's document-colors row falls
   * back to just the selected element's colors (previous behavior).
   */
  files?: DocumentColorSourceFile[];
  // -------------------------------------------------------------------------
  // Design Studio panels (§6.2, §6.4, §6.5)
  // Pass `designId` to unlock Tokens, States, and Review sections.
  // -------------------------------------------------------------------------
  /** The active design's id — required to mount Tokens / States / Review. */
  designId?: string;
  /**
   * Called after a component prop edit returns the patched source so the parent
   * editor can sync local/Yjs content instead of waiting for query invalidation.
   */
  onComponentPropApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
  ) => void;
  /**
   * Called after a token edit is applied so the parent can push the resolved
   * CSS-var map into the iframe via the tweak-values postMessage.
   */
  onTokensApplied?: (resolvedCssVars: Record<string, string>) => void;
  /** Props forwarded to the StatesPanel (§6.4). Requires `designId`. */
  statesPanelProps?: Omit<StatesPanelProps, "designId">;
  /** Props forwarded to the ReviewPanel (§6.5). */
  reviewPanelProps?: Omit<ReviewPanelProps, "className">;
  // -------------------------------------------------------------------------
  // Component section (§6.1)
  // When a component instance is selected, pass its node id here to unlock
  // the contextual Component section at the top of the Design tab.
  // -------------------------------------------------------------------------
  /**
   * The `data-agent-native-node-id` of the currently-selected component root
   * element.  When provided (along with `designId`), a Component section is
   * shown at the top of the Design tab with name, source path, prop controls,
   * and an Edit component action.
   */
  componentNodeId?: string;
  /**
   * Source capabilities for the current design.  Used to gate the Edit
   * component / jump-to-source affordances.  When absent all writes default
   * to disabled (inline / Alpine tier behaviour).
   */
  sourceCapabilities?: string[];
  // -------------------------------------------------------------------------
  // Selection header quick actions ("Create component" + "Inspect code")
  // -------------------------------------------------------------------------
  /**
   * Promote the current selection into a reusable component. Receives the
   * (already-normalized-by-the-action) component name the user typed. When
   * omitted the "Create component" button is disabled.
   */
  onCreateComponent?: (name: string) => void;
  /** True when the selected element is already represented as a component. */
  selectedElementAlreadyComponent?: boolean;
  /** Suggested default name for the create-component dialog. */
  defaultComponentName?: string;
  /** Code-inspection data for the "Inspect code" popover. */
  inspectCode?: InspectCodeData;
  /** Optional compact AI edit controls for selected/local source elements. */
  aiActions?: ReactNode;
  // -------------------------------------------------------------------------
  // Frame tool size presets (Figma parity)
  // -------------------------------------------------------------------------
  /**
   * The currently-armed canvas tool. When this is `"frame"` and
   * `onCreateScreenFromPreset` is provided, the whole panel is replaced with
   * a scrollable list of screen-size presets grouped by category — mirroring
   * Figma's behavior when the Frame tool (F / A) is activated before
   * drawing. Any string is accepted so callers can pass their own tool union
   * type without EditPanel importing it.
   */
  activeTool?: string;
  /**
   * Creates a new screen sized to the clicked preset. Only takes effect while
   * `activeTool === "frame"`; when omitted the frame tool falls back to the
   * normal selection-based panel content.
   *
   * Contract: the parent (DesignEditor) is responsible for placing the new
   * screen centered in the current viewport, selecting it, and reverting the
   * active tool back to `"move"` afterward — matching Figma, which arms the
   * Frame tool for exactly one placement.
   */
  onCreateScreenFromPreset?: (preset: {
    name: string;
    width: number;
    height: number;
  }) => void;
  // -------------------------------------------------------------------------
  // Position section — selection alignment (Figma parity)
  // -------------------------------------------------------------------------
  /**
   * Moves the selected object(s) — the real Figma "Alignment" row in the
   * Position section always aligns the selection itself, never the selected
   * element's own children (that's a distinct operation covered by the
   * auto-layout section's alignment matrix for flex containers).
   *
   * Contract for the caller (DesignEditor):
   * - `edge` names one of Figma's six align operations: "left" | "right" |
   *   "center-h" (horizontal centering) act on the X axis; "top" | "bottom" |
   *   "center-v" (vertical centering) act on the Y axis.
   * - For a multi-selection (2+ objects), align every selected object to the
   *   shared bounding box of the current selection (min/max of every
   *   selected element's `boundingRect`) — e.g. "left" moves each object's
   *   left edge to the selection bbox's left edge; "center-h" centers each
   *   object on the bbox's horizontal midpoint. This matches
   *   `mixedElementFromSelection`'s bbox computation already used to build
   *   the merged inspector element in this file.
   * - For a single selected object, align it to its parent's content box
   *   instead (Figma's single-object align-to-parent behavior).
   * - This callback only needs to reposition objects (write left/top or an
   *   equivalent transform) — it must NOT touch flexbox alignment
   *   properties; that responsibility was removed from this row and lives
   *   solely in the auto-layout alignment matrix now.
   * - When omitted, the alignment row's buttons are still rendered (Figma
   *   always shows this row) but no-op, since EditPanel has no selection
   *   bbox/parent geometry of its own to act on.
   */
  onAlignSelection?: (
    edge: "left" | "center-h" | "right" | "top" | "center-v" | "bottom",
  ) => void;
  // -------------------------------------------------------------------------
  // Element interaction states (hover / focus / focus-visible / active /
  // disabled) — see shared/interaction-states.ts for the persisted format
  // and forced-preview mechanism, and the StyleChangeMeta doc comment above
  // for the exact phase-2 commit-routing contract.
  // -------------------------------------------------------------------------
  /**
   * Called whenever the inspector's state selector changes. `null` means
   * Default. PHASE 2: the parent (DesignEditor) uses this to set/clear the
   * `data-an-state-preview` attribute on the selected element in the canvas
   * iframe via the bridge (see `duplicateStatePreviewRules` in
   * `shared/interaction-states.ts` for why an attribute, not a real
   * pseudo-class, drives the forced preview). Omit to render the selector as
   * a no-op display (EditPanel still shows/tracks the active state locally
   * for its own commit-meta tagging even without this callback).
   */
  onInteractionStateChange?: (state: ActiveInteractionState) => void;
  /**
   * Restricts which non-default states the selector offers for the current
   * selection (e.g. omit "disabled" for elements that don't support it).
   * Defaults to all five supported states when omitted.
   */
  availableInteractionStates?: readonly InteractionState[];
  /**
   * GLSL shader fill/effect "Edit code" affordance — threaded straight into
   * `glslShaderContext.onEditCode` (see `GlslShaderPanelContext` in
   * `./inspector/GlslShaderPanel`). Called with the shader's id when the user
   * clicks the panel's Edit-code button; the parent (DesignEditor) should
   * open the left Code panel focused on the active screen's file. Omit to
   * leave the affordance rendered but inert (the panel still explains where
   * the shader source lives).
   */
  onEditCode?: (shaderId: string) => void;
  // -------------------------------------------------------------------------
  // Motion keyframe diamonds (Figma Motion parity) — small ◆ affordances
  // beside keyframeable fields (X/Y/W/H, rotation, opacity, corner radius,
  // fill/stroke color, stroke weight, drop shadow). See
  // `MotionKeyframeDiamond` in `./inspector` for the affordance itself and
  // the exact CSS property identifiers it emits (`MotionKeyframeCssProperty`
  // — these match `MOTION_PROPERTY_PRESETS` in `shared/motion-timeline.ts`
  // verbatim: translate/scale/rotate/opacity/border-radius/
  // background-color/border-color/border-width/box-shadow).
  // -------------------------------------------------------------------------
  /**
   * When provided, unlocks the per-field keyframe diamonds. Safe default:
   * omitted (or `hasTimeline: false`) hides every diamond, so EditPanel
   * renders exactly as before this feature for any caller that hasn't wired
   * motion yet.
   */
  motionKeyframeState?: {
    /** Whether the selected element currently belongs to a motion timeline. */
    hasTimeline: boolean;
    /**
     * CSS property identifiers (see `MotionKeyframeCssProperty`) that already
     * have at least one authored keyframe for the selected element — drives
     * each diamond's outline-vs-filled state.
     */
    keyframedProperties: readonly string[];
  };
  /**
   * Called when a keyframe diamond is clicked. `cssProperty` is always one
   * of the motion catalog's tracked identifiers (see
   * `MotionKeyframeCssProperty`). Contract for the caller (DesignEditor):
   * toggle a keyframe for that property on the selected element at the
   * timeline's current playhead position — add one (seeded from the
   * element's current computed value) when none exists yet at that time, or
   * remove the one at the playhead when `motionKeyframeState.keyframedProperties`
   * already includes it. Omit to render every diamond as an inert (but still
   * visible once `hasTimeline` is true) affordance.
   */
  onToggleMotionKeyframe?: (cssProperty: MotionKeyframeCssProperty) => void;
  // -------------------------------------------------------------------------
  // Breakpoint override indicators (Framer-style responsive breakpoints) —
  // see `getBreakpointOverrideState` in `@shared/breakpoint-media` for the
  // override-detection contract this reads, and `BreakpointOverrideIndicator`
  // in `./inspector` for the dot + reset affordance itself.
  // -------------------------------------------------------------------------
  /**
   * When provided (and `activeWidthPx` is non-null), style-section fields
   * show an accent override indicator + reset affordance for any property
   * that's overridden at the active breakpoint. Safe default: omitted
   * disables the feature entirely — every field renders exactly as before.
   */
  breakpointContext?: {
    /** Widths (px) of the design's configured breakpoint frames. */
    breakpointWidths: readonly number[];
    /** The primary/widest frame's width — the base editing context. */
    baseWidthPx: number;
    /**
     * The active breakpoint frame's width, or `null` while editing the base
     * frame (no override indicators shown in that case — matches
     * `getBreakpointOverrideState`'s `activeUpperBoundPx: null` contract).
     */
    activeWidthPx: number | null;
    /** The active screen's HTML — read-only, for the managed media block. */
    html: string;
  };
}

export interface ScreenGeometrySelection {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Data backing the "Inspect code" popover. The parent resolves the selected
 * node's HTML and (for real-app sources) its source file location.
 */
export interface InspectCodeData {
  /** Outer HTML of the selected element (inline / Alpine source). */
  html?: string | null;
  /** Selected element tag, used when only runtime selection metadata exists. */
  tagName?: string | null;
  /** Selected element id, used for the runtime-metadata fallback preview. */
  id?: string | null;
  /** Selected element classes, used for the runtime-metadata fallback preview. */
  classes?: string[];
  /**
   * Resolved source file for real-app sources (localhost / fusion), when the
   * resolveNodeToFile capability is available.
   */
  sourceLocation?: {
    /** Absolute path on disk — used to build the vscode:// deep link. */
    absolutePath: string;
    line?: number;
    column?: number;
    /** Optional snippet to show above the Open-in-VS-Code button. */
    snippet?: string;
  } | null;
}

/**
 * Normalize a CSS length-ish value typed by the user. If the input is bare
 * digits (e.g. "32" or "32.5"), append the default unit so it parses as a
 * valid CSS length. Lets users type "32" and get the expected "32px" when
 * the field is committed.
 */
function normalizeLengthValue(raw: string, defaultUnit: string): string | null {
  const trimmed = raw.trim();
  // Empty / invalid input returns null so the caller reverts the field instead
  // of committing an empty or garbage CSS value (e.g. fontSize:"" or
  // flexBasis:"abc") to the element's inline style.
  if (!trimmed) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}${defaultUnit}`;
  // Validate free-form CSS so junk text never reaches the style. Fall back to
  // accepting the value when CSS.supports is unavailable (SSR/tests) to keep
  // prior behavior in non-DOM environments.
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    const ok =
      CSS.supports("width", trimmed) ||
      CSS.supports("font-size", trimmed) ||
      CSS.supports("flex-basis", trimmed);
    return ok ? trimmed : null;
  }
  return trimmed;
}

/** Compact input row: label + text input.
 *
 * For CSS length fields (font-size, padding, width, etc.) pass `defaultUnit`
 * so the change is committed on blur/Enter and a bare number auto-appends the
 * unit. Without that, intermediate keystrokes apply invalid CSS — typing "32"
 * for a font-size silently fails because "32" alone isn't a valid length, and
 * it never reaches "32px" because every keystroke re-applies the broken
 * value.
 */
function PropInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  defaultUnit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  defaultUnit?: string;
}) {
  const [draft, setDraft] = useState(value);
  const mixed = isMixedValue(value);
  // Escape reverts and blurs; the blur handler must then skip its commit or it
  // would re-commit the stale draft closure (mirrors ScrubInput's Escape path).
  const skipNextBlurCommitRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (isMixedValue(draft)) return;
    if (defaultUnit === undefined) {
      if (draft !== value) onChange(draft);
      return;
    }
    const next = normalizeLengthValue(draft, defaultUnit);
    if (next === null) {
      // Invalid or empty — revert the field to the last committed value.
      setDraft(value);
      return;
    }
    if (next !== draft) setDraft(next);
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={type}
        value={draft}
        onFocus={(e) => {
          if (mixed) e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          // For length fields, defer the live update until blur/Enter so that
          // invalid intermediate strings ("3", "32", "32p") don't get applied
          // and discarded by the browser. Free-text fields (without
          // defaultUnit) keep the responsive live-update behavior.
          if (defaultUnit === undefined) onChange(e.target.value);
        }}
        onBlur={() => {
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.currentTarget as HTMLInputElement).blur();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            // Revert the draft to the last committed value and blur, matching
            // ScrubInput's Escape behavior.
            setDraft(value);
            skipNextBlurCommitRef.current = true;
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] md:!text-[11px]"
      />
    </div>
  );
}

/** Compact color input: label + design-editor picker popover. */
function ColorInput({
  label,
  value,
  onChange,
  backgroundImage,
  backgroundSize,
  backgroundRepeat,
  backgroundPosition,
  onBackgroundImageChange,
  onImageFillChange,
  blendMode,
  onBlendModeChange,
  supportsLayeredFills = false,
  documentColors,
  supportedPaintTypes,
  pickerKey,
  glslShaderContext,
}: {
  label: string;
  value: string;
  onChange: (value: string, meta?: StyleChangeMeta) => void;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundRepeat?: string;
  backgroundPosition?: string;
  onBackgroundImageChange?: (value: string) => void;
  onImageFillChange?: (value: ImageFillValue) => void;
  blendMode?: string;
  onBlendModeChange?: (value: string) => void;
  supportsLayeredFills?: boolean;
  /** Hex strings already in use on the page — forwarded to the color picker swatch grid. */
  documentColors?: string[];
  /**
   * Restricts which paint-type tabs the popover renders. Omit for the full
   * set (solid + gradients + image + …). Pass `["solid"]` for properties
   * with no clean gradient/image equivalent (e.g. CSS border/outline
   * strokes) so the tab is hidden instead of clickable-but-discarded.
   */
  supportedPaintTypes?: DesignPaintType[];
  pickerKey?: string;
  /**
   * Persistence context for the code-backed GLSL Shader paint type. When
   * provided, the picker's Shader tab opens the GlslShaderPanel (Created by
   * you / Create new (AI) / Presets) which persists real GLSL source into
   * the screen HTML. Omit to fall back to the legacy shader presets panel.
   */
  glslShaderContext?: GlslShaderPanelContext;
}) {
  const [draft, setDraft] = useState(value);
  const [selectedFillId, setSelectedFillId] = useState(SOLID_FILL_ID);
  const [selectedStopId, setSelectedStopId] = useState<string | undefined>();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const backgroundLayers = splitCssLayers(backgroundImage || "");
  const backgroundSizeLayers = splitCssLayers(backgroundSize || "");
  const backgroundRepeatLayers = splitCssLayers(backgroundRepeat || "");
  const backgroundPositionLayers = splitCssLayers(backgroundPosition || "");
  const selectedLayerIndex = fillLayerIndex(selectedFillId);
  const selectedGradient =
    selectedLayerIndex !== null
      ? parseGradientLayer(backgroundLayers[selectedLayerIndex] || "")
      : null;
  const fallbackGradientIndex = backgroundLayers.findIndex((layer) =>
    Boolean(parseGradientLayer(layer)),
  );
  const activeGradientIndex =
    selectedGradient && selectedLayerIndex !== null
      ? selectedLayerIndex
      : fallbackGradientIndex >= 0
        ? fallbackGradientIndex
        : null;
  const activeGradient =
    activeGradientIndex !== null
      ? parseGradientLayer(backgroundLayers[activeGradientIndex] || "")
      : null;
  const activeStopIds =
    activeGradient?.stops.map((stop) => stop.id).join("|") ?? "";

  useEffect(() => {
    if (
      selectedFillId !== SOLID_FILL_ID &&
      (selectedLayerIndex === null ||
        selectedLayerIndex >= backgroundLayers.length)
    ) {
      setSelectedFillId(SOLID_FILL_ID);
    }
  }, [backgroundLayers.length, selectedFillId, selectedLayerIndex]);

  useEffect(() => {
    if (!activeStopIds) {
      if (selectedStopId) setSelectedStopId(undefined);
      return;
    }
    const stopIds = activeStopIds.split("|").filter(Boolean);
    if (!selectedStopId || !stopIds.includes(selectedStopId)) {
      setSelectedStopId(stopIds[0]);
    }
  }, [activeStopIds, selectedStopId]);

  // PF12: `phase` defaults to "commit" so every discrete/one-shot caller
  // (swatch clicks, paint-type switches, hex commit, fill-row edits) keeps
  // committing immediately as before. Only the raw per-tick `onChange` wired
  // to DesignColorPicker below passes "preview" explicitly — the picker's own
  // `onChangeComplete` re-invokes setNext with the same final value tagged
  // "commit" once the gesture ends (see the DesignColorPicker render below).
  const setNext = (next: string, phase: "preview" | "commit" = "commit") => {
    // Guard rail for callers that don't wire onBackgroundImageChange (i.e.
    // supportsLayeredFills is false, e.g. the text-fill "color" row): the
    // picker manages gradient/image paint-type selection as *local* UI state
    // independent of props (see DesignColorPicker's localPaintType), so a
    // user can still open the Gradient/Image tab there even when this
    // ColorInput never offered layered fills. When that happens,
    // emitPaintValue falls back to this onChange with a full gradient/url()
    // CSS string, which is invalid for a plain color property (color /
    // backgroundColor) and gets silently dropped by the browser — but not
    // before clobbering the last-known-good value in this component's own
    // state. Reject anything that doesn't parse as a plain solid color in
    // that case instead of forwarding it.
    if (!supportsLayeredFills && !parseCssColor(next)) return;
    setDraft(next);
    onChange(next, { phase });
  };

  const replaceBackgroundLayer = (index: number, nextLayer: string) => {
    if (!onBackgroundImageChange) return;
    const nextLayers = [...backgroundLayers];
    nextLayers[index] = nextLayer;
    onBackgroundImageChange(joinCssLayers(nextLayers));
  };

  const removeBackgroundLayer = (index: number) => {
    if (!onBackgroundImageChange) return;
    const nextLayers = backgroundLayers.filter(
      (_, layerIndex) => layerIndex !== index,
    );
    onBackgroundImageChange(joinCssLayers(nextLayers));
    setSelectedFillId(SOLID_FILL_ID);
  };

  const handlePaintValueChange = (nextValue: string) => {
    if (!supportsLayeredFills || !onBackgroundImageChange) {
      setNext(nextValue);
      return;
    }

    const selectedLayer = fillLayerIndex(selectedFillId);
    if (selectedLayer !== null) {
      replaceBackgroundLayer(selectedLayer, nextValue);
      const gradient = parseGradientLayer(nextValue);
      if (gradient) setSelectedStopId(gradient.stops[0]?.id);
      return;
    }

    onBackgroundImageChange(joinCssLayers([nextValue, ...backgroundLayers]));
    setSelectedFillId(fillLayerId(0));
    const gradient = parseGradientLayer(nextValue);
    setSelectedStopId(gradient?.stops[0]?.id);
  };

  const fillRows = supportsLayeredFills
    ? buildFillRows(
        draft || value || "#000000",
        backgroundLayers,
        selectedFillId,
      )
    : undefined;

  const handleFillChange = (id: string, patch: DesignFillRowPatch) => {
    if (id === SOLID_FILL_ID) {
      if (patch.value !== undefined) setNext(patch.value);
      if (patch.opacity !== undefined) {
        const parsed = parseCssColor(patch.value ?? draft);
        if (parsed) setNext(rgbaToCss(withColorOpacity(parsed, patch.opacity)));
      }
      return;
    }

    const index = fillLayerIndex(id);
    if (index === null || !onBackgroundImageChange) return;
    const currentLayer = backgroundLayers[index] || "";
    if (patch.value !== undefined) {
      replaceBackgroundLayer(index, patch.value);
      return;
    }
    if (patch.opacity === undefined) return;
    const gradient = parseGradientLayer(currentLayer);
    if (!gradient) return;
    replaceBackgroundLayer(
      index,
      buildGradientLayer(
        gradient.type,
        gradient.stops.map((stop) => ({
          ...stop,
          opacity: patch.opacity,
        })),
        gradient.prefix,
      ),
    );
  };

  const handleAddFill = onBackgroundImageChange
    ? () => {
        const nextLayers = [
          defaultGradientLayer("linear", draft || value || "#000000"),
          ...backgroundLayers,
        ];
        onBackgroundImageChange(joinCssLayers(nextLayers));
        setSelectedFillId(fillLayerId(0));
        setSelectedStopId("stop-0");
      }
    : undefined;

  const handleRemoveFill = onBackgroundImageChange
    ? (id: string) => {
        const index = fillLayerIndex(id);
        if (index === null) return;
        removeBackgroundLayer(index);
      }
    : undefined;

  const handleGradientTypeChange =
    activeGradient && activeGradientIndex !== null
      ? (type: DesignGradientType) => {
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(type, activeGradient.stops),
          );
        }
      : undefined;

  const handleGradientStopChange =
    activeGradient && activeGradientIndex !== null
      ? (id: string, patch: DesignGradientStopPatch) => {
          const nextStops = activeGradient.stops.map((stop) =>
            stop.id === id ? { ...stop, ...patch } : stop,
          );
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(
              activeGradient.type,
              nextStops,
              activeGradient.prefix,
            ),
          );
        }
      : undefined;

  const handleAddGradientStop = onBackgroundImageChange
    ? () => {
        if (activeGradient && activeGradientIndex !== null) {
          const nextStop: DesignGradientStop = {
            id: `stop-${activeGradient.stops.length}`,
            color: draft || "#000000",
            position: 50,
            opacity: 100,
          };
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(
              activeGradient.type,
              [...activeGradient.stops, nextStop],
              activeGradient.prefix,
            ),
          );
          setSelectedStopId(nextStop.id);
          return;
        }

        onBackgroundImageChange(
          joinCssLayers([
            defaultGradientLayer("linear", draft || value || "#000000"),
            ...backgroundLayers,
          ]),
        );
        setSelectedFillId(fillLayerId(0));
        setSelectedStopId("stop-0");
      }
    : undefined;

  const handleRemoveGradientStop =
    activeGradient && activeGradientIndex !== null
      ? (id: string) => {
          if (activeGradient.stops.length <= 2) return;
          const nextStops = activeGradient.stops.filter(
            (stop) => stop.id !== id,
          );
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(
              activeGradient.type,
              nextStops,
              activeGradient.prefix,
            ),
          );
          setSelectedStopId(nextStops[0]?.id);
        }
      : undefined;

  const selectedPaintType: DesignPaintType =
    selectedFillId !== SOLID_FILL_ID
      ? selectedGradient
        ? selectedGradient.type
        : "image"
      : colorHasVisibleAlpha(draft || value)
        ? "solid"
        : "none";
  const pickerValue =
    selectedLayerIndex !== null
      ? (backgroundLayers[selectedLayerIndex] ?? draft ?? value ?? "#000000")
      : draft || "#000000";
  const selectedBackgroundLayerValue = (layers: string[]): string | undefined =>
    selectedLayerIndex !== null ? layers[selectedLayerIndex] : undefined;
  const handlePaintTypeChange = (type: DesignPaintType) => {
    const selectedLayer = fillLayerIndex(selectedFillId);
    if (type === "solid") {
      if (selectedLayer !== null) removeBackgroundLayer(selectedLayer);
      setSelectedFillId(SOLID_FILL_ID);
      setNext(cssColorOrFallback(draft || value, "#000000"));
      return;
    }
    if (type === "none") {
      if (selectedLayer !== null) {
        removeBackgroundLayer(selectedLayer);
        return;
      }
      setNext("transparent");
      return;
    }
    if (!onBackgroundImageChange) return;

    if (
      type !== "linear" &&
      type !== "radial" &&
      type !== "angular" &&
      type !== "diamond"
    ) {
      return;
    }
    const nextType: DesignGradientType = type;
    const layerIndex = selectedLayer ?? activeGradientIndex;
    if (layerIndex !== null) {
      const currentGradient = parseGradientLayer(
        backgroundLayers[layerIndex] || "",
      );
      const stops =
        currentGradient?.stops ?? defaultGradientStops(draft || value);
      replaceBackgroundLayer(layerIndex, buildGradientLayer(nextType, stops));
      setSelectedFillId(fillLayerId(layerIndex));
      setSelectedStopId(stops[0]?.id);
      return;
    }

    onBackgroundImageChange(
      joinCssLayers([
        defaultGradientLayer(nextType, draft || value || "#000000"),
        ...backgroundLayers,
      ]),
    );
    setSelectedFillId(fillLayerId(0));
    setSelectedStopId("stop-0");
  };

  if (isMixedValue(value)) {
    return (
      <button
        type="button"
        className="flex h-6 w-full items-center rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] text-muted-foreground"
        onClick={() => onChange("#000000")}
      >
        {MIXED_VALUE}
      </button>
    );
  }

  return (
    <DesignColorPicker
      key={pickerKey}
      label={label}
      value={pickerValue}
      // PF12: `onChange` fires on every SV/hue/alpha drag tick — tag those as
      // "preview" so the caller can skip the expensive source commit and only
      // update the live iframe preview. `onChangeComplete` fires exactly once
      // per gesture (drag-end, hex commit, keyboard nudge, swatch click,
      // paint-type switch) with the same final value, tagged "commit" so the
      // authoritative source write always happens exactly once.
      onChange={(v) => setNext(v, "preview")}
      onChangeComplete={(v) => setNext(v, "commit")}
      onPaintValueChange={
        supportsLayeredFills ? handlePaintValueChange : undefined
      }
      onImageFillChange={onImageFillChange}
      backgroundImage={selectedBackgroundLayerValue(backgroundLayers)}
      backgroundSize={selectedBackgroundLayerValue(backgroundSizeLayers)}
      backgroundRepeat={selectedBackgroundLayerValue(backgroundRepeatLayers)}
      backgroundPosition={selectedBackgroundLayerValue(
        backgroundPositionLayers,
      )}
      blendMode={blendMode}
      onBlendModeChange={onBlendModeChange}
      showBlendMode={Boolean(onBlendModeChange)}
      fillRows={fillRows}
      selectedFillId={selectedFillId}
      onFillSelect={supportsLayeredFills ? setSelectedFillId : undefined}
      onFillChange={supportsLayeredFills ? handleFillChange : undefined}
      onAddFill={supportsLayeredFills ? handleAddFill : undefined}
      onRemoveFill={supportsLayeredFills ? handleRemoveFill : undefined}
      paintType={selectedPaintType}
      onPaintTypeChange={handlePaintTypeChange}
      gradientType={activeGradient?.type}
      onGradientTypeChange={handleGradientTypeChange}
      gradientStops={activeGradient?.stops}
      selectedStopId={selectedStopId}
      onGradientStopSelect={setSelectedStopId}
      onGradientStopChange={handleGradientStopChange}
      onAddGradientStop={
        supportsLayeredFills ? handleAddGradientStop : undefined
      }
      onRemoveGradientStop={handleRemoveGradientStop}
      documentColors={documentColors}
      supportedPaintTypes={supportedPaintTypes}
      glslShaderContext={glslShaderContext}
    />
  );
}

/**
 * Paint types allowed for CSS properties with no clean gradient/image
 * equivalent — currently strokes (`border`/`outline`), which are plain CSS
 * colors with no `border-image`/layered-background trickery clean enough to
 * support here. Passed as `supportedPaintTypes` so the picker never shows a
 * tab that would silently discard its write.
 */
const SOLID_ONLY_PAINT_TYPES: DesignPaintType[] = ["solid"];

/** Select dropdown */
function PropSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="!text-[11px]"
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Slider with label and value display */
function PropSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="flex-1"
      />
      <span className="w-12 text-right !text-[11px] tabular-nums text-muted-foreground">
        {value}
        {unit}
      </span>
    </div>
  );
}

/**
 * design-editor inspector section. Matches the design editor "Design" panel chrome:
 *   - NO left collapse chevron (the design editor uses none).
 *   - A thin divider line above each section.
 *   - A bold left-aligned title.
 *   - Right-aligned action icons (add layer, toggles, styles, etc.).
 *
 * The title is still clickable to collapse the body (design sections collapse
 * on title click) but renders no chevron glyph, just the same way.
 */
function PanelSection({
  title,
  actions,
  children,
  defaultCollapsed = false,
}: {
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0">
      <div className="flex min-h-9 items-center gap-2 px-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center bg-transparent text-left"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <h3 className="min-w-0 flex-1 truncate !text-[11px] font-semibold text-foreground">
            {title}
          </h3>
        </button>
        {actions ? (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        ) : null}
      </div>
      {!collapsed && children ? (
        <div className="space-y-1.5 px-3 pb-3 pt-0.5 !text-[11px]">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One collapsible category group in the frame-tool presets panel — e.g.
 * "Phone" or "Tablet". Unlike {@link PanelSection} (used for property
 * sections, which shows no chevron), this renders a leading chevron like
 * Figma's own preset list and LayersPanel's disclosure triangles.
 */
function FramePresetCategoryGroup({
  title,
  presets,
  defaultOpen = false,
  onPick,
}: {
  title: string;
  presets: FrameSizePreset[];
  defaultOpen?: boolean;
  onPick: (preset: FrameSizePreset) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0">
      <button
        type="button"
        className="flex h-9 w-full min-w-0 cursor-pointer items-center gap-1.5 px-3 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {open ? (
          <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" />
        )}
        <h3 className="min-w-0 flex-1 truncate !text-[11px] font-semibold text-foreground">
          {title}
        </h3>
      </button>
      {open ? (
        <div className="pb-1.5">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 px-3 pl-8 text-left hover:bg-[var(--design-editor-control-hover-bg)]"
              onClick={() => onPick(preset)}
            >
              <span className="min-w-0 flex-1 truncate !text-[11px] text-foreground">
                {preset.name}
              </span>
              <span className="shrink-0 !text-[11px] tabular-nums text-muted-foreground">
                {preset.width}
                {"×" /* × */}
                {preset.height}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const FRAME_PRESET_CATEGORY_LABEL_KEYS: Record<
  FrameSizePresetCategoryKey,
  string
> = {
  phone: "editPanel.framePresets.categories.phone",
  tablet: "editPanel.framePresets.categories.tablet",
  desktop: "editPanel.framePresets.categories.desktop",
  presentation: "editPanel.framePresets.categories.presentation",
  watch: "editPanel.framePresets.categories.watch",
  paper: "editPanel.framePresets.categories.paper",
  socialMedia: "editPanel.framePresets.categories.socialMedia",
};

/**
 * Figma-parity frame-tool panel: replaces the whole inspector body with a
 * scrollable, categorized list of screen-size presets while the Frame tool
 * is armed. Clicking a row calls `onCreateScreenFromPreset` with the exact
 * size — see the `activeTool`/`onCreateScreenFromPreset` doc comments on
 * `EditPanelProps` for the parent-side creation/tool-revert contract.
 */
function FramePresetsPanel({
  onPick,
}: {
  onPick: (preset: FrameSizePreset) => void;
}) {
  const t = useT();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center border-b border-border/90 px-3">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {t("editPanel.framePresets.title")}
        </h3>
      </div>
      <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {FRAME_SIZE_PRESET_CATEGORIES.map((category, index) => (
          <FramePresetCategoryGroup
            key={category.key}
            title={t(FRAME_PRESET_CATEGORY_LABEL_KEYS[category.key])}
            presets={category.presets}
            defaultOpen={index === 0}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Label className="w-[64px] shrink-0 !text-[11px] font-medium text-muted-foreground">
      {children}
    </Label>
  );
}

function SubsectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="!text-[11px] font-medium text-muted-foreground">{children}</p>
  );
}

function DesignSpacingControl({
  label,
  values,
  onChange,
}: {
  label: string;
  values: { top: string; right: string; bottom: string; left: string };
  onChange: (side: string, value: string) => void;
}) {
  const t = useT();
  const [linked, setLinked] = useState(() => sidesAreLinked(values));
  const numeric = {
    top: parseNumericValue(values.top || "0"),
    right: parseNumericValue(values.right || "0"),
    bottom: parseNumericValue(values.bottom || "0"),
    left: parseNumericValue(values.left || "0"),
  };
  const linkedValue = Math.round(
    (numeric.top + numeric.right + numeric.bottom + numeric.left) / 4,
  );
  const setSide = (
    side: "Top" | "Right" | "Bottom" | "Left",
    value: number,
  ) => {
    onChange(side, `${Math.round(value)}px`);
  };
  const setAll = (value: number) => {
    (["Top", "Right", "Bottom", "Left"] as const).forEach((side) =>
      setSide(side, value),
    );
  };
  const linkedLabel = linked
    ? t("editPanel.labels.unlinkSides")
    : t("editPanel.labels.linkSides");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <Label className="!text-[11px] font-medium text-muted-foreground">
          {label}
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => setLinked((current) => !current)}
              aria-label={linkedLabel}
            >
              {linked ? (
                <IconLink className="size-3.5" />
              ) : (
                <IconUnlink className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{linkedLabel}</TooltipContent>
        </Tooltip>
      </div>
      {linked ? (
        <ScrubInput
          label={t("editPanel.labels.allSides")}
          value={linkedValue}
          onChange={setAll}
          unit="px"
          min={0}
          labelClassName="w-16"
          inputClassName="h-6"
        />
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <ScrubInput
            label={t("editPanel.sidePlaceholders.top")}
            value={numeric.top}
            onChange={(value) => setSide("Top", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.right")}
            value={numeric.right}
            onChange={(value) => setSide("Right", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.bottom")}
            value={numeric.bottom}
            onChange={(value) => setSide("Bottom", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.left")}
            value={numeric.left}
            onChange={(value) => setSide("Left", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
        </div>
      )}
    </div>
  );
}

function sidesAreLinked(values: {
  top: string;
  right: string;
  bottom: string;
  left: string;
}) {
  return (
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.right || "0") &&
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.bottom || "0") &&
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.left || "0")
  );
}

const ALIGN_SELF_OPTIONS = [
  { value: "auto", key: "auto" },
  { value: "flex-start", key: "start" },
  { value: "center", key: "center" },
  { value: "flex-end", key: "end" },
  { value: "stretch", key: "stretch" },
  { value: "baseline", key: "baseline" },
] as const;
// Inside is a real `border` (draws inset from the box edge by definition).
// Outside and center are both implemented as CSS `outline`, which always
// paints just outside the border-box edge — `outline-offset` then pushes it
// further out (outside, offset 0) or pulls it back by half its own width so
// it straddles the edge (center, offset -width/2). See readStrokeOutlinePosition
// for how a persisted outline is read back into one of these three options.
const STROKE_POSITION_OPTIONS = [
  { value: "inside", key: "inside" },
  { value: "outside", key: "outside" },
  { value: "center", key: "center" },
] as const;
const BLEND_MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color dodge" }, // i18n-ignore design blend mode label
  { value: "color-burn", label: "Color burn" }, // i18n-ignore design blend mode label
  { value: "hard-light", label: "Hard light" }, // i18n-ignore design blend mode label
  { value: "soft-light", label: "Soft light" }, // i18n-ignore design blend mode label
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
] as const;

function parseNumericValue(value: string): number {
  return parseFloat(value) || 0;
}

/**
 * Resolve a CSS line-height value to a unitless ratio for display/editing.
 * When the browser returns a px-computed value (e.g. "19.2px" for line-height
 * 1.2 on a 16px font), divide by the font-size to recover the unitless ratio.
 * Falls back to 1.2 when the value cannot be parsed.
 */
function resolveLineHeight(
  lineHeight: string | undefined,
  fontSize: string | undefined,
): number {
  const lh = lineHeight?.trim() || "";
  if (!lh || lh === "normal") return 1.2;
  if (lh.endsWith("px")) {
    const lhPx = parseFloat(lh);
    const fsPx = parseFloat(fontSize || "");
    if (Number.isFinite(lhPx) && Number.isFinite(fsPx) && fsPx > 0) {
      return Math.round((lhPx / fsPx) * 100) / 100;
    }
  }
  const numeric = parseFloat(lh);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1.2;
}

/**
 * FieldTrailer — composes the motion keyframe diamond and the breakpoint
 * override indicator/reset for one field, in the Figma-parity order (diamond
 * first, then the override dot). Renders `null` when neither affordance
 * applies, so call sites can drop it in unconditionally next to any
 * keyframeable/overridable field without their own presence checks.
 *
 * `motionCssProperty` drives the keyframe diamond (omit to skip it — e.g.
 * for fields with no motion-catalog equivalent); `overrideProperty` drives
 * the breakpoint override indicator (defaults to `motionCssProperty` when
 * omitted, since most fields use the same identifier for both — pass it
 * explicitly when a field's CSS property differs from its motion-catalog
 * name, e.g. corner radius's independent-corner longhands).
 */
function FieldTrailer({
  element,
  motionCssProperty,
  overrideProperty,
  motionKeyframeContext,
  breakpointOverrideContext,
  hoverRevealClassName,
  className,
}: {
  element: ElementInfo;
  motionCssProperty?: MotionKeyframeCssProperty;
  overrideProperty?: string;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
  /**
   * Applied ONLY to the keyframe diamond, and only while it's in its muted
   * outline (not-yet-keyframed) state — e.g. `"opacity-0
   * group-hover/field:opacity-100"` to hide it until the field is hovered.
   * A filled (already-keyframed) diamond, and the breakpoint override dot,
   * always render regardless of this class since both convey real state
   * rather than a quiet affordance.
   */
  hoverRevealClassName?: string;
  className?: string;
}) {
  const showDiamond =
    motionCssProperty != null && motionKeyframeContext?.hasTimeline === true;
  const hasKeyframe = showDiamond
    ? motionPropertyHasKeyframe(
        motionKeyframeContext?.keyframedProperties,
        motionCssProperty!,
      )
    : false;
  const resolvedOverrideProperty = overrideProperty ?? motionCssProperty;
  const overrideState = resolvedOverrideProperty
    ? resolveBreakpointOverride(
        breakpointOverrideContext,
        element.classes.join(" "),
        resolvedOverrideProperty,
      )
    : undefined;

  if (!showDiamond && !overrideState?.overriddenAtActive) return null;

  return (
    <span
      className={cn(
        "group/trailer inline-flex items-center gap-0.5",
        className,
      )}
    >
      {showDiamond ? (
        <MotionKeyframeDiamond
          cssProperty={motionCssProperty!}
          hasKeyframe={hasKeyframe}
          onToggle={() => motionKeyframeContext?.onToggle?.(motionCssProperty!)}
          className={hasKeyframe ? undefined : hoverRevealClassName}
        />
      ) : null}
      {overrideState?.overriddenAtActive && resolvedOverrideProperty ? (
        <BreakpointOverrideIndicator
          overridden
          maxWidthPx={overrideState.activeUpperBoundPx}
          onReset={
            breakpointOverrideContext &&
            overrideState.activeUpperBoundPx != null
              ? () =>
                  breakpointOverrideContext.onReset(
                    resolvedOverrideProperty,
                    overrideState.activeUpperBoundPx!,
                  )
              : undefined
          }
        />
      ) : null}
    </span>
  );
}

function ScrubStyleInput({
  label,
  value,
  placeholder,
  onChange,
  unit = "px",
  min,
  max,
  step = 1,
  labelClassName,
  inputClassName,
  ariaLabel,
  tooltipLabel,
  hideIcon = true,
  icon,
  disabled = false,
}: {
  label: string;
  value: string;
  placeholder?: number;
  onChange: (value: number, meta?: ScrubInputChangeMeta) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  labelClassName?: string;
  inputClassName?: string;
  hideIcon?: boolean;
  ariaLabel?: string;
  tooltipLabel?: string;
  icon?: (props: { className?: string }) => ReactNode;
  disabled?: boolean;
}) {
  const mixed = isMixedValue(value);
  return (
    <ScrubInput
      label={label}
      ariaLabel={ariaLabel}
      tooltipLabel={tooltipLabel}
      icon={hideIcon ? null : icon}
      value={mixed ? 0 : value ? parseNumericValue(value) : (placeholder ?? 0)}
      onChange={onChange}
      mixed={mixed}
      unit={unit}
      min={min}
      max={max}
      step={step}
      precision={1}
      disabled={disabled}
      className="gap-0"
      labelClassName={cn(
        "h-6 w-7 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] tabular-nums",
        labelClassName,
      )}
      inputClassName={cn(
        "h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
        inputClassName,
      )}
    />
  );
}

function commitStylePatch(
  styles: Record<string, string>,
  onStyleChange: StyleChangeHandler,
  onStylesChange?: StylesChangeHandler,
) {
  if (onStylesChange) {
    onStylesChange(styles);
    return;
  }
  Object.entries(styles).forEach(([property, value]) => {
    onStyleChange(property, value);
  });
}

function optionValue<T extends readonly { value: string }[]>(
  options: T,
  value: string | undefined,
  fallback: T[number]["value"],
) {
  return options.some((option) => option.value === value) ? value! : fallback;
}

function inspectorObjectTitle(element: ElementInfo): string {
  const componentName = componentNameForElementInfo(element);
  if (componentName) return componentName;
  const tag = normalizedElementTagName(element.tagName);
  if (TEXT_TAGS.has(tag)) return "Text";
  return tag;
}

function componentNameForElementInfo(
  element: ElementInfo | null | undefined,
): string {
  return element?.componentName?.trim() ?? "";
}

function elementIsComponentSelection(
  element: ElementInfo | null | undefined,
): boolean {
  return componentNameForElementInfo(element).length > 0;
}

function displayLabel(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized === "normal") return "flow";
  return normalized;
}

function justifyToHorizontal(
  value: string | undefined,
): AlignmentMatrixValue["horizontal"] {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end" || value === "right") {
    return "right";
  }
  return "left";
}

function alignToVertical(
  value: string | undefined,
): AlignmentMatrixValue["vertical"] {
  if (value === "center") return "middle";
  if (value === "flex-end" || value === "end" || value === "bottom") {
    return "bottom";
  }
  return "top";
}

function horizontalToJustify(
  value: AlignmentMatrixValue["horizontal"],
): string {
  if (value === "center") return "center";
  if (value === "right") return "flex-end";
  return "flex-start";
}

function verticalToAlign(value: AlignmentMatrixValue["vertical"]): string {
  if (value === "middle") return "center";
  if (value === "bottom") return "flex-end";
  return "flex-start";
}

function autoLayoutAlignmentFromStyles(
  styles: Record<string, string>,
  direction: AutoLayoutMatrixValue["direction"],
): AlignmentMatrixValue {
  if (direction === "vertical") {
    return {
      horizontal: justifyToHorizontal(styles.alignItems),
      vertical: alignToVertical(styles.justifyContent),
    };
  }
  return {
    horizontal: justifyToHorizontal(styles.justifyContent),
    vertical: alignToVertical(styles.alignItems),
  };
}

/**
 * Block-level container tags that act the same way frames. Selecting any of
 * these shows the Auto layout section (in an "add" state when not yet flex),
 * mirroring the editor pattern where any frame/container exposes auto-layout controls.
 */
const CONTAINER_TAGS = new Set([
  "div",
  "section",
  "main",
  "header",
  "footer",
  "nav",
  "article",
  "aside",
  "form",
  "ul",
  "ol",
  "figure",
  "fieldset",
  "details",
  "dialog",
  "blockquote",
  "table",
  "tbody",
  "thead",
  "tr",
]);

/** Leaf tags that never get auto-layout (text, media, vectors, controls). */
const LEAF_TAGS = new Set([
  "img",
  "video",
  "picture",
  "audio",
  "canvas",
  "svg",
  "path",
  "input",
  "textarea",
  "select",
  "br",
  "hr",
  "iframe",
]);

/**
 * Whether the element should expose the Auto layout section. True for anything
 * already laid out with flexbox, or any block-level container tag that isn't a
 * known leaf/text element. This is what makes a plain frame/container with
 * children show the full Auto layout section the same way does.
 */
function isContainerElement(element: ElementInfo): boolean {
  if (element.isFlexContainer || element.isGridContainer) return true;
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag) || LEAF_TAGS.has(tag)) return false;
  return CONTAINER_TAGS.has(tag);
}

function isParentFlex(element: ElementInfo): boolean {
  return (
    element.isFlexChild ||
    Boolean(element.parentDisplay?.toLowerCase().includes("flex"))
  );
}

function isParentGrid(element: ElementInfo): boolean {
  return Boolean(element.parentDisplay?.toLowerCase().includes("grid"));
}

function elementHasLayoutChildren(element: ElementInfo): boolean {
  if (typeof element.childElementCount === "number") {
    return element.childElementCount > 0;
  }
  return Boolean(element.htmlContent?.match(/<\s*[a-zA-Z][^>]*>/));
}

function parentFlexDirection(element: ElementInfo): AutoLayoutSizingAxis {
  return element.parentLayout?.flexDirection?.includes("column")
    ? "vertical"
    : "horizontal";
}

export function isTextElement(element: ElementInfo): boolean {
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag)) return true;
  // T-tool text primitives are plain `div`s stamped with
  // data-an-primitive="text" (see DesignEditor primitive creation). The
  // bridge now forwards that marker as ElementInfo.primitiveKind — prefer it
  // when present since it's exact.
  if (element.primitiveKind) return element.primitiveKind === "text";
  // Fallback for older payloads that predate primitiveKind: approximate a
  // T-tool text div with a content heuristic — a childless div that has its
  // own text content and isn't already flagged as a layout container. This
  // intentionally excludes empty frames/shapes (no text) and containers with
  // element children.
  if (
    tag === "div" &&
    !element.isFlexContainer &&
    !element.isGridContainer &&
    (element.childElementCount ?? 0) === 0 &&
    Boolean(element.textContent?.trim())
  ) {
    return true;
  }
  return false;
}

/**
 * Per-axis sizing availability following the design editor's contextual rules:
 *   - Fixed: always.
 *   - Hug contents: only CONTAINERS (flex/container frames) and TEXT can hug
 *     their content. Leaves like img/svg/input cannot.
 *   - Fill container: only when the element is a CHILD of a flex/grid (auto
 *     layout) parent, OR a block-flow child (which fills via width:100%).
 * Hug applies to width and height independently; the same set is offered on
 * both axes here and the per-axis CSS in `commitElementSizing` resolves the
 * exact behavior (main-axis grow vs cross-axis stretch).
 */
function availableSizingForElement(
  element: ElementInfo,
): Partial<Record<AutoLayoutSizingAxis, AutoLayoutSizing[]>> {
  const canHug = isContainerElement(element) || isTextElement(element);
  const isFlexChildEl = isParentFlex(element) || isParentGrid(element);
  // Block-flow children can still "fill" via width:100% on the horizontal axis.
  const isBlockChild = Boolean(element.parentDisplay) && !isFlexChildEl;

  const buildAxis = (axis: AutoLayoutSizingAxis): AutoLayoutSizing[] => {
    const options: AutoLayoutSizing[] = ["fixed"];
    if (canHug) options.push("hug");
    // Fill: flex/grid child on either axis; block child only fills width.
    if (isFlexChildEl || (isBlockChild && axis === "horizontal")) {
      options.push("fill");
    }
    return options;
  };

  return {
    horizontal: buildAxis("horizontal"),
    vertical: buildAxis("vertical"),
  };
}

/** Read the currently-set min/max constraints (px) for a sizing axis. */
function readElementMinMax(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): { min: number | null; max: number | null } {
  const styles = element.computedStyles;
  const minRaw = axis === "horizontal" ? styles.minWidth : styles.minHeight;
  const maxRaw = axis === "horizontal" ? styles.maxWidth : styles.maxHeight;
  return {
    min: parseConstraintLength(minRaw),
    max: parseConstraintLength(maxRaw),
  };
}

/**
 * Parse a min/max CSS length into a px number, or null when unset. Browser
 * computed values are "0px"/"none" for the defaults — both read as "not set"
 * so we don't surface a constraint sub-row the user never added.
 */
function parseConstraintLength(value: string | undefined): number | null {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "none" ||
    normalized === "auto" ||
    normalized === "0px" ||
    normalized === "0"
  ) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Commit a single min/max constraint (px) or clear it when value is null. */
function commitElementMinMax(
  axis: AutoLayoutSizingAxis,
  kind: "min" | "max",
  value: number | null,
  onStyleChange: StyleChangeHandler,
) {
  const isHorizontal = axis === "horizontal";
  const property =
    kind === "min"
      ? isHorizontal
        ? "minWidth"
        : "minHeight"
      : isHorizontal
        ? "maxWidth"
        : "maxHeight";
  if (value == null) {
    // Clearing: min → 0 (CSS initial), max → none (CSS initial).
    onStyleChange(property, kind === "min" ? "0px" : "none");
    return;
  }
  onStyleChange(property, `${Math.max(0, Math.round(value))}px`);
}

function inferElementSizing(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): AutoLayoutSizing {
  const styles = element.computedStyles;
  const size = axis === "horizontal" ? styles.width : styles.height;
  const parentDirection = parentFlexDirection(element);
  const isFlex = isParentFlex(element);
  const isMainFlexAxis = isFlex && parentDirection === axis;
  const isCrossFlexAxis = isFlex && parentDirection !== axis;
  const alignSelf = (styles.alignSelf || "").toLowerCase();

  if (
    size === "100%" ||
    (isMainFlexAxis && Number.parseFloat(styles.flexGrow || "0") > 0) ||
    (isCrossFlexAxis && alignSelf === "stretch")
  ) {
    return "fill";
  }
  if (size === "auto" || size === "fit-content" || size === "max-content") {
    return "hug";
  }
  return "fixed";
}

/**
 * Return the element's geometric dimension on the given axis in CSS pixels.
 *
 * `getComputedStyle().width/height` always resolves to a computed px value
 * (even for `width: auto` the browser returns e.g. "200px"). For rotated
 * elements this is the pre-rotation CSS box size — what Figma shows in the
 * inspector — while `getBoundingClientRect().width/height` would be the
 * axis-aligned bounding box which is inflated by the rotation.
 *
 * Falls back to the bounding-rect dimension only when the computed style is
 * missing or unparseable (e.g. the bridge hasn't populated it yet).
 */
function cssElementSize(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): number {
  const isHorizontal = axis === "horizontal";
  const cssValue = isHorizontal
    ? element.computedStyles.width
    : element.computedStyles.height;
  const parsed = parseFloat(cssValue || "");
  const fallback = isHorizontal
    ? element.boundingRect.width
    : element.boundingRect.height;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function commitElementSizing(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
  sizing: AutoLayoutSizing,
  onStyleChange: StyleChangeHandler,
  onStylesChange?: StylesChangeHandler,
) {
  const isHorizontal = axis === "horizontal";
  const sizeProperty = isHorizontal ? "width" : "height";
  // Use CSS computed dimension (pre-rotation box size) as the seed for "fixed"
  // sizing so a rotated element is locked to its actual CSS width/height rather
  // than the inflated axis-aligned bounding rect.
  const resolvedSize = Math.max(1, Math.round(cssElementSize(element, axis)));
  const parentDirection = parentFlexDirection(element);
  const isFlex = isParentFlex(element);
  const isGrid = isParentGrid(element);
  const isMainFlexAxis = isFlex && parentDirection === axis;
  const patch: Record<string, string> = {};

  if (sizing === "fixed") {
    // Fixed → explicit px dimension. Reset any grow/stretch on the flex
    // main-axis so the pixel value sticks.
    patch[sizeProperty] = `${resolvedSize}px`;
    if (isMainFlexAxis) {
      patch.flexGrow = "0";
      patch.flexShrink = "0";
      patch.flexBasis = "auto";
    }
  } else if (sizing === "hug") {
    // Hug contents → shrink to fit children/content.
    patch[sizeProperty] = "fit-content";
    if (isMainFlexAxis) {
      // A flex container hugging on its main axis uses flex-basis:auto + no
      // stretch (spec: "flex-basis: auto + no stretch").
      patch.flexGrow = "0";
      patch.flexShrink = "0";
      patch.flexBasis = "auto";
    }
  } else {
    // Fill container.
    if (isMainFlexAxis) {
      // Parent main axis → grow into available space: flex: 1 0 0.
      patch.flexGrow = "1";
      patch.flexShrink = "0";
      patch.flexBasis = "0";
      // Clear any explicit dimension so flex-basis governs.
      patch[sizeProperty] = "auto";
    } else if (isFlex) {
      // Parent cross axis → stretch to the parent's cross size.
      patch.alignSelf = "stretch";
      patch[sizeProperty] = "auto";
    } else if (isGrid) {
      patch[isHorizontal ? "justifySelf" : "alignSelf"] = "stretch";
      patch[sizeProperty] = "auto";
    } else {
      // Child of a non-flex (block) parent → fill width with 100%.
      patch[sizeProperty] = "100%";
    }
  }

  commitStylePatch(patch, onStyleChange, onStylesChange);
}

/**
 * Header-anchored popover that prompts for a component name, then promotes the
 * current selection into a reusable component via `onSubmit`.
 */
function CreateComponentPopover({
  open,
  onOpenChange,
  defaultName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the field to the freshest default each time the popover opens.
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
              aria-label={
                "Create component" /* i18n-ignore design inspector action */
              }
            >
              <IconComponents className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {"Create component" /* i18n-ignore design inspector action */}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-3 text-[12px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => inputRef.current?.select());
        }}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <div className="space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">
              {"Create component" /* i18n-ignore design inspector action */}
            </h3>
            <p className="!text-[11px] leading-4 text-muted-foreground">
              {
                "Name this element so it becomes a reusable component. The agent can then extract props and replace repeated instances." /* i18n-ignore design inspector copy */
              }
            </p>
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="create-component-name"
              className="!text-[11px] font-medium text-muted-foreground"
            >
              {"Component name" /* i18n-ignore design inspector label */}
            </Label>
            <Input
              ref={inputRef}
              id="create-component-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                "PrimaryButton" /* i18n-ignore design inspector placeholder */
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {"Cancel" /* i18n-ignore design inspector action */}
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              {"Create" /* i18n-ignore design inspector action */}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Popover anchored to the "Inspect code" button showing the selected node's
 * code.  Inline/Alpine sources show the element's outer HTML with a Copy
 * button; real-app sources additionally render an "Open in VS Code" button.
 *
 * TODO: replace the read-only <pre> with an inline Monaco editor for richer
 * (editable) code inspection once the editor bundle is wired into the inspector.
 */
function InspectCodePopover({ data }: { data: InspectCodeData }) {
  const [copied, setCopied] = useState(false);
  const html = data.html ?? "";
  const source = data.sourceLocation ?? null;
  const snippet =
    elementHtmlPreview(data) ?? source?.snippet ?? (html.trim() || null);

  const handleCopy = () => {
    if (!snippet) return;
    void navigator.clipboard
      ?.writeText(snippet)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        /* clipboard may be unavailable; ignore */
      });
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
              aria-label={
                "Inspect code" /* i18n-ignore design inspector action */
              }
            >
              <IconCode className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {"Inspect code" /* i18n-ignore design inspector action */}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 space-y-2 p-2 !text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            {"Inspect code" /* i18n-ignore design inspector label */}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={handleCopy}
            disabled={!snippet}
          >
            {
              copied
                ? "Copied" /* i18n-ignore design inspector action */
                : "Copy" /* i18n-ignore design inspector action */
            }
          </Button>
        </div>

        {source && (
          <div
            className="flex items-center gap-1 rounded bg-[var(--design-editor-control-bg)] px-2 py-1"
            title={source.absolutePath}
          >
            <IconCode className="size-3 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
              {source.absolutePath}
              {source.line != null ? `:${source.line}` : ""}
            </span>
          </div>
        )}

        {snippet ? (
          <pre className="max-h-64 overflow-auto rounded bg-[var(--design-editor-control-bg)] p-2 font-mono text-[10px] leading-relaxed text-foreground">
            <code>{highlightedHtml(snippet)}</code>
          </pre>
        ) : (
          <p className="px-1 py-2 text-muted-foreground">
            {
              "No source available for this element." /* i18n-ignore design inspector empty */
            }
          </p>
        )}

        {source && (
          <a
            href={vscodeDeepLink(
              source.absolutePath,
              source.line,
              source.column,
            )}
            className="block"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 !text-[11px]"
            >
              <IconExternalLink className="size-3.5" />
              {"Open in VS Code" /* i18n-ignore design inspector action */}
            </Button>
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}

function elementTypeIcon(element: ElementInfo) {
  if (elementIsComponentSelection(element)) return IconComponents;
  const tag = normalizedElementTagName(element.tagName);
  if (TEXT_TAGS.has(tag)) return IconTypography;
  if (tag === "img" || tag === "video" || tag === "picture") return IconPhoto;
  if (tag === "svg" || tag === "path") return IconVector;
  if (tag === "button" || tag === "a") return IconComponents;
  return IconFrame;
}

function SelectionHeader({
  element,
  selectedCount = 0,
  onCreateComponent,
  createComponentOpen = false,
  onCreateComponentOpenChange,
  showCreateComponentAction = true,
  defaultComponentName = "Component",
  inspectCode,
}: {
  element: ElementInfo | null;
  selectedCount?: number;
  /** Promote the current selection into a reusable component. Omit/undefined to disable. */
  onCreateComponent?: (name: string) => void;
  createComponentOpen?: boolean;
  onCreateComponentOpenChange?: (open: boolean) => void;
  showCreateComponentAction?: boolean;
  defaultComponentName?: string;
  /** Data for the "Inspect code" popover. When omitted the button renders disabled. */
  inspectCode?: InspectCodeData;
}) {
  if (!element) return null;

  const title =
    selectedCount > 1
      ? `${selectedCount} selected`
      : inspectorObjectTitle(element);
  const TypeIcon = elementTypeIcon(element);
  const isComponentSelection = elementIsComponentSelection(element);

  return (
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border/90 px-3">
      {/* Node-type label. Rename lives in the layers panel and device sizing
          lives elsewhere, so this is a plain non-interactive label. */}
      <div className="flex min-w-0 items-center gap-1.5 text-left text-[13px] font-semibold text-foreground">
        <TypeIcon
          className={cn(
            "size-3.5 shrink-0",
            isComponentSelection
              ? "text-[var(--design-editor-component-color)]"
              : "text-muted-foreground",
          )}
        />
        <span className="truncate">{title}</span>
      </div>
      {/* Right-aligned quick actions: create-component + dev inspect (</>) */}
      <div className="flex shrink-0 items-center gap-0.5">
        {showCreateComponentAction ? (
          onCreateComponent && onCreateComponentOpenChange ? (
            <CreateComponentPopover
              open={createComponentOpen}
              onOpenChange={onCreateComponentOpenChange}
              defaultName={defaultComponentName}
              onSubmit={onCreateComponent}
            />
          ) : (
            <SectionIconButton
              label={
                "Create component" /* i18n-ignore design inspector action */
              }
              disabled
            >
              <IconComponents className="size-3.5" />
            </SectionIconButton>
          )
        ) : null}
        {inspectCode ? (
          <InspectCodePopover data={inspectCode} />
        ) : (
          <SectionIconButton
            label={"Inspect code" /* i18n-ignore design inspector action */}
            disabled
          >
            <IconCode className="size-3.5" />
          </SectionIconButton>
        )}
      </div>
    </div>
  );
}

function ScreenSelectionHeader({
  screen,
}: {
  screen: ScreenGeometrySelection;
}) {
  return (
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border/90 px-3">
      <div className="flex min-w-0 items-center gap-1.5 text-left text-[13px] font-semibold text-foreground">
        <IconFrame className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{screen.title}</span>
      </div>
    </div>
  );
}

function ScreenGeometryProperties({
  screen,
}: {
  screen: ScreenGeometrySelection;
}) {
  const t = useT();
  const noop = useCallback(() => {}, []);

  return (
    <PanelSection title={t("editPanel.sections.positionLayout")}>
      <div className="space-y-1.5">
        <SubsectionLabel>{t("editPanel.labels.position")}</SubsectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <ScrubInput
            label="X"
            value={Math.round(screen.x)}
            onChange={noop}
            unit="px"
            disabled
            inputClassName="h-6"
          />
          <ScrubInput
            label="Y"
            value={Math.round(screen.y)}
            onChange={noop}
            unit="px"
            disabled
            inputClassName="h-6"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <SubsectionLabel>
          {"Size" /* i18n-ignore design inspector label */}
        </SubsectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <ScrubInput
            label="W"
            value={Math.round(screen.width)}
            onChange={noop}
            unit="px"
            disabled
            inputClassName="h-6"
          />
          <ScrubInput
            label="H"
            value={Math.round(screen.height)}
            onChange={noop}
            unit="px"
            disabled
            inputClassName="h-6"
          />
        </div>
      </div>
    </PanelSection>
  );
}

function InspectorTabsHeader({
  activeTab,
  onActiveTabChange,
  trailing,
}: {
  activeTab: InspectorTab;
  onActiveTabChange: (tab: InspectorTab) => void;
  trailing?: ReactNode;
}) {
  const t = useT();

  return (
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-1 border-b border-border/90 px-2 py-1">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value as InspectorTab)}
      >
        <TabsList className="h-7 justify-start gap-0.5 rounded-none bg-transparent p-0">
          <TabsTrigger
            value="design"
            className="h-6 rounded-md px-1.5 !text-[11px] font-semibold text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {"Design" /* i18n-ignore design inspector tab */}
          </TabsTrigger>
          <TabsTrigger
            value="tweaks"
            className="h-6 rounded-md px-1.5 !text-[11px] font-semibold text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {t("designEditor.tweaks")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

function SectionIconButton({
  label,
  onClick,
  children,
  activateOnPointerDown = false,
  disabled = false,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  activateOnPointerDown?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const pointerActivatedRef = useRef(false);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed",
            className,
          )}
          disabled={disabled}
          onPointerDown={(event) => {
            if (!activateOnPointerDown || disabled || event.button !== 0) {
              return;
            }
            pointerActivatedRef.current = true;
            event.preventDefault();
            event.stopPropagation();
            onClick?.();
          }}
          onClick={() => {
            if (pointerActivatedRef.current) {
              pointerActivatedRef.current = false;
              return;
            }
            onClick?.();
          }}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Section-header toggle icon (the design editor's right-aligned section actions, e.g. the
 * auto-layout ⊞ toggle). Highlights with the accent color when active.
 */
function SectionIconToggle({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground",
            active &&
              "bg-[var(--design-editor-accent-color)]/15 text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Minimal pointer-based reorder for a flat row list (fill layers, shadow
 * layers). Deliberately not shared with LayersPanel.tsx's tree-drag logic —
 * that implementation is coupled to nested/multi-select layer nodes, while
 * this only ever needs "move index A to index B" over a flat array.
 *
 * Reads live in a ref (not React state) so a fast pointermove sequence never
 * reorders against a stale `count`/`onReorder` closure, mirroring why
 * ScrubInput tracks its draft in a ref alongside state.
 */
function useRowDragReorder(
  count: number,
  onReorder: (from: number, to: number) => void,
) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const liveRef = useRef({ count, onReorder });
  liveRef.current = { count, onReorder };

  const getRowProps = (index: number) => ({
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (dragIndex == null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (index !== overIndex) setOverIndex(index);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const from = dragIndex;
      setDragIndex(null);
      setOverIndex(null);
      if (from == null || from === index) return;
      const { count: liveCount, onReorder: liveOnReorder } = liveRef.current;
      if (index < 0 || index >= liveCount) return;
      liveOnReorder(from, index);
    },
  });

  const getHandleProps = (index: number) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLSpanElement>) => {
      // Firefox requires setData to be called for the drag to start at all.
      event.dataTransfer.setData("text/plain", String(index));
      event.dataTransfer.effectAllowed = "move";
      setDragIndex(index);
    },
    onDragEnd: () => {
      setDragIndex(null);
      setOverIndex(null);
    },
  });

  return {
    dragIndex,
    overIndex,
    getRowProps,
    getHandleProps,
  };
}

/** Drag handle + before/after drop-indicator line for a reorderable row.
 * Grip is hover-revealed (Figma convention); the row itself uses always-visible
 * eye/remove buttons per this file's existing convention, so only the grip
 * gets the opacity treatment. */
function RowDragHandle({
  label,
  dropIndicator,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  dropIndicator?: "before" | "after" | null;
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLSpanElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <span
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      role="button"
      aria-label={label}
      className="relative flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
    >
      <IconGripVertical className="size-3.5" />
      {dropIndicator === "before" ? (
        <span className="pointer-events-none absolute -top-[3px] left-0 right-0 h-px bg-[var(--design-editor-accent-color)]" />
      ) : null}
      {dropIndicator === "after" ? (
        <span className="pointer-events-none absolute -bottom-[3px] left-0 right-0 h-px bg-[var(--design-editor-accent-color)]" />
      ) : null}
    </span>
  );
}

function InspectorIconButton({
  label,
  active,
  onClick,
  children,
  shortcut,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  /** Optional keyboard-shortcut hint (e.g. "⌥A") appended to the tooltip only — aria-label stays plain text. */
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 min-w-6 cursor-pointer rounded-none border-r border-border/50 text-muted-foreground first:rounded-l-md last:rounded-r-md last:border-r-0 hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground disabled:cursor-not-allowed",
            active &&
              "bg-[var(--design-editor-panel-bg)] text-[var(--design-editor-accent-color)] shadow-[inset_0_0_0_1px_var(--design-editor-control-border)]",
          )}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {shortcut ? `${label}  ${shortcut}` : label}
      </TooltipContent>
    </Tooltip>
  );
}

function InspectorSegment({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-fit max-w-full min-w-0 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]">
      {children}
    </div>
  );
}

function TextResizeControls({
  resizeMode,
  onResizeModeChange,
}: {
  resizeMode: TextResizeMode;
  onResizeModeChange: (mode: TextResizeMode) => void;
}) {
  const t = useT();

  return (
    <InspectorSegment>
      <InspectorIconButton
        label={t("editPanel.textResize.autoWidth")}
        active={resizeMode === "auto-width"}
        onClick={() => onResizeModeChange("auto-width")}
      >
        <IconArrowAutofitWidth className="size-3.5" />
      </InspectorIconButton>
      <InspectorIconButton
        label={t("editPanel.textResize.autoHeight")}
        active={resizeMode === "auto-height"}
        onClick={() => onResizeModeChange("auto-height")}
      >
        <IconArrowAutofitHeight className="size-3.5" />
      </InspectorIconButton>
      <InspectorIconButton
        label={t("editPanel.textResize.fixed")}
        active={resizeMode === "fixed"}
        onClick={() => onResizeModeChange("fixed")}
      >
        <IconSquare className="size-3.5" />
      </InspectorIconButton>
    </InspectorSegment>
  );
}

function TypographyDetailsPopover({
  resizeMode,
  onResizeModeChange,
}: {
  resizeMode: TextResizeMode;
  onResizeModeChange: (mode: TextResizeMode) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={"Typography details" /* i18n-ignore design action */}
              aria-pressed={open}
              className={cn(
                "h-6 min-w-6 cursor-pointer rounded-md text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground",
                open &&
                  "bg-[var(--design-editor-accent-color)]/20 text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
              )}
            >
              <IconLayoutSettings className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {"Typography details" /* i18n-ignore design action */}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        className="z-[100010] w-[360px] rounded-xl border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] p-0 text-foreground shadow-2xl"
      >
        <div className="flex items-center gap-1 border-b border-[var(--design-editor-control-border)] p-2.5">
          <div className="flex rounded-md bg-[var(--design-editor-control-bg)] p-0.5">
            <span className="rounded bg-[var(--design-editor-panel-raised-bg)] px-2.5 py-1 !text-[11px] font-semibold text-foreground">
              {"Basics" /* i18n-ignore design typography details tab */}
            </span>
            <span className="px-2.5 py-1 !text-[11px] font-medium text-muted-foreground">
              {"Details" /* i18n-ignore design typography details tab */}
            </span>
            <span className="px-2.5 py-1 !text-[11px] font-medium text-muted-foreground">
              {"Variable" /* i18n-ignore design typography details tab */}
            </span>
          </div>
        </div>
        <div className="space-y-3 p-4 !text-[11px]">
          <div className="flex h-20 items-center justify-center rounded-md bg-[var(--design-editor-control-bg)] text-[18px] text-muted-foreground/80">
            {"Preview" /* i18n-ignore design typography details preview */}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="!text-[11px] font-medium text-muted-foreground">
              {"Text box" /* i18n-ignore design typography details label */}
            </span>
            <TextResizeControls
              resizeMode={resizeMode}
              onResizeModeChange={onResizeModeChange}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CornerRadiusControl({
  styles,
  onStyleChange,
  element,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
  /**
   * Optional — only needed to render the keyframe diamond / breakpoint
   * override indicator next to the uniform radius field. Omit for callers
   * that don't wire those features (both affordances stay hidden).
   */
  element?: ElementInfo;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const independentCornersLabel = t("editPanel.labels.independentCorners");
  const cornerSources = {
    topLeft: styles.borderTopLeftRadius || styles.borderRadius,
    topRight: styles.borderTopRightRadius || styles.borderRadius,
    bottomRight: styles.borderBottomRightRadius || styles.borderRadius,
    bottomLeft: styles.borderBottomLeftRadius || styles.borderRadius,
  };
  const cornerMixed = {
    topLeft: isMixedValue(cornerSources.topLeft),
    topRight: isMixedValue(cornerSources.topRight),
    bottomRight: isMixedValue(cornerSources.bottomRight),
    bottomLeft: isMixedValue(cornerSources.bottomLeft),
  };
  // Guard cssLengthNumber against the Mixed sentinel — parseFloat("Mixed")
  // would silently coerce it to 0 and render a concrete value.
  const corners = {
    topLeft: cornerMixed.topLeft ? 0 : cssLengthNumber(cornerSources.topLeft),
    topRight: cornerMixed.topRight
      ? 0
      : cssLengthNumber(cornerSources.topRight),
    bottomRight: cornerMixed.bottomRight
      ? 0
      : cssLengthNumber(cornerSources.bottomRight),
    bottomLeft: cornerMixed.bottomLeft
      ? 0
      : cssLengthNumber(cornerSources.bottomLeft),
  };
  const anyCornerMixed =
    cornerMixed.topLeft ||
    cornerMixed.topRight ||
    cornerMixed.bottomRight ||
    cornerMixed.bottomLeft;
  const allCornersMixed =
    cornerMixed.topLeft &&
    cornerMixed.topRight &&
    cornerMixed.bottomRight &&
    cornerMixed.bottomLeft;
  // With mixed sentinels the parsed numbers are placeholders, so compare
  // mixed-ness instead: all-mixed reads as uniform (each element may still be
  // uniform), partially-mixed means at least one element has differing corners.
  const cornersDiffer = anyCornerMixed
    ? !allCornersMixed
    : corners.topLeft !== corners.topRight ||
      corners.topLeft !== corners.bottomRight ||
      corners.topLeft !== corners.bottomLeft;
  const [showIndependentCorners, setShowIndependentCorners] =
    useState(cornersDiffer);
  const radiusMixed =
    anyCornerMixed || (!cornersDiffer && isMixedValue(styles.borderRadius));
  const radius = radiusMixed
    ? 0
    : cornersDiffer
      ? corners.topLeft
      : cssLengthNumber(styles.borderRadius || String(corners.topLeft));
  const commitRadius = (value: number, meta?: ScrubInputChangeMeta) => {
    const next = `${Math.max(0, Math.round(value))}px`;
    // Always write the longhands along with the shorthand: stale inline
    // longhand declarations serialize after the shorthand and would override
    // it, turning uniform-radius commits into silent no-ops.
    onStyleChange("borderRadius", next, meta);
    onStyleChange("borderTopLeftRadius", next, meta);
    onStyleChange("borderTopRightRadius", next, meta);
    onStyleChange("borderBottomRightRadius", next, meta);
    onStyleChange("borderBottomLeftRadius", next, meta);
  };
  const toggleIndependentCorners = () => {
    // Collapsing while corners differ flattens them to the displayed uniform
    // value; otherwise the stale longhands would keep overriding the shorthand
    // and the single field would silently no-op. Mixed selections collapse the
    // UI only — committing would stamp the placeholder 0 onto every object.
    if (showIndependentCorners && cornersDiffer && !radiusMixed) {
      commitRadius(radius);
    }
    setShowIndependentCorners(!showIndependentCorners);
  };

  useEffect(() => {
    if (cornersDiffer) setShowIndependentCorners(true);
  }, [cornersDiffer]);

  return (
    <>
      <div className="group/field relative min-w-0">
        <AppearanceScrubField
          label={t("editPanel.labels.cornerRadius")}
          icon={IconBorderRadius}
          value={radius}
          onChange={commitRadius}
          mixed={radiusMixed}
          min={0}
          precision={0}
        />
        {element ? (
          <FieldTrailer
            element={element}
            motionCssProperty="border-radius"
            motionKeyframeContext={motionKeyframeContext}
            breakpointOverrideContext={breakpointOverrideContext}
            className="absolute -top-3.5 right-0"
            hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
          />
        ) : null}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
              showIndependentCorners &&
                "bg-[var(--design-editor-accent-color)]/20 text-[var(--design-editor-accent-color)] hover:bg-[var(--design-editor-accent-color)]/20 hover:text-[var(--design-editor-accent-color)]",
            )}
            aria-label={independentCornersLabel}
            aria-pressed={showIndependentCorners}
            onClick={toggleIndependentCorners}
          >
            <IconBorderCorners className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{independentCornersLabel}</TooltipContent>
      </Tooltip>
      {showIndependentCorners ? (
        <>
          <AppearanceScrubField
            label={t("editPanel.labels.topLeft")}
            ariaLabel="Top left"
            icon={IconRadiusTopLeft}
            value={corners.topLeft}
            onChange={(value, meta) =>
              onStyleChange(
                "borderTopLeftRadius",
                `${Math.max(0, Math.round(value))}px`,
                meta,
              )
            }
            mixed={cornerMixed.topLeft}
            min={0}
            precision={1}
          />
          <AppearanceScrubField
            label={t("editPanel.labels.topRight")}
            ariaLabel="Top right"
            icon={IconRadiusTopRight}
            value={corners.topRight}
            onChange={(value, meta) =>
              onStyleChange(
                "borderTopRightRadius",
                `${Math.max(0, Math.round(value))}px`,
                meta,
              )
            }
            mixed={cornerMixed.topRight}
            min={0}
            precision={1}
          />
          <span aria-hidden="true" />
          <AppearanceScrubField
            label={t("editPanel.labels.bottomLeft")}
            ariaLabel="Bottom left"
            icon={IconRadiusBottomLeft}
            value={corners.bottomLeft}
            onChange={(value, meta) =>
              onStyleChange(
                "borderBottomLeftRadius",
                `${Math.max(0, Math.round(value))}px`,
                meta,
              )
            }
            mixed={cornerMixed.bottomLeft}
            min={0}
            precision={1}
          />
          <AppearanceScrubField
            label={t("editPanel.labels.bottomRight")}
            ariaLabel="Bottom right"
            icon={IconRadiusBottomRight}
            value={corners.bottomRight}
            onChange={(value, meta) =>
              onStyleChange(
                "borderBottomRightRadius",
                `${Math.max(0, Math.round(value))}px`,
                meta,
              )
            }
            mixed={cornerMixed.bottomRight}
            min={0}
            precision={1}
          />
          <span aria-hidden="true" />
        </>
      ) : null}
    </>
  );
}

function AppearanceScrubField({
  label,
  ariaLabel,
  icon,
  value,
  onChange,
  mixed = false,
  min,
  max,
  step,
  unit,
  precision,
  disabled = false,
}: {
  label: string;
  ariaLabel?: string;
  icon: (props: { className?: string }) => ReactNode;
  value: number;
  onChange: (value: number, meta?: ScrubInputChangeMeta) => void;
  mixed?: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  precision?: number;
  disabled?: boolean;
}) {
  return (
    <ScrubInput
      label={label}
      ariaLabel={ariaLabel ?? label}
      icon={icon}
      value={value}
      onChange={onChange}
      mixed={mixed}
      min={min}
      max={max}
      step={step}
      unit={unit}
      precision={precision}
      disabled={disabled}
      className="min-w-0 gap-0"
      labelClassName="h-6 w-7 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground [&>span]:sr-only"
      inputClassName="h-6 min-w-0 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] border-l-0 bg-[var(--design-editor-control-bg)] px-0 text-left shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
    />
  );
}

function BlendModeMenu({
  styles,
  onStyleChange,
}: {
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
}) {
  const [open, setOpen] = useState(false);
  const blendMode = optionValue(
    BLEND_MODE_OPTIONS,
    styles.mixBlendMode || "normal",
    "normal",
  );
  // Recognize the Mixed sentinel BEFORE optionValue's fallback maps it to
  // "normal" — a mixed selection must not check a wrong concrete mode.
  // Isolation only disambiguates pass-through vs normal, so it only makes the
  // state mixed when the blend mode itself resolves to normal.
  const blendModeMixed =
    isMixedValue(styles.mixBlendMode) ||
    (blendMode === "normal" && isMixedValue(styles.isolation));
  const selectedBlendMode = blendModeMixed
    ? MIXED_VALUE
    : blendMode === "normal" && styles.isolation !== "isolate"
      ? "pass-through"
      : blendMode;
  const options = [
    {
      value: "pass-through",
      label: "Pass through", // i18n-ignore design blend mode label
    },
    ...BLEND_MODE_OPTIONS,
  ] as const;
  const selectBlendMode = (value: (typeof options)[number]["value"]) => {
    if (value === "pass-through") {
      onStyleChange("mixBlendMode", "normal");
      onStyleChange("isolation", "auto");
      return;
    }
    onStyleChange("mixBlendMode", value);
    if (value === "normal") onStyleChange("isolation", "isolate");
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={"Blend mode" /* i18n-ignore design inspector action */}
          aria-pressed={open}
          className={cn(
            "size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground",
            open &&
              "bg-[var(--design-editor-accent-color)]/20 text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
          )}
        >
          <IconDroplet className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="left"
        align="start"
        sideOffset={8}
        className="z-[100010] w-48 rounded-xl border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] p-1 text-[13px] text-foreground shadow-2xl"
      >
        {blendModeMixed ? (
          <>
            {/* Placeholder state for a mixed selection: the check sits next to
                "Mixed" instead of a wrong concrete mode. Picking any option
                below applies it to every selected object. */}
            <div className="flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-muted-foreground">
              <span className="flex size-4 shrink-0 items-center justify-center">
                <IconCheck className="size-4" />
              </span>
              <span>{MIXED_VALUE}</span>
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className="flex h-9 cursor-pointer items-center gap-3 rounded-md px-3 text-[13px] focus:bg-[var(--design-editor-control-bg)]"
            onSelect={() => selectBlendMode(option.value)}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {selectedBlendMode === option.value ? (
                <IconCheck className="size-4" />
              ) : null}
            </span>
            <span>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type StrokeLayerKind = "border" | "outline";
type StrokePosition = "inside" | "outside" | "center";

function StrokeLayerControl({
  kind,
  visible,
  color,
  width,
  styleValue,
  outlineOffset,
  onStyleChange,
  onStylesChange,
  onRemove,
  element,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  kind: StrokeLayerKind;
  visible: boolean;
  color: string;
  width: string;
  styleValue: string;
  /** Only meaningful when `kind === "outline"` — distinguishes outside vs
   * center (see readStrokeOutlinePosition). Ignored for `kind === "border"`. */
  outlineOffset?: string;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onRemove: () => void;
  /**
   * Optional — only needed for the keyframe diamond / breakpoint override
   * indicator. The motion catalog only tracks `border-color`/`border-width`
   * (not `outline-color`/`outline-width`), so both affordances only ever
   * render for `kind === "border"` regardless of whether these are passed.
   */
  element?: ElementInfo;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const strokePositionOptions = STROKE_POSITION_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.labels.${option.key}`),
  }));
  const prefix = kind === "border" ? "border" : "outline";
  const position: StrokePosition =
    kind === "border"
      ? "inside"
      : readStrokeOutlinePosition(width, outlineOffset);

  const movePosition = (next: string) => {
    if (next === position) return;
    const nextPosition = next as StrokePosition;
    if (kind === "outline" && nextPosition !== "inside") {
      // Outline → outline (outside ⇄ center): no property-family change,
      // just re-point outline-offset. Single commit, no remove/re-add.
      onStyleChange(
        "outlineOffset",
        outlineOffsetForPosition(nextPosition, width),
      );
      return;
    }
    const nextPrefix = nextPosition === "inside" ? "border" : "outline";
    const patch: Record<string, string> = {
      [`${nextPrefix}Color`]: color,
      [`${nextPrefix}Width`]: width || "1px",
      // Preserve the original border-style so a hidden stroke (style:none,
      // kept visible as a row because width>0) stays hidden when its
      // position moves. Only default to solid when there's no style at all.
      [`${nextPrefix}Style`]: styleValue || "solid",
    };
    if (nextPrefix === "outline") {
      patch.outlineOffset = outlineOffsetForPosition(
        nextPosition === "center" ? "center" : "outside",
        width || "1px",
      );
    }
    // Clear the property family we're moving away from in the SAME commit
    // (rather than a separate onRemove() call afterwards) so the position
    // switch lands as one history step instead of two.
    if (kind === "border") {
      patch.borderWidth = "0px";
      patch.borderStyle = "none";
    } else {
      patch.outlineWidth = "0px";
      patch.outlineStyle = "none";
    }
    if (onStylesChange) {
      onStylesChange(patch);
    } else {
      Object.entries(patch).forEach(([property, value]) =>
        onStyleChange(property, value),
      );
    }
  };

  return (
    <div className="space-y-1.5">
      {/* design stroke row: [swatch+hex trigger (flex-1)] [eye] [remove] */}
      <div className="group flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ColorInput
            label=""
            value={cssColorOrFallback(color, "#000000")}
            onChange={(value, meta) =>
              onStyleChange(`${prefix}Color`, value, meta)
            }
            supportedPaintTypes={SOLID_ONLY_PAINT_TYPES}
          />
        </div>
        <SectionIconButton
          label={
            visible
              ? t("editPanel.labels.hideLayer")
              : t("editPanel.labels.showLayer")
          }
          onClick={() => {
            // Hide/show by zeroing the stroke color's alpha (preserving its
            // RGB channels — same durable, comment-free technique as the
            // fill visibility toggle) instead of forcing borderStyle to
            // "none"/"solid". Writing "none" would lose a dashed/dotted
            // style permanently, since there is no round-trippable "unset"
            // for that keyword once it's overwritten.
            const parsed = parseCssColor(color);
            if (visible) {
              onStyleChange(
                `${prefix}Color`,
                parsed ? rgbaToCss(withColorOpacity(parsed, 0)) : "transparent",
              );
              return;
            }
            const restoredColor = parsed
              ? rgbaToCss(withColorOpacity(parsed, 100))
              : "#000000";
            onStyleChange(`${prefix}Color`, restoredColor);
            if (styleValue === "none") onStyleChange(`${prefix}Style`, "solid");
            onStyleChange(
              `${prefix}Width`,
              width === "0px" ? "1px" : width || "1px",
            );
          }}
        >
          {visible ? (
            <IconEye className="size-3.5" />
          ) : (
            <IconEyeOff className="size-3.5" />
          )}
        </SectionIconButton>
        <SectionIconButton
          label={t("editPanel.labels.removeLayer")}
          onClick={onRemove}
        >
          <IconMinus className="size-3.5" />
        </SectionIconButton>
        {kind === "border" && element ? (
          <FieldTrailer
            element={element}
            motionCssProperty="border-color"
            motionKeyframeContext={motionKeyframeContext}
            breakpointOverrideContext={breakpointOverrideContext}
            hoverRevealClassName="opacity-0 group-hover:opacity-100"
          />
        ) : null}
      </div>
      {/* design stroke geometry: position + weight side by side */}
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={position} onValueChange={movePosition}>
          <SelectTrigger className="h-6 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {strokePositionOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="!text-[11px]"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="group/field relative min-w-0">
          <ScrubInput
            label={t("editPanel.labels.weight")}
            ariaLabel={t("editPanel.labels.weight")}
            icon={IconBorderStyle}
            value={cssLengthNumber(width)}
            onChange={(value, meta) => {
              const nextWidth = `${Math.max(0, roundToOneDecimal(value))}px`;
              // A centered outline's offset is derived from its own width
              // (-width/2) — re-derive it in the same commit so the stroke
              // stays centered as its weight changes, instead of drifting
              // toward "outside" as a stale offset.
              if (kind === "outline" && position === "center") {
                const patch = {
                  outlineWidth: nextWidth,
                  outlineOffset: outlineOffsetForPosition("center", nextWidth),
                };
                if (onStylesChange) onStylesChange(patch, meta);
                else
                  Object.entries(patch).forEach(([p, v]) =>
                    onStyleChange(p, v, meta),
                  );
                return;
              }
              onStyleChange(`${prefix}Width`, nextWidth, meta);
            }}
            unit="px"
            min={0}
            precision={1}
            className="gap-0"
            labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
            inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
          />
          {kind === "border" && element ? (
            <FieldTrailer
              element={element}
              motionCssProperty="border-width"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
              hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ShadowLayer {
  id: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

function defaultDropShadowLayer(index: number): ShadowLayer {
  return {
    id: `shadow-${index}`,
    x: 0,
    y: 4,
    blur: 12,
    spread: 0,
    color: "rgba(0, 0, 0, 0.25)",
    inset: false,
  };
}

function parseShadowLayers(value: string | undefined): ShadowLayer[] {
  return splitCssLayers(value || "")
    .filter((layer) => layer && layer !== "none")
    .map((layer, index) => parseShadowLayer(layer, index));
}

function parseShadowLayer(layer: string, index: number): ShadowLayer {
  const tokens = splitCssTokens(layer);
  const inset = tokens.includes("inset");
  const colorToken =
    tokens.find((token) => parseCssColor(token) || token === "transparent") ??
    // Preserve a color we don't parse into RGBA (currentColor, var(--x), or any
    // unrecognized keyword): the color is the non-inset token that doesn't look
    // like a numeric length. Without this, tweaking x/y/blur would reset it to
    // the hardcoded default below.
    tokens.find((token) => token !== "inset" && !/^[-+]?[\d.]/.test(token)) ??
    "rgba(0, 0, 0, 0.25)";
  const numericTokens = tokens
    .filter((token) => token !== "inset" && token !== colorToken)
    .map((token) => parseFloat(token))
    .filter((value) => Number.isFinite(value));

  return {
    id: `shadow-${index}`,
    x: numericTokens[0] ?? 0,
    y: numericTokens[1] ?? 4,
    blur: numericTokens[2] ?? 12,
    spread: numericTokens[3] ?? 0,
    color: colorToken,
    inset,
  };
}

function splitCssTokens(value: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      const token = value.slice(start, index).trim();
      if (token) tokens.push(token);
      start = index + 1;
    }
  }
  const finalToken = value.slice(start).trim();
  if (finalToken) tokens.push(finalToken);
  return tokens;
}

function serializeShadowLayers(layers: ShadowLayer[]) {
  if (!layers.length) return "none";
  return layers
    .map((layer) =>
      [
        layer.inset ? "inset" : "",
        `${Math.round(layer.x)}px`,
        `${Math.round(layer.y)}px`,
        `${Math.max(0, Math.round(layer.blur))}px`,
        // Spread radius may legitimately be negative for either inset or
        // drop shadows — only blur-radius is clamped to >= 0 in CSS.
        `${Math.round(layer.spread)}px`,
        layer.color,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(", ");
}

function readBlurFilter(value: string | undefined): number {
  const match = value?.match(/blur\((-?\d+(?:\.\d+)?)px\)/);
  return match ? Math.max(0, Number(match[1])) : 0;
}

function hasBlurFilter(value: string | undefined): boolean {
  return /blur\(/.test(value || "");
}

function setBlurFilterValue(value: string | undefined, blur: number): string {
  const blurFn = `blur(${Math.max(0, Math.round(blur))}px)`;
  const existing = compactCssValue(value, "");
  return existing.includes("blur(")
    ? existing.replace(/blur\([^)]*\)/, blurFn)
    : blurFn;
}

function shadowColorWithOpacity(color: string, opacity: number): string {
  const parsed = parseCssColor(color);
  return parsed
    ? rgbaToCss(withColorOpacity(parsed, opacity))
    : opacity <= 0
      ? "rgba(0, 0, 0, 0)"
      : color;
}

function ShadowEffectRow({
  layer,
  index,
  onChange,
  onRemove,
  onToggleVisibility,
  dragHandleLabel,
  dropIndicator,
  rowProps,
  handleProps,
  element,
  motionKeyframeContext,
}: {
  layer: ShadowLayer;
  index: number;
  onChange: (patch: Partial<ShadowLayer>, meta?: StyleChangeMeta) => void;
  onRemove: () => void;
  onToggleVisibility: () => void;
  dragHandleLabel: string;
  dropIndicator?: "before" | "after" | null;
  rowProps: ReturnType<ReturnType<typeof useRowDragReorder>["getRowProps"]>;
  handleProps: ReturnType<
    ReturnType<typeof useRowDragReorder>["getHandleProps"]
  >;
  /**
   * Optional — only needed for the keyframe diamond (drop shadow's motion
   * track keys the WHOLE `box-shadow` value, so there's one diamond for the
   * layer, not per x/y/blur field). No breakpoint override indicator here —
   * multi-layer `box-shadow` composition isn't covered by
   * `getBreakpointOverrideState`'s per-property model yet.
   */
  element?: ElementInfo;
  motionKeyframeContext?: MotionKeyframeFieldContext;
}) {
  const t = useT();
  const visible = colorHasVisibleAlpha(layer.color);
  return (
    <Popover>
      {/* design effect row: [grip] [swatch+label+x,y,blur trigger (flex-1)] [eye] [remove] */}
      <div className="group relative flex items-center gap-1.5" {...rowProps}>
        <RowDragHandle
          label={dragHandleLabel}
          dropIndicator={dropIndicator}
          {...handleProps}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
          >
            <span
              className="size-4 shrink-0 rounded-sm border border-[var(--design-editor-control-border)]"
              style={swatchStyle(layer.color)}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {index === 0
                ? t("editPanel.labels.dropShadow")
                : `${t("editPanel.labels.dropShadow")} ${index + 1}`}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(layer.x)}, {Math.round(layer.y)},{" "}
              {Math.round(layer.blur)}
            </span>
          </button>
        </PopoverTrigger>
        <SectionIconButton
          label={
            visible
              ? t("editPanel.labels.hideLayer")
              : t("editPanel.labels.showLayer")
          }
          onClick={onToggleVisibility}
        >
          {visible ? (
            <IconEye className="size-3.5" />
          ) : (
            <IconEyeOff className="size-3.5" />
          )}
        </SectionIconButton>
        <SectionIconButton
          label={t("editPanel.labels.removeLayer")}
          onClick={onRemove}
        >
          <IconMinus className="size-3.5" />
        </SectionIconButton>
        {index === 0 && element ? (
          <FieldTrailer
            element={element}
            motionCssProperty="box-shadow"
            motionKeyframeContext={motionKeyframeContext}
            hoverRevealClassName="opacity-0 group-hover:opacity-100"
          />
        ) : null}
      </div>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-72 p-3"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">
              {t("editPanel.labels.dropShadow")}
            </p>
            <button
              type="button"
              className={cn(
                "rounded border px-2 py-1 !text-[11px]",
                layer.inset
                  ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)] text-foreground"
                  : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground",
              )}
              onClick={() => onChange({ inset: !layer.inset })}
            >
              {t("editPanel.labels.innerShadow")}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ScrubInput
              label="X"
              value={layer.x}
              onChange={(value, meta) =>
                onChange({ x: value }, { phase: meta?.phase })
              }
              unit="px"
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label="Y"
              value={layer.y}
              onChange={(value, meta) =>
                onChange({ y: value }, { phase: meta?.phase })
              }
              unit="px"
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label={t("editPanel.labels.blur")}
              value={layer.blur}
              onChange={(value, meta) =>
                onChange({ blur: Math.max(0, value) }, { phase: meta?.phase })
              }
              unit="px"
              min={0}
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label={t("editPanel.labels.spread")}
              value={layer.spread}
              // Spread radius is valid negative for both inset AND drop
              // (non-inset) shadows in real CSS — negative spread shrinks
              // the shadow smaller than the box before blurring, a common
              // technique. Only blur-radius must stay >= 0.
              onChange={(value, meta) =>
                onChange({ spread: value }, { phase: meta?.phase })
              }
              unit="px"
              precision={1}
              inputClassName="h-6"
            />
          </div>
          <ColorInput
            label={t("editPanel.labels.color")}
            value={cssColorOrFallback(layer.color, "rgba(0, 0, 0, 0.25)")}
            onChange={(value, meta) => onChange({ color: value }, meta)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Page-level properties when nothing is selected */
function PageProperties({
  styles,
  onStyleChange,
  onStylesChange,
}: {
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
}) {
  const t = useT();
  const baseFontFamilyOptions = FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontFamilies.${option.key}`),
  }));
  const fontFamily = resolveFontFamilySelectValue(styles.fontFamily);
  const fontFamilyOptions = FONT_FAMILY_OPTIONS.some(
    (option) => option.value === fontFamily,
  )
    ? baseFontFamilyOptions
    : [
        {
          value: fontFamily,
          label: displayFontFamilyName(styles.fontFamily || fontFamily),
        },
        ...baseFontFamilyOptions,
      ];

  return (
    <div>
      <PanelSection title={t("editPanel.sections.page")}>
        <ColorInput
          label={t("editPanel.labels.background")}
          value={styles.backgroundColor || ""}
          onChange={(v, meta) => onStyleChange("backgroundColor", v, meta)}
          backgroundImage={styles.backgroundImage}
          backgroundSize={styles.backgroundSize}
          backgroundRepeat={styles.backgroundRepeat}
          backgroundPosition={styles.backgroundPosition}
          onBackgroundImageChange={(v) => onStyleChange("backgroundImage", v)}
          onImageFillChange={(value) =>
            commitStylePatch(
              imageFillToBackgroundStyles(value),
              onStyleChange,
              onStylesChange,
            )
          }
          blendMode={styles.backgroundBlendMode || "normal"}
          onBlendModeChange={(v) => onStyleChange("backgroundBlendMode", v)}
          supportsLayeredFills
        />
        <PropSelect
          label={t("editPanel.labels.font")}
          value={fontFamily}
          onChange={(v) => onStyleChange("fontFamily", v)}
          options={fontFamilyOptions}
        />
        <PropInput
          label={t("editPanel.labels.baseSize")}
          value={styles.fontSize || "16px"}
          onChange={(v) => onStyleChange("fontSize", v)}
          placeholder="16px"
          defaultUnit="px"
        />
      </PanelSection>
    </div>
  );
}

/** Text element properties */
function TypographyProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const baseFontFamilyOptions = FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontFamilies.${option.key}`),
  }));
  const fontFamily = resolveFontFamilySelectValue(styles.fontFamily);
  const fontFamilyOptions = FONT_FAMILY_OPTIONS.some(
    (option) => option.value === fontFamily,
  )
    ? baseFontFamilyOptions
    : [
        {
          value: fontFamily,
          label: displayFontFamilyName(styles.fontFamily || fontFamily),
        },
        ...baseFontFamilyOptions,
      ];
  const fontWeightOptions = FONT_WEIGHT_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontWeights.${option.key}`),
  }));
  const textAlign = styles.textAlign || "left";

  // Mixed-selection guards: a multi-selection with differing values injects
  // the MIXED_VALUE sentinel string into these computedStyles fields (see
  // mixedElementFromSelection/sameOrMixed). Parsing that sentinel with
  // parseNumericValue/Number() silently yields 0/NaN-fallback instead of
  // reflecting "differs across selection", which previously showed a
  // fabricated 0 (size), 1.2 (line-height), or blank (tracking) rather than
  // the Mixed state ScrubInput already knows how to render — same pattern as
  // the rotation field above.
  const fontWeightIsMixed = isMixedValue(styles.fontWeight);
  const fontSizeIsMixed = isMixedValue(styles.fontSize);
  const lineHeightIsMixed = isMixedValue(styles.lineHeight);
  const letterSpacingIsMixed = isMixedValue(styles.letterSpacing);

  // M1 · Text resizing mode (auto-width / auto-height / fixed). the design
  // editor's text nodes always expose this segment. Read authored
  // (inlineStyles) values, not computed ones: an absolutely-positioned
  // element's computed width/height always resolve to a real px value even
  // when the author never set them, so "auto" and "a specific 200px" were
  // indistinguishable before — every text node misread as "fixed". Falls
  // back to the computed-style heuristic for older payloads that predate
  // inlineStyles. Convention (matches DesignEditor primitive creation and
  // setResizeMode below): auto-width = width unset/max-content + pre-wrap;
  // auto-height = fixed width + height unset/auto; fixed = both fixed. A
  // drag-created box (display:flex, explicit width+height, whiteSpace
  // unset→normal) correctly falls through to "fixed".
  const authoredResizeWidth = authoredStyleValue(element, "width");
  const authoredResizeHeight = authoredStyleValue(element, "height");
  const authoredWhiteSpace = authoredStyleValue(element, "whiteSpace");
  const hasInlineStyleInfo = Boolean(element.inlineStyles);
  const widthIsAuto = hasInlineStyleInfo
    ? !authoredResizeWidth || authoredResizeWidth === "max-content"
    : !styles.width ||
      styles.width === "auto" ||
      styles.width === "max-content";
  const heightIsAuto = hasInlineStyleInfo
    ? !authoredResizeHeight || authoredResizeHeight === "auto"
    : !styles.height || styles.height === "auto";
  const isPreWrapOrNoWrap = hasInlineStyleInfo
    ? authoredWhiteSpace === "pre-wrap" || authoredWhiteSpace === "nowrap"
    : styles.whiteSpace === "nowrap";
  const resizeMode: TextResizeMode =
    widthIsAuto && isPreWrapOrNoWrap
      ? "auto-width"
      : !heightIsAuto && !widthIsAuto
        ? "fixed"
        : "auto-height";
  const currentWidth = styles.width && !widthIsAuto ? styles.width : "200px";
  const currentHeight = styles.height && !heightIsAuto ? styles.height : "48px";
  const setResizeMode = (mode: TextResizeMode) => {
    if (mode === "auto-width") {
      onStyleChange("width", "max-content");
      onStyleChange("height", "auto");
      onStyleChange("whiteSpace", "pre-wrap");
    } else if (mode === "auto-height") {
      onStyleChange("width", currentWidth);
      onStyleChange("height", "auto");
      onStyleChange("whiteSpace", "normal");
    } else {
      onStyleChange("width", currentWidth);
      onStyleChange("height", currentHeight);
      onStyleChange("whiteSpace", "normal");
    }
  };

  // M2 · Vertical text alignment (top / middle / bottom). For an auto-layout
  // text container (display:flex) this maps to whichever flex property
  // controls the vertical/cross axis — justifyContent when flex-direction is
  // column, alignItems when row (the DesignEditor drag-created default; see
  // primitive creation, which sets display:flex + alignItems:center with no
  // explicit flex-direction, i.e. row). For any non-flex display,
  // `verticalAlign` is a no-op: it only affects how an inline/inline-block/
  // table-cell box sits relative to *sibling* line-box content, not how its
  // own content sits within its own box — exactly the case for point text
  // (inline-block). So instead of ever writing verticalAlign, convert the
  // element to flex the same way a drag-created box is authored, then read/
  // write through the row-axis property (alignItems) like that default.
  const display = (styles.display || "").toLowerCase();
  const isFlexText = display.includes("flex");
  const isColumnFlexText =
    isFlexText && styles.flexDirection?.includes("column");
  const verticalAlignSourceProp = isColumnFlexText
    ? styles.justifyContent
    : styles.alignItems;
  const verticalAlign = !isFlexText
    ? "top"
    : verticalAlignSourceProp === "center"
      ? "middle"
      : verticalAlignSourceProp === "flex-end"
        ? "bottom"
        : "top";
  const setVerticalAlign = (mode: "top" | "middle" | "bottom") => {
    // Converting a non-flex element matches the drag-created fixed-size text
    // box exactly: display:flex, default (row) flex-direction — so the
    // vertical axis is alignItems, same as the pre-existing row case below.
    if (!isFlexText) onStyleChange("display", "flex");
    const cssValue =
      mode === "middle"
        ? "center"
        : mode === "bottom"
          ? "flex-end"
          : "flex-start";
    onStyleChange(isColumnFlexText ? "justifyContent" : "alignItems", cssValue);
  };

  return (
    <PanelSection title={t("editPanel.sections.typography")}>
      {/* Row 1: font family full-width.
          Wrapped in a height-constrained div so the SelectTrigger button's
          hit-target is exactly h-6 (24 px) and cannot visually or physically
          overlap the weight/size row below (bug: trigger extended ~12 px into
          the next row, causing clicks meant for the size input to open this
          dropdown instead). */}
      <div className="h-6 overflow-hidden">
        <Select
          value={fontFamily}
          onValueChange={(v) => onStyleChange("fontFamily", v)}
        >
          <SelectTrigger
            aria-label={t("editPanel.labels.font")}
            className="h-6 w-full rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fontFamilyOptions.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="!text-[11px]"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Row 2: weight + size side by side */}
      <div className="grid grid-cols-2 gap-1.5">
        <Select
          value={fontWeightIsMixed ? MIXED_VALUE : styles.fontWeight || "400"}
          onValueChange={(v) => onStyleChange("fontWeight", v)}
        >
          <SelectTrigger className="h-6 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fontWeightIsMixed ? (
              <SelectItem
                value={MIXED_VALUE}
                disabled
                className="!text-[11px] text-muted-foreground"
              >
                {MIXED_VALUE}
              </SelectItem>
            ) : null}
            {fontWeightOptions.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="!text-[11px]"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ScrubInput
          label={t("editPanel.labels.size")}
          ariaLabel={t("editPanel.labels.size")}
          icon={IconLetterCase}
          value={
            fontSizeIsMixed
              ? 0
              : styles.fontSize
                ? parseNumericValue(styles.fontSize)
                : 16
          }
          mixed={fontSizeIsMixed}
          onChange={(value, meta) =>
            onStyleChange(
              "fontSize",
              `${Math.max(1, roundToOneDecimal(value))}px`,
              meta,
            )
          }
          unit="px"
          min={1}
          precision={1}
          className="gap-0"
          labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
      </div>

      {/* Row 3: line-height + letter-spacing with design-editor leading icons */}
      <div className="grid grid-cols-2 gap-1.5">
        <ScrubInput
          label={t("editPanel.labels.lineHeight")}
          ariaLabel={t("editPanel.labels.lineHeight")}
          icon={IconLineHeight}
          value={
            lineHeightIsMixed
              ? 0
              : resolveLineHeight(styles.lineHeight, styles.fontSize)
          }
          mixed={lineHeightIsMixed}
          onChange={(value, meta) =>
            onStyleChange("lineHeight", String(Math.max(0.1, value)), meta)
          }
          min={0.1}
          step={0.1}
          precision={2}
          className="gap-0"
          labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
        <ScrubInput
          label={t("editPanel.labels.tracking")}
          ariaLabel={t("editPanel.labels.tracking")}
          icon={IconLetterSpacing}
          value={
            letterSpacingIsMixed
              ? 0
              : styles.letterSpacing
                ? parseNumericValue(styles.letterSpacing)
                : 0
          }
          mixed={letterSpacingIsMixed}
          onChange={(value, meta) =>
            onStyleChange("letterSpacing", `${value}px`, meta)
          }
          unit="px"
          precision={1}
          className="gap-0"
          labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
      </div>

      {/* Row 4: horizontal + vertical text alignment */}
      <div className="flex items-center gap-1.5">
        <InspectorSegment>
          <InspectorIconButton
            label={t("editPanel.textAligns.left")}
            active={textAlign === "left" || textAlign === "start"}
            onClick={() => onStyleChange("textAlign", "left")}
          >
            <IconAlignLeft className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={t("editPanel.textAligns.center")}
            active={textAlign === "center"}
            onClick={() => onStyleChange("textAlign", "center")}
          >
            <IconAlignCenter className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={t("editPanel.textAligns.right")}
            active={textAlign === "right" || textAlign === "end"}
            onClick={() => onStyleChange("textAlign", "right")}
          >
            <IconAlignRight className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={t("editPanel.textAligns.justify")}
            active={textAlign === "justify"}
            onClick={() => onStyleChange("textAlign", "justify")}
          >
            <IconAlignJustified className="size-3.5" />
          </InspectorIconButton>
        </InspectorSegment>
        <InspectorSegment>
          <InspectorIconButton
            label={"Align top" /* i18n-ignore design vertical text align */}
            active={verticalAlign === "top"}
            onClick={() => setVerticalAlign("top")}
          >
            <IconLayoutAlignTop className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={"Align middle" /* i18n-ignore design vertical text align */}
            active={verticalAlign === "middle"}
            onClick={() => setVerticalAlign("middle")}
          >
            <IconLayoutAlignMiddle className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={"Align bottom" /* i18n-ignore design vertical text align */}
            active={verticalAlign === "bottom"}
            onClick={() => setVerticalAlign("bottom")}
          >
            <IconLayoutAlignBottom className="size-3.5" />
          </InspectorIconButton>
        </InspectorSegment>
        <div className="ml-auto shrink-0">
          <TypographyDetailsPopover
            resizeMode={resizeMode}
            onResizeModeChange={setResizeMode}
          />
        </div>
      </div>
    </PanelSection>
  );
}

/** Flex container properties */
function FlexContainerControls({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  // The element's CURRENT layout flow as authored in code, read from its own
  // computed `display`: block/flow-root/grid/etc. = "normal flow",
  // flex/inline-flex = auto layout. We forward it so the AutoLayoutMatrix Flow
  // control can show the right state (normal vs horizontal/vertical/wrap)
  // instead of an empty "add" affordance.
  const display = (styles.display || "").toLowerCase();
  const isFlex = element.isFlexContainer || display.includes("flex");
  const displayMode: AutoLayoutMatrixValue["display"] = isFlex
    ? "flex"
    : "block";
  const hasLayoutChildren = elementHasLayoutChildren(element);
  const flexDirection: AutoLayoutMatrixValue["direction"] =
    styles.flexDirection?.includes("column") ? "vertical" : "horizontal";
  const mainGapAxis =
    flexDirection === "horizontal" ? "horizontal" : "vertical";
  // When the element is in normal flow (not flex yet), picking any flow option
  // must first turn it into a flex container; otherwise setting flex-direction
  // alone is a no-op against a block element.
  const ensureFlex = () => {
    if (!isFlex) onStyleChange("display", "flex");
  };

  /**
   * Handle the Flow control switching between flex and normal-flow (block).
   *
   * For 'flex': ensures display:flex is set (ensureFlex path).
   * For 'block': sets display:block and leaves children unchanged — mirrors
   * the { kind:"autoLayout", enabled:false } substrate intent exactly.
   */
  const handleDisplayChange = (nextDisplay: "flex" | "block") => {
    if (nextDisplay === "flex") {
      ensureFlex();
      return;
    }
    // Turn auto-layout off: set display:block, leaving children unchanged.
    // This is the direct equivalent of the autoLayout substrate with enabled:false.
    onStyleChange("display", "block");
  };

  const padding = {
    top: parseNumericValue(styles.paddingTop || "0"),
    right: parseNumericValue(styles.paddingRight || "0"),
    bottom: parseNumericValue(styles.paddingBottom || "0"),
    left: parseNumericValue(styles.paddingLeft || "0"),
  };
  const allPaddingEqual =
    padding.top === padding.right &&
    padding.top === padding.bottom &&
    padding.top === padding.left;
  const [paddingLinked, setPaddingLinked] = useState(allPaddingEqual);

  useEffect(() => {
    if (!allPaddingEqual && paddingLinked) setPaddingLinked(false);
  }, [allPaddingEqual, paddingLinked]);

  const autoLayoutValue: AutoLayoutMatrixValue = {
    direction: flexDirection,
    wrap: styles.flexWrap === "wrap" ? "wrap" : "nowrap",
    alignment: autoLayoutAlignmentFromStyles(styles, flexDirection),
    gap: parseNumericValue(styles.gap || "0"),
    padding,
    paddingLinked,
    childSizing: {
      horizontal: inferElementSizing(element, "horizontal"),
      vertical: inferElementSizing(element, "vertical"),
    },
    childMinMax: {
      horizontal: readElementMinMax(element, "horizontal"),
      vertical: readElementMinMax(element, "vertical"),
    },
    clipContent: styles.overflow === "hidden",
    resolvedSize: {
      horizontal: cssElementSize(element, "horizontal"),
      vertical: cssElementSize(element, "vertical"),
    },
    mixedSize: {
      horizontal: isMixedValue(styles.width),
      vertical: isMixedValue(styles.height),
    },
    display: displayMode,
    spaceBetween: styles.justifyContent === "space-between",
  };

  return (
    <div className="space-y-2">
      <AutoLayoutMatrix
        value={autoLayoutValue}
        onDisplayChange={handleDisplayChange}
        onDirectionChange={(direction) => {
          ensureFlex();
          onStyleChange(
            "flexDirection",
            direction === "vertical" ? "column" : "row",
          );
        }}
        onWrapChange={(wrap) => {
          ensureFlex();
          onStyleChange("flexWrap", wrap);
        }}
        onAlignmentChange={(alignment) => {
          if (autoLayoutValue.direction === "vertical") {
            onStyleChange(
              "alignItems",
              horizontalToJustify(alignment.horizontal),
            );
            onStyleChange(
              "justifyContent",
              verticalToAlign(alignment.vertical),
            );
            return;
          }
          onStyleChange(
            "justifyContent",
            horizontalToJustify(alignment.horizontal),
          );
          onStyleChange("alignItems", verticalToAlign(alignment.vertical));
        }}
        onGapChange={(gap) => onStyleChange("gap", `${gap}px`)}
        onPaddingChange={(nextPadding) => {
          onStyleChange("paddingTop", `${nextPadding.top}px`);
          onStyleChange("paddingRight", `${nextPadding.right}px`);
          onStyleChange("paddingBottom", `${nextPadding.bottom}px`);
          onStyleChange("paddingLeft", `${nextPadding.left}px`);
        }}
        onPaddingLinkedChange={(linked) => {
          setPaddingLinked(linked);
          if (!linked) return;
          const avg = Math.round(
            (padding.top + padding.right + padding.bottom + padding.left) / 4,
          );
          onStyleChange("paddingTop", `${avg}px`);
          onStyleChange("paddingRight", `${avg}px`);
          onStyleChange("paddingBottom", `${avg}px`);
          onStyleChange("paddingLeft", `${avg}px`);
        }}
        onClipContentChange={(clipContent) =>
          onStyleChange("overflow", clipContent ? "hidden" : "visible")
        }
        onDistribute={(axis) => {
          if (axis === mainGapAxis) {
            onStyleChange("justifyContent", "space-between");
          } else if (autoLayoutValue.wrap === "wrap") {
            onStyleChange("alignContent", "space-between");
          }
        }}
        onGapModeChange={(gapMode, axis) => {
          if (axis !== mainGapAxis) return;
          ensureFlex();
          onStyleChange(
            "justifyContent",
            gapMode === "auto" ? "space-between" : "flex-start",
          );
        }}
        availableChildSizing={availableSizingForElement(element)}
        onChildSizingChange={(axis, sizing) => {
          commitElementSizing(
            element,
            axis,
            sizing,
            onStyleChange,
            onStylesChange,
          );
        }}
        onChildSizeChange={(axis, px, meta) =>
          onStyleChange(
            axis === "horizontal" ? "width" : "height",
            `${px}px`,
            meta,
          )
        }
        onChildMinMaxChange={(axis, kind, val) =>
          commitElementMinMax(axis, kind, val, onStyleChange)
        }
        showChildLayoutControls={hasLayoutChildren}
      />
    </div>
  );
}

function FlexChildControls({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const alignSelfOptions = ALIGN_SELF_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.alignSelfOptions.${option.key}`),
  }));

  return (
    <div className="space-y-2">
      <SubsectionLabel>{t("editPanel.layoutContext.child")}</SubsectionLabel>
      <PropInput
        label={t("editPanel.labels.flexGrow")}
        value={styles.flexGrow || ""}
        onChange={(v) => onStyleChange("flexGrow", v)}
        placeholder="0"
      />
      <PropInput
        label={t("editPanel.labels.flexShrink")}
        value={styles.flexShrink || ""}
        onChange={(v) => onStyleChange("flexShrink", v)}
        placeholder="1"
      />
      <PropInput
        label={t("editPanel.labels.flexBasis")}
        value={styles.flexBasis || ""}
        onChange={(v) => onStyleChange("flexBasis", v)}
        placeholder="auto"
        defaultUnit="px"
      />
      <PropInput
        label={t("editPanel.labels.order")}
        value={styles.order || ""}
        onChange={(v) => onStyleChange("order", v)}
        placeholder="0"
      />
      <PropSelect
        label={t("editPanel.labels.alignSelf")}
        value={optionValue(ALIGN_SELF_OPTIONS, styles.alignSelf, "auto")}
        onChange={(v) => onStyleChange("alignSelf", v)}
        options={alignSelfOptions}
      />
    </div>
  );
}

function GridChildControls({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const alignSelfOptions = ALIGN_SELF_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.alignSelfOptions.${option.key}`),
  }));

  return (
    <div className="space-y-2">
      <SubsectionLabel>
        {t("editPanel.layoutContext.gridChild")}
      </SubsectionLabel>
      <PropInput
        label={t("editPanel.labels.gridColumn")}
        value={styles.gridColumn || ""}
        onChange={(v) => onStyleChange("gridColumn", v)}
        placeholder="auto"
      />
      <PropInput
        label={t("editPanel.labels.gridRow")}
        value={styles.gridRow || ""}
        onChange={(v) => onStyleChange("gridRow", v)}
        placeholder="auto"
      />
      <PropSelect
        label={t("editPanel.labels.alignSelf")}
        value={optionValue(ALIGN_SELF_OPTIONS, styles.alignSelf, "auto")}
        onChange={(v) => onStyleChange("alignSelf", v)}
        options={alignSelfOptions}
      />
    </div>
  );
}

function LayoutContextProperties({
  element,
  onStyleChange,
  onStylesChange,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const flexChild = isParentFlex(element);
  const gridChild = isParentGrid(element);
  const availableSizing = availableSizingForElement(element);
  const isContainer = isContainerElement(element);
  const aspectLock = useAspectRatioLock(element);

  const childControls = (
    <>
      {flexChild ? (
        <div className="border-t border-border/70 pt-2">
          <FlexChildControls element={element} onStyleChange={onStyleChange} />
        </div>
      ) : null}
      {gridChild ? (
        <div className="border-t border-border/70 pt-2">
          <GridChildControls element={element} onStyleChange={onStyleChange} />
        </div>
      ) : null}
    </>
  );

  // Leaf elements (text, img, svg, etc.) never get auto layout — show the plain
  // design W/H sizing block instead.
  if (!isContainer) {
    const widthSizing = inferElementSizing(element, "horizontal");
    const heightSizing = inferElementSizing(element, "vertical");
    // The aspect lock only makes sense between two fixed numeric dimensions —
    // hug/fill don't have an independent px value to scale. Match Figma: the
    // toggle is disabled (not hidden) otherwise, so its state/affordance stays
    // visible but inert.
    const canLockAspect = widthSizing === "fixed" && heightSizing === "fixed";
    const resolvedWidth = cssElementSize(element, "horizontal");
    const resolvedHeight = cssElementSize(element, "vertical");

    const toggleAspectLock = () => {
      if (!canLockAspect) return;
      aspectLock.setLocked(
        !aspectLock.locked,
        resolvedHeight > 0 ? resolvedWidth / resolvedHeight : undefined,
      );
    };

    // Shared W/H commit path: when locked, derive the other axis from the
    // captured ratio and commit both in one patch/history step; otherwise
    // fall back to the existing single-property write. `meta` is the
    // ScrubInput gesture-coalescing metadata forwarded from SizingField's
    // onSizeChange (see AutoLayoutMatrix.tsx) — threading it through here,
    // exactly like the X/Y ScrubStyleInput fields already do, is what lets a
    // W/H drag-scrub coalesce into one undo step instead of one per tick.
    // When locked, the same single `meta` describes the *one* combined
    // gesture driving both axes, so it's forwarded unchanged to whichever
    // commit call carries the patch (StylesChangeHandler/StyleChangeHandler
    // both accept an optional meta already).
    const commitWidth = (px: number, meta?: ScrubInputChangeMeta) => {
      if (aspectLock.locked && canLockAspect && aspectLock.ratio) {
        const nextHeight = deriveLockedAspectSize(
          "width",
          px,
          aspectLock.ratio,
        );
        const patch = { width: `${px}px`, height: `${nextHeight}px` };
        if (onStylesChange) onStylesChange(patch, meta);
        else {
          onStyleChange("width", patch.width, meta);
          onStyleChange("height", patch.height, meta);
        }
        return;
      }
      onStyleChange("width", `${px}px`, meta);
    };
    const commitHeight = (px: number, meta?: ScrubInputChangeMeta) => {
      if (aspectLock.locked && canLockAspect && aspectLock.ratio) {
        const nextWidth = deriveLockedAspectSize(
          "height",
          px,
          aspectLock.ratio,
        );
        const patch = { width: `${nextWidth}px`, height: `${px}px` };
        if (onStylesChange) onStylesChange(patch, meta);
        else {
          onStyleChange("width", patch.width, meta);
          onStyleChange("height", patch.height, meta);
        }
        return;
      }
      onStyleChange("height", `${px}px`, meta);
    };

    return (
      <PanelSection title={t("editPanel.sections.layout")}>
        {/* design-editor single-row-per-axis: [W | value | Fixed/Hug/Fill ▾]
            with the full sizing menu (modes + min/max + variable) per axis,
            plus a chain-link aspect-ratio lock at the FAR RIGHT of the row
            (Figma parity — the constrain-proportions link sits after both W
            and H, not between them). */}
        <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-1.5">
          <div className="group/field relative min-w-0">
            <SizingField
              axis="W"
              sizingAxis="horizontal"
              value={widthSizing}
              resolvedSize={resolvedWidth}
              mixed={isMixedValue(element.computedStyles.width)}
              minMax={readElementMinMax(element, "horizontal")}
              options={availableSizing.horizontal ?? ["fixed"]}
              disabled={false}
              onChange={(mode) =>
                commitElementSizing(
                  element,
                  "horizontal",
                  mode,
                  onStyleChange,
                  onStylesChange,
                )
              }
              onSizeChange={commitWidth}
              onMinMaxChange={(axis, kind, val) =>
                commitElementMinMax(axis, kind, val, onStyleChange)
              }
            />
            <FieldTrailer
              element={element}
              overrideProperty="width"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
            />
          </div>
          <div className="group/field relative min-w-0">
            <SizingField
              axis="H"
              sizingAxis="vertical"
              value={heightSizing}
              resolvedSize={resolvedHeight}
              mixed={isMixedValue(element.computedStyles.height)}
              minMax={readElementMinMax(element, "vertical")}
              options={availableSizing.vertical ?? ["fixed"]}
              disabled={false}
              onChange={(mode) =>
                commitElementSizing(
                  element,
                  "vertical",
                  mode,
                  onStyleChange,
                  onStylesChange,
                )
              }
              onSizeChange={commitHeight}
              onMinMaxChange={(axis, kind, val) =>
                commitElementMinMax(axis, kind, val, onStyleChange)
              }
            />
            <FieldTrailer
              element={element}
              overrideProperty="height"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={
                  aspectLock.locked
                    ? t("editPanel.labels.unlockAspectRatio")
                    : t("editPanel.labels.lockAspectRatio")
                }
                aria-pressed={aspectLock.locked}
                disabled={!canLockAspect}
                onClick={toggleAspectLock}
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground transition-colors",
                  "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  aspectLock.locked &&
                    "text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
                  !canLockAspect && "pointer-events-none opacity-40",
                )}
              >
                {aspectLock.locked ? (
                  <IconLink className="size-3.5" />
                ) : (
                  <IconLinkOff className="size-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {aspectLock.locked
                ? t("editPanel.labels.unlockAspectRatio")
                : t("editPanel.labels.lockAspectRatio")}
            </TooltipContent>
          </Tooltip>
        </div>
        {childControls}
      </PanelSection>
    );
  }

  // Any container element ALREADY has a layout in code — normal flow (block) by
  // default, or flex when it uses flexbox. the design editor never makes you "add" auto
  // layout for a frame, so we always render the full layout controls and let
  // the Flow control reflect/switch the element's current `display`. Choosing a
  // horizontal/vertical/wrap/grid flow applies `display:flex`; choosing the
  // normal-flow option resets to `display:block`.
  return (
    <PanelSection title={t("editPanel.sections.autoLayout")}>
      <FlexContainerControls
        element={element}
        onStyleChange={onStyleChange}
        onStylesChange={onStylesChange}
      />
      {childControls}
    </PanelSection>
  );
}

/**
 * design layout-guide section. Shown for frame/container
 * elements. Renders an overlay column/row guide by applying a non-destructive
 * `backgroundImage` repeating gradient layer tagged so it can be toggled off
 * without disturbing real fills.
 */
const LAYOUT_GUIDE_MARKER = "/* an-layout-guide */";

function hasLayoutGuide(styles: Record<string, string>): boolean {
  return Boolean(styles.backgroundImage?.includes(LAYOUT_GUIDE_MARKER));
}

function LayoutGuideProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  const styles = element.computedStyles;
  const active = hasLayoutGuide(styles);

  const addGuide = () => {
    // 12-column overlay guide — the design editor's default columns layout grid.
    // The LAYOUT_GUIDE_MARKER comment is embedded so hasLayoutGuide and removeGuide
    // can detect/remove it without touching unrelated repeating-linear-gradient fills.
    const guide = `repeating-linear-gradient(to right, color-mix(in srgb, var(--design-editor-accent-color) 22%, transparent) 0 1px, transparent 1px calc(100% / 12)) ${LAYOUT_GUIDE_MARKER}`;
    const existing = compactCssValue(styles.backgroundImage, "");
    onStyleChange(
      "backgroundImage",
      existing ? `${guide}, ${existing}` : guide,
    );
  };

  const removeGuide = () => {
    const layers = splitCssLayers(styles.backgroundImage || "").filter(
      (layer) => !layer.includes(LAYOUT_GUIDE_MARKER),
    );
    onStyleChange(
      "backgroundImage",
      layers.length ? joinCssLayers(layers) : "none",
    );
  };

  return (
    <PanelSection
      title={"Layout guide" /* i18n-ignore design inspector label */}
      defaultCollapsed
      actions={
        <SectionIconButton
          label={
            active
              ? "Remove layout guide" /* i18n-ignore design inspector action */
              : "Add layout guide" /* i18n-ignore design inspector action */
          }
          onClick={active ? removeGuide : addGuide}
        >
          {active ? (
            <IconMinus className="size-3.5" />
          ) : (
            <IconPlus className="size-3.5" />
          )}
        </SectionIconButton>
      }
    >
      {active ? (
        <div className="flex items-center gap-2 rounded-md bg-[var(--design-editor-control-bg)] px-2 py-1.5 !text-[11px] text-muted-foreground">
          <IconLayoutGrid className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-foreground">
            {"Columns" /* i18n-ignore design inspector label */}
          </span>
          <span className="shrink-0 tabular-nums">12</span>
        </div>
      ) : (
        <p className="!text-[11px] text-muted-foreground">
          {"No layout guides" /* i18n-ignore design inspector empty state */}
        </p>
      )}
    </PanelSection>
  );
}

/**
 * Togglable export preview thumbnail (the design editor shows a small preview of the export
 * frame above the export rows). Renders a proportional placeholder reflecting
 * the selected element's aspect ratio, fill, radius and dimensions.
 */
function ExportPreview({ element }: { element: ElementInfo | null }) {
  const rect = element?.boundingRect;
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const styles = element?.computedStyles ?? {};
  const fill = cssColorOrFallback(
    styles.backgroundColor || styles.color,
    "var(--design-editor-control-bg)",
  );
  const radius = Math.min(8, cssLengthNumber(styles.borderRadius || "0"));

  return (
    <div className="mt-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-3">
      <div
        className="mx-auto flex max-h-28 items-center justify-center"
        style={{
          aspectRatio: aspect,
          width: aspect >= 1 ? "100%" : "auto",
          height: aspect < 1 ? "7rem" : "auto",
        }}
      >
        <div
          className="size-full border border-[var(--design-editor-control-border)] shadow-sm"
          style={{ background: fill, borderRadius: radius }}
        />
      </div>
      <p className="mt-2 text-center text-[10px] tabular-nums text-muted-foreground">
        {Math.round(width)} × {Math.round(height)}
      </p>
    </div>
  );
}

/**
 * Reads an authored (as-written) offset/size style, preferring the bridge's
 * `inlineStyles` capture (raw `el.style.<prop>` — "auto"/"" reliably means
 * unset) over `computedStyles` (which always resolves to a px value for
 * absolutely-positioned elements even when the author never set the
 * property, making "unset" indistinguishable from "0px"). Falls back to the
 * computed value for older payloads that predate `inlineStyles`.
 */
export function authoredStyleValue(
  element: ElementInfo,
  property: string,
): string | undefined {
  const inline = element.inlineStyles?.[property];
  if (inline !== undefined) return inline === "auto" ? "" : inline;
  return element.computedStyles[property];
}

/**
 * While a non-default interaction state is active, style-section fields
 * display the STATE's value for a property when it has one, else fall back
 * to the base (Default-state) value — never blank. This is the "overridden
 * shows the override, else shows the inherited base" convention (documented
 * choice: values are shown in their normal weight/color either way, since
 * the state-selector's own accent already signals "you are editing Hover" —
 * repeating that with dimmed/greyed-out base values on every single field
 * would be visual noise; the per-property override DOT, rendered via
 * `InteractionStateOverrideIndicator`, is what marks which specific fields
 * differ from the base in the active state).
 *
 * @param stateStyles  `activeInteractionStateStyles` — the active state's
 *   declared properties for the selected element, or `undefined` when no
 *   state is active / nothing is overridden.
 * @param property  CSS property, camelCase or kebab-case (normalized the
 *   same way `shared/interaction-states.ts` normalizes keys, so callers can
 *   pass either).
 * @param baseValue  The value that would render with no state active
 *   (typically `authoredStyleValue(element, property)` or a computed style).
 */
export function resolveInteractionStateValue(
  stateStyles: Record<string, string> | undefined,
  property: string,
  baseValue: string | undefined,
): string | undefined {
  if (!stateStyles) return baseValue;
  const kebabProperty = property.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`,
  );
  const override = stateStyles[property] ?? stateStyles[kebabProperty];
  return override !== undefined ? override : baseValue;
}

/** Position, size, and spacing properties */
function PositionLayoutProperties({
  element,
  onStyleChange,
  onAlignSelection,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  /**
   * Moves the selection itself (Figma's real "Alignment" row semantics):
   * aligns to the combined selection bounding box for a 2+ multi-selection,
   * or to the parent for a single selected object. When provided, the
   * alignment row's six buttons call this instead of writing flex-alignment
   * properties on the selected element. See the `onAlignSelection` contract
   * note above `PositionLayoutProperties` usage in this file for the exact
   * edge semantics the caller (DesignEditor) must implement.
   */
  onAlignSelection?: (
    edge: "left" | "center-h" | "right" | "top" | "center-v" | "bottom",
  ) => void;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const constrainedPosition =
    styles.position === "absolute" || styles.position === "fixed";
  // NOTE: this row used to also write flex alignment (justifyContent/
  // alignItems) on the selected element when it was a flex container —
  // i.e. it aligned the element's own children. That duplicated exactly
  // what FlexContainerControls' AutoLayoutMatrix already offers via its
  // CompactAlignmentMatrix (onAlignmentChange, wired a few hundred lines
  // up in this file) and was never real Figma behavior: Figma's Alignment
  // row in the Position section always moves the selected object(s), not
  // their children. That fallback has been removed — flex child alignment
  // now lives exclusively in the auto-layout section's alignment matrix.
  const handlePositionAlignH = (value: AlignmentMatrixValue["horizontal"]) => {
    onAlignSelection?.(
      value === "left" ? "left" : value === "right" ? "right" : "center-h",
    );
  };
  const handlePositionAlignV = (value: AlignmentMatrixValue["vertical"]) => {
    onAlignSelection?.(
      value === "top" ? "top" : value === "bottom" ? "bottom" : "center-v",
    );
  };
  // Authored (not computed) offsets: when inlineStyles is present, "auto"/absent
  // is treated as truly unset instead of the computed px fallback, so a plain
  // top-left-anchored element reads as "left" rather than always "left-right".
  const authoredLeft = authoredStyleValue(element, "left");
  const authoredRight = authoredStyleValue(element, "right");
  const authoredTop = authoredStyleValue(element, "top");
  const authoredBottom = authoredStyleValue(element, "bottom");
  const authoredWidth = authoredStyleValue(element, "width");
  const authoredHeight = authoredStyleValue(element, "height");
  const authoredTransform = authoredStyleValue(element, "transform");
  const constraintsValue: ConstraintsValue = {
    horizontal:
      // Check scale before left+right: "scale" writes width:100% and clears
      // left/right to auto, but legacy data may have 0px values that are truthy.
      authoredWidth === "100%"
        ? "scale"
        : authoredLeft && authoredRight
          ? "left-right"
          : authoredRight
            ? "right"
            : authoredTransform?.includes("translateX(-50%)")
              ? "center"
              : "left",
    vertical:
      authoredHeight === "100%"
        ? "scale"
        : authoredTop && authoredBottom
          ? "top-bottom"
          : authoredBottom
            ? "bottom"
            : authoredTransform?.includes("translateY(-50%)")
              ? "center"
              : "top",
  };
  const [constraintsExpanded, setConstraintsExpanded] = useState(false);
  // 3D rotation/perspective progressive-disclosure expander — mirrors
  // CornerRadiusControl's showIndependentCorners pattern. Default-expanded
  // when the authored transform already has non-zero X/Y rotation or
  // perspective, so an element edited elsewhere (e.g. by the agent) doesn't
  // hide its active 3D state behind a collapsed control.
  const initialTransform3DParts = parseTransform3DParts(
    isMixedValue(authoredTransform) ? undefined : authoredTransform,
  );
  const [rotation3DExpanded, setRotation3DExpanded] = useState(
    () =>
      initialTransform3DParts !== null &&
      isTransform3DActive(initialTransform3DParts),
  );

  const handleConstraintsChange = useCallback(
    (value: ConstraintsValue) => {
      onStyleChange("position", "absolute");

      // Compute the desired translateX/Y for each axis independently, then
      // compose both into a single transform write so the two axes don't
      // overwrite each other when both change simultaneously.
      const txValue = value.horizontal === "center" ? "-50%" : null;
      const tyValue = value.vertical === "center" ? "-50%" : null;
      // Start from the current transform, apply X, then apply Y on top.
      const transformAfterX = mergeTranslateFunction(
        authoredTransform,
        "X",
        txValue,
      );
      const transformAfterXY = mergeTranslateFunction(
        transformAfterX,
        "Y",
        tyValue,
      );

      if (value.horizontal === "left") {
        onStyleChange(
          "left",
          authoredLeft || `${Math.round(element.boundingRect.x)}px`,
        );
        onStyleChange("right", "auto");
      } else if (value.horizontal === "right") {
        onStyleChange("right", "0px");
        onStyleChange("left", "auto");
      } else if (value.horizontal === "left-right") {
        onStyleChange(
          "left",
          authoredLeft || `${Math.round(element.boundingRect.x)}px`,
        );
        onStyleChange("right", "0px");
      } else if (value.horizontal === "center") {
        onStyleChange("left", "50%");
        onStyleChange("right", "auto");
      } else {
        // scale: use auto (not 0px) so the left && right truthiness check
        // in the reader does not misidentify this as "left-right".
        onStyleChange("left", "auto");
        onStyleChange("right", "auto");
        onStyleChange("width", "100%");
      }

      if (value.vertical === "top") {
        onStyleChange(
          "top",
          authoredTop || `${Math.round(element.boundingRect.y)}px`,
        );
        onStyleChange("bottom", "auto");
      } else if (value.vertical === "bottom") {
        onStyleChange("bottom", "0px");
        onStyleChange("top", "auto");
      } else if (value.vertical === "top-bottom") {
        onStyleChange(
          "top",
          authoredTop || `${Math.round(element.boundingRect.y)}px`,
        );
        onStyleChange("bottom", "0px");
      } else if (value.vertical === "center") {
        onStyleChange("top", "50%");
        onStyleChange("bottom", "auto");
      } else {
        // scale
        onStyleChange("top", "auto");
        onStyleChange("bottom", "auto");
        onStyleChange("height", "100%");
      }

      // Write the composed transform once, after both axes are resolved.
      onStyleChange("transform", transformAfterXY);
    },
    [
      element.boundingRect.x,
      element.boundingRect.y,
      onStyleChange,
      authoredLeft,
      authoredTop,
      authoredTransform,
    ],
  );

  return (
    <PanelSection
      title={t("editPanel.sections.positionLayout")}
      actions={
        <SectionIconToggle
          label={"Absolute position" /* i18n-ignore design inspector action */}
          active={constrainedPosition}
          onClick={() =>
            onStyleChange(
              "position",
              constrainedPosition ? "relative" : "absolute",
            )
          }
        >
          <IconLayoutDistributeHorizontal className="size-3.5" />
        </SectionIconToggle>
      }
    >
      <div className="space-y-1.5">
        <SubsectionLabel>
          {"Alignment" /* i18n-ignore design inspector label */}
        </SubsectionLabel>
        <div className="flex items-center gap-3">
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.textAligns.left")}
              shortcut="⌥A"
              onClick={() => handlePositionAlignH("left")}
            >
              <IconLayoutAlignLeft className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.textAligns.center")}
              shortcut="⌥H"
              onClick={() => handlePositionAlignH("center")}
            >
              <IconLayoutAlignCenter className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.textAligns.right")}
              shortcut="⌥D"
              onClick={() => handlePositionAlignH("right")}
            >
              <IconLayoutAlignRight className="size-3.5" />
            </InspectorIconButton>
          </InspectorSegment>
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.start")}
              shortcut="⌥W"
              onClick={() => handlePositionAlignV("top")}
            >
              <IconLayoutAlignTop className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.center")}
              shortcut="⌥V"
              onClick={() => handlePositionAlignV("middle")}
            >
              <IconLayoutAlignMiddle className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.end")}
              shortcut="⌥S"
              onClick={() => handlePositionAlignV("bottom")}
            >
              <IconLayoutAlignBottom className="size-3.5" />
            </InspectorIconButton>
          </InspectorSegment>
        </div>
      </div>

      <div className="space-y-1.5">
        <SubsectionLabel>{t("editPanel.labels.position")}</SubsectionLabel>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] gap-2">
          <div className="group/field relative min-w-0">
            <ScrubStyleInput
              label="X"
              ariaLabel="X-position"
              tooltipLabel="X-position"
              value={
                isMixedValue(authoredLeft) ? MIXED_VALUE : authoredLeft || ""
              }
              placeholder={element.boundingRect.x}
              inputClassName="h-6"
              onChange={(v, meta) => {
                // Typing X/Y on a static (non-positioned) element is a no-op on
                // canvas unless we first give it a position to offset from —
                // mirror handleConstraintsChange, which always sets
                // position:absolute (the convention canvas drag/resize and
                // primitive creation both use) before writing left/top.
                if (!constrainedPosition) onStyleChange("position", "absolute");
                onStyleChange("left", `${roundToOneDecimal(v)}px`, meta);
              }}
            />
            <FieldTrailer
              element={element}
              motionCssProperty="translate"
              overrideProperty="left"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
              hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
            />
          </div>
          <div className="group/field relative min-w-0">
            <ScrubStyleInput
              label="Y"
              ariaLabel="Y-position"
              tooltipLabel="Y-position"
              value={
                isMixedValue(authoredTop) ? MIXED_VALUE : authoredTop || ""
              }
              placeholder={element.boundingRect.y}
              inputClassName="h-6"
              onChange={(v, meta) => {
                if (!constrainedPosition) onStyleChange("position", "absolute");
                onStyleChange("top", `${roundToOneDecimal(v)}px`, meta);
              }}
            />
            <FieldTrailer
              element={element}
              motionCssProperty="translate"
              overrideProperty="top"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
              hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={
                  "Constraints" /* i18n-ignore design inspector action */
                }
                aria-pressed={constraintsExpanded}
                onClick={() => setConstraintsExpanded((expanded) => !expanded)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-colors",
                  "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                  constraintsExpanded
                    ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]"
                    : "text-muted-foreground",
                )}
              >
                <ConstraintsPreview value={constraintsValue} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {"Constraints" /* i18n-ignore design inspector tooltip */}
            </TooltipContent>
          </Tooltip>
        </div>
        {constraintsExpanded ? (
          <ConstraintsWidget
            value={constraintsValue}
            onChange={handleConstraintsChange}
            className="pt-1"
          />
        ) : null}
      </div>

      <div className="space-y-1.5">
        <SubsectionLabel>{t("editPanel.labels.rotation")}</SubsectionLabel>
        <div className="group flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ScrubStyleInput
              label="Rotation"
              ariaLabel={t("editPanel.labels.rotation")}
              tooltipLabel={t("editPanel.labels.rotation")}
              hideIcon={false}
              icon={IconAngle}
              labelClassName="[&>span]:sr-only"
              // Detect the Mixed sentinel BEFORE parsing: parseRotationValue
              // would silently turn "Mixed" into 0 and render "0deg" instead
              // of the mixed state (mirrors the opacity field's guard).
              value={
                isMixedValue(styles.transform)
                  ? MIXED_VALUE
                  : `${parseRotationValue(styles.transform)}deg`
              }
              unit="deg"
              inputClassName="h-6"
              onChange={(v, meta) =>
                onStyleChange(
                  "transform",
                  // From a mixed selection the sentinel is not a transform —
                  // treat it as absent so the typed value applies cleanly to
                  // every selected object instead of producing
                  // "Mixed rotate(…)". This field always writes the Z
                  // rotation — back-compat: existing designs'
                  // `transform: rotate()` is the Z axis. When the 3D
                  // expander below is active (non-zero X/Y/perspective),
                  // mergeRotationValue's plain rotate() slot still round-
                  // trips correctly since composeTransform3D always emits a
                  // trailing rotateZ() once 3D is active, which
                  // ROTATE_FN_PATTERN also matches.
                  mergeRotationValue(
                    isMixedValue(styles.transform)
                      ? undefined
                      : styles.transform,
                    v,
                  ),
                  meta,
                )
              }
            />
          </div>
          <FieldTrailer
            element={element}
            motionCssProperty="rotate"
            overrideProperty="transform"
            motionKeyframeContext={motionKeyframeContext}
            breakpointOverrideContext={breakpointOverrideContext}
            hoverRevealClassName="opacity-0 group-hover:opacity-100"
          />
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.labels.flipHorizontal")}
              onClick={() => {
                const [sx, sy] = parseScaleValue(styles.scale);
                onStyleChange("scale", `${sx === -1 ? 1 : -1} ${sy}`);
              }}
            >
              <IconFlipHorizontal className="size-4" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.labels.flipVertical")}
              onClick={() => {
                const [sx, sy] = parseScaleValue(styles.scale);
                onStyleChange("scale", `${sx} ${sy === -1 ? 1 : -1}`);
              }}
            >
              <IconFlipVertical className="size-4" />
            </InspectorIconButton>
          </InspectorSegment>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("editPanel.labels.rotation3d")}
                aria-pressed={rotation3DExpanded}
                onClick={() => setRotation3DExpanded((expanded) => !expanded)}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                  "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                  rotation3DExpanded
                    ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]"
                    : "text-muted-foreground",
                )}
              >
                <IconRotate3d className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("editPanel.labels.rotation3d")}</TooltipContent>
          </Tooltip>
        </div>
        {rotation3DExpanded ? (
          <Rotation3DControls styles={styles} onStyleChange={onStyleChange} />
        ) : null}
      </div>
    </PanelSection>
  );
}

/**
 * Progressive-disclosure X/Y/Z rotation + perspective controls, revealed by
 * the 3D-rotation expander next to the plain (Z-axis) rotation field. See
 * `composeTransform3D`/`parseTransform3DParts` (shared/canvas-math.ts) for
 * the parse/compose contract this wraps.
 *
 * - Transform composition order: `perspective(Npx) rotateX(Xdeg)
 *   rotateY(Ydeg) rotateZ(Zdeg) <preserved translate/scale/etc>` — see the
 *   `composeTransform3D` doc comment for the full rationale (X→Y→Z is a
 *   common 3D-engine Euler convention; Figma hasn't published a composition
 *   order since 3D transforms are unshipped there as of this build).
 * - When X, Y, and Perspective are all zero/empty, the composed transform is
 *   the plain 2D `rotate(Zdeg)` form — zero output churn for existing
 *   designs that never touch this expander.
 * - `transform-style: preserve-3d` is intentionally NOT applied here:
 *   defaulting to flattened (no preserve-3d) matches the conservative,
 *   minimal-footprint choice for this first pass — see the build report for
 *   the preserve-3d-on-children tradeoff.
 */
function Rotation3DControls({
  styles,
  onStyleChange,
}: {
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
}) {
  const t = useT();
  const transformMixed = isMixedValue(styles.transform);
  const parts = transformMixed ? null : parseTransform3DParts(styles.transform);
  // `parts === null` (and not mixed) means the authored transform is a
  // matrix()/matrix3d()/rotate3d() composite (or an unrecognized token) that
  // parseTransform3DParts can't safely invert into independent X/Y/Z/
  // perspective fields — show the fields disabled with a note instead of
  // guessing, matching how Mixed values disable commit rather than silently
  // defaulting to 0. See parseTransform3DParts's doc comment.
  const isCustomTransform = !transformMixed && parts === null;
  const disabled = transformMixed || isCustomTransform;
  const displayParts: Transform3DParts = parts ?? {
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    perspective: 0,
  };

  const commitPart = (
    patch: Partial<Transform3DParts>,
    meta?: ScrubInputChangeMeta,
  ) => {
    if (disabled) return;
    const nextParts: Transform3DParts = { ...displayParts, ...patch };
    onStyleChange(
      "transform",
      composeTransform3D(styles.transform, nextParts),
      meta,
    );
  };

  return (
    <div className="space-y-1.5 pt-1">
      {isCustomTransform ? (
        <p className="!text-[11px] text-muted-foreground">
          {t("editPanel.labels.customTransform")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        <AppearanceScrubField
          label={t("editPanel.labels.rotationX")}
          icon={IconAxisX}
          value={transformMixed ? 0 : displayParts.rotateX}
          onChange={(value, meta) => commitPart({ rotateX: value }, meta)}
          mixed={transformMixed}
          disabled={isCustomTransform}
          step={1}
          unit="deg"
          precision={1}
        />
        <AppearanceScrubField
          label={t("editPanel.labels.rotationY")}
          icon={IconAxisY}
          value={transformMixed ? 0 : displayParts.rotateY}
          onChange={(value, meta) => commitPart({ rotateY: value }, meta)}
          mixed={transformMixed}
          disabled={isCustomTransform}
          step={1}
          unit="deg"
          precision={1}
        />
        <ScrubInput
          label={t("editPanel.labels.perspective")}
          ariaLabel={t("editPanel.labels.perspective")}
          tooltipLabel={t("editPanel.labels.perspectiveHint")}
          icon={IconPerspective}
          value={transformMixed ? 0 : displayParts.perspective}
          onChange={(value, meta) =>
            commitPart({ perspective: Math.max(0, value) }, meta)
          }
          mixed={transformMixed}
          disabled={isCustomTransform}
          min={0}
          step={10}
          unit="px"
          precision={0}
          className="col-span-2 gap-0"
          labelClassName="h-6 w-7 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] [&>span]:sr-only"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
      </div>
    </div>
  );
}

function FillProperties({
  element,
  onStyleChange,
  onStylesChange,
  documentColorPalette = [],
  glslShaderContext,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  /** Document-wide palette (see `extractDocumentColorPalette`), already
   * capped/ordered by frequency. Merged with the current selection's own
   * colors below so a real, always-populated "Document colors" row is
   * available even before any file content has been scanned. */
  documentColorPalette?: string[];
  /**
   * Persistence context for the code-backed Shader paint type (GLSL source
   * saved into the screen HTML). Threaded into the fill picker so its
   * Shader tab opens the GlslShaderPanel.
   */
  glslShaderContext?: GlslShaderPanelContext;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const isTextFillElement = isTextElement(element);
  const fillProperty = isTextFillElement ? "color" : "backgroundColor";
  const fillValue = isTextFillElement
    ? styles.color || ""
    : styles.backgroundColor || "";
  const backgroundLayers = isTextFillElement
    ? []
    : splitCssLayers(styles.backgroundImage || "");
  const backgroundSizeLayers = isTextFillElement
    ? []
    : splitCssLayers(styles.backgroundSize || "");
  const backgroundRepeatLayers = isTextFillElement
    ? []
    : splitCssLayers(styles.backgroundRepeat || "");
  const backgroundPositionLayers = isTextFillElement
    ? []
    : splitCssLayers(styles.backgroundPosition || "");
  const fillIsMixed =
    isMixedValue(fillValue) ||
    isMixedValue(styles.backgroundImage) ||
    isMixedValue(styles.backgroundSize) ||
    isMixedValue(styles.backgroundRepeat) ||
    isMixedValue(styles.backgroundPosition);
  const hasBackgroundLayer = !isTextFillElement && backgroundLayers.length > 0;
  const hasVisibleFill =
    isTextFillElement || colorHasVisibleAlpha(fillValue) || hasBackgroundLayer;

  // Non-destructive fill hide: instead of stashing the pre-hide color in
  // React state (lost on unmount — e.g. deselect then reselect the same
  // element, since FillProperties only mounts while something is selected),
  // zero the alpha channel while preserving the RGB channels in the
  // persisted CSS itself: rgba(r,g,b,0) renders identically to fully
  // transparent, but getComputedStyle round-trips the r/g/b losslessly (CSS
  // color-list channels are real data, unlike comments — verified
  // separately: computed style strips comments but keeps rgba() channels).
  // Showing again just restores alpha to 1 using those same channels, so no
  // stash is required and the hide survives reselect/reload.
  const isHidden = !colorHasVisibleAlpha(fillValue);
  const handleFillVisibilityToggle = () => {
    const parsed = parseCssColor(fillValue);
    if (isHidden) {
      const restored = parsed
        ? rgbaToCss(withColorOpacity(parsed, 100))
        : isTextFillElement
          ? "#000000"
          : "#ffffff";
      onStyleChange(fillProperty, restored);
    } else if (parsed) {
      onStyleChange(fillProperty, rgbaToCss(withColorOpacity(parsed, 0)));
    } else {
      // Value wasn't a parseable color (e.g. already the literal
      // "transparent") — nothing to preserve, transparent is the best we
      // can do.
      onStyleChange(fillProperty, "transparent");
    }
  };

  // Reorder fill layers by dragging: permute all four index-aligned parallel
  // arrays (image/size/repeat/position) together and commit them as one patch
  // so stacking order changes in a single history step. Prefer onStylesChange
  // (single call) when available; otherwise fall back to four sequential
  // onStyleChange calls, matching the commit-path convention used elsewhere
  // in this component (see commitStylePatch).
  const reorderFillLayers = (from: number, to: number) => {
    const reorder = (layers: string[]) => {
      const next = [...layers];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return layers;
      next.splice(to, 0, moved);
      return next;
    };
    const patch = {
      backgroundImage: joinCssLayers(reorder(backgroundLayers)),
      backgroundSize: joinCssLayers(reorder(backgroundSizeLayers)),
      backgroundRepeat: joinCssLayers(reorder(backgroundRepeatLayers)),
      backgroundPosition: joinCssLayers(reorder(backgroundPositionLayers)),
    };
    if (onStylesChange) {
      onStylesChange(patch);
      return;
    }
    Object.entries(patch).forEach(([property, value]) =>
      onStyleChange(property, value),
    );
  };
  const fillDrag = useRowDragReorder(
    backgroundLayers.length,
    reorderFillLayers,
  );

  // Document colors: the selected element's own colors lead the row (so the
  // colors most relevant to what's currently selected are immediately
  // visible), followed by the real document-wide palette collected across
  // every file in the design (see `extractDocumentColorPalette` /
  // `documentColorPalette`, computed once in EditPanel and passed down —
  // this is the actual "every distinct color used in the file" behavior;
  // previously this row only ever showed the 4 lines below, mislabeled as
  // document colors).
  const selectionHexes = selectionColorValues(element)
    .map((c) => {
      const parsed = parseCssColor(c.value);
      return parsed ? rgbaToHex(parsed) : null;
    })
    .filter((h): h is string => Boolean(h));
  // Deduplicate (selectionColorValues already dedupes by raw CSS value, but
  // hex normalisation may collapse additional entries e.g. rgb vs #hex; the
  // document-wide palette is also normalized/deduped on its own, but may
  // still repeat one of the selection's own colors).
  const seenHex = new Set<string>();
  const documentColors = [...selectionHexes, ...documentColorPalette].filter(
    (h) => {
      const key = h.toUpperCase();
      if (seenHex.has(key)) return false;
      seenHex.add(key);
      return true;
    },
  );

  return (
    <PanelSection
      title={t("editPanel.sections.fill")}
      actions={
        <>
          {/* design color-styles affordance (grid icon) to the left of "+".
              Not yet implemented — disabled with a "Coming soon" tooltip
              rather than a dead, silently-no-op click. */}
          <SectionIconButton
            label={t("editPanel.labels.stylesComingSoon")}
            disabled
          >
            <IconLayoutGrid className="size-3.5" />
          </SectionIconButton>
          <SectionIconButton
            label={t("editPanel.labels.addLayer")}
            onClick={() => {
              if (fillIsMixed) {
                commitStylePatch(
                  {
                    color: "#000000",
                    backgroundColor: "#ffffff",
                    backgroundImage: "none",
                  },
                  onStyleChange,
                  onStylesChange,
                );
                return;
              }
              if (isTextFillElement) {
                onStyleChange(
                  "color",
                  cssColorOrFallback(styles.color, "#000000"),
                );
                return;
              }
              if (!colorHasVisibleAlpha(styles.backgroundColor)) {
                onStyleChange(
                  "backgroundColor",
                  cssColorOrFallback(styles.backgroundColor, "#ffffff"),
                );
                return;
              }
              const current = compactCssValue(styles.backgroundImage, "");
              const nextLayer = defaultGradientLayer(
                "linear",
                styles.backgroundColor || "#ffffff",
              );
              if (!current) {
                onStyleChange("backgroundImage", nextLayer);
                return;
              }
              // Prepending a layer without also prepending matching entries
              // to the other three index-aligned parallel arrays
              // (size/repeat/position) would shift every existing layer's
              // index by one, silently re-pairing each of them with the
              // *previous* layer's size/repeat/position (same class of bug
              // as the removeLayer fix above). Commit a default entry for
              // the new layer in all four arrays together, in one patch.
              const patch = {
                backgroundImage: `${nextLayer}, ${current}`,
                backgroundSize: joinCssLayers([
                  "auto",
                  ...backgroundSizeLayers,
                ]),
                backgroundRepeat: joinCssLayers([
                  "no-repeat",
                  ...backgroundRepeatLayers,
                ]),
                backgroundPosition: joinCssLayers([
                  "0% 0%",
                  ...backgroundPositionLayers,
                ]),
              };
              if (onStylesChange) {
                onStylesChange(patch);
                return;
              }
              Object.entries(patch).forEach(([property, value]) =>
                onStyleChange(property, value),
              );
            }}
          >
            <IconPlus className="size-3.5" />
          </SectionIconButton>
        </>
      }
    >
      {fillIsMixed ? (
        <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
          {
            "Click + to replace mixed content" /* i18n-ignore figma mixed fill hint */
          }
        </p>
      ) : hasVisibleFill ? (
        <div className="space-y-1.5">
          {isTextFillElement || colorHasVisibleAlpha(fillValue) ? (
            /* design row: [swatch+hex trigger (flex-1)] [eye] [remove] */
            <div className="group flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ColorInput
                  label=""
                  value={fillValue}
                  onChange={(v, meta) => onStyleChange(fillProperty, v, meta)}
                  // Pass the real layer stack (not "") so that switching this
                  // swatch's paint type to gradient/image composes a new
                  // layer on top of any existing backgroundImage layers
                  // (rendered as their own rows below) instead of clobbering
                  // them — ColorInput derives its add/replace-layer logic
                  // from this prop.
                  backgroundImage={
                    isTextFillElement ? "" : styles.backgroundImage
                  }
                  blendMode={
                    isTextFillElement
                      ? undefined
                      : styles.backgroundBlendMode || "normal"
                  }
                  onBlendModeChange={
                    isTextFillElement
                      ? undefined
                      : (v) => onStyleChange("backgroundBlendMode", v)
                  }
                  // Text fill ("color") can't hold a gradient/image paint —
                  // there is no background-clip:text support here — so never
                  // offer layered fills for it; the picker's Gradient/Image
                  // tabs remain reachable as raw UI (it manages that tab
                  // selection as local state independent of these props) but
                  // ColorInput's setNext guard rejects non-color writes back
                  // into `color` when supportsLayeredFills is false. For any
                  // other element the base fill is a real backgroundImage
                  // layer stack, so wire the same layered-fill handlers the
                  // page background row uses (see PageProperties above).
                  supportsLayeredFills={!isTextFillElement}
                  onBackgroundImageChange={
                    isTextFillElement
                      ? undefined
                      : (v) => onStyleChange("backgroundImage", v)
                  }
                  onImageFillChange={
                    isTextFillElement
                      ? undefined
                      : (value) =>
                          commitStylePatch(
                            imageFillToBackgroundStyles(value),
                            onStyleChange,
                            onStylesChange,
                          )
                  }
                  documentColors={documentColors}
                  pickerKey={[
                    element.sourceId ??
                      element.id ??
                      element.selector ??
                      element.tagName,
                    fillProperty,
                  ].join(":")}
                  // Code-backed GLSL Shader paint type — text fills can't
                  // host a shader canvas, so only container fills get it.
                  glslShaderContext={
                    isTextFillElement ? undefined : glslShaderContext
                  }
                />
              </div>
              <SectionIconButton
                label={
                  isHidden
                    ? t("editPanel.labels.showLayer")
                    : t("editPanel.labels.hideLayer")
                }
                onClick={handleFillVisibilityToggle}
                activateOnPointerDown
              >
                {isHidden ? (
                  <IconEyeOff className="size-3.5" />
                ) : (
                  <IconEye className="size-3.5" />
                )}
              </SectionIconButton>
              <SectionIconButton
                label={t("editPanel.labels.removeLayer")}
                onClick={() => {
                  if (isTextFillElement) {
                    onStyleChange(fillProperty, "transparent");
                    return;
                  }
                  if (onStylesChange) {
                    onStylesChange({
                      backgroundColor: "transparent",
                      backgroundImage: "none",
                    });
                  } else {
                    onStyleChange(fillProperty, "transparent");
                  }
                }}
              >
                <IconMinus className="size-3.5" />
              </SectionIconButton>
              {!isTextFillElement ? (
                <FieldTrailer
                  element={element}
                  motionCssProperty="background-color"
                  motionKeyframeContext={motionKeyframeContext}
                  breakpointOverrideContext={breakpointOverrideContext}
                  hoverRevealClassName="opacity-0 group-hover:opacity-100"
                />
              ) : null}
            </div>
          ) : null}
          {!isTextFillElement
            ? backgroundLayers.map((layer, index) => {
                const gradient = parseGradientLayer(layer);
                // Hidden state lives in the real, persisted backgroundSize
                // marker (see withLayerSizeMarker) rather than React state,
                // so it survives deselect/reselect. Opacity still reflects
                // the gradient's own stop opacities for display, but no
                // longer drives hide/show — a layer can be a fully-opaque
                // gradient and still be hidden via zero-size.
                const hidden = isLayerHiddenBySize(backgroundSizeLayers[index]);
                const opacity = gradient
                  ? averageGradientOpacity(gradient.stops)
                  : 100;
                const label = gradient
                  ? `${gradientLabel(gradient.type)} ${index + 1}`
                  : `${"Image" /* i18n-ignore design inspector paint row */} ${
                      index + 1
                    }`;
                const replaceLayer = (nextLayer: string) => {
                  const nextLayers = [...backgroundLayers];
                  nextLayers[index] = nextLayer;
                  onStyleChange("backgroundImage", joinCssLayers(nextLayers));
                };
                // Remove one fill layer by index. Mirrors reorderFillLayers:
                // all four index-aligned parallel arrays (image/size/repeat/
                // position) must be spliced together and committed as one
                // patch (see removeFillLayerAtIndex), or the arrays fall out
                // of alignment for every layer after the removed index (each
                // remaining layer's size ends up paired with the next
                // layer's repeat/position). The previous version only
                // filtered backgroundImage and backgroundSize, silently
                // leaving backgroundRepeat and backgroundPosition
                // unfiltered/misaligned.
                const removeLayer = () => {
                  const patch = removeFillLayerAtIndex(
                    {
                      backgroundImage: backgroundLayers,
                      backgroundSize: backgroundSizeLayers,
                      backgroundRepeat: backgroundRepeatLayers,
                      backgroundPosition: backgroundPositionLayers,
                    },
                    index,
                  );
                  if (onStylesChange) {
                    onStylesChange(patch);
                    return;
                  }
                  Object.entries(patch).forEach(([property, value]) =>
                    onStyleChange(property, value),
                  );
                };
                const setLayerHidden = (nextHidden: boolean) => {
                  onStyleChange(
                    "backgroundSize",
                    withLayerSizeMarker(
                      backgroundSizeLayers,
                      backgroundLayers.length,
                      index,
                      nextHidden,
                    ),
                  );
                };

                return (
                  /* design row: [grip] [swatch+label+opacity% trigger (flex-1)] [eye] [remove] */
                  <div
                    key={`${layer}-${index}`}
                    className="group relative flex items-center gap-1.5"
                    {...fillDrag.getRowProps(index)}
                  >
                    <RowDragHandle
                      label={t("editPanel.labels.reorderLayer")}
                      dropIndicator={
                        fillDrag.dragIndex != null &&
                        fillDrag.overIndex === index
                          ? fillDrag.overIndex > fillDrag.dragIndex
                            ? "after"
                            : "before"
                          : null
                      }
                      {...fillDrag.getHandleProps(index)}
                    />
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                        >
                          <span
                            className="size-4 shrink-0 rounded-sm border border-[var(--design-editor-control-border)]"
                            style={swatchStyle(layer)}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            {label}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {hidden ? 0 : opacity}%
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="left"
                        align="start"
                        sideOffset={8}
                        className="w-80 p-0"
                      >
                        <DesignColorPicker
                          value={layer}
                          onPaintValueChange={replaceLayer}
                          onChange={(nextColor) => {
                            if (!gradient) return;
                            const firstStop = gradient.stops[0];
                            if (!firstStop) return;
                            replaceLayer(
                              buildGradientLayer(
                                gradient.type,
                                [
                                  { ...firstStop, color: nextColor },
                                  ...gradient.stops.slice(1),
                                ],
                                gradient.prefix,
                              ),
                            );
                          }}
                          paintType={gradient?.type ?? "image"}
                          backgroundImage={layer}
                          backgroundSize={backgroundSizeLayers[index]}
                          backgroundRepeat={backgroundRepeatLayers[index]}
                          backgroundPosition={backgroundPositionLayers[index]}
                          gradientType={gradient?.type}
                          onGradientTypeChange={(type) => {
                            if (!gradient) return;
                            replaceLayer(
                              buildGradientLayer(type, gradient.stops),
                            );
                          }}
                          fillRows={[
                            {
                              id: `layer-${index}`,
                              label,
                              value: layer,
                              type: gradient ? "gradient" : "image",
                              selected: true,
                              swatch: layer,
                            },
                          ]}
                          selectedFillId={`layer-${index}`}
                        />
                      </PopoverContent>
                    </Popover>
                    <SectionIconButton
                      label={
                        hidden
                          ? t("editPanel.labels.showLayer")
                          : t("editPanel.labels.hideLayer")
                      }
                      onClick={() => setLayerHidden(!hidden)}
                      activateOnPointerDown
                    >
                      {hidden ? (
                        <IconEyeOff className="size-3.5" />
                      ) : (
                        <IconEye className="size-3.5" />
                      )}
                    </SectionIconButton>
                    <SectionIconButton
                      label={t("editPanel.labels.removeLayer")}
                      onClick={removeLayer}
                    >
                      <IconMinus className="size-3.5" />
                    </SectionIconButton>
                  </div>
                );
              })
            : null}
        </div>
      ) : null}
    </PanelSection>
  );
}

function StrokeProperties({
  element,
  onStyleChange,
  onStylesChange,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const styles = element.computedStyles;
  // R94 fix — Figma semantics: a text node's "Stroke" is the glyph outline
  // (-webkit-text-stroke), never a box border. Route text nodes to their own
  // control entirely so the border/outline logic below (and its `styles.color`
  // fallback, which used to leak the removed fill color into the stroke) never
  // runs for text at all.
  if (isTextElement(element)) {
    return (
      <TextStrokeProperties
        element={element}
        onStyleChange={onStyleChange}
        onStylesChange={onStylesChange}
      />
    );
  }
  // Visible requires: real width, style not "none" (legacy hide path), and
  // color not zero-alpha (current hide path — see strokeHiddenByColor).
  const borderVisible =
    strokeIsVisible(styles.borderWidth, styles.borderStyle) &&
    !strokeHiddenByColor(styles.borderColor);
  const outlineVisible =
    strokeIsVisible(styles.outlineWidth, styles.outlineStyle) &&
    !strokeHiddenByColor(styles.outlineColor);
  const strokeIsMixed = [
    styles.borderWidth,
    styles.borderStyle,
    styles.borderColor,
    styles.outlineWidth,
    styles.outlineStyle,
    styles.outlineColor,
    styles.outlineOffset,
  ].some(isMixedValue);
  // Render the row whenever a stroke has been configured (non-zero width),
  // even when its style is "none" (hidden). This mirrors Figma's behavior where
  // hidden stroke rows remain present so the user can re-show them via the eye icon.
  const borderExists = cssLengthNumber(styles.borderWidth) > 0;
  const outlineExists = cssLengthNumber(styles.outlineWidth) > 0;
  // Same empty-wrapper hazard as EffectsProperties: border and outline are
  // separate top-level sibling conditionals, so when neither exists (and the
  // mixed-value hint isn't showing either) JSX would still hand PanelSection
  // a truthy array of `null`s as `children`, rendering an empty spacer div
  // under the header instead of staying collapsed like Fill's empty state.
  const hasStrokeContent = strokeIsMixed || borderExists || outlineExists;

  return (
    <PanelSection
      title={t("editPanel.sections.stroke")}
      actions={
        <SectionIconButton
          label={t("editPanel.labels.addLayer")}
          onClick={() => {
            if (strokeIsMixed) {
              commitStylePatch(
                {
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: "#000000",
                  outlineWidth: "0px",
                  outlineStyle: "none",
                },
                onStyleChange,
                onStylesChange,
              );
              return;
            }
            if (!borderVisible) {
              // Restore full alpha before falling back to cssColorOrFallback
              // — a border previously hidden via the eye toggle (zero-alpha,
              // real RGB preserved) is not "transparent" by that helper's
              // narrow literal check, so without this an "Add" click here
              // could silently re-add an invisible border.
              const existingBorderColor = styles.borderColor || styles.color;
              const existingParsed = parseCssColor(existingBorderColor || "");
              const borderColor = cssColorOrFallback(
                existingParsed
                  ? rgbaToCss(withColorOpacity(existingParsed, 100))
                  : existingBorderColor,
                "#000000",
              );
              commitStylePatch(
                {
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor,
                },
                onStyleChange,
                onStylesChange,
              );
              return;
            }
            if (outlineVisible) {
              const outlineWidth = `${
                Math.max(1, cssLengthNumber(styles.outlineWidth, 1)) + 1
              }px`;
              const outlineStyle =
                styles.outlineStyle === "none"
                  ? "solid"
                  : styles.outlineStyle || "solid";
              const outlineColor = cssColorOrFallback(
                styles.outlineColor || styles.borderColor,
                "#000000",
              );
              commitStylePatch(
                {
                  outlineWidth,
                  outlineStyle,
                  outlineColor,
                  outlineOffset: styles.outlineOffset || "0px",
                },
                onStyleChange,
                onStylesChange,
              );
              return;
            }
            commitStylePatch(
              {
                outlineWidth: "1px",
                outlineStyle: "solid",
                outlineColor: cssColorOrFallback(styles.borderColor, "#000000"),
                outlineOffset: "0px",
              },
              onStyleChange,
              onStylesChange,
            );
          }}
        >
          <IconPlus className="size-3.5" />
        </SectionIconButton>
      }
    >
      {hasStrokeContent ? (
        <>
          {strokeIsMixed ? (
            <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
              {
                "Click + to replace mixed content" /* i18n-ignore figma mixed stroke hint */
              }
            </p>
          ) : borderExists ? (
            <StrokeLayerControl
              kind="border"
              visible={borderVisible}
              color={styles.borderColor || "#000000"}
              width={styles.borderWidth || "0px"}
              styleValue={styles.borderStyle || "none"}
              onStyleChange={onStyleChange}
              onStylesChange={onStylesChange}
              onRemove={() => {
                if (onStylesChange) {
                  onStylesChange({ borderWidth: "0px", borderStyle: "none" });
                } else {
                  onStyleChange("borderWidth", "0px");
                }
              }}
              element={element}
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
            />
          ) : null}
          {outlineExists ? (
            <StrokeLayerControl
              kind="outline"
              visible={outlineVisible}
              color={styles.outlineColor || styles.borderColor || "#000000"}
              width={styles.outlineWidth || "0px"}
              styleValue={styles.outlineStyle || "solid"}
              outlineOffset={styles.outlineOffset || "0px"}
              onStyleChange={onStyleChange}
              onStylesChange={onStylesChange}
              onRemove={() => {
                if (onStylesChange) {
                  onStylesChange({ outlineWidth: "0px", outlineStyle: "none" });
                } else {
                  onStyleChange("outlineWidth", "0px");
                }
              }}
              element={element}
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
            />
          ) : null}
        </>
      ) : null}
    </PanelSection>
  );
}

/**
 * R94 fix — text "Stroke" section: a real glyph outline via
 * `-webkit-text-stroke-width` / `-webkit-text-stroke-color`, independent of
 * fill (`color`). Removing the fill (FillProperties zeroing `color`'s alpha)
 * must never hide the glyphs when a stroke is set, and must never coerce the
 * stroke to black by reading `styles.color` — both bugs the box-border-based
 * StrokeProperties path had for text. `-webkit-text-stroke` paints centered
 * on the glyph edge (CSS has no outside/center/inside position control for
 * it, unlike border/outline), so there is no position selector here.
 */
function TextStrokeProperties({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  // R94 fix — read through readTextStrokeStyle rather than the longhand
  // keys directly: right after a reload/reselect the panel's computedStyles
  // may only carry the browser-serialized `-webkit-text-stroke` shorthand
  // (see readTextStrokeStyle's doc comment), not the two longhands a live
  // DOM selection reports. Reading the longhands directly here would make
  // the section falsely show "no stroke" for a stroke that is persisted and
  // rendering.
  const { width, color } = readTextStrokeStyle(styles);
  const isMixed = [
    styles.webkitTextStrokeWidth,
    styles.webkitTextStrokeColor,
    styles["-webkit-text-stroke"],
    styles.WebkitTextStroke,
  ].some(isMixedValue);
  const strokeExists = cssLengthNumber(width) > 0;
  const visible = textStrokeIsVisible(width, color);

  return (
    <PanelSection
      title={t("editPanel.sections.stroke")}
      actions={
        <SectionIconButton
          label={t("editPanel.labels.addLayer")}
          onClick={() => {
            commitStylePatch(
              {
                webkitTextStrokeWidth: "1px",
                webkitTextStrokeColor: resolveTextStrokeColor(color),
              },
              onStyleChange,
              onStylesChange,
            );
          }}
        >
          <IconPlus className="size-3.5" />
        </SectionIconButton>
      }
    >
      {isMixed ? (
        <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
          {
            "Click + to replace mixed content" /* i18n-ignore figma mixed stroke hint */
          }
        </p>
      ) : strokeExists ? (
        <div className="space-y-1.5">
          <div className="group flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <ColorInput
                label=""
                value={resolveTextStrokeColor(color)}
                onChange={(value, meta) =>
                  onStyleChange("-webkit-text-stroke-color", value, meta)
                }
                supportedPaintTypes={SOLID_ONLY_PAINT_TYPES}
              />
            </div>
            <SectionIconButton
              label={
                visible
                  ? t("editPanel.labels.hideLayer")
                  : t("editPanel.labels.showLayer")
              }
              onClick={() => {
                // Same durable, comment-free hide technique as border/outline
                // and fill: zero the stroke color's alpha (preserving its RGB
                // channels) instead of zeroing width, so re-showing restores
                // the exact same color rather than defaulting back to black.
                const parsed = parseCssColor(color);
                if (visible) {
                  onStyleChange(
                    "-webkit-text-stroke-color",
                    parsed
                      ? rgbaToCss(withColorOpacity(parsed, 0))
                      : "transparent",
                  );
                  return;
                }
                const restoredColor = parsed
                  ? rgbaToCss(withColorOpacity(parsed, 100))
                  : "#000000";
                commitStylePatch(
                  {
                    "-webkit-text-stroke-color": restoredColor,
                    "-webkit-text-stroke-width":
                      width === "0px" ? "1px" : width,
                  },
                  onStyleChange,
                  onStylesChange,
                );
              }}
            >
              {visible ? (
                <IconEye className="size-3.5" />
              ) : (
                <IconEyeOff className="size-3.5" />
              )}
            </SectionIconButton>
            <SectionIconButton
              label={t("editPanel.labels.removeLayer")}
              onClick={() => {
                commitStylePatch(
                  {
                    "-webkit-text-stroke-width": "0px",
                    "-webkit-text-stroke-color": "transparent",
                  },
                  onStyleChange,
                  onStylesChange,
                );
              }}
            >
              <IconMinus className="size-3.5" />
            </SectionIconButton>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <span aria-hidden="true" />
            <ScrubInput
              label={t("editPanel.labels.weight")}
              ariaLabel={t("editPanel.labels.weight")}
              icon={IconBorderStyle}
              value={cssLengthNumber(width)}
              onChange={(value, meta) => {
                const nextWidth = `${Math.max(0, roundToOneDecimal(value))}px`;
                onStyleChange("-webkit-text-stroke-width", nextWidth, meta);
              }}
              unit="px"
              min={0}
              precision={1}
              className="gap-0"
              labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
              inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
            />
          </div>
        </div>
      ) : null}
    </PanelSection>
  );
}

function AppearanceProperties({
  element,
  onStyleChange,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const hidden =
    styles.visibility === "hidden" ||
    styles.display === "none" ||
    parseNumericValue(styles.opacity || "1") === 0;
  return (
    <PanelSection
      title={t("root.commandAppearance")}
      actions={
        <>
          <SectionIconToggle
            label={
              hidden
                ? "Show" /* i18n-ignore design inspector action */
                : "Hide" /* i18n-ignore design inspector action */
            }
            active={hidden}
            onClick={() =>
              onStyleChange("visibility", hidden ? "visible" : "hidden")
            }
          >
            {hidden ? (
              <IconEyeOff className="size-3.5" />
            ) : (
              <IconEye className="size-3.5" />
            )}
          </SectionIconToggle>
          <BlendModeMenu styles={styles} onStyleChange={onStyleChange} />
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5">
        <p className="min-w-0 truncate !text-[11px] font-medium text-muted-foreground">
          {t("editPanel.labels.opacity")}
        </p>
        <p className="min-w-0 truncate !text-[11px] font-medium text-muted-foreground">
          {t("editPanel.labels.cornerRadius")}
        </p>
        <span aria-hidden="true" />
        <div className="group/field relative min-w-0">
          <AppearanceScrubField
            label={t("editPanel.labels.opacity")}
            icon={IconGridDots}
            value={
              isMixedValue(styles.opacity)
                ? 0
                : parseNumericValue(styles.opacity || "1") * 100
            }
            onChange={(v, meta) =>
              onStyleChange("opacity", String(v / 100), meta)
            }
            mixed={isMixedValue(styles.opacity)}
            min={0}
            max={100}
            step={1}
            unit="%"
            precision={1}
          />
          <FieldTrailer
            element={element}
            motionCssProperty="opacity"
            motionKeyframeContext={motionKeyframeContext}
            breakpointOverrideContext={breakpointOverrideContext}
            className="absolute -top-3.5 right-0"
            hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
          />
        </div>
        {/* Selection-stable key so per-selection UI state (the independent-
            corners toggle, which ratchets open while corners differ) resets on
            selection change instead of leaking to the next element — same
            pattern as ExportSettingsPanel. */}
        <CornerRadiusControl
          key={elementIdentityKey(element)}
          styles={styles}
          onStyleChange={onStyleChange}
          element={element}
          motionKeyframeContext={motionKeyframeContext}
          breakpointOverrideContext={breakpointOverrideContext}
        />
      </div>
    </PanelSection>
  );
}

function EffectsProperties({
  element,
  onStyleChange,
  onStylesChange,
  glslShaderContext,
  motionKeyframeContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  /**
   * Persistence context for the code-backed Shader effect type (GLSL
   * overlay rendered above the element's content, saved into the screen
   * HTML). When absent the Shader entry is hidden from the Add-effect menu.
   */
  glslShaderContext?: GlslShaderPanelContext;
  motionKeyframeContext?: MotionKeyframeFieldContext;
}) {
  const t = useT();
  const [shaderPickerOpen, setShaderPickerOpen] = useState(false);
  const styles = element.computedStyles;
  const blurValue = readBlurFilter(styles.filter);
  const filterHasBlur = hasBlurFilter(styles.filter);
  // M5 · Background (backdrop) blur is a distinct design effect type, backed by
  // CSS `backdrop-filter: blur()` (vs layer blur's `filter: blur()`).
  const backdropFilterValue =
    styles.backdropFilter || styles.webkitBackdropFilter;
  const backdropFilterHasBlur = hasBlurFilter(backdropFilterValue);
  const backdropBlurValue = readBlurFilter(backdropFilterValue);
  const [hiddenEffectStash, setHiddenEffectStash] = useState<
    Record<string, string>
  >({});
  const effectStashKey = elementIdentityKey(element);
  const layerBlurStashKey = `${effectStashKey}:filter:blur`;
  const backdropBlurStashKey = `${effectStashKey}:backdrop-filter:blur`;
  const shadowLayers = parseShadowLayers(styles.boxShadow);
  const setShadowLayers = (layers: ShadowLayer[], meta?: StyleChangeMeta) => {
    const boxShadow = serializeShadowLayers(layers);
    if (onStylesChange) onStylesChange({ boxShadow }, meta);
    else onStyleChange("boxShadow", boxShadow, meta);
  };
  const addDropShadow = () =>
    setShadowLayers([
      ...shadowLayers,
      defaultDropShadowLayer(shadowLayers.length),
    ]);
  const addLayerBlur = () => onStyleChange("filter", "blur(4px)");
  const addBackgroundBlur = () => onStyleChange("backdropFilter", "blur(8px)");
  const reorderShadowLayers = (from: number, to: number) => {
    const next = [...shadowLayers];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    setShadowLayers(next);
  };
  const shadowDrag = useRowDragReorder(
    shadowLayers.length,
    reorderShadowLayers,
  );
  // Whether there is anything at all to render below the header row. Each
  // effect kind below is its own top-level sibling conditional (not one
  // single ternary), so when every one of them is empty, JSX would still
  // hand PanelSection a real (truthy) array of `null`s as `children` — its
  // `children &&` guard can't tell that apart from "has content" and renders
  // an empty spacer div under the header. Gating the whole block behind one
  // boolean keeps `children` a real `null` in that case, matching how the
  // other sections (e.g. Fill) stay collapsed-empty.
  const hasEffectsContent =
    shadowLayers.length > 0 ||
    filterHasBlur ||
    backdropFilterHasBlur ||
    Boolean(glslShaderContext?.nodeId);

  return (
    <PanelSection
      title={t("editPanel.sections.effects")}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
              aria-label={t("editPanel.labels.addLayer")}
            >
              <IconPlus className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              className="gap-2 !text-[11px]"
              onSelect={addDropShadow}
            >
              <IconShadow className="size-3.5" />
              {t("editPanel.labels.dropShadow")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 !text-[11px]"
              onSelect={addLayerBlur}
            >
              <IconBlur className="size-3.5" />
              {t("editPanel.labels.layerBlur")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 !text-[11px]"
              onSelect={addBackgroundBlur}
            >
              <IconBackground className="size-3.5" />
              {"Background blur" /* i18n-ignore design effect type */}
            </DropdownMenuItem>
            {glslShaderContext?.nodeId ? (
              <DropdownMenuItem
                className="gap-2 !text-[11px]"
                onSelect={() => {
                  // Defer past the dropdown's close so the inline picker's
                  // focus handling isn't clobbered by menu teardown.
                  setTimeout(() => setShaderPickerOpen(true), 0);
                }}
              >
                <IconWaveSine className="size-3.5" />
                {t("editPanel.labels.shaderEffectType")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {hasEffectsContent ? (
        <>
          {shadowLayers.length ? (
            <div className="space-y-1.5">
              {shadowLayers.map((layer, index) => (
                <ShadowEffectRow
                  key={layer.id}
                  layer={layer}
                  index={index}
                  dragHandleLabel={t("editPanel.labels.reorderLayer")}
                  dropIndicator={
                    shadowDrag.dragIndex != null &&
                    shadowDrag.overIndex === index
                      ? shadowDrag.overIndex > shadowDrag.dragIndex
                        ? "after"
                        : "before"
                      : null
                  }
                  rowProps={shadowDrag.getRowProps(index)}
                  handleProps={shadowDrag.getHandleProps(index)}
                  onChange={(patch, meta) => {
                    const next = shadowLayers.map((candidate) =>
                      candidate.id === layer.id
                        ? { ...candidate, ...patch }
                        : candidate,
                    );
                    setShadowLayers(next, meta);
                  }}
                  onToggleVisibility={() => {
                    const visible = colorHasVisibleAlpha(layer.color);
                    const shadowStashKey = `${effectStashKey}:shadow:${layer.id}`;
                    if (visible) {
                      setHiddenEffectStash((prev) => ({
                        ...prev,
                        [shadowStashKey]: layer.color,
                      }));
                      const next = shadowLayers.map((candidate) =>
                        candidate.id === layer.id
                          ? {
                              ...candidate,
                              color: shadowColorWithOpacity(candidate.color, 0),
                            }
                          : candidate,
                      );
                      setShadowLayers(next);
                      return;
                    }

                    const restored =
                      hiddenEffectStash[shadowStashKey] ??
                      shadowColorWithOpacity(layer.color, 25);
                    setHiddenEffectStash((prev) => {
                      const next = { ...prev };
                      delete next[shadowStashKey];
                      return next;
                    });
                    const next = shadowLayers.map((candidate) =>
                      candidate.id === layer.id
                        ? { ...candidate, color: restored }
                        : candidate,
                    );
                    setShadowLayers(next);
                  }}
                  onRemove={() =>
                    setShadowLayers(
                      shadowLayers.filter(
                        (candidate) => candidate.id !== layer.id,
                      ),
                    )
                  }
                  element={element}
                  motionKeyframeContext={motionKeyframeContext}
                />
              ))}
            </div>
          ) : null}
          {filterHasBlur ? (
            /* design effect row for layer blur: flat row matching shadow rows */
            <Popover>
              <div className="group flex items-center gap-1.5">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {t("editPanel.labels.layerBlur")}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(blurValue)}px
                    </span>
                  </button>
                </PopoverTrigger>
                <SectionIconButton
                  label={
                    blurValue > 0
                      ? t("editPanel.labels.hideLayer")
                      : t("editPanel.labels.showLayer")
                  }
                  onClick={() => {
                    if (blurValue > 0) {
                      setHiddenEffectStash((prev) => ({
                        ...prev,
                        [layerBlurStashKey]: String(blurValue),
                      }));
                      onStyleChange(
                        "filter",
                        setBlurFilterValue(styles.filter, 0),
                      );
                      return;
                    }

                    const restored = Number(
                      hiddenEffectStash[layerBlurStashKey],
                    );
                    const nextBlur =
                      Number.isFinite(restored) && restored > 0 ? restored : 4;
                    setHiddenEffectStash((prev) => {
                      const next = { ...prev };
                      delete next[layerBlurStashKey];
                      return next;
                    });
                    onStyleChange(
                      "filter",
                      setBlurFilterValue(styles.filter, nextBlur),
                    );
                  }}
                >
                  {blurValue > 0 ? (
                    <IconEye className="size-3.5" />
                  ) : (
                    <IconEyeOff className="size-3.5" />
                  )}
                </SectionIconButton>
                <SectionIconButton
                  label={t("editPanel.labels.removeLayer")}
                  onClick={() => onStyleChange("filter", "none")}
                  disabled={!filterHasBlur}
                >
                  <IconMinus className="size-3.5" />
                </SectionIconButton>
              </div>
              <PopoverContent
                side="left"
                align="start"
                sideOffset={8}
                className="w-56 p-3"
              >
                <ScrubInput
                  label={t("editPanel.labels.blur")}
                  value={blurValue}
                  onChange={(value, meta) =>
                    onStyleChange(
                      "filter",
                      setBlurFilterValue(styles.filter, value),
                      meta,
                    )
                  }
                  unit="px"
                  min={0}
                  precision={1}
                  labelClassName="w-16"
                  inputClassName="h-6"
                />
              </PopoverContent>
            </Popover>
          ) : null}
          {backdropFilterHasBlur ? (
            /* M5 · Background (backdrop) blur effect row — mirrors the layer-blur row */
            <Popover>
              <div className="group flex items-center gap-1.5">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {"Background blur" /* i18n-ignore design effect type */}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(backdropBlurValue)}px
                    </span>
                  </button>
                </PopoverTrigger>
                <SectionIconButton
                  label={
                    backdropBlurValue > 0
                      ? t("editPanel.labels.hideLayer")
                      : t("editPanel.labels.showLayer")
                  }
                  onClick={() => {
                    if (backdropBlurValue > 0) {
                      setHiddenEffectStash((prev) => ({
                        ...prev,
                        [backdropBlurStashKey]: String(backdropBlurValue),
                      }));
                      onStyleChange(
                        "backdropFilter",
                        setBlurFilterValue(backdropFilterValue, 0),
                      );
                      return;
                    }

                    const restored = Number(
                      hiddenEffectStash[backdropBlurStashKey],
                    );
                    const nextBlur =
                      Number.isFinite(restored) && restored > 0 ? restored : 8;
                    setHiddenEffectStash((prev) => {
                      const next = { ...prev };
                      delete next[backdropBlurStashKey];
                      return next;
                    });
                    onStyleChange(
                      "backdropFilter",
                      setBlurFilterValue(backdropFilterValue, nextBlur),
                    );
                  }}
                >
                  {backdropBlurValue > 0 ? (
                    <IconEye className="size-3.5" />
                  ) : (
                    <IconEyeOff className="size-3.5" />
                  )}
                </SectionIconButton>
                <SectionIconButton
                  label={t("editPanel.labels.removeLayer")}
                  onClick={() => onStyleChange("backdropFilter", "none")}
                  disabled={!backdropFilterHasBlur}
                >
                  <IconMinus className="size-3.5" />
                </SectionIconButton>
              </div>
              <PopoverContent
                side="left"
                align="start"
                sideOffset={8}
                className="w-56 p-3"
              >
                <ScrubInput
                  label={t("editPanel.labels.blur")}
                  value={backdropBlurValue}
                  onChange={(value, meta) =>
                    onStyleChange(
                      "backdropFilter",
                      setBlurFilterValue(backdropFilterValue, value),
                      meta,
                    )
                  }
                  unit="px"
                  min={0}
                  precision={1}
                  labelClassName="w-16"
                  inputClassName="h-6"
                />
              </PopoverContent>
            </Popover>
          ) : null}
          {glslShaderContext?.nodeId ? (
            /* Code-backed GLSL shader effect — overlay canvas above the
           element's content, persisted as editable GLSL in the screen HTML
           (see shared/shader-fills.ts). Renders its row (when applied) and
           the picker (when adding). */
            <GlslShaderEffectSection
              context={glslShaderContext}
              pickerOpen={shaderPickerOpen}
              onPickerOpenChange={setShaderPickerOpen}
            />
          ) : null}
        </>
      ) : null}
    </PanelSection>
  );
}

/** One file's worth of content to scan for document-wide colors. */
export interface DocumentColorSourceFile {
  id: string;
  content: string;
}

// Matches hex (#rgb/#rgba/#rrggbb/#rrggbbaa), legacy comma rgb()/rgba(), and
// hsl()/hsla() color literals appearing anywhere in raw HTML/CSS text (inline
// `style="..."` attributes and `<style>` blocks alike — both are plain
// substrings of `content`, so a single text scan covers both). Modern
// space-separated `rgb(R G B [/ A])` and DOM-resolved formats (oklch,
// color(display-p3 ...)) are intentionally out of scope: `parseCssColor` (the
// non-DOM parser, safe to run in a plain Node/vitest environment) doesn't
// resolve them, and pulling in the canvas-based `parseCssColorExtended`
// resolver would make this helper impure/untestable without jsdom.
const CSS_COLOR_TOKEN_PATTERN =
  /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|(?:rgb|hsl)a?\([^)]*\)/gi;

/**
 * Extracts a document-wide color palette from raw file contents: every
 * distinct color literal (hex/rgb/hsl) found anywhere in the given files'
 * HTML/CSS text, normalized to uppercase hex, deduped, and ordered by
 * descending frequency (most-used colors first) so the most relevant swatches
 * lead the grid. Capped at `limit` entries — real designs can reference many
 * more distinct color strings than are useful to show as quick-pick swatches.
 *
 * Pure and DOM-free so it can run against any file content (server-rendered,
 * cached, or live) and is unit-testable without jsdom.
 */
export function extractDocumentColorPalette(
  files: DocumentColorSourceFile[],
  limit = 24,
): string[] {
  const countByHex = new Map<string, number>();
  for (const file of files) {
    if (!file.content) continue;
    const matches = file.content.match(CSS_COLOR_TOKEN_PATTERN);
    if (!matches) continue;
    for (const token of matches) {
      const parsed = parseCssColor(token);
      if (!parsed) continue;
      // Skip fully transparent tokens — not a meaningful "document color"
      // swatch (matches selectionColorValues' same filter below).
      if (parsed.a === 0) continue;
      const hex = rgbaToHex(parsed).toUpperCase();
      countByHex.set(hex, (countByHex.get(hex) ?? 0) + 1);
    }
  }
  return Array.from(countByHex.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex]) => hex);
}

interface SelectionColorValue {
  property: string;
  value: string;
}

function selectionColorValues(element: ElementInfo): SelectionColorValue[] {
  const styles = element.computedStyles;
  const rawValues: SelectionColorValue[] = [
    { property: "color", value: styles.color },
    { property: "backgroundColor", value: styles.backgroundColor },
    { property: "borderColor", value: styles.borderColor },
    { property: "outlineColor", value: styles.outlineColor },
  ];
  const seen = new Set<string>();
  return rawValues
    .map((color) => ({ ...color, value: color.value?.trim() }))
    .filter((color): color is SelectionColorValue => Boolean(color.value))
    .filter(
      (color) =>
        color.value !== "transparent" && color.value !== "rgba(0, 0, 0, 0)",
    )
    .filter((color) => {
      const key = color.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Uppercase 6-char hex (no #) for a CSS color, matching the design editor's row readout. */
function selectionDisplayHex(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value.replace(/^#/, "").toUpperCase();
  return rgbaToHex(parsed).replace(/^#/, "").toUpperCase();
}

function SelectionColorsProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  // M6 · the design editor's Selection colors collapses to a single "Show selection colors"
  // affordance, expanding to one editable [swatch · hex · opacity] row per
  // unique color — matching the Fill row grammar instead of a swatch strip.
  const [expanded, setExpanded] = useState(false);
  const colors = selectionColorValues(element);
  if (!colors.length) return null;

  return (
    <PanelSection
      title={"Selection colors" /* i18n-ignore design inspector label */}
    >
      {expanded ? (
        <div className="space-y-1.5">
          {colors.map((color, index) => {
            const parsed = parseCssColor(color.value);
            const opacity = parsed ? alphaToOpacity(parsed.a) : 100;
            return (
              <Popover key={`${color.value}-${index}`}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-full items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
                    aria-label={color.value}
                  >
                    <span
                      className="size-4 shrink-0 rounded-[3px] border border-border/60"
                      style={swatchStyle(color.value)}
                    />
                    <span className="min-w-0 flex-1 truncate text-left uppercase tabular-nums">
                      {selectionDisplayHex(color.value)}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {opacity}%
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="left"
                  align="start"
                  sideOffset={8}
                  className="w-80 p-0"
                >
                  <DesignColorPicker
                    value={cssColorOrFallback(color.value, "#000000")}
                    // PF12: per-tick drag preview vs. one authoritative
                    // commit on gesture-end — same split as ColorInput's
                    // setNext (see its PF12 comment above).
                    onChange={(value) =>
                      onStyleChange(color.property, value, {
                        phase: "preview",
                      })
                    }
                    onChangeComplete={(value) =>
                      onStyleChange(color.property, value, {
                        phase: "commit",
                      })
                    }
                  />
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      ) : (
        <button
          type="button"
          className="flex h-6 w-full items-center justify-between gap-2 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 text-left !text-[11px] text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground"
          onClick={() => setExpanded(true)}
        >
          <span className="truncate">
            {"Show selection colors" /* i18n-ignore design inspector label */}
          </span>
          <div className="flex shrink-0 items-center -space-x-1">
            {colors.slice(0, 3).map((color, index) => (
              <span
                key={`${color.value}-${index}`}
                className="size-3.5 rounded-sm border border-[var(--design-editor-panel-bg)]"
                style={swatchStyle(color.value)}
              />
            ))}
          </div>
        </button>
      )}
    </PanelSection>
  );
}

const TEXT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "a",
  "strong",
  "em",
  "label",
  "li",
]);

// ─── Make it real — inline upgrade card (§3, §6.6) ──────────────────────────

/**
 * Payload shape returned by `connect-builder-app`.  Only the fields used by
 * the card UI are typed here; the action may return additional fields.
 */
interface ConnectBuilderAppResult {
  connected: boolean;
  builderEnabled: boolean;
  connectUrl: string;
  appHost: string;
  branchProjectId?: string;
  cta: {
    kind: "connect-builder" | "configure-project";
    label: string;
    description: string;
    primaryAction: string;
    connectUrl: string;
  } | null;
  message: string;
}

/**
 * Inline "Make it real" upgrade card.
 *
 * Rendered wherever a real-app-only control is reached on an inline design
 * (Component source jump, token write-back, live captures, etc.).  Queries
 * `connect-builder-app` to determine the current connection state, then
 * offers the appropriate CTA:
 *
 *   - Not connected → "Connect Builder.io" button (opens connectUrl)
 *   - Connected, no project → "Open Builder settings" (configure project ID)
 *   - Fully enabled → "Make it real" button (calls migrate-inline-design-to-app)
 *
 * The card is progressively disclosed: it only mounts when a gated control is
 * actually reached, so it never appears for users who are already on a real-app
 * source (`localhost` / `fusion`) or whose `sourceCapabilities` already include
 * the needed capability.
 *
 * Matches the design-editor panel chrome: dashed-border, accent tint, small
 * text at 10px — same idiom as the existing `ctaRequired` block in
 * ComponentSection.
 */
function MakeItRealCard({
  designId,
  featureLabel,
}: {
  /** The active design id — required to call connect-builder-app. */
  designId: string;
  /**
   * Short human-readable label for the gated feature (e.g. "token write-back",
   * "component source jump", "live captures"). Shown in the card body so the
   * user understands exactly what they're unlocking.
   */
  featureLabel: string;
}) {
  const { data, isLoading } = useActionQuery<ConnectBuilderAppResult>(
    "connect-builder-app",
    { designId },
  );

  const migrateMutation = useActionMutation("migrate-inline-design-to-app");

  // While fetching status, show a muted placeholder that matches the card
  // height so the inspector doesn't jump when the data arrives.
  if (isLoading || !data) {
    return (
      <div className="flex h-7 items-center rounded-[5px] bg-[var(--design-editor-control-bg)] px-2">
        <div className="h-3 w-28 animate-pulse rounded bg-muted/40" />
      </div>
    );
  }

  // Determine which CTA to show.
  const cta = data.cta;

  // Already fully enabled — no CTA needed (caller should already have gated
  // this component away, but guard here for safety).
  if (!cta) return null;

  const isPending = migrateMutation.isPending;
  const migrateError = migrateMutation.error;

  // "Make it real" primary action: open the connect URL or migrate.
  const handlePrimary = () => {
    if (cta.kind === "connect-builder") {
      // Open the Builder OAuth connect flow in a new tab.  The user completes
      // it there and comes back; the card will re-query on next render.
      window.open(cta.connectUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (cta.kind === "configure-project") {
      window.open(cta.connectUrl, "_blank", "noopener,noreferrer");
      return;
    }
  };

  const handleMigrate = () => {
    migrateMutation.mutate({ designId });
  };

  // Migration result — show branch link.
  const migrateResult = migrateMutation.data as
    | {
        status: "processing";
        branchName?: string;
        url?: string;
        message?: string;
      }
    | undefined;

  if (migrateResult?.status === "processing" && migrateResult.url) {
    return (
      <div className="flex items-center gap-2 rounded-[5px] border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 py-1.5">
        <IconLoader2 className="size-3.5 shrink-0 animate-spin text-[var(--design-editor-accent-color)]" />
        <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {migrateResult.message ??
            `Generating ${migrateResult.branchName ?? "React app"}.`}
        </p>
        <a
          href={migrateResult.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold text-[var(--design-editor-accent-color)] hover:bg-[var(--design-editor-panel-raised-bg)]"
        >
          {"Open" /* i18n-ignore make-it-real card */}
          <IconExternalLink className="size-2.5" />
        </a>
      </div>
    );
  }

  const summary =
    cta.kind === "configure-project"
      ? `Choose a Builder project to enable ${featureLabel}.`
      : `Connect Builder to enable ${featureLabel}.`;
  const primaryLabel =
    cta.kind === "configure-project"
      ? "Choose" /* i18n-ignore make-it-real card */
      : "Connect"; /* i18n-ignore make-it-real card */

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-[5px] border border-dashed border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]/70 px-2 py-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full bg-[var(--design-editor-accent-color)]"
          aria-hidden="true"
        />
        <p
          className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
          title={summary}
        >
          {summary}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={handlePrimary}
          title={cta.primaryAction}
          className="h-6 shrink-0 gap-1 rounded-md bg-[var(--design-editor-accent-color)] px-1.5 text-[10px] font-semibold text-white hover:bg-[var(--design-editor-accent-hover-color)]"
        >
          {primaryLabel}
          <IconArrowRight className="size-2.5" />
        </Button>

        {/* When Builder is fully connected, also offer direct migration */}
        {data.connected && data.builderEnabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleMigrate}
            disabled={isPending}
            className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          >
            {isPending ? (
              <>
                <IconLoader2 className="size-2.5 animate-spin" />
                {"Generating" /* i18n-ignore make-it-real card */}
              </>
            ) : (
              <>{"Generate" /* i18n-ignore make-it-real card */}</>
            )}
          </Button>
        )}
      </div>
      {migrateError ? (
        <p className="px-2 text-[10px] text-destructive">
          {migrateError instanceof Error
            ? migrateError.message
            : "Migration failed. Please try again."}
        </p>
      ) : null}
    </div>
  );
}

// ─── Component section (§6.1) ─────────────────────────────────────────────────

/**
 * Shape returned by `get-component-details`.  Only the fields the UI needs are
 * typed here; the action may return additional fields.
 */
interface ComponentDetailsResult {
  nodeId: string;
  name: string;
  sourceType: string;
  observedProps: Array<{ name: string; value: string }>;
  persistedVariants: Record<string, string[]>;
  sourceLocation?: { filePath: string; exportName?: string } | null;
  /** Component instance shape, including the Alpine `x-data` expression. */
  instance?: {
    alpineData?: string | null;
    nodeId?: string;
    selector?: string;
  } | null;
  capabilities: {
    canResolveToFile: boolean;
    hasFullIndex: boolean;
    canEditProps: boolean;
    ctaRequired: boolean;
    ctaMessage?: string;
  };
}

/**
 * Contextual COMPONENT section rendered inside the Design tab when the
 * selected element is a component instance (carries
 * `data-agent-native-component`).
 *
 * Shows: component name, source path (when capability available), observed
 * prop values, variant/size/state controls from `get-component-details`, and
 * an "Edit component source" action.  Real-app features are gated by the
 * capabilities returned by the action; Alpine gets a lightweight read-only
 * view plus a Connect-Builder CTA.
 *
 * Matches the workbench artboard spec in DESIGN-STUDIO-PLAN.md §6.1.
 */
export function ComponentSection({
  designId,
  fileId,
  activeContent,
  activeFileUpdatedAt,
  nodeId,
  onComponentPropApplied,
  sourceCapabilities = [],
}: {
  designId: string;
  fileId?: string;
  activeContent?: string;
  activeFileUpdatedAt?: string | null;
  nodeId: string;
  onComponentPropApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
  ) => void;
  /** Capability names advertised by the current source. */
  sourceCapabilities?: string[];
}) {
  const queryClient = useQueryClient();
  const detailsParams = { designId, nodeId, ...(fileId ? { fileId } : {}) };
  const detailsKey = ["action", "get-component-details", detailsParams];
  const latestSourceRef = useRef<{
    content: string;
    revision?: string | null;
  }>({
    content: activeContent ?? "",
    revision: activeFileUpdatedAt ?? null,
  });

  useEffect(() => {
    latestSourceRef.current = {
      content: activeContent ?? "",
      revision: activeFileUpdatedAt ?? null,
    };
  }, [activeContent, activeFileUpdatedAt, fileId, nodeId]);

  const { data, isLoading, error, refetch } =
    useActionQuery<ComponentDetailsResult>(
      "get-component-details",
      detailsParams,
      { refetchOnMount: "always" },
    );

  const openSourceMutation = useActionMutation("open-component-source");
  const applyPropMutation = useActionMutation("apply-component-prop-edit");

  const postComponentPropPreview = useCallback(
    (attribute: string, value: string) => {
      if (typeof document === "undefined") return;

      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      iframe?.contentWindow?.postMessage(
        {
          type: "style-change",
          selector: data?.instance?.selector ?? "",
          nodeId: data?.instance?.nodeId ?? nodeId,
          attributeOverrides: { [attribute]: value },
        },
        "*",
      );
    },
    [data?.instance?.nodeId, data?.instance?.selector, nodeId],
  );

  // Persist a single prop change through apply-component-prop-edit. Attribute
  // props also preview immediately in the iframe so the selected component
  // changes without waiting for the write/refetch round-trip.
  const persistPropEdit = (
    edit:
      | { kind: "alpineData"; value: string }
      | { kind: "attribute"; attribute: string; value: string },
    optimistic: (prev: ComponentDetailsResult) => ComponentDetailsResult,
  ) => {
    queryClient.setQueryData<ComponentDetailsResult>(detailsKey, (prev) =>
      prev ? optimistic(prev) : prev,
    );
    if (edit.kind === "attribute") {
      postComponentPropPreview(edit.attribute, edit.value);
    }
    const latestSource = latestSourceRef.current;
    applyPropMutation.mutate(
      {
        designId,
        nodeId,
        ...(fileId ? { fileId } : {}),
        edit,
        ...(latestSource.content
          ? {
              source: {
                currentContent: latestSource.content,
                ...(latestSource.revision
                  ? { revision: latestSource.revision }
                  : {}),
              },
            }
          : {}),
      },
      {
        onSuccess: (result) => {
          const response = result as {
            content?: unknown;
            fileId?: unknown;
            updatedAt?: unknown;
            conflict?: unknown;
            error?: unknown;
          };
          if (response.conflict) {
            toast.error(
              typeof response.error === "string"
                ? response.error
                : "This file changed since this component prop edit was prepared. Refresh and try again.",
            );
            return;
          }
          if (
            typeof response.fileId === "string" &&
            typeof response.content === "string"
          ) {
            const updatedAt =
              typeof response.updatedAt === "string"
                ? response.updatedAt
                : undefined;
            latestSourceRef.current = {
              content: response.content,
              revision: updatedAt ?? latestSourceRef.current.revision,
            };
            onComponentPropApplied?.(
              response.fileId,
              response.content,
              updatedAt,
            );
          }
        },
        onSettled: () => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
          void queryClient.invalidateQueries({ queryKey: detailsKey });
          void refetch();
        },
      },
    );
  };

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleMessage = (event: MessageEvent) => {
      if (
        (event.data as { type?: unknown } | null)?.type === "element-select"
      ) {
        void refetch();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [refetch]);

  // While loading, show a compact skeleton that matches the section width.
  if (isLoading) {
    return (
      <section className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0">
        <div className="flex min-h-9 items-center gap-2 px-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
        </div>
        <div className="space-y-1.5 px-3 pb-3 pt-0.5">
          <div className="h-5 w-full animate-pulse rounded bg-muted/40" />
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted/40" />
        </div>
      </section>
    );
  }

  // Hard error (node not found, no access, etc.) — collapse silently so
  // the rest of the inspector is not disrupted.
  if (error || !data) return null;

  const {
    name,
    sourceType,
    sourceLocation,
    observedProps,
    persistedVariants,
    instance,
    capabilities,
  } = data;

  // ── Editable prop model ───────────────────────────────────────────────────
  // Inline/Alpine designs persist through apply-component-prop-edit. Two write
  // surfaces:
  //   • x-data keys      → kind "alpineData" (rewrites the whole object)
  //   • data-prop-* attrs → kind "attribute"  (data-agent-native-prop-<kebab>)
  // Real-app sources keep the deeper source-prop controls gated as-is, so for
  // non-inline sources the controls are read-only here.
  const isInline = sourceType === "inline";
  const editingEnabled = isInline && capabilities.canEditProps; // gated; real-app stays read-only for now
  const alpineData = parseAlpineDataObject(instance?.alpineData);

  // Each editable row: name + current value + how it persists + its options.
  type PropRow = {
    name: string;
    value: string;
    /** Variant/enum options when the prop is a known group. */
    options?: string[];
    /** Persist surface for this prop. */
    surface: "alpineData" | "attribute";
  };

  const rows: PropRow[] = [];
  const seen = new Set<string>();

  // 1) Alpine x-data keys come first — they drive the live variant/state.
  if (alpineData) {
    for (const [key, value] of Object.entries(alpineData)) {
      rows.push({
        name: key,
        value,
        options: persistedVariants[key],
        surface: "alpineData",
      });
      seen.add(key);
    }
  }

  // 2) data-agent-native-prop-* attributes not already covered by x-data.
  for (const prop of observedProps) {
    if (seen.has(prop.name)) continue;
    rows.push({
      name: prop.name,
      value: prop.value,
      options: persistedVariants[prop.name],
      surface: "attribute",
    });
    seen.add(prop.name);
  }

  // 3) persistedVariant groups with no observed value yet (default to first).
  for (const [group, options] of Object.entries(persistedVariants)) {
    if (seen.has(group)) continue;
    rows.push({
      name: group,
      value: options[0] ?? "",
      options,
      surface: alpineData ? "alpineData" : "attribute",
    });
    seen.add(group);
  }

  const hasRows = rows.length > 0;

  // Build the apply-component-prop-edit payload + optimistic cache patch for a
  // single prop change.
  const commitProp = (row: PropRow, nextValue: string) => {
    if (!editingEnabled || nextValue === row.value) return;

    if (row.surface === "alpineData") {
      // Surgically replace only the edited key's value inside the original
      // x-data string so methods, nested objects, escaped strings, quoted
      // keys, and whitespace survive byte-for-byte. A full
      // parse→mutate→serialize round-trip would drop anything
      // parseAlpineDataObject can't model (e.g. `toggle() { … }`).
      const original = instance?.alpineData ?? "";
      const surgical = replaceAlpineDataKeyValue(original, row.name, nextValue);

      let serialized: string;
      if (surgical != null) {
        serialized = surgical;
      } else if (canRebuildAlpineDataLosslessly(original)) {
        // The key isn't present yet (or there is no original literal). Rebuild
        // from the flat map — safe here precisely because the original holds
        // nothing richer than the flat literals serialize already preserves.
        const nextData = { ...(alpineData ?? {}), [row.name]: nextValue };
        serialized = serializeAlpineDataObject(nextData);
      } else {
        // The original carries content (methods / nested / expressions) we
        // can't rewrite for this key without dropping it. Fail safe: skip the
        // edit rather than persist a lossy rewrite, and tell the user why so
        // the change doesn't silently vanish.
        toast.error(
          // i18n-ignore
          "Can’t safely edit this prop inline — this component’s Alpine state is too complex. Edit the source instead.",
        );
        return;
      }

      const nextSerialized = serialized;
      persistPropEdit(
        { kind: "alpineData", value: nextSerialized },
        (prev) => ({
          ...prev,
          instance: { ...(prev.instance ?? {}), alpineData: nextSerialized },
          observedProps: prev.observedProps.map((p) =>
            p.name === row.name ? { ...p, value: nextValue } : p,
          ),
        }),
      );
    } else {
      persistPropEdit(
        {
          kind: "attribute",
          attribute: propNameToDataAttribute(row.name),
          value: nextValue,
        },
        (prev) => {
          const exists = prev.observedProps.some((p) => p.name === row.name);
          return {
            ...prev,
            observedProps: exists
              ? prev.observedProps.map((p) =>
                  p.name === row.name ? { ...p, value: nextValue } : p,
                )
              : [...prev.observedProps, { name: row.name, value: nextValue }],
          };
        },
      );
    }
  };

  // ── Capability gates ──
  const canJumpToSource =
    capabilities.canResolveToFile &&
    Boolean(sourceLocation?.filePath) &&
    sourceCapabilities.includes("resolveNodeToFile");

  // ── Source chip text ──
  const sourceChip = sourceLocation?.exportName
    ? `${sourceLocation.exportName} — ${sourceLocation.filePath}`
    : (sourceLocation?.filePath ?? null);

  return (
    <section
      className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0"
      data-testid="component-section"
    >
      {/* ── Section header ── */}
      <div className="flex min-h-9 items-center gap-2 px-3">
        {/* Accent diamond matching the workbench artboard component rows */}
        <span
          className="size-2 shrink-0 rotate-45 rounded-[2px] bg-[var(--design-editor-component-color)]"
          aria-hidden="true"
        />
        <h3 className="min-w-0 flex-1 truncate !text-[11px] font-semibold text-foreground">
          {name}
        </h3>
        {/* Jump-to-source action */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canJumpToSource}
              aria-label={
                "Edit component source" /* i18n-ignore design inspector action */
              }
              onClick={() => {
                openSourceMutation.mutate({
                  designId,
                  nodeId,
                  ...(fileId ? { fileId } : {}),
                });
              }}
            >
              <IconExternalLink className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {
              canJumpToSource
                ? "Edit component source" /* i18n-ignore design inspector action */
                : (capabilities.ctaMessage ??
                  "Source jump needs a connected app") /* i18n-ignore design inspector tooltip */
            }
          </TooltipContent>
        </Tooltip>
      </div>

      {/* ── Body ── */}
      <div className="space-y-1.5 px-3 pb-3 pt-0.5 !text-[11px]">
        {/* Source path chip */}
        {sourceChip && (
          <div
            className="flex items-center gap-1 rounded bg-[var(--design-editor-control-bg)] px-2 py-1"
            title={sourceChip}
          >
            <IconCode className="size-3 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
              {sourceChip}
            </span>
          </div>
        )}

        {/* Typed prop controls. Inline/Alpine designs are editable and persist
            through apply-component-prop-edit; real-app sources are read-only
            until the deeper source-prop controls land. */}
        {hasRows && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              {"Props" /* i18n-ignore design inspector label */}
            </p>
            {rows.map((row) => {
              const hasOptions = (row.options?.length ?? 0) > 0;
              const isBoolean = !hasOptions && isBooleanPropValue(row.value);
              const disabled = !editingEnabled || applyPropMutation.isPending;
              return (
                <div key={row.name} className="flex items-center gap-1.5">
                  <Label className="w-[64px] shrink-0 truncate !text-[11px] font-medium capitalize text-muted-foreground">
                    {row.name}
                  </Label>
                  {hasOptions ? (
                    // Dropdown for variant / enum groups.
                    <Select
                      value={row.value || row.options![0] || ""}
                      onValueChange={(v) => commitProp(row, v)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {row.options!.map((opt) => (
                          <SelectItem
                            key={opt}
                            value={opt}
                            className="!text-[11px]"
                          >
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : isBoolean ? (
                    // Toggle for boolean props.
                    <div className="flex min-w-0 flex-1 items-center">
                      <Switch
                        checked={row.value.trim().toLowerCase() === "true"}
                        onCheckedChange={(checked) =>
                          commitProp(row, checked ? "true" : "false")
                        }
                        disabled={disabled}
                        className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
                        aria-label={
                          row.name /* i18n-ignore dynamic prop name */
                        }
                      />
                    </div>
                  ) : (
                    // Text input for string props (e.g. a label).
                    <Input
                      defaultValue={row.value}
                      key={`${row.name}:${row.value}`}
                      disabled={disabled}
                      onBlur={(e) => commitProp(row, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] md:!text-[11px]"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Connect-Builder CTA (only when prop editing is actually gated). */}
        {capabilities.ctaRequired && !editingEnabled && (
          <MakeItRealCard
            designId={designId}
            featureLabel="component source jump and typed prop metadata"
          />
        )}
      </div>
    </section>
  );
}

// PF8: EditPanel re-renders on every DesignEditor state change (drag,
// hover, zoom) unless memoized. Nearly all props are already stabilized at
// the call site (useMemo/useCallback — see DesignEditor.tsx's
// selectedInspectorElements/selectedScreenGeometry/pageStyles/tweaks/
// sourceCapabilities/statesPanelProps/reviewPanelProps and the onXxx
// handlers passed to <EditPanel>). `headerTrailing` and `aiActions` are
// legitimately-dynamic ReactNode slots (the zoom control repaints its own
// live percentage every zoom tick; aiActions depends on the live
// selection) — their identity is expected to change often and a custom
// comparator that ignored them would hide real content changes, so this
// uses the default shallow comparison rather than special-casing them.
export const EditPanel = memo(function EditPanel({
  selectedElement,
  selectedElements,
  selectedScreenGeometry,
  pageStyles = {},
  headerTrailing,
  width = 256,
  activeTab = "design",
  onActiveTabChange,
  tweaks = [],
  tweakValues = {},
  onTweakChange,
  onRequestTweaks,
  onStyleChange: onStyleChangeProp,
  onStylesChange: onStylesChangeProp,
  onExport,
  exporting = false,
  fileId,
  activeContent,
  activeFileUpdatedAt,
  files,
  designId,
  onComponentPropApplied,
  reviewPanelProps,
  componentNodeId,
  sourceCapabilities = [],
  onCreateComponent,
  selectedElementAlreadyComponent = false,
  defaultComponentName = "Component",
  inspectCode,
  aiActions,
  activeTool,
  onCreateScreenFromPreset,
  onAlignSelection,
  onInteractionStateChange,
  availableInteractionStates,
  onEditCode,
  motionKeyframeState,
  onToggleMotionKeyframe,
  breakpointContext,
}: EditPanelProps) {
  const t = useT();
  const [createComponentOpen, setCreateComponentOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettingsValue>(
    DEFAULT_EXPORT_SETTINGS,
  );
  const [showExportPreview, setShowExportPreview] = useState(false);
  // Element interaction-state selector (Default / Hover / Focus / …). Owned
  // here (not lifted to the parent) per the mission contract — DesignEditor
  // only needs to react to changes via onInteractionStateChange, it doesn't
  // need to drive the value. Resets to Default whenever the selection
  // changes so switching elements never leaves a stale non-default state
  // silently active (matches the export-settings reset effect below).
  const [interactionState, setInteractionState] =
    useState<ActiveInteractionState>(null);

  const effectiveSelectedElements = useMemo(
    () =>
      selectedElements && selectedElements.length > 0
        ? selectedElements
        : selectedElement
          ? [selectedElement]
          : [],
    [selectedElement, selectedElements],
  );
  const inspectorElement = useMemo(
    () =>
      effectiveSelectedElements.length > 1
        ? mixedElementFromSelection(effectiveSelectedElements)
        : (effectiveSelectedElements[0] ?? null),
    [effectiveSelectedElements],
  );
  const selectedCount = effectiveSelectedElements.length;
  // Persistence context for the code-backed GLSL Shader paint/effect type.
  // Requires the design + active file plus a stable node id on the selection;
  // reuses the component-prop onComponentPropApplied contract so the host
  // editor syncs its local/collab content after a persisted shader write.
  const glslShaderContext: GlslShaderPanelContext | undefined = useMemo(() => {
    if (!designId || !fileId || selectedCount > 1) return undefined;
    const nodeId = inspectorElement?.sourceId;
    if (!nodeId) return undefined;
    return {
      designId,
      fileId,
      nodeId,
      selector: inspectorElement?.selector,
      onApplied: onComponentPropApplied,
      onEditCode,
    };
  }, [
    designId,
    fileId,
    selectedCount,
    inspectorElement?.sourceId,
    inspectorElement?.selector,
    onComponentPropApplied,
    onEditCode,
  ]);
  // Document-wide color palette (real "Document colors", not just the
  // selected element's own color props) — recomputed only when the set of
  // file contents actually changes, since scanning every file's HTML/CSS
  // text is nontrivially more work than the old per-element prop read.
  const filesContentKey = files
    ? files.map((file) => `${file.id}:${file.content.length}`).join("|")
    : "";
  const documentColorPalette = useMemo(
    () => (files && files.length > 0 ? extractDocumentColorPalette(files) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on filesContentKey (cheap length+id fingerprint) instead of `files` itself so an unstable-but-equal array identity from the parent doesn't force a full re-scan every render.
    [filesContentKey],
  );
  const selectionAlreadyComponent =
    selectedCount === 1 &&
    (selectedElementAlreadyComponent ||
      elementIsComponentSelection(selectedElement));
  const canCreateComponent = Boolean(
    onCreateComponent &&
    selectedElement &&
    selectedCount <= 1 &&
    !selectionAlreadyComponent,
  );
  const selectedElementKey = inspectorElement
    ? `${selectedCount}:${elementIdentityKey(inspectorElement)}`
    : "none";
  const selectionHasTextElement = effectiveSelectedElements.some((element) =>
    isTextElement(element),
  );
  const selectionHasContainerElement = effectiveSelectedElements.some(
    (element) => isContainerElement(element),
  );
  const handleActiveTabChange = useCallback(
    (tab: InspectorTab) => onActiveTabChange?.(tab),
    [onActiveTabChange],
  );
  const handleTweakChange = useCallback(
    (tweakId: string, value: string | number | boolean) => {
      onTweakChange?.(tweakId, value);
    },
    [onTweakChange],
  );
  const handleRequestTweaks = useCallback(
    (anchor: HTMLElement) => {
      onRequestTweaks?.(anchor);
    },
    [onRequestTweaks],
  );

  useEffect(() => {
    setExportSettings(DEFAULT_EXPORT_SETTINGS);
    setShowExportPreview(false);
  }, [selectedElementKey]);

  useEffect(() => {
    if (!canCreateComponent) setCreateComponentOpen(false);
  }, [canCreateComponent]);

  // Reset the interaction-state selector back to Default whenever the
  // selection changes, so switching elements never leaves a stale
  // non-default state silently active (and never leaves the PREVIOUS
  // element's forced canvas preview attribute stuck on — the effect also
  // notifies the parent so it can clear that attribute). Runs for every
  // selection change, including going from "an element" to "no element" or
  // "multi-selection", both of which the state selector doesn't support.
  useEffect(() => {
    setInteractionState(null);
    onInteractionStateChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omits onInteractionStateChange: this only needs to fire when the SELECTION changes, not when the parent passes a new callback identity.
  }, [selectedElementKey]);

  const handleInteractionStateChange = useCallback(
    (next: ActiveInteractionState) => {
      setInteractionState(next);
      onInteractionStateChange?.(next);
    },
    [onInteractionStateChange],
  );

  // States that already have at least one authored override for the
  // selected element, for the selector's per-row accent dot. Pure/cheap:
  // `listInteractionStates` just scans the managed
  // `<style data-agent-native-states>` block in the active file's HTML for
  // this one node id. Only meaningful for a single-element, source-backed
  // selection — undefined (no dot ever shown) otherwise.
  const interactionStatesWithOverrides = useMemo(():
    | ReadonlySet<InteractionState>
    | undefined => {
    if (!activeContent || selectedCount > 1) return undefined;
    const nodeId = inspectorElement?.sourceId;
    if (!nodeId) return undefined;
    const states = listInteractionStates(activeContent, nodeId);
    return states.length > 0 ? new Set(states) : undefined;
  }, [activeContent, selectedCount, inspectorElement?.sourceId]);

  // The active state's declared property/value overrides for the selected
  // element, used below to resolve each style-section field's displayed
  // value (state value when overridden, else the base value — see
  // `resolveInteractionStateValue`).
  const activeInteractionStateStyles = useMemo(():
    | Record<string, string>
    | undefined => {
    if (!activeContent || !interactionState || selectedCount > 1) {
      return undefined;
    }
    const nodeId = inspectorElement?.sourceId;
    if (!nodeId) return undefined;
    return readStateStyles(activeContent, nodeId, interactionState);
  }, [
    activeContent,
    interactionState,
    selectedCount,
    inspectorElement?.sourceId,
  ]);

  // Motion keyframe diamonds (Figma Motion parity) — see `motionKeyframeState`
  // on EditPanelProps. `undefined` (feature off, or a multi-selection, which
  // has no single element to keyframe) hides every diamond below.
  const motionKeyframeFieldContext = useMemo(():
    | MotionKeyframeFieldContext
    | undefined => {
    if (!motionKeyframeState || selectedCount > 1) return undefined;
    return {
      hasTimeline: motionKeyframeState.hasTimeline,
      keyframedProperties: motionKeyframeState.keyframedProperties,
      onToggle: onToggleMotionKeyframe,
    };
  }, [motionKeyframeState, selectedCount, onToggleMotionKeyframe]);

  // Every style commit below flows through these two wrappers instead of the
  // raw onStyleChange/onStylesChange props — see the StyleChangeMeta doc
  // comment for the full phase-2 contract. While a non-default interaction
  // state is active, every commit (regardless of gesture `phase`) is tagged
  // with `meta.interactionState` so the parent (DesignEditor) can route it
  // to the state's managed CSS rule instead of the element's inline style.
  // Every existing call site in this file passes `onStyleChange`/
  // `onStylesChange` straight through as JSX props, so shadowing the prop
  // names here (see the destructure above:
  // `onStyleChange: onStyleChangeProp`) applies the wrapping everywhere
  // without touching those ~26 call sites individually.
  const onStyleChange = useCallback<StyleChangeHandler>(
    (property, value, meta) => {
      onStyleChangeProp(
        property,
        value,
        interactionState ? { ...meta, interactionState } : meta,
      );
    },
    [onStyleChangeProp, interactionState],
  );
  const onStylesChange = useCallback<StylesChangeHandler>(
    (styles, meta) => {
      if (!onStylesChangeProp) return;
      onStylesChangeProp(
        styles,
        interactionState ? { ...meta, interactionState } : meta,
      );
    },
    [onStylesChangeProp, interactionState],
  );

  // Breakpoint override indicators — see `breakpointContext` on
  // EditPanelProps. `undefined` (feature off, no stable node id, or a
  // multi-selection) hides every indicator below; the per-field resolution
  // itself happens in `resolveBreakpointOverride`. Declared after
  // `onStyleChange` so its reset callback can route the synthetic commit
  // through the same interaction-state-aware wrapper every other field uses.
  const breakpointOverrideFieldContext = useMemo(():
    | BreakpointOverrideFieldContext
    | undefined => {
    if (!breakpointContext || selectedCount > 1) return undefined;
    const nodeId = inspectorElement?.sourceId;
    return {
      nodeId,
      breakpointWidths: breakpointContext.breakpointWidths,
      baseWidthPx: breakpointContext.baseWidthPx,
      activeWidthPx: breakpointContext.activeWidthPx,
      html: breakpointContext.html,
      onReset: (property, maxWidthPx) => {
        if (!nodeId) return;
        // The reset's `value` argument is the current (post-reset) display
        // value — the base/wider-scope value the field falls back to once
        // the override is cleared — never a new value to persist; see the
        // `breakpointReset` doc on `StyleChangeMeta` for the full contract.
        const camelProperty = property.replace(
          /-([a-z])/g,
          (_, letter: string) => letter.toUpperCase(),
        );
        const fallback =
          inspectorElement?.computedStyles[property] ??
          inspectorElement?.computedStyles[camelProperty] ??
          "";
        onStyleChange(property, fallback, {
          breakpointReset: { property, maxWidthPx },
        });
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStyleChange is a stable useCallback (see above) whose own deps already cover onStyleChangeProp/interactionState; omitting it here avoids recreating this context on every keystroke of an unrelated interaction-state toggle.
  }, [breakpointContext, selectedCount, inspectorElement]);

  // Scroll guard: suppress the click that fires immediately after a scroll
  // gesture ends (rubber-band or normal scroll). Using onScroll instead of
  // onPointerDown avoids side-effects like Radix DismissableLayer detecting a
  // "pointerdown outside" and closing open popovers — which, during an
  // over-scroll bounce, could briefly un-shield the canvas and allow a stray
  // pointer event to deselect the selected canvas element (R3 regression).
  const scrolledRecentlyRef = useRef(false);
  const userScrollIntentRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Figma replaces the entire right panel with the size-preset list while the
  // Frame tool is armed — regardless of which inspector tab (Design/Tweaks)
  // was showing beforehand — so this takes priority over `activeTab` below.
  const showFramePresets =
    activeTool === "frame" && Boolean(onCreateScreenFromPreset);

  return (
    <div
      className={cn(
        "shrink-0 bg-[var(--design-editor-panel-bg)]",
        "flex h-full min-h-0 flex-col overflow-hidden",
      )}
      style={{ width }}
    >
      <InspectorTabsHeader
        activeTab={activeTab}
        onActiveTabChange={handleActiveTabChange}
        trailing={headerTrailing}
      />

      {showFramePresets ? (
        <FramePresetsPanel
          onPick={(preset) => onCreateScreenFromPreset?.(preset)}
        />
      ) : activeTab === "design" ? (
        <>
          <SelectionHeader
            element={inspectorElement}
            selectedCount={selectedCount}
            onCreateComponent={
              canCreateComponent ? onCreateComponent : undefined
            }
            createComponentOpen={createComponentOpen}
            onCreateComponentOpenChange={setCreateComponentOpen}
            showCreateComponentAction={!selectionAlreadyComponent}
            defaultComponentName={defaultComponentName}
            inspectCode={
              inspectCode && selectedElement && selectedCount <= 1
                ? inspectCode
                : undefined
            }
          />
          {!inspectorElement && selectedScreenGeometry ? (
            <ScreenSelectionHeader screen={selectedScreenGeometry} />
          ) : null}

          <div
            className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
            onWheelCapture={() => {
              userScrollIntentRef.current = true;
            }}
            onTouchMoveCapture={() => {
              userScrollIntentRef.current = true;
            }}
            onScroll={() => {
              if (!userScrollIntentRef.current) return;
              // Mark that a scroll just happened so the click that some
              // browsers fire at the end of a scroll gesture (or after an
              // overscroll/rubber-band bounce) is suppressed. Crucially this
              // runs on the scroll event — NOT on pointerdown — so it never
              // triggers Radix's DismissableLayer "outside pointerdown"
              // detection, which would close open inspector popovers and, once
              // the shield is removed, allow a stray canvas pointer event to
              // deselect the selected element (the R3 overscroll regression).
              scrolledRecentlyRef.current = true;
              if (scrollTimerRef.current !== null) {
                clearTimeout(scrollTimerRef.current);
              }
              scrollTimerRef.current = setTimeout(() => {
                scrolledRecentlyRef.current = false;
                userScrollIntentRef.current = false;
                scrollTimerRef.current = null;
              }, 300);
            }}
            onClickCapture={(e) => {
              // Suppress spurious clicks (e.g. color-picker opening) that
              // fire immediately after a scroll gesture ends. The 300ms
              // window from the last scroll event covers both the synchronous
              // scroll-end click and the delayed synthetic click that mobile
              // browsers generate after a touch-scroll ends.
              if (!scrolledRecentlyRef.current) return;
              scrolledRecentlyRef.current = false;
              userScrollIntentRef.current = false;
              if (scrollTimerRef.current !== null) {
                clearTimeout(scrollTimerRef.current);
                scrollTimerRef.current = null;
              }
              e.stopPropagation();
              e.preventDefault();
            }}
            onKeyDown={(e) => {
              // Trap Tab within the inspector panel so it never focuses the
              // canvas iframe. When the canvas iframe gains focus it forwards
              // a synthetic Tab keydown to the parent window, which is picked
              // up by the design-editor hotkey handler as "cycle file" and
              // causes apparent deselection / overview-mode switch (bug: Tab
              // in a numeric field deselected the canvas element).
              if (e.key !== "Tab") return;
              const panel = e.currentTarget;
              const focusable = Array.from(
                panel.querySelectorAll<HTMLElement>(
                  'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
                ),
              ).filter(
                (el) =>
                  !el.hasAttribute("disabled") &&
                  el.tabIndex !== -1 &&
                  !el.closest('[aria-hidden="true"]'),
              );
              if (focusable.length === 0) return;
              e.preventDefault();
              const current = document.activeElement as HTMLElement | null;
              const idx = current ? focusable.indexOf(current) : -1;
              const next = e.shiftKey
                ? focusable[(idx - 1 + focusable.length) % focusable.length]
                : focusable[(idx + 1) % focusable.length];
              next?.focus();
            }}
          >
            {/* §6.1 Component section — shown at the top when a component
                instance is selected. Requires designId + componentNodeId. */}
            {designId && componentNodeId && selectedCount <= 1 && (
              <ComponentSection
                designId={designId}
                fileId={fileId}
                activeContent={activeContent}
                activeFileUpdatedAt={activeFileUpdatedAt}
                nodeId={componentNodeId}
                onComponentPropApplied={onComponentPropApplied}
                sourceCapabilities={sourceCapabilities}
              />
            )}

            {aiActions ? (
              <div className="border-b border-[var(--design-editor-control-border)] px-2 py-1.5">
                {aiActions}
              </div>
            ) : null}

            {!inspectorElement && selectedScreenGeometry ? (
              <ScreenGeometryProperties screen={selectedScreenGeometry} />
            ) : null}

            {!inspectorElement && !selectedScreenGeometry && (
              <PageProperties
                styles={pageStyles}
                onStyleChange={onStyleChange}
                onStylesChange={onStylesChange}
              />
            )}

            {inspectorElement && (
              <>
                {/* Element interaction-state selector (Default / Hover /
                    Focus / Focus-visible / Pressed / Disabled) — Webflow-
                    style state picker for THIS element's pseudo-class
                    styling. Distinct from the app-level Design states in
                    StatesPanel (Loading/Empty/Error/fixtures/captures),
                    which apply to the whole screen, not one element. Only
                    offered for a single, source-backed selection (needs a
                    stable node id — see shared/interaction-states.ts). */}
                {selectedCount <= 1 && inspectorElement.sourceId && (
                  <InteractionStatePanel
                    activeState={interactionState}
                    onActiveStateChange={handleInteractionStateChange}
                    availableStates={availableInteractionStates}
                    statesWithOverrides={interactionStatesWithOverrides}
                  />
                )}
                <PositionLayoutProperties
                  element={inspectorElement}
                  onStyleChange={onStyleChange}
                  onAlignSelection={onAlignSelection}
                  motionKeyframeContext={motionKeyframeFieldContext}
                  breakpointOverrideContext={breakpointOverrideFieldContext}
                />
                <LayoutContextProperties
                  element={inspectorElement}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                  motionKeyframeContext={motionKeyframeFieldContext}
                  breakpointOverrideContext={breakpointOverrideFieldContext}
                />
                <AppearanceProperties
                  element={inspectorElement}
                  onStyleChange={onStyleChange}
                  motionKeyframeContext={motionKeyframeFieldContext}
                  breakpointOverrideContext={breakpointOverrideFieldContext}
                />
                {selectionHasTextElement ? (
                  <TypographyProperties
                    element={inspectorElement}
                    onStyleChange={onStyleChange}
                  />
                ) : null}
                <FillProperties
                  element={inspectorElement}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                  documentColorPalette={documentColorPalette}
                  glslShaderContext={glslShaderContext}
                  motionKeyframeContext={motionKeyframeFieldContext}
                  breakpointOverrideContext={breakpointOverrideFieldContext}
                />
                <StrokeProperties
                  element={inspectorElement}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                  motionKeyframeContext={motionKeyframeFieldContext}
                  breakpointOverrideContext={breakpointOverrideFieldContext}
                />
                <EffectsProperties
                  element={inspectorElement}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                  glslShaderContext={glslShaderContext}
                  motionKeyframeContext={motionKeyframeFieldContext}
                />
                <SelectionColorsProperties
                  element={inspectorElement}
                  onStyleChange={onStyleChange}
                />
                {selectionHasContainerElement ? (
                  <LayoutGuideProperties
                    element={inspectorElement}
                    onStyleChange={onStyleChange}
                  />
                ) : null}
              </>
            )}
            {onExport ? (
              <PanelSection
                title={t("editPanel.sections.export")}
                actions={
                  <SectionIconToggle
                    label={
                      showExportPreview
                        ? "Hide preview" /* i18n-ignore design inspector action */
                        : "Show preview" /* i18n-ignore design inspector action */
                    }
                    active={showExportPreview}
                    onClick={() => setShowExportPreview((shown) => !shown)}
                  >
                    <IconPhoto className="size-3.5" />
                  </SectionIconToggle>
                }
              >
                <ExportSettingsPanel
                  key={selectedElementKey}
                  value={exportSettings}
                  formats={["png", "svg"]}
                  exporting={exporting}
                  onChange={(patch) =>
                    setExportSettings((current) => ({ ...current, ...patch }))
                  }
                  onExport={onExport}
                />
                {showExportPreview ? (
                  <ExportPreview element={inspectorElement} />
                ) : null}
              </PanelSection>
            ) : null}

            {/* §6.5 Review — contextual section in Design tab.
                Collapsed by default. Renders when reviewPanelProps is provided,
                no designId check needed since ReviewPanel is statically fed. */}
            {reviewPanelProps ? (
              <PanelSection
                title={"Review" /* i18n-ignore design inspector section */}
                defaultCollapsed
                actions={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        disabled={reviewPanelProps.auditLoading}
                        onClick={(event) => {
                          event.stopPropagation();
                          reviewPanelProps.onRunAudit?.();
                        }}
                        aria-label={
                          "Run audit" /* i18n-ignore design inspector action */
                        }
                      >
                        <IconRefresh
                          className={cn(
                            "size-3.5",
                            reviewPanelProps.auditLoading && "animate-spin",
                          )}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {"Run audit" /* i18n-ignore design inspector action */}
                    </TooltipContent>
                  </Tooltip>
                }
              >
                {/* ReviewPanel manages its own scroll; no extra wrapper needed. */}
                <ReviewPanel {...reviewPanelProps} />
              </PanelSection>
            ) : null}
          </div>
        </>
      ) : activeTab === "tweaks" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/90 px-3">
            <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
              {t("designEditor.tweaks")}
            </h3>
            {onRequestTweaks ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={t("designEditor.addTweaks")}
                    onClick={(event) =>
                      handleRequestTweaks(event.currentTarget)
                    }
                  >
                    <IconPlus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("designEditor.addTweaks")}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <TweaksPanelContent
              tweaks={tweaks}
              values={tweakValues}
              onChange={handleTweakChange}
              onRequestTweaks={handleRequestTweaks}
              className="px-3 py-3"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});
