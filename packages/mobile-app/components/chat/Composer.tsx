import {
  IconArrowUp,
  IconMicrophone,
  IconPhoto,
  IconPlayerStopFilled,
  IconX,
} from "@tabler/icons-react-native";
import * as ImagePicker from "expo-image-picker";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ChatAttachment } from "@/lib/agent-chat/types";
import type { AgentChatSettings } from "@/lib/agent-chat/use-agent-chat";
import { getAndClearLastDictatedText } from "@/lib/voice-api";

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
  onSend,
  onStop,
  onOpenSettings,
  onToggleMode,
}: {
  isStreaming: boolean;
  settings: AgentChatSettings;
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onToggleMode: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const canSend =
    (text.trim().length > 0 || attachments.length > 0) && !isStreaming;

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
    setText("");
    setAttachments([]);
    onSend(value, attachments);
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
            placeholder="Message the agent…"
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
