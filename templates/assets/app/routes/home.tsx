import {
  AgentChatHome,
  markAgentChatHomeHandoff,
  sendToAgentChat,
} from "@agent-native/core/client/agent-chat";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  AgentSuggestionBar,
  agentSuggestionPrompt,
} from "@agent-native/toolkit/agentkit";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { RecentDraftsSection } from "@/components/create/RecentDraftsSection";
import { GenerationResults } from "@/components/generation/GenerationResults";
import { useImageModelMenu } from "@/hooks/use-image-model-menu";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";

const CHAT_STARTERS = [
  {
    key: "image",
    prompt: "Create an image of ",
  },
  {
    key: "video",
    prompt: "Create a video of ",
  },
  { key: "refine", prompt: "Refine " },
] as const;

const SEO_TITLE =
  "Assets - Open Source AI asset library for brand-safe images and video";
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
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/home";
}

export default function CreatePage() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const threadUrlSync = threadId
    ? {
        routeThreadId: threadId,
        getPath: chatThreadPath,
        navigate,
      }
    : undefined;
  const imageModelMenu = useImageModelMenu(threadId);

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
    <AgentChatHome
      className="h-full min-h-0"
      chatViewTransition
      surfaceClassName="assets-create-chat-panel"
      defaultMode="chat"
      storageKey={ASSETS_CHAT_STORAGE_KEY}
      threadUrlSync={threadUrlSync}
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
      afterComposerSlot={
        <AgentSuggestionBar
          ariaLabel={t("create.heroTitle")}
          suggestions={CHAT_STARTERS.map(({ key, prompt }) => ({
            id: key,
            label: t(`create.starters.${key}`),
            prompt,
          }))}
          onSelect={(suggestion) =>
            sendToAgentChat({
              message: agentSuggestionPrompt(suggestion),
              submit: false,
              openSidebar: false,
            })
          }
          className="px-0 py-0"
        />
      }
      homeIntroSlot={
        <div className="assets-create-chat-intro">
          <h1>{t("create.heroTitle")}</h1>
          <div className="mt-8 w-[min(100vw-2rem,64rem)] px-4 text-left sm:px-6">
            <RecentDraftsSection />
          </div>
        </div>
      }
    />
  );
}
