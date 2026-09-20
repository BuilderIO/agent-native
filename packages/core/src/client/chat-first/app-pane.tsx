import { Skeleton } from "@agent-native/toolkit/ui";

import { defaultChatFirstCopy } from "./copy.js";
import type { ChatFirstAppPaneProps } from "./types.js";

export function ChatFirstAppPane({
  app,
  status,
  embedUrl,
  errorMessage,
  onRetry,
  renderEmbed,
  copy = defaultChatFirstCopy,
}: ChatFirstAppPaneProps) {
  return (
    <section
      data-chat-first-app-pane
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
      aria-label={app ? `${app.name} app` : copy("appUnavailable")}
    >
      {status === "loading" ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : status === "ready" && app && embedUrl ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {renderEmbed({ url: embedUrl, title: app.name })}
        </div>
      ) : status === "error" ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {errorMessage || copy("appLoadError")}
          </p>
          {onRetry ? (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
              onClick={onRetry}
            >
              {copy("retry")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {copy("appUnavailable")}
        </div>
      )}
    </section>
  );
}
