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
  AppearanceProperties,
  AppearanceScrubField,
  CornerRadiusControl,
} from "./edit-panel/appearance-properties";
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
import { ComponentSection } from "./edit-panel/component-section";
import {
  type DocumentColorSourceFile,
  extractDocumentColorPalette,
  selectionColorValues,
  selectionDisplayHex,
} from "./edit-panel/document-colors";
import { EffectsProperties } from "./edit-panel/effects-properties";
import {
  autoLayoutAlignmentFromStyles,
  availableSizingForElement,
  commitElementMinMax,
  commitElementSizing,
  componentNameForElementInfo,
  cssElementSize,
  displayLabel,
  elementHasLayoutChildren,
  elementIsComponentSelection,
  horizontalToJustify,
  inferElementSizing,
  inspectorObjectTitle,
  isContainerElement,
  isParentFlex,
  isParentGrid,
  isTextElement,
  justifyToHorizontal,
  parentFlexDirection,
  readElementMinMax,
  TEXT_TAGS,
  verticalToAlign,
} from "./edit-panel/element-classification";
import {
  deriveLockedAspectSize,
  elementIdentityKey,
  useAspectRatioLock,
} from "./edit-panel/element-identity";
import {
  commitStylePatch,
  DesignSpacingControl,
  FieldTrailer,
  ScrubStyleInput,
} from "./edit-panel/field-primitives";
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
  solidToGradientPatch,
  splitCssLayers,
  withLayerSizeMarker,
} from "./edit-panel/fill-gradient-helpers";
import { FillProperties } from "./edit-panel/fill-properties";
import { FramePresetsPanel } from "./edit-panel/frame-presets-panel";
import {
  InspectorIconButton,
  InspectorSegment,
  RowDragHandle,
  SectionIconButton,
  SectionIconToggle,
  useRowDragReorder,
} from "./edit-panel/inspector-controls";
import {
  authoredStyleValue,
  resolveInteractionStateValue,
} from "./edit-panel/interaction-state-helpers";
import {
  LayoutContextProperties,
  LayoutGuideProperties,
} from "./edit-panel/layout-properties";
import {
  ColorInput,
  FieldLabel,
  PanelSection,
  PropInput,
  PropSelect,
  PropSlider,
  SubsectionLabel,
} from "./edit-panel/panel-primitives";
import {
  colorHasVisibleAlpha,
  compactCssValue,
  cssColorOrFallback,
  cssLengthNumber,
  fourValuesEqual,
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
import { PositionLayoutProperties } from "./edit-panel/position-layout-properties";
import {
  isMixedValue,
  MIXED_VALUE,
  mixedElementFromSelection,
  sameOrMixed,
} from "./edit-panel/selection-helpers";
import { StrokeProperties } from "./edit-panel/stroke-properties";
import {
  type BreakpointOverrideFieldContext,
  type MotionKeyframeFieldContext,
  resolveBreakpointOverride,
  type StyleChangeHandler,
  type StyleChangeMeta,
  type StylesChangeHandler,
} from "./edit-panel/style-change-types";
import {
  ALIGN_SELF_OPTIONS,
  BLEND_MODE_OPTIONS,
  optionValue,
  parseNumericValue,
  resolveLineHeight,
  sidesAreLinked,
  STROKE_POSITION_OPTIONS,
} from "./edit-panel/style-options";
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
import { TypographyProperties } from "./edit-panel/typography-properties";
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
  averageGradientOpacity,
  buildGradientLayer,
  defaultGradientStops,
  isLayerHiddenBySize,
  joinCssLayers,
  parseGradientLayer,
  removeFillLayerAtIndex,
  solidToGradientPatch,
  splitCssLayers,
  withLayerSizeMarker,
  type FillLayerArrays,
};
export {
  fourValuesEqual,
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
export { mixedElementFromSelection };
export { authoredStyleValue, resolveInteractionStateValue };
export { isTextElement };
export { ComponentSection };
export { extractDocumentColorPalette, type DocumentColorSourceFile };
export type { StyleChangeHandler, StyleChangeMeta, StylesChangeHandler };

export type InspectorTab = "design" | "tweaks";

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
