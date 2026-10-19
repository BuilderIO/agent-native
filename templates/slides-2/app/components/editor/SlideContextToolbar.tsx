import { useT } from "@agent-native/core/client/i18n";
import {
  FONT_FAMILY_OPTIONS,
  VisualFontFamilyPicker,
  VisualColorPicker,
  VisualControlRow,
  VisualScrubInput,
  VisualSegmentedControl,
  displayFontFamilyName,
  resolveFontFamilySelectValue,
  sortFontFamilyOptions,
} from "@agent-native/toolkit/design-tweaks";
import type { DesignSystemData } from "@shared/api";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconAngle,
  IconArrowsLeftRight,
  IconArrowsUpDown,
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconBold,
  IconBorderRadius,
  IconBorderStyle,
  IconBoxMultiple,
  IconBolt,
  IconChevronDown,
  IconClearFormatting,
  IconCode,
  IconDots,
  IconFrame,
  IconEyeglass,
  IconGridDots,
  IconItalic,
  IconLanguage,
  IconLayersSubtract,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLetterCase,
  IconLineHeight,
  IconLink,
  IconList,
  IconListNumbers,
  IconLock,
  IconLockOpen,
  IconMessageCircle,
  IconPalette,
  IconPhoto,
  IconPhotoPlus,
  IconRobot,
  IconSpacingHorizontal,
  IconSpacingVertical,
  IconSparkles,
  IconSquare,
  IconStack2,
  IconStrikethrough,
  IconTextResize,
  IconUnderline,
  IconUnlink,
  IconVideo,
} from "@tabler/icons-react";
import { useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContextToolbarQuickPick } from "@/lib/editor-agent-handoff";
import type { VideoPlaybackSettings } from "@/lib/slide-video";
import { cn, normalizeLinkHref, shortcutLabel } from "@/lib/utils";

import type { SlideListKind } from "./list-editing";
import type {
  SlideObjectAlignment,
  SlideObjectDistribution,
  SlideObjectZOrderTarget,
} from "./slide-object-interactions";
import {
  backgroundCssValue,
  formatValue,
  horizontalAlignPatch,
  resolveHorizontalAlignment,
  resolveVerticalAlignment,
  tokenPalette,
  verticalAlignPatch,
  type SlideStylePatch,
  type SlideStyleSnapshot,
} from "./slide-style";

const TOOLBAR_DIVIDER = "mx-1 h-4 w-px shrink-0 bg-border";
const SCRUB_CLASS = "w-24 shrink-0";
const DIMENSION_CLASS = "w-[76px] shrink-0";
const SIZE_SCRUB_CLASS = "w-28 shrink-0 gap-0.5";
const MENU_BUTTON_CLASS =
  "size-7 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground";
const TOGGLE_ACTIVE_CLASS = "bg-accent text-foreground";
const MENU_TRIGGER_BASE =
  "flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ICON_MENU_CLASS = `${MENU_TRIGGER_BASE} text-muted-foreground hover:text-foreground`;
const MINI_TRIGGER_CLASS =
  "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CARET_CLASS =
  "size-0 shrink-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-muted-foreground/70";
const inlineEditSurfaceProps = {
  "data-slide-inline-edit-surface": "true",
};

type Translate = ReturnType<typeof useT>;

function textAlignOptions(t: Translate) {
  return [
    { label: t("styleInspector.left"), value: "left", icon: IconAlignLeft },
    {
      label: t("styleInspector.center"),
      value: "center",
      icon: IconAlignCenter,
    },
    { label: t("styleInspector.right"), value: "right", icon: IconAlignRight },
    {
      label: t("styleInspector.justify"),
      value: "justify",
      icon: IconAlignJustified,
    },
  ];
}

function alignIcon(textAlign: string) {
  if (textAlign === "center") return IconAlignCenter;
  if (textAlign === "right") return IconAlignRight;
  if (textAlign === "justify") return IconAlignJustified;
  return IconAlignLeft;
}

type StyleScrubProps = {
  snapshot: SlideStyleSnapshot;
  onChange: (patch: SlideStylePatch) => boolean | void;
  className?: string;
};

function OpacityScrub({ snapshot, onChange, className }: StyleScrubProps) {
  const t = useT();
  return (
    <VisualScrubInput
      label={t("styleInspector.opacity")}
      icon={IconGridDots}
      prefix="icon"
      value={snapshot.opacity}
      min={0}
      max={100}
      step={5}
      unit="%"
      className={className}
      onChange={(opacity) => onChange({ opacity: String(opacity / 100) })}
    />
  );
}

function CornerRadiusScrub({ snapshot, onChange, className }: StyleScrubProps) {
  const t = useT();
  return (
    <VisualScrubInput
      label={t("styleInspector.cornerRadius")}
      icon={IconBorderRadius}
      prefix="icon"
      value={snapshot.borderRadius}
      min={0}
      max={96}
      unit="px"
      className={className}
      onChange={(radius) =>
        onChange({ borderRadius: `${formatValue(radius)}px` })
      }
    />
  );
}

function Divider() {
  return <div className={TOOLBAR_DIVIDER} />;
}

function ToolbarButton({
  label,
  shortcut,
  active,
  className,
  children,
  ...props
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
} & Omit<ComponentProps<typeof Button>, "aria-label">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            MENU_BUTTON_CLASS,
            active && TOGGLE_ACTIVE_CLASS,
            className,
          )}
          aria-label={label}
          aria-pressed={active}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {shortcut ? `${label} (${shortcut})` : label}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolbarMenu({
  label,
  icon: Icon,
  caret = false,
  width = "w-40",
  triggerClassName,
  children,
}: {
  label: string;
  icon: typeof IconDots;
  caret?: boolean;
  width?: string;
  triggerClassName?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(ICON_MENU_CLASS, triggerClassName)}
              aria-label={label}
            >
              <Icon className="size-4" />
              {caret && <span aria-hidden="true" className={CARET_CLASS} />}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className={width}
        {...inlineEditSurfaceProps}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SlideContextToolbar({
  snapshot,
  background,
  designSystem,
  className,
  leading,
  animationsOpen = false,
  hasSelectedElement = Boolean(snapshot),
  onOpenAnimations,
  canComment = false,
  onComment,
  onChange,
  onEnablePositioning,
  onBackgroundChange,
  onArrange,
  onGroup,
  onUngroup,
  onToggleList,
  objectSelectionCount = 0,
  canGroup = false,
  canUngroup = false,
  onAlignObjects,
  onDistributeObjects,
  videoPlayback,
  onVideoPlaybackChange,
  zoomControls,
  layersOpen = false,
  onToggleLayers,
  imageFit,
  onReplaceImage,
  onImageFitChange,
  inlineFormatting = false,
  onTextFormat,
  onSetLink,
  onOpenAgent,
  onAgentQuickPick,
}: {
  snapshot: SlideStyleSnapshot | null;
  background: string | undefined;
  designSystem?: DesignSystemData;
  className?: string;
  leading?: ReactNode;
  hasSelectedElement?: boolean;
  animationsOpen?: boolean;
  onOpenAnimations?: () => void;
  canComment?: boolean;
  onComment?: () => void;
  /** False when the patch was refused: the object paints what it did before. */
  onChange: (patch: SlideStylePatch) => boolean | void;
  onEnablePositioning?: () => void;
  onBackgroundChange: (background: string) => void;
  onArrange?: (target: SlideObjectZOrderTarget) => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onToggleList?: (kind: SlideListKind) => void;
  objectSelectionCount?: number;
  canGroup?: boolean;
  canUngroup?: boolean;
  onAlignObjects?: (alignment: SlideObjectAlignment) => void;
  onDistributeObjects?: (distribution: SlideObjectDistribution) => void;
  videoPlayback?: VideoPlaybackSettings | null;
  onVideoPlaybackChange?: (settings: VideoPlaybackSettings) => void;
  layersOpen?: boolean;
  onToggleLayers?: () => void;
  imageFit?: "cover" | "contain";
  onReplaceImage?: () => void;
  onImageFitChange?: (fit: "cover" | "contain") => void;
  /** Code and link only exist inside a live text edit. */
  inlineFormatting?: boolean;
  onTextFormat?: (format: "code") => void;
  onSetLink?: (href: string | null) => void;
  onOpenAgent?: () => void;
  onAgentQuickPick?: (pick: ContextToolbarQuickPick) => void;
  zoomControls?: {
    value: number;
    presets: readonly number[];
    onSelect: (value: number) => void;
  };
}) {
  const t = useT();
  // The field holds what was typed until the object paints it; a refused
  // rotation never will, so the field starts over from what the object paints.
  const [refusedRotations, setRefusedRotations] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  // Start each open from the selected text's own link, never the last URL typed.
  const openLinkPopover = (open: boolean) => {
    if (open) {
      const node = window.getSelection()?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      setLinkHref(element?.closest("a[href]")?.getAttribute("href") ?? "");
    }
    setLinkOpen(open);
  };
  const [lockRatio, setLockRatio] = useState(false);
  const documentColors = tokenPalette(designSystem, t).map(
    (option) => option.value,
  );
  const baseFontFamilyOptions = sortFontFamilyOptions(
    FONT_FAMILY_OPTIONS.map((option) => ({
      value: option.value,
      label:
        option.label ??
        (option.key
          ? t(`styleInspector.fontFamilies.${option.key}`)
          : displayFontFamilyName(option.value)),
    })),
  );
  const mixedTextStyles = snapshot?.mixedTextStyles ?? [];
  const fontFamilyIsMixed = mixedTextStyles.includes("fontFamily");
  const fontFamily = snapshot
    ? resolveFontFamilySelectValue(snapshot.fontFamily)
    : "sans-serif";
  const fontFamilyOptions = sortFontFamilyOptions(
    !snapshot ||
      fontFamilyIsMixed ||
      baseFontFamilyOptions.some((option) => option.value === fontFamily)
      ? baseFontFamilyOptions
      : [
          {
            value: fontFamily,
            label: displayFontFamilyName(snapshot.fontFamily || fontFamily),
          },
          ...baseFontFamilyOptions,
        ],
  );
  const isItalic =
    !mixedTextStyles.includes("fontStyle") &&
    (snapshot?.fontStyle ?? "").startsWith("italic");
  const sizeFor = (value: number, meta?: { relativeDelta?: number }) => {
    const delta = meta?.relativeDelta;
    if (typeof delta !== "number") return value;
    return Math.min(160, Math.max(8, (snapshot?.fontSize ?? 0) + delta));
  };
  const decorationMixed = mixedTextStyles.includes("textDecoration");
  const decoration = decorationMixed ? "" : (snapshot?.textDecoration ?? "");
  const isUnderline = decoration.includes("underline");
  const isStrike = decoration.includes("line-through");
  const decorationPatch = (
    token: "underline" | "line-through",
    on: boolean,
  ) => {
    if (decorationMixed) return token;
    const tokens = decoration
      .split(/\s+/)
      .filter((existing) => existing && existing !== "none");
    const next = on
      ? tokens.filter((existing) => existing !== token)
      : [...tokens, token];
    return next.length > 0 ? next.join(" ") : "none";
  };
  const isBold =
    !mixedTextStyles.includes("fontWeight") &&
    Number(snapshot?.fontWeight ?? 400) >= 600;
  const slideBackground = backgroundCssValue(background);
  const hasMultiObjectSelection = objectSelectionCount >= 2;
  const canDistributeObjects = objectSelectionCount >= 3;
  const isVideoSelection = snapshot?.tagName?.toLowerCase() === "video";
  const isDefaultState =
    !snapshot && !hasSelectedElement && !hasMultiObjectSelection;
  const kind = hasMultiObjectSelection
    ? "multi"
    : !snapshot
      ? null
      : snapshot.isText
        ? "text"
        : isVideoSelection
          ? "video"
          : snapshot.isImage
            ? "image"
            : "shape";
  const showGroupControls = hasMultiObjectSelection || canGroup || canUngroup;
  const quickPicks: {
    pick: ContextToolbarQuickPick;
    label: string;
    icon: typeof IconSparkles;
  }[] =
    kind === "text"
      ? [
          {
            pick: "tightenTone",
            label: t("contextToolbar.tightenTone"),
            icon: IconEyeglass,
          },
          {
            pick: "polish",
            label: t("contextToolbar.polish"),
            icon: IconSparkles,
          },
          {
            pick: "translate",
            label: t("contextToolbar.translate"),
            icon: IconLanguage,
          },
          {
            pick: "makeMoreVisual",
            label: t("contextToolbar.makeMoreVisual"),
            icon: IconPalette,
          },
        ]
      : kind === "image"
        ? [
            {
              pick: "generateImage",
              label: t("contextToolbar.generateImage"),
              icon: IconPhotoPlus,
            },
            {
              pick: "removeBackground",
              label: t("contextToolbar.removeBackground"),
              icon: IconSquare,
            },
          ]
        : [];

  const opacityControl = snapshot && (
    <OpacityScrub
      snapshot={snapshot}
      onChange={onChange}
      className={SCRUB_CLASS}
    />
  );
  const radiusControl = snapshot && (
    <CornerRadiusScrub
      snapshot={snapshot}
      onChange={onChange}
      className={SCRUB_CLASS}
    />
  );
  const sizeControls = snapshot && (
    <>
      <VisualScrubInput
        label={t("styleInspector.width")}
        icon={IconArrowAutofitWidth}
        prefix="icon"
        value={snapshot.width}
        min={0}
        unit="px"
        className={DIMENSION_CLASS}
        onChange={(width) =>
          onChange({
            width: `${formatValue(width)}px`,
            ...(lockRatio && snapshot.width > 0
              ? {
                  height: `${formatValue((width * snapshot.height) / snapshot.width)}px`,
                }
              : {}),
          })
        }
      />
      <ToolbarButton
        label={t("contextToolbar.lockAspectRatio")}
        active={lockRatio}
        className="size-6"
        onClick={() => setLockRatio((locked) => !locked)}
      >
        {lockRatio ? (
          <IconLock className="size-3.5" />
        ) : (
          <IconLockOpen className="size-3.5" />
        )}
      </ToolbarButton>
      <VisualScrubInput
        label={t("styleInspector.height")}
        icon={IconArrowAutofitHeight}
        prefix="icon"
        value={snapshot.height}
        min={0}
        unit="px"
        className={DIMENSION_CLASS}
        onChange={(height) =>
          onChange({
            height: `${formatValue(height)}px`,
            ...(lockRatio && snapshot.height > 0
              ? {
                  width: `${formatValue((height * snapshot.width) / snapshot.height)}px`,
                }
              : {}),
          })
        }
      />
    </>
  );
  // An unreadable rotation shows as mixed and cannot be edited; its value is never shown or written.
  const rotationControl = snapshot?.isAbsolute && (
    <VisualScrubInput
      key={refusedRotations}
      label={t("styleInspector.rotation")}
      icon={IconAngle}
      prefix="icon"
      value={snapshot.rotation ?? 0}
      unit="°"
      mixed={snapshot.rotation === null}
      mixedLabel={t("styleInspector.mixed")}
      disabled={snapshot.rotation === null}
      className={SCRUB_CLASS}
      onChange={(rotation, meta) => {
        if (onChange({ rotation }) === false && meta.phase === "commit") {
          setRefusedRotations((count) => count + 1);
        }
      }}
    />
  );

  const orderMenu = onArrange && (
    <ToolbarMenu label={t("contextToolbar.order")} icon={IconStack2} caret>
      <DropdownMenuItem onSelect={() => onArrange("front")}>
        {t("styleInspector.bringToFront")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onArrange("forward")}>
        {t("styleInspector.bringForward")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onArrange("backward")}>
        {t("styleInspector.sendBackward")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onArrange("back")}>
        {t("styleInspector.sendToBack")}
      </DropdownMenuItem>
    </ToolbarMenu>
  );

  const positionPopover = snapshot &&
    (snapshot.isAbsolute ||
      (objectSelectionCount < 2 && onEnablePositioning)) && (
      <Popover
        onOpenChange={(open) => {
          if (open && !snapshot.isAbsolute) onEnablePositioning?.();
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={MENU_BUTTON_CLASS}
                aria-label={t("styleInspector.position")}
              >
                <IconLayoutAlignLeft className="size-3.5" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("styleInspector.position")}</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="start"
          className="w-60 space-y-2 p-2"
          {...inlineEditSurfaceProps}
        >
          {snapshot.isAbsolute && (
            <>
              <VisualControlRow label={t("styleInspector.horizontal")}>
                <VisualSegmentedControl
                  value={resolveHorizontalAlignment(snapshot)}
                  onChange={(alignment) =>
                    onChange(horizontalAlignPatch(snapshot, alignment))
                  }
                  className="slides-inspector-segment"
                  options={[
                    { label: t("styleInspector.left"), value: "left" },
                    { label: t("styleInspector.center"), value: "center" },
                    { label: t("styleInspector.right"), value: "right" },
                  ]}
                />
              </VisualControlRow>
              <VisualControlRow label={t("styleInspector.vertical")}>
                <VisualSegmentedControl
                  value={resolveVerticalAlignment(snapshot)}
                  onChange={(alignment) =>
                    onChange(verticalAlignPatch(snapshot, alignment))
                  }
                  className="slides-inspector-segment"
                  options={[
                    { label: t("styleInspector.top"), value: "top" },
                    { label: t("styleInspector.middle"), value: "middle" },
                    { label: t("styleInspector.bottom"), value: "bottom" },
                  ]}
                />
              </VisualControlRow>
            </>
          )}
        </PopoverContent>
      </Popover>
    );

  const controlsPopover = snapshot && (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={MENU_BUTTON_CLASS}
              aria-label={t("styleInspector.controls")}
            >
              {snapshot.isText ? (
                <IconTextResize className="size-4" />
              ) : (
                <IconDots className="size-3.5" />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("styleInspector.controls")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-64 space-y-3 p-2"
        {...inlineEditSurfaceProps}
      >
        {snapshot.isText && (
          <>
            <div className="grid grid-cols-2 gap-2">{sizeControls}</div>
            {rotationControl}
          </>
        )}

        {snapshot.isAbsolute && (
          <div className="grid grid-cols-2 gap-2">
            <VisualScrubInput
              label={t("styleInspector.x")}
              icon={null}
              labelClassName="w-8 justify-center"
              value={snapshot.x}
              unit="px"
              onChange={(x) => onChange({ left: `${formatValue(x)}px` })}
            />
            <VisualScrubInput
              label={t("styleInspector.y")}
              icon={null}
              labelClassName="w-8 justify-center"
              value={snapshot.y}
              unit="px"
              onChange={(y) => onChange({ top: `${formatValue(y)}px` })}
            />
          </div>
        )}

        {(snapshot.isText || snapshot.isImage) && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {snapshot.isText && opacityControl}
              {radiusControl}
            </div>
            <VisualControlRow label={t("styleInspector.fill")}>
              <VisualColorPicker
                label={t("styleInspector.fill")}
                value={snapshot.backgroundColor}
                documentColors={documentColors}
                allowTransparent
                variant="filled"
                className="rounded-sm"
                contentProps={inlineEditSurfaceProps}
                onChange={(value) => onChange({ backgroundColor: value })}
              />
            </VisualControlRow>
            <VisualControlRow label={t("styleInspector.strokeColor")}>
              <VisualColorPicker
                label={t("styleInspector.strokeColor")}
                value={snapshot.borderColor}
                documentColors={documentColors}
                variant="filled"
                className="rounded-sm"
                contentProps={inlineEditSurfaceProps}
                onChange={(value) => onChange({ borderColor: value })}
              />
            </VisualControlRow>
          </>
        )}

        <VisualScrubInput
          label={t("styleInspector.strokeWeight")}
          icon={IconBorderStyle}
          prefix="icon"
          value={snapshot.borderWidth}
          min={0}
          max={16}
          unit="px"
          onChange={(width) =>
            onChange({ borderWidth: `${formatValue(width)}px` })
          }
        />

        {!snapshot.isImage && (
          <div className="grid grid-cols-2 gap-2">
            <VisualScrubInput
              label={t("styleInspector.horizontal")}
              icon={IconSpacingHorizontal}
              prefix="icon"
              value={snapshot.paddingX}
              min={0}
              max={120}
              step={2}
              unit="px"
              onChange={(padding) =>
                onChange({
                  paddingLeft: `${formatValue(padding)}px`,
                  paddingRight: `${formatValue(padding)}px`,
                })
              }
            />
            <VisualScrubInput
              label={t("styleInspector.vertical")}
              icon={IconSpacingVertical}
              prefix="icon"
              value={snapshot.paddingY}
              min={0}
              max={120}
              step={2}
              unit="px"
              onChange={(padding) =>
                onChange({
                  paddingTop: `${formatValue(padding)}px`,
                  paddingBottom: `${formatValue(padding)}px`,
                })
              }
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  const textRow = snapshot?.isText && (
    <>
      <VisualFontFamilyPicker
        label={t("styleInspector.fontFamily")}
        value={fontFamily}
        options={fontFamilyOptions}
        mixed={fontFamilyIsMixed}
        mixedLabel={t("styleInspector.mixed")}
        className={cn(
          MENU_TRIGGER_BASE,
          "h-8 w-[126px] justify-between border border-input bg-background px-2.5 text-sm font-normal shadow-none focus:ring-0 focus:ring-offset-0",
        )}
        contentProps={inlineEditSurfaceProps}
        onChange={(value) => onChange({ fontFamily: value })}
      />
      <VisualScrubInput
        label={t("styleInspector.size")}
        icon={IconLetterCase}
        prefix="icon"
        steppers
        decrementLabel={t("styleInspector.decreaseSize")}
        incrementLabel={t("styleInspector.increaseSize")}
        value={snapshot.fontSize}
        min={8}
        max={160}
        unit="px"
        mixed={mixedTextStyles.includes("fontSize")}
        mixedLabel={t("styleInspector.mixed")}
        className={SIZE_SCRUB_CLASS}
        onChange={(fontSize, meta) =>
          onChange({ fontSize: `${formatValue(sizeFor(fontSize, meta))}px` })
        }
      />
      <Divider />
      <VisualColorPicker
        label={t("styleInspector.textColor")}
        value={snapshot.color}
        documentColors={documentColors}
        mixed={mixedTextStyles.includes("color")}
        mixedLabel={t("styleInspector.mixed")}
        variant="swatch"
        glyph="A"
        contentProps={inlineEditSurfaceProps}
        onChange={(value) => onChange({ color: value })}
      />
      <ToolbarButton
        label={t("contextToolbar.bold")}
        shortcut={shortcutLabel("cmd+b")}
        active={isBold}
        onClick={() => onChange({ fontWeight: isBold ? "400" : "700" })}
      >
        <IconBold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("styleInspector.italic")}
        shortcut={shortcutLabel("cmd+i")}
        active={isItalic}
        onClick={() => onChange({ fontStyle: isItalic ? "normal" : "italic" })}
      >
        <IconItalic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("styleInspector.underline")}
        shortcut={shortcutLabel("cmd+u")}
        active={isUnderline}
        onClick={() =>
          onChange({
            textDecoration: decorationPatch("underline", isUnderline),
          })
        }
      >
        <IconUnderline className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("contextToolbar.strikethrough")}
        active={isStrike}
        onClick={() =>
          onChange({
            textDecoration: decorationPatch("line-through", isStrike),
          })
        }
      >
        <IconStrikethrough className="size-4" />
      </ToolbarButton>
      {onTextFormat && (
        <ToolbarButton
          label={t("contextToolbar.code")}
          disabled={!inlineFormatting}
          onClick={() => onTextFormat("code")}
        >
          <IconCode className="size-4" />
        </ToolbarButton>
      )}
      <ToolbarButton
        label={t("contextToolbar.removeFormatting")}
        onClick={() =>
          onChange({
            fontWeight: "",
            fontStyle: "",
            textDecoration: "",
          })
        }
      >
        <IconClearFormatting className="size-4" />
      </ToolbarButton>
      <Divider />
      {onSetLink && (
        <>
          <Popover open={linkOpen} onOpenChange={openLinkPopover}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={MENU_BUTTON_CLASS}
                    aria-label={t("contextToolbar.link")}
                    disabled={!inlineFormatting}
                  >
                    <IconLink className="size-4" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("contextToolbar.link")}</TooltipContent>
            </Tooltip>
            <PopoverContent
              align="start"
              className="w-64 p-2"
              {...inlineEditSurfaceProps}
            >
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSetLink(normalizeLinkHref(linkHref));
                  setLinkOpen(false);
                }}
              >
                <Input
                  value={linkHref}
                  onChange={(event) => setLinkHref(event.target.value)}
                  placeholder="https://"
                  aria-label={t("contextToolbar.link")}
                  className="h-7 text-xs"
                />
                <Button type="submit" size="sm" className="h-7 px-2 text-xs">
                  {t("contextToolbar.applyLink")}
                </Button>
              </form>
            </PopoverContent>
          </Popover>
          <Divider />
        </>
      )}
      {onToggleList && (
        <ToolbarMenu
          label={t("contextToolbar.listStyle")}
          icon={IconList}
          caret
        >
          <DropdownMenuItem
            className={cn(snapshot.listKind === "bullet" && "bg-accent")}
            aria-current={snapshot.listKind === "bullet"}
            onSelect={() => onToggleList("bullet")}
          >
            <IconList className="size-4" />
            {t("styleInspector.bulletList")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={cn(snapshot.listKind === "ordered" && "bg-accent")}
            aria-current={snapshot.listKind === "ordered"}
            onSelect={() => onToggleList("ordered")}
          >
            <IconListNumbers className="size-4" />
            {t("styleInspector.numberedList")}
          </DropdownMenuItem>
        </ToolbarMenu>
      )}
      <ToolbarMenu
        label={t("styleInspector.align")}
        icon={alignIcon(snapshot.textAlign)}
        caret
        width="w-36"
      >
        {textAlignOptions(t).map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange({ textAlign: option.value })}
          >
            <option.icon className="size-4" />
            {option.label}
          </DropdownMenuItem>
        ))}
      </ToolbarMenu>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={MENU_BUTTON_CLASS}
                aria-label={t("contextToolbar.lineHeight")}
              >
                <IconLineHeight className="size-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("contextToolbar.lineHeight")}</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="start"
          className="w-44 p-2"
          {...inlineEditSurfaceProps}
        >
          <VisualScrubInput
            label={t("styleInspector.line")}
            icon={IconLineHeight}
            prefix="icon"
            value={snapshot.lineHeight}
            min={0.8}
            max={3}
            step={0.05}
            onChange={(lineHeight) =>
              onChange({ lineHeight: formatValue(lineHeight) })
            }
          />
        </PopoverContent>
      </Popover>
      {!hasMultiObjectSelection && (
        <>
          <Divider />
          {positionPopover}
          {orderMenu}
          {controlsPopover}
        </>
      )}
    </>
  );

  const objectRow = snapshot && !snapshot.isText && (
    <>
      {kind === "multi" ? (
        opacityControl
      ) : (
        <>
          {sizeControls}
          <Divider />
          {rotationControl}
          {rotationControl && <Divider />}
          {kind === "shape" && (
            <>
              <VisualColorPicker
                label={t("styleInspector.fill")}
                value={snapshot.backgroundColor}
                documentColors={documentColors}
                allowTransparent
                variant="swatch"
                contentProps={inlineEditSurfaceProps}
                onChange={(value) => onChange({ backgroundColor: value })}
              />
              <VisualColorPicker
                label={t("styleInspector.strokeColor")}
                value={snapshot.borderColor}
                documentColors={documentColors}
                variant="swatch"
                contentProps={inlineEditSurfaceProps}
                onChange={(value) => onChange({ borderColor: value })}
              />
            </>
          )}
          {opacityControl}
          {kind === "image" ? (
            <>
              <Divider />
              {onImageFitChange && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(MINI_TRIGGER_CLASS, "w-16 justify-between")}
                      aria-label={t("contextToolbar.fit")}
                    >
                      {imageFit === "cover"
                        ? t("contextToolbar.fitCover")
                        : t("contextToolbar.fitContain")}
                      <IconChevronDown className="size-2.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-24"
                    {...inlineEditSurfaceProps}
                  >
                    <DropdownMenuItem
                      onSelect={() => onImageFitChange("contain")}
                    >
                      {t("contextToolbar.fitContain")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => onImageFitChange("cover")}
                    >
                      {t("contextToolbar.fitCover")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {onReplaceImage && (
                <button
                  type="button"
                  className={cn(MENU_TRIGGER_BASE, "gap-1.5 font-normal")}
                  onClick={onReplaceImage}
                >
                  <IconPhoto className="size-3.5" />
                  {t("contextToolbar.replaceImage")}
                </button>
              )}
            </>
          ) : (
            radiusControl
          )}
          {kind === "video" && onVideoPlaybackChange && videoPlayback && (
            <>
              <Divider />
              <Label className="flex shrink-0 items-center gap-2 text-[11px] font-medium">
                <span>{t("editorToolbar.autoplayVideo")}</span>
                <Switch
                  checked={videoPlayback.mode === "autoplay"}
                  onCheckedChange={(checked) =>
                    onVideoPlaybackChange({
                      ...videoPlayback,
                      mode: checked ? "autoplay" : "click",
                    })
                  }
                />
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={MENU_BUTTON_CLASS}
                    aria-label={t("editorToolbar.videoPlayback")}
                  >
                    <IconVideo className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-56"
                  {...inlineEditSurfaceProps}
                >
                  <Label className="flex items-center justify-between gap-4">
                    <span>{t("editorToolbar.loopVideo")}</span>
                    <Switch
                      checked={videoPlayback.loop}
                      onCheckedChange={(loop) =>
                        onVideoPlaybackChange({ ...videoPlayback, loop })
                      }
                    />
                  </Label>
                </PopoverContent>
              </Popover>
            </>
          )}
        </>
      )}
    </>
  );

  const alignControls = (
    <>
      {hasMultiObjectSelection ? (
        <>
          <ToolbarMenu
            label={t("styleInspector.align")}
            icon={IconLayoutAlignLeft}
            width="w-44"
          >
            {(
              [
                ["left", IconLayoutAlignLeft, "left"],
                ["center", IconLayoutAlignCenter, "center"],
                ["right", IconLayoutAlignRight, "right"],
                ["top", IconLayoutAlignTop, "top"],
                ["middle", IconLayoutAlignMiddle, "middle"],
                ["bottom", IconLayoutAlignBottom, "bottom"],
              ] as const
            ).map(([alignment, AlignIcon, labelKey]) => (
              <DropdownMenuItem
                key={alignment}
                onSelect={() => onAlignObjects?.(alignment)}
              >
                <AlignIcon className="size-4" />
                {t(`styleInspector.${labelKey}`)}
              </DropdownMenuItem>
            ))}
          </ToolbarMenu>
          <ToolbarMenu
            label={t("styleInspector.distribute")}
            icon={IconArrowsLeftRight}
            width="w-52"
          >
            <DropdownMenuItem
              disabled={!canDistributeObjects}
              onSelect={() => onDistributeObjects?.("horizontal")}
            >
              <IconArrowsLeftRight className="size-4" />
              {t("styleInspector.horizontal")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canDistributeObjects}
              onSelect={() => onDistributeObjects?.("vertical")}
            >
              <IconArrowsUpDown className="size-4" />
              {t("styleInspector.vertical")}
            </DropdownMenuItem>
          </ToolbarMenu>
        </>
      ) : (
        positionPopover
      )}
      {orderMenu}
    </>
  );

  const groupControls = (
    <>
      {showGroupControls && (
        <>
          {onGroup && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
              disabled={!canGroup}
              onClick={onGroup}
            >
              <IconBoxMultiple className="size-3" />
              {t("styleInspector.group")}
            </Button>
          )}
          {onUngroup && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground"
              disabled={!canUngroup}
              onClick={onUngroup}
            >
              <IconUnlink className="size-3" />
              {t("styleInspector.ungroup")}
            </Button>
          )}
        </>
      )}
    </>
  );

  const agentButtonClass =
    "flex h-6 shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-md px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div
      className={cn(
        "slide-context-toolbar flex h-11 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap bg-transparent px-2 sm:px-4",
        className,
      )}
      data-slide-context-toolbar="true"
      role="toolbar"
      aria-label={t("styleInspector.title")}
    >
      {leading && isDefaultState && (
        <>
          {leading}
          <Divider />
        </>
      )}
      {hasMultiObjectSelection && (
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <IconFrame className="size-3.5" />
          {t("contextToolbar.objectsSelected", {
            count: objectSelectionCount,
          })}
        </span>
      )}
      {hasMultiObjectSelection && <Divider />}
      {!snapshot ? (
        hasMultiObjectSelection ? null : (
          <VisualColorPicker
            label={t("styleInspector.slideBackground")}
            value={slideBackground ?? ""}
            mixed={slideBackground === null}
            mixedLabel={t("styleInspector.mixed")}
            documentColors={documentColors}
            variant="swatch"
            contentProps={inlineEditSurfaceProps}
            onChange={onBackgroundChange}
          />
        )
      ) : (
        <>
          {textRow}
          {objectRow}
        </>
      )}
      {(hasMultiObjectSelection || (snapshot && !snapshot.isText)) && (
        <>
          <Divider />
          {alignControls}
        </>
      )}
      {showGroupControls && <Divider />}
      {groupControls}
      {snapshot && !snapshot.isText && !hasMultiObjectSelection && (
        <>
          <Divider />
          {controlsPopover}
        </>
      )}
      {!snapshot &&
        hasSelectedElement &&
        objectSelectionCount === 0 &&
        onEnablePositioning && (
          <>
            <Divider />
            <ToolbarButton
              label={t("styleInspector.position")}
              onClick={onEnablePositioning}
            >
              <IconLayoutAlignLeft className="size-3.5" />
            </ToolbarButton>
          </>
        )}
      {hasSelectedElement && onOpenAnimations && (
        <>
          <Divider />
          <ToolbarButton
            label={t("animations.title")}
            active={animationsOpen}
            onClick={onOpenAnimations}
          >
            <IconBolt className="size-3.5" />
          </ToolbarButton>
        </>
      )}
      {hasSelectedElement && canComment && onComment && (
        <ToolbarButton label={t("comments.addComment")} onClick={onComment}>
          <IconMessageCircle className="size-3.5" />
        </ToolbarButton>
      )}
      {kind && onOpenAgent && (
        <>
          <Divider />
          {quickPicks.length > 0 && onAgentQuickPick ? (
            <DropdownMenu
              onOpenChange={(open) => {
                if (open) onOpenAgent();
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={agentButtonClass}
                      aria-label={t("contextToolbar.editWithAgent")}
                    >
                      <IconRobot className="size-4" />
                      <IconChevronDown className="size-3" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  {t("contextToolbar.editWithAgent")}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="w-44"
                {...inlineEditSurfaceProps}
              >
                {quickPicks.map(({ pick, label, icon: PickIcon }) => (
                  <DropdownMenuItem
                    key={pick}
                    onSelect={() => onAgentQuickPick(pick)}
                  >
                    <PickIcon className="size-4" />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={agentButtonClass}
                  aria-label={t("contextToolbar.editWithAgent")}
                  onClick={onOpenAgent}
                >
                  <IconRobot className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t("contextToolbar.editWithAgent")}
              </TooltipContent>
            </Tooltip>
          )}
        </>
      )}
      {(onToggleLayers || zoomControls) && <div className="ml-auto" />}
      {onToggleLayers && (
        <ToolbarButton
          label={t("editorToolbar.layers")}
          active={layersOpen}
          onClick={onToggleLayers}
        >
          <IconLayersSubtract className="size-4" />
        </ToolbarButton>
      )}
      {zoomControls && (
        <>
          {onToggleLayers && <Divider />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background pl-2.5 pr-2 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("contextToolbar.zoom")}
              >
                <span className="tabular-nums">{zoomControls.value}%</span>
                <IconChevronDown className="size-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-28"
              {...inlineEditSurfaceProps}
            >
              {zoomControls.presets.map((preset) => (
                <DropdownMenuItem
                  key={preset}
                  className={cn(preset === zoomControls.value && "bg-accent")}
                  onSelect={() => zoomControls.onSelect(preset)}
                >
                  {preset}%
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
