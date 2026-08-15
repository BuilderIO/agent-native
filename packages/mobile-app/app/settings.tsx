import type { AppConfig } from "@agent-native/shared-app-config";
import {
  IconChevronLeft,
  IconPencil,
  IconPlus,
  IconRotateClockwise,
  IconTrash,
} from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { AppIcon } from "@/components/AppCard";
import AppForm from "@/components/AppForm";
import DictationSettings from "@/components/DictationSettings";
import { SafeAreaView } from "@/components/uniwind-interop";
import { useApps } from "@/lib/use-apps";

export default function SettingsScreen() {
  const router = useRouter();
  const { apps, updateApp, addApp, removeApp, resetToDefaults } = useApps();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingApp, setEditingApp] = useState<AppConfig | undefined>();

  const handleToggle = useCallback(
    (id: string, enabled: boolean) => {
      void updateApp(id, { enabled });
    },
    [updateApp],
  );

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
      Alert.alert("Remove app", `Remove “${app.name}” from this phone?`, [
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
      "Reset to defaults",
      "This restores the default app list and removes any custom apps. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: resetToDefaults },
      ],
    );
  }, [resetToDefaults]);

  const enabledCount = apps.filter((app) => app.enabled).length;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
      <ScrollView contentContainerStyle={{ paddingBottom: 36 }}>
        <View className="items-center flex-row gap-2.5 px-4 pt-1">
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
            className="items-center bg-card-dark border border-border-dark rounded-full h-11 w-11 justify-center active:opacity-75"
          >
            <IconChevronLeft color="#f4f4f5" size={22} strokeWidth={1.8} />
          </Pressable>
          <View className="flex-1">
            <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px]">
              THIS PHONE
            </Text>
            <Text className="text-foreground text-[30px] font-bold tracking-[-1px] mt-0.5">
              Settings
            </Text>
          </View>
        </View>

        <DictationSettings />

        <View className="px-4 pt-6 gap-3">
          <View>
            <Text className="text-white text-lg font-bold">Workspace apps</Text>
            <Text className="text-text-muted text-xs leading-4 mt-0.5">
              {enabledCount} of {apps.length} shown in Apps. Turn one off to
              hide it without removing it.
            </Text>
          </View>

          <View className="bg-card-dark border border-border-dark rounded-2xl overflow-hidden">
            {apps.map((app, index) => (
              <View
                key={app.id}
                className={`items-center flex-row gap-3 px-3.5 py-3 ${
                  index > 0 ? "border-t border-border-dark" : ""
                }`}
              >
                <View className="items-center justify-center bg-gray-medium-dark rounded-xl h-10 w-10">
                  <AppIcon color="#f4f4f5" iconName={app.icon} size={19} />
                </View>
                <View className="flex-1">
                  <Text className="text-white text-[15px] font-semibold">
                    {app.name}
                  </Text>
                  <Text
                    className="text-status-gray text-xs mt-0.5"
                    numberOfLines={1}
                  >
                    {app.url.replace(/^https?:\/\//, "")}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel={`Edit ${app.name}`}
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => setEditingApp(app)}
                  className="items-center justify-center h-9 w-9 active:opacity-70"
                >
                  <IconPencil color="#a1a1aa" size={17} strokeWidth={1.9} />
                </Pressable>
                {app.isBuiltIn ? null : (
                  <Pressable
                    accessibilityLabel={`Remove ${app.name}`}
                    accessibilityRole="button"
                    hitSlop={6}
                    onPress={() => handleRemove(app)}
                    className="items-center justify-center h-9 w-9 active:opacity-70"
                  >
                    <IconTrash color="#fb7185" size={17} strokeWidth={1.9} />
                  </Pressable>
                )}
                <Switch
                  value={app.enabled}
                  onValueChange={(next) => handleToggle(app.id, next)}
                  trackColor={{ false: "#27272a", true: "#4a5c30" }}
                  thumbColor={app.enabled ? "#c7f36b" : "#71717a"}
                />
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAddForm(true)}
            className="items-center bg-card-dark border border-border-dark rounded-2xl flex-row justify-center gap-2 p-3.5 active:opacity-75"
          >
            <IconPlus color="#c7f36b" size={19} strokeWidth={2.1} />
            <Text className="text-text-light text-[15px] font-semibold">
              Add custom app
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={handleReset}
            className="items-center flex-row justify-center gap-2 p-3 active:opacity-70"
          >
            <IconRotateClockwise color="#fb7185" size={16} strokeWidth={1.9} />
            <Text className="text-status-error text-[13px] font-medium">
              Reset to defaults
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <AppForm
        visible={showAddForm}
        onClose={() => setShowAddForm(false)}
        onSave={(app) => {
          void addApp(app);
          setShowAddForm(false);
        }}
      />

      {editingApp && (
        <AppForm
          visible
          onClose={() => setEditingApp(undefined)}
          onSave={handleSaveEdit}
          editApp={editingApp}
        />
      )}
    </SafeAreaView>
  );
}
