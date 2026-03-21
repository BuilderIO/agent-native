import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { AppConfig } from "@agent-native/shared-app-config";
import { generateAppId } from "@agent-native/shared-app-config";

const COLOR_PRESETS = [
  "#3B82F6",
  "#8B5CF6",
  "#10B981",
  "#F59E0B",
  "#EC4899",
  "#EF4444",
  "#06B6D4",
  "#F97316",
  "#84CC16",
  "#6366F1",
];

const ICON_PRESETS: { name: string; icon: keyof typeof Feather.glyphMap }[] = [
  { name: "Globe", icon: "globe" },
  { name: "Mail", icon: "mail" },
  { name: "Calendar", icon: "calendar" },
  { name: "FileText", icon: "file-text" },
  { name: "BarChart2", icon: "bar-chart-2" },
  { name: "Video", icon: "video" },
  { name: "Image", icon: "image" },
  { name: "Code", icon: "code" },
  { name: "Database", icon: "database" },
  { name: "MessageSquare", icon: "message-square" },
  { name: "ShoppingCart", icon: "shopping-cart" },
  { name: "Music", icon: "music" },
];

interface AppFormProps {
  visible: boolean;
  onClose: () => void;
  onSave: (app: AppConfig) => void;
  /** If provided, editing an existing app */
  editApp?: AppConfig;
}

export default function AppForm({
  visible,
  onClose,
  onSave,
  editApp,
}: AppFormProps) {
  const [name, setName] = useState(editApp?.name ?? "");
  const [url, setUrl] = useState(editApp?.url ?? "");
  const [devUrl, setDevUrl] = useState(editApp?.devUrl ?? "");
  const [devCommand, setDevCommand] = useState(editApp?.devCommand ?? "");
  const [description, setDescription] = useState(editApp?.description ?? "");
  const [color, setColor] = useState(editApp?.color ?? COLOR_PRESETS[0]);
  const [icon, setIcon] = useState(editApp?.icon ?? "Globe");

  const isEditing = !!editApp;

  function handleSave() {
    if (!name.trim()) {
      Alert.alert("Error", "App name is required");
      return;
    }
    if (!url.trim()) {
      Alert.alert("Error", "Production URL is required");
      return;
    }

    // Basic URL validation
    try {
      new URL(url.trim());
    } catch {
      Alert.alert("Error", "Please enter a valid URL");
      return;
    }

    const hexToRgb = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `${r} ${g} ${b}`;
    };

    const config: AppConfig = {
      id: editApp?.id ?? generateAppId(),
      name: name.trim(),
      icon,
      description: description.trim() || name.trim(),
      url: url.trim(),
      devPort: 0,
      devUrl: devUrl.trim() || undefined,
      devCommand: devCommand.trim() || undefined,
      color,
      colorRgb: hexToRgb(color),
      isBuiltIn: editApp?.isBuiltIn ?? false,
      enabled: editApp?.enabled ?? true,
    };

    onSave(config);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{isEditing ? "Edit App" : "Add App"}</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="My App"
            placeholderTextColor="#555555"
          />

          <Text style={styles.label}>Production URL *</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://myapp.example.com"
            placeholderTextColor="#555555"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Dev URL (optional)</Text>
          <TextInput
            style={styles.input}
            value={devUrl}
            onChangeText={setDevUrl}
            placeholder="http://localhost:3000"
            placeholderTextColor="#555555"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>
            Dev Command (optional, for reference)
          </Text>
          <TextInput
            style={styles.input}
            value={devCommand}
            onChangeText={setDevCommand}
            placeholder="pnpm dev"
            placeholderTextColor="#555555"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="What does this app do?"
            placeholderTextColor="#555555"
          />

          <Text style={styles.label}>Icon</Text>
          <View style={styles.iconGrid}>
            {ICON_PRESETS.map(({ name: iconName, icon: featherIcon }) => (
              <TouchableOpacity
                key={iconName}
                style={[
                  styles.iconChoice,
                  icon === iconName && { borderColor: color, borderWidth: 2 },
                ]}
                onPress={() => setIcon(iconName)}
              >
                <Feather name={featherIcon} size={22} color="#ffffff" />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Color</Text>
          <View style={styles.colorGrid}>
            {COLOR_PRESETS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.colorChoice,
                  { backgroundColor: c },
                  color === c && styles.colorSelected,
                ]}
                onPress={() => setColor(c)}
              />
            ))}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#222222",
  },
  title: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
  cancelText: {
    color: "#888888",
    fontSize: 16,
  },
  saveText: {
    color: "#3B82F6",
    fontSize: 16,
    fontWeight: "600",
  },
  form: {
    flex: 1,
    padding: 16,
  },
  label: {
    color: "#999999",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 16,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#1A1A1A",
    borderRadius: 10,
    padding: 14,
    color: "#ffffff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#222222",
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#1A1A1A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#333333",
  },
  colorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorChoice: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorSelected: {
    borderColor: "#ffffff",
    transform: [{ scale: 1.15 }],
  },
});
