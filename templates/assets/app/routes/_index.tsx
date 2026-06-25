import {
  AgentChatSurface,
  getBrowserTabId,
  markAgentChatHomeHandoff,
  readClientAppState,
  sendToAgentChat,
  useT,
  writeClientAppState,
} from "@agent-native/core/client";
import { IconPhoto, IconSparkles, IconVideo } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";

// The composer's model picker shows the chat LLM (Claude/OpenAI/Gemini). The
// Assets app also drives a separate *image* model, so we surface it in the same
// menu — otherwise "Claude" reads as the image generator, which it isn't. The
// choice persists in per-user application state so the generate-image action
// (server-side) can read it as the default model. Values must be valid
// IMAGE_MODELS ids from shared/api.
const IMAGE_MODEL_STATE_KEY = "imageGenerationModel";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
const IMAGE_MODEL_OPTIONS = [
  {
    value: "gemini-3-pro-image",
    modelName: "Gemini 3 Pro",
    descriptorKey: "create.modelBestQuality",
  },
  {
    value: "gemini-3.1-flash-image",
    modelName: "Gemini 3.1 Flash",
    descriptorKey: "create.modelFast",
  },
  { value: "gemini-2.5-flash-image", modelName: "Gemini 2.5 Flash" },
] as const;

// Empty-state starters. Clicking one prefills the composer (without sending) so
// the user can finish the thought instead of staring at a chip that does
// nothing. `submit: false` = prefill only; `openSidebar: false` keeps focus on
// the page-level Create surface.
const CHAT_STARTERS = [
  {
    key: "image",
    Icon: IconPhoto,
    label: "image",
    prompt: "Create an image of ",
  },
  {
    key: "video",
    Icon: IconVideo,
    label: "video",
    prompt: "Create a video of ",
  },
  { key: "refine", Icon: IconSparkles, label: "refine", prompt: "Refine " },
] as const;

const SEO_TITLE =
  "Agent-Native Assets - Open Source AI asset library for brand-safe images and video";
const SEO_DESCRIPTION =
  "Open Source asset manager for AI teams to organize brand libraries, search creative work, and generate on-brand images and videos.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

function chatThreadPath(threadId: string | null) {
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/";
}

export default function CreatePage() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL);

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) {
        markAgentChatHomeHandoff(ASSETS_CHAT_STORAGE_KEY);
      }
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  // Hydrate the saved image-model default so the picker reflects the user's
  // last choice across sessions.
  useEffect(() => {
    let cancelled = false;
    void readClientAppState<{ model?: string }>(IMAGE_MODEL_STATE_KEY)
      .then((state) => {
        const stored = state?.model;
        if (
          !cancelled &&
          stored &&
          IMAGE_MODEL_OPTIONS.some((option) => option.value === stored)
        ) {
          setImageModel(stored);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleImageModelChange = useCallback((value: string) => {
    setImageModel(value);
    void writeClientAppState(IMAGE_MODEL_STATE_KEY, { model: value }).catch(
      () => {},
    );
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="assets-create-chat-panel"
        defaultMode="chat"
        storageKey={ASSETS_CHAT_STORAGE_KEY}
        threadUrlSync={{
          routeThreadId: threadId ?? null,
          getPath: chatThreadPath,
          navigate,
        }}
        browserTabId={getBrowserTabId()}
        imageModelMenu={{
          value: imageModel,
          options: IMAGE_MODEL_OPTIONS.map((option) => ({
            value: option.value,
            label:
              "descriptorKey" in option && option.descriptorKey
                ? `${option.modelName} · ${t(option.descriptorKey)}`
                : option.modelName,
          })),
          onChange: handleImageModelChange,
          label: t("create.imageModel"),
        }}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText={t("create.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder={t("create.composerPlaceholder")}
        composerSlot={
          <div className="assets-create-chat-intro">
            <h1>{t("create.heroTitle")}</h1>
            <p>{t("create.heroDescription")}</p>
            <div className="assets-create-chat-pill-row">
              {CHAT_STARTERS.map(({ key, Icon, prompt }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    sendToAgentChat({
                      message: prompt,
                      submit: false,
                      openSidebar: false,
                    })
                  }
                >
                  <Icon className="size-3.5" />
                  {t(`create.starters.${key}`)}
                </button>
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
}
