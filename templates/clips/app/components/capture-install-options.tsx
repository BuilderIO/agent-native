import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBrandApple,
  IconBrandChrome,
  IconBrandWindows,
  IconChevronDown,
  IconDeviceDesktop,
  IconExternalLink,
} from "@tabler/icons-react";
import { type ReactNode, useState, useSyncExternalStore } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  attemptOpenDesktopApp,
  clipsChromeExtensionUrl,
  hasDownloadedDesktopApp,
  subscribeDownloaded,
  useClipsChromeExtensionEnabled,
} from "@/lib/capture-install-options";
import { cn } from "@/lib/utils";

// SSR snapshot is always false; same-tab markDesktopAppDownloaded() notifies
// subscribers so mounted CTAs flip to "Open" without a reload.
function useHasDownloadedDesktopApp(): boolean {
  return useSyncExternalStore(
    subscribeDownloaded,
    hasDownloadedDesktopApp,
    () => false,
  );
}

type PopoverPlacement = {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
};

type CaptureInstallButtonProps = Omit<ButtonProps, "asChild"> &
  PopoverPlacement & {
    children: ReactNode;
    /** Label shown once the desktop app has been downloaded. */
    downloadedChildren?: ReactNode;
    desktopHref?: string;
  };

type CaptureInstallInlineLinkProps = PopoverPlacement & {
  children: ReactNode;
  /** Label shown once the desktop app has been downloaded. */
  downloadedChildren?: ReactNode;
  className?: string;
  desktopHref?: string;
};

/**
 * The desktop-app tile shows the icon for the visitor's current OS — Apple on
 * macOS, Windows on Windows — and falls back to a neutral desktop glyph on other
 * platforms or during SSR. The Chrome tile always uses the Chrome brand icon.
 */
function desktopOsIcon(): typeof IconDeviceDesktop {
  if (typeof navigator === "undefined") return IconDeviceDesktop;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return IconBrandWindows;
  if (/Mac|iPhone|iPad/i.test(ua)) return IconBrandApple;
  return IconDeviceDesktop;
}

function InstallOptionsContent({ desktopHref = "/download" }) {
  const t = useT();
  const chromeAvailable = Boolean(clipsChromeExtensionUrl);
  const DesktopIcon = desktopOsIcon();

  return (
    <div className="grid gap-2">
      {chromeAvailable ? (
        <a
          href={clipsChromeExtensionUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 rounded-md border border-border p-3 text-start transition hover:bg-accent"
        >
          <IconBrandChrome className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {t("captureInstall.chromeTitle")}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {t("captureInstall.chromeDescription")}
            </span>
          </span>
          <IconExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </a>
      ) : (
        <div className="flex items-start gap-3 rounded-md border border-dashed border-border p-3 text-start opacity-70">
          <IconBrandChrome className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {t("captureInstall.chromeTitle")}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {t("captureInstall.chromePendingDescription")}
            </span>
          </span>
        </div>
      )}

      <a
        href={appPath(desktopHref)}
        className="flex items-start gap-3 rounded-md border border-border p-3 text-start transition hover:bg-accent"
      >
        <DesktopIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {t("captureInstall.desktopTitle")}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {t("captureInstall.desktopDescription")}
          </span>
        </span>
      </a>
    </div>
  );
}

export function CaptureInstallButton({
  children,
  downloadedChildren,
  className,
  desktopHref = "/download",
  align = "end",
  side = "bottom",
  ...buttonProps
}: CaptureInstallButtonProps) {
  const downloaded = useHasDownloadedDesktopApp();
  const chromeExtensionEnabled = useClipsChromeExtensionEnabled();
  const label = downloaded ? (downloadedChildren ?? children) : children;

  if (downloaded) {
    const { onClick, ...restButtonProps } = buttonProps;
    return (
      <Button
        className={className}
        {...restButtonProps}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          attemptOpenDesktopApp(desktopHref);
        }}
      >
        {label}
      </Button>
    );
  }

  if (!chromeExtensionEnabled) {
    return (
      <Button asChild className={className} {...buttonProps}>
        <a href={appPath(desktopHref)}>{label}</a>
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className={className} {...buttonProps}>
          {label}
          <IconChevronDown className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-80 p-3">
        <InstallOptionsContent desktopHref={desktopHref} />
      </PopoverContent>
    </Popover>
  );
}

export function CaptureInstallInlineLink({
  children,
  downloadedChildren,
  className,
  desktopHref = "/download",
  align = "start",
  side = "bottom",
}: CaptureInstallInlineLinkProps) {
  const downloaded = useHasDownloadedDesktopApp();
  const chromeExtensionEnabled = useClipsChromeExtensionEnabled();

  const label = downloaded ? (downloadedChildren ?? children) : children;

  if (downloaded) {
    return (
      <button
        type="button"
        onClick={() => attemptOpenDesktopApp(desktopHref)}
        className={cn("cursor-pointer", className)}
      >
        {label}
      </button>
    );
  }

  if (!chromeExtensionEnabled) {
    return (
      <a href={appPath(desktopHref)} className={className}>
        {label}
      </a>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("cursor-pointer", className)}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-80 p-3">
        <InstallOptionsContent desktopHref={desktopHref} />
      </PopoverContent>
    </Popover>
  );
}

export interface CaptureInstallIconLinksProps {
  desktopHref?: string;
  className?: string;
  label?: ReactNode;
}

type HoveredInstallOption = "chrome" | "desktop" | null;

const ICON_LINK_CLASS =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground";

/**
 * Compact "Download <Chrome> <Desktop>" install affordance, all on one line.
 * Hovering (or focusing) an icon reveals its description on a line of its
 * own, absolutely positioned below the row so it never pushes or jitters
 * the row itself (or anything above it) as it appears/disappears. Both
 * icons open their destination in a new tab — this control never navigates
 * the current recorder tab away from the in-progress setup.
 */
export function CaptureInstallIconLinks({
  desktopHref = "/download",
  className,
  label,
}: CaptureInstallIconLinksProps) {
  const t = useT();
  const downloaded = useHasDownloadedDesktopApp();
  const chromeExtensionEnabled = useClipsChromeExtensionEnabled();
  const DesktopIcon = desktopOsIcon();
  const [hovered, setHovered] = useState<HoveredInstallOption>(null);
  const desktopLabel = downloaded
    ? t("captureInstall.openDesktopApp")
    : t("captureInstall.desktopTitle");
  const hoverTitle =
    hovered === "chrome"
      ? t("captureInstall.chromeHoverTitle")
      : hovered === "desktop"
        ? t("captureInstall.desktopHoverTitle")
        : null;
  const hoverDescription =
    hovered === "chrome"
      ? t("captureInstall.chromeHoverDescription")
      : hovered === "desktop"
        ? t("captureInstall.desktopHoverDescription")
        : null;

  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>{label ?? t("recordRoute.downloadLabel")}</span>
      {chromeExtensionEnabled && clipsChromeExtensionUrl ? (
        <a
          href={clipsChromeExtensionUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={t("captureInstall.chromeTitle")}
          className={ICON_LINK_CLASS}
          onMouseEnter={() => setHovered("chrome")}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered("chrome")}
          onBlur={() => setHovered(null)}
        >
          <IconBrandChrome className="h-4 w-4" />
        </a>
      ) : null}
      {downloaded ? (
        <button
          type="button"
          onClick={() => attemptOpenDesktopApp(desktopHref)}
          aria-label={desktopLabel}
          className={ICON_LINK_CLASS}
          onMouseEnter={() => setHovered("desktop")}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered("desktop")}
          onBlur={() => setHovered(null)}
        >
          <DesktopIcon className="h-4 w-4" />
        </button>
      ) : (
        <a
          href={appPath(desktopHref)}
          target="_blank"
          rel="noreferrer"
          aria-label={desktopLabel}
          className={ICON_LINK_CLASS}
          onMouseEnter={() => setHovered("desktop")}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered("desktop")}
          onBlur={() => setHovered(null)}
        >
          <DesktopIcon className="h-4 w-4" />
        </a>
      )}
      {hoverTitle && hoverDescription ? (
        <div
          role="status"
          className="absolute inset-x-0 top-full mt-1.5 text-center leading-snug"
        >
          <p className="text-[11px] font-medium text-foreground">
            {hoverTitle}
          </p>
          <p className="text-[11px]">{hoverDescription}</p>
        </div>
      ) : null}
    </div>
  );
}
