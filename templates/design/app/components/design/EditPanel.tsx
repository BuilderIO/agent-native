import { useCallback, useEffect, useState } from "react";
import { IconPointer } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
          aria-label={`${label} color`}
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
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-4 gap-1">
        <FourSideCell
          side="Top"
          placeholder="T"
          value={values.top}
          onChange={onChange}
        />
        <FourSideCell
          side="Right"
          placeholder="R"
          value={values.right}
          onChange={onChange}
        />
        <FourSideCell
          side="Bottom"
          placeholder="B"
          value={values.bottom}
          onChange={onChange}
        />
        <FourSideCell
          side="Left"
          placeholder="L"
          value={values.left}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

const FONT_FAMILIES = [
  { value: "inherit", label: "Inherit" },
  { value: "sans-serif", label: "Sans Serif" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Monospace" },
  { value: "'Inter', sans-serif", label: "Inter" },
  { value: "'Poppins', sans-serif", label: "Poppins" },
  { value: "'Playfair Display', serif", label: "Playfair Display" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
];

const FONT_WEIGHTS = [
  { value: "100", label: "Thin" },
  { value: "200", label: "Extra Light" },
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semi Bold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra Bold" },
  { value: "900", label: "Black" },
];

const TEXT_ALIGNS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

const FLEX_DIRECTIONS = [
  { value: "row", label: "Row" },
  { value: "column", label: "Column" },
  { value: "row-reverse", label: "Row Reverse" },
  { value: "column-reverse", label: "Column Reverse" },
];

const JUSTIFY_OPTIONS = [
  { value: "flex-start", label: "Start" },
  { value: "center", label: "Center" },
  { value: "flex-end", label: "End" },
  { value: "space-between", label: "Between" },
  { value: "space-around", label: "Around" },
  { value: "space-evenly", label: "Evenly" },
];

const ALIGN_OPTIONS = [
  { value: "flex-start", label: "Start" },
  { value: "center", label: "Center" },
  { value: "flex-end", label: "End" },
  { value: "stretch", label: "Stretch" },
  { value: "baseline", label: "Baseline" },
];

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
  const fontFamily = FONT_FAMILIES.some(
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
          Click any element on the canvas
        </p>
        <p>
          Edit typography, spacing, sizing, borders and fill for whatever you
          select. Page defaults below.
        </p>
      </div>

      <SectionTitle>Page</SectionTitle>
      <ColorInput
        label="Background"
        value={styles.backgroundColor || ""}
        onChange={(v) => onStyleChange("backgroundColor", v)}
      />
      <PropSelect
        label="Font"
        value={fontFamily}
        onChange={(v) => onStyleChange("fontFamily", v)}
        options={FONT_FAMILIES}
      />
      <PropInput
        label="Base Size"
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
  const styles = element.computedStyles;

  return (
    <div className="space-y-4">
      <SectionTitle>Typography</SectionTitle>
      <PropSelect
        label="Font"
        value={styles.fontFamily || "sans-serif"}
        onChange={(v) => onStyleChange("fontFamily", v)}
        options={FONT_FAMILIES}
      />
      <PropInput
        label="Size"
        value={styles.fontSize || ""}
        onChange={(v) => onStyleChange("fontSize", v)}
        placeholder="16px"
        defaultUnit="px"
      />
      <PropSelect
        label="Weight"
        value={styles.fontWeight || "400"}
        onChange={(v) => onStyleChange("fontWeight", v)}
        options={FONT_WEIGHTS}
      />
      <ColorInput
        label="Color"
        value={styles.color || ""}
        onChange={(v) => onStyleChange("color", v)}
      />
      <PropSelect
        label="Align"
        value={styles.textAlign || "left"}
        onChange={(v) => onStyleChange("textAlign", v)}
        options={TEXT_ALIGNS}
      />
      <PropInput
        label="Line Height"
        value={styles.lineHeight || ""}
        onChange={(v) => onStyleChange("lineHeight", v)}
        placeholder="1.5"
      />
      <PropInput
        label="Tracking"
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
  const styles = element.computedStyles;

  return (
    <div className="space-y-4">
      <SectionTitle>Flex Layout</SectionTitle>
      <PropSelect
        label="Direction"
        value={styles.flexDirection || "row"}
        onChange={(v) => onStyleChange("flexDirection", v)}
        options={FLEX_DIRECTIONS}
      />
      <PropSelect
        label="Justify"
        value={styles.justifyContent || "flex-start"}
        onChange={(v) => onStyleChange("justifyContent", v)}
        options={JUSTIFY_OPTIONS}
      />
      <PropSelect
        label="Align"
        value={styles.alignItems || "stretch"}
        onChange={(v) => onStyleChange("alignItems", v)}
        options={ALIGN_OPTIONS}
      />
      <PropInput
        label="Gap"
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
      <SectionTitle>Layout</SectionTitle>
      <PropInput
        label="Width"
        value={styles.width || ""}
        onChange={(v) => onStyleChange("width", v)}
        placeholder="auto"
        defaultUnit="px"
      />
      <PropInput
        label="Height"
        value={styles.height || ""}
        onChange={(v) => onStyleChange("height", v)}
        placeholder="auto"
        defaultUnit="px"
      />
      <PropSlider
        label="Opacity"
        value={parseNumericValue(styles.opacity || "1") * 100}
        onChange={(v) => onStyleChange("opacity", String(v / 100))}
        min={0}
        max={100}
        step={1}
        unit="%"
      />

      <Separator />

      <SectionTitle>Spacing</SectionTitle>
      <FourSideInput
        label="Padding"
        values={{
          top: styles.paddingTop || "0",
          right: styles.paddingRight || "0",
          bottom: styles.paddingBottom || "0",
          left: styles.paddingLeft || "0",
        }}
        onChange={handlePaddingChange}
      />
      <FourSideInput
        label="Margin"
        values={{
          top: styles.marginTop || "0",
          right: styles.marginRight || "0",
          bottom: styles.marginBottom || "0",
          left: styles.marginLeft || "0",
        }}
        onChange={handleMarginChange}
      />

      <Separator />

      <SectionTitle>Border</SectionTitle>
      <PropInput
        label="Width"
        value={styles.borderWidth || "0"}
        onChange={(v) => onStyleChange("borderWidth", v)}
        placeholder="0px"
        defaultUnit="px"
      />
      <ColorInput
        label="Color"
        value={styles.borderColor || ""}
        onChange={(v) => onStyleChange("borderColor", v)}
      />
      <PropInput
        label="Radius"
        value={styles.borderRadius || "0"}
        onChange={(v) => onStyleChange("borderRadius", v)}
        placeholder="0px"
        defaultUnit="px"
      />

      <Separator />

      <SectionTitle>Fill</SectionTitle>
      <ColorInput
        label="Background"
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
            : "Properties"}
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
