import type { AppConfig } from "@agent-native/shared-app-config";
import {
  IconPencil,
  IconPlus,
  IconRotateClockwise,
  IconTrash,
} from "@tabler/icons-react-native";
import { useCallback, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  appAccentBackgroundColor,
  appAccentColor,
  AppIcon,
} from "@/components/AppCard";
import AppForm from "@/components/AppForm";
import DictationSettings from "@/components/DictationSettings";
import { SafeAreaView } from "@/components/uniwind-interop";
import { supportsMobileTab } from "@/lib/mobile-app-navigation";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { useMobileTabLayout } from "@/lib/mobile-tab-layout";
import {
  setNativeAppAuthEnabled,
  useNativeAppAuthEnabled,
} from "@/lib/native-app-auth";
import { useApps } from "@/lib/use-apps";

function IOSBlueSwitch({
  value,
  onValueChange,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const colors = useMobileThemeColors();
  if (Platform.OS === "web") {
    return (
      <Pressable
        className={`h-5 w-10 justify-center rounded-full p-0.5 ${
          value ? "bg-accent-blue" : "bg-muted"
        } ${disabled ? "opacity-50" : ""}`}
        disabled={disabled}
        onPress={() => onValueChange(!value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
      >
        <View
          className={`h-4 w-4 rounded-full bg-white-pure ${value ? "ml-5" : "ml-0"}`}
        />
      </Pressable>
    );
  }

  return (
    <Switch
      value={value}
      disabled={disabled}
      onValueChange={onValueChange}
      ios_backgroundColor={colors.muted}
      trackColor={{
        false: colors.muted,
        true: colors.accentBlue,
      }}
      thumbColor={value ? colors.primaryForeground : colors.mutedForeground}
    />
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px] px-4 pb-2 pt-6">
      {children}
    </Text>
  );
}

function AppIdentity({ app }: { app: AppConfig }) {
  const accentColor = appAccentColor(app);
  return (
    <View
      className="h-9 w-9 items-center justify-center rounded-xl"
      style={{ backgroundColor: appAccentBackgroundColor(accentColor) }}
    >
      <AppIcon iconName={app.icon} size={18} color={accentColor} />
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useMobileThemeColors();
  const { apps, updateApp, addApp, removeApp, resetToDefaults } = useApps();
  const {
    error: tabLayoutError,
    limit: tabLimit,
    selectedAppIds,
    toggleApp,
  } = useMobileTabLayout(apps);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingApp, setEditingApp] = useState<AppConfig | undefined>();
  const [tabLimitNotice, setTabLimitNotice] = useState<string | null>(null);
  const nativeAppAuthEnabled = useNativeAppAuthEnabled();

  const handleToggle = useCallback(
    (id: string, enabled: boolean) => {
      void updateApp(id, { enabled });
    },
    [updateApp],
  );

  const handleToggleTab = useCallback(
    async (id: string) => {
      const result = await toggleApp(id);
      if (result.ok && result.limitReached) {
        setTabLimitNotice(`Keep up to ${tabLimit} apps beside Chat.`);
      } else if (!result.ok) {
        setTabLimitNotice(result.reason);
      } else {
        setTabLimitNotice(null);
      }
    },
    [tabLimit, toggleApp],
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
    [addApp, editingApp, updateApp],
  );

  const handleRemove = useCallback(
    (app: AppConfig) => {
      Alert.alert("Remove App", `Remove "${app.name}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void removeApp(app.id),
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
          onPress: () => void resetToDefaults(),
        },
      ],
    );
  }, [resetToDefaults]);

  const tabApps = apps.filter((app) => supportsMobileTab(app.id));

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View className="px-4 pb-1 pt-3">
          <Text className="text-foreground text-[30px] font-bold tracking-[-1px]">
            Settings
          </Text>
        </View>

        <SectionLabel>AUTHENTICATION</SectionLabel>
        <View className="flex-row items-center justify-between border-b border-gray-dark px-4 py-3">
          <Text className="flex-1 text-text-light text-[15px] font-medium">
            Shared app sign-in
          </Text>
          <IOSBlueSwitch
            value={nativeAppAuthEnabled}
            onValueChange={(value) => void setNativeAppAuthEnabled(value)}
          />
        </View>

        <SectionLabel>BOTTOM TABS</SectionLabel>
        <View className="flex-row items-center justify-between border-b border-gray-dark px-4 pb-2">
          <Text className="text-text-muted text-xs">
            Chat + {tabLimit} app slots
          </Text>
          <Text className="text-status-gray text-xs">More keeps the rest</Text>
        </View>
        {tabApps.map((app) => {
          const selected = selectedAppIds.includes(app.id);
          return (
            <View
              key={app.id}
              className={`flex-row items-center justify-between border-b border-gray-dark px-4 py-3 ${!app.enabled ? "opacity-45" : ""}`}
            >
              <View className="flex-row items-center flex-1">
                <AppIdentity app={app} />
                <Text className="text-text-light text-[15px] font-medium ml-3">
                  {app.name}
                </Text>
              </View>
              <IOSBlueSwitch
                value={selected}
                disabled={!app.enabled}
                onValueChange={() => void handleToggleTab(app.id)}
              />
            </View>
          );
        })}
        {tabLayoutError || tabLimitNotice ? (
          <Text className="px-4 pt-2 text-warning-yellow-text text-xs">
            {tabLimitNotice ?? tabLayoutError}
          </Text>
        ) : null}

        <SectionLabel>INSTALLED APPS</SectionLabel>
        {apps.map((app) => (
          <View
            key={app.id}
            className="flex-row items-center justify-between border-b border-gray-dark px-4 py-3"
          >
            <View className="flex-row items-center flex-1">
              <AppIdentity app={app} />
              <Text className="text-text-light text-[15px] font-medium ml-3">
                {app.name}
              </Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <TouchableOpacity
                accessibilityLabel={`Edit ${app.name}`}
                onPress={() => handleEdit(app)}
                className="p-1.5 active:opacity-75"
              >
                <IconPencil
                  color={colors.mutedForeground}
                  size={16}
                  strokeWidth={1.8}
                />
              </TouchableOpacity>
              {!app.isBuiltIn && (
                <TouchableOpacity
                  accessibilityLabel={`Remove ${app.name}`}
                  onPress={() => handleRemove(app)}
                  className="p-1.5 active:opacity-75"
                >
                  <IconTrash
                    color={colors.errorText}
                    size={16}
                    strokeWidth={1.8}
                  />
                </TouchableOpacity>
              )}
              <IOSBlueSwitch
                value={app.enabled}
                onValueChange={(value) => handleToggle(app.id, value)}
              />
            </View>
          </View>
        ))}

        <DictationSettings />

        <View className="gap-3 p-4">
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => setShowAddForm(true)}
            className="flex-row items-center justify-center rounded-xl border border-gray-border-dim bg-gray-dark p-3.5 gap-2 active:opacity-75"
          >
            <IconPlus
              color={colors.primaryForeground}
              size={18}
              strokeWidth={1.8}
            />
            <Text className="text-primary-foreground text-[15px] font-semibold">
              Add Custom App
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            onPress={handleReset}
            className="flex-row items-center justify-center p-3.5 gap-2 active:opacity-75"
          >
            <IconRotateClockwise
              color={colors.errorText}
              size={16}
              strokeWidth={1.8}
            />
            <Text className="text-error text-sm">Reset to Defaults</Text>
          </TouchableOpacity>
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
