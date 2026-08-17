import {
  IconArrowUp,
  IconAt,
  IconBolt,
  IconBulb,
  IconCamera,
  IconCheck,
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
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { MOBILE_SHEET_CLOSE_DURATION_MS } from "@/components/MobileSheet";
import { fetchMentions } from "@/lib/agent-chat/api";
import {
  activeMentionQuery,
  mentionToReference,
  replaceMention,
} from "@/lib/agent-chat/mention-query";
import {
  formatMobileModelLabel,
  getMobileAgentLabel,
} from "@/lib/agent-chat/model-picker";
import type {
  ChatAttachment,
  ChatReference,
  MentionItem,
} from "@/lib/agent-chat/types";
import type { AgentChatSettings } from "@/lib/agent-chat/use-agent-chat";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { getAndClearLastDictatedText } from "@/lib/voice-api";

import { MobilePopover } from "./MobilePopover";

export type ActionTag = {
  id: string;
  label: string;
  icon: "bolt" | "bulb" | "clock" | "tools" | "upload";
};

function renderActionTagIcon(iconName: ActionTag["icon"], color: string) {
  switch (iconName) {
    case "bolt":
      return <IconBolt color={color} size={14} strokeWidth={2} />;
    case "bulb":
      return <IconBulb color={color} size={14} strokeWidth={2} />;
    case "clock":
      return <IconClock color={color} size={14} strokeWidth={2} />;
    case "tools":
      return <IconTools color={color} size={14} strokeWidth={2} />;
    case "upload":
      return <IconUpload color={color} size={14} strokeWidth={2} />;
    default:
      return null;
  }
}

function MentionRowIcon({
  refType,
  color,
}: {
  refType: string;
  color: string;
}) {
  if (refType === "agent" || refType === "custom-agent") {
    return <IconRobot color={color} size={17} strokeWidth={1.8} />;
  }
  if (refType === "file" || refType === "skill") {
    return <IconFileText color={color} size={17} strokeWidth={1.8} />;
  }
  return <IconAt color={color} size={17} strokeWidth={1.8} />;
}

function ActionMenuRow({
  label,
  onPress,
  icon,
  trailing,
}: {
  label: string;
  onPress: () => void;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      className="h-11 flex-row items-center gap-3 rounded-lg px-3 active:bg-accent"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View className="w-5 items-center justify-center">{icon}</View>
      <Text className="flex-1 text-popover-foreground text-[14px] font-medium">
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

function settingsSummary(settings: AgentChatSettings): string {
  const agent = getMobileAgentLabel(settings.engine);
  const effort = settings.effort
    ? ` · ${settings.effort[0]!.toUpperCase()}${settings.effort.slice(1, 3)}`
    : "";
  return `${agent === "Default" ? formatMobileModelLabel(settings.model) : agent}${effort}`;
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

async function documentAssetToAttachment(
  asset: DocumentPicker.DocumentPickerAsset,
): Promise<ChatAttachment | null> {
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
}

async function pickAnyFileAttachments(): Promise<ChatAttachment[]> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return [];
    const converted = await Promise.all(
      result.assets.map(documentAssetToAttachment),
    );
    return converted.filter((a): a is ChatAttachment => a !== null);
  } catch (error) {
    console.error("pickAnyFileAttachments error:", error);
    return [];
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
  onSelectMode,
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
  onSelectMode?: (mode: "plan" | undefined) => void;
}) {
  const { foreground, mutedForeground, primaryForeground, accentBlue, theme } =
    useMobileThemeColors();
  const router = useRouter();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [references, setReferences] = useState<ChatReference[]>([]);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
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

  const addAttachments = useCallback((incoming: ChatAttachment[]) => {
    if (incoming.length) setAttachments((current) => [...current, ...incoming]);
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
    setTimeout(runPendingAction, MOBILE_SHEET_CLOSE_DURATION_MS + 16);
  };

  const handleOpenPlusMenu = () => {
    setMenuScreen("main");
    setPlusMenuOpen(true);
  };

  const handleUploadFile = () => {
    closeMenuThen(() => {
      void pickAnyFileAttachments().then(addAttachments);
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
      void pickAnyFileAttachments().then(addAttachments);
    });
  };

  const handleIntegrations = () => {
    setPlusMenuOpen(false);
    onOpenSettings();
  };

  const selectMode = (mode: "plan" | undefined) => {
    if (onSelectMode) {
      onSelectMode(mode);
    } else if (mode !== settings.mode) {
      onToggleMode();
    }
    setModeMenuOpen(false);
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
                    <IconFileText color={foreground} size={20} />
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
                  <IconX color={foreground} size={11} strokeWidth={2.4} />
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
                <MentionRowIcon
                  refType={item.refType}
                  color={mutedForeground}
                />
                <View className="flex-1">
                  <Text
                    className="text-foreground text-[14px] font-medium"
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
                <ActivityIndicator size="small" color={mutedForeground} />
                <Text className="text-status-gray text-[13px]">Searching…</Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}

      <View className="rounded-[22px] bg-card-dark border border-border-dark px-3.5 pt-3 pb-2.5">
        {actionTag && (
          <View className="flex-row items-center gap-1.5 self-start px-2.5 py-1 rounded-lg bg-zinc-800/90 border border-zinc-700/80 mb-2">
            {renderActionTagIcon(actionTag.icon, foreground)}
            <Text className="text-foreground text-[13px] font-medium pl-0.5">
              {actionTag.label}
            </Text>
            <Pressable
              onPress={() => setActionTag(null)}
              className="p-0.5 ml-1 active:opacity-75"
              accessibilityRole="button"
              accessibilityLabel={`Remove ${actionTag.label} tag`}
            >
              <IconX color={mutedForeground} size={13} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}

        <TextInput
          className="text-foreground text-[15px] leading-5 min-h-[44px] max-h-32 py-1 mb-1.5"
          value={text}
          onChangeText={setText}
          selection={selection}
          onSelectionChange={(event) =>
            setSelection(event.nativeEvent.selection)
          }
          placeholder="Message the agent…  (@ to mention)"
          placeholderTextColor={mutedForeground}
          multiline
          keyboardAppearance={theme}
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
            <IconPlus color={mutedForeground} size={19} strokeWidth={2} />
          </Pressable>

          <View className="flex-row items-center gap-2.5">
            <Pressable
              className="flex-row items-center gap-1 py-1 px-1 rounded-lg active:bg-accent"
              onPress={onOpenSettings}
              accessibilityRole="button"
              accessibilityLabel="Model and effort settings"
            >
              <Text className="text-[13px] font-medium text-zinc-400">
                {settingsSummary(settings)}
              </Text>
              <IconChevronDown
                color={mutedForeground}
                size={13}
                strokeWidth={2}
              />
            </Pressable>

            <Pressable
              className="flex-row items-center gap-1 py-1 px-1 rounded-lg active:opacity-75"
              onPress={() => setModeMenuOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Choose mode, currently ${settings.mode === "plan" ? "Plan" : "Act"}`}
            >
              <Text
                className={`text-[13px] font-medium ${
                  settings.mode === "plan"
                    ? "text-accent-blue"
                    : "text-muted-foreground"
                }`}
              >
                {settings.mode === "plan" ? "Plan" : "Act"}
              </Text>
              <IconChevronDown
                color={mutedForeground}
                size={13}
                strokeWidth={2}
              />
            </Pressable>

            {isStreaming && (
              <ActivityIndicator
                size="small"
                color={accentBlue}
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
              <IconMicrophone
                color={mutedForeground}
                size={19}
                strokeWidth={1.8}
              />
            </Pressable>

            {isStreaming ? (
              <Pressable
                className="w-8 h-8 rounded-xl bg-primary items-center justify-center active:opacity-75"
                onPress={onStop}
                accessibilityRole="button"
                accessibilityLabel="Stop generating"
              >
                <IconPlayerStopFilled color={primaryForeground} size={14} />
              </Pressable>
            ) : (
              <Pressable
                className={`w-8 h-8 rounded-xl items-center justify-center active:opacity-75 ${
                  canSend ? "bg-primary" : "bg-zinc-800/80"
                }`}
                onPress={submit}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                <IconArrowUp
                  color={canSend ? primaryForeground : mutedForeground}
                  size={17}
                  strokeWidth={2.2}
                />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <MobilePopover
        visible={modeMenuOpen}
        title="Mode"
        onClose={() => setModeMenuOpen(false)}
        bottomClassName="mb-28"
        accessibilityLabel="Dismiss mode picker"
      >
        {(
          [
            ["plan", "Plan mode"],
            [undefined, "Act mode"],
          ] as const
        ).map(([mode, label]) => (
          <Pressable
            key={label}
            className="flex-row items-center justify-between border-b border-border px-4 py-3.5 active:bg-accent"
            onPress={() => selectMode(mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected: settings.mode === mode }}
            accessibilityLabel={label}
          >
            <Text
              className={`text-[15px] ${
                settings.mode === mode
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </Text>
            {settings.mode === mode ? (
              <IconCheck color={foreground} size={17} strokeWidth={2.2} />
            ) : null}
          </Pressable>
        ))}
      </MobilePopover>

      <MobilePopover
        visible={plusMenuOpen}
        title={menuScreen === "main" ? "Actions & Tools" : "Create Skill"}
        onClose={() => setPlusMenuOpen(false)}
        bottomClassName="mb-8"
        overlayClassName="bg-overlay-dark"
        accessibilityLabel="Dismiss actions menu"
      >
        <View className="p-2">
          {menuScreen === "main" ? (
            <>
              <ActionMenuRow
                label="Choose Photo"
                onPress={handlePickPhoto}
                icon={
                  <IconPhoto color={foreground} size={18} strokeWidth={1.8} />
                }
              />
              <ActionMenuRow
                label="Upload File"
                onPress={handleUploadFile}
                icon={
                  <IconUpload color={foreground} size={18} strokeWidth={1.8} />
                }
              />
              <ActionMenuRow
                label="Take Photo"
                onPress={handleTakePhoto}
                icon={
                  <IconCamera color={foreground} size={18} strokeWidth={1.8} />
                }
              />
              <View className="my-1 h-px bg-border" />
              <ActionMenuRow
                label="Schedule Task"
                onPress={() =>
                  handleSelectActionTag({
                    id: "schedule-task",
                    label: "Schedule Task",
                    icon: "clock",
                  })
                }
                icon={
                  <IconClock color={foreground} size={18} strokeWidth={1.8} />
                }
              />
              <ActionMenuRow
                label="Create Automation"
                onPress={() =>
                  handleSelectActionTag({
                    id: "create-automation",
                    label: "Create Automation",
                    icon: "bolt",
                  })
                }
                icon={
                  <IconBolt color={foreground} size={18} strokeWidth={1.8} />
                }
              />
              <ActionMenuRow
                label="Create Extension"
                onPress={() =>
                  handleSelectActionTag({
                    id: "create-extension",
                    label: "Create Extension",
                    icon: "tools",
                  })
                }
                icon={
                  <IconTools color={foreground} size={18} strokeWidth={1.8} />
                }
              />
              <View className="my-1 h-px bg-border" />
              <ActionMenuRow
                label="Integrations"
                onPress={handleIntegrations}
                icon={
                  <IconPlugConnected
                    color={foreground}
                    size={18}
                    strokeWidth={1.8}
                  />
                }
              />
              <ActionMenuRow
                label="Create Skill"
                onPress={() => setMenuScreen("skill")}
                icon={
                  <IconBulb color={foreground} size={18} strokeWidth={1.8} />
                }
                trailing={
                  <IconChevronRight color={mutedForeground} size={17} />
                }
              />
            </>
          ) : (
            <>
              <ActionMenuRow
                label="Back to actions"
                onPress={() => setMenuScreen("main")}
                icon={<IconChevronLeft color={mutedForeground} size={18} />}
              />
              <View className="my-1 h-px bg-border" />
              <ActionMenuRow
                label="Create new skill"
                onPress={() =>
                  handleSelectActionTag({
                    id: "create-skill",
                    label: "Create Skill",
                    icon: "bulb",
                  })
                }
                icon={
                  <IconBulb color={foreground} size={18} strokeWidth={1.8} />
                }
              />
              <ActionMenuRow
                label="Upload skill file"
                onPress={handleUploadSkillFile}
                icon={
                  <IconUpload color={foreground} size={18} strokeWidth={1.8} />
                }
              />
            </>
          )}
        </View>
      </MobilePopover>
    </View>
  );
}
