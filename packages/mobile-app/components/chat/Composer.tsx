import {
  IconArrowUp,
  IconAt,
  IconFileText,
  IconMicrophone,
  IconPhoto,
  IconPlayerStopFilled,
  IconRobot,
  IconX,
} from "@tabler/icons-react-native";
import * as ImagePicker from "expo-image-picker";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { fetchMentions } from "@/lib/agent-chat/api";
import {
  activeMentionQuery,
  mentionToReference,
  replaceMention,
} from "@/lib/agent-chat/mention-query";
import type {
  ChatAttachment,
  ChatReference,
  MentionItem,
} from "@/lib/agent-chat/types";
import type { AgentChatSettings } from "@/lib/agent-chat/use-agent-chat";
import { getAndClearLastDictatedText } from "@/lib/voice-api";

function MentionRowIcon({ refType }: { refType: string }) {
  if (refType === "agent" || refType === "custom-agent") {
    return <IconRobot color="#a1a1aa" size={17} strokeWidth={1.8} />;
  }
  if (refType === "file" || refType === "skill") {
    return <IconFileText color="#a1a1aa" size={17} strokeWidth={1.8} />;
  }
  return <IconAt color="#a1a1aa" size={17} strokeWidth={1.8} />;
}

function settingsSummary(settings: AgentChatSettings): string {
  const model = settings.model ? settings.model.replace(/-\d{8}$/, "") : "Auto";
  const effort = settings.effort
    ? ` · ${settings.effort[0]!.toUpperCase()}${settings.effort.slice(1, 3)}`
    : "";
  return `${model}${effort}`;
}

async function pickImageAttachment(): Promise<ChatAttachment | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.7,
    base64: true,
    exif: false,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset?.base64) return null;
  const mimeType = asset.mimeType?.startsWith("image/")
    ? asset.mimeType
    : "image/jpeg";
  return {
    type: "image",
    name: asset.fileName ?? "photo.jpg",
    contentType: mimeType,
    data: `data:${mimeType};base64,${asset.base64}`,
  };
}

export function Composer({
  isStreaming,
  settings,
  baseUrl,
  onSend,
  onStop,
  onOpenSettings,
  onToggleMode,
}: {
  isStreaming: boolean;
  settings: AgentChatSettings;
  /** Active thread's app — mentions are fetched from this app. */
  baseUrl?: string;
  onSend: (
    text: string,
    attachments: ChatAttachment[],
    references: ChatReference[],
  ) => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onToggleMode: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [references, setReferences] = useState<ChatReference[]>([]);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const canSend =
    (text.trim().length > 0 || attachments.length > 0) && !isStreaming;

  // A mention is being typed only when the caret is a collapsed cursor.
  const activeMention = useMemo(
    () =>
      selection.start === selection.end
        ? activeMentionQuery(text, selection.start)
        : null,
    [text, selection],
  );
  const mentionQuery = activeMention?.query ?? null;

  useEffect(() => {
    if (mentionQuery === null) {
      setMentionItems([]);
      setMentionLoading(false);
      return;
    }
    const controller = new AbortController();
    setMentionLoading(true);
    const timer = setTimeout(
      () => {
        void fetchMentions(mentionQuery, {
          signal: controller.signal,
          baseUrl,
          // Surface each batch as it arrives so fast sources show immediately.
          onItems: (items) => {
            if (!controller.signal.aborted) setMentionItems(items);
          },
        }).then(() => {
          if (!controller.signal.aborted) setMentionLoading(false);
        });
      },
      mentionQuery.length === 0 ? 0 : 150,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mentionQuery, baseUrl]);

  const pickMention = (item: MentionItem) => {
    if (!activeMention) return;
    const { text: next, cursor } = replaceMention(
      text,
      activeMention,
      `@${item.label} `,
    );
    setText(next);
    setSelection({ start: cursor, end: cursor });
    setReferences((current) =>
      current.some((r) => r.name === item.label && r.refId === item.refId)
        ? current
        : [...current, mentionToReference(item)],
    );
    setMentionItems([]);
  };

  const navigation = useNavigation();

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      const dictated = getAndClearLastDictatedText();
      if (dictated) {
        setText((current) => (current ? current + "\n" + dictated : dictated));
      }
    });
    return unsubscribe;
  }, [navigation]);

  const startDictation = () => {
    router.push("/capture/dictate" as never);
  };

  const submit = () => {
    if (!canSend) return;
    const value = text.trim();
    // Only send references still present in the text — a mention the user
    // deleted should not silently travel with the turn.
    const activeReferences = references.filter((r) =>
      value.includes(`@${r.name}`),
    );
    setText("");
    setAttachments([]);
    setReferences([]);
    setSelection({ start: 0, end: 0 });
    onSend(value, attachments, activeReferences);
  };

  const attach = () => {
    void pickImageAttachment().then((attachment) => {
      if (attachment) setAttachments((current) => [...current, attachment]);
    });
  };

  return (
    <View className="px-3 pt-2">
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 pb-2 px-1"
        >
          {attachments.map((attachment, index) => (
            <View
              key={`${attachment.name}-${index}`}
              className="rounded-xl overflow-hidden border border-border-dark"
            >
              <Image
                source={{ uri: attachment.data }}
                className="w-14 h-14"
                accessibilityLabel={attachment.name}
              />
              <Pressable
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-background-pure items-center justify-center active:opacity-75"
                onPress={() =>
                  setAttachments((current) =>
                    current.filter((_, i) => i !== index),
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.name}`}
              >
                <IconX color="#fafafa" size={12} strokeWidth={2.4} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {activeMention && (mentionLoading || mentionItems.length > 0) && (
        <View className="mb-2 rounded-2xl bg-card-dark border border-border-dark overflow-hidden max-h-56">
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {mentionItems.map((item) => (
              <Pressable
                key={item.id}
                className="flex-row items-center gap-2.5 px-3.5 py-2.5 border-b border-border-dark active:bg-white/5"
                onPress={() => pickMention(item)}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${item.label}`}
              >
                <MentionRowIcon refType={item.refType} />
                <View className="flex-1">
                  <Text
                    className="text-white text-[14px] font-medium"
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  {item.description ? (
                    <Text
                      className="text-status-gray text-[12px] mt-0.5"
                      numberOfLines={1}
                    >
                      {item.description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
            {mentionLoading && mentionItems.length === 0 && (
              <View className="flex-row items-center gap-2 px-3.5 py-3">
                <ActivityIndicator size="small" color="#71717a" />
                <Text className="text-status-gray text-[13px]">Searching…</Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}

      <View className="rounded-3xl bg-card-dark border border-border-dark px-1.5 pt-1.5 pb-1">
        <View className="flex-row items-end">
          <Pressable
            className="w-9 h-9 rounded-full items-center justify-center mb-0.5 active:opacity-75"
            onPress={attach}
            disabled={isStreaming}
            accessibilityRole="button"
            accessibilityLabel="Attach image"
          >
            <IconPhoto color="#71717a" size={20} strokeWidth={1.8} />
          </Pressable>
          <Pressable
            className="w-9 h-9 rounded-full items-center justify-center mb-0.5 active:opacity-75"
            onPress={startDictation}
            disabled={isStreaming}
            accessibilityRole="button"
            accessibilityLabel="Voice dictation"
          >
            <IconMicrophone color="#71717a" size={20} strokeWidth={1.8} />
          </Pressable>
          <TextInput
            className="flex-1 text-white text-[15px] leading-5 max-h-30 py-2"
            value={text}
            onChangeText={setText}
            selection={selection}
            onSelectionChange={(event) =>
              setSelection(event.nativeEvent.selection)
            }
            placeholder="Message the agent…  (@ to mention)"
            placeholderTextColor="#71717a"
            multiline
            keyboardAppearance="dark"
            accessibilityLabel="Message input"
            nativeID="chat-composer-input"
          />
          {isStreaming ? (
            <Pressable
              className="w-9 h-9 rounded-full bg-white items-center justify-center mb-0.5 active:opacity-75"
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
            >
              <IconPlayerStopFilled color="#0b0b0c" size={16} />
            </Pressable>
          ) : (
            <Pressable
              className={`w-9 h-9 rounded-full items-center justify-center mb-0.5 active:opacity-75 ${
                canSend ? "bg-accent-green" : "bg-gray-medium-dark"
              }`}
              onPress={submit}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              <IconArrowUp
                color={canSend ? "#0b0b0c" : "#71717a"}
                size={18}
                strokeWidth={2.4}
              />
            </Pressable>
          )}
        </View>

        <View className="flex-row items-center gap-2 px-2 pb-1">
          <Pressable
            className="active:opacity-75"
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Model and effort settings"
          >
            <Text className="text-status-gray text-xs font-medium">
              {settingsSummary(settings)}
            </Text>
          </Pressable>
          <Text className="text-gray-border-light text-xs">·</Text>
          <Pressable
            className="active:opacity-75"
            onPress={onToggleMode}
            accessibilityRole="button"
            accessibilityLabel={`Mode ${settings.mode === "plan" ? "Plan" : "Act"} — tap to toggle`}
          >
            <Text
              className={`text-xs font-semibold ${
                settings.mode === "plan"
                  ? "text-accent-blue"
                  : "text-status-gray"
              }`}
            >
              {settings.mode === "plan" ? "Plan" : "Act"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
