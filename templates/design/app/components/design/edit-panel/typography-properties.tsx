import { useT } from "@agent-native/core/client";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconLayoutAlignBottom,
  IconLayoutAlignMiddle,
  IconLayoutAlignTop,
  IconLetterCase,
  IconLetterSpacing,
  IconLineHeight,
  IconSquare,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ScrubInput } from "../inspector";
import { IconLayoutSettings } from "../inspector/design-icons";
import type { ElementInfo } from "../types";
import { InspectorIconButton, InspectorSegment } from "./inspector-controls";
import { authoredStyleValue } from "./interaction-state-helpers";
import { PanelSection } from "./panel-primitives";
import { roundToOneDecimal } from "./position-helpers";
import { isMixedValue, MIXED_VALUE } from "./selection-helpers";
import type { StyleChangeHandler } from "./style-change-types";
import { parseNumericValue, resolveLineHeight } from "./style-options";
import {
  displayFontFamilyName,
  FONT_FAMILY_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  resolveFontFamilySelectValue,
  type TextResizeMode,
} from "./typography-helpers";

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

/** Text element properties */
export function TypographyProperties({
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
