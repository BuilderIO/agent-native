import type { useT } from "@agent-native/core/client/i18n";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconArrowsMove,
  IconBold,
  IconChevronDown,
  IconCopy,
  IconItalic,
  IconLetterT,
  IconLetterSpacing,
  IconLineHeight,
  IconPalette,
  IconPointer,
  IconPencil,
  IconTextSize,
  IconTypography,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { SlideFrameTextRangeStyle } from "../slides-2-runtime/protocol";
import type { ElementSnapshot, SourceEditOp } from "./types";

type Translate = ReturnType<typeof useT>;

type Props = {
  selected: ElementSnapshot | null;
  selectionCount: number;
  disabled: boolean;
  t: Translate;
  rangeStyleSnapshot?: SlideFrameTextRangeStyle | null;
  onInspectTextRange?: (
    range: {
      start: number;
      end: number;
      expectedText: string;
    } | null,
  ) => void;
  onEditOnSlide?: () => void;
  onEdit: (ops: SourceEditOp[]) => void;
  onAlign: (
    alignment: "left" | "center" | "right" | "top" | "middle" | "bottom",
    toSlide: boolean,
  ) => void;
  alignToSlide: boolean;
  onAlignToSlideChange: (toSlide: boolean) => void;
  smartGuidesEnabled: boolean;
  onSmartGuidesChange: (enabled: boolean) => void;
  onDistribute: (axis: "x" | "y") => void;
  onArrange: (direction: "front" | "forward" | "backward" | "back") => void;
  onGroup: () => void;
  onUngroup: () => void;
  canUngroup: boolean;
  onDuplicateObject: () => void;
  onDeleteObject: () => void;
  canSelectParent: boolean;
  onSelectParent: () => void;
};

const INLINE_TEXT_STYLE_KEYS = new Set([
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontFamily",
  "color",
]);
const FONT_WEIGHT_VALUES = ["300", "400", "500", "600", "700", "800"] as const;
type InlineTextStyleKey =
  | "fontFamily"
  | "fontSize"
  | "fontStyle"
  | "fontWeight"
  | "color";
type TextRange = { start: number; end: number };
type InlineTextStyleValues = Partial<Record<InlineTextStyleKey, string | null>>;

function valueNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function isTransparentColor(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === "transparent") return true;
  if (
    (/^#[\da-f]{4}$/i.test(normalized) && normalized.endsWith("0")) ||
    (/^#[\da-f]{8}$/i.test(normalized) && normalized.endsWith("00"))
  ) {
    return true;
  }
  const rgba = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i.exec(
    normalized,
  );
  return rgba ? Number(rgba[1]) === 0 : false;
}

function colorValue(
  value: string | null | undefined,
  fallback = "#000000", // guard:allow-raw-color — native color input needs a concrete fallback for transparent values.
): string {
  if (!value || isTransparentColor(value)) return fallback;
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (!rgb) return fallback;
  return `#${rgb
    .slice(1, 4)
    .map((channel) =>
      Math.max(0, Math.min(255, Number(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function ColorField({
  label,
  value,
  fallback,
  disabled,
  onChange,
  action,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  disabled: boolean;
  onChange: (value: string) => void;
  action?: ReactNode;
}) {
  const color = colorValue(value, fallback);
  const [draft, setDraft] = useState(color);
  const [pickerColor, setPickerColor] = useState(color);

  useEffect(() => {
    setDraft(color);
    setPickerColor(color);
  }, [color]);

  const commitDraft = () => {
    const next = draft.trim();
    if (!/^#[\da-f]{6}$/i.test(next)) {
      setDraft(color);
      return;
    }
    const normalized = next.toLowerCase();
    setDraft(normalized);
    setPickerColor(normalized);
    if (normalized !== pickerColor.toLowerCase()) onChange(normalized);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="w-[4.5rem] shrink-0 whitespace-nowrap">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <Input
          type="color"
          value={pickerColor}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setPickerColor(event.currentTarget.value);
            onChange(event.currentTarget.value);
          }}
          className="size-7 shrink-0 cursor-pointer p-1"
          aria-label={label}
        />
        <Input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="h-7 min-w-0 flex-1 font-mono text-xs text-foreground"
          aria-label={label}
        />
        {action}
      </span>
    </div>
  );
}

function NumericField({
  label,
  value,
  unit = "",
  compact = false,
  step,
  prefix,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  unit?: string;
  compact?: boolean;
  step?: number | "any";
  prefix?: ReactNode;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  const formattedValue = String(Math.round(value * 100) / 100);
  const focusedRef = useRef(false);
  const cancelledRef = useRef(false);
  const editRef = useRef({ value: formattedValue, onCommit });

  useEffect(() => {
    if (!focusedRef.current) setDraft(formattedValue);
  }, [formattedValue]);

  return (
    <label
      className={`grid min-w-0 ${compact ? "" : "gap-1 text-xs text-muted-foreground"}`}
    >
      <span className={compact ? "sr-only" : undefined}>{label}</span>
      <span className="relative">
        {prefix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {prefix}
          </span>
        ) : null}
        <Input
          type="number"
          step={step}
          value={draft}
          disabled={disabled}
          onFocus={() => {
            focusedRef.current = true;
            cancelledRef.current = false;
            editRef.current = { value: formattedValue, onCommit };
          }}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => {
            focusedRef.current = false;
            const parsed = Number(draft);
            if (
              !disabled &&
              !cancelledRef.current &&
              draft.trim() &&
              Number.isFinite(parsed) &&
              parsed !== Number(editRef.current.value)
            ) {
              editRef.current.onCommit(parsed);
            }
            setDraft(formattedValue);
            cancelledRef.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.stopPropagation();
              cancelledRef.current = true;
              event.currentTarget.blur();
            }
          }}
          className={`${compact ? "h-7" : "h-8"} ${prefix ? "pl-7" : ""} pr-8 text-foreground`}
        />
        {unit ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]">
            {unit}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function Section({
  title,
  action,
  children,
  className,
  collapsible = false,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
}) {
  if (collapsible) {
    return (
      <details
        className={`group border-b border-border last:border-0 ${className ?? ""}`}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-4 [&::-webkit-details-marker]:hidden">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </h3>
          {action}
          <IconChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="grid gap-3 pb-4">{children}</div>
      </details>
    );
  }

  return (
    <section
      className={`grid gap-3 border-b border-border py-4 last:border-0 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ArrangeSection({
  selectionCount,
  disabled,
  t,
  onAlign,
  alignToSlide,
  onAlignToSlideChange,
  smartGuidesEnabled,
  onSmartGuidesChange,
  onDistribute,
  onArrange,
  onGroup,
  onUngroup,
  canUngroup,
  onDuplicateObject,
  onDeleteObject,
  canSelectParent,
  onSelectParent,
}: Pick<
  Props,
  | "selectionCount"
  | "disabled"
  | "t"
  | "onAlign"
  | "alignToSlide"
  | "onAlignToSlideChange"
  | "smartGuidesEnabled"
  | "onSmartGuidesChange"
  | "onDistribute"
  | "onArrange"
  | "onGroup"
  | "onUngroup"
  | "canUngroup"
  | "onDuplicateObject"
  | "onDeleteObject"
  | "canSelectParent"
  | "onSelectParent"
>) {
  return (
    <Section
      title={t("styleInspector.arrange")}
      action={
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Switch
                aria-label={t("styleInspector.smartGuides")}
                checked={smartGuidesEnabled}
                disabled={disabled}
                onCheckedChange={onSmartGuidesChange}
              />
            </TooltipTrigger>
            <TooltipContent>{t("styleInspector.smartGuides")}</TooltipContent>
          </Tooltip>
          {selectionCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label={t("styleInspector.selectParent")}
              title={t("styleInspector.selectParent")}
              disabled={disabled || !canSelectParent}
              onClick={onSelectParent}
            >
              <IconArrowBackUp className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      }
    >
      {selectionCount > 0 ? (
        <>
          {selectionCount > 1 ? (
            <ToggleGroup
              type="single"
              value={alignToSlide ? "slide" : "selection"}
              aria-label={t("styleInspector.alignToLabel")}
              disabled={disabled}
              onValueChange={(value) => {
                if (value) onAlignToSlideChange(value === "slide");
              }}
              className="w-full"
            >
              <ToggleGroupItem value="selection" className="flex-1">
                {t("styleInspector.alignToSelection")}
              </ToggleGroupItem>
              <ToggleGroupItem value="slide" className="flex-1">
                {t("styleInspector.alignToSlide")}
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                ["left", t("styleInspector.left")],
                ["center", t("styleInspector.center")],
                ["right", t("styleInspector.right")],
                ["top", t("styleInspector.top")],
                ["middle", t("styleInspector.middle")],
                ["bottom", t("styleInspector.bottom")],
              ] as const
            ).map(([alignment, label]) => (
              <Button
                key={alignment}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-label={`${t("styleInspector.align")} ${label}`}
                onClick={() =>
                  onAlign(alignment, selectionCount === 1 || alignToSlide)
                }
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {selectionCount > 1 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || selectionCount < 3}
                  onClick={() => onDistribute("x")}
                >
                  {t("styleInspector.horizontal")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || selectionCount < 3}
                  onClick={() => onDistribute("y")}
                >
                  {t("styleInspector.vertical")}
                </Button>
              </>
            ) : null}
          </div>
          {selectionCount > 1 || canUngroup ? (
            <div className="grid grid-cols-2 gap-2">
              {selectionCount > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={onGroup}
                >
                  {t("styleInspector.group")}
                </Button>
              ) : null}
              {canUngroup ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={onUngroup}
                >
                  {t("styleInspector.ungroup")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["front", t("styleInspector.bringToFront")],
            ["forward", t("styleInspector.bringForward")],
            ["backward", t("styleInspector.sendBackward")],
            ["back", t("styleInspector.sendToBack")],
          ] as const
        ).map(([direction, label]) => (
          <Button
            key={direction}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 whitespace-normal px-1 text-[11px]"
            disabled={disabled}
            aria-label={label}
            onClick={() => onArrange(direction)}
          >
            {label}
          </Button>
        ))}
      </div>
      {selectionCount === 1 ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 whitespace-normal px-1 text-[11px]"
            disabled={disabled}
            onClick={onDuplicateObject}
          >
            <IconCopy className="me-1 size-3.5 shrink-0" aria-hidden="true" />
            {t("slides2Editor.duplicateObject")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 whitespace-normal px-1 text-[11px] text-destructive hover:text-destructive"
            disabled={disabled}
            onClick={onDeleteObject}
          >
            <IconTrash className="me-1 size-3.5 shrink-0" aria-hidden="true" />
            {t("slides2Editor.deleteObject")}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

export function Slides2Inspector({
  selected,
  selectionCount,
  disabled,
  t,
  rangeStyleSnapshot,
  onInspectTextRange,
  onEditOnSlide,
  onEdit,
  onAlign,
  alignToSlide,
  onAlignToSlideChange,
  smartGuidesEnabled,
  onSmartGuidesChange,
  onDistribute,
  onArrange,
  onGroup,
  onUngroup,
  canUngroup,
  onDuplicateObject,
  onDeleteObject,
  canSelectParent,
  onSelectParent,
}: Props) {
  const text = selected?.text ?? "";
  const styles = selected?.styles ?? {};
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [textDraft, setTextDraft] = useState(text);
  const committedTextRef = useRef(text);
  const composingTextRef = useRef(false);
  const textNodeIdRef = useRef(selected?.nodeId ?? null);
  const [textRange, setTextRange] = useState<TextRange | null>(null);
  const [rangeStyleValues, setRangeStyleValues] = useState<
    Record<string, InlineTextStyleValues>
  >({});
  useEffect(() => {
    const nodeChanged = textNodeIdRef.current !== (selected?.nodeId ?? null);
    textNodeIdRef.current = selected?.nodeId ?? null;
    if (
      nodeChanged ||
      (!composingTextRef.current && text === committedTextRef.current) ||
      (!composingTextRef.current &&
        document.activeElement !== textAreaRef.current)
    ) {
      committedTextRef.current = text;
      setTextDraft(text);
    }
  }, [selected?.nodeId, text]);
  useEffect(() => {
    setTextRange(null);
    setRangeStyleValues({});
    onInspectTextRange?.(null);
  }, [onInspectTextRange, selected?.nodeId]);
  const commitText = (value: string) => {
    const previousText = committedTextRef.current;
    if (!selected || value === previousText) return;
    committedTextRef.current = value;
    setRangeStyleValues({});
    onEdit([{ kind: "set-text", value, prevText: previousText }]);
  };
  const reportTextRange = (textArea: HTMLTextAreaElement) => {
    if (composingTextRef.current) {
      setTextRange(null);
      onInspectTextRange?.(null);
      return;
    }
    const { selectionStart: start, selectionEnd: end } = textArea;
    const nextRange = start < end ? { start, end } : null;
    setTextRange(nextRange);
    onInspectTextRange?.(
      nextRange ? { ...nextRange, expectedText: textArea.value } : null,
    );
  };
  const rangeKey =
    selected && textRange
      ? `${selected.nodeId}:${textRange.start}:${textRange.end}`
      : null;
  const activeRangeStyleValues = rangeKey
    ? rangeStyleValues[rangeKey]
    : undefined;
  const inspectedRangeStyleValues =
    selected &&
    textRange &&
    rangeStyleSnapshot &&
    rangeStyleSnapshot.nodeId === selected.nodeId &&
    rangeStyleSnapshot.start === textRange.start &&
    rangeStyleSnapshot.end === textRange.end &&
    rangeStyleSnapshot.expectedText === (textAreaRef.current?.value ?? text)
      ? rangeStyleSnapshot.styles
      : undefined;
  const textStyleValue = (key: InlineTextStyleKey) => {
    if (
      activeRangeStyleValues &&
      Object.prototype.hasOwnProperty.call(activeRangeStyleValues, key)
    ) {
      return activeRangeStyleValues[key];
    }
    if (
      inspectedRangeStyleValues &&
      Object.prototype.hasOwnProperty.call(inspectedRangeStyleValues, key)
    ) {
      return inspectedRangeStyleValues[key];
    }
    return styles[key];
  };
  const fontFamily = textStyleValue("fontFamily") ?? "";
  const [fontFamilyDraft, setFontFamilyDraft] = useState(fontFamily);
  const [fontFamilyOpen, setFontFamilyOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"format" | "arrange">(
    "format",
  );
  useEffect(() => {
    setFontFamilyDraft(fontFamily);
  }, [fontFamily, selected?.nodeId, text]);
  useEffect(() => {
    setFontFamilyOpen(false);
  }, [selected?.nodeId]);
  useEffect(() => {
    setInspectorTab("format");
  }, [selected?.nodeId]);
  const editStyle = (key: string, value: string | null) => {
    if (!selected) return;
    const textArea = textAreaRef.current;
    const start = textArea?.selectionStart ?? 0;
    const end = textArea?.selectionEnd ?? start;
    const previousText = textArea?.value ?? text;
    if (textArea && start < end && INLINE_TEXT_STYLE_KEYS.has(key)) {
      const styleKey = key as InlineTextStyleKey;
      const selectedRange = { start, end };
      setTextRange(selectedRange);
      const selectedRangeKey = `${selected.nodeId}:${start}:${end}`;
      setRangeStyleValues((current) => ({
        ...current,
        [selectedRangeKey]: {
          ...current[selectedRangeKey],
          [styleKey]: value,
        },
      }));
      onEdit([
        {
          kind: "set-text-range-style",
          start,
          end,
          key,
          value,
          prevText: previousText,
        },
      ]);
      return;
    }
    onEdit([
      {
        kind: "set-style",
        key,
        value,
        ...(previousText ? { prevText: previousText } : {}),
      },
    ]);
  };
  const translateToFrame = (x: number, y: number) => {
    if (!selected) return "0px 0px";
    const transform = selected.transform;
    const basis = transform?.basis ?? { a: 1, b: 0, c: 0, d: 1 };
    const translate = transform?.translate ?? { x: 0, y: 0 };
    const determinant = basis.a * basis.d - basis.b * basis.c;
    const delta = { x: x - selected.bounds.x, y: y - selected.bounds.y };
    const local =
      Math.abs(determinant) < 0.000001
        ? { x: delta.x, y: delta.y }
        : {
            x: (basis.d * delta.x - basis.c * delta.y) / determinant,
            y: (basis.a * delta.y - basis.b * delta.x) / determinant,
          };
    return `${Math.round((translate.x + local.x) * 100) / 100}px ${Math.round((translate.y + local.y) * 100) / 100}px`;
  };
  const fontSize = valueNumber(textStyleValue("fontSize")) ?? 24;
  const authoredLineHeight = selected?.authoredStyles?.lineHeight?.trim();
  const unitlessLineHeight = Boolean(
    authoredLineHeight &&
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(authoredLineHeight),
  );
  const authoredPixelLineHeight = Boolean(
    authoredLineHeight &&
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?px$/i.test(authoredLineHeight),
  );
  const lineHeightValue = unitlessLineHeight
    ? Number(authoredLineHeight)
    : authoredPixelLineHeight
      ? (valueNumber(authoredLineHeight) ?? Math.round(fontSize * 1.2))
      : (valueNumber(styles.lineHeight) ?? Math.round(fontSize * 1.2));
  const rawFontWeight = textStyleValue("fontWeight")?.trim() || "400";
  const fontWeight =
    rawFontWeight === "normal"
      ? "400"
      : rawFontWeight === "bold"
        ? "700"
        : rawFontWeight;
  const bold = Number(fontWeight) >= 600;
  const italic = textStyleValue("fontStyle") === "italic";
  const fontWeightOptions = [
    { value: "300", label: "300" },
    { value: "400", label: t("slides2Editor.fontWeightRegular") },
    { value: "500", label: t("slides2Editor.fontWeightMedium") },
    { value: "600", label: t("slides2Editor.fontWeightSemibold") },
    { value: "700", label: t("slides2Editor.fontWeightBold") },
    { value: "800", label: "800" },
  ] as const;
  const opacity = Math.round((valueNumber(styles.opacity) ?? 1) * 100);
  const rotation =
    selected?.transform?.rotation ?? valueNumber(styles.rotate) ?? 0;
  const isText = Boolean(text.trim());

  if (!selected) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-background">
        {selectionCount > 1 ? (
          <div className="min-h-0 flex-1 overflow-auto px-4">
            <ArrangeSection
              selectionCount={selectionCount}
              disabled={disabled}
              t={t}
              onAlign={onAlign}
              alignToSlide={alignToSlide}
              onAlignToSlideChange={onAlignToSlideChange}
              smartGuidesEnabled={smartGuidesEnabled}
              onSmartGuidesChange={onSmartGuidesChange}
              onDistribute={onDistribute}
              onArrange={onArrange}
              onGroup={onGroup}
              onUngroup={onUngroup}
              canUngroup={canUngroup}
              onDuplicateObject={onDuplicateObject}
              onDeleteObject={onDeleteObject}
              canSelectParent={canSelectParent}
              onSelectParent={onSelectParent}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center px-4 pt-16 text-center ltr:translate-x-1">
            <IconPointer
              className="size-6 text-muted-foreground"
              aria-hidden="true"
            />
            <h3 className="mt-5 text-[13px] leading-5 font-medium text-foreground">
              {t("slides2Editor.selectElement")}
            </h3>
            <p className="mt-2 max-w-[17.5rem] text-xs leading-[17px] tracking-[-0.018em] text-muted-foreground">
              {t("slides2Editor.selectElementHint")}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-auto px-4 flex flex-col">
        {selectionCount === 1 ? (
          <div className="order-first flex items-center justify-between gap-2 border-b border-border py-3">
            <div className="flex min-w-0 items-center gap-2">
              {isText ? (
                <IconLetterT
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <IconPalette
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="text-sm font-medium text-foreground">
                {isText
                  ? t("styleInspector.text")
                  : t("styleInspector.appearance")}
              </span>
            </div>
            <ToggleGroup
              type="single"
              value={inspectorTab}
              onValueChange={(value) => {
                if (value === "format" || value === "arrange") {
                  setInspectorTab(value);
                }
              }}
              aria-label={
                isText
                  ? t("styleInspector.text")
                  : t("styleInspector.appearance")
              }
              className="shrink-0"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem
                    value="format"
                    variant="outline"
                    size="sm"
                    className="size-7 p-0"
                    aria-label={
                      isText
                        ? t("styleInspector.text")
                        : t("styleInspector.appearance")
                    }
                  >
                    {isText ? (
                      <IconLetterT aria-hidden="true" />
                    ) : (
                      <IconPalette aria-hidden="true" />
                    )}
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>
                  {isText
                    ? t("styleInspector.text")
                    : t("styleInspector.appearance")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem
                    value="arrange"
                    variant="outline"
                    size="sm"
                    className="size-7 p-0"
                    aria-label={t("styleInspector.arrange")}
                  >
                    <IconArrowsMove aria-hidden="true" />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{t("styleInspector.arrange")}</TooltipContent>
              </Tooltip>
            </ToggleGroup>
          </div>
        ) : null}
        {selectionCount === 1 && inspectorTab === "arrange" ? (
          <Section title={t("styleInspector.position")} collapsible>
            <div className="grid grid-cols-2 gap-2">
              <NumericField
                label={t("styleInspector.x")}
                value={selected.bounds.x}
                unit="px"
                disabled={disabled}
                onCommit={(value) =>
                  editStyle(
                    "translate",
                    translateToFrame(value, selected.bounds.y),
                  )
                }
              />
              <NumericField
                label={t("styleInspector.y")}
                value={selected.bounds.y}
                unit="px"
                disabled={disabled}
                onCommit={(value) =>
                  editStyle(
                    "translate",
                    translateToFrame(selected.bounds.x, value),
                  )
                }
              />
              <NumericField
                label={t("styleInspector.width")}
                value={selected.transform?.width ?? selected.bounds.width}
                unit="px"
                disabled={disabled}
                onCommit={(value) =>
                  editStyle("width", `${Math.max(8, Math.round(value))}px`)
                }
              />
              <NumericField
                label={t("styleInspector.height")}
                value={selected.transform?.height ?? selected.bounds.height}
                unit="px"
                disabled={disabled}
                onCommit={(value) =>
                  editStyle("height", `${Math.max(8, Math.round(value))}px`)
                }
              />
            </div>
            <NumericField
              label={t("styleInspector.rotation")}
              value={rotation}
              unit="°"
              disabled={disabled}
              onCommit={(value) =>
                editStyle("rotate", `${Math.round(value * 100) / 100}deg`)
              }
            />
          </Section>
        ) : null}

        {selectionCount > 1 || inspectorTab === "arrange" ? (
          <div>
            <ArrangeSection
              selectionCount={selectionCount}
              disabled={disabled}
              t={t}
              onAlign={onAlign}
              alignToSlide={alignToSlide}
              onAlignToSlideChange={onAlignToSlideChange}
              smartGuidesEnabled={smartGuidesEnabled}
              onSmartGuidesChange={onSmartGuidesChange}
              onDistribute={onDistribute}
              onArrange={onArrange}
              onGroup={onGroup}
              onUngroup={onUngroup}
              canUngroup={canUngroup}
              onDuplicateObject={onDuplicateObject}
              onDeleteObject={onDeleteObject}
              canSelectParent={canSelectParent}
              onSelectParent={onSelectParent}
            />
          </div>
        ) : null}

        {selectionCount === 1 && isText && inspectorTab === "format" ? (
          <Section
            title={t("styleInspector.typography")}
            action={
              <Popover open={fontFamilyOpen} onOpenChange={setFontFamilyOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 text-muted-foreground"
                    aria-label={t("styleInspector.fontFamily")}
                    title={t("styleInspector.fontFamily")}
                  >
                    <IconTypography aria-hidden="true" className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-3">
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    <span className="sr-only">
                      {t("styleInspector.fontFamily")}
                    </span>
                    <Input
                      value={fontFamilyDraft}
                      disabled={disabled}
                      onChange={(event) =>
                        setFontFamilyDraft(event.currentTarget.value)
                      }
                      onBlur={(event) =>
                        editStyle(
                          "fontFamily",
                          event.currentTarget.value || null,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      className="h-8 text-foreground"
                      aria-label={t("styleInspector.fontFamily")}
                    />
                  </label>
                </PopoverContent>
              </Popover>
            }
          >
            <div className="grid grid-cols-[2fr_1fr] gap-2">
              <label className="grid min-w-0">
                <span className="sr-only">{t("styleInspector.weight")}</span>
                <Select
                  value={fontWeight}
                  disabled={disabled}
                  onValueChange={(value) => editStyle("fontWeight", value)}
                >
                  <SelectTrigger
                    className="h-7 text-foreground"
                    aria-label={t("styleInspector.weight")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!FONT_WEIGHT_VALUES.some(
                      (value) => value === fontWeight,
                    ) ? (
                      <SelectItem value={fontWeight}>
                        {rawFontWeight}
                      </SelectItem>
                    ) : null}
                    {fontWeightOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <NumericField
                label={t("styleInspector.size")}
                value={fontSize}
                unit="px"
                compact
                prefix={
                  <IconTextSize aria-hidden="true" className="size-3.5" />
                }
                disabled={disabled}
                onCommit={(value) =>
                  editStyle("fontSize", `${Math.max(1, Math.round(value))}px`)
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="multiple"
                value={[
                  ...(bold ? ["bold"] : []),
                  ...(italic ? ["italic"] : []),
                ]}
                aria-label={t("styleInspector.typography")}
                disabled={disabled}
                onValueChange={(values) => {
                  const nextBold = values.includes("bold");
                  const nextItalic = values.includes("italic");
                  if (nextBold !== bold) {
                    editStyle("fontWeight", nextBold ? "700" : "400");
                  }
                  if (nextItalic !== italic) {
                    editStyle("fontStyle", nextItalic ? "italic" : "normal");
                  }
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem
                      value="bold"
                      variant="outline"
                      size="sm"
                      className="size-7 p-0"
                      aria-label={t("styleInspector.bold")}
                    >
                      <IconBold aria-hidden="true" />
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>{t("styleInspector.bold")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem
                      value="italic"
                      variant="outline"
                      size="sm"
                      className="size-7 p-0"
                      aria-label={t("styleInspector.italic")}
                    >
                      <IconItalic aria-hidden="true" />
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>{t("styleInspector.italic")}</TooltipContent>
                </Tooltip>
              </ToggleGroup>
              <ToggleGroup
                type="single"
                value={styles.textAlign || "left"}
                aria-label={t("styleInspector.align")}
                disabled={disabled}
                onValueChange={(alignment) => {
                  if (alignment) editStyle("textAlign", alignment);
                }}
              >
                {(
                  [
                    ["left", IconAlignLeft],
                    ["center", IconAlignCenter],
                    ["right", IconAlignRight],
                    ["justify", IconAlignJustified],
                  ] as const
                ).map(([alignment, Icon]) => (
                  <Tooltip key={alignment}>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem
                        value={alignment}
                        variant="outline"
                        size="sm"
                        className="size-7 p-0"
                        aria-label={
                          alignment === "justify"
                            ? t("styleInspector.justify")
                            : t(
                                `styleInspector.textAlign${alignment[0]!.toUpperCase()}${alignment.slice(1)}`,
                              )
                        }
                      >
                        <Icon aria-hidden="true" />
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent>
                      {alignment === "justify"
                        ? t("styleInspector.justify")
                        : t(
                            `styleInspector.textAlign${alignment[0]!.toUpperCase()}${alignment.slice(1)}`,
                          )}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </ToggleGroup>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumericField
                label={t("styleInspector.lineHeight")}
                value={lineHeightValue}
                unit={unitlessLineHeight ? "" : "px"}
                compact
                step={unitlessLineHeight ? "any" : undefined}
                prefix={
                  <IconLineHeight aria-hidden="true" className="size-3.5" />
                }
                disabled={disabled}
                onCommit={(value) =>
                  editStyle(
                    "lineHeight",
                    unitlessLineHeight
                      ? String(Math.max(0, Math.round(value * 100) / 100))
                      : `${Math.max(1, Math.round(value))}px`,
                  )
                }
              />
              <NumericField
                label={t("styleInspector.letterSpacing")}
                value={valueNumber(styles.letterSpacing) ?? 0}
                unit="px"
                compact
                prefix={
                  <IconLetterSpacing aria-hidden="true" className="size-3.5" />
                }
                disabled={disabled}
                onCommit={(value) =>
                  editStyle(
                    "letterSpacing",
                    `${Math.round(value * 100) / 100}px`,
                  )
                }
              />
            </div>
          </Section>
        ) : null}

        {selectionCount === 1 && inspectorTab === "format" ? (
          <Section title={t("styleInspector.color")}>
            {isText ? (
              <ColorField
                label={t("styleInspector.textColor")}
                value={textStyleValue("color") ?? undefined}
                fallback={
                  /* guard:allow-raw-color - native color input needs a concrete fallback when the text color is inherited. */
                  "#000000"
                }
                disabled={disabled}
                onChange={(value) => editStyle("color", value)}
              />
            ) : null}
            <ColorField
              label={t("styleInspector.background")}
              value={styles.backgroundColor}
              fallback={
                /* guard:allow-raw-color — native color input needs a concrete fallback for transparent fills. */
                "#ffffff"
              }
              disabled={disabled}
              onChange={(value) => editStyle("backgroundColor", value)}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[11px]"
                  disabled={
                    disabled || isTransparentColor(styles.backgroundColor)
                  }
                  onClick={() => editStyle("backgroundColor", null)}
                >
                  {t("styleInspector.transparent")}
                </Button>
              }
            />
          </Section>
        ) : null}

        {selectionCount === 1 && isText && inspectorTab === "format" ? (
          <Section
            title={t("styleInspector.content")}
            action={
              onEditOnSlide ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-1.5 text-[11px]"
                  disabled={disabled}
                  onClick={onEditOnSlide}
                >
                  <IconPencil className="size-3.5" aria-hidden="true" />
                  {t("styleInspector.editOnSlide")}
                </Button>
              ) : null
            }
          >
            <Textarea
              ref={textAreaRef}
              rows={2}
              value={textDraft}
              disabled={disabled}
              onCompositionStart={() => {
                composingTextRef.current = true;
                setTextRange(null);
                onInspectTextRange?.(null);
              }}
              onCompositionEnd={(event) => {
                composingTextRef.current = false;
                const next = event.currentTarget.value;
                setTextDraft(next);
                commitText(next);
                reportTextRange(event.currentTarget);
              }}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setTextDraft(next);
                if (!composingTextRef.current) commitText(next);
                reportTextRange(event.currentTarget);
              }}
              onSelect={(event) => reportTextRange(event.currentTarget)}
              onKeyUp={(event) => reportTextRange(event.currentTarget)}
              onMouseUp={(event) => reportTextRange(event.currentTarget)}
              onBlur={(event) => {
                commitText(event.currentTarget.value);
              }}
              className="resize-y text-foreground"
            />
          </Section>
        ) : null}

        {selectionCount === 1 && inspectorTab === "format" && !isText ? (
          <Section title={t("styleInspector.appearance")}>
            <NumericField
              label={t("styleInspector.opacity")}
              value={opacity}
              unit="%"
              disabled={disabled}
              onCommit={(value) =>
                editStyle(
                  "opacity",
                  String(Math.max(0, Math.min(100, Math.round(value))) / 100),
                )
              }
            />
            <NumericField
              label={t("styleInspector.cornerRadius")}
              value={valueNumber(styles.borderRadius) ?? 0}
              unit="px"
              disabled={disabled}
              onCommit={(value) =>
                editStyle("borderRadius", `${Math.max(0, Math.round(value))}px`)
              }
            />
          </Section>
        ) : null}

        {selectionCount === 1 ? (
          <Section
            title={t("styleInspector.source")}
            className="mt-auto"
            collapsible
          >
            <span className="font-mono text-[10.5px] text-muted-foreground">
              &lt;{selected.tagName.toLowerCase()}&gt; · {selected.line}:
              {selected.column}
            </span>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
