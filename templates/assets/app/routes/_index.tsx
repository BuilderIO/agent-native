import { useEffect } from "react";
import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client";
import { IconPhoto, IconSparkles, IconVideo } from "@tabler/icons-react";
import { RecentDraftsSection } from "@/components/create/RecentDraftsSection";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";
import { TAB_ID } from "@/lib/tab-id";

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
        browserTabId={TAB_ID}
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
            <div className="mt-8 w-full text-left">
              <RecentDraftsSection />
            </div>
          </div>
        }
      />
    </div>
  );
}
