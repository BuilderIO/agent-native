import { useT } from "@agent-native/core/client";
import {
  IconBrandApple,
  IconBrandChrome,
  IconBrandWindows,
  IconChevronDown,
  IconDeviceDesktop,
  IconExternalLink,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  attemptOpenDesktopApp,
  clipsChromeExtensionEnabled,
  clipsChromeExtensionUrl,
  hasDownloadedDesktopApp,
} from "@/lib/capture-install-options";
import { cn } from "@/lib/utils";

/**
 * SSR-safe read of the "already downloaded" hint. Drives CTA wording only; the
 * click always tries to open the app and falls back to the download page.
 */
function useHasDownloadedDesktopApp(): boolean {
  const [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    setDownloaded(hasDownloadedDesktopApp());
  }, []);
  return downloaded;
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

      <button
        type="button"
        onClick={() => attemptOpenDesktopApp(desktopHref)}
        className="flex w-full items-start gap-3 rounded-md border border-border p-3 text-start transition hover:bg-accent"
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
      </button>
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
  const label = downloaded ? (downloadedChildren ?? children) : children;

  // Once downloaded (or after a successful launch), the CTA opens the app
  // directly — no installer chooser. Not-yet-downloaded users still see the
  // Chrome/desktop choice when the extension is available.
  if (downloaded || !clipsChromeExtensionEnabled) {
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
  const label = downloaded ? (downloadedChildren ?? children) : children;

  if (downloaded || !clipsChromeExtensionEnabled) {
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
