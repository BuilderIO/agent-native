import type { AppConfig } from "@agent-native/shared-app-config";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";

const ICON_MAP: Record<string, keyof typeof Feather.glyphMap> = {
  Mail: "mail",
  CalendarDays: "calendar",
  FileText: "file-text",
  LayoutBoard: "trello",
  Contract: "edit-3",
  BarChart2: "bar-chart-2",
  GalleryHorizontal: "layout",
  Video: "video",
  Image: "image",
  Globe: "globe",
  Code: "code",
  Database: "database",
  MessageSquare: "message-square",
  Route: "shuffle",
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
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <AppIcon iconName={app.icon} size={28} color="#ffffff" />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {app.name}
      </Text>
      <Text style={styles.description} numberOfLines={2}>
        {app.description}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    padding: 16,
    margin: 6,
    alignItems: "center",
    minHeight: 130,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    backgroundColor: "#252525",
  },
  name: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 3,
  },
  description: {
    color: "#888888",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 15,
  },
});
