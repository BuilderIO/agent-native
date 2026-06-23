import { type ReactNode } from "react";
import { Link } from "react-router";
import {
  IconBrowser,
  IconChevronDown,
  IconDeviceDesktop,
  IconExternalLink,
} from "@tabler/icons-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  clipsChromeExtensionEnabled,
  clipsChromeExtensionUrl,
} from "@/lib/capture-install-options";

type PopoverPlacement = {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
};

type CaptureInstallButtonProps = Omit<ButtonProps, "asChild"> &
  PopoverPlacement & {
    children: ReactNode;
    desktopHref?: string;
  };

type CaptureInstallInlineLinkProps = PopoverPlacement & {
  children: ReactNode;
  className?: string;
  desktopHref?: string;
};

function InstallOptionsContent({ desktopHref = "/download" }) {
  const chromeAvailable = Boolean(clipsChromeExtensionUrl);

  return (
    <div className="grid gap-2">
      <div className="px-1 pb-1">
        <div className="text-sm font-medium text-popover-foreground">
          Choose your recorder
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Use Chrome when you need browser logs, or desktop for the smoothest
          everyday capture.
        </p>
      </div>

      {chromeAvailable ? (
        <a
          href={clipsChromeExtensionUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 rounded-md border border-border p-3 text-left transition hover:bg-accent"
        >
          <IconBrowser className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Chrome extension</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              Best when you want redacted console and network diagnostics from
              the browser tab.
            </span>
          </span>
          <IconExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </a>
      ) : (
        <div className="flex items-start gap-3 rounded-md border border-dashed border-border p-3 text-left opacity-70">
          <IconBrowser className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Chrome extension</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              Browser logs option is ready, pending the Chrome Web Store URL.
            </span>
          </span>
        </div>
      )}

      <Link
        to={desktopHref}
        className="flex items-start gap-3 rounded-md border border-border p-3 text-left transition hover:bg-accent"
      >
        <IconDeviceDesktop className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Desktop app</span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            Most seamless for global shortcuts, menu-bar recording, meetings,
            and repeat captures.
          </span>
        </span>
      </Link>
    </div>
  );
}

export function CaptureInstallButton({
  children,
  className,
  desktopHref = "/download",
  align = "end",
  side = "bottom",
  ...buttonProps
}: CaptureInstallButtonProps) {
  if (!clipsChromeExtensionEnabled) {
    return (
      <Button asChild className={className} {...buttonProps}>
        <Link to={desktopHref}>{children}</Link>
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className={className} {...buttonProps}>
          {children}
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
  className,
  desktopHref = "/download",
  align = "start",
  side = "bottom",
}: CaptureInstallInlineLinkProps) {
  if (!clipsChromeExtensionEnabled) {
    return (
      <Link to={desktopHref} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("cursor-pointer", className)}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-80 p-3">
        <InstallOptionsContent desktopHref={desktopHref} />
      </PopoverContent>
    </Popover>
  );
}
