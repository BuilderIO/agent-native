import { useT } from "@agent-native/core/client/i18n";
import type { TweakDefinition } from "@shared/api";
import { alphaToOpacity, parseCssColor, rgbaToCss } from "@shared/color-utils";
import {
  listInteractionStates,
  readResolvedStateStyles,
  type InteractionState,
} from "@shared/interaction-states";
import type { LayoutGrid } from "@shared/layout-grid";
import {
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconComponents,
  IconDeviceMobile,
  IconExternalLink,
  IconFrame,
  IconGridDots,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconTarget,
  IconTrash,
  IconVector,
} from "@tabler/icons-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UploadedFont } from "@/lib/font-upload";
import { cn } from "@/lib/utils";
import { runInIdleSlices } from "@/pages/design-editor/idle-slices";
import type { EditorMode } from "@/pages/design-editor/types";

import { AppearanceProperties } from "./edit-panel/appearance-properties";
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
  ComponentSection,
  type RuntimeComponentDetails,
} from "./edit-panel/component-section";
import {
  type DocumentColorCountCache,
  type DocumentColorSourceFile,
  type SelectionColorValue,
  documentFileColorCounts,
  extractDocumentColorPalette,
  type SelectionColorScope,
  selectionColorValues,
  selectionFillAddedStyles,
  selectionFillInspectorStyles,
  selectionFillModel,
  selectionDisplayHex,
} from "./edit-panel/document-colors";
import { EffectsProperties } from "./edit-panel/effects-properties";
import {
  elementHasComponentAnnotation,
  elementIsComponentSelection,
  inspectorObjectTitle,
  isContainerElement,
  isTextElement,
  commitElementMinMax,
} from "./edit-panel/element-classification";
import {
  deriveLockedAspectSize,
  elementStableKey,
  interactionStateSelectionKey,
} from "./edit-panel/element-identity";
import {
  commitStylePatch,
  ScrubStyleInput,
} from "./edit-panel/field-primitives";
import {
  buildGradientLayer,
  DEFAULT_EXPORT_SETTINGS,
  defaultGradientStops,
  type FillLayerArrays,
  isLayerHiddenBySize,
  joinCssLayers,
  parseGradientLayer,
  removeFillLayerAtIndex,
  solidToGradientPatch,
  splitCssLayers,
  withLayerSizeMarker,
} from "./edit-panel/fill-gradient-helpers";
import { FillProperties } from "./edit-panel/fill-properties";
import { FramePresetsPanel } from "./edit-panel/frame-presets-panel";
import type { InspectCodeSourceLocation } from "./edit-panel/inspect-code-source";
import { SectionIconButton } from "./edit-panel/inspector-controls";
import {
  authoredStyleValue,
  elementWithInteractionStateStyles,
  resolveInteractionStateValue,
} from "./edit-panel/interaction-state-helpers";
import { LayoutGridProperties } from "./edit-panel/layout-grid-properties";
import {
  LayoutContextProperties,
  LayoutGuideProperties,
} from "./edit-panel/layout-properties";
import {
  ColorInput,
  InspectorActionPairGrid,
  InspectorActionRail,
  InspectorGrid,
  InspectorGridCell,
  INSPECTOR_GRID_PAIR_SPAN,
  PanelSection,
  PropInput,
  PropSelect,
  SubsectionLabel,
} from "./edit-panel/panel-primitives";
import {
  cssColorOrFallback,
  fourValuesEqual,
  outlineOffsetForPosition,
  readStrokeOutlinePosition,
  readTextStrokeStyle,
  resolveTextStrokeColor,
  roundToOneDecimal,
  strokeHiddenByColor,
  swatchStyle,
  textStrokeIsVisible,
} from "./edit-panel/position-helpers";
import { PositionLayoutProperties } from "./edit-panel/position-layout-properties";
import {
  ScaleProperties,
  type ScaleToolControls,
} from "./edit-panel/scale-properties";
import { mixedElementFromSelection } from "./edit-panel/selection-helpers";
import { StrokeProperties } from "./edit-panel/stroke-properties";
import {
  type BreakpointOverrideFieldContext,
  type CapturedStyleTarget,
  type MotionKeyframeFieldContext,
  type ApplyLayoutFlowHandler,
  type SelectionColorChangeHandler,
  type StyleChangeHandler,
  type StyleChangeMeta,
  type StylesChangeHandler,
} from "./edit-panel/style-change-types";
import {
  mergeRotationValue,
  normalizeRotationDegrees,
} from "./edit-panel/transform-helpers";
import {
  displayFontFamilyName,
  FONT_FAMILY_OPTIONS,
  resolveFontFamilySelectValue,
  sortFontFamilyOptions,
} from "./edit-panel/typography-helpers";
import { TypographyProperties } from "./edit-panel/typography-properties";
import {
  ExportSettingsPanel,
  DesignColorPicker,
  SizingField,
  type ScrubInputChangeMeta,
  type ExportSettingsValue,
  type FrameSizePreset,
  InteractionStatePanel,
  type ActiveInteractionState,
  type MotionKeyframeCssProperty,
} from "./inspector";
import { IconText } from "./inspector/design-icons";
import { type GlslShaderPanelContext } from "./inspector/GlslShaderPanel";
import type { LocalhostWriteConsentPayload } from "./LocalhostWriteConsentDialog";
import { getActiveScreenIframeId } from "./multi-screen/iframe-targeting";
import type { ScreenHeightMode } from "./multi-screen/screen-height";
import {
  clampScreenDimension,
  type ScreenSizeConstraints,
} from "./multi-screen/screen-sizing";
import {
  ReviewCommentsPanel,
  type ReviewCommentsPanelProps,
} from "./ReviewCommentsPanel";
import { ReviewPanel } from "./ReviewPanel";
import type { ReviewPanelProps } from "./ReviewPanel";
import type { StatesPanelProps } from "./StatesPanel";
import { TweaksPanelContent } from "./TweaksPanel";
import type { ElementInfo, TextEditingState } from "./types";

function elementInspectorKey(
  element: ElementInfo,
  scope: string | null | undefined,
): string {
  return `${scope || "selection"}:${elementStableKey(element)}`;
}

// guard:allow-raw-color — authored selections need a concrete CSS color fallback.
const DEFAULT_AUTHORED_COLOR = "#000000";

function lastCssColor(value: string): string | undefined {
  const tokens =
    value.match(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/gi) ?? [];
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const parsed = parseCssColor(tokens[index] ?? "");
    if (parsed) return rgbaToCss(parsed);
  }
  return undefined;
}

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
export type {
  SelectionColorChangeHandler,
  SelectionColorScope,
  StyleChangeHandler,
  StyleChangeMeta,
  StylesChangeHandler,
};

export function mergeOptimisticInteractionStateStyles(
  persisted: Record<string, string> | undefined,
  pending: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!persisted && !pending) return undefined;
  return { ...(persisted ?? {}), ...(pending ?? {}) };
}

export type InspectorTab = "design" | "tweaks" | "comments" | "code";

export type DesignViewMode = "single" | "overview";

const MIN_SCREEN_FRAME_SIZE_PX = 24;
const EMPTY_SCREEN_SIZE_CONSTRAINTS: ScreenSizeConstraints = {
  width: { min: null, max: null },
  height: { min: null, max: null },
};

interface EditPanelProps {
  selectedElement: ElementInfo | null;
  textEditingState?: TextEditingState;
  selectionHidden?: boolean;
  onToggleSelectionHidden?: () => void;
  selectedElements?: ElementInfo[];
  selectedScreenGeometry?: ScreenGeometrySelection | null;
  selectedScreenLayoutGrid?: LayoutGrid | null;
  onLayoutGridChange?: (
    frameId: string,
    next: Partial<LayoutGrid> | null,
  ) => void;
  canvasBackground?: string | null;
  canvasBackgroundFallback?: string | null;
  onCanvasBackgroundChange?: (value: string, meta?: StyleChangeMeta) => void;
  onScreenGeometryChange?: (
    screenId: string,
    next: Partial<
      Pick<ScreenGeometrySelection, "x" | "y" | "width" | "height">
    >,
  ) => void;
  onScreenHeightModeChange?: (screenId: string, mode: ScreenHeightMode) => void;
  selectedScreenSource?: ScreenSourceSelection | null;
  sourceLocationUnavailable?: boolean;
  localhostConnections?: LocalhostConnectionOption[];
  onScreenSourceChange?: (
    screenId: string,
    next: {
      sourceType: "static" | "url";
      url?: string;
      connectionId?: string;
    },
  ) => void;
  onAddLocalhostScreen?: () => void;
  onRemoveScreen?: () => void;
  screenSourcePending?: boolean;
  screenBreakpointControls?: ReactNode;
  pageStyles?: Record<string, string>;
  selectedScreenElement?: ElementInfo | null;
  onSelectedScreenStyleChange?: StyleChangeHandler;
  onSelectedScreenStylesChange?: StylesChangeHandler;
  vectorPointRadius?: { value: number; max: number } | null;
  vectorPointSelected?: boolean;
  onVectorPointRadiusChange?: (
    value: number,
    meta?: ScrubInputChangeMeta,
  ) => void;
  selectionColorScopes?: SelectionColorScope[];
  onSelectionColorChange?: SelectionColorChangeHandler;
  onSelectionColorTarget?: (color: string) => void;
  canSelectSelectionColorTarget?: (color: string) => boolean;
  onSelectionColorPickerOpenChange?: (from: string, open: boolean) => void;
  onGroupFillStylesChange?: (
    styles: Record<string, string>,
    meta?: StyleChangeMeta,
  ) => boolean;
  zoom?: number;
  headerTrailing?: ReactNode;
  inspectorGridDebug?: boolean;
  onInspectorGridDebugChange?: (visible: boolean) => void;
  width?: number;
  viewMode: DesignViewMode;
  mode: EditorMode;
  readOnly?: boolean;
  activeTab?: InspectorTab;
  onActiveTabChange?: (tab: InspectorTab) => void;
  tweaksEnabled?: boolean;
  tweaks?: TweakDefinition[];
  tweakValues?: Record<string, string | number | boolean>;
  onTweakChange?: (id: string, value: string | number | boolean) => void;
  onRequestTweaks?: (anchor: HTMLElement) => void;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onFontUploaded?: (font: UploadedFont) => void | Promise<void>;
  onExport?: (settings: ExportSettingsValue[]) => void;
  onRenderExportPreview?: () => Promise<Blob>;
  exporting?: boolean;
  fileId?: string;
  boardFileId?: string;
  previewFrameId?: string;
  activeContent?: string;
  pendingInteractionStateStyles?: Partial<
    Record<InteractionState, Record<string, string>>
  >;
  activeFileUpdatedAt?: string | null;
  getComponentExpectedFiles?: () => Array<{
    fileId: string;
    versionHash: string;
  }>;
  files?: DocumentColorSourceFile[];
  designId?: string;
  onComponentPropApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
  ) => void;
  onShaderSourceApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
  ) => void;
  onTokensApplied?: (resolvedCssVars: Record<string, string>) => void;
  statesPanelProps?: Omit<StatesPanelProps, "designId">;
  reviewPanelProps?: Omit<ReviewPanelProps, "className">;
  reviewCommentsPanelProps?: ReviewCommentsPanelProps;
  reviewCommentsCount?: number;
  componentNodeId?: string;
  componentRuntime?: RuntimeComponentDetails;
  requestLocalhostWrite?: (opts: {
    files: string[];
    onGranted: LocalhostWriteConsentPayload["onGranted"];
    onCancel?: () => void;
  }) => void;
  componentDetailsReady?: boolean;
  componentInstanceHasLocalOverrides?: boolean;
  onResetComponentInstanceOverrides?: (nodeId: string) => void;
  onRestoreComponent?: (nodeId: string) => void;
  componentSwapPickerRequest?: number;
  sourceCapabilities?: string[];
  onCreateComponent?: (name: string) => void;
  selectedElementAlreadyComponent?: boolean;
  defaultComponentName?: string;
  inspectCode?: InspectCodeData;
  aiActions?: ReactNode;
  activeTool?: string;
  scaleToolControls?: ScaleToolControls;
  onCreateScreenFromPreset?: (preset: {
    name: string;
    width: number;
    height: number;
  }) => void;
  onDisableAutoLayout?: (nodeId: string) => void;
  onApplyLayoutFlow?: ApplyLayoutFlowHandler;
  onAlignSelection?: (
    edge: "left" | "center-h" | "right" | "top" | "center-v" | "bottom",
  ) => void;
  alignSelectionDisabled?: boolean;
  onInteractionStateChange?: (state: ActiveInteractionState) => void;
  availableInteractionStates?: readonly InteractionState[];
  onEditCode?: (shaderId: string) => void;
  motionKeyframeState?: {
    hasTimeline: boolean;
    keyframedProperties: readonly string[];
  };
  onToggleMotionKeyframe?: (cssProperty: MotionKeyframeCssProperty) => void;
  breakpointContext?: {
    breakpointWidths: readonly number[];
    baseWidthPx: number;
    activeWidthPx: number | null;
    upperBoundPx?: number | null;
    lowerBoundPx?: number | null;
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
  heightMode?: ScreenHeightMode;
  sizeConstraints?: ScreenSizeConstraints;
}

export interface ScreenSourceSelection {
  sourceType: "static" | "url";
  url?: string;
  connectionId?: string;
}

export interface LocalhostConnectionOption {
  id: string;
  name?: string | null;
  devServerUrl?: string | null;
}

export interface InspectCodeData {
  html?: string | null;
  tagName?: string | null;
  id?: string | null;
  classes?: string[];
  sourceLocation?:
    | (InspectCodeSourceLocation & {
        snippet?: string;
      })
    | null;
}

function sourcePositionLabel(
  source: Pick<InspectCodeSourceLocation, "filePath" | "line" | "column">,
): string {
  if (source.line == null) return source.filePath;
  return `${source.filePath}:${source.line}${source.column == null ? "" : `:${source.column}`}`;
}

function sourcePrecisionLabel(
  method: InspectCodeSourceLocation["method"],
): string | null {
  if (method === "debug-stack") return "Runtime-transformed location"; // i18n-ignore design inspector technical provenance label
  if (
    method === "debug-source" ||
    method === "debug-stack-remapped" ||
    method === "data-attribute"
  ) {
    return "Authored source location"; // i18n-ignore design inspector technical provenance label
  }
  return null;
}

function SourceLocationSummary({
  source,
}: {
  source: InspectCodeSourceLocation;
}) {
  const precision = sourcePrecisionLabel(source.method);
  const ownerPrecision = source.owner
    ? sourcePrecisionLabel(source.owner.method)
    : null;
  return (
    <div className="space-y-1">
      <div
        className="rounded bg-[var(--design-editor-control-bg)] px-2 py-1.5"
        title={sourcePositionLabel(source)}
      >
        <div className="flex min-w-0 items-center gap-1">
          <IconCode className="size-3 shrink-0 text-muted-foreground/60" />
          {source.componentName ? (
            <span className="shrink-0 font-medium text-foreground">
              {source.componentName}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
            {sourcePositionLabel(source)}
          </span>
        </div>
        {precision ? (
          <div className="mt-0.5 pl-4 text-[9px] text-muted-foreground/70">
            {precision}
          </div>
        ) : null}
      </div>
      {source.owner ? (
        <div
          className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground"
          title={sourcePositionLabel(source.owner)}
        >
          <div className="truncate">
            <span className="mr-1 font-medium text-foreground/80">
              {"Owner" /* i18n-ignore design inspector provenance label */}
            </span>
            {source.owner.componentName
              ? `${source.owner.componentName} · `
              : ""}
            <span className="font-mono">
              {sourcePositionLabel(source.owner)}
            </span>
            {source.owner.key ? ` · key ${source.owner.key}` : ""}
          </div>
          {ownerPrecision ? (
            <div className="mt-0.5 text-[9px] text-muted-foreground/70">
              {ownerPrecision}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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
            <h3 className="design-sidebar-context-title text-foreground">
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
              className="design-sidebar-field-label text-muted-foreground"
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

        {source ? <SourceLocationSummary source={source} /> : null}

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

        {source?.absolutePath ? (
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
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function CodeInspectPanel({
  data,
  element,
  screen,
}: {
  data?: InspectCodeData;
  element: ElementInfo | null;
  screen: ScreenGeometrySelection | null | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = data
    ? (elementHtmlPreview(data) ??
      data.sourceLocation?.snippet ??
      data.html?.trim() ??
      null)
    : null;
  const bounds = element?.boundingRect ?? screen;
  const measurements = bounds
    ? [
        ["X", bounds.x],
        ["Y", bounds.y],
        ["W", bounds.width],
        ["H", bounds.height],
      ]
    : [];
  const styles = element
    ? [
        ["Display", element.computedStyles.display],
        ["Position", element.computedStyles.position],
        ["Font", element.computedStyles.fontSize],
        ["Color", element.computedStyles.color],
      ].filter(([, value]) => value)
    : [];

  const handleCopy = () => {
    if (!snippet) return;
    void navigator.clipboard
      ?.writeText(snippet)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };

  return (
    <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="flex h-10 items-center justify-between gap-2 border-b border-border/90 px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconCode className="size-3.5 text-muted-foreground" />
          <h3 className="design-sidebar-context-title truncate text-foreground">
            {"Code & measurements" /* i18n-ignore design inspector heading */}
          </h3>
        </div>
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

      {measurements.length > 0 ? (
        <PanelSection
          title={"Measurements" /* i18n-ignore design inspector section */}
        >
          <InspectorGrid layout="pair-flow">
            {measurements.map(([label, value]) => (
              <InspectorGridCell key={label} span={INSPECTOR_GRID_PAIR_SPAN}>
                <div className="flex h-6 items-center justify-between rounded border border-border/70 bg-[var(--design-editor-control-bg)] px-2 text-[11px]">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-foreground">
                    {Math.round(Number(value))}px
                  </span>
                </div>
              </InspectorGridCell>
            ))}
          </InspectorGrid>
        </PanelSection>
      ) : null}

      {styles.length > 0 ? (
        <PanelSection
          title={"Computed styles" /* i18n-ignore design inspector section */}
        >
          <div className="space-y-2 text-[11px]">
            {styles.map(([label, value]) => (
              <InspectorGrid key={label} className="items-center">
                <InspectorGridCell span={10}>
                  <span className="truncate text-muted-foreground">
                    {label}
                  </span>
                </InspectorGridCell>
                <InspectorGridCell span={18}>
                  <span className="block truncate text-right font-mono text-foreground">
                    {value}
                  </span>
                </InspectorGridCell>
              </InspectorGrid>
            ))}
          </div>
        </PanelSection>
      ) : null}

      <PanelSection title={"Code" /* i18n-ignore design inspector section */}>
        {data?.sourceLocation ? (
          <div className="mb-2">
            <SourceLocationSummary source={data.sourceLocation} />
          </div>
        ) : null}
        {snippet ? (
          <pre className="max-h-80 overflow-auto rounded bg-[var(--design-editor-control-bg)] p-2 font-mono text-[10px] leading-relaxed text-foreground">
            <code>{highlightedHtml(snippet)}</code>
          </pre>
        ) : (
          <p className="text-[11px] leading-4 text-muted-foreground">
            {
              "Select a layer to inspect its code and measurements." /* i18n-ignore design inspector empty */
            }
          </p>
        )}
      </PanelSection>
    </div>
  );
}

function elementTypeIcon(element: ElementInfo) {
  if (elementIsComponentSelection(element)) return IconComponents;
  const tag = normalizedElementTagName(element.tagName);
  if (isTextElement(element)) return IconText;
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
  onCreateComponent?: (name: string) => void;
  createComponentOpen?: boolean;
  onCreateComponentOpenChange?: (open: boolean) => void;
  showCreateComponentAction?: boolean;
  defaultComponentName?: string;
  inspectCode?: InspectCodeData;
}) {
  const t = useT();
  if (!element) return null;

  const title =
    selectedCount > 1
      ? `${selectedCount} selected`
      : inspectorObjectTitle(element);
  const TypeIcon = elementTypeIcon(element);
  const isComponentSelection = elementIsComponentSelection(element);
  const repeatCount =
    selectedCount > 1 ? 0 : (element.repeat?.instanceCount ?? 0);

  return (
    <div className="shrink-0 border-b border-border/90 px-2">
      <InspectorGrid className="min-h-8 items-center" layout="header-actions">
        {/* Node-type label. Rename lives in the layers panel and device sizing
            lives elsewhere, so this is a plain non-interactive label. */}
        <InspectorGridCell span={20}>
          <div className="design-sidebar-section-title flex min-w-0 items-center gap-1.5 text-left text-foreground">
            <TypeIcon
              className={cn(
                "size-3.5 shrink-0",
                isComponentSelection
                  ? "text-[var(--design-editor-component-color)]"
                  : "text-muted-foreground",
              )}
            />
            <span className="truncate">{title}</span>
            {repeatCount > 1 ? (
              <span className="shrink-0 rounded-sm bg-[var(--design-editor-panel-raised-bg)] px-1 text-[10px] text-muted-foreground">
                {t("editPanel.repeatAffectsAll", { count: repeatCount })}
              </span>
            ) : null}
          </div>
        </InspectorGridCell>
        {/* Right-aligned quick actions: create-component + dev inspect (</>) */}
        <InspectorGridCell span={8}>
          <InspectorActionRail>
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
          </InspectorActionRail>
        </InspectorGridCell>
      </InspectorGrid>
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
      <div className="design-sidebar-context-title flex min-w-0 items-center gap-1.5 text-left text-foreground">
        <IconFrame className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{screen.title}</span>
      </div>
    </div>
  );
}

function ScreenSizePresetPicker({
  onPick,
}: {
  onPick: (preset: FrameSizePreset) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = t("editPanel.framePresets.applyToFrame");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-hover-bg)] hover:text-foreground"
              aria-label={label}
            >
              <IconDeviceMobile className="size-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" side="left" className="w-56 p-0">
        <div className="flex max-h-80 flex-col overflow-hidden">
          <FramePresetsPanel
            onPick={(preset) => {
              onPick(preset);
              setOpen(false);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScreenGeometryProperties({
  screen,
  onGeometryChange,
  onHeightModeChange,
  onConstraintChange,
  selectedScreenSource,
  localhostConnections = [],
  onScreenSourceChange,
  onAddLocalhostScreen,
  onRemoveScreen,
  screenSourcePending = false,
  screenBreakpointControls,
}: {
  screen: ScreenGeometrySelection;
  onGeometryChange?: (
    screenId: string,
    next: Partial<
      Pick<ScreenGeometrySelection, "x" | "y" | "width" | "height">
    >,
  ) => void;
  onHeightModeChange?: (screenId: string, mode: ScreenHeightMode) => void;
  onConstraintChange?: (
    axis: "horizontal" | "vertical",
    kind: "min" | "max",
    value: number | null,
    meta?: StyleChangeMeta,
  ) => void;
  selectedScreenSource?: ScreenSourceSelection | null;
  localhostConnections?: LocalhostConnectionOption[];
  onScreenSourceChange?: (
    screenId: string,
    next: {
      sourceType: "static" | "url";
      url?: string;
      connectionId?: string;
    },
  ) => void;
  onAddLocalhostScreen?: () => void;
  onRemoveScreen?: () => void;
  screenSourcePending?: boolean;
  screenBreakpointControls?: ReactNode;
}) {
  const t = useT();
  const noop = useCallback(() => {}, []);
  const editable = Boolean(onGeometryChange);
  const sourceEditable = Boolean(onScreenSourceChange);
  const persistedSourceType = selectedScreenSource?.sourceType ?? "static";
  const heightMode = screen.heightMode ?? "auto";
  const [sourceMode, setSourceMode] = useState<"static" | "url">(
    persistedSourceType,
  );
  const [sourceUrlDraft, setSourceUrlDraft] = useState(
    selectedScreenSource?.url ?? "",
  );
  const [connectionDraft, setConnectionDraft] = useState(
    selectedScreenSource?.connectionId ?? "",
  );

  useEffect(() => {
    setSourceMode(persistedSourceType);
    setSourceUrlDraft(selectedScreenSource?.url ?? "");
    setConnectionDraft(selectedScreenSource?.connectionId ?? "");
  }, [
    persistedSourceType,
    screen.id,
    selectedScreenSource?.connectionId,
    selectedScreenSource?.url,
  ]);

  const commitUrl = useCallback(
    (nextConnectionId = connectionDraft) => {
      const url = sourceUrlDraft.trim();
      if (!sourceEditable || !url || screenSourcePending) return;
      onScreenSourceChange?.(screen.id, {
        sourceType: "url",
        url,
        ...(nextConnectionId ? { connectionId: nextConnectionId } : {}),
      });
    },
    [
      connectionDraft,
      onScreenSourceChange,
      screen.id,
      screenSourcePending,
      sourceEditable,
      sourceUrlDraft,
    ],
  );
  const commit = useCallback(
    (
      next: Partial<
        Pick<ScreenGeometrySelection, "x" | "y" | "width" | "height">
      >,
    ) => onGeometryChange?.(screen.id, next),
    [onGeometryChange, screen.id],
  );

  return (
    <>
      <PanelSection
        title={t("editPanel.sections.page")}
        actions={
          onAddLocalhostScreen || onRemoveScreen ? (
            <>
              {onAddLocalhostScreen ? (
                <SectionIconButton
                  label={t("layersPanel.addScreen")}
                  disabled={!sourceEditable || screenSourcePending}
                  onClick={onAddLocalhostScreen}
                >
                  <IconPlus className="size-3.5" />
                </SectionIconButton>
              ) : null}
              {onRemoveScreen ? (
                <SectionIconButton
                  label={t("editPanel.screenSource.remove")}
                  className="hover:text-destructive"
                  disabled={!sourceEditable || screenSourcePending}
                  onClick={onRemoveScreen}
                >
                  <IconTrash className="size-3.5" />
                </SectionIconButton>
              ) : null}
            </>
          ) : undefined
        }
      >
        <div className="design-sidebar-property-group space-y-2">
          <SubsectionLabel>{t("editPanel.screenSource.title")}</SubsectionLabel>
          <Tabs
            value={sourceMode}
            onValueChange={(value) => {
              const nextMode = value as "static" | "url";
              if (nextMode === "url") {
                setSourceMode("url");
                return;
              }
              if (persistedSourceType === "static") {
                setSourceMode("static");
                return;
              }
              setSourceMode("url");
              onScreenSourceChange?.(screen.id, { sourceType: "static" });
            }}
            className="w-full"
          >
            <TabsList className="h-7 w-full justify-start gap-0.5 rounded-md bg-[var(--design-editor-control-bg)] p-0.5">
              <TabsTrigger
                value="static"
                disabled={!sourceEditable || screenSourcePending}
                className="h-6 min-w-0 flex-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-bg)] data-[state=active]:text-[var(--design-editor-accent-color)] data-[state=active]:shadow-[inset_0_0_0_1px_var(--design-editor-control-border)]"
              >
                {t("editPanel.positionOptions.static")}
              </TabsTrigger>
              <TabsTrigger
                value="url"
                disabled={!sourceEditable || screenSourcePending}
                className="h-6 min-w-0 flex-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-bg)] data-[state=active]:text-[var(--design-editor-accent-color)] data-[state=active]:shadow-[inset_0_0_0_1px_var(--design-editor-control-border)]"
              >
                {t("editPanel.screenSource.url")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {sourceMode === "url" ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Input
                  value={sourceUrlDraft}
                  onChange={(event) => setSourceUrlDraft(event.target.value)}
                  onBlur={() => commitUrl()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitUrl();
                    }
                    if (event.key === "Escape") {
                      setSourceUrlDraft(selectedScreenSource?.url ?? "");
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder={t("editPanel.screenSource.urlPlaceholder")}
                  aria-label={t("editPanel.screenSource.urlLabel")}
                  disabled={!sourceEditable || screenSourcePending}
                  className="h-6 min-w-0 flex-1 text-[11px]"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 shrink-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 text-[11px] shadow-none hover:bg-[var(--design-editor-panel-raised-bg)]"
                  disabled={
                    !sourceEditable ||
                    screenSourcePending ||
                    !sourceUrlDraft.trim()
                  }
                  onClick={() => commitUrl()}
                >
                  {screenSourcePending
                    ? "…"
                    : t("editPanel.screenSource.update")}
                </Button>
              </div>
              {localhostConnections.length > 1 ? (
                <Select
                  value={connectionDraft}
                  onValueChange={(next) => {
                    setConnectionDraft(next);
                    if (persistedSourceType === "url") commitUrl(next);
                  }}
                  disabled={!sourceEditable || screenSourcePending}
                >
                  <SelectTrigger className="h-6 w-full min-w-0 text-[11px]">
                    <SelectValue
                      placeholder={t("editPanel.screenSource.chooseLocalApp")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {localhostConnections.map((connection) => (
                      <SelectItem
                        key={connection.id}
                        value={connection.id}
                        className="text-[11px]"
                      >
                        {connection.name ||
                          connection.devServerUrl ||
                          connection.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}
        </div>
        {screenBreakpointControls}
      </PanelSection>
      <PanelSection title={t("editPanel.sections.positionLayout")}>
        <div className="design-sidebar-property-group">
          <SubsectionLabel>{t("editPanel.labels.position")}</SubsectionLabel>
          <InspectorActionPairGrid
            className="items-center"
            left={
              <ScrubStyleInput
                label="X"
                value={`${Math.round(screen.x)}px`}
                onChange={editable ? (value) => commit({ x: value }) : noop}
                disabled={!editable}
                inputClassName="h-6"
              />
            }
            right={
              <ScrubStyleInput
                label="Y"
                value={`${Math.round(screen.y)}px`}
                onChange={editable ? (value) => commit({ y: value }) : noop}
                disabled={!editable}
                inputClassName="h-6"
              />
            }
          />
        </div>
        <div className="design-sidebar-property-group">
          <SubsectionLabel>
            {"Size" /* i18n-ignore design inspector label */}
          </SubsectionLabel>
          <InspectorActionPairGrid
            className="items-center"
            left={
              <SizingField
                axis="W"
                sizingAxis="horizontal"
                value="fixed"
                resolvedSize={screen.width}
                minMax={screen.sizeConstraints?.width}
                options={["fixed"]}
                disabled={!editable}
                onChange={() => {}}
                onSizeChange={
                  editable
                    ? (value) =>
                        commit({
                          width: Math.max(
                            MIN_SCREEN_FRAME_SIZE_PX,
                            clampScreenDimension(
                              value,
                              "width",
                              screen.sizeConstraints ??
                                EMPTY_SCREEN_SIZE_CONSTRAINTS,
                            ),
                          ),
                        })
                    : undefined
                }
                onMinMaxChange={onConstraintChange}
              />
            }
            right={
              <SizingField
                axis="H"
                sizingAxis="vertical"
                value={heightMode === "hug" ? "hug" : "fixed"}
                resolvedSize={screen.height}
                minMax={screen.sizeConstraints?.height}
                options={["fixed", "hug"]}
                autoMode={{
                  active: heightMode === "auto",
                  label: t("editPanel.alignSelfOptions.auto"),
                  onSelect: () => onHeightModeChange?.(screen.id, "auto"),
                }}
                showAdvancedOptions
                disabled={!editable}
                onChange={(mode) => {
                  if (mode === "fixed" || mode === "hug") {
                    onHeightModeChange?.(screen.id, mode);
                  }
                }}
                onSizeChange={
                  editable
                    ? (value) =>
                        commit({
                          height: Math.max(
                            MIN_SCREEN_FRAME_SIZE_PX,
                            clampScreenDimension(
                              value,
                              "height",
                              screen.sizeConstraints ??
                                EMPTY_SCREEN_SIZE_CONSTRAINTS,
                            ),
                          ),
                        })
                    : undefined
                }
                onMinMaxChange={onConstraintChange}
              />
            }
            action={
              editable ? (
                <ScreenSizePresetPicker
                  onPick={(preset) =>
                    commit({ width: preset.width, height: preset.height })
                  }
                />
              ) : null
            }
          />
        </div>
      </PanelSection>
    </>
  );
}

function InspectorTabsHeader({
  activeTab,
  readOnly,
  onActiveTabChange,
  trailing,
  commentsCount = 0,
  inspectorGridDebug = false,
  onInspectorGridDebugChange,
  tweaksEnabled,
}: {
  activeTab: InspectorTab;
  readOnly: boolean;
  onActiveTabChange: (tab: InspectorTab) => void;
  trailing?: ReactNode;
  commentsCount?: number;
  inspectorGridDebug?: boolean;
  onInspectorGridDebugChange?: (visible: boolean) => void;
  tweaksEnabled: boolean;
}) {
  const t = useT();

  return (
    <div
      data-design-inspector-tabs
      className="h-12 min-w-0 shrink-0 border-b border-border/90 px-2 py-2"
    >
      <InspectorGrid className="h-full items-center" layout="header-actions">
        <InspectorGridCell span={24}>
          <Tabs
            value={activeTab}
            onValueChange={(value) => onActiveTabChange(value as InspectorTab)}
            className="min-w-0"
          >
            <TabsList
              data-design-inspector-tabs-list
              className="h-7 max-w-full justify-start gap-0.5 overflow-hidden rounded-none bg-transparent p-0"
            >
              {!readOnly ? (
                <TabsTrigger
                  value="design"
                  data-design-inspector-tab="design"
                  aria-label={t("navigation.brand")}
                  className="design-sidebar-section-title h-6 rounded-md px-1.5 py-1 text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  {t("navigation.brand")}
                </TabsTrigger>
              ) : null}
              <TabsTrigger
                value="comments"
                data-design-inspector-tab="comments"
                aria-label={
                  commentsCount > 0
                    ? t("review.commentsTab", { count: commentsCount })
                    : t("review.comments")
                }
                className="design-sidebar-section-title group h-6 min-w-0 rounded-md gap-1 px-1.5 py-1 text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <span className="truncate">{t("review.comments")}</span>
                {commentsCount > 0 ? (
                  <span
                    className={cn(
                      "flex shrink-0 items-center justify-center rounded-full bg-muted tabular-nums text-muted-foreground group-data-[state=active]:bg-background",
                      "design-sidebar-meta h-4 min-w-4 px-1",
                    )}
                  >
                    {commentsCount > 99 ? "99+" : commentsCount}
                  </span>
                ) : null}
              </TabsTrigger>
              {!readOnly && tweaksEnabled ? (
                <TabsTrigger
                  value="tweaks"
                  data-design-inspector-tab="tweaks"
                  aria-label={t("designEditor.tweaks")}
                  className="design-sidebar-section-title h-6 rounded-md px-1.5 py-1 text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  {t("designEditor.tweaks")}
                </TabsTrigger>
              ) : (
                <TabsTrigger
                  value="code"
                  data-design-inspector-tab="code"
                  aria-label={"Code" /* i18n-ignore design inspector tab */}
                  className="design-sidebar-section-title h-6 rounded-md px-1.5 py-1 text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  {"Code" /* i18n-ignore design inspector tab */}
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </InspectorGridCell>
        <InspectorGridCell span={4}>
          <InspectorActionRail>
            {import.meta.env.DEV &&
            activeTab === "design" &&
            onInspectorGridDebugChange ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "size-6 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                      inspectorGridDebug &&
                        "bg-[var(--design-editor-accent-color)]/15 text-[var(--design-editor-accent-color)] hover:bg-[var(--design-editor-accent-color)]/20 hover:text-[var(--design-editor-accent-color)]",
                    )}
                    aria-label={
                      inspectorGridDebug
                        ? "Hide inspector grid" /* i18n-ignore design inspector debug action */
                        : "Show inspector grid" /* i18n-ignore design inspector debug action */
                    }
                    aria-pressed={inspectorGridDebug}
                    onClick={() =>
                      onInspectorGridDebugChange(!inspectorGridDebug)
                    }
                  >
                    <IconGridDots className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {
                    inspectorGridDebug
                      ? "Hide 28-column grid" /* i18n-ignore design inspector debug label */
                      : "Show 28-column grid" /* i18n-ignore design inspector debug label */
                  }
                </TooltipContent>
              </Tooltip>
            ) : null}
            {trailing ? <div className="shrink-0">{trailing}</div> : null}
          </InspectorActionRail>
        </InspectorGridCell>
      </InspectorGrid>
    </div>
  );
}

/**
 * Which background scope the nothing-selected panel addresses. Scope follows
 * what you are looking at; permission only decides whether the section appears
 * at all. Deciding by callback presence instead handed read-only viewers the
 * live document controls and editors the board colour.
 *
 * `single` alone does not mean "inside a screen editing it" — standalone it is
 * the responsive interactive view, and only a host-embedded editor stays in
 * `edit` there. Document scope needs both.
 */
export function resolveBackgroundPanelScope(input: {
  viewMode: DesignViewMode;
  mode: EditorMode;
  readOnly: boolean;
}): "canvas" | "document" | null {
  if (input.readOnly) return null;
  if (input.viewMode === "single" && input.mode === "edit") return "document";
  return "canvas";
}

function PageProperties({
  scope,
  styles,
  onStyleChange,
  onStylesChange,
  canvasBackground,
  canvasBackgroundFallback,
  onCanvasBackgroundChange,
}: {
  scope: "canvas" | "document";
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  canvasBackground?: string | null;
  canvasBackgroundFallback?: string | null;
  onCanvasBackgroundChange?: (value: string, meta?: StyleChangeMeta) => void;
}) {
  const t = useT();
  const baseFontFamilyOptions = sortFontFamilyOptions(
    FONT_FAMILY_OPTIONS.map((option) => ({
      value: option.value,
      label:
        option.label ??
        (option.key
          ? t(`editPanel.fontFamilies.${option.key}`)
          : displayFontFamilyName(option.value)),
    })),
  );
  const fontFamily = resolveFontFamilySelectValue(styles.fontFamily);
  const fontFamilyOptions = sortFontFamilyOptions(
    FONT_FAMILY_OPTIONS.some((option) => option.value === fontFamily)
      ? baseFontFamilyOptions
      : [
          {
            value: fontFamily,
            label: displayFontFamilyName(styles.fontFamily || fontFamily),
          },
          ...baseFontFamilyOptions,
        ],
  );

  return (
    <div>
      {scope === "canvas" && onCanvasBackgroundChange ? (
        <PanelSection title={t("editPanel.sections.canvas")}>
          <ColorInput
            label={t("editPanel.labels.background")}
            value={canvasBackground ?? canvasBackgroundFallback ?? ""}
            supportedPaintTypes={["solid", "none"]}
            onChange={(value, meta) => onCanvasBackgroundChange(value, meta)}
            allowDesignHistoryHotkeys
          />
        </PanelSection>
      ) : null}
      {scope === "document" ? (
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
            onSolidToGradientChange={(patch) =>
              commitStylePatch(patch, onStyleChange, onStylesChange)
            }
            onImageFillLayerChange={(patch) =>
              commitStylePatch(patch, onStyleChange, onStylesChange)
            }
            blendMode={styles.backgroundBlendMode || "normal"}
            onBlendModeChange={(v) => onStyleChange("backgroundBlendMode", v)}
            supportsLayeredFills
            allowDesignHistoryHotkeys
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
      ) : null}
    </div>
  );
}

function ExportPreview({
  element,
  onRender,
}: {
  element: ElementInfo | null;
  onRender?: () => Promise<Blob>;
}) {
  const t = useT();
  const rect = element?.boundingRect;
  const [rendered, setRendered] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const width = rendered?.width ?? rect?.width ?? null;
  const height = rendered?.height ?? rect?.height ?? null;
  const aspect =
    width != null && height != null && width > 0 && height > 0
      ? width / height
      : 1;
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; url: string }
    | { status: "failed" }
  >({ status: "idle" });

  useEffect(() => {
    if (!onRender) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });
    setRendered(null);
    void onRender()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [onRender]);

  return (
    <div className="mt-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-3">
      <div
        className="mx-auto flex max-h-28 items-center justify-center overflow-hidden"
        style={{
          aspectRatio: aspect,
          width: aspect >= 1 ? "100%" : "auto",
          height: aspect < 1 ? "7rem" : "auto",
        }}
      >
        {state.status === "ready" ? (
          <img
            src={state.url}
            alt=""
            className="size-full object-contain"
            style={{
              imageRendering: "auto",
            }}
            onLoad={(event) =>
              setRendered({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        ) : (
          <div className="flex size-full items-center justify-center rounded border border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] px-2 text-center !text-[10px] text-muted-foreground">
            {state.status === "failed"
              ? t("editPanel.exportPreview.failed")
              : t("editPanel.exportPreview.rendering")}
          </div>
        )}
      </div>
      {width != null && height != null ? (
        <p className="mt-2 text-center text-[10px] tabular-nums text-muted-foreground">
          {Math.round(width)} × {Math.round(height)}
        </p>
      ) : null}
    </div>
  );
}

function ExportPreviewDisclosure({
  element,
  onRender,
}: {
  element: ElementInfo | null;
  onRender?: () => Promise<Blob>;
}) {
  const [open, setOpen] = useState(false);
  const label = "Preview"; // i18n-ignore design inspector label

  return (
    <div className="min-h-4">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className="design-sidebar-field-label flex h-4 cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <IconChevronDown className="size-3 shrink-0" />
        ) : (
          <IconChevronRight className="size-3 shrink-0 rtl:-scale-x-100" />
        )}
        {label}
      </button>
      {open ? <ExportPreview element={element} onRender={onRender} /> : null}
    </div>
  );
}

export function SelectionColorsProperties({
  elements,
  scopes,
  onColorChange,
  onColorTarget,
  canSelectColorTarget,
  onColorPickerOpenChange,
  colors: providedColors,
  title,
}: {
  elements: ElementInfo[];
  scopes?: SelectionColorScope[];
  onColorChange?: SelectionColorChangeHandler;
  onColorTarget?: (color: string) => void;
  canSelectColorTarget?: (color: string) => boolean;
  onColorPickerOpenChange?: (from: string, open: boolean) => void;
  colors?: SelectionColorValue[];
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const colors = providedColors ?? selectionColorValues(elements, scopes);
  const onColorPickerOpenChangeRef = useRef(onColorPickerOpenChange);
  onColorPickerOpenChangeRef.current = onColorPickerOpenChange;
  const scopeIdentity = JSON.stringify({
    scopes: scopes?.map(({ fileId, sourceId, selector, wholeDocument }) => ({
      fileId,
      sourceId,
      selector,
      wholeDocument,
    })),
    elements: scopes?.length
      ? []
      : elements.map(({ sourceId, selector }) => ({ sourceId, selector })),
  });
  const [pickerSession, setPickerSession] = useState<{
    colors: SelectionColorValue[];
    from: string;
    index: number;
    value: string;
    scopeIdentity: string;
  } | null>(null);
  const pickerSessionRef = useRef<typeof pickerSession>(null);
  const activeGestureRef = useRef<{
    index: number;
    startValue: string;
    scopeIdentity: string;
  } | null>(null);
  const updatePickerSession = (next: typeof pickerSession) => {
    pickerSessionRef.current = next;
    setPickerSession(next);
  };
  useEffect(() => {
    const current = pickerSessionRef.current;
    if (current) onColorPickerOpenChangeRef.current?.(current.from, false);
    pickerSessionRef.current = null;
    setPickerSession(null);
    activeGestureRef.current = null;
  }, [scopeIdentity]);
  const visibleColors =
    pickerSession?.scopeIdentity === scopeIdentity
      ? pickerSession.colors.map((color, index) =>
          index === pickerSession.index
            ? { ...color, value: pickerSession.value }
            : color,
        )
      : colors;

  const setColorPickerOpen = (
    index: number,
    color: SelectionColorValue,
    open: boolean,
  ) => {
    if (open) {
      const next = {
        colors: colors.map((entry) => ({ ...entry })),
        from: color.value,
        index,
        value: color.value,
        scopeIdentity,
      };
      activeGestureRef.current = null;
      updatePickerSession(next);
      onColorPickerOpenChange?.(next.from, true);
      return;
    }
    const current = pickerSessionRef.current;
    if (current?.scopeIdentity !== scopeIdentity || current.index !== index) {
      return;
    }
    onColorPickerOpenChange?.(current.from, false);
    activeGestureRef.current = null;
    updatePickerSession(null);
  };

  const changeColor = (
    index: number,
    color: SelectionColorValue,
    value: string,
    phase: StyleChangeMeta["phase"],
  ) => {
    const currentSession = pickerSessionRef.current;
    const sameSession =
      currentSession?.scopeIdentity === scopeIdentity &&
      currentSession.index === index;
    if (!sameSession || !currentSession) return;
    const session = currentSession;
    const current = activeGestureRef.current;
    const sameGesture =
      current?.scopeIdentity === scopeIdentity && current.index === index;
    const closeOnRefusal = () => {
      onColorPickerOpenChangeRef.current?.(session.from, false);
      activeGestureRef.current = null;
      updatePickerSession(null);
    };
    if (phase === "preview") {
      const nextGesture = sameGesture
        ? current
        : { index, startValue: session.value, scopeIdentity };
      activeGestureRef.current = nextGesture;
      updatePickerSession({ ...session, value });
      if (onColorChange?.(session.from, value, { phase }) === false) {
        closeOnRefusal();
      }
      return;
    }
    if (onColorChange?.(session.from, value, { phase }) === false) {
      closeOnRefusal();
      return;
    }
    if (phase === "cancel") {
      updatePickerSession({
        ...session,
        value: sameGesture ? current.startValue : session.value,
      });
    } else {
      updatePickerSession({ ...session, value });
    }
    activeGestureRef.current = null;
  };
  if (!visibleColors.length) return null;

  return (
    <PanelSection
      title={
        title ?? "Selection colors" /* i18n-ignore design inspector label */
      }
    >
      {expanded ? (
        <InspectorGrid>
          {visibleColors.map((color, index) => {
            const value = color.value;
            const parsed = parseCssColor(value);
            const opacity = parsed ? alphaToOpacity(parsed.a) : 100;
            return (
              <InspectorGridCell key={index} span={28}>
                <div className="flex w-full items-center gap-1">
                  <DesignColorPicker
                    className="min-w-0 flex-1"
                    trigger={
                      <button
                        type="button"
                        className="flex h-6 w-full items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
                        aria-label={value}
                        disabled={!onColorChange}
                      >
                        <span
                          className="size-4 shrink-0 rounded-[3px] border border-border/60"
                          style={swatchStyle(value)}
                        />
                        <span className="min-w-0 flex-1 truncate text-left uppercase tabular-nums">
                          {selectionDisplayHex(value)}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {opacity}%
                        </span>
                        {color.count && color.count > 1 ? (
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            ×{color.count}
                          </span>
                        ) : null}
                      </button>
                    }
                    value={cssColorOrFallback(value, DEFAULT_AUTHORED_COLOR)}
                    open={
                      pickerSession?.scopeIdentity === scopeIdentity &&
                      pickerSession.index === index
                    }
                    onOpenChange={(open) =>
                      setColorPickerOpen(index, color, open)
                    }
                    supportedPaintTypes={["solid"]}
                    onChange={(next) =>
                      changeColor(index, color, next, "preview")
                    }
                    onChangeComplete={(next) =>
                      changeColor(index, color, next, "commit")
                    }
                    onChangeCancel={(next) =>
                      changeColor(index, color, next, "cancel")
                    }
                    allowDesignHistoryHotkeys
                    onDesignHistoryHotkey={() => {
                      if (activeGestureRef.current) return;
                      setColorPickerOpen(index, color, false);
                    }}
                    disabled={!onColorChange}
                  />
                  {onColorTarget && (canSelectColorTarget?.(value) ?? true) ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
                          aria-label={`${t("designEditor.keyboardShortcuts.commands.find")}: ${value}`}
                          onClick={() => onColorTarget(value)}
                        >
                          <IconTarget className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        {t("designEditor.keyboardShortcuts.commands.find")}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              </InspectorGridCell>
            );
          })}
        </InspectorGrid>
      ) : (
        <InspectorGrid>
          <InspectorGridCell span={28}>
            <button
              type="button"
              className="flex h-6 w-full items-center justify-between gap-2 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 text-left !text-[11px] text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground"
              onClick={() => setExpanded(true)}
            >
              <span className="truncate">
                {
                  "Show selection colors" /* i18n-ignore design inspector label */
                }
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
          </InspectorGridCell>
        </InspectorGrid>
      )}
    </PanelSection>
  );
}

function GroupFillProperties({
  scopes,
  documentColors,
  disabled,
  onStylesChange,
  mostRecentFillColor,
}: {
  scopes: SelectionColorScope[];
  documentColors: string[];
  disabled: boolean;
  onStylesChange?: (
    styles: Record<string, string>,
    meta?: StyleChangeMeta,
  ) => boolean;
  mostRecentFillColor?: string;
}) {
  const model = useMemo(() => selectionFillModel(scopes), [scopes]);
  const styles = useMemo(() => selectionFillInspectorStyles(model), [model]);
  const element = useMemo<ElementInfo>(
    () => ({
      tagName: "div",
      sourceId: "group-fill-inspector",
      selector: "[data-agent-native-group='true']",
      isGroup: true,
      classes: [],
      isFlexChild: false,
      isFlexContainer: false,
      computedStyles: styles,
      inlineStyles: styles,
      boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    }),
    [styles],
  );
  const onStyleChange = useCallback<StyleChangeHandler>(
    (property, value, meta) =>
      onStylesChange?.({ ...styles, [property]: value }, meta),
    [onStylesChange, styles],
  );
  const onBatchStyleChange = useCallback<StylesChangeHandler>(
    (nextStyles, meta) => onStylesChange?.({ ...styles, ...nextStyles }, meta),
    [onStylesChange, styles],
  );
  const onAddFill = useCallback(() => {
    if (disabled || !onStylesChange) return null;
    const added = selectionFillAddedStyles(model, mostRecentFillColor);
    return onStylesChange(added.styles) ? added.open : null;
  }, [disabled, model, mostRecentFillColor, onStylesChange]);

  return (
    <FillProperties
      element={element}
      onStyleChange={disabled ? () => undefined : onStyleChange}
      onStylesChange={disabled ? undefined : onBatchStyleChange}
      documentColorPalette={documentColors}
      hideAddFill={disabled}
      cancelOpacityGestureOnHistoryUndo={!disabled}
      onAddFill={onAddFill}
    />
  );
}

const NO_DOCUMENT_COLORS: string[] = [];

function useDocumentColorPalette(files?: DocumentColorSourceFile[]) {
  const cacheRef = useRef<DocumentColorCountCache>(new Map());
  const [palette, setPalette] = useState(NO_DOCUMENT_COLORS);
  useEffect(() => {
    const cache = cacheRef.current;
    if (!files?.length) {
      cache.clear();
      setPalette(NO_DOCUMENT_COLORS);
      return;
    }
    let next = 0;
    return runInIdleSlices((deadline) => {
      do {
        const file = files[next];
        if (!file) {
          const read = extractDocumentColorPalette(files, undefined, cache);
          setPalette((current) =>
            current.length === read.length &&
            current.every((color, index) => color === read[index])
              ? current
              : read,
          );
          return true;
        }
        next += 1;
        documentFileColorCounts(file, cache);
      } while (performance.now() < deadline);
      return false;
    });
  }, [files]);
  return palette;
}

export const EditPanel = memo(function EditPanel({
  selectedElement,
  textEditingState,
  selectionHidden = false,
  onToggleSelectionHidden,
  selectedElements,
  selectedScreenGeometry,
  selectedScreenLayoutGrid,
  onLayoutGridChange,
  canvasBackground,
  canvasBackgroundFallback,
  onCanvasBackgroundChange,
  onScreenGeometryChange,
  onScreenHeightModeChange,
  selectedScreenSource,
  sourceLocationUnavailable = false,
  localhostConnections,
  onScreenSourceChange,
  onAddLocalhostScreen,
  onRemoveScreen,
  screenSourcePending,
  screenBreakpointControls,
  pageStyles = {},
  selectedScreenElement,
  onSelectedScreenStyleChange,
  onSelectedScreenStylesChange,
  vectorPointRadius,
  vectorPointSelected,
  onVectorPointRadiusChange,
  selectionColorScopes = [],
  onSelectionColorChange: onSelectionColorChangeProp,
  onSelectionColorTarget,
  canSelectSelectionColorTarget,
  onSelectionColorPickerOpenChange,
  onGroupFillStylesChange: onGroupFillStylesChangeProp,
  viewMode,
  mode,
  headerTrailing,
  inspectorGridDebug = false,
  onInspectorGridDebugChange,
  width = 256,
  readOnly = false,
  activeTab = "design",
  onActiveTabChange,
  tweaksEnabled = true,
  tweaks = [],
  tweakValues = {},
  onTweakChange,
  onRequestTweaks,
  onStyleChange: onStyleChangeProp,
  onStylesChange: onStylesChangeProp,
  onExport,
  onRenderExportPreview,
  exporting = false,
  fileId,
  boardFileId,
  previewFrameId,
  activeContent,
  pendingInteractionStateStyles,
  activeFileUpdatedAt,
  getComponentExpectedFiles,
  files,
  designId,
  onComponentPropApplied,
  onShaderSourceApplied,
  onFontUploaded,
  reviewPanelProps,
  reviewCommentsPanelProps,
  reviewCommentsCount = 0,
  componentNodeId,
  componentRuntime,
  requestLocalhostWrite,
  componentDetailsReady = true,
  componentInstanceHasLocalOverrides = false,
  onResetComponentInstanceOverrides,
  onRestoreComponent,
  componentSwapPickerRequest,
  sourceCapabilities = [],
  onCreateComponent,
  selectedElementAlreadyComponent = false,
  defaultComponentName = "Component",
  inspectCode,
  aiActions,
  activeTool,
  scaleToolControls,
  onCreateScreenFromPreset,
  onAlignSelection,
  alignSelectionDisabled = false,
  onDisableAutoLayout,
  onApplyLayoutFlow,
  onInteractionStateChange,
  availableInteractionStates,
  onEditCode,
  motionKeyframeState,
  onToggleMotionKeyframe,
  breakpointContext,
}: EditPanelProps) {
  const recentFillColorRef = useRef<string | undefined>(undefined);
  const t = useT();
  const [createComponentOpen, setCreateComponentOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettingsValue>(
    DEFAULT_EXPORT_SETTINGS,
  );
  const [interactionState, setInteractionState] =
    useState<ActiveInteractionState>(null);
  const [interactionStateMenuOpen, setInteractionStateMenuOpen] =
    useState(false);

  const effectiveSelectedElements = useMemo(
    () =>
      selectedElements && selectedElements.length > 0
        ? selectedElements
        : selectedElement
          ? [selectedElement]
          : [],
    [selectedElement, selectedElements],
  );
  const capturedStyleTargets = useMemo<CapturedStyleTarget[]>(
    () =>
      effectiveSelectedElements.map((element) => ({
        fileId: element.sourceLayerIdentity?.screenId ?? "",
        layerId: element.sourceLayerIdentity?.nodeId ?? "",
        elementInfo: element,
        upperBoundPx: breakpointContext?.upperBoundPx ?? null,
        lowerBoundPx: breakpointContext?.lowerBoundPx ?? null,
      })),
    [
      breakpointContext?.lowerBoundPx,
      breakpointContext?.upperBoundPx,
      effectiveSelectedElements,
    ],
  );
  const inspectorElement = useMemo(() => {
    const element =
      effectiveSelectedElements.length > 1
        ? mixedElementFromSelection(effectiveSelectedElements)
        : (effectiveSelectedElements[0] ?? null);
    if (
      !element ||
      effectiveSelectedElements.length !== 1 ||
      !(
        textEditingState?.hasRange ||
        (textEditingState?.active && textEditingState.computedStyles)
      ) ||
      !textEditingState.screenId ||
      element.sourceLayerIdentity?.screenId !== textEditingState.screenId
    ) {
      return element;
    }
    const matchesSourceId =
      !!textEditingState.sourceId &&
      [
        element.sourceLayerIdentity?.nodeId,
        element.runtimeSourceId,
        element.sourceId,
      ].includes(textEditingState.sourceId);
    const matchesSelector =
      !!textEditingState.selector &&
      [element.selector, element.runtimeSelector].includes(
        textEditingState.selector,
      );
    if (!matchesSourceId && !matchesSelector) return element;

    const computedStyles = { ...element.computedStyles };
    const inlineStyles = { ...(element.inlineStyles ?? {}) };
    delete computedStyles.resolvedLineHeightPx;
    const rangeStyles = textEditingState.computedStyles ?? {};
    Object.assign(computedStyles, rangeStyles);
    for (const property of Object.keys(rangeStyles)) {
      if (property !== "resolvedLineHeightPx") delete inlineStyles[property];
    }
    Object.assign(inlineStyles, textEditingState.inlineStyles ?? {});
    return {
      ...element,
      computedStyles,
      inlineStyles:
        Object.keys(inlineStyles).length > 0 ? inlineStyles : undefined,
    };
  }, [effectiveSelectedElements, textEditingState]);
  const selectedCount = effectiveSelectedElements.length;
  const glslShaderContext: GlslShaderPanelContext | undefined = useMemo(() => {
    if (!designId || !fileId || selectedCount > 1) return undefined;
    const nodeId = inspectorElement?.sourceId;
    if (!nodeId) return undefined;
    return {
      designId,
      fileId,
      nodeId,
      selector: inspectorElement?.selector,
      onApplied: onShaderSourceApplied,
      onEditCode,
    };
  }, [
    designId,
    fileId,
    selectedCount,
    inspectorElement?.sourceId,
    inspectorElement?.selector,
    onShaderSourceApplied,
    onEditCode,
  ]);
  const documentColorPalette = useDocumentColorPalette(files);
  const selectionAlreadyComponent =
    selectedCount === 1 &&
    (selectedElementAlreadyComponent ||
      elementHasComponentAnnotation(selectedElement));
  const canCreateComponent = Boolean(
    onCreateComponent &&
    selectedElement &&
    selectedCount <= 1 &&
    !selectionAlreadyComponent,
  );
  const selectedElementKey = inspectorElement
    ? interactionStateSelectionKey(inspectorElement, fileId, selectedCount)
    : "none";
  const lastInteractionStateSourceIdRef = useRef<string | null>(null);
  if (selectedCount <= 1 && inspectorElement?.sourceId) {
    lastInteractionStateSourceIdRef.current = inspectorElement.sourceId;
  }
  const backgroundPanelScope = resolveBackgroundPanelScope({
    viewMode,
    mode,
    readOnly,
  });
  const shouldRenderInteractionStatePanel = Boolean(
    (selectedCount <= 1 && inspectorElement?.sourceId) ||
    ((interactionState !== null || interactionStateMenuOpen) &&
      lastInteractionStateSourceIdRef.current),
  );
  const selectionHasTextElement = effectiveSelectedElements.some((element) =>
    isTextElement(element),
  );
  const selectionIsTextOnly =
    effectiveSelectedElements.length > 0 &&
    effectiveSelectedElements.every((element) => isTextElement(element));
  const selectionIsGroup =
    selectedCount === 1 && inspectorElement?.isGroup === true;
  const selectionHasContainerElement = effectiveSelectedElements.some(
    (element) => isContainerElement(element),
  );
  const handleActiveTabChange = useCallback(
    (tab: InspectorTab) => {
      if (tab === "tweaks" && !tweaksEnabled) return;
      onActiveTabChange?.(tab);
    },
    [onActiveTabChange, tweaksEnabled],
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
  }, [selectedElementKey]);

  useEffect(() => {
    if (!canCreateComponent) setCreateComponentOpen(false);
  }, [canCreateComponent]);

  useEffect(() => {
    setInteractionState(null);
    setInteractionStateMenuOpen(false);
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

  const interactionStatesWithOverrides = useMemo(():
    | ReadonlySet<InteractionState>
    | undefined => {
    if (!activeContent || selectedCount > 1) return undefined;
    const nodeId = inspectorElement?.sourceId;
    if (!nodeId) return undefined;
    const states = listInteractionStates(activeContent, nodeId);
    const pendingStates = Object.entries(pendingInteractionStateStyles ?? {})
      .filter(([, styles]) => styles && Object.keys(styles).length > 0)
      .map(([state]) => state as InteractionState);
    const combined = [...states, ...pendingStates];
    return combined.length > 0 ? new Set(combined) : undefined;
  }, [
    activeContent,
    pendingInteractionStateStyles,
    selectedCount,
    inspectorElement?.sourceId,
  ]);

  const activeInteractionStateStyles = useMemo(():
    | Record<string, string>
    | undefined => {
    if (!activeContent || !interactionState || selectedCount > 1) {
      return undefined;
    }
    const nodeId = inspectorElement?.sourceId;
    if (!nodeId) return undefined;
    return mergeOptimisticInteractionStateStyles(
      readResolvedStateStyles(
        activeContent,
        nodeId,
        interactionState,
        breakpointContext?.activeWidthPx,
      ),
      pendingInteractionStateStyles?.[interactionState],
    );
  }, [
    activeContent,
    interactionState,
    selectedCount,
    inspectorElement?.sourceId,
    breakpointContext?.activeWidthPx,
    pendingInteractionStateStyles,
  ]);

  const stateResolvedInspectorElement = useMemo(
    () =>
      inspectorElement
        ? elementWithInteractionStateStyles(
            inspectorElement,
            activeInteractionStateStyles,
          )
        : null,
    [activeInteractionStateStyles, inspectorElement],
  );

  const inspectorElementForSections =
    stateResolvedInspectorElement ?? inspectorElement;
  const inspectorElementSectionKey = inspectorElementForSections
    ? elementInspectorKey(inspectorElementForSections, fileId)
    : "inspector";
  const selectedScreenElementSectionKey = selectedScreenElement
    ? elementInspectorKey(selectedScreenElement, selectedScreenGeometry?.id)
    : "selected-screen";

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

  const onStyleChange = useCallback<StyleChangeHandler>(
    (property, value, meta) => {
      onStyleChangeProp(
        property,
        value,
        interactionState ? { ...meta, interactionState } : meta,
      );
      if (
        meta?.phase !== "preview" &&
        [
          "background",
          "backgroundColor",
          "backgroundImage",
          "color",
          "fill",
        ].includes(property)
      ) {
        recentFillColorRef.current =
          lastCssColor(value) ?? recentFillColorRef.current;
      }
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
      if (meta?.phase !== "preview") {
        const candidate = [
          styles.fill,
          styles.backgroundColor,
          styles.backgroundImage,
          styles.color,
          styles.background,
        ]
          .filter((value): value is string => Boolean(value))
          .map(lastCssColor)
          .find((value): value is string => Boolean(value));
        if (candidate) recentFillColorRef.current = candidate;
      }
    },
    [onStylesChangeProp, interactionState],
  );
  const onSelectionColorChange = useCallback<SelectionColorChangeHandler>(
    (from, to, meta) =>
      onSelectionColorChangeProp?.(
        from,
        to,
        interactionState ? { ...meta, interactionState } : meta,
      ),
    [interactionState, onSelectionColorChangeProp],
  );
  const onGroupFillStylesChange = useCallback(
    (styles: Record<string, string>, meta?: StyleChangeMeta) => {
      const applied = onGroupFillStylesChangeProp?.(styles, meta) ?? false;
      if (applied && meta?.phase !== "preview" && meta?.phase !== "cancel") {
        const candidate = [
          styles.backgroundImage,
          styles.backgroundColor,
          styles.color,
          styles.fill,
        ]
          .filter((value): value is string => Boolean(value))
          .map(lastCssColor)
          .find((value): value is string => Boolean(value));
        if (candidate) recentFillColorRef.current = candidate;
      }
      return applied;
    },
    [onGroupFillStylesChangeProp],
  );

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

  const scrolledRecentlyRef = useRef(false);
  const userScrollIntentRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedActiveTab: InspectorTab =
    readOnly && (activeTab === "design" || activeTab === "tweaks")
      ? "code"
      : !tweaksEnabled && activeTab === "tweaks"
        ? "design"
        : activeTab;

  const showFramePresets =
    !readOnly &&
    resolvedActiveTab === "design" &&
    activeTool === "frame" &&
    Boolean(onCreateScreenFromPreset);

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={400}>
      <div
        className={cn(
          "design-sidebar shrink-0 bg-[var(--design-editor-panel-bg)]",
          "relative flex h-full min-h-0 flex-col overflow-hidden",
        )}
        style={{ width }}
      >
        <InspectorTabsHeader
          activeTab={resolvedActiveTab}
          readOnly={readOnly}
          onActiveTabChange={handleActiveTabChange}
          trailing={headerTrailing}
          commentsCount={reviewCommentsCount}
          inspectorGridDebug={inspectorGridDebug}
          onInspectorGridDebugChange={onInspectorGridDebugChange}
          tweaksEnabled={tweaksEnabled}
        />

        {showFramePresets ? (
          <FramePresetsPanel
            onPick={(preset) => onCreateScreenFromPreset?.(preset)}
          />
        ) : resolvedActiveTab === "design" ? (
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
            {sourceLocationUnavailable ? (
              <div
                role="status"
                className="border-b border-border/80 bg-amber-500/5 px-3 py-2 text-[10px] leading-4 text-muted-foreground"
              >
                {
                  "No source locations available for this app." /* i18n-ignore design inspector status */
                }
              </div>
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
                  boardFileId={boardFileId}
                  previewFrameId={
                    previewFrameId ??
                    (viewMode === "overview" && fileId && breakpointContext
                      ? getActiveScreenIframeId({
                          id: fileId,
                          activeBreakpointWidth:
                            breakpointContext.activeWidthPx ?? undefined,
                          breakpointWidths: [
                            ...breakpointContext.breakpointWidths,
                          ],
                        })
                      : fileId)
                  }
                  activeContent={activeContent}
                  activeFileUpdatedAt={activeFileUpdatedAt}
                  getExpectedFiles={getComponentExpectedFiles}
                  componentDetailsReady={componentDetailsReady}
                  nodeId={componentNodeId}
                  runtime={componentRuntime}
                  requestLocalhostWrite={requestLocalhostWrite}
                  hasLocalOverrides={componentInstanceHasLocalOverrides}
                  swapPickerRequest={componentSwapPickerRequest}
                  onResetOverrides={
                    onResetComponentInstanceOverrides
                      ? () => onResetComponentInstanceOverrides(componentNodeId)
                      : undefined
                  }
                  onRestoreComponent={
                    onRestoreComponent
                      ? () => onRestoreComponent(componentNodeId)
                      : undefined
                  }
                  onComponentPropApplied={onComponentPropApplied}
                  sourceCapabilities={sourceCapabilities}
                />
              )}

              {aiActions ? (
                <div className="px-2 py-1.5 shadow-[inset_0_-1px_var(--design-editor-control-border)]">
                  {aiActions}
                </div>
              ) : null}

              {!inspectorElement && selectedScreenGeometry ? (
                <>
                  <ScreenGeometryProperties
                    screen={selectedScreenGeometry}
                    onGeometryChange={
                      readOnly ? undefined : onScreenGeometryChange
                    }
                    onHeightModeChange={
                      readOnly ? undefined : onScreenHeightModeChange
                    }
                    onConstraintChange={
                      !readOnly &&
                      selectedScreenElement &&
                      onSelectedScreenStyleChange
                        ? (axis, kind, value, meta) =>
                            commitElementMinMax(
                              axis,
                              kind,
                              value,
                              onSelectedScreenStyleChange,
                              meta,
                            )
                        : undefined
                    }
                    selectedScreenSource={selectedScreenSource}
                    localhostConnections={localhostConnections}
                    onScreenSourceChange={
                      readOnly ? undefined : onScreenSourceChange
                    }
                    onAddLocalhostScreen={
                      readOnly ? undefined : onAddLocalhostScreen
                    }
                    onRemoveScreen={readOnly ? undefined : onRemoveScreen}
                    screenSourcePending={screenSourcePending}
                    screenBreakpointControls={screenBreakpointControls}
                  />
                  {onLayoutGridChange ? (
                    <LayoutGridProperties
                      grid={selectedScreenLayoutGrid ?? null}
                      readOnly={readOnly}
                      onChange={(next) =>
                        onLayoutGridChange(selectedScreenGeometry.id, next)
                      }
                    />
                  ) : null}
                  {selectedScreenElement && onSelectedScreenStyleChange ? (
                    <>
                      <LayoutContextProperties
                        key={`layout-context:${selectedScreenElementSectionKey}`}
                        element={selectedScreenElement}
                        onStyleChange={onSelectedScreenStyleChange}
                        onStylesChange={onSelectedScreenStylesChange}
                        onDisableAutoLayout={onDisableAutoLayout}
                        onApplyLayoutFlow={onApplyLayoutFlow}
                        showContainerSizing={false}
                      />
                      <AppearanceProperties
                        key={`appearance:${selectedScreenElementSectionKey}`}
                        element={selectedScreenElement}
                        onStyleChange={onSelectedScreenStyleChange}
                        onStylesChange={onSelectedScreenStylesChange}
                        hidden={selectionHidden}
                        onToggleHidden={onToggleSelectionHidden}
                      />
                      <FillProperties
                        key={`fill:${selectedScreenElementSectionKey}`}
                        element={selectedScreenElement}
                        onStyleChange={onSelectedScreenStyleChange}
                        onStylesChange={onSelectedScreenStylesChange}
                        documentColorPalette={documentColorPalette}
                      />
                      <StrokeProperties
                        key={`stroke:${selectedScreenElementSectionKey}`}
                        element={selectedScreenElement}
                        onStyleChange={onSelectedScreenStyleChange}
                        onStylesChange={onSelectedScreenStylesChange}
                      />
                      <EffectsProperties
                        key={`effects:${selectedScreenElementSectionKey}`}
                        element={selectedScreenElement}
                        onStyleChange={onSelectedScreenStyleChange}
                        onStylesChange={onSelectedScreenStylesChange}
                      />
                      <SelectionColorsProperties
                        elements={[selectedScreenElement]}
                        scopes={selectionColorScopes}
                        onColorTarget={onSelectionColorTarget}
                        canSelectColorTarget={canSelectSelectionColorTarget}
                        onColorPickerOpenChange={
                          onSelectionColorPickerOpenChange
                        }
                        onColorChange={
                          readOnly || interactionState
                            ? undefined
                            : onSelectionColorChange
                        }
                      />
                    </>
                  ) : null}
                </>
              ) : null}

              {!inspectorElement &&
              !selectedScreenGeometry &&
              selectionColorScopes.length > 0 ? (
                <SelectionColorsProperties
                  elements={[]}
                  scopes={selectionColorScopes}
                  onColorTarget={onSelectionColorTarget}
                  canSelectColorTarget={canSelectSelectionColorTarget}
                  onColorPickerOpenChange={onSelectionColorPickerOpenChange}
                  onColorChange={
                    readOnly || interactionState
                      ? undefined
                      : onSelectionColorChange
                  }
                />
              ) : null}

              {!inspectorElement &&
              !selectedScreenGeometry &&
              backgroundPanelScope ? (
                <PageProperties
                  scope={backgroundPanelScope}
                  styles={pageStyles}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                  canvasBackground={canvasBackground}
                  canvasBackgroundFallback={canvasBackgroundFallback}
                  onCanvasBackgroundChange={onCanvasBackgroundChange}
                />
              ) : null}

              {shouldRenderInteractionStatePanel ? (
                <InteractionStatePanel
                  activeState={interactionState}
                  onActiveStateChange={handleInteractionStateChange}
                  open={interactionStateMenuOpen}
                  onOpenChange={setInteractionStateMenuOpen}
                  availableStates={availableInteractionStates}
                  statesWithOverrides={interactionStatesWithOverrides}
                />
              ) : null}

              {inspectorElement && (
                <>
                  <PositionLayoutProperties
                    key={`position:${inspectorElementSectionKey}`}
                    element={stateResolvedInspectorElement ?? inspectorElement}
                    onStyleChange={onStyleChange}
                    onStylesChange={onStylesChange}
                    onAlignSelection={onAlignSelection}
                    alignSelectionDisabled={alignSelectionDisabled}
                    motionKeyframeContext={motionKeyframeFieldContext}
                    breakpointOverrideContext={breakpointOverrideFieldContext}
                  />
                  {activeTool === "scale" &&
                  scaleToolControls &&
                  effectiveSelectedElements.length === 1 ? (
                    <ScaleProperties
                      key={`scale:${inspectorElementSectionKey}`}
                      element={
                        stateResolvedInspectorElement ?? inspectorElement
                      }
                      controls={scaleToolControls}
                    />
                  ) : null}
                  <LayoutContextProperties
                    key={`layout-context:${inspectorElementSectionKey}`}
                    element={stateResolvedInspectorElement ?? inspectorElement}
                    onStyleChange={onStyleChange}
                    onStylesChange={onStylesChange}
                    onDisableAutoLayout={onDisableAutoLayout}
                    onApplyLayoutFlow={onApplyLayoutFlow}
                    motionKeyframeContext={motionKeyframeFieldContext}
                    breakpointOverrideContext={breakpointOverrideFieldContext}
                  />
                  <AppearanceProperties
                    key={`appearance:${inspectorElementSectionKey}`}
                    element={stateResolvedInspectorElement ?? inspectorElement}
                    onStyleChange={onStyleChange}
                    onStylesChange={
                      onStylesChangeProp ? onStylesChange : undefined
                    }
                    hidden={selectionHidden}
                    onToggleHidden={onToggleSelectionHidden}
                    motionKeyframeContext={motionKeyframeFieldContext}
                    breakpointOverrideContext={breakpointOverrideFieldContext}
                    vectorPointRadius={vectorPointRadius}
                    vectorPointSelected={vectorPointSelected}
                    onVectorPointRadiusChange={onVectorPointRadiusChange}
                  />
                  {selectionHasTextElement ? (
                    <TypographyProperties
                      key={`typography:${inspectorElementSectionKey}`}
                      element={
                        stateResolvedInspectorElement ?? inspectorElement
                      }
                      onStyleChange={onStyleChange}
                      onStylesChange={
                        onStylesChangeProp ? onStylesChange : undefined
                      }
                      designId={designId}
                      onFontUploaded={onFontUploaded}
                    />
                  ) : null}
                  {selectionIsGroup ? (
                    <GroupFillProperties
                      key={`group-fill:${inspectorElementSectionKey}`}
                      scopes={selectionColorScopes}
                      documentColors={documentColorPalette}
                      disabled={readOnly || Boolean(interactionState)}
                      onStylesChange={
                        readOnly || interactionState
                          ? undefined
                          : onGroupFillStylesChange
                      }
                      mostRecentFillColor={recentFillColorRef.current}
                    />
                  ) : (
                    <FillProperties
                      key={`fill:${inspectorElementSectionKey}`}
                      element={
                        stateResolvedInspectorElement ?? inspectorElement
                      }
                      onStyleChange={onStyleChange}
                      onStylesChange={onStylesChange}
                      capturedStyleTargets={capturedStyleTargets}
                      documentColorPalette={documentColorPalette}
                      glslShaderContext={glslShaderContext}
                      motionKeyframeContext={motionKeyframeFieldContext}
                      breakpointOverrideContext={breakpointOverrideFieldContext}
                      hideAddFill={selectionIsTextOnly}
                    />
                  )}
                  <StrokeProperties
                    key={`stroke:${inspectorElementSectionKey}`}
                    element={stateResolvedInspectorElement ?? inspectorElement}
                    onStyleChange={onStyleChange}
                    onStylesChange={onStylesChange}
                    motionKeyframeContext={motionKeyframeFieldContext}
                    breakpointOverrideContext={breakpointOverrideFieldContext}
                  />
                  <EffectsProperties
                    key={`effects:${inspectorElementSectionKey}`}
                    element={stateResolvedInspectorElement ?? inspectorElement}
                    onStyleChange={onStyleChange}
                    onStylesChange={onStylesChange}
                    glslShaderContext={glslShaderContext}
                    motionKeyframeContext={motionKeyframeFieldContext}
                  />
                  <SelectionColorsProperties
                    elements={effectiveSelectedElements}
                    scopes={selectionColorScopes}
                    onColorTarget={onSelectionColorTarget}
                    canSelectColorTarget={canSelectSelectionColorTarget}
                    onColorPickerOpenChange={onSelectionColorPickerOpenChange}
                    onColorChange={
                      readOnly || interactionState
                        ? undefined
                        : onSelectionColorChange
                    }
                  />
                  {selectionHasContainerElement ? (
                    <LayoutGuideProperties
                      element={
                        stateResolvedInspectorElement ?? inspectorElement
                      }
                      onStyleChange={onStyleChange}
                    />
                  ) : null}
                </>
              )}
              {/* Export acts on a selection. With nothing selected there is
                  nothing to export, so the section was pure chrome on the
                  empty-canvas panel. */}
              {onExport && (inspectorElement || selectedScreenGeometry) ? (
                <PanelSection title={t("editPanel.sections.export")}>
                  <ExportSettingsPanel
                    key={selectedElementKey}
                    value={exportSettings}
                    formats={["png", "svg", "pdf"]}
                    exporting={exporting}
                    onChange={(patch) =>
                      setExportSettings((current) => ({ ...current, ...patch }))
                    }
                    onExport={onExport}
                  />
                  {/* Distinct from the settings panel's key: two siblings
                      sharing one key makes React duplicate the panel on every
                      re-render, so the section grows an Export block per tick. */}
                  <ExportPreviewDisclosure
                    key={`${selectedElementKey}:preview`}
                    element={inspectorElement}
                    onRender={onRenderExportPreview}
                  />
                </PanelSection>
              ) : null}

              {/* §6.5 Review — contextual section in Design tab.
                Renders when reviewPanelProps is provided; no designId check
                needed since ReviewPanel is statically fed. */}
              {reviewPanelProps ? (
                <PanelSection
                  title={"Review" /* i18n-ignore design inspector section */}
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
        ) : resolvedActiveTab === "tweaks" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="h-10 shrink-0 border-b border-border/90 px-2">
              <InspectorGrid
                className="h-full items-center"
                layout="header-actions"
              >
                <InspectorGridCell span={24}>
                  <h3 className="design-sidebar-context-title min-w-0 truncate text-foreground">
                    {t("designEditor.tweaks")}
                  </h3>
                </InspectorGridCell>
                <InspectorGridCell span={4}>
                  <InspectorActionRail>
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
                        <TooltipContent>
                          {t("designEditor.addTweaks")}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </InspectorActionRail>
                </InspectorGridCell>
              </InspectorGrid>
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
        ) : resolvedActiveTab === "code" ? (
          <CodeInspectPanel
            data={inspectCode}
            element={inspectorElement}
            screen={selectedScreenGeometry}
          />
        ) : resolvedActiveTab === "comments" && reviewCommentsPanelProps ? (
          <ReviewCommentsPanel {...reviewCommentsPanelProps} />
        ) : null}
        {import.meta.env.DEV &&
        resolvedActiveTab === "design" &&
        inspectorGridDebug ? (
          <div
            className="design-inspector-grid-debug-overlay"
            data-inspector-grid-debug-overlay
            aria-hidden="true"
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
});
