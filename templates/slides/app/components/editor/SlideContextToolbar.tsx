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
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconBorderRadius,
  IconBorderStyle,
  IconBoxPadding,
  IconDots,
  IconGridDots,
  IconItalic,
  IconLayoutAlignLeft,
  IconLetterCase,
  IconSpacingHorizontal,
  IconSpacingVertical,
  IconStackBack,
  IconStackFront,
  IconUnderline,
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
  const isUnderline =
    !mixedTextStyles.includes("textDecoration") &&
    (snapshot?.textDecoration ?? "").includes("underline");
  // Null means the slide uses a background this picker cannot represent (named
  // utility, gradient); surface that as Mixed rather than guessing a hex.
  const slideBackground = backgroundCssValue(background);

  return (
    <div
      className={cn(
        "slide-context-toolbar flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border/70 bg-muted/60 px-2 sm:px-3",
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
      {!snapshot ? (
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
                onChange={(fontSize) =>
                  onChange({ fontSize: `${formatValue(fontSize)}px` })
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
                      onChange({
                        textDecoration: isUnderline ? "none" : "underline",
                      })
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
    </div>
  );
}
