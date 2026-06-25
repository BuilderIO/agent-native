import { useT } from "@agent-native/core/client";
import { IconPointer } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

import type { ElementInfo } from "./types";

interface EditPanelProps {
  selectedElement: ElementInfo | null;
  pageStyles?: Record<string, string>;
  onStyleChange: (property: string, value: string) => void;
}

/**
 * Normalize a CSS length-ish value typed by the user. If the input is bare
 * digits (e.g. "32" or "32.5"), append the default unit so it parses as a
 * valid CSS length. Lets users type "32" and get the expected "32px" when
 * the field is committed.
 */
function normalizeLengthValue(raw: string, defaultUnit: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}${defaultUnit}`;
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

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (defaultUnit === undefined) return;
    const next = normalizeLengthValue(draft, defaultUnit);
    if (next !== draft) setDraft(next);
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground w-20 shrink-0">
        {label}
      </Label>
      <Input
        type={type}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          // For length fields, defer the live update until blur/Enter so that
          // invalid intermediate strings ("3", "32", "32p") don't get applied
          // and discarded by the browser. Free-text fields (without
          // defaultUnit) keep the responsive live-update behavior.
          if (defaultUnit === undefined) onChange(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className="h-7 text-xs"
      />
    </div>
  );
}

/** Compact color input: label + color swatch + text input */
function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const setNext = (next: string) => {
    setDraft(next);
    onChange(next);
  };

  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground w-20 shrink-0">
        {label}
      </Label>
      <div className="flex items-center gap-1.5 flex-1">
        <input
          type="color"
          aria-label={`${label} ${t("editPanel.colorInputLabel")}`}
          value={toColorInputValue(draft)}
          onChange={(e) => setNext(e.target.value)}
          className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        />
        <Input
          value={draft}
          onChange={(e) => setNext(e.target.value)}
          placeholder="#000000"
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

function toColorInputValue(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((char) => char + char)
      .join("")}`;
  }
  const rgb = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i,
  );
  if (rgb) {
    return `#${rgb
      .slice(1, 4)
      .map((part) =>
        Math.max(0, Math.min(255, Number(part)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }
  return "#000000";
}

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
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground w-20 shrink-0">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
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
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground w-20 shrink-0">
        {label}
      </Label>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="flex-1"
      />
      <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">
        {value}
        {unit}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </h3>
  );
}

function FourSideCell({
  side,
  placeholder,
  value,
  onChange,
}: {
  side: string;
  placeholder: string;
  value: string;
  onChange: (side: string, value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const next = normalizeLengthValue(draft, "px");
    if (next !== draft) setDraft(next);
    if (next !== value) onChange(side, next);
  };

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      className="h-7 text-xs text-center"
    />
  );
}

function FourSideInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: { top: string; right: string; bottom: string; left: string };
  onChange: (side: string, value: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-4 gap-1">
        <FourSideCell
          side="Top"
          placeholder={t("editPanel.sidePlaceholders.top")}
          value={values.top}
          onChange={onChange}
        />
        <FourSideCell
          side="Right"
          placeholder={t("editPanel.sidePlaceholders.right")}
          value={values.right}
          onChange={onChange}
        />
        <FourSideCell
          side="Bottom"
          placeholder={t("editPanel.sidePlaceholders.bottom")}
          value={values.bottom}
          onChange={onChange}
        />
        <FourSideCell
          side="Left"
          placeholder={t("editPanel.sidePlaceholders.left")}
          value={values.left}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

const FONT_FAMILY_OPTIONS = [
  { value: "inherit", key: "inherit" },
  { value: "sans-serif", key: "sansSerif" },
  { value: "serif", key: "serif" },
  { value: "monospace", key: "monospace" },
  { value: "'Inter', sans-serif", key: "inter" },
  { value: "'Poppins', sans-serif", key: "poppins" },
  { value: "'Playfair Display', serif", key: "playfairDisplay" },
  { value: "'JetBrains Mono', monospace", key: "jetBrainsMono" },
] as const;

const FONT_WEIGHT_OPTIONS = [
  { value: "100", key: "thin" },
  { value: "200", key: "extraLight" },
  { value: "300", key: "light" },
  { value: "400", key: "regular" },
  { value: "500", key: "medium" },
  { value: "600", key: "semiBold" },
  { value: "700", key: "bold" },
  { value: "800", key: "extraBold" },
  { value: "900", key: "black" },
] as const;

const TEXT_ALIGN_OPTIONS = [
  { value: "left", key: "left" },
  { value: "center", key: "center" },
  { value: "right", key: "right" },
  { value: "justify", key: "justify" },
] as const;
const FLEX_DIRECTION_OPTIONS = [
  { value: "row", key: "row" },
  { value: "column", key: "column" },
  { value: "row-reverse", key: "rowReverse" },
  { value: "column-reverse", key: "columnReverse" },
] as const;
const JUSTIFY_OPTIONS = [
  { value: "flex-start", key: "start" },
  { value: "center", key: "center" },
  { value: "flex-end", key: "end" },
  { value: "space-between", key: "between" },
  { value: "space-around", key: "around" },
  { value: "space-evenly", key: "evenly" },
] as const;
const ALIGN_OPTIONS = [
  { value: "flex-start", key: "start" },
  { value: "center", key: "center" },
  { value: "flex-end", key: "end" },
  { value: "stretch", key: "stretch" },
  { value: "baseline", key: "baseline" },
] as const;

function parseNumericValue(value: string): number {
  return parseFloat(value) || 0;
}

/** Page-level properties when nothing is selected */
function PageProperties({
  styles,
  onStyleChange,
}: {
  styles: Record<string, string>;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const fontFamilyOptions = FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontFamilies.${option.key}`),
  }));
  const fontFamily = FONT_FAMILY_OPTIONS.some(
    (option) => option.value === styles.fontFamily,
  )
    ? styles.fontFamily
    : "sans-serif";

  return (
    <div className="space-y-4">
      {/* Lead with a clear CTA so users discover the much richer per-element
          panel. Without this it's easy to mistake the 3 page-level fields for
          "the entire editor" — the cause of the "controls too limited"
          feedback. */}
      <div className="rounded-lg border border-border/70 bg-accent/30 p-3 text-xs text-muted-foreground/90 leading-relaxed">
        <p className="font-medium text-foreground/85 mb-1 flex items-center gap-1.5">
          <IconPointer className="w-3.5 h-3.5" />
          {t("editPanel.pageHelpTitle")}
        </p>
        <p>{t("editPanel.pageHelpDescription")}</p>
      </div>

      <SectionTitle>{t("editPanel.sections.page")}</SectionTitle>
      <ColorInput
        label={t("editPanel.labels.background")}
        value={styles.backgroundColor || ""}
        onChange={(v) => onStyleChange("backgroundColor", v)}
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
    </div>
  );
}

/** Text element properties */
function TextProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const fontFamilyOptions = FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontFamilies.${option.key}`),
  }));
  const fontWeightOptions = FONT_WEIGHT_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontWeights.${option.key}`),
  }));
  const textAlignOptions = TEXT_ALIGN_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.textAligns.${option.key}`),
  }));

  return (
    <div className="space-y-4">
      <SectionTitle>{t("editPanel.sections.typography")}</SectionTitle>
      <PropSelect
        label={t("editPanel.labels.font")}
        value={styles.fontFamily || "sans-serif"}
        onChange={(v) => onStyleChange("fontFamily", v)}
        options={fontFamilyOptions}
      />
      <PropInput
        label={t("editPanel.labels.size")}
        value={styles.fontSize || ""}
        onChange={(v) => onStyleChange("fontSize", v)}
        placeholder="16px"
        defaultUnit="px"
      />
      <PropSelect
        label={t("editPanel.labels.weight")}
        value={styles.fontWeight || "400"}
        onChange={(v) => onStyleChange("fontWeight", v)}
        options={fontWeightOptions}
      />
      <ColorInput
        label={t("editPanel.labels.color")}
        value={styles.color || ""}
        onChange={(v) => onStyleChange("color", v)}
      />
      <PropSelect
        label={t("editPanel.labels.align")}
        value={styles.textAlign || "left"}
        onChange={(v) => onStyleChange("textAlign", v)}
        options={textAlignOptions}
      />
      <PropInput
        label={t("editPanel.labels.lineHeight")}
        value={styles.lineHeight || ""}
        onChange={(v) => onStyleChange("lineHeight", v)}
        placeholder="1.5"
      />
      <PropInput
        label={t("editPanel.labels.tracking")}
        value={styles.letterSpacing || ""}
        onChange={(v) => onStyleChange("letterSpacing", v)}
        placeholder="0px"
        defaultUnit="px"
      />
    </div>
  );
}

/** Flex container/child properties */
function FlexProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const flexDirectionOptions = FLEX_DIRECTION_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.flexDirections.${option.key}`),
  }));
  const justifyOptions = JUSTIFY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.justifyOptions.${option.key}`),
  }));
  const alignOptions = ALIGN_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.alignOptions.${option.key}`),
  }));

  return (
    <div className="space-y-4">
      <SectionTitle>{t("editPanel.sections.flexLayout")}</SectionTitle>
      <PropSelect
        label={t("editPanel.labels.direction")}
        value={styles.flexDirection || "row"}
        onChange={(v) => onStyleChange("flexDirection", v)}
        options={flexDirectionOptions}
      />
      <PropSelect
        label={t("editPanel.labels.justify")}
        value={styles.justifyContent || "flex-start"}
        onChange={(v) => onStyleChange("justifyContent", v)}
        options={justifyOptions}
      />
      <PropSelect
        label={t("editPanel.labels.align")}
        value={styles.alignItems || "stretch"}
        onChange={(v) => onStyleChange("alignItems", v)}
        options={alignOptions}
      />
      <PropInput
        label={t("editPanel.labels.gap")}
        value={styles.gap || ""}
        onChange={(v) => onStyleChange("gap", v)}
        placeholder="0px"
        defaultUnit="px"
      />
    </div>
  );
}

/** Universal element properties (size, opacity, spacing, border, background) */
function ElementProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;

  const handlePaddingChange = useCallback(
    (side: string, value: string) => {
      onStyleChange(`padding${side}`, value);
    },
    [onStyleChange],
  );

  const handleMarginChange = useCallback(
    (side: string, value: string) => {
      onStyleChange(`margin${side}`, value);
    },
    [onStyleChange],
  );

  return (
    <div className="space-y-4">
      <SectionTitle>{t("editPanel.sections.layout")}</SectionTitle>
      <PropInput
        label={t("editPanel.labels.width")}
        value={styles.width || ""}
        onChange={(v) => onStyleChange("width", v)}
        placeholder="auto"
        defaultUnit="px"
      />
      <PropInput
        label={t("editPanel.labels.height")}
        value={styles.height || ""}
        onChange={(v) => onStyleChange("height", v)}
        placeholder="auto"
        defaultUnit="px"
      />
      <PropSlider
        label={t("editPanel.labels.opacity")}
        value={parseNumericValue(styles.opacity || "1") * 100}
        onChange={(v) => onStyleChange("opacity", String(v / 100))}
        min={0}
        max={100}
        step={1}
        unit="%"
      />

      <Separator />

      <SectionTitle>{t("editPanel.sections.spacing")}</SectionTitle>
      <FourSideInput
        label={t("editPanel.labels.padding")}
        values={{
          top: styles.paddingTop || "0",
          right: styles.paddingRight || "0",
          bottom: styles.paddingBottom || "0",
          left: styles.paddingLeft || "0",
        }}
        onChange={handlePaddingChange}
      />
      <FourSideInput
        label={t("editPanel.labels.margin")}
        values={{
          top: styles.marginTop || "0",
          right: styles.marginRight || "0",
          bottom: styles.marginBottom || "0",
          left: styles.marginLeft || "0",
        }}
        onChange={handleMarginChange}
      />

      <Separator />

      <SectionTitle>{t("editPanel.sections.border")}</SectionTitle>
      <PropInput
        label={t("editPanel.labels.width")}
        value={styles.borderWidth || "0"}
        onChange={(v) => onStyleChange("borderWidth", v)}
        placeholder="0px"
        defaultUnit="px"
      />
      <ColorInput
        label={t("editPanel.labels.color")}
        value={styles.borderColor || ""}
        onChange={(v) => onStyleChange("borderColor", v)}
      />
      <PropInput
        label={t("editPanel.labels.radius")}
        value={styles.borderRadius || "0"}
        onChange={(v) => onStyleChange("borderRadius", v)}
        placeholder="0px"
        defaultUnit="px"
      />

      <Separator />

      <SectionTitle>{t("editPanel.sections.fill")}</SectionTitle>
      <ColorInput
        label={t("editPanel.labels.background")}
        value={styles.backgroundColor || ""}
        onChange={(v) => onStyleChange("backgroundColor", v)}
      />
    </div>
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

export function EditPanel({
  selectedElement,
  pageStyles = {},
  onStyleChange,
}: EditPanelProps) {
  const t = useT();
  const isTextElement = selectedElement
    ? TEXT_TAGS.has(selectedElement.tagName)
    : false;
  const isFlexContainer = selectedElement?.isFlexContainer ?? false;

  return (
    <div
      className={cn(
        "w-64 border-l border-border bg-background overflow-y-auto",
        "flex flex-col",
      )}
    >
      <div className="p-3 border-b border-border">
        <h2 className="text-xs font-semibold text-foreground">
          {selectedElement
            ? `<${selectedElement.tagName}>${selectedElement.id ? ` #${selectedElement.id}` : ""}`
            : t("editPanel.properties")}
        </h2>
        {selectedElement?.classes.length ? (
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            .{selectedElement.classes.join(".")}
          </p>
        ) : null}
      </div>

      <div className="flex-1 p-3 space-y-4 overflow-y-auto">
        {!selectedElement && (
          <PageProperties styles={pageStyles} onStyleChange={onStyleChange} />
        )}

        {selectedElement && isTextElement && (
          <>
            <TextProperties
              element={selectedElement}
              onStyleChange={onStyleChange}
            />
            <Separator />
          </>
        )}

        {selectedElement && isFlexContainer && (
          <>
            <FlexProperties
              element={selectedElement}
              onStyleChange={onStyleChange}
            />
            <Separator />
          </>
        )}

        {selectedElement && (
          <ElementProperties
            element={selectedElement}
            onStyleChange={onStyleChange}
          />
        )}
      </div>
    </div>
  );
}
