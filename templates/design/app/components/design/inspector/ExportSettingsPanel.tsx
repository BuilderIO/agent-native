import { IconDownload, IconPlus, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { ScrubInput } from "./ScrubInput";

export type ExportFormat = "png" | "jpg" | "svg" | "pdf";

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
}

export interface ExportSettingsPanelProps {
  value: ExportSettingsValue;
  onChange: (patch: Partial<ExportSettingsValue>) => void;
  onExport: (settings: ExportSettingsValue) => void;
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
};

const DEFAULT_FORMATS: ExportFormat[] = ["png", "jpg", "svg", "pdf"];

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

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* Section header: title left, "+" right — matches Figma export header */}
      <div className="flex h-6 items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          {copy.title}
        </span>
        <button
          type="button"
          aria-label="Add export setting"
          disabled={isDisabled}
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            /* single-value interface: noop — the setting already exists */
          }}
        >
          <IconPlus className="size-3.5" />
        </button>
      </div>

      {/* Export row: [scale] [format] [suffix] [×] — Figma compact inline layout */}
      <div className="flex items-center gap-1">
        {/* Scale scrub — compact, no label, unit "x" shown inline */}
        <ScrubInput
          label=""
          value={value.scale}
          onChange={(scale) => onChange({ scale })}
          unit="x"
          min={0.1}
          max={10}
          step={0.5}
          precision={2}
          disabled={isDisabled}
          inputClassName="h-6 w-12 text-[11px]"
          className="shrink-0"
        />

        {/* Format dropdown */}
        <Select
          value={value.format}
          disabled={isDisabled}
          onValueChange={(format) =>
            onChange({ format: format as ExportFormat })
          }
        >
          <SelectTrigger className="h-6 min-w-0 flex-1 px-1.5 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {formats.map((format) => (
                <SelectItem
                  key={format}
                  value={format}
                  className="text-[11px] uppercase"
                >
                  {format.toUpperCase()}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {/* Suffix input */}
        <Input
          value={value.suffix}
          disabled={isDisabled}
          onChange={(event) => onChange({ suffix: event.target.value })}
          placeholder="@2x"
          className="h-6 min-w-0 flex-1 px-1.5 text-[11px]"
        />

        {/* Remove row button — matches Figma's × on each export entry */}
        <button
          type="button"
          aria-label="Remove export setting"
          disabled={isDisabled}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            /* single-value interface: noop */
          }}
        >
          <IconX className="size-3" />
        </button>
      </div>

      {/* Export button — full width at bottom, Figma style */}
      <Button
        type="button"
        variant="outline"
        disabled={isDisabled}
        onClick={() => onExport(value)}
        className="h-6 w-full px-2 text-[11px]"
      >
        <IconDownload className="size-3.5" />
        {copy.export}
      </Button>
    </div>
  );
}
