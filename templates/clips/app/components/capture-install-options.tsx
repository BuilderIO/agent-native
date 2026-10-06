import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBrandApple,
  IconBrandChrome,
  IconBrandUbuntu,
  IconBrandWindows,
  IconChevronDown,
  IconDeviceDesktop,
} from "@tabler/icons-react";
import {
  type ComponentProps,
  type ReactNode,
  useSyncExternalStore,
} from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    downloadedChildren?: ReactNode;
    desktopHref?: string;
  };

type CaptureInstallInlineLinkProps = PopoverPlacement & {
  children: ReactNode;
  downloadedChildren?: ReactNode;
  className?: string;
  desktopHref?: string;
};

function desktopOsIcon(): typeof IconDeviceDesktop {
  if (typeof navigator === "undefined") return IconDeviceDesktop;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return IconBrandWindows;
  if (/Mac|iPhone|iPad/i.test(ua)) return IconBrandApple;
  if (/Linux/i.test(ua)) return IconBrandUbuntu;
  return IconDeviceDesktop;
}

const subscribeToDesktopPlatform = () => () => undefined;

export function DesktopPlatformIcon(
  props: ComponentProps<typeof IconDeviceDesktop>,
) {
  const DesktopIcon = useSyncExternalStore(
    subscribeToDesktopPlatform,
    desktopOsIcon,
    () => IconDeviceDesktop,
  );
  return <DesktopIcon {...props} />;
}

function InstallOptionsContent({ desktopHref = "/download" }) {
  const t = useT();
  const chromeAvailable = Boolean(clipsChromeExtensionUrl);
  return (
    <div className="grid gap-1">
      <a
        href={appPath(desktopHref)}
        className="flex items-start gap-3 rounded-md px-2.5 py-2 text-start transition hover:bg-accent"
      >
        <DesktopPlatformIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {t("captureInstall.desktopTitle")}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {t("captureInstall.desktopDescription")}
          </span>
        </span>
      </a>

      {chromeAvailable && (
        <div aria-hidden="true" className="mx-2 h-px bg-border" />
      )}

      {chromeAvailable ? (
        <a
          href={clipsChromeExtensionUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 rounded-md px-2.5 py-2 text-start transition hover:bg-accent"
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
        </a>
      ) : (
        <div className="flex items-start gap-3 rounded-md px-2.5 py-2 text-start opacity-70">
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
    </div>
  );
}

export function CaptureInstallButton({
  children,
  downloadedChildren,
  className,
  desktopHref = "/download",
  align = "center",
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

export function CaptureInstallMenu({
  children,
  className,
  desktopHref = "/download",
  size = "sm",
  variant = "ghost",
  ...buttonProps
}: Omit<CaptureInstallButtonProps, "downloadedChildren">) {
  const t = useT();
  const downloaded = useHasDownloadedDesktopApp();
  const chromeExtensionEnabled = useClipsChromeExtensionEnabled();

  if (downloaded) {
    const { onClick, ...restButtonProps } = buttonProps;
    return (
      <Button
        className={className}
        size={size}
        variant={variant}
        {...restButtonProps}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          attemptOpenDesktopApp(desktopHref);
        }}
      >
        <DesktopPlatformIcon aria-hidden="true" className="size-4" />
        {children}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={className}
          size={size}
          variant={variant}
          {...buttonProps}
        >
          <DesktopPlatformIcon aria-hidden="true" className="size-4" />
          {children}
          <IconChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-52">
        <DropdownMenuItem asChild>
          <a href={appPath(desktopHref)} className="gap-2">
            <DesktopPlatformIcon aria-hidden="true" className="size-4" />
            {t("recordRoute.downloadDesktopApp")}
          </a>
        </DropdownMenuItem>
        {chromeExtensionEnabled && clipsChromeExtensionUrl ? (
          <DropdownMenuItem asChild>
            <a
              href={clipsChromeExtensionUrl}
              target="_blank"
              rel="noreferrer"
              className="gap-2"
            >
              <IconBrandChrome aria-hidden="true" className="size-4" />
              {t("recordRoute.getChromeExtension")}
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className="gap-2">
            <IconBrandChrome aria-hidden="true" className="size-4" />
            {t("recordRoute.getChromeExtension")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
