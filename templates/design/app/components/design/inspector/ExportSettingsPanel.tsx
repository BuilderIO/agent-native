import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { IconDownload, IconPlus, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type ExportFormat = "png" | "jpg" | "svg" | "pdf" | "webp";

/** Scale preset value — "custom" means the user typed a freeform multiplier */
export type ExportScale = "0.5" | "1" | "2" | "3" | "4" | "custom";

export interface ExportSettingsValue {
  scale: number;
  format: ExportFormat;
  suffix: string;
}

export interface ExportSettingsPanelLabels {
  title: string;
  scale: string;
  format: string;
  suffix: string;
  export: string;
  addExport: string;
  removeExport: string;
}

export interface ExportSettingsPanelProps {
  value: ExportSettingsValue;
  onChange: (patch: Partial<ExportSettingsValue>) => void;
  onExport: (settings: ExportSettingsValue[]) => void;
  formats?: ExportFormat[];
  labels?: Partial<ExportSettingsPanelLabels>;
  disabled?: boolean;
  exporting?: boolean;
  className?: string;
}

const DEFAULT_LABELS: ExportSettingsPanelLabels = {
  title: "Export", // i18n-ignore fallback component label
  scale: "Scale", // i18n-ignore fallback component label
  format: "Format", // i18n-ignore fallback component label
  suffix: "Suffix", // i18n-ignore fallback component label
  export: "Export", // i18n-ignore fallback component label
  addExport: "Add export", // i18n-ignore fallback component label
  removeExport: "Remove export", // i18n-ignore fallback component label
};

const DEFAULT_FORMATS: ExportFormat[] = ["png", "jpg", "svg", "pdf", "webp"];

const controlChromeClass =
  "border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-foreground shadow-none hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground focus:ring-1 focus:ring-[var(--design-editor-accent-color)] focus:ring-offset-0 focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0";

// Export scale bounds — must match the clamp in DesignEditor's PNG/SVG export
// handlers so the panel never promises a range the exporter won't render.
const MIN_EXPORT_SCALE = 0.1;
const MAX_EXPORT_SCALE = 4;

/** Preset scale options shown in the scale dropdown — matches the design editor's presets */
const SCALE_PRESETS: { label: string; value: ExportScale }[] = [
  { label: "0.5x", value: "0.5" },
  { label: "1x", value: "1" },
  { label: "2x", value: "2" },
  { label: "3x", value: "3" },
  { label: "4x", value: "4" },
  { label: "Custom…", value: "custom" }, // i18n-ignore fixed scale preset label
];

/**
 * Map a numeric scale to the nearest preset key, or "custom" if it doesn't
 * match any of the five standard multipliers.
 */
function scaleToPreset(scale: number): ExportScale {
  const hit = SCALE_PRESETS.find(
    (p) => p.value !== "custom" && Number(p.value) === scale,
  );
  return hit ? hit.value : "custom";
}

/** A single in-progress export row (multi-row internal state) */
interface ExportRow {
  id: number;
  scale: number;
  format: ExportFormat;
  suffix: string;
  /** Whether the user has switched to freeform scale entry */
  customScale: boolean;
}

let _nextId = 1;
function nextId() {
  return _nextId++;
}

function rowFromValue(v: ExportSettingsValue): ExportRow {
  return {
    id: nextId(),
    scale: v.scale,
    format: v.format,
    suffix: v.suffix,
    customScale: scaleToPreset(v.scale) === "custom",
  };
}

/** Scale dropdown — shows the design editor's 0.5x/1x/2x/3x/4x presets + Custom */
function ScaleSelect({
  scale,
  customScale,
  disabled,
  onPresetChange,
}: {
  scale: number;
  customScale: boolean;
  disabled: boolean;
  onPresetChange: (preset: ExportScale, raw: number) => void;
}) {
  const preset = customScale ? "custom" : scaleToPreset(scale);

  return (
    <Select
      value={preset}
      disabled={disabled}
      onValueChange={(v) => {
        const p = v as ExportScale;
        if (p === "custom") {
          onPresetChange("custom", scale);
        } else {
          onPresetChange(p, Number(p));
        }
      }}
    >
      <SelectTrigger
        className={cn(
          "h-6 w-14 shrink-0 px-1.5 !text-[11px]",
          controlChromeClass,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {SCALE_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value} className="!text-[11px]">
              {p.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function ExportSettingsPanel({
  value,
  onChange,
  onExport,
  formats = DEFAULT_FORMATS,
  labels,
  disabled = false,
  exporting = false,
  className,
}: ExportSettingsPanelProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const isDisabled = disabled || exporting;

  // Multi-row internal state — primary row is kept in sync with the `value` prop
  const [rows, setRows] = useState<ExportRow[]>(() => [rowFromValue(value)]);

  useEffect(() => {
    setRows((prev) => [
      {
        ...prev[0],
        scale: value.scale,
        format: value.format,
        suffix: value.suffix,
      },
      ...prev.slice(1),
    ]);
  }, [value.format, value.scale, value.suffix]);

  function patchRow(id: number, patch: Partial<ExportRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    // Report primary row changes to the parent via `onChange`
    if (id === rows[0]?.id) {
      const next = { ...rows[0], ...patch };
      const parent: Partial<ExportSettingsValue> = {};
      if ("scale" in patch) parent.scale = next.scale;
      if ("format" in patch) parent.format = next.format as ExportFormat;
      if ("suffix" in patch) parent.suffix = next.suffix;
      if (Object.keys(parent).length > 0) onChange(parent);
    }
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        id: nextId(),
        scale: 1,
        format: "png" as ExportFormat,
        suffix: "",
        customScale: false,
      },
    ]);
  }

  function removeRow(id: number) {
    setRows((prev) => {
      // Must keep at least one row
      if (prev.length <= 1) return prev;
      const next = prev.filter((r) => r.id !== id);
      // If the primary (first) row was removed, the new first row becomes primary
      if (prev[0]?.id === id && next[0]) {
        onChange({
          scale: next[0].scale,
          format: next[0].format,
          suffix: next[0].suffix,
        });
      }
      return next;
    });
  }

  function handleExport() {
    if (rows.length === 0) return;
    onExport(
      rows.map((r) => ({ scale: r.scale, format: r.format, suffix: r.suffix })),
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* Section header: title left, "+" right — matches the design editor export header */}
      <div className="flex h-6 items-center justify-between">
        <span className="!text-[11px] font-medium text-muted-foreground">
          {copy.title}
        </span>
        <button
          type="button"
          aria-label={copy.addExport}
          disabled={isDisabled}
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={addRow}
        >
          <IconPlus className="size-3.5" />
        </button>
      </div>

      {/* Export rows: [scale ▾] [format ▾] [suffix] [×] — design-editor compact inline layout */}
      {rows.map((row) => (
        <ExportRow
          key={row.id}
          row={row}
          formats={formats}
          labels={copy}
          isDisabled={isDisabled}
          canRemove={rows.length > 1}
          onPatchRow={patchRow}
          onRemoveRow={removeRow}
        />
      ))}

      {/* Export button — full width at bottom, design-editor style */}
      <Button
        type="button"
        variant="outline"
        disabled={isDisabled}
        onClick={handleExport}
        className={cn("h-6 w-full px-2 !text-[11px]", controlChromeClass)}
      >
        <IconDownload className="size-3.5" />
        {copy.export}
      </Button>
    </div>
  );
}

/** A single export row: [scale ▾ or custom input] [format ▾] [suffix] [×] */
function ExportRow({
  row,
  formats,
  labels,
  isDisabled,
  canRemove,
  onPatchRow,
  onRemoveRow,
}: {
  row: ExportRow;
  formats: ExportFormat[];
  labels: ExportSettingsPanelLabels;
  isDisabled: boolean;
  canRemove: boolean;
  onPatchRow: (id: number, patch: Partial<ExportRow>) => void;
  onRemoveRow: (id: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Scale — dropdown (presets) or freeform input when "Custom…" selected */}
      {row.customScale ? (
        <Input
          type="number"
          value={row.scale}
          disabled={isDisabled}
          // Bounds match the exporter's real clamp ([0.1, 4]); see
          // DesignEditor handleDownload* . Previously the field accepted up to
          // 100x but the exporter silently clamped to 4x with no feedback.
          min={MIN_EXPORT_SCALE}
          max={MAX_EXPORT_SCALE}
          step={0.5}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (!Number.isNaN(parsed) && parsed > 0) {
              const clamped = Math.min(
                MAX_EXPORT_SCALE,
                Math.max(MIN_EXPORT_SCALE, parsed),
              );
              onPatchRow(row.id, { scale: clamped });
            }
          }}
          onBlur={() => {
            // Switch back to preset dropdown if the typed value matches a preset
            if (scaleToPreset(row.scale) !== "custom") {
              onPatchRow(row.id, { customScale: false });
            }
          }}
          className={cn(
            "h-6 w-14 shrink-0 px-1.5 !text-[11px] tabular-nums md:!text-[11px]",
            controlChromeClass,
          )}
          aria-label="Scale"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      ) : (
        <ScaleSelect
          scale={row.scale}
          customScale={false}
          disabled={isDisabled}
          onPresetChange={(preset, raw) => {
            if (preset === "custom") {
              onPatchRow(row.id, { customScale: true });
            } else {
              onPatchRow(row.id, { scale: raw, customScale: false });
            }
          }}
        />
      )}

      {/* Format dropdown — PNG / JPG / SVG / PDF / WEBP */}
      <Select
        value={row.format}
        disabled={isDisabled}
        onValueChange={(format) =>
          onPatchRow(row.id, { format: format as ExportFormat })
        }
      >
        <SelectTrigger
          className={cn(
            "h-6 min-w-0 flex-1 px-1.5 !text-[11px]",
            controlChromeClass,
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {formats.map((format) => (
              <SelectItem
                key={format}
                value={format}
                className="!text-[11px] uppercase"
              >
                {format.toUpperCase()}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {/* Suffix input — e.g. "@2x", "-mobile" */}
      <Input
        value={row.suffix}
        disabled={isDisabled}
        onChange={(e) => onPatchRow(row.id, { suffix: e.target.value })}
        placeholder={labels.suffix}
        className={cn(
          "h-6 min-w-0 flex-1 px-1.5 !text-[11px] md:!text-[11px]",
          controlChromeClass,
        )}
        aria-label={labels.suffix}
      />

      {/* Remove row button — matches the design editor's × on each export entry */}
      <button
        type="button"
        aria-label={labels.removeExport}
        disabled={isDisabled || !canRemove}
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        onClick={() => onRemoveRow(row.id)}
      >
        <IconX className="size-3" />
      </button>
    </div>
  );
}
