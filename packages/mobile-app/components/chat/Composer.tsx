import {
  IconArrowUp,
  IconAt,
  IconBolt,
  IconBulb,
  IconCamera,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFileText,
  IconMicrophone,
  IconPhoto,
  IconPlayerStopFilled,
  IconPlugConnected,
  IconPlus,
  IconRobot,
  IconTools,
  IconUpload,
  IconX,
} from "@tabler/icons-react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
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

export type ActionTag = {
  id: string;
  label: string;
  icon: "bolt" | "bulb" | "clock" | "tools" | "upload";
};

function renderActionTagIcon(iconName: ActionTag["icon"]) {
  switch (iconName) {
    case "bolt":
      return <IconBolt color="#d4d4d8" size={14} strokeWidth={2} />;
    case "bulb":
      return <IconBulb color="#d4d4d8" size={14} strokeWidth={2} />;
    case "clock":
      return <IconClock color="#d4d4d8" size={14} strokeWidth={2} />;
    case "tools":
      return <IconTools color="#d4d4d8" size={14} strokeWidth={2} />;
    case "upload":
      return <IconUpload color="#d4d4d8" size={14} strokeWidth={2} />;
    default:
      return null;
  }
}

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
  if (!settings.model) return "Auto";
  const raw = settings.model.replace(/-\d{8}$/, "");
  let model = raw;
  if (/sonnet/i.test(raw)) model = "Sonnet 5";
  else if (/opus/i.test(raw)) model = "Opus 3.5";
  else if (/haiku/i.test(raw)) model = "Haiku 3.5";
  else if (/gpt-4o/i.test(raw)) model = "GPT-4o";
  else if (/gemini/i.test(raw)) model = "Gemini 2.0";
  else {
    model = raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  const effort = settings.effort
    ? ` · ${settings.effort[0]!.toUpperCase()}${settings.effort.slice(1, 3)}`
    : "";
  return `${model}${effort}`;
}

function detectMimeType(fileName: string, providedMime?: string): string {
  if (
    providedMime &&
    providedMime !== "application/octet-stream" &&
    providedMime !== "binary/octet-stream"
  ) {
    return providedMime;
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
    case "heif":
      return "image/heic";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "md":
      return "text/markdown";
    default:
      return providedMime || "application/octet-stream";
  }
}

async function getAssetDataUrl(
  uri: string,
  mimeType: string,
  fileObj?: File | Blob,
): Promise<string | null> {
  if (fileObj && typeof FileReader !== "undefined") {
    try {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(fileObj);
      });
    } catch {
      // fallback
    }
  }

  if (Platform.OS !== "web") {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return `data:${mimeType};base64,${base64}`;
    } catch (e) {
      console.warn(
        "FileSystem readAsStringAsync failed, trying fetch fallback:",
        e,
      );
    }
  }

  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Failed to read asset data URL:", e);
    return null;
  }
}

async function pickAnyFileAttachment(): Promise<ChatAttachment | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    const name = asset.name || "file";
    const mimeType = detectMimeType(name, asset.mimeType);

    const dataUrl = await getAssetDataUrl(
      asset.uri,
      mimeType,
      (asset as { file?: File }).file,
    );
    if (!dataUrl) return null;

    const isImage = mimeType.startsWith("image/");
    return {
      type: isImage ? "image" : "file",
      name,
      contentType: mimeType,
      data: dataUrl,
    };
  } catch (error) {
    console.error("pickAnyFileAttachment error:", error);
    return null;
  }
}

async function imageAssetToAttachment(
  asset: ImagePicker.ImagePickerAsset,
  fallbackName: string,
): Promise<ChatAttachment | null> {
  const name = asset.fileName ?? fallbackName;
  const mimeType = detectMimeType(name, asset.mimeType ?? "image/jpeg");

  let dataUrl: string | null = null;
  if (asset.base64) {
    dataUrl = `data:${mimeType};base64,${asset.base64}`;
  } else if (asset.uri) {
    dataUrl = await getAssetDataUrl(asset.uri, mimeType);
  }

  if (!dataUrl) return null;

  return {
    type: "image",
    name,
    contentType: mimeType,
    data: dataUrl,
  };
}

async function captureCameraAttachment(): Promise<ChatAttachment | null> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      exif: false,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return null;
    return await imageAssetToAttachment(asset, "camera_photo.jpg");
  } catch (error) {
    console.error("captureCameraAttachment error:", error);
    return null;
  }
}

async function pickPhotoFromLibrary(): Promise<ChatAttachment | null> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      exif: false,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return null;
    return await imageAssetToAttachment(asset, "photo.jpg");
  } catch (error) {
    console.error("pickPhotoFromLibrary error:", error);
    return null;
  }
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
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [menuScreen, setMenuScreen] = useState<"main" | "skill">("main");
  const [actionTag, setActionTag] = useState<ActionTag | null>(null);

  const canSend =
    (text.trim().length > 0 || attachments.length > 0 || actionTag !== null) &&
    !isStreaming;

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
        setText((current) => {
          const next = current ? current + "\n" + dictated : dictated;
          setSelection({ start: next.length, end: next.length });
          return next;
        });
      }
    });
    return unsubscribe;
  }, [navigation]);

  const startDictation = () => {
    router.push("/capture/dictate" as never);
  };

  const submit = () => {
    if (!canSend) return;
    const raw = text.trim();
    const value = actionTag
      ? raw
        ? `[${actionTag.label}] ${raw}`
        : `Perform ${actionTag.label}`
      : raw;

    const activeReferences = references.filter((r) =>
      value.includes(`@${r.name}`),
    );
    setText("");
    setAttachments([]);
    setReferences([]);
    setActionTag(null);
    setSelection({ start: 0, end: 0 });
    onSend(value, attachments, activeReferences);
  };

  const addAttachment = useCallback((attachment: ChatAttachment | null) => {
    if (attachment) setAttachments((current) => [...current, attachment]);
  }, []);

  useEffect(() => {
    const recover = () => {
      void ImagePicker.getPendingResultAsync()
        .then(async (result) => {
          if (!result || "code" in result) return;
          if (result.canceled) return;
          const asset = result.assets?.[0];
          if (!asset) return;
          addAttachment(await imageAssetToAttachment(asset, "photo.jpg"));
        })
        .catch(() => {});
    };
    recover();
    const unsubscribe = navigation.addListener("focus", recover);
    return unsubscribe;
  }, [navigation, addAttachment]);

  const pendingActionRef = useRef<(() => void) | null>(null);
  const runPendingAction = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  };
  const closeMenuThen = (action: () => void) => {
    pendingActionRef.current = action;
    setPlusMenuOpen(false);
    if (Platform.OS !== "ios") setTimeout(runPendingAction, 300);
  };

  const handleOpenPlusMenu = () => {
    setMenuScreen("main");
    setPlusMenuOpen(true);
  };

  const handleUploadFile = () => {
    closeMenuThen(() => {
      void pickAnyFileAttachment().then(addAttachment);
    });
  };

  const handleTakePhoto = () => {
    closeMenuThen(() => {
      void captureCameraAttachment().then(addAttachment);
    });
  };

  const handlePickPhoto = () => {
    closeMenuThen(() => {
      void pickPhotoFromLibrary().then(addAttachment);
    });
  };

  const handleSelectActionTag = (tag: ActionTag) => {
    setActionTag(tag);
    setPlusMenuOpen(false);
  };

  const handleUploadSkillFile = () => {
    setActionTag({
      id: "upload-skill",
      label: "Upload Skill File",
      icon: "upload",
    });
    closeMenuThen(() => {
      void pickAnyFileAttachment().then(addAttachment);
    });
  };

  const handleIntegrations = () => {
    setPlusMenuOpen(false);
    onOpenSettings();
  };

  return (
    <View className="px-3 pt-2 pb-1">
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 pt-1.5 pb-0.5 px-1.5"
        >
          {attachments.map((attachment, index) => {
            const isImage =
              attachment.type === "image" ||
              attachment.contentType?.startsWith("image/");
            return (
              <View
                key={`${attachment.name}-${index}`}
                className="rounded-xl border border-border-dark p-0.5 flex-row items-center gap-2 max-w-42.5"
              >
                {isImage && attachment.data ? (
                  <Image
                    source={{ uri: attachment.data }}
                    className="w-10 h-10 rounded-lg"
                    accessibilityLabel={attachment.name}
                  />
                ) : (
                  <View className="w-10 h-10 rounded-lg bg-zinc-700 items-center justify-center">
                    <IconFileText color="#d4d4d8" size={20} />
                  </View>
                )}

                <Pressable
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-900 border border-border-dark items-center justify-center active:opacity-75"
                  hitSlop={8}
                  onPress={() =>
                    setAttachments((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${attachment.name}`}
                >
                  <IconX color="#fafafa" size={11} strokeWidth={2.4} />
                </Pressable>
              </View>
            );
          })}
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

      <View className="rounded-[22px] bg-card-dark border border-border-dark px-3.5 pt-3 pb-2.5">
        {actionTag && (
          <View className="flex-row items-center gap-1.5 self-start px-2.5 py-1 rounded-lg bg-zinc-800/90 border border-zinc-700/80 mb-2">
            {renderActionTagIcon(actionTag.icon)}
            <Text className="text-white text-[13px] font-medium pl-0.5">
              {actionTag.label}
            </Text>
            <Pressable
              onPress={() => setActionTag(null)}
              className="p-0.5 ml-1 active:opacity-75"
              accessibilityRole="button"
              accessibilityLabel={`Remove ${actionTag.label} tag`}
            >
              <IconX color="#a1a1aa" size={13} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}

        <TextInput
          className="text-white text-[15px] leading-5 min-h-[44px] max-h-32 py-1 mb-1.5"
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

        <View className="flex-row items-center justify-between pt-1">
          <Pressable
            className="w-8 h-8 rounded-full items-center justify-center -ml-1 active:opacity-75"
            onPress={handleOpenPlusMenu}
            disabled={isStreaming}
            accessibilityRole="button"
            accessibilityLabel="Actions menu"
          >
            <IconPlus color="#a1a1aa" size={19} strokeWidth={2} />
          </Pressable>

          <View className="flex-row items-center gap-2.5">
            <Pressable
              className="flex-row items-center gap-1 py-1 px-1 rounded-lg active:opacity-75"
              onPress={onOpenSettings}
              accessibilityRole="button"
              accessibilityLabel="Model and effort settings"
            >
              <Text className="text-[13px] font-medium text-zinc-400">
                {settingsSummary(settings)}
              </Text>
              <IconChevronDown color="#71717a" size={13} strokeWidth={2} />
            </Pressable>

            <Pressable
              className="flex-row items-center gap-1 py-1 px-1 rounded-lg active:opacity-75"
              onPress={onToggleMode}
              accessibilityRole="button"
              accessibilityLabel={`Mode ${settings.mode === "plan" ? "Plan" : "Act"} — tap to toggle`}
            >
              <Text
                className={`text-[13px] font-medium ${
                  settings.mode === "plan"
                    ? "text-accent-blue"
                    : "text-zinc-400"
                }`}
              >
                {settings.mode === "plan" ? "Plan" : "Act"}
              </Text>
              <IconChevronDown color="#71717a" size={13} strokeWidth={2} />
            </Pressable>

            {isStreaming && (
              <ActivityIndicator
                size="small"
                color="#38bdf8"
                className="px-0.5"
              />
            )}

            <Pressable
              className="w-8 h-8 rounded-full items-center justify-center active:opacity-75"
              onPress={startDictation}
              disabled={isStreaming}
              accessibilityRole="button"
              accessibilityLabel="Voice dictation"
            >
              <IconMicrophone color="#a1a1aa" size={19} strokeWidth={1.8} />
            </Pressable>

            {isStreaming ? (
              <Pressable
                className="w-8 h-8 rounded-xl bg-white items-center justify-center active:opacity-75"
                onPress={onStop}
                accessibilityRole="button"
                accessibilityLabel="Stop generating"
              >
                <IconPlayerStopFilled color="#0b0b0c" size={14} />
              </Pressable>
            ) : (
              <Pressable
                className={`w-8 h-8 rounded-xl items-center justify-center active:opacity-75 ${
                  canSend ? "bg-white" : "bg-zinc-800/80"
                }`}
                onPress={submit}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                <IconArrowUp
                  color={canSend ? "#0b0b0c" : "#52525b"}
                  size={17}
                  strokeWidth={2.2}
                />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <Modal
        visible={plusMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPlusMenuOpen(false)}
        onDismiss={runPendingAction}
      >
        <Pressable
          className="flex-1 bg-black/60 justify-end"
          onPress={() => setPlusMenuOpen(false)}
          accessibilityLabel="Dismiss actions menu"
        >
          <Pressable className="mx-3 mb-8 rounded-2xl bg-card-dark border border-border-dark overflow-hidden p-2 shadow-2xl">
            {menuScreen === "main" ? (
              <>
                <View className="flex-row items-center justify-between px-3 py-2 border-b border-border-dark mb-1">
                  <Text className="text-white text-[15px] font-semibold">
                    Actions & Tools
                  </Text>
                  <Pressable
                    onPress={() => setPlusMenuOpen(false)}
                    className="p-1 active:opacity-75"
                    accessibilityRole="button"
                    accessibilityLabel="Close menu"
                  >
                    <IconX color="#a1a1aa" size={18} />
                  </Pressable>
                </View>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl active:bg-white/10"
                  onPress={handlePickPhoto}
                  accessibilityRole="button"
                  accessibilityLabel="Choose Photo"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconPhoto color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Choose Photo
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Select an image from photo library
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl active:bg-white/10"
                  onPress={handleUploadFile}
                  accessibilityRole="button"
                  accessibilityLabel="Upload File"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconUpload color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Upload File
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Images, PDFs, text/code, JSON, CSV
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl active:bg-white/10"
                  onPress={handleTakePhoto}
                  accessibilityRole="button"
                  accessibilityLabel="Take Photo"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconCamera color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Take Photo
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Capture a photo with your camera
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl active:bg-white/10"
                  onPress={() =>
                    handleSelectActionTag({
                      id: "schedule-task",
                      label: "Schedule Task",
                      icon: "clock",
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Schedule Task"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconClock color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Schedule Task
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Run something on a schedule
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl active:bg-white/10"
                  onPress={() =>
                    handleSelectActionTag({
                      id: "create-automation",
                      label: "Create Automation",
                      icon: "bolt",
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Create Automation"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconBolt color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Create Automation
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Set up a when-X-do-Y rule
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl active:bg-white/10"
                  onPress={() =>
                    handleSelectActionTag({
                      id: "create-extension",
                      label: "Create Extension",
                      icon: "tools",
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Create Extension"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconTools color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Create Extension
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Build a mini app extension
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl active:bg-white/10"
                  onPress={handleIntegrations}
                  accessibilityRole="button"
                  accessibilityLabel="Integrations"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconPlugConnected
                      color="#d4d4d8"
                      size={19}
                      strokeWidth={1.8}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Integrations
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Connect MCP tools to the agent
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl active:bg-white/10"
                  onPress={() => setMenuScreen("skill")}
                  accessibilityRole="button"
                  accessibilityLabel="Create Skill"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconBulb color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Create Skill
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Teach the agent a new ability
                    </Text>
                  </View>
                  <IconChevronRight color="#71717a" size={18} />
                </Pressable>
              </>
            ) : (
              <>
                <View className="flex-row items-center justify-between px-2 py-2 border-b border-border-dark mb-1">
                  <Pressable
                    onPress={() => setMenuScreen("main")}
                    className="flex-row items-center gap-1 p-1 active:opacity-75"
                    accessibilityRole="button"
                    accessibilityLabel="Back to main menu"
                  >
                    <IconChevronLeft color="#a1a1aa" size={18} />
                    <Text className="text-white text-[15px] font-semibold">
                      Create Skill
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setPlusMenuOpen(false)}
                    className="p-1 active:opacity-75"
                    accessibilityRole="button"
                    accessibilityLabel="Close menu"
                  >
                    <IconX color="#a1a1aa" size={18} />
                  </Pressable>
                </View>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-3 rounded-xl active:bg-white/10"
                  onPress={() =>
                    handleSelectActionTag({
                      id: "create-skill",
                      label: "Create Skill",
                      icon: "bulb",
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Create new skill"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconBulb color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Create new skill
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Describe a skill and let the agent draft it
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  className="flex-row items-center gap-3 px-3 py-3 rounded-xl active:bg-white/10"
                  onPress={handleUploadSkillFile}
                  accessibilityRole="button"
                  accessibilityLabel="Upload skill file"
                >
                  <View className="w-8 h-8 rounded-lg bg-white/5 items-center justify-center">
                    <IconUpload color="#d4d4d8" size={19} strokeWidth={1.8} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      Upload skill file
                    </Text>
                    <Text className="text-zinc-400 text-[12px]">
                      Import an existing SKILL.md file
                    </Text>
                  </View>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
