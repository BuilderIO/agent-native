import { useEffect } from "react";
import {
  AgentChatSurface,
  getBrowserTabId,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client";
import { IconPhoto, IconSparkles, IconVideo } from "@tabler/icons-react";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";

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

export default function CreatePage() {
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
        browserTabId={getBrowserTabId()}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText="Ask Assets what to create."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Describe the asset - attach images or text context with +"
        composerSlot={
          <div className="assets-create-chat-intro">
            <h1>What asset should we make?</h1>
            <p>
              Start with a hero image, product reveal, reference edit, or a
              direction you want to explore.
            </p>
            <div className="assets-create-chat-pill-row" aria-hidden="true">
              <span>
                <IconPhoto className="size-3.5" />
                image
              </span>
              <span>
                <IconVideo className="size-3.5" />
                video
              </span>
              <span>
                <IconSparkles className="size-3.5" />
                refine
              </span>
            </div>
          </div>
        }
      />
    </div>
  );
}
