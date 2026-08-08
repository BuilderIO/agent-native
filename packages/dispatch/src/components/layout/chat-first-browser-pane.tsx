import { resolveChatFirstBrowserTarget } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconArrowRight,
  IconExternalLink,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";

import { cn } from "../../lib/utils";

export function ChatFirstBrowserPane({
  url,
  title,
  onClose,
  embedded = false,
}: {
  url: string;
  title?: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const t = useT();
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
      setNavigationError(t("dispatch.pages.chatFirstBrowserInvalidUrl"));
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

  function openExternal() {
    window.open(currentUrl, "_blank", "noopener,noreferrer");
  }

  const content = (
    <>
      <header className="dispatch-chat-first-browser-pane__chrome">
        <div className="dispatch-chat-first-browser-pane__controls">
          <button
            type="button"
            disabled={historyIndex <= 0}
            onClick={goBack}
            aria-label={t("dispatch.pages.chatFirstBrowserBack")}
          >
            <IconArrowLeft size={15} />
          </button>
          <button
            type="button"
            disabled={historyIndex >= history.length - 1}
            onClick={goForward}
            aria-label={t("dispatch.pages.chatFirstBrowserForward")}
          >
            <IconArrowRight size={15} />
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            aria-label={t("dispatch.pages.chatFirstBrowserReload")}
            title={t("dispatch.pages.chatFirstBrowserReload")}
          >
            <IconRefresh size={15} />
          </button>
        </div>
        <form
          className="dispatch-chat-first-browser-pane__address"
          onSubmit={navigate}
        >
          <input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            aria-label={t("dispatch.pages.chatFirstBrowserAddress")}
            spellCheck={false}
          />
        </form>
        <div className="dispatch-chat-first-browser-pane__actions">
          {title ? <span title={title}>{title}</span> : null}
          <button
            type="button"
            onClick={openExternal}
            aria-label={t("dispatch.pages.chatFirstBrowserOpenExternal")}
            title={t("dispatch.pages.chatFirstBrowserOpenExternal")}
          >
            <IconExternalLink size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("dispatch.pages.chatFirstBrowserClose")}
            title={t("dispatch.pages.chatFirstBrowserClose")}
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
      {/* This is intentionally a visible browser surface, not an agent-native
          app pane: the address bar stays present and no app identity is shown. */}
      <iframe
        key={`${currentUrl}:${reloadKey}`}
        className={cn("dispatch-chat-first-browser-pane__frame")}
        src={currentUrl}
        title={title || t("dispatch.pages.chatFirstBrowserPage")}
        referrerPolicy="no-referrer"
      />
    </>
  );

  return embedded ? (
    <section
      className="dispatch-chat-first-browser-pane h-full min-h-0 w-full"
      data-dispatch-chat-first-browser-pane
      aria-label={t("dispatch.pages.chatFirstSurfaceBrowserLabel")}
    >
      {content}
    </section>
  ) : (
    <section
      className="dispatch-chat-first-browser-pane"
      data-dispatch-chat-first-browser-pane
      aria-label={t("dispatch.pages.chatFirstSurfaceBrowserLabel")}
    >
      {content}
    </section>
  );
}
