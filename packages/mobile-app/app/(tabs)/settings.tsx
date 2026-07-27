import type { AppConfig } from "@agent-native/shared-app-config";
import { Feather } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import {
  Alert,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import AppForm from "@/components/AppForm";
import DictationSettings from "@/components/DictationSettings";
import { SafeAreaView } from "@/components/uniwind-interop";
import { useApps } from "@/lib/use-apps";

export default function SettingsScreen() {
  const { apps, updateApp, addApp, removeApp, resetToDefaults } = useApps();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingApp, setEditingApp] = useState<AppConfig | undefined>();

  const handleToggle = useCallback(
    (id: string, enabled: boolean) => {
      void updateApp(id, { enabled });
    },
    [updateApp],
  );

  const handleEdit = useCallback((app: AppConfig) => {
    setEditingApp(app);
  }, []);

  const handleSaveEdit = useCallback(
    (app: AppConfig) => {
      if (editingApp) {
        void updateApp(app.id, app);
      } else {
        void addApp(app);
      }
      setEditingApp(undefined);
    },
    [editingApp, updateApp, addApp],
  );

  const handleRemove = useCallback(
    (app: AppConfig) => {
      Alert.alert("Remove App", `Remove "${app.name}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeApp(app.id),
        },
      ]);
    },
    [removeApp],
  );

  const handleReset = useCallback(() => {
    Alert.alert(
      "Reset to Defaults",
      "This will restore the default app list and remove any custom apps. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: resetToDefaults,
        },
      ],
    );
  }, [resetToDefaults]);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
      <ScrollView>
        <DictationSettings />

        {/* Installed Apps */}
        <Text className="text-gray-light text-[13px] font-semibold uppercase tracking-[0.5px] px-4 pt-5 pb-2">
          Installed Apps
        </Text>
        {apps.map((app) => (
          <View
            key={app.id}
            className="flex-row items-center justify-between px-4 py-3 border-b border-gray-dark"
          >
            <View className="flex-row items-center flex-1">
              <View className="flex-1">
                <Text className="text-white text-base font-medium">
                  {app.name}
                </Text>
                <Text
                  className="text-gray-medium text-xs mt-0.5"
                  numberOfLines={1}
                >
                  {app.url}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => handleEdit(app)}
                className="p-1.5 active:opacity-75"
              >
                <Feather name="edit-2" size={16} color="#888888" />
              </TouchableOpacity>
              {!app.isBuiltIn && (
                <TouchableOpacity
                  onPress={() => handleRemove(app)}
                  className="p-1.5 active:opacity-75"
                >
                  <Feather name="trash-2" size={16} color="#EF4444" />
                </TouchableOpacity>
              )}
              <Switch
                value={app.enabled}
                onValueChange={(v) => handleToggle(app.id, v)}
                trackColor={{ false: "#333333", true: "#555555" }}
                thumbColor={app.enabled ? "#ffffff" : "#666666"}
              />
            </View>
          </View>
        ))}

        {/* Actions */}
        <View className="p-4 gap-3">
          <TouchableOpacity
            className="flex-row items-center justify-center bg-gray-dark rounded-xl p-3.5 gap-2 border border-[#33333366] active:opacity-75"
            onPress={() => setShowAddForm(true)}
          >
            <Feather name="plus" size={18} color="#ffffff" />
            <Text className="text-white text-base font-medium">
              Add Custom App
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center justify-center p-3.5 gap-2 active:opacity-75"
            onPress={handleReset}
          >
            <Feather name="rotate-ccw" size={16} color="#EF4444" />
            <Text className="text-error text-sm">Reset to Defaults</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Add form */}
      <AppForm
        visible={showAddForm}
        onClose={() => setShowAddForm(false)}
        onSave={(app) => {
          void addApp(app);
          setShowAddForm(false);
        }}
      />

      {/* Edit form */}
      {editingApp && (
        <AppForm
          visible={true}
          onClose={() => setEditingApp(undefined)}
          onSave={handleSaveEdit}
          editApp={editingApp}
        />
      )}
    </SafeAreaView>
  );
}
