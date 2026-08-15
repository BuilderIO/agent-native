import type { AppConfig } from "@agent-native/shared-app-config";
import {
  IconBrain,
  IconCalendar,
  IconChartBar,
  IconCode,
  IconFileText,
  IconLayoutBoard,
  IconListCheck,
  IconMail,
  IconMessageCircle,
  IconPhoto,
  IconPresentation,
  IconRoute,
  IconScreenShare,
  IconSettings,
  IconStack2,
  IconUsers,
} from "@tabler/icons-react-native";
import type { ColorValue } from "react-native";
import { Text, TouchableOpacity, View } from "react-native";

type AppIconComponent = React.ComponentType<{
  color?: ColorValue;
  size?: number;
  strokeWidth?: number;
}>;

const ICON_MAP: Record<string, AppIconComponent> = {
  BarChart2: IconChartBar,
  Brain: IconBrain,
  CalendarDays: IconCalendar,
  Code: IconCode,
  FileText: IconFileText,
  GalleryHorizontal: IconPresentation,
  LayoutBoard: IconLayoutBoard,
  ListCheck: IconListCheck,
  Mail: IconMail,
  MessageCircle: IconMessageCircle,
  Photo: IconPhoto,
  Route: IconRoute,
  ScreenShare: IconScreenShare,
  Settings: IconSettings,
  Users: IconUsers,
};

const APP_ICON_COLOR = "#d4d4d8";
const APP_ICON_BACKGROUND = "#27272a";

export function appAccentColor(
  _app: Pick<AppConfig, "id" | "name" | "color">,
): string {
  return APP_ICON_COLOR;
}

export function appAccentBackgroundColor(_color: string): string {
  return APP_ICON_BACKGROUND;
}

export function AppIcon({
  iconName,
  size,
  color,
}: {
  iconName: string;
  size: number;
  color: ColorValue;
}) {
  const Icon = ICON_MAP[iconName] ?? IconStack2;
  return <Icon color={color} size={size} strokeWidth={1.8} />;
}

interface AppCardProps {
  app: AppConfig;
  onPress: () => void;
  onLongPress?: () => void;
}

export default function AppCard({ app, onPress, onLongPress }: AppCardProps) {
  const accentColor = appAccentColor(app);

  return (
    <TouchableOpacity
      className="flex-1 bg-card-dark border border-border-dark rounded-2xl p-4 m-1.5 items-center min-h-32 active:opacity-75"
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View
        className="w-14 h-14 rounded-xl items-center justify-center mb-2.5"
        style={{ backgroundColor: appAccentBackgroundColor(accentColor) }}
      >
        <AppIcon iconName={app.icon} size={28} color={accentColor} />
      </View>
      <Text
        className="text-white text-sm font-semibold mb-0.75"
        numberOfLines={1}
      >
        {app.name}
      </Text>
    </TouchableOpacity>
  );
}
