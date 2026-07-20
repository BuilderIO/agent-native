import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconX,
} from "@tabler/icons-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";
import { fetchModelCatalog } from "@/lib/agent-chat/api";
import type { ChatModelCatalog } from "@/lib/agent-chat/types";
import type { AgentChatSettings } from "@/lib/agent-chat/use-agent-chat";

const SETTINGS_KEY = "agent-native:chat-settings";

const EFFORT_OPTIONS: Array<{
  value: string | undefined;
  label: string;
}> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export async function loadChatSettings(): Promise<AgentChatSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as AgentChatSettings;
    return {
      ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
      ...(typeof parsed.engine === "string" ? { engine: parsed.engine } : {}),
      ...(typeof parsed.effort === "string" ? { effort: parsed.effort } : {}),
      ...(parsed.mode === "plan" ? { mode: parsed.mode } : {}),
    };
  } catch {
    return {};
  }
}

async function persistChatSettings(settings: AgentChatSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings still apply for this session.
  }
}

function GroupHeader({
  label,
  valueSuffix,
  expanded,
  onPress,
}: {
  label: string;
  valueSuffix?: string;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between py-3.5 px-4 active:bg-white/5 border-b border-zinc-800/40"
      accessibilityRole="button"
      accessibilityState={{ expanded }}
    >
      <View className="flex-row items-center gap-2">
        {expanded ? (
          <IconChevronDown color="#71717a" size={15} strokeWidth={2.5} />
        ) : (
          <IconChevronRight color="#71717a" size={15} strokeWidth={2.5} />
        )}
        <Text className="text-zinc-400 text-[13px] font-bold uppercase tracking-wider">
          {label}
        </Text>
      </View>
      {valueSuffix ? (
        <Text className="text-zinc-500 text-[13px] font-medium mr-1">
          {valueSuffix}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ModelItem({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between py-3.5 pl-10 pr-4 active:bg-white/5 border-b border-zinc-800/30"
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text
        className={`text-[14px] ${
          selected ? "text-white font-semibold" : "text-zinc-300 font-medium"
        }`}
      >
        {label}
      </Text>
      {selected && <IconCheck color="#2563eb" size={15} strokeWidth={2.5} />}
    </Pressable>
  );
}

function AutoItem({
  selected,
  onPress,
}: {
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between py-3.5 px-4 active:bg-white/5 border-b border-zinc-800/40"
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text
        className={`text-[14px] ${
          selected ? "text-white font-semibold" : "text-zinc-300 font-medium"
        }`}
      >
        Auto
      </Text>
      {selected && <IconCheck color="#2563eb" size={15} strokeWidth={2.5} />}
    </Pressable>
  );
}

export function ChatSettingsSheet({
  visible,
  settings,
  onChange,
  onClose,
}: {
  visible: boolean;
  settings: AgentChatSettings;
  onChange: (settings: AgentChatSettings) => void;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<ChatModelCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    if (!visible || catalog) return;
    setCatalogLoading(true);
    fetchModelCatalog()
      .then(setCatalog)
      .catch(() => setCatalog({ groups: [] }))
      .finally(() => setCatalogLoading(false));
  }, [visible, catalog]);

  useEffect(() => {
    if (catalog) {
      const nextExpanded = { ...expandedGroups };
      let updated = false;

      // Auto-expand group of selected model
      if (settings.model) {
        const activeGroup = catalog.groups.find((g) =>
          g.models.includes(settings.model!),
        );
        if (activeGroup) {
          const groupKey = `model-${activeGroup.engine}-${activeGroup.label}`;
          if (!nextExpanded[groupKey]) {
            nextExpanded[groupKey] = true;
            updated = true;
          }
        }
      }

      // Auto-expand reasoning if effort is selected
      if (settings.effort) {
        if (!nextExpanded["reasoning"]) {
          nextExpanded["reasoning"] = true;
          updated = true;
        }
      }

      if (updated) {
        setExpandedGroups(nextExpanded);
      }
    }
  }, [catalog, settings.model, settings.effort]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const update = (next: AgentChatSettings) => {
    onChange(next);
    void persistChatSettings(next);
  };

  const activeEffortLabel =
    EFFORT_OPTIONS.find((o) => o.value === settings.effort)?.label ?? "Default";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-[#09090b]">
        <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-zinc-800">
          <Text className="text-white text-base font-bold">
            Configure Model
          </Text>
          <Pressable
            className="p-1.5 active:opacity-75"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close settings"
          >
            <IconX color="#71717a" size={18} strokeWidth={2.5} />
          </Pressable>
        </View>

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {catalogLoading && (
            <View className="py-8 items-center justify-center">
              <ActivityIndicator color="#2563eb" />
            </View>
          )}

          {catalog && (
            <View className="bg-[#18181b] border-y border-zinc-800 mt-4">
              {/* Auto Option */}
              <AutoItem
                selected={!settings.model}
                onPress={() =>
                  update({ ...settings, model: undefined, engine: undefined })
                }
              />

              {/* Model Provider Groups */}
              {catalog.groups.map((group) => {
                const groupKey = `model-${group.engine}-${group.label}`;
                const isExpanded = !!expandedGroups[groupKey];
                return (
                  <View key={groupKey} className="border-b border-zinc-800/20">
                    <GroupHeader
                      label={group.label}
                      expanded={isExpanded}
                      onPress={() => toggleGroup(groupKey)}
                    />
                    {isExpanded &&
                      group.models.map((model) => (
                        <ModelItem
                          key={model}
                          label={model}
                          selected={settings.model === model}
                          onPress={() =>
                            update({ ...settings, model, engine: group.engine })
                          }
                        />
                      ))}
                  </View>
                );
              })}

              {/* Reasoning Section */}
              <View>
                <GroupHeader
                  label="Reasoning"
                  valueSuffix={activeEffortLabel}
                  expanded={!!expandedGroups["reasoning"]}
                  onPress={() => toggleGroup("reasoning")}
                />
                {!!expandedGroups["reasoning"] && (
                  <>
                    <ModelItem
                      label="Default"
                      selected={settings.effort === undefined}
                      onPress={() => update({ ...settings, effort: undefined })}
                    />
                    {EFFORT_OPTIONS.map((option) => (
                      <ModelItem
                        key={option.label}
                        label={option.label}
                        selected={settings.effort === option.value}
                        onPress={() =>
                          update({ ...settings, effort: option.value })
                        }
                      />
                    ))}
                  </>
                )}
              </View>
            </View>
          )}

          {catalog && catalog.groups.length === 0 && !catalogLoading && (
            <View className="px-4 py-8 items-center justify-center">
              <Text className="text-zinc-500 text-sm text-center">
                No models available. Add API keys in the settings.
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function useChatSettings(): [
  AgentChatSettings,
  (settings: AgentChatSettings) => void,
] {
  const [settings, setSettings] = useState<AgentChatSettings>({});
  useEffect(() => {
    void loadChatSettings().then(setSettings);
  }, []);
  return [settings, setSettings];
}
