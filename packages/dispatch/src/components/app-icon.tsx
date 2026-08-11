import {
  IconBrain,
  IconBrandChrome,
  IconBrandJira,
  IconCalendar,
  IconChartBar,
  IconCode,
  IconFileText,
  IconFolder,
  IconLayoutBoard,
  IconListCheck,
  IconMail,
  IconMessageCircle,
  IconPhoto,
  IconPresentation,
  IconRoute,
  IconSettings,
  IconStack2,
  IconUsers,
} from "@tabler/icons-react";
import type { CSSProperties } from "react";

import { cn } from "../lib/utils";

type AppIconComponent = typeof IconStack2;

const ICONS_BY_KEY: Record<string, AppIconComponent> = {
  barchart2: IconChartBar,
  brandjira: IconBrandJira,
  brain: IconBrain,
  calendardays: IconCalendar,
  calendarmonth: IconCalendar,
  chartbar: IconChartBar,
  code: IconCode,
  filetext: IconFileText,
  folder: IconFolder,
  galleryhorizontal: IconPresentation,
  globe: IconBrandChrome,
  layoutboard: IconLayoutBoard,
  listcheck: IconListCheck,
  mail: IconMail,
  messagecircle: IconMessageCircle,
  photo: IconPhoto,
  presentation: IconPresentation,
  route: IconRoute,
  settings: IconSettings,
  stack2: IconStack2,
  users: IconUsers,
};

/** Keep the Dispatch rail visually identical to the desktop app for first-party apps. */
const APP_VISUALS_BY_ID: Record<
  string,
  { icon: AppIconComponent; colorRgb: string }
> = {
  analytics: { icon: IconChartBar, colorRgb: "245 158 11" },
  assets: { icon: IconPhoto, colorRgb: "15 118 110" },
  brain: { icon: IconBrain, colorRgb: "139 92 246" },
  calendar: { icon: IconCalendar, colorRgb: "0 181 255" },
  chat: { icon: IconMessageCircle, colorRgb: "24 24 27" },
  clips: { icon: IconStack2, colorRgb: "14 165 233" },
  content: { icon: IconFileText, colorRgb: "16 185 129" },
  crm: { icon: IconUsers, colorRgb: "37 99 235" },
  design: { icon: IconStack2, colorRgb: "244 114 182" },
  dispatch: { icon: IconRoute, colorRgb: "20 184 166" },
  factory: { icon: IconUsers, colorRgb: "124 58 237" },
  forms: { icon: IconStack2, colorRgb: "6 182 212" },
  macros: { icon: IconCode, colorRgb: "113 113 122" },
  mail: { icon: IconMail, colorRgb: "59 130 246" },
  plan: { icon: IconLayoutBoard, colorRgb: "82 82 91" },
  slides: { icon: IconPresentation, colorRgb: "236 72 153" },
  tasks: { icon: IconListCheck, colorRgb: "99 102 241" },
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

  const standardVisuals = APP_VISUALS_BY_ID[id.trim().toLowerCase()];
  if (standardVisuals) return standardVisuals.icon;

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
  return IconStack2;
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
  const standardColorRgb = APP_VISUALS_BY_ID[id.trim().toLowerCase()]?.colorRgb;
  const style = customColor
    ? ({
        "--dispatch-app-icon-color": customColor,
        backgroundColor:
          "color-mix(in srgb, var(--dispatch-app-icon-color) 14%, transparent)",
        color: "var(--dispatch-app-icon-color)",
      } as CSSProperties)
    : standardColorRgb
      ? ({
          "--dispatch-app-icon-color-rgb": standardColorRgb,
          backgroundColor: "rgb(var(--dispatch-app-icon-color-rgb) / 0.14)",
          color: "rgb(var(--dispatch-app-icon-color-rgb))",
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
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "sm" ? "size-7" : "size-10",
        monochrome && "bg-transparent text-sidebar-foreground/70",
        className,
      )}
      style={monochrome ? undefined : style}
    >
      <Icon size={size === "sm" ? 15 : 19} strokeWidth={1.8} />
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
