import { useT } from "@agent-native/core/client/i18n";
import {
  isInteractThemeMode,
  type InteractThemeMode,
} from "@shared/preview-color-scheme";
import {
  IconAspectRatio,
  IconArrowLeft,
  IconArrowRight,
  IconChevronDown,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconMoon,
  IconRefresh,
  IconSun,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  resolveActiveInteractRoute,
  type InteractRoute,
} from "@/pages/design-editor/interact-routes";
import {
  findInteractDevicePreset,
  INTERACT_CUSTOM_DEVICE_NAME,
  SELECTABLE_INTERACT_DEVICE_PRESETS,
  type InteractDeviceCategory,
} from "@/pages/design-editor/responsive-interact";

import {
  TOP_BAR_SELECT_TRIGGER_CLASS,
  TopBarIconAction,
  TopBarRouteLabel,
  TopBarStatusDot,
} from "./top-bar-controls";

const MENU_CONTENT_Z = "z-[100030]";

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

/**
 * Device presets for the previewed screen. A screen whose size matches no
 * preset shows read-only as "Custom · W×H": the size can only change in Design.
 */
export function InteractDevicePicker({
  deviceName,
  width,
  height,
  onChange,
}: {
  deviceName: string;
  width: number;
  height: number;
  onChange: (name: string) => void;
}) {
  const t = useT();
  const preset = findInteractDevicePreset(deviceName);
  const isCustom = !preset || preset.category === "custom";
  const customLabel = t("designEditor.responsiveInteract.deviceCustom", {
    width,
    height,
  });
  const label = isCustom ? customLabel : deviceName;
  return (
    <Select
      value={isCustom ? INTERACT_CUSTOM_DEVICE_NAME : deviceName}
      onValueChange={onChange}
    >
      <SelectTrigger
        size="sm"
        data-design-interact-device
        aria-label={t("designEditor.responsiveInteract.device")}
        className={TOP_BAR_SELECT_TRIGGER_CLASS}
      >
        <SelectValue>
          <span className="flex min-w-0 items-center gap-1.5">
            <DeviceCategoryIcon
              category={preset?.category ?? "custom"}
              className="size-4 shrink-0 text-muted-foreground xl:hidden"
            />
            <span className="hidden truncate xl:inline">{label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={MENU_CONTENT_Z}>
        {isCustom ? (
          <SelectItem
            value={INTERACT_CUSTOM_DEVICE_NAME}
            disabled
            className="!text-xs"
          >
            <span className="flex w-full items-center gap-2">
              <DeviceCategoryIcon
                category="custom"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="flex-1 truncate">{customLabel}</span>
            </span>
          </SelectItem>
        ) : null}
        {SELECTABLE_INTERACT_DEVICE_PRESETS.map((option) => (
          <SelectItem
            key={option.name}
            value={option.name}
            className="!text-xs"
          >
            <span className="flex w-full items-center gap-2">
              <DeviceCategoryIcon
                category={option.category}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="flex-1 truncate">{option.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground/60">
                {option.width}×{option.height}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const THEME_OPTIONS: ReadonlyArray<{
  mode: InteractThemeMode;
  labelKey: string;
  Icon: Icon;
}> = [
  {
    mode: "light",
    labelKey: "designEditor.responsiveInteract.themeLight",
    Icon: IconSun,
  },
  {
    mode: "dark",
    labelKey: "designEditor.responsiveInteract.themeDark",
    Icon: IconMoon,
  },
];

/**
 * Light / Dark for the preview. With no dark styles in the design Dark is
 * marked unavailable and says why on hover; picking it is still reported, so
 * the editor can ask the agent to add them.
 */
export function InteractThemePicker({
  mode,
  canPick,
  darkAvailable,
  onChange,
}: {
  mode: InteractThemeMode;
  /** False when the page cannot take the theme override at all. */
  canPick: boolean;
  darkAvailable: boolean;
  onChange: (mode: InteractThemeMode) => void;
}) {
  const t = useT();
  const current =
    THEME_OPTIONS.find((option) => option.mode === mode) ?? THEME_OPTIONS[0]!;
  const trigger = (
    <button
      type="button"
      disabled={!canPick}
      data-design-interact-theme
      aria-label={t("designEditor.responsiveInteract.theme")}
      className={cn(
        "flex items-center rounded-md border border-border bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        TOP_BAR_SELECT_TRIGGER_CLASS,
        // A disabled button swallows pointer events, so the tooltip's wrapper
        // has to be the thing the pointer lands on.
        canPick ? "cursor-pointer" : "pointer-events-none",
      )}
    >
      <current.Icon className="size-4 shrink-0" />
      <span className="hidden truncate lg:inline">{t(current.labelKey)}</span>
      <IconChevronDown className="size-4 shrink-0 opacity-50" />
    </button>
  );
  if (!canPick) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            data-design-interact-theme-unavailable
            className="inline-flex cursor-not-allowed"
          >
            {trigger}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("designEditor.responsiveInteract.themeUnavailable")}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("min-w-32 rounded-lg", MENU_CONTENT_Z)}
      >
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(next) => {
            if (isInteractThemeMode(next)) onChange(next);
          }}
        >
          {THEME_OPTIONS.map(({ mode: optionMode, labelKey, Icon: Glyph }) => {
            const unavailable = optionMode === "dark" && !darkAvailable;
            const item = (
              <DropdownMenuRadioItem
                key={optionMode}
                value={optionMode}
                indicator="check"
                data-design-theme-unavailable={unavailable || undefined}
                className={cn("gap-2 text-xs", unavailable && "opacity-60")}
              >
                <Glyph className="size-4 shrink-0 text-muted-foreground" />
                {t(labelKey)}
              </DropdownMenuRadioItem>
            );
            if (!unavailable) return item;
            return (
              <Tooltip key={optionMode}>
                <TooltipTrigger asChild>{item}</TooltipTrigger>
                <TooltipContent side="right">
                  {t("designEditor.responsiveInteract.themeNoDarkStyles")}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface InteractRouteControlsProps {
  routes: readonly InteractRoute[];
  activeScreenId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onSelect: (screenId: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  className?: string;
}

/**
 * Back and forward through the screens visited, a route dropdown over the
 * design's screens, and reload. Below `sm` only the dropdown stays. The
 * dropdown shows the active page, or the first page when none is active.
 */
export function InteractRouteControls({
  routes,
  activeScreenId,
  canGoBack,
  canGoForward,
  onSelect,
  onBack,
  onForward,
  onReload,
  className,
}: InteractRouteControlsProps) {
  const t = useT();
  const active = resolveActiveInteractRoute(routes, activeScreenId);
  return (
    <div
      data-design-interact-routes
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
        <TopBarIconAction
          label={t("designEditor.responsiveInteract.back")}
          disabled={!canGoBack}
          onClick={onBack}
        >
          <IconArrowLeft className="size-4 rtl:-scale-x-100" />
        </TopBarIconAction>
        <TopBarIconAction
          label={t("designEditor.responsiveInteract.forward")}
          disabled={!canGoForward}
          onClick={onForward}
        >
          <IconArrowRight className="size-4 rtl:-scale-x-100" />
        </TopBarIconAction>
      </div>
      <Select
        value={active?.screenId ?? ""}
        onValueChange={onSelect}
        disabled={!active}
      >
        <SelectTrigger
          size="sm"
          data-design-interact-route
          aria-label={t("designEditor.responsiveInteract.route")}
          className={cn(
            TOP_BAR_SELECT_TRIGGER_CLASS,
            "w-66 min-w-24 max-w-full shrink justify-between",
          )}
        >
          <SelectValue>
            <span className="flex min-w-0 items-center gap-1">
              <TopBarStatusDot />
              {active ? (
                <TopBarRouteLabel title={active.title} route={active.route} />
              ) : null}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className={MENU_CONTENT_Z}>
          {routes.map((route) => (
            <SelectItem
              key={route.screenId}
              value={route.screenId}
              className="!text-xs"
            >
              <TopBarRouteLabel title={route.title} route={route.route} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="hidden shrink-0 items-center sm:flex">
        <TopBarIconAction
          label={t("designEditor.responsiveInteract.reload")}
          onClick={onReload}
        >
          <IconRefresh className="size-4" />
        </TopBarIconAction>
      </div>
    </div>
  );
}

/**
 * The preview scales to fit the canvas, so the zoom is a reading, not a
 * control: a menu here would offer steps the preview then ignores.
 */
export function InteractZoomReadout({ zoom }: { zoom: number }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          data-design-interact-zoom
          className="inline-flex h-6 items-center rounded-md border border-border px-2 text-xs tabular-nums text-foreground"
        >
          {Math.round(zoom)}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t("designEditor.responsiveInteract.zoomFit")}
      </TooltipContent>
    </Tooltip>
  );
}

export interface InteractFloatingBarProps {
  devicePicker: ReactNode;
  themePicker: ReactNode;
  routeControls: ReactNode;
  onExit: () => void;
  className?: string;
}

/**
 * Minimal UI hides the top bar, and with it the mode switch that leaves
 * Interact, so the same controls float with an explicit exit.
 */
export function InteractFloatingBar({
  devicePicker,
  themePicker,
  routeControls,
  onExit,
  className,
}: InteractFloatingBarProps) {
  const t = useT();
  return (
    <div
      data-design-interact-floating-bar
      className={cn(
        "pointer-events-auto flex h-10 w-full max-w-170 min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-[var(--design-editor-panel-bg)] px-2 shadow-xl",
        className,
      )}
    >
      {devicePicker}
      {themePicker}
      <div className="flex min-w-0 flex-1 justify-center">{routeControls}</div>
      <TopBarIconAction
        label={t("designEditor.responsiveInteract.exit")}
        onClick={onExit}
      >
        <IconX className="size-4" />
      </TopBarIconAction>
    </div>
  );
}
