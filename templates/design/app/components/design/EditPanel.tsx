import { useCallback } from "react";
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
  onStyleChange: (property: string, value: string) => void;
}

/** Compact input row: label + text input */
function PropInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground w-20 shrink-0">
        {label}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground w-20 shrink-0">
        {label}
      </Label>
      <div className="flex items-center gap-1.5 flex-1">
        <div
          className="w-6 h-6 rounded border border-border shrink-0"
          style={{ backgroundColor: value || "transparent" }}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="h-7 text-xs"
        />
      </div>
    </div>
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </h3>
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
        <Input
          value={values.top}
          onChange={(e) => onChange("Top", e.target.value)}
          placeholder="T"
          className="h-7 text-xs text-center"
        />
        <Input
          value={values.right}
          onChange={(e) => onChange("Right", e.target.value)}
          placeholder="R"
          className="h-7 text-xs text-center"
        />
        <Input
          value={values.bottom}
          onChange={(e) => onChange("Bottom", e.target.value)}
          placeholder="B"
          className="h-7 text-xs text-center"
        />
        <Input
          value={values.left}
          onChange={(e) => onChange("Left", e.target.value)}
          placeholder="L"
          className="h-7 text-xs text-center"
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
  onStyleChange,
}: {
  onStyleChange: (property: string, value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionTitle>Page</SectionTitle>
      <ColorInput
        label="Background"
        value=""
        onChange={(v) => onStyleChange("backgroundColor", v)}
      />
      <PropSelect
        label="Font"
        value="sans-serif"
        onChange={(v) => onStyleChange("fontFamily", v)}
        options={FONT_FAMILIES}
      />
      <PropInput
        label="Base Size"
        value="16px"
        onChange={(v) => onStyleChange("fontSize", v)}
        placeholder="16px"
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
      />
      <PropInput
        label="Height"
        value={styles.height || ""}
        onChange={(v) => onStyleChange("height", v)}
        placeholder="auto"
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

export function EditPanel({ selectedElement, onStyleChange }: EditPanelProps) {
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
        {!selectedElement && <PageProperties onStyleChange={onStyleChange} />}

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
