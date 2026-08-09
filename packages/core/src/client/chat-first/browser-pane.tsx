import {
  IconArrowLeft,
  IconArrowRight,
  IconExternalLink,
  IconRefresh,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";

import { resolveChatFirstBrowserTarget } from "../chat-first.js";
import { defaultChatFirstCopy } from "./copy.js";
import type { ChatFirstBrowserPaneProps } from "./types.js";

export function ChatFirstBrowserPane({
  url,
  title,
  onClose,
  renderEmbed,
  copy = defaultChatFirstCopy,
}: ChatFirstBrowserPaneProps) {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [draftUrl, setDraftUrl] = useState(url);
  const [reloadKey, setReloadKey] = useState(0);
  const [history, setHistory] = useState([url]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUrl(url);
    setDraftUrl(url);
    setHistory([url]);
    setHistoryIndex(0);
    setNavigationError(null);
  }, [url]);

  function navigate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = resolveChatFirstBrowserTarget({ url: draftUrl });
    if (target.status !== "ready") {
      setNavigationError(copy("browserInvalidUrl"));
      return;
    }
    const nextUrl = target.target.url;
    setNavigationError(null);
    setCurrentUrl(nextUrl);
    setDraftUrl(nextUrl);
    setHistory((current) => [...current.slice(0, historyIndex + 1), nextUrl]);
    setHistoryIndex((index) => index + 1);
    setReloadKey((key) => key + 1);
  }

  function goBack() {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    const nextUrl = history[nextIndex];
    setHistoryIndex(nextIndex);
    setCurrentUrl(nextUrl);
    setDraftUrl(nextUrl);
    setNavigationError(null);
    setReloadKey((key) => key + 1);
  }

  function goForward() {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    const nextUrl = history[nextIndex];
    setHistoryIndex(nextIndex);
    setCurrentUrl(nextUrl);
    setDraftUrl(nextUrl);
    setNavigationError(null);
    setReloadKey((key) => key + 1);
  }

  return (
    <section
      data-chat-first-browser-pane
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
      aria-label={copy("surface.browser.label")}
    >
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2">
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={historyIndex <= 0}
            onClick={goBack}
            aria-label={copy("browserBack")}
            title={copy("browserBack")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"
          >
            <IconArrowLeft size={15} />
          </button>
          <button
            type="button"
            disabled={historyIndex >= history.length - 1}
            onClick={goForward}
            aria-label={copy("browserForward")}
            title={copy("browserForward")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"
          >
            <IconArrowRight size={15} />
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            aria-label={copy("browserReload")}
            title={copy("browserReload")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <IconRefresh size={15} />
          </button>
        </div>
        <form
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-background px-2"
          onSubmit={navigate}
        >
          <IconWorld
            size={13}
            className="shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            aria-label={copy("browserAddress")}
            spellCheck={false}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </form>
        <div className="flex shrink-0 items-center gap-0.5">
          {title ? (
            <span
              className="hidden max-w-28 truncate px-1 text-xs text-muted-foreground xl:block"
              title={title}
            >
              {title}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() =>
              window.open(currentUrl, "_blank", "noopener,noreferrer")
            }
            aria-label={copy("browserOpenExternal")}
            title={copy("browserOpenExternal")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <IconExternalLink size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy("browserClose")}
            title={copy("browserClose")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <IconX size={15} />
          </button>
        </div>
      </header>
      {navigationError ? (
        <p
          className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          role="alert"
        >
          {navigationError}
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {renderEmbed({
          url: currentUrl,
          title: title || copy("browserPage"),
          key: `${currentUrl}:${reloadKey}`,
        })}
      </div>
    </section>
  );
}
