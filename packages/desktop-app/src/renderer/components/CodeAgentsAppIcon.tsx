import {
  IconApps,
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

const APP_ICON_MAP: Record<string, typeof IconStack2> = {
  Mail: IconMail,
  CalendarDays: IconCalendar,
  FileText: IconFileText,
  LayoutBoard: IconLayoutBoard,
  BarChart2: IconChartBar,
  GalleryHorizontal: IconPresentation,
  BrandJira: IconBrandJira,
  Users: IconUsers,
  Code: IconCode,
  MessageCircle: IconMessageCircle,
  Route: IconRoute,
  Brain: IconBrain,
  Globe: IconBrandChrome,
  Photo: IconPhoto,
  ListCheck: IconListCheck,
  Folder: IconFolder,
  Settings: IconSettings,
};

export default function CodeAgentsAppIcon({
  id,
  name,
  icon,
  color,
}: {
  id: string;
  name: string;
  icon?: string;
  color?: string;
}) {
  const normalized = `${id} ${name}`.toLowerCase();
  const Icon =
    (icon && APP_ICON_MAP[icon]) ||
    (normalized.includes("mail") ? IconMail : null) ||
    (normalized.includes("calendar") ? IconCalendar : null) ||
    IconStack2;
  const customColor = color?.trim();
  let hash = 0;
  for (const character of `${id}:${name}`) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  const hue = 20 + (Math.abs(hash) % 320);
  return (
    <span
      className="desktop-app-icon"
      style={
        {
          "--desktop-app-icon-color":
            customColor && /^#[0-9a-f]{6}$/i.test(customColor)
              ? customColor
              : undefined,
          "--desktop-app-icon-hue": `${hue} 72% 44%`,
        } as CSSProperties
      }
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

export function CodeAgentsFallbackAppIcon() {
  return <IconApps size={16} strokeWidth={1.8} aria-hidden="true" />;
}
