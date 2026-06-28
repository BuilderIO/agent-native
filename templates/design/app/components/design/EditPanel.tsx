import { useT } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconBrush,
  IconCode,
  IconLayoutGrid,
  IconMaximize,
  IconPalette,
  IconPointer,
  IconShieldCheck,
  IconStack2,
  IconTypography,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type ComponentType,
} from "react";

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

import {
  AutoLayoutMatrix,
  ConstraintsWidget,
  ExportSettingsPanel,
  FigmaColorPicker,
  ScrubInput,
  type AlignmentMatrixValue,
  type AutoLayoutMatrixValue,
  type ConstraintsValue,
  type ExportSettingsValue,
} from "./inspector";
import type { ElementInfo } from "./types";

interface EditPanelProps {
  selectedElement: ElementInfo | null;
  pageStyles?: Record<string, string>;
  onStyleChange: (property: string, value: string) => void;
  onExport?: (settings: ExportSettingsValue) => void;
  exporting?: boolean;
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
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const setNext = (next: string) => {
    setDraft(next);
    onChange(next);
  };

  return (
    <FigmaColorPicker
      label={label}
      value={draft || "#000000"}
      onChange={setNext}
    />
  );
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

type PanelIcon = ComponentType<{ className?: string }>;

function PanelSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: PanelIcon;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border">
      <div className="flex h-9 items-center gap-2 px-3">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <h3 className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="space-y-3 px-3 pb-3">{children}</div>
    </section>
  );
}

function SubsectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {children}
    </p>
  );
}

function ReadonlyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-7 items-center overflow-hidden rounded-md border border-border bg-muted/25">
      <span className="w-6 shrink-0 text-center text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate px-1 text-xs tabular-nums text-foreground">
        {value}
      </span>
    </div>
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
const ALIGN_SELF_OPTIONS = [
  { value: "auto", key: "auto" },
  { value: "flex-start", key: "start" },
  { value: "center", key: "center" },
  { value: "flex-end", key: "end" },
  { value: "stretch", key: "stretch" },
  { value: "baseline", key: "baseline" },
] as const;
const DISPLAY_OPTIONS = [
  { value: "block", key: "block" },
  { value: "flex", key: "flex" },
  { value: "grid", key: "grid" },
  { value: "inline", key: "inline" },
  { value: "inline-block", key: "inlineBlock" },
  { value: "none", key: "none" },
] as const;
const POSITION_OPTIONS = [
  { value: "static", key: "static" },
  { value: "relative", key: "relative" },
  { value: "absolute", key: "absolute" },
  { value: "fixed", key: "fixed" },
  { value: "sticky", key: "sticky" },
] as const;
const BORDER_STYLE_OPTIONS = [
  { value: "none", key: "none" },
  { value: "solid", key: "solid" },
  { value: "dashed", key: "dashed" },
  { value: "dotted", key: "dotted" },
  { value: "double", key: "double" },
] as const;

function parseNumericValue(value: string): number {
  return parseFloat(value) || 0;
}

function parseRotationValue(transform: string | undefined): number {
  const match = transform?.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  return match ? Number(match[1]) : 0;
}

function mergeRotationValue(transform: string | undefined, degrees: number) {
  const nextRotate = `rotate(${Math.round(degrees * 10) / 10}deg)`;
  if (!transform || transform === "none") return nextRotate;
  if (/rotate\((-?\d+(?:\.\d+)?)deg\)/.test(transform)) {
    return transform.replace(/rotate\((-?\d+(?:\.\d+)?)deg\)/, nextRotate);
  }
  return `${transform} ${nextRotate}`;
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
}: {
  label: string;
  value: string;
  placeholder?: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <ScrubInput
      label={label}
      value={value ? parseNumericValue(value) : (placeholder ?? 0)}
      onChange={onChange}
      unit={unit}
      min={min}
      max={max}
      step={step}
      precision={1}
      labelClassName="w-10"
      inputClassName="h-7"
    />
  );
}

function optionValue<T extends readonly { value: string }[]>(
  options: T,
  value: string | undefined,
  fallback: T[number]["value"],
) {
  return options.some((option) => option.value === value) ? value! : fallback;
}

function formatPx(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(Number(value))}px`;
}

function elementName(element: ElementInfo): string {
  const tag = element.tagName || "element";
  return `<${tag}>${element.id ? ` #${element.id}` : ""}`;
}

function selectorLabel(element: ElementInfo): string {
  if (element.selector) return element.selector;
  if (element.id) return `#${element.id}`;
  if (element.classes?.length) return `.${element.classes.join(".")}`;
  return `<${element.tagName || "element"}>`;
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

function isParentFlex(element: ElementInfo): boolean {
  return (
    element.isFlexChild ||
    Boolean(element.parentDisplay?.toLowerCase().includes("flex"))
  );
}

function isParentGrid(element: ElementInfo): boolean {
  return Boolean(element.parentDisplay?.toLowerCase().includes("grid"));
}

function StatusPill({
  tone,
  children,
}: {
  tone: "safe" | "agent" | "neutral";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        tone === "safe" &&
          "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "agent" &&
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "neutral" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function SelectionHeader({ element }: { element: ElementInfo | null }) {
  const t = useT();

  if (!element) {
    return (
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md border border-border bg-muted/40">
            <IconPalette className="size-3.5 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {t("editPanel.properties")}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("editPanel.selection.pageContext")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const textPreview = element.textContent?.replace(/\s+/g, " ").trim();

  return (
    <div className="border-b border-border p-3">
      <div className="flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <IconStack2 className="size-3.5 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {elementName(element)}
            </h2>
            {element.isFlexContainer ? (
              <StatusPill tone="neutral">flex</StatusPill>
            ) : null}
            {isParentGrid(element) ? (
              <StatusPill tone="neutral">grid</StatusPill>
            ) : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {selectorLabel(element)}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1">
        <ReadonlyMetric label="X" value={formatPx(element.boundingRect.x)} />
        <ReadonlyMetric label="Y" value={formatPx(element.boundingRect.y)} />
        <ReadonlyMetric
          label="W"
          value={formatPx(element.boundingRect.width)}
        />
        <ReadonlyMetric
          label="H"
          value={formatPx(element.boundingRect.height)}
        />
      </div>

      {element.classes?.length || textPreview ? (
        <div className="mt-2 space-y-1.5">
          {element.classes?.length ? (
            <p className="truncate text-[10px] text-muted-foreground">
              .{element.classes.join(".")}
            </p>
          ) : null}
          {textPreview ? (
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {textPreview}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
    <div>
      {/* Lead with a clear CTA so users discover the much richer per-element
          panel. Without this it's easy to mistake the 3 page-level fields for
          "the entire editor" — the cause of the "controls too limited"
          feedback. */}
      <div className="m-3 rounded-md border border-border/70 bg-accent/30 p-3 text-xs leading-relaxed text-muted-foreground/90">
        <p className="font-medium text-foreground/85 mb-1 flex items-center gap-1.5">
          <IconPointer className="w-3.5 h-3.5" />
          {t("editPanel.pageHelpTitle")}
        </p>
        <p>{t("editPanel.pageHelpDescription")}</p>
      </div>

      <PanelSection title={t("editPanel.sections.page")} icon={IconPalette}>
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
    <PanelSection
      title={t("editPanel.sections.typography")}
      icon={IconTypography}
    >
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
    </PanelSection>
  );
}

/** Flex container properties */
function FlexContainerControls({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const padding = {
    top: parseNumericValue(styles.paddingTop || "0"),
    right: parseNumericValue(styles.paddingRight || "0"),
    bottom: parseNumericValue(styles.paddingBottom || "0"),
    left: parseNumericValue(styles.paddingLeft || "0"),
  };
  const autoLayoutValue: AutoLayoutMatrixValue = {
    direction: styles.flexDirection?.includes("column")
      ? "vertical"
      : "horizontal",
    wrap: styles.flexWrap === "wrap" ? "wrap" : "nowrap",
    alignment: {
      horizontal: justifyToHorizontal(styles.justifyContent),
      vertical: alignToVertical(styles.alignItems),
    },
    gap: parseNumericValue(styles.gap || "0"),
    padding,
    paddingLinked:
      padding.top === padding.right &&
      padding.top === padding.bottom &&
      padding.top === padding.left,
    childSizing: {
      horizontal:
        styles.width === "auto"
          ? "hug"
          : styles.width === "100%" || styles.flexGrow === "1"
            ? "fill"
            : "fixed",
      vertical:
        styles.height === "auto"
          ? "hug"
          : styles.height === "100%"
            ? "fill"
            : "fixed",
    },
  };

  return (
    <div className="space-y-2">
      <SubsectionLabel>
        {t("editPanel.layoutContext.container")}
      </SubsectionLabel>
      <AutoLayoutMatrix
        value={autoLayoutValue}
        onDirectionChange={(direction) =>
          onStyleChange(
            "flexDirection",
            direction === "vertical" ? "column" : "row",
          )
        }
        onWrapChange={(wrap) => onStyleChange("flexWrap", wrap)}
        onAlignmentChange={(alignment) => {
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
          if (!linked) return;
          onStyleChange("paddingTop", `${padding.top}px`);
          onStyleChange("paddingRight", `${padding.top}px`);
          onStyleChange("paddingBottom", `${padding.top}px`);
          onStyleChange("paddingLeft", `${padding.top}px`);
        }}
        onChildSizingChange={(axis, sizing) => {
          if (axis === "horizontal") {
            if (sizing === "hug") onStyleChange("width", "auto");
            if (sizing === "fill") {
              onStyleChange("width", "100%");
              onStyleChange("flexGrow", "1");
            }
          } else {
            if (sizing === "hug") onStyleChange("height", "auto");
            if (sizing === "fill") onStyleChange("height", "100%");
          }
        }}
      />
    </div>
  );
}

function FlexChildControls({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
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
  onStyleChange: (property: string, value: string) => void;
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
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const parentDisplay = displayLabel(element.parentDisplay);
  const flexChild = isParentFlex(element);
  const gridChild = isParentGrid(element);

  return (
    <PanelSection
      title={t("editPanel.sections.autoLayout")}
      icon={IconLayoutGrid}
    >
      <div className="grid grid-cols-3 gap-1">
        <StatusPill tone={element.isFlexContainer ? "safe" : "neutral"}>
          {element.isFlexContainer
            ? t("editPanel.layoutContext.flexContainer")
            : t("editPanel.layoutContext.notContainer")}
        </StatusPill>
        <StatusPill tone={flexChild || gridChild ? "safe" : "neutral"}>
          {flexChild
            ? t("editPanel.layoutContext.flexChild")
            : gridChild
              ? t("editPanel.layoutContext.gridChild")
              : t("editPanel.layoutContext.flowChild")}
        </StatusPill>
        <StatusPill tone="neutral">{parentDisplay}</StatusPill>
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("editPanel.layoutContext.parent")}
          </span>
          <span className="truncate font-mono text-[10px] text-foreground">
            {parentDisplay}
          </span>
        </div>
      </div>

      {element.isFlexContainer ? (
        <>
          <Separator />
          <FlexContainerControls
            element={element}
            onStyleChange={onStyleChange}
          />
        </>
      ) : null}

      {flexChild ? (
        <>
          <Separator />
          <FlexChildControls element={element} onStyleChange={onStyleChange} />
        </>
      ) : null}

      {gridChild ? (
        <>
          <Separator />
          <GridChildControls element={element} onStyleChange={onStyleChange} />
        </>
      ) : null}

      {!element.isFlexContainer && !flexChild && !gridChild ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("editPanel.layoutContext.flowDescription")}
        </p>
      ) : null}
    </PanelSection>
  );
}

/** Position, size, and spacing properties */
function PositionLayoutProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const positionOptions = POSITION_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.positionOptions.${option.key}`),
  }));
  const displayOptions = DISPLAY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.displayOptions.${option.key}`),
  }));

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
  const constraintsValue: ConstraintsValue = {
    horizontal:
      styles.left && styles.right
        ? "left-right"
        : styles.right
          ? "right"
          : styles.transform?.includes("translateX(-50%)")
            ? "center"
            : styles.width === "100%"
              ? "scale"
              : "left",
    vertical:
      styles.top && styles.bottom
        ? "top-bottom"
        : styles.bottom
          ? "bottom"
          : styles.transform?.includes("translateY(-50%)")
            ? "center"
            : styles.height === "100%"
              ? "scale"
              : "top",
  };

  const handleConstraintsChange = useCallback(
    (value: ConstraintsValue) => {
      onStyleChange("position", "absolute");
      if (value.horizontal === "left") {
        onStyleChange(
          "left",
          styles.left || `${Math.round(element.boundingRect.x)}px`,
        );
        onStyleChange("right", "auto");
      } else if (value.horizontal === "right") {
        onStyleChange("right", "0px");
        onStyleChange("left", "auto");
      } else if (value.horizontal === "left-right") {
        onStyleChange(
          "left",
          styles.left || `${Math.round(element.boundingRect.x)}px`,
        );
        onStyleChange("right", "0px");
      } else if (value.horizontal === "center") {
        onStyleChange("left", "50%");
        onStyleChange("right", "auto");
        onStyleChange("transform", "translateX(-50%)");
      } else {
        onStyleChange("left", "0px");
        onStyleChange("right", "0px");
        onStyleChange("width", "100%");
      }

      if (value.vertical === "top") {
        onStyleChange(
          "top",
          styles.top || `${Math.round(element.boundingRect.y)}px`,
        );
        onStyleChange("bottom", "auto");
      } else if (value.vertical === "bottom") {
        onStyleChange("bottom", "0px");
        onStyleChange("top", "auto");
      } else if (value.vertical === "top-bottom") {
        onStyleChange(
          "top",
          styles.top || `${Math.round(element.boundingRect.y)}px`,
        );
        onStyleChange("bottom", "0px");
      } else if (value.vertical === "center") {
        onStyleChange("top", "50%");
        onStyleChange("bottom", "auto");
        onStyleChange("transform", "translateY(-50%)");
      } else {
        onStyleChange("top", "0px");
        onStyleChange("bottom", "0px");
        onStyleChange("height", "100%");
      }
    },
    [
      element.boundingRect.x,
      element.boundingRect.y,
      onStyleChange,
      styles.left,
      styles.top,
    ],
  );

  return (
    <PanelSection
      title={t("editPanel.sections.positionLayout")}
      icon={IconMaximize}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <ScrubStyleInput
          label="X"
          value={styles.left || ""}
          placeholder={element.boundingRect.x}
          onChange={(v) => onStyleChange("left", `${Math.round(v)}px`)}
        />
        <ScrubStyleInput
          label="Y"
          value={styles.top || ""}
          placeholder={element.boundingRect.y}
          onChange={(v) => onStyleChange("top", `${Math.round(v)}px`)}
        />
        <ScrubStyleInput
          label="W"
          value={styles.width || ""}
          placeholder={element.boundingRect.width}
          min={1}
          onChange={(v) =>
            onStyleChange("width", `${Math.max(1, Math.round(v))}px`)
          }
        />
        <ScrubStyleInput
          label="H"
          value={styles.height || ""}
          placeholder={element.boundingRect.height}
          min={1}
          onChange={(v) =>
            onStyleChange("height", `${Math.max(1, Math.round(v))}px`)
          }
        />
        <ScrubStyleInput
          label="R"
          value={`${parseRotationValue(styles.transform)}deg`}
          unit="deg"
          onChange={(v) =>
            onStyleChange("transform", mergeRotationValue(styles.transform, v))
          }
        />
      </div>

      <ConstraintsWidget
        value={constraintsValue}
        onChange={handleConstraintsChange}
      />

      <PropSelect
        label={t("editPanel.labels.position")}
        value={optionValue(POSITION_OPTIONS, styles.position, "static")}
        onChange={(v) => onStyleChange("position", v)}
        options={positionOptions}
      />
      <PropSelect
        label={t("editPanel.labels.display")}
        value={optionValue(DISPLAY_OPTIONS, styles.display, "block")}
        onChange={(v) => onStyleChange("display", v)}
        options={displayOptions}
      />

      <Separator />

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
    </PanelSection>
  );
}

function FillProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;

  return (
    <PanelSection title={t("editPanel.sections.fill")} icon={IconPalette}>
      <ColorInput
        label={t("editPanel.labels.background")}
        value={styles.backgroundColor || ""}
        onChange={(v) => onStyleChange("backgroundColor", v)}
      />
      <PropInput
        label={t("editPanel.labels.image")}
        value={styles.backgroundImage || ""}
        onChange={(v) => onStyleChange("backgroundImage", v)}
        placeholder="none"
      />
    </PanelSection>
  );
}

function StrokeProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const borderStyleOptions = BORDER_STYLE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.borderStyleOptions.${option.key}`),
  }));

  return (
    <PanelSection title={t("editPanel.sections.stroke")} icon={IconBrush}>
      <PropInput
        label={t("editPanel.labels.width")}
        value={styles.borderWidth || "0"}
        onChange={(v) => onStyleChange("borderWidth", v)}
        placeholder="0px"
        defaultUnit="px"
      />
      <PropSelect
        label={t("editPanel.labels.style")}
        value={optionValue(BORDER_STYLE_OPTIONS, styles.borderStyle, "solid")}
        onChange={(v) => onStyleChange("borderStyle", v)}
        options={borderStyleOptions}
      />
      <ColorInput
        label={t("editPanel.labels.color")}
        value={styles.borderColor || ""}
        onChange={(v) => onStyleChange("borderColor", v)}
      />
    </PanelSection>
  );
}

function EffectsProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;

  return (
    <PanelSection title={t("editPanel.sections.effects")} icon={IconMaximize}>
      <PropInput
        label={t("editPanel.labels.radius")}
        value={styles.borderRadius || "0"}
        onChange={(v) => onStyleChange("borderRadius", v)}
        placeholder="0px"
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
      <PropInput
        label={t("editPanel.labels.shadow")}
        value={styles.boxShadow || ""}
        onChange={(v) => onStyleChange("boxShadow", v)}
        placeholder="none"
      />
      <PropInput
        label={t("editPanel.labels.filter")}
        value={styles.filter || ""}
        onChange={(v) => onStyleChange("filter", v)}
        placeholder="none"
      />
    </PanelSection>
  );
}

function CodeConfidenceProperties({ element }: { element: ElementInfo }) {
  const t = useT();
  const hasClassTarget = Boolean(element.classes?.length || element.id);
  const target = selectorLabel(element);

  return (
    <PanelSection
      title={t("editPanel.sections.codeConfidence")}
      icon={IconCode}
    >
      <div className="space-y-2">
        <div className="flex gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2">
          <IconShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              {t("editPanel.codeStatus.safeStyle")}
            </p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("editPanel.codeStatus.safeStyleDescription")}
            </p>
          </div>
        </div>
        <div
          className={cn(
            "flex gap-2 rounded-md border p-2",
            hasClassTarget
              ? "border-emerald-500/20 bg-emerald-500/10"
              : "border-border bg-muted/25",
          )}
        >
          {hasClassTarget ? (
            <IconShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
          ) : (
            <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              {hasClassTarget
                ? t("editPanel.codeStatus.classTarget")
                : t("editPanel.codeStatus.selectorFallback")}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {target}
            </p>
          </div>
        </div>
        <div className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-2">
          <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              {t("editPanel.codeStatus.agentStructural")}
            </p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("editPanel.codeStatus.agentStructuralDescription")}
            </p>
          </div>
        </div>
      </div>
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

export function EditPanel({
  selectedElement,
  pageStyles = {},
  onStyleChange,
  onExport,
  exporting = false,
}: EditPanelProps) {
  const t = useT();
  const [exportSettings, setExportSettings] = useState<ExportSettingsValue>({
    scale: 1,
    format: "png",
    suffix: "",
  });
  const isTextElement = selectedElement
    ? TEXT_TAGS.has(selectedElement.tagName)
    : false;

  return (
    <div
      className={cn(
        "w-72 shrink-0 border-l border-border bg-background",
        "flex min-h-0 flex-col overflow-hidden",
      )}
    >
      <SelectionHeader element={selectedElement} />

      <div className="flex-1 overflow-y-auto">
        {!selectedElement && (
          <PageProperties styles={pageStyles} onStyleChange={onStyleChange} />
        )}

        {selectedElement && (
          <>
            <PositionLayoutProperties
              element={selectedElement}
              onStyleChange={onStyleChange}
            />
            <LayoutContextProperties
              element={selectedElement}
              onStyleChange={onStyleChange}
            />
            <FillProperties
              element={selectedElement}
              onStyleChange={onStyleChange}
            />
            <StrokeProperties
              element={selectedElement}
              onStyleChange={onStyleChange}
            />
            {isTextElement ? (
              <TypographyProperties
                element={selectedElement}
                onStyleChange={onStyleChange}
              />
            ) : null}
            <EffectsProperties
              element={selectedElement}
              onStyleChange={onStyleChange}
            />
            <CodeConfidenceProperties element={selectedElement} />
          </>
        )}
        {onExport ? (
          <PanelSection title={t("editPanel.sections.export")} icon={IconCode}>
            <ExportSettingsPanel
              value={exportSettings}
              formats={["png", "svg"]}
              exporting={exporting}
              onChange={(patch) =>
                setExportSettings((current) => ({ ...current, ...patch }))
              }
              onExport={onExport}
            />
          </PanelSection>
        ) : null}
      </div>
    </div>
  );
}
