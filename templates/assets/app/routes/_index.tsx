import {
  AgentChatSurface,
  getBrowserTabId,
  markAgentChatHomeHandoff,
  sendToAgentChat,
  useT,
} from "@agent-native/core/client";
import { IconPhoto, IconSparkles, IconVideo } from "@tabler/icons-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { RecentDraftsSection } from "@/components/create/RecentDraftsSection";
import { GenerationResults } from "@/components/generation/GenerationResults";
import { useImageModelMenu } from "@/hooks/use-image-model-menu";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";

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
  const imageModelMenu = useImageModelMenu();

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
        threadFooterSlot={({ threadId }) => (
          <GenerationResults threadId={threadId} />
        )}
        imageModelMenu={imageModelMenu}
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
            <div className="mt-8 w-full text-left">
              <RecentDraftsSection />
            </div>
          </div>
        }
      />
    </div>
  );
}
