import { useT } from "@agent-native/core/client/i18n";
import {
  VisualColorPicker,
  VisualControlRow,
  VisualScrubInput,
  VisualSegmentedControl,
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
  IconBorderRadius,
  IconBorderStyle,
  IconDots,
  IconGridDots,
  IconItalic,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLetterCase,
  IconList,
  IconListNumbers,
  IconSpacingHorizontal,
  IconSpacingVertical,
  IconStackBack,
  IconStackFront,
  IconUnderline,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, shortcutLabel } from "@/lib/utils";

import type { SlideListKind } from "./list-editing";
import type {
  SlideObjectAlignment,
  SlideObjectDistribution,
} from "./slide-object-interactions";
import {
  backgroundCssValue,
  formatValue,
  horizontalAlignPatch,
  resolveHorizontalAlignment,
  resolveVerticalAlignment,
  rotationTransform,
  tokenPalette,
  verticalAlignPatch,
  type SlideStylePatch,
  type SlideStyleSnapshot,
} from "./slide-style";

const TOOLBAR_DIVIDER = "mx-1 h-4 w-px shrink-0 bg-border";
const SCRUB_CLASS = "w-24 shrink-0";
const SIZE_SCRUB_CLASS = "w-28 shrink-0 gap-0.5";
const MENU_BUTTON_CLASS =
  "size-7 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground";
const TOGGLE_ACTIVE_CLASS = "bg-accent text-foreground";
const MENU_TRIGGER_BASE =
  "flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const VALUE_MENU_CLASS = `${MENU_TRIGGER_BASE} min-w-14`;
const ICON_MENU_CLASS = `${MENU_TRIGGER_BASE} text-muted-foreground hover:text-foreground`;
const CARET_CLASS =
  "size-0 shrink-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-muted-foreground/70";

type Translate = ReturnType<typeof useT>;

function fontWeightOptions(t: Translate) {
  return [
    { label: t("styleInspector.regular"), value: "400" },
    { label: t("styleInspector.medium"), value: "500" },
    { label: t("styleInspector.semi"), value: "600" },
    { label: t("styleInspector.bold"), value: "700" },
  ];
}

function weightLabel(fontWeight: string, t: Translate) {
  const match = fontWeightOptions(t).find(
    (option) => option.value === fontWeight,
  );
  return match ? match.label : fontWeight;
}

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

/**
 * Horizontal counterpart to the style dock: the same snapshot and patch
 * callback, presented as a row above the canvas so the slide keeps full width.
 * Controls past the first few live in grouped popovers — a flat row overflows
 * once the agent sidebar and slide rail take their share of the width.
 */
export function SlideContextToolbar({
  snapshot,
  background,
  designSystem,
  className,
  leading,
  onChange,
  onBackgroundChange,
  onArrange,
  onToggleList,
  objectSelectionCount = 0,
  onAlignObjects,
  onDistributeObjects,
  zoomControls,
}: {
  snapshot: SlideStyleSnapshot | null;
  background: string | undefined;
  designSystem?: DesignSystemData;
  className?: string;
  /** Selection-independent actions pinned to the head of the row. */
  leading?: ReactNode;
  onChange: (patch: SlideStylePatch) => void;
  onBackgroundChange: (background: string) => void;
  onArrange?: (target: "front" | "back") => void;
  onToggleList?: (kind: SlideListKind) => void;
  objectSelectionCount?: number;
  onAlignObjects?: (alignment: SlideObjectAlignment) => void;
  onDistributeObjects?: (distribution: SlideObjectDistribution) => void;
  zoomControls?: {
    value: number;
    onZoomOut: () => void;
    onZoomIn: () => void;
    canZoomOut: boolean;
    canZoomIn: boolean;
  };
}) {
  const t = useT();
  const documentColors = tokenPalette(designSystem, t).map(
    (option) => option.value,
  );
  const inlineEditSurfaceProps = {
    "data-slide-inline-edit-surface": "true",
  };
  const mixedTextStyles = snapshot?.mixedTextStyles ?? [];
  // A mixed selection has no single state to reflect, so the toggle reads as
  // off and one click makes the whole selection consistent.
  const isItalic =
    !mixedTextStyles.includes("fontStyle") &&
    (snapshot?.fontStyle ?? "").startsWith("italic");
  // A mixed selection has no single size, so the scrub input reports a step as
  // a relative delta rather than a value. Writing that delta as an absolute
  // size would set the whole selection to a few pixels; step from the block's
  // own size instead, which also makes the selection consistent in one click.
  const sizeFor = (value: number, meta?: { relativeDelta?: number }) => {
    const delta = meta?.relativeDelta;
    if (typeof delta !== "number") return value;
    return Math.min(160, Math.max(8, (snapshot?.fontSize ?? 0) + delta));
  };
  const decorationMixed = mixedTextStyles.includes("textDecoration");
  const isUnderline =
    !decorationMixed && (snapshot?.textDecoration ?? "").includes("underline");
  // Text can carry more than one decoration, and the agent writes
  // line-through even though no control exposes it. Editing the underline
  // token in place keeps the rest; writing a bare "none" would erase them.
  const underlinePatch = () => {
    if (decorationMixed) return "underline";
    const tokens = (snapshot?.textDecoration ?? "")
      .split(/\s+/)
      .filter((token) => token && token !== "none");
    const next = isUnderline
      ? tokens.filter((token) => token !== "underline")
      : [...tokens, "underline"];
    return next.length > 0 ? next.join(" ") : "none";
  };
  // Null means the slide uses a background this picker cannot represent (named
  // utility, gradient); surface that as Mixed rather than guessing a hex.
  const slideBackground = backgroundCssValue(background);
  const hasMultiObjectSelection = objectSelectionCount >= 2;
  const canDistributeObjects = objectSelectionCount >= 3;

  return (
    <div
      className={cn(
        "slide-context-toolbar flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap bg-transparent px-2 sm:px-3",
        className,
      )}
      data-slide-context-toolbar="true"
      role="toolbar"
      aria-label={t("styleInspector.title")}
    >
      {leading && (
        <>
          {leading}
          <div className={TOOLBAR_DIVIDER} />
        </>
      )}
      {hasMultiObjectSelection && (
        <>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={MENU_BUTTON_CLASS}
                    aria-label={t("styleInspector.align")}
                  >
                    <IconLayoutAlignLeft className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("styleInspector.align")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="start"
              className="w-44"
              {...inlineEditSurfaceProps}
            >
              <DropdownMenuItem onSelect={() => onAlignObjects?.("left")}>
                <IconLayoutAlignLeft className="size-4" />
                {t("styleInspector.left")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlignObjects?.("center")}>
                <IconLayoutAlignCenter className="size-4" />
                {t("styleInspector.center")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlignObjects?.("right")}>
                <IconLayoutAlignRight className="size-4" />
                {t("styleInspector.right")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlignObjects?.("top")}>
                <IconLayoutAlignTop className="size-4" />
                {t("styleInspector.top")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlignObjects?.("middle")}>
                <IconLayoutAlignMiddle className="size-4" />
                {t("styleInspector.middle")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlignObjects?.("bottom")}>
                <IconLayoutAlignBottom className="size-4" />
                {t("styleInspector.bottom")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={MENU_BUTTON_CLASS}
                    aria-label={t("styleInspector.distribute")}
                  >
                    <IconArrowsLeftRight className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {`${t("styleInspector.distribute")} (${objectSelectionCount})`}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="start"
              className="w-52"
              {...inlineEditSurfaceProps}
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
            </DropdownMenuContent>
          </DropdownMenu>
          <div className={TOOLBAR_DIVIDER} />
        </>
      )}
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
          {snapshot.isText ? (
            <>
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
                  onChange({
                    fontSize: `${formatValue(sizeFor(fontSize, meta))}px`,
                  })
                }
              />
              <div className={TOOLBAR_DIVIDER} />
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={VALUE_MENU_CLASS}
                        aria-label={t("styleInspector.weight")}
                      >
                        <span className="truncate">
                          {mixedTextStyles.includes("fontWeight")
                            ? t("styleInspector.mixed")
                            : weightLabel(snapshot.fontWeight, t)}
                        </span>
                        <span aria-hidden="true" className={CARET_CLASS} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t("styleInspector.weight")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-36">
                  {fontWeightOptions(t).map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() => onChange({ fontWeight: option.value })}
                    >
                      <span style={{ fontWeight: Number(option.value) }}>
                        {option.label}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      MENU_BUTTON_CLASS,
                      isItalic && TOGGLE_ACTIVE_CLASS,
                    )}
                    aria-label={t("styleInspector.italic")}
                    aria-pressed={isItalic}
                    onClick={() =>
                      onChange({ fontStyle: isItalic ? "normal" : "italic" })
                    }
                  >
                    <IconItalic className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {`${t("styleInspector.italic")} (${shortcutLabel("cmd+i")})`}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      MENU_BUTTON_CLASS,
                      isUnderline && TOGGLE_ACTIVE_CLASS,
                    )}
                    aria-label={t("styleInspector.underline")}
                    aria-pressed={isUnderline}
                    onClick={() =>
                      onChange({ textDecoration: underlinePatch() })
                    }
                  >
                    <IconUnderline className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {`${t("styleInspector.underline")} (${shortcutLabel("cmd+u")})`}
                </TooltipContent>
              </Tooltip>

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

              <div className={TOOLBAR_DIVIDER} />

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={ICON_MENU_CLASS}
                        aria-label={t("styleInspector.align")}
                      >
                        {(() => {
                          const Icon = alignIcon(snapshot.textAlign);
                          return <Icon className="size-4" />;
                        })()}
                        <span aria-hidden="true" className={CARET_CLASS} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t("styleInspector.align")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-36">
                  {textAlignOptions(t).map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() => onChange({ textAlign: option.value })}
                    >
                      <option.icon className="size-4" />
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {onToggleList && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          MENU_BUTTON_CLASS,
                          snapshot.listKind === "bullet" && TOGGLE_ACTIVE_CLASS,
                        )}
                        aria-label={t("styleInspector.bulletList")}
                        aria-pressed={snapshot.listKind === "bullet"}
                        onClick={() => onToggleList("bullet")}
                      >
                        <IconList className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("styleInspector.bulletList")}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          MENU_BUTTON_CLASS,
                          snapshot.listKind === "ordered" &&
                            TOGGLE_ACTIVE_CLASS,
                        )}
                        aria-label={t("styleInspector.numberedList")}
                        aria-pressed={snapshot.listKind === "ordered"}
                        onClick={() => onToggleList("ordered")}
                      >
                        <IconListNumbers className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("styleInspector.numberedList")}
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </>
          ) : (
            <>
              <VisualColorPicker
                label={
                  snapshot.isImage
                    ? t("styleInspector.tint")
                    : t("styleInspector.fill")
                }
                value={snapshot.backgroundColor}
                documentColors={documentColors}
                allowTransparent
                variant="swatch"
                contentProps={inlineEditSurfaceProps}
                onChange={(value) => onChange({ backgroundColor: value })}
              />
              <VisualScrubInput
                label={t("styleInspector.opacity")}
                icon={IconGridDots}
                prefix="icon"
                value={snapshot.opacity}
                min={0}
                max={100}
                step={5}
                unit="%"
                className={SCRUB_CLASS}
                onChange={(opacity) =>
                  onChange({ opacity: String(opacity / 100) })
                }
              />
              <VisualScrubInput
                label={t("styleInspector.cornerRadius")}
                icon={IconBorderRadius}
                prefix="icon"
                value={snapshot.borderRadius}
                min={0}
                max={96}
                unit="px"
                className={SCRUB_CLASS}
                onChange={(radius) =>
                  onChange({ borderRadius: `${formatValue(radius)}px` })
                }
              />

              <div className={TOOLBAR_DIVIDER} />
              <VisualScrubInput
                label={t("styleInspector.strokeWeight")}
                icon={IconBorderStyle}
                prefix="icon"
                value={snapshot.borderWidth}
                min={0}
                max={16}
                unit="px"
                className={SCRUB_CLASS}
                onChange={(width) =>
                  onChange({ borderWidth: `${formatValue(width)}px` })
                }
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

          <div className={TOOLBAR_DIVIDER} />

          {snapshot.isAbsolute && (
            <Popover>
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
                          {
                            label: t("styleInspector.center"),
                            value: "center",
                          },
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
                          {
                            label: t("styleInspector.middle"),
                            value: "middle",
                          },
                          {
                            label: t("styleInspector.bottom"),
                            value: "bottom",
                          },
                        ]}
                      />
                    </VisualControlRow>
                  </>
                )}
              </PopoverContent>
            </Popover>
          )}

          {snapshot.isAbsolute && onArrange && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={MENU_BUTTON_CLASS}
                    onClick={() => onArrange("back")}
                    aria-label={t("styleInspector.sendToBack")}
                  >
                    <IconStackBack className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("styleInspector.sendToBack")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={MENU_BUTTON_CLASS}
                    onClick={() => onArrange("front")}
                    aria-label={t("styleInspector.bringToFront")}
                  >
                    <IconStackFront className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("styleInspector.bringToFront")}
                </TooltipContent>
              </Tooltip>
            </>
          )}

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
                    <IconDots className="size-3.5" />
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
              <div className="grid grid-cols-2 gap-2">
                <VisualScrubInput
                  label={t("styleInspector.width")}
                  icon={IconArrowAutofitWidth}
                  prefix="icon"
                  value={snapshot.width}
                  min={0}
                  unit="px"
                  onChange={(width) =>
                    onChange({ width: `${formatValue(width)}px` })
                  }
                />
                <VisualScrubInput
                  label={t("styleInspector.height")}
                  icon={IconArrowAutofitHeight}
                  prefix="icon"
                  value={snapshot.height}
                  min={0}
                  unit="px"
                  onChange={(height) =>
                    onChange({ height: `${formatValue(height)}px` })
                  }
                />
              </div>

              {snapshot.isAbsolute && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <VisualScrubInput
                      label={t("styleInspector.x")}
                      icon={null}
                      labelClassName="w-8 justify-center"
                      value={snapshot.x}
                      unit="px"
                      onChange={(x) =>
                        onChange({ left: `${formatValue(x)}px` })
                      }
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
                  <VisualScrubInput
                    label={t("styleInspector.rotation")}
                    icon={IconAngle}
                    prefix="icon"
                    value={snapshot.rotation}
                    min={-360}
                    max={360}
                    unit="°"
                    onChange={(rotation) =>
                      onChange({ transform: rotationTransform(rotation) })
                    }
                  />
                </>
              )}

              {snapshot.isText && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <VisualScrubInput
                      label={t("styleInspector.opacity")}
                      icon={IconGridDots}
                      prefix="icon"
                      value={snapshot.opacity}
                      min={0}
                      max={100}
                      step={5}
                      unit="%"
                      onChange={(opacity) =>
                        onChange({ opacity: String(opacity / 100) })
                      }
                    />
                    <VisualScrubInput
                      label={t("styleInspector.cornerRadius")}
                      icon={IconBorderRadius}
                      prefix="icon"
                      value={snapshot.borderRadius}
                      min={0}
                      max={96}
                      unit="px"
                      onChange={(radius) =>
                        onChange({ borderRadius: `${formatValue(radius)}px` })
                      }
                    />
                  </div>
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
                  <VisualScrubInput
                    label={t("styleInspector.line")}
                    icon={IconArrowAutofitHeight}
                    prefix="icon"
                    value={snapshot.lineHeight}
                    min={0.8}
                    max={3}
                    step={0.05}
                    onChange={(lineHeight) =>
                      onChange({ lineHeight: formatValue(lineHeight) })
                    }
                  />
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
                </>
              )}

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
        </>
      )}
      {zoomControls && (
        <>
          <div className={cn(TOOLBAR_DIVIDER, "ml-auto")} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={MENU_BUTTON_CLASS}
                onClick={zoomControls.onZoomOut}
                disabled={!zoomControls.canZoomOut}
                aria-label={t("raw.zoomOut")}
              >
                <IconZoomOut className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("raw.zoomOut")}</TooltipContent>
          </Tooltip>
          <span className="w-11 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
            {zoomControls.value}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={MENU_BUTTON_CLASS}
                onClick={zoomControls.onZoomIn}
                disabled={!zoomControls.canZoomIn}
                aria-label={t("raw.zoomIn")}
              >
                <IconZoomIn className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("raw.zoomIn")}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
