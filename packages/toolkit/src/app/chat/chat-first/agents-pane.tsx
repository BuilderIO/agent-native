import { ChatFirstAgentActivityPanel } from "./ChatFirstAgentActivityPanel.js";
import { useChatFirstCopy } from "./copy.js";
import type { ChatFirstAgentsPaneProps } from "./types.js";

export function ChatFirstAgentsPane({
  activities,
  loading = false,
  error,
  onRefresh,
  onWatch,
  copy: copyProp,
}: ChatFirstAgentsPaneProps) {
  const copy = useChatFirstCopy(copyProp);
  return (
    <section
      data-chat-first-agents-pane
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background"
      aria-label={copy("agentsTitle")}
    >
      <ChatFirstAgentActivityPanel
        activities={activities}
        loading={loading}
        error={error ?? null}
        onRefresh={onRefresh}
        onWatch={onWatch}
        copy={copy}
      />
    </section>
  );
}
