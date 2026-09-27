import { useT } from "@agent-native/core/client/i18n";
import { FileStorageSetupCard } from "@agent-native/core/client/setup-connections";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { VisualFontFamilyPicker } from "@agent-native/toolkit/design-tweaks";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconLayoutAlignBottom,
  IconLayoutAlignMiddle,
  IconLayoutAlignTop,
  IconLetterCase,
  IconLetterCaseLower,
  IconLetterCaseToggle,
  IconLetterCaseUpper,
  IconLetterSpacing,
  IconLineHeight,
  IconSquare,
  IconStrikethrough,
  IconTextSize,
  IconUpload,
  IconUnderline,
} from "@tabler/icons-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApplePlatform } from "@/hooks/use-shortcut-label";
import { uploadFont, type UploadedFont } from "@/lib/font-upload";
import { cn } from "@/lib/utils";

import { ScrubInput } from "../inspector";
import { IconLayoutSettings } from "../inspector/design-icons";
import type { ElementInfo } from "../types";
import { InspectorIconButton, InspectorSegment } from "./inspector-controls";
import {
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_SPAN,
  InspectorGrid,
  InspectorGridCell,
} from "./inspector-grid";
import { authoredStyleValue } from "./interaction-state-helpers";
import { PanelSection } from "./panel-primitives";
import { roundToOneDecimal } from "./position-helpers";
import { isMixedValue, MIXED_VALUE } from "./selection-helpers";
import type {
  StyleChangeMeta,
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";
import { optionValue, parseNumericValue } from "./style-options";
import {
  displayFontFamilyName,
  FONT_FAMILY_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  isKnownFontWeight,
  isTextDecorationLineActive,
  nextTextDecorationLineValue,
  letterSpacingScrubCssValue,
  parseLetterSpacingInput,
  parseLineHeightInput,
  resolveLetterSpacingFieldValue,
  resolveFixedResizeDimension,
  resolveFontFamilyFieldValue,
  resolveLineHeightFieldValue,
  sortFontFamilyOptions,
  textTruncationLineCount,
  textTruncationStyleChanges,
  TEXT_CASE_OPTIONS,
  type TextDecorationLineToken,
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

type TypographyDetailsTab = "basics" | "details";

function TypographyDetailsTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "design-sidebar-control-text cursor-pointer rounded px-2.5 py-1 font-medium text-muted-foreground",
        active &&
          "bg-[var(--design-editor-panel-raised-bg)] font-semibold text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function TypographyDetailsPopover({
  resizeMode,
  onResizeModeChange,
  underlineActive,
  strikethroughActive,
  onToggleUnderline,
  onToggleStrikethrough,
  textCase,
  textCaseIsMixed,
  onTextCaseChange,
  truncationEnabled,
  truncationLineCount,
  truncationMixed,
  truncationToggleDisabled,
  truncationLineCountDisabled,
  onTruncationEnabledChange,
  onTruncationLineCountChange,
}: {
  resizeMode: TextResizeMode;
  onResizeModeChange: (mode: TextResizeMode) => void;
  underlineActive: boolean;
  strikethroughActive: boolean;
  onToggleUnderline: () => void;
  onToggleStrikethrough: () => void;
  textCase: string;
  textCaseIsMixed: boolean;
  onTextCaseChange: (value: string) => void;
  truncationEnabled: boolean;
  truncationLineCount: number;
  truncationMixed: boolean;
  truncationToggleDisabled: boolean;
  truncationLineCountDisabled: boolean;
  onTruncationEnabledChange: (enabled: boolean) => void;
  onTruncationLineCountChange: (value: number, meta: StyleChangeMeta) => void;
}) {
  const t = useT();
  const applePlatform = useApplePlatform();
  const shortcut = (binding: string) =>
    formatShortcutLabel(binding, applePlatform);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TypographyDetailsTab>("basics");
  const truncationSwitchId = useId();

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
        data-design-chrome-region="right-panel"
        className="z-[100010] w-[360px] rounded-xl border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] p-0 text-foreground shadow-2xl"
      >
        <div className="flex items-center gap-1 border-b border-[var(--design-editor-control-border)] p-2.5">
          <div
            role="tablist"
            className="flex rounded-md bg-[var(--design-editor-control-bg)] p-0.5"
          >
            <TypographyDetailsTabButton
              label={t("editPanel.typographyDetails.basicsTab")}
              active={activeTab === "basics"}
              onClick={() => setActiveTab("basics")}
            />
            <TypographyDetailsTabButton
              label={t("editPanel.typographyDetails.detailsTab")}
              active={activeTab === "details"}
              onClick={() => setActiveTab("details")}
            />
          </div>
        </div>
        {activeTab === "basics" ? (
          <div className="space-y-3 p-4 !text-[11px]">
            <div className="flex h-20 items-center justify-center rounded-md bg-[var(--design-editor-control-bg)] text-[18px] text-muted-foreground/80">
              {"Preview" /* i18n-ignore design typography details preview */}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="design-sidebar-field-label text-muted-foreground">
                {"Text box" /* i18n-ignore design typography details label */}
              </span>
              <TextResizeControls
                resizeMode={resizeMode}
                onResizeModeChange={onResizeModeChange}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor={truncationSwitchId}
                className="design-sidebar-field-label text-muted-foreground"
              >
                {t("editPanel.typographyDetails.truncateText")}
              </Label>
              <Switch
                id={truncationSwitchId}
                aria-label={t("editPanel.typographyDetails.truncateText")}
                checked={truncationEnabled && !truncationMixed}
                disabled={truncationToggleDisabled}
                onCheckedChange={onTruncationEnabledChange}
              />
            </div>
            {truncationEnabled && !truncationMixed ? (
              <ScrubInput
                label={t("editPanel.typographyDetails.maxLines")}
                ariaLabel={t("editPanel.typographyDetails.maxLines")}
                value={truncationLineCount}
                onChange={onTruncationLineCountChange}
                min={1}
                max={100}
                step={1}
                precision={0}
                disabled={truncationLineCountDisabled}
                className="w-full gap-0"
                labelClassName="h-6 min-w-6 justify-center rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px]"
                inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
              />
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 p-4 !text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <span className="design-sidebar-field-label text-muted-foreground">
                {t("editPanel.typographyDetails.decorationLabel")}
              </span>
              <InspectorSegment>
                <InspectorIconButton
                  label={t("editPanel.textDecorations.underline")}
                  shortcut={shortcut("$mod+u")}
                  active={underlineActive}
                  onClick={onToggleUnderline}
                >
                  <IconUnderline className="size-3.5" />
                </InspectorIconButton>
                <InspectorIconButton
                  label={t("editPanel.textDecorations.strikethrough")}
                  shortcut={shortcut("$mod+shift+x")}
                  active={strikethroughActive}
                  onClick={onToggleStrikethrough}
                >
                  <IconStrikethrough className="size-3.5" />
                </InspectorIconButton>
              </InspectorSegment>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="design-sidebar-field-label text-muted-foreground">
                {t("editPanel.typographyDetails.caseLabel")}
              </span>
              <InspectorSegment>
                <InspectorIconButton
                  label={t("editPanel.textCases.none")}
                  active={!textCaseIsMixed && textCase === "none"}
                  onClick={() => onTextCaseChange("none")}
                >
                  <IconLetterCase className="size-3.5" />
                </InspectorIconButton>
                <InspectorIconButton
                  label={t("editPanel.textCases.uppercase")}
                  active={!textCaseIsMixed && textCase === "uppercase"}
                  onClick={() => onTextCaseChange("uppercase")}
                >
                  <IconLetterCaseUpper className="size-3.5" />
                </InspectorIconButton>
                <InspectorIconButton
                  label={t("editPanel.textCases.lowercase")}
                  active={!textCaseIsMixed && textCase === "lowercase"}
                  onClick={() => onTextCaseChange("lowercase")}
                >
                  <IconLetterCaseLower className="size-3.5" />
                </InspectorIconButton>
                <InspectorIconButton
                  label={t("editPanel.textCases.capitalize")}
                  active={!textCaseIsMixed && textCase === "capitalize"}
                  onClick={() => onTextCaseChange("capitalize")}
                >
                  <IconLetterCaseToggle className="size-3.5" />
                </InspectorIconButton>
              </InspectorSegment>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TypographyProperties({
  element,
  onStyleChange,
  onStylesChange,
  designId,
  onFontUploaded,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  designId?: string;
  onFontUploaded?: (font: UploadedFont) => void | Promise<void>;
}) {
  const t = useT();
  const fileUploadStatus = useFileUploadStatus();
  const canUploadFonts = fileUploadStatus.data?.configured === true;
  const fontUploadInputRef = useRef<HTMLInputElement>(null);
  const [fontUploading, setFontUploading] = useState(false);
  const styles = element.computedStyles;
  const baseFontFamilyOptions = sortFontFamilyOptions([
    ...FONT_FAMILY_OPTIONS.map((option) => ({
      value: option.value,
      label:
        option.label ??
        (option.key
          ? t(`editPanel.fontFamilies.${option.key}`)
          : displayFontFamilyName(option.value)),
    })),
  ]);
  const fontFamilyIsMixed = isMixedValue(styles.fontFamily);
  const fontWeightIsMixed = isMixedValue(styles.fontWeight);
  const fontSizeIsMixed = isMixedValue(styles.fontSize);
  const lineHeightIsMixed = isMixedValue(styles.lineHeight);
  const letterSpacingIsMixed = isMixedValue(styles.letterSpacing);
  const textTransformIsMixed = isMixedValue(styles.textTransform);
  const letterSpacingField = resolveLetterSpacingFieldValue(
    authoredStyleValue(element, "letterSpacing"),
    styles.letterSpacing,
  );
  const lineHeightField = resolveLineHeightFieldValue(
    authoredStyleValue(element, "lineHeight"),
    styles.lineHeight,
    styles.fontSize,
    styles.resolvedLineHeightPx,
  );
  const lineClampIsMixed = isMixedValue(styles.webkitLineClamp);
  const truncationLineCount = lineClampIsMixed
    ? null
    : textTruncationLineCount(authoredStyleValue(element, "webkitLineClamp"));
  const truncationEnabled = truncationLineCount !== null;
  const applyTextTruncation = (
    enabled: boolean,
    lineCount: number,
    meta?: StyleChangeMeta,
  ) => {
    const changes = textTruncationStyleChanges(
      enabled,
      lineCount,
      element.inlineStyles,
    );
    if (!changes) {
      toast.error(t("editPanel.typographyDetails.restoreError"));
      return;
    }
    onStylesChange?.(changes, meta);
  };

  const underlineActive = isTextDecorationLineActive(
    styles.textDecorationLine,
    "underline",
  );
  const strikethroughActive = isTextDecorationLineActive(
    styles.textDecorationLine,
    "line-through",
  );
  const toggleTextDecorationLine = (line: TextDecorationLineToken) => {
    onStyleChange(
      "textDecoration",
      nextTextDecorationLineValue(styles.textDecorationLine, line),
    );
  };
  const textCase = textTransformIsMixed
    ? "none"
    : optionValue(TEXT_CASE_OPTIONS, styles.textTransform, "none");
  const setTextCase = (value: string) => onStyleChange("textTransform", value);

  const fontFamily = resolveFontFamilyFieldValue(styles.fontFamily);
  const fontFamilyOptions = sortFontFamilyOptions(
    fontFamilyIsMixed
      ? baseFontFamilyOptions
      : FONT_FAMILY_OPTIONS.some((option) => option.value === fontFamily) ||
          displayFontFamilyName(fontFamily).toLowerCase() === "lato"
        ? baseFontFamilyOptions
        : [
            {
              value: fontFamily,
              label: displayFontFamilyName(styles.fontFamily || fontFamily),
            },
            ...baseFontFamilyOptions,
          ],
  );
  const handleFontUpload = async (file: File) => {
    if (!canUploadFonts || !designId || !onFontUploaded) return;
    setFontUploading(true);
    try {
      const uploaded = await uploadFont(file, designId);
      await onFontUploaded(uploaded);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("promptDialog.failedToUploadFile"),
      );
    } finally {
      setFontUploading(false);
    }
  };
  const baseFontWeightOptions = FONT_WEIGHT_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontWeights.${option.key}`),
  }));
  const currentFontWeight = styles.fontWeight || "400";
  const fontWeightOptions =
    fontWeightIsMixed || isKnownFontWeight(currentFontWeight)
      ? baseFontWeightOptions
      : [
          { value: currentFontWeight, label: currentFontWeight },
          ...baseFontWeightOptions,
        ];
  const textAlign = styles.textAlign || "left";

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
  const currentWidth = resolveFixedResizeDimension(
    styles.width,
    widthIsAuto,
    element.boundingRect.width,
  );
  const currentHeight = resolveFixedResizeDimension(
    styles.height,
    heightIsAuto,
    element.boundingRect.height,
  );
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
      <InspectorGrid layout="field-action">
        <InspectorGridCell span={28} className="h-6 overflow-hidden">
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              <VisualFontFamilyPicker
                label={t("editPanel.labels.font")}
                value={fontFamily}
                options={fontFamilyOptions}
                mixed={fontFamilyIsMixed}
                mixedLabel={MIXED_VALUE}
                searchable
                searchPlaceholder={t("root.commandSearch")}
                contentProps={{
                  "data-design-chrome-region": "right-panel",
                }}
                className="h-6 w-full rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
                onChange={(value) => onStyleChange("fontFamily", value)}
              />
            </div>
            {designId && onFontUploaded ? (
              <>
                <input
                  ref={fontUploadInputRef}
                  type="file"
                  accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
                  className="sr-only"
                  aria-label={t("promptDialog.uploadFile")}
                  disabled={!canUploadFonts}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void handleFontUpload(file);
                  }}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={fontUploading || !canUploadFonts}
                      aria-label={t("promptDialog.uploadFile")}
                      className="size-6 shrink-0"
                      onClick={() => fontUploadInputRef.current?.click()}
                    >
                      <IconUpload className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("promptDialog.uploadFile")}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : null}
          </div>
        </InspectorGridCell>
      </InspectorGrid>
      {designId && onFontUploaded && !canUploadFonts ? (
        <div className="mt-2">
          <FileStorageSetupCard />
        </div>
      ) : null}

      {/* Row 2: weight + size side by side */}
      <InspectorGrid className="items-center" layout="action-pair">
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
          <Select
            value={fontWeightIsMixed ? MIXED_VALUE : currentFontWeight}
            onValueChange={(v) => onStyleChange("fontWeight", v)}
          >
            <SelectTrigger className="h-6 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent data-design-chrome-region="right-panel">
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
        </InspectorGridCell>
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_GUTTER_SPAN} ariaHidden />
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
          <ScrubInput
            label={t("editPanel.labels.size")}
            ariaLabel={t("editPanel.labels.size")}
            icon={IconTextSize}
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
            className="w-full gap-0"
            labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
            inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
          />
        </InspectorGridCell>
      </InspectorGrid>

      {/* Row 3: labelled line-height + letter-spacing fields */}
      <InspectorGrid className="items-center" layout="action-pair">
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
          <div className="flex flex-col gap-2">
            <p className="design-sidebar-field-label text-muted-foreground">
              {t("editPanel.labels.lineHeight")}
            </p>
            <ScrubInput
              label={t("editPanel.labels.lineHeight")}
              ariaLabel={t("editPanel.labels.lineHeight")}
              icon={IconLineHeight}
              value={lineHeightIsMixed ? 0 : lineHeightField.value}
              textValue={lineHeightIsMixed ? undefined : lineHeightField.text}
              unit={lineHeightField.unit}
              mixed={lineHeightIsMixed}
              onChange={(value, meta) =>
                onStyleChange(
                  "lineHeight",
                  `${Math.max(0, value)}${lineHeightField.unit}`,
                  meta,
                )
              }
              onTextCommit={(draft, meta) => {
                const parsed = parseLineHeightInput(draft, lineHeightField);
                if (!parsed) return { accepted: false };
                onStyleChange("lineHeight", parsed.cssValue, meta);
                return { accepted: true, displayValue: parsed.text };
              }}
              min={0}
              step={1}
              precision={2}
              className="w-full gap-0"
              labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
              inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
            />
          </div>
        </InspectorGridCell>
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_GUTTER_SPAN} ariaHidden />
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
          <div className="flex flex-col gap-2">
            <p className="design-sidebar-field-label text-muted-foreground">
              {t("editPanel.labels.tracking")}
            </p>
            <ScrubInput
              label={t("editPanel.labels.tracking")}
              ariaLabel={t("editPanel.labels.tracking")}
              icon={IconLetterSpacing}
              value={letterSpacingIsMixed ? 0 : letterSpacingField.value}
              textValue={
                letterSpacingIsMixed ? undefined : letterSpacingField.text
              }
              mixed={letterSpacingIsMixed}
              onChange={(value, meta) =>
                onStyleChange(
                  "letterSpacing",
                  letterSpacingScrubCssValue(value, letterSpacingField.unit),
                  meta,
                )
              }
              onTextCommit={(draft, meta) => {
                const parsed = parseLetterSpacingInput(
                  draft,
                  letterSpacingField,
                );
                if (!parsed) return { accepted: false };
                onStyleChange("letterSpacing", parsed.cssValue, meta);
                return { accepted: true, displayValue: parsed.text };
              }}
              unit={letterSpacingField.unit}
              precision={2}
              className="w-full gap-0"
              labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
              inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
            />
          </div>
        </InspectorGridCell>
      </InspectorGrid>

      <div className="design-sidebar-field-label text-muted-foreground">
        {t("editPanel.labels.align")}
      </div>

      {/* Row 4: horizontal + vertical text alignment */}
      <InspectorGrid className="items-center">
        <InspectorGridCell span={13}>
          <InspectorSegment className="w-full">
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
          </InspectorSegment>
        </InspectorGridCell>
        <InspectorGridCell span={1} ariaHidden />
        <InspectorGridCell span={10}>
          <InspectorSegment className="w-full">
            <InspectorIconButton
              label={"Align top" /* i18n-ignore design vertical text align */}
              active={verticalAlign === "top"}
              onClick={() => setVerticalAlign("top")}
            >
              <IconLayoutAlignTop className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={
                "Align middle" /* i18n-ignore design vertical text align */
              }
              active={verticalAlign === "middle"}
              onClick={() => setVerticalAlign("middle")}
            >
              <IconLayoutAlignMiddle className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={
                "Align bottom" /* i18n-ignore design vertical text align */
              }
              active={verticalAlign === "bottom"}
              onClick={() => setVerticalAlign("bottom")}
            >
              <IconLayoutAlignBottom className="size-3.5" />
            </InspectorIconButton>
          </InspectorSegment>
        </InspectorGridCell>
        <InspectorGridCell span={4} className="flex justify-center">
          <TypographyDetailsPopover
            resizeMode={resizeMode}
            onResizeModeChange={setResizeMode}
            underlineActive={underlineActive}
            strikethroughActive={strikethroughActive}
            onToggleUnderline={() => toggleTextDecorationLine("underline")}
            onToggleStrikethrough={() =>
              toggleTextDecorationLine("line-through")
            }
            textCase={textCase}
            textCaseIsMixed={textTransformIsMixed}
            onTextCaseChange={setTextCase}
            truncationEnabled={truncationEnabled}
            truncationLineCount={truncationLineCount ?? 1}
            truncationMixed={lineClampIsMixed}
            truncationToggleDisabled={
              lineClampIsMixed ||
              !onStylesChange ||
              (!truncationEnabled && resizeMode === "fixed")
            }
            truncationLineCountDisabled={
              !onStylesChange || resizeMode === "fixed"
            }
            onTruncationEnabledChange={(enabled) =>
              applyTextTruncation(enabled, truncationLineCount ?? 1)
            }
            onTruncationLineCountChange={(value, meta) =>
              applyTextTruncation(true, value, meta)
            }
          />
        </InspectorGridCell>
      </InspectorGrid>
    </PanelSection>
  );
}
