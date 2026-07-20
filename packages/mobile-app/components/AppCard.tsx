import type { AppConfig } from "@agent-native/shared-app-config";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { View, Text, TouchableOpacity } from "react-native";

const ICON_MAP: Record<string, keyof typeof Feather.glyphMap> = {
  Mail: "mail",
  CalendarDays: "calendar",
  FileText: "file-text",
  LayoutBoard: "trello",
  BarChart2: "bar-chart-2",
  GalleryHorizontal: "layout",
  Image: "image",
  Globe: "globe",
  Code: "code",
  Database: "database",
  MessageSquare: "message-square",
  Route: "shuffle",
  ListCheck: "check-square",
  Settings: "settings",
};

function getFeatherIcon(iconName: string): keyof typeof Feather.glyphMap {
  return ICON_MAP[iconName] ?? "box";
}

function AppIcon({
  iconName,
  size,
  color,
}: {
  iconName: string;
  size: number;
  color: string;
}) {
  if (iconName === "Brain") {
    return <MaterialCommunityIcons name="brain" size={size} color={color} />;
  }

  return <Feather name={getFeatherIcon(iconName)} size={size} color={color} />;
}

interface AppCardProps {
  app: AppConfig;
  onPress: () => void;
  onLongPress?: () => void;
}

export default function AppCard({ app, onPress, onLongPress }: AppCardProps) {
  return (
    <TouchableOpacity
      className="flex-1 bg-gray-dark rounded-2xl p-4 m-1.5 items-center min-h-32 active:opacity-75"
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View className="w-14 h-14 rounded-xl items-center justify-center mb-2.5 bg-gray-medium-dark">
        <AppIcon iconName={app.icon} size={28} color="#ffffff" />
      </View>
      <Text
        className="text-white text-sm font-semibold mb-0.75"
        numberOfLines={1}
      >
        {app.name}
      </Text>
      <Text
        className="text-status-gray text-xs text-center leading-4"
        numberOfLines={2}
      >
        {app.description}
      </Text>
    </TouchableOpacity>
  );
}
