import { useT } from "@agent-native/core/client/i18n";
import {
  IconAspectRatio,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconScribble,
  IconTransformPoint,
  IconX,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  findInteractDevicePreset,
  INTERACT_DEVICE_PRESETS,
  type InteractDeviceCategory,
} from "@/pages/design-editor/responsive-interact";

const MODE_EXITS = [
  {
    mode: "edit",
    labelKey: "designEditor.modes.edit",
    Icon: IconTransformPoint,
  },
  {
    mode: "annotate",
    labelKey: "designEditor.modes.annotate",
    Icon: IconScribble,
  },
] as const;

function DeviceCategoryIcon({
  category,
  className,
}: {
  category: InteractDeviceCategory;
  className?: string;
}) {
  switch (category) {
    case "phone":
      return <IconDeviceMobile className={className} />;
    case "tablet":
      return <IconDeviceTablet className={className} />;
    case "desktop":
      return <IconDeviceLaptop className={className} />;
    case "custom":
      return <IconAspectRatio className={className} />;
  }
}

function DimensionInput({
  value,
  onChange,
  label,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  ariaLabel: string;
}) {
  return (
    <div className="relative flex items-center">
      <span className="pointer-events-none absolute left-2 !text-[11px] text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(next) && next > 0) onChange(next);
        }}
        aria-label={ariaLabel}
        className="h-7 w-[88px] rounded-md !pl-6 !pr-2 !text-[12px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}

export interface ResponsiveInteractBarProps {
  deviceName: string;
  width: number;
  height: number;
  onDeviceChange: (name: string) => void;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  onModeChange: (mode: "edit" | "annotate") => void;
  canAnnotate: boolean;
  onClose: () => void;
  showClose?: boolean;
  className?: string;
}

export function ResponsiveInteractExitButton({
  onClose,
  className,
}: {
  onClose: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClose}
      aria-label={t("designEditor.responsiveInteract.exit")}
      className={cn(
        "h-7 shrink-0 cursor-pointer gap-1.5 rounded-md px-2 !text-[12px] text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <IconX className="size-4" />
      {t("designEditor.responsiveInteract.exit")}
    </Button>
  );
}

export function ResponsiveInteractBar({
  deviceName,
  width,
  height,
  onDeviceChange,
  onWidthChange,
  onHeightChange,
  onModeChange,
  canAnnotate,
  onClose,
  showClose = true,
  className,
}: ResponsiveInteractBarProps) {
  const t = useT();
  const selectedDevice = findInteractDevicePreset(deviceName);

  return (
    <div
      className={cn(
        "flex h-12 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-[var(--design-editor-panel-bg)] px-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-[220px] flex-1 items-center gap-2">
          <Select value={deviceName} onValueChange={onDeviceChange}>
            <SelectTrigger
              className="h-8 w-full max-w-60 gap-1.5 rounded-md !text-[12px]"
              aria-label={t("designEditor.responsiveInteract.device")}
            >
              <SelectValue>
                <span className="flex min-w-0 items-center gap-2">
                  <DeviceCategoryIcon
                    category={selectedDevice?.category ?? "custom"}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">{deviceName}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-[100030]">
              {INTERACT_DEVICE_PRESETS.map((preset) => (
                <SelectItem
                  key={preset.name}
                  value={preset.name}
                  className="!text-[12px]"
                >
                  <span className="flex w-full items-center gap-2">
                    <DeviceCategoryIcon
                      category={preset.category}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="flex-1 truncate">{preset.name}</span>
                    {preset.category !== "custom" ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground/60">
                        {preset.width}×{preset.height}
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <DimensionInput
            value={width}
            onChange={onWidthChange}
            label={t("designEditor.responsiveInteract.widthAbbreviation")}
            ariaLabel={t("designEditor.responsiveInteract.width")}
          />
          <DimensionInput
            value={height}
            onChange={onHeightChange}
            label={t("designEditor.responsiveInteract.heightAbbreviation")}
            ariaLabel={t("designEditor.responsiveInteract.height")}
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1">
          {MODE_EXITS.filter((exit) => exit.mode === "edit" || canAnnotate).map(
            (exit) => (
              <Tooltip key={exit.mode}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onModeChange(exit.mode)}
                    aria-label={t(exit.labelKey)}
                    className="size-7 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <exit.Icon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t(exit.labelKey)}
                </TooltipContent>
              </Tooltip>
            ),
          )}
        </div>
      </div>
      {showClose ? (
        <div className="flex shrink-0 items-center bg-[var(--design-editor-panel-bg)] pl-1">
          <ResponsiveInteractExitButton onClose={onClose} />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="invisible flex shrink-0 items-center pl-1"
        >
          <Button
            variant="ghost"
            size="sm"
            disabled
            tabIndex={-1}
            className="h-7 shrink-0 gap-1.5 rounded-md px-2 !text-[12px]"
          >
            <IconX className="size-4" />
            {t("designEditor.responsiveInteract.exit")}
          </Button>
        </div>
      )}
    </div>
  );
}
