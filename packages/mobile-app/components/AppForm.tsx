import type { AppConfig } from "@agent-native/shared-app-config";
import { generateAppId } from "@agent-native/shared-app-config";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";

const ICON_PRESETS: { name: string; icon: keyof typeof Feather.glyphMap }[] = [
  { name: "Globe", icon: "globe" },
  { name: "Mail", icon: "mail" },
  { name: "Calendar", icon: "calendar" },
  { name: "FileText", icon: "file-text" },
  { name: "BarChart2", icon: "bar-chart-2" },
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
  const [description, setDescription] = useState(editApp?.description ?? "");
  const [icon, setIcon] = useState(editApp?.icon ?? "Globe");

  const isEditing = !!editApp;

  function handleSave() {
    if (!name.trim()) {
      Alert.alert("Error", "App name is required");
      return;
    }
    if (!url.trim()) {
      Alert.alert("Error", "URL is required");
      return;
    }

    // Basic URL validation
    try {
      new URL(url.trim());
    } catch {
      Alert.alert("Error", "Please enter a valid URL");
      return;
    }

    const config: AppConfig = {
      id: editApp?.id ?? generateAppId(),
      name: name.trim(),
      icon,
      description: description.trim() || name.trim(),
      url: url.trim(),
      devPort: 0,
      devUrl: editApp?.devUrl,
      devCommand: editApp?.devCommand,
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
      statusBarTranslucent={true}
      navigationBarTranslucent={true}
      onRequestClose={() => {
        onClose();
      }}
    >
      <SafeAreaView className="flex-1 bg-background-pure">
        <View className="flex-row justify-between items-center px-4 pt-4 pb-3 border-b border-border-dark">
          <TouchableOpacity onPress={onClose} className="active:opacity-75">
            <Text className="text-status-gray text-base">Cancel</Text>
          </TouchableOpacity>
          <Text className="text-white text-lg font-bold">
            {isEditing ? "Edit App" : "Add App"}
          </Text>
          <TouchableOpacity onPress={handleSave} className="active:opacity-75">
            <Text className="text-white text-base font-bold">Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 p-4" keyboardShouldPersistTaps="handled">
          <Text className="text-text-muted text-xs font-semibold mt-4 mb-1.5 uppercase tracking-wider">
            Name *
          </Text>
          <TextInput
            className="bg-card-dark rounded-lg p-3.5 text-white text-base border border-border-dark"
            value={name}
            onChangeText={setName}
            placeholder="My App"
            placeholderTextColor="#555555"
          />

          <Text className="text-text-muted text-xs font-semibold mt-4 mb-1.5 uppercase tracking-wider">
            URL *
          </Text>
          <TextInput
            className="bg-card-dark rounded-lg p-3.5 text-white text-base border border-border-dark"
            value={url}
            onChangeText={setUrl}
            placeholder="https://myapp.example.com"
            placeholderTextColor="#555555"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text className="text-text-muted text-xs font-semibold mt-4 mb-1.5 uppercase tracking-wider">
            Description
          </Text>
          <TextInput
            className="bg-card-dark rounded-lg p-3.5 text-white text-base border border-border-dark"
            value={description}
            onChangeText={setDescription}
            placeholder="What does this app do?"
            placeholderTextColor="#555555"
          />

          <Text className="text-text-muted text-xs font-semibold mt-4 mb-1.5 uppercase tracking-wider">
            Icon
          </Text>
          <View className="flex-row flex-wrap gap-2.5">
            {ICON_PRESETS.map(({ name: iconName, icon: featherIcon }) => (
              <TouchableOpacity
                key={iconName}
                className={`w-11 h-11 rounded-lg bg-card-dark items-center justify-center border border-gray-border-light active:opacity-75 ${
                  icon === iconName ? "border-white border-2" : ""
                }`}
                onPress={() => setIcon(iconName)}
              >
                <Feather name={featherIcon} size={22} color="#ffffff" />
              </TouchableOpacity>
            ))}
          </View>

          <View className="h-10" />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
