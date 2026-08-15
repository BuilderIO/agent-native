import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  IconCheck,
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceDesktop,
  IconRobot,
  IconX,
} from "@tabler/icons-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";
import {
  fetchModelCatalog,
  PROVIDER_KEY_OPTIONS,
  saveProviderApiKey,
} from "@/lib/agent-chat/api";
import {
  formatMobileModelLabel,
  getMobileAgentId,
  getMobileModelGroups,
  MOBILE_AGENT_OPTIONS,
  selectMobileAgentSettings,
  type MobileAgentId,
} from "@/lib/agent-chat/model-picker";
import type { ChatModelCatalog } from "@/lib/agent-chat/types";
import type { AgentChatSettings } from "@/lib/agent-chat/use-agent-chat";

const SETTINGS_KEY = "agent-native:chat-settings";

export const DEFAULT_CHAT_SETTINGS: AgentChatSettings = {
  model: "gpt-5-6-luna",
  effort: "high",
};

const EFFORT_OPTIONS: Array<{
  value: string | undefined;
  label: string;
}> = [
  { value: undefined, label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
];

type MobilePickerSection = "agent" | "model" | "effort";

export async function loadChatSettings(): Promise<AgentChatSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_CHAT_SETTINGS };
    const parsed = JSON.parse(raw) as AgentChatSettings;
    return {
      ...DEFAULT_CHAT_SETTINGS,
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
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center justify-between py-3.5 pl-10 pr-4 border-b border-zinc-800/30 ${
        disabled ? "opacity-45" : "active:bg-white/5"
      }`}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
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

function PickerSectionRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-white/5 border-b border-zinc-800/40"
      accessibilityRole="button"
      accessibilityLabel={`Choose ${label}`}
    >
      {label === "Agent" ? (
        <IconRobot color="#a1a1aa" size={17} strokeWidth={1.8} />
      ) : label === "Model" ? (
        <IconDeviceDesktop color="#a1a1aa" size={17} strokeWidth={1.8} />
      ) : (
        <IconAdjustmentsHorizontal
          color="#a1a1aa"
          size={17}
          strokeWidth={1.8}
        />
      )}
      <Text className="text-zinc-300 text-[14px] font-medium">{label}</Text>
      <Text
        className="flex-1 text-right text-zinc-500 text-[13px]"
        numberOfLines={1}
      >
        {value}
      </Text>
      <IconChevronRight color="#71717a" size={15} strokeWidth={2.2} />
    </Pressable>
  );
}

function AgentItem({
  label,
  description,
  selected,
  available,
  onPress,
}: {
  label: string;
  description: string;
  selected: boolean;
  available: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!available}
      className={`flex-row items-center gap-3 py-3.5 pl-4 pr-4 border-b border-zinc-800/30 ${
        available ? "active:bg-white/5" : "opacity-45"
      }`}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !available }}
    >
      <View className="flex-1">
        <Text
          className={`text-[14px] ${
            selected ? "text-white font-semibold" : "text-zinc-300 font-medium"
          }`}
        >
          {label}
        </Text>
        <Text className="text-zinc-500 text-[12px] mt-0.5" numberOfLines={1}>
          {description}
        </Text>
      </View>
      {!available ? (
        <Text className="text-zinc-600 text-[11px]">Unavailable</Text>
      ) : selected ? (
        <IconCheck color="#2563eb" size={15} strokeWidth={2.5} />
      ) : null}
    </Pressable>
  );
}

function ProviderKeyRow({
  label,
  placeholder,
  onSave,
}: {
  label: string;
  placeholder: string;
  onSave: (apiKey: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | { error: string }
  >("idle");

  const save = async () => {
    if (!value.trim() || status === "saving") return;
    setStatus("saving");
    try {
      await onSave(value);
      setValue("");
      setStatus("saved");
    } catch (error) {
      setStatus({
        error: error instanceof Error ? error.message : "Could not save key",
      });
    }
  };

  return (
    <View className="pl-10 pr-4 py-3 gap-2 border-b border-zinc-800/30">
      <View className="flex-row items-center gap-2">
        <TextInput
          className="flex-1 h-10 rounded-lg bg-zinc-900 border border-zinc-800 px-3 text-white text-[13px]"
          value={value}
          onChangeText={(next) => {
            setValue(next);
            if (status !== "idle") setStatus("idle");
          }}
          placeholder={placeholder}
          placeholderTextColor="#52525b"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          accessibilityLabel={`${label} API key`}
        />
        <Pressable
          className={`h-10 px-4 rounded-lg items-center justify-center ${
            value.trim() && status !== "saving"
              ? "bg-white active:opacity-75"
              : "bg-zinc-800"
          }`}
          onPress={() => void save()}
          disabled={!value.trim() || status === "saving"}
          accessibilityRole="button"
          accessibilityLabel={`Save ${label} API key`}
        >
          {status === "saving" ? (
            <ActivityIndicator size="small" color="#71717a" />
          ) : (
            <Text
              className={`text-[13px] font-bold ${
                value.trim() ? "text-zinc-950" : "text-zinc-500"
              }`}
            >
              Save
            </Text>
          )}
        </Pressable>
      </View>
      {status === "saved" ? (
        <Text className="text-emerald-400 text-xs">
          Saved to your workspace vault.
        </Text>
      ) : typeof status === "object" ? (
        <Text className="text-red-400 text-xs">{status.error}</Text>
      ) : null}
    </View>
  );
}

export function ChatSettingsSheet({
  visible,
  settings,
  baseUrl,
  onChange,
  onClose,
}: {
  visible: boolean;
  settings: AgentChatSettings;
  /** Active thread's app — models and keys are read/written against it. */
  baseUrl?: string;
  onChange: (settings: AgentChatSettings) => void;
  onClose: () => void;
}) {
  const [pickerSection, setPickerSection] =
    useState<MobilePickerSection | null>(null);
  const [catalog, setCatalog] = useState<ChatModelCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );

  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    fetchModelCatalog(baseUrl)
      .then(setCatalog)
      .catch(() => setCatalog({ groups: [] }))
      .finally(() => setCatalogLoading(false));
  }, [baseUrl]);

  // Reload whenever opened or the active app changes, so the catalog and
  // configurable providers reflect the app being configured.
  useEffect(() => {
    if (visible) {
      setPickerSection(null);
      loadCatalog();
    }
  }, [visible, loadCatalog]);

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

      // Auto-expand effort if one is selected
      if (settings.effort) {
        if (!nextExpanded["effort"]) {
          nextExpanded["effort"] = true;
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

  const activeAgentId = getMobileAgentId(settings.engine);
  const activeAgent = MOBILE_AGENT_OPTIONS.find(
    (agent) => agent.id === activeAgentId,
  );
  const activeAgentLabel = activeAgent?.label ?? "Default";
  const activeModelLabel = formatMobileModelLabel(settings.model);
  const activeEffortLabel =
    EFFORT_OPTIONS.find((o) => o.value === settings.effort)?.label ?? "Default";
  const modelGroups = getMobileModelGroups(catalog, activeAgentId);

  const chooseAgent = (agentId: MobileAgentId) => {
    update(selectMobileAgentSettings(agentId, settings, catalog));
    setPickerSection(null);
  };

  const chooseModel = (model: string, engine: string) => {
    update({ ...settings, model, engine });
    setPickerSection(null);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-[#09090b]">
        <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-zinc-800">
          <Text className="text-white text-base font-bold">Configure</Text>
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
              {pickerSection ? (
                <>
                  <Pressable
                    onPress={() => setPickerSection(null)}
                    className="flex-row items-center gap-2 px-4 py-3.5 border-b border-zinc-800 active:bg-white/5"
                    accessibilityRole="button"
                    accessibilityLabel="Back to picker sections"
                  >
                    <IconChevronLeft
                      color="#a1a1aa"
                      size={17}
                      strokeWidth={2.2}
                    />
                    <Text className="text-zinc-300 text-[14px] font-semibold">
                      {pickerSection === "agent"
                        ? "Agent"
                        : pickerSection === "model"
                          ? "Model"
                          : "Effort"}
                    </Text>
                  </Pressable>

                  {pickerSection === "agent" &&
                    MOBILE_AGENT_OPTIONS.map((agent) => {
                      const available =
                        agent.id === "default" ||
                        ("engine" in agent &&
                          catalog.groups.some(
                            (group) => group.engine === agent.engine,
                          ));
                      return (
                        <AgentItem
                          key={agent.id}
                          label={agent.label}
                          description={agent.description}
                          selected={agent.id === activeAgentId}
                          available={available}
                          onPress={() => chooseAgent(agent.id)}
                        />
                      );
                    })}

                  {pickerSection === "model" && (
                    <>
                      {activeAgentId === "default" && (
                        <AutoItem
                          selected={!settings.model}
                          onPress={() =>
                            update({
                              ...settings,
                              model: undefined,
                              engine: undefined,
                            })
                          }
                        />
                      )}
                      {modelGroups.map((group) => (
                        <View
                          key={`${group.engine}-${group.label}`}
                          className="border-b border-zinc-800/20"
                        >
                          <Text className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider pl-10 pr-4 pt-3 pb-1">
                            {group.label}
                          </Text>
                          {group.models.map((model) => (
                            <ModelItem
                              key={model}
                              label={formatMobileModelLabel(model)}
                              selected={settings.model === model}
                              onPress={() => chooseModel(model, group.engine)}
                            />
                          ))}
                        </View>
                      ))}
                      {modelGroups.length === 0 && (
                        <Text className="text-zinc-500 text-[13px] leading-5 px-10 py-5">
                          This agent is not available on the active app.
                        </Text>
                      )}
                    </>
                  )}

                  {pickerSection === "effort" &&
                    EFFORT_OPTIONS.map((option) => (
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
              ) : (
                <>
                  <PickerSectionRow
                    label="Agent"
                    value={activeAgentLabel}
                    onPress={() => setPickerSection("agent")}
                  />
                  <PickerSectionRow
                    label="Model"
                    value={activeModelLabel}
                    onPress={() => setPickerSection("model")}
                  />
                  <PickerSectionRow
                    label="Effort"
                    value={activeEffortLabel}
                    onPress={() => setPickerSection("effort")}
                  />
                </>
              )}

              <View>
                <GroupHeader
                  label="API Keys"
                  expanded={!!expandedGroups["api-keys"]}
                  onPress={() => toggleGroup("api-keys")}
                />
                {!!expandedGroups["api-keys"] && (
                  <>
                    {PROVIDER_KEY_OPTIONS.filter(
                      (option) =>
                        !catalog.configurableProviders ||
                        catalog.configurableProviders.length === 0 ||
                        catalog.configurableProviders.includes(option.provider),
                    ).map((option) => (
                      <View key={option.provider}>
                        <Text className="text-zinc-400 text-[12px] font-semibold pl-10 pr-4 pt-3">
                          {option.label}
                        </Text>
                        <ProviderKeyRow
                          label={option.label}
                          placeholder={option.placeholder}
                          onSave={async (apiKey) => {
                            await saveProviderApiKey(option.provider, apiKey, {
                              baseUrl,
                            });
                            loadCatalog();
                          }}
                        />
                      </View>
                    ))}
                    <Text className="text-zinc-600 text-[11px] leading-4 pl-10 pr-4 py-3">
                      Keys are stored server-side in your workspace vault, not
                      on this device. Newly configured providers appear in the
                      model list above.
                    </Text>
                  </>
                )}
              </View>
            </View>
          )}

          {catalog && catalog.groups.length === 0 && !catalogLoading && (
            <View className="px-4 py-8 items-center justify-center">
              <Text className="text-zinc-500 text-sm text-center">
                No models available. Add an API key in the API Keys section.
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
  const [settings, setSettings] = useState<AgentChatSettings>(
    DEFAULT_CHAT_SETTINGS,
  );
  useEffect(() => {
    void loadChatSettings().then(setSettings);
  }, []);
  return [settings, setSettings];
}
