import { IconEye, IconX } from "@tabler/icons-react";

import { defaultChatFirstCopy } from "./copy.js";
import type { ChatFirstSessionWatchPaneProps } from "./types.js";

export function ChatFirstSessionWatchPane({
  target,
  onClose,
  renderChat,
  copy = defaultChatFirstCopy,
}: ChatFirstSessionWatchPaneProps) {
  if (!target) return null;
  const sessionName = target.title || copy("session");

  return (
    <section
      data-chat-first-watch-pane
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
      aria-label={copy("watchedSession")}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <IconEye
          size={16}
          className="shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {copy("watchingSession", { name: sessionName })}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {target.sessionId}
          </p>
        </div>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={copy("stopWatchingSession")}
          title={copy("stopWatching")}
          onClick={onClose}
        >
          <IconX size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1">{renderChat(target)}</div>
    </section>
  );
}
