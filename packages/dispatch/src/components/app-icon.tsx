import {
  IconActivity,
  IconApps,
  IconBrain,
  IconBrush,
  IconCalendar,
  IconChartBar,
  IconClipboardList,
  IconFileText,
  IconMail,
  IconPhoto,
  IconPlugConnected,
  IconPresentation,
  IconPuzzle,
  IconScreenShare,
} from "@tabler/icons-react";
import type { CSSProperties } from "react";

import { cn } from "../lib/utils";

type AppIconComponent = typeof IconApps;

const FALLBACK_ICONS: AppIconComponent[] = [
  IconApps,
  IconPuzzle,
  IconActivity,
  IconPlugConnected,
];

const APP_ICON_TONES = [
  "bg-primary/10 text-primary",
  "bg-secondary text-secondary-foreground",
  "bg-accent text-accent-foreground",
  "bg-muted text-foreground",
] as const;

const ICONS_BY_KEY: Record<string, AppIconComponent> = {
  barchart2: IconChartBar,
  brain: IconBrain,
  brush: IconBrush,
  calendardays: IconCalendar,
  chartbar: IconChartBar,
  clipboardlist: IconClipboardList,
  filetext: IconFileText,
  galleryhorizontal: IconPresentation,
  mail: IconMail,
  photo: IconPhoto,
  presentation: IconPresentation,
  screenshare: IconScreenShare,
};

function appIconComponent(
  id: string,
  name: string,
  iconKey?: string,
): AppIconComponent {
  const normalizedIconKey = iconKey?.trim().toLowerCase();
  if (normalizedIconKey && ICONS_BY_KEY[normalizedIconKey]) {
    return ICONS_BY_KEY[normalizedIconKey];
  }

  const haystack = `${id} ${name}`.toLowerCase();

  if (haystack.includes("mail") || haystack.includes("email")) {
    return IconMail;
  }
  if (
    haystack.includes("analytics") ||
    haystack.includes("metric") ||
    haystack.includes("indicator") ||
    haystack.includes("gtm")
  ) {
    return IconChartBar;
  }
  if (haystack.includes("coach") || haystack.includes("agent")) {
    return IconBrain;
  }

  let hash = 0;
  for (const character of `${id}:${name}`) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return FALLBACK_ICONS[Math.abs(hash) % FALLBACK_ICONS.length] ?? IconApps;
}

function safeHexColor(color: string | undefined): string | null {
  const normalized = color?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : null;
}

export function AppIcon({
  id,
  name,
  icon,
  color,
  className,
  size = "md",
  monochrome = false,
}: {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  className?: string;
  size?: "sm" | "md";
  monochrome?: boolean;
}) {
  const Icon = appIconComponent(id, name, icon);
  const customColor = safeHexColor(color);
  const tone =
    APP_ICON_TONES[Math.abs(hashForApp(id, name)) % APP_ICON_TONES.length];
  const style = customColor
    ? ({
        "--dispatch-app-icon-color": customColor,
        backgroundColor:
          "color-mix(in srgb, var(--dispatch-app-icon-color) 14%, transparent)",
        color: "var(--dispatch-app-icon-color)",
      } as CSSProperties)
    : ({
        "--dispatch-app-icon-hue": `${appHue(id, name)} 72% 44%`,
        backgroundColor: "hsl(var(--dispatch-app-icon-hue) / 0.14)",
        color: "hsl(var(--dispatch-app-icon-hue))",
      } as CSSProperties);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl",
        size === "sm" ? "size-8" : "size-10",
        monochrome
          ? "bg-transparent text-sidebar-foreground/70"
          : !customColor && tone,
        className,
      )}
      style={monochrome ? undefined : style}
    >
      <Icon size={size === "sm" ? 16 : 19} stroke={1.8} />
    </span>
  );
}

function hashForApp(id: string, name: string): number {
  let hash = 0;
  for (const character of `${id}:${name}`) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return hash;
}

function appHue(id: string, name: string): number {
  return 20 + (Math.abs(hashForApp(id, name)) % 320);
}
