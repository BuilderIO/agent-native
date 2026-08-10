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
}: {
  id: string;
  name: string;
  icon?: string;
}) {
  const normalized = `${id} ${name}`.toLowerCase();
  const Icon =
    (icon && APP_ICON_MAP[icon]) ||
    (normalized.includes("mail") ? IconMail : null) ||
    (normalized.includes("calendar") ? IconCalendar : null) ||
    IconStack2;
  return <Icon size={16} strokeWidth={1.8} aria-hidden="true" />;
}

export function CodeAgentsFallbackAppIcon() {
  return <IconApps size={16} strokeWidth={1.8} aria-hidden="true" />;
}
