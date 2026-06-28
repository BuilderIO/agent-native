import { IconDownload } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {copy.title}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={disabled || exporting}
          onClick={() => onExport(value)}
          className="h-8 px-2 text-xs"
        >
          <IconDownload className="size-4" />
          {copy.export}
        </Button>
      </div>

      <ScrubInput
        label={copy.scale}
        value={value.scale}
        onChange={(scale) => onChange({ scale })}
        unit="x"
        min={0.1}
        max={10}
        step={0.5}
        precision={2}
        disabled={disabled || exporting}
      />

      <div className="flex items-center gap-2">
        <Label className="w-20 shrink-0 text-xs text-muted-foreground">
          {copy.format}
        </Label>
        <Select
          value={value.format}
          disabled={disabled || exporting}
          onValueChange={(format) =>
            onChange({ format: format as ExportFormat })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {formats.map((format) => (
                <SelectItem
                  key={format}
                  value={format}
                  className="text-xs uppercase"
                >
                  {format.toUpperCase()}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Label className="w-20 shrink-0 text-xs text-muted-foreground">
          {copy.suffix}
        </Label>
        <Input
          value={value.suffix}
          disabled={disabled || exporting}
          onChange={(event) => onChange({ suffix: event.target.value })}
          placeholder="@2x"
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}
