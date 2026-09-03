import { useT } from "@agent-native/core/client/i18n";
import {
  IconAspectRatio,
  IconChevronDown,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconScribble,
  IconTransformPoint,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

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
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  clampZoom,
  getNextZoomStepDown,
  getNextZoomStepUp,
} from "@/pages/design-editor/overview-camera";
import {
  findInteractDevicePreset,
  formatInteractZoom,
  INTERACT_DEVICE_PRESETS,
  type InteractDeviceCategory,
} from "@/pages/design-editor/responsive-interact";

/** Reference-bar zoom range (matches builder-internal's ResponsiveEditingMode
 * clamp(zoom, 10, 200)) — deliberately narrower than the general canvas zoom
 * range, since this scales a literal device box rather than a free canvas. */
const INTERACT_ZOOM_MIN = 10;
const INTERACT_ZOOM_MAX = 200;
const ZOOM_PRESET_BUTTONS = [50, 75, 100] as const;

/** Same labels/icons as the bottom toolbar's mode tabs, which this bar stands
 * in for while Interact owns the surface. */
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
  zoom: number;
  onDeviceChange: (name: string) => void;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  onZoomChange: (zoom: number) => void;
  /**
   * Leave Interact for a canvas mode. The bottom toolbar (which owns the mode
   * tabs) is hidden while Interact owns the surface, so without this the only
   * exit is Close. The handler must route through `resolveModeChangeView` so
   * Edit/Annotate land on the infinite canvas rather than the forbidden
   * single-screen editing state.
   */
  onModeChange: (mode: "edit" | "annotate") => void;
  /** Annotate is editor-only; commenters get Edit alone. */
  canAnnotate: boolean;
  onClose: () => void;
  className?: string;
}

/**
 * Responsive Interact mode's top chrome bar: device preset + editable W/H
 * (typing switches the preset to "Custom", same as builder-internal's
 * ResponsiveEditingMode) and a zoom popover. Ported to this app's shadcn
 * primitives — see templates/design's frontend rules for why this isn't MUI.
 */
export function ResponsiveInteractBar({
  deviceName,
  width,
  height,
  zoom,
  onDeviceChange,
  onWidthChange,
  onHeightChange,
  onZoomChange,
  onModeChange,
  canAnnotate,
  onClose,
  className,
}: ResponsiveInteractBarProps) {
  const t = useT();
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomDraft, setZoomDraft] = useState(formatInteractZoom(zoom));
  const selectedDevice = findInteractDevicePreset(deviceName);
  const formattedZoom = formatInteractZoom(zoom);

  const commitZoomDraft = () => {
    const parsed = Number.parseFloat(zoomDraft);
    if (Number.isFinite(parsed)) {
      onZoomChange(clampZoom(parsed, INTERACT_ZOOM_MIN, INTERACT_ZOOM_MAX));
    } else {
      setZoomDraft(formattedZoom);
    }
  };

  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center justify-between gap-3 overflow-x-auto border-b border-border bg-[var(--design-editor-panel-bg)] px-3",
        className,
      )}
    >
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
              <TooltipContent side="bottom">{t(exit.labelKey)}</TooltipContent>
            </Tooltip>
          ),
        )}
        <Separator orientation="vertical" className="mx-1 !h-5" />

        <Popover
          open={zoomOpen}
          onOpenChange={(open) => {
            setZoomOpen(open);
            if (open) setZoomDraft(formattedZoom);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 cursor-pointer gap-0.5 rounded-md px-2 !text-[12px] tabular-nums text-muted-foreground hover:text-foreground"
            >
              {formattedZoom}%
              <IconChevronDown className="size-3 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="z-[100030] w-44 space-y-1.5 p-2"
          >
            <Input
              autoFocus
              type="number"
              value={zoomDraft}
              onChange={(event) => setZoomDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitZoomDraft();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setZoomDraft(formattedZoom);
                }
              }}
              onBlur={commitZoomDraft}
              aria-label={t("designEditor.responsiveInteract.zoom")}
              className="h-7 !text-[12px] tabular-nums"
            />
            <Separator />
            <Button
              variant="ghost"
              size="sm"
              disabled={zoom >= INTERACT_ZOOM_MAX}
              onClick={() => {
                onZoomChange(
                  getNextZoomStepUp(zoom, {
                    min: INTERACT_ZOOM_MIN,
                    max: INTERACT_ZOOM_MAX,
                  }),
                );
                setZoomOpen(false);
              }}
              className="h-7 w-full cursor-pointer justify-start rounded-md px-2 !text-[12px]"
            >
              {t("designEditor.responsiveInteract.zoomIn")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={zoom <= INTERACT_ZOOM_MIN}
              onClick={() => {
                onZoomChange(
                  getNextZoomStepDown(zoom, {
                    min: INTERACT_ZOOM_MIN,
                    max: INTERACT_ZOOM_MAX,
                  }),
                );
                setZoomOpen(false);
              }}
              className="h-7 w-full cursor-pointer justify-start rounded-md px-2 !text-[12px]"
            >
              {t("designEditor.responsiveInteract.zoomOut")}
            </Button>
            <Separator />
            {ZOOM_PRESET_BUTTONS.map((preset) => (
              <Button
                key={preset}
                variant="ghost"
                size="sm"
                onClick={() => {
                  onZoomChange(preset);
                  setZoomOpen(false);
                }}
                className="h-7 w-full cursor-pointer justify-start rounded-md px-2 !text-[12px]"
              >
                {t("designEditor.responsiveInteract.zoomToPreset", {
                  percent: preset,
                })}
              </Button>
            ))}
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label={t("designEditor.responsiveInteract.exit")}
              className="size-7 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
            >
              <IconX className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("designEditor.responsiveInteract.exit")}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
