import { useT } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconBrandFigma,
  IconCheck,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import {
  getFigmaConnectionStatus,
  saveFigmaAccessToken,
  type FigmaConnectionStatus,
} from "@/lib/figma-connection";
import {
  buildFigmaLinkChatPrompt,
  extractFigmaLink,
  type FigmaLink,
  type FigmaLinkChatAction,
} from "@/lib/figma-url";

const FIGMA_TOKEN_DOCS_URL =
  "https://developers.figma.com/docs/rest-api/personal-access-tokens/";

export function useDetectedFigmaComposerLink(): {
  link: FigmaLink | null;
  onComposerTextChange: (text: string) => void;
} {
  const linkRef = useRef<FigmaLink | null>(null);
  const [link, setLink] = useState<FigmaLink | null>(null);
  const onComposerTextChange = useCallback((text: string) => {
    const next = extractFigmaLink(text);
    if (next?.url === linkRef.current?.url) return;
    linkRef.current = next;
    setLink(next);
  }, []);
  return { link, onComposerTextChange };
}

export interface FigmaLinkComposerBubbleProps {
  link: FigmaLink;
  designId?: string | null;
}

export function FigmaLinkComposerBubble({
  link,
  designId,
}: FigmaLinkComposerBubbleProps) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [connection, setConnection] = useState<FigmaConnectionStatus | null>(
    null,
  );
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshVersionRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);

  const refreshConnection = useCallback(
    async (externalSignal?: AbortSignal) => {
      refreshAbortRef.current?.abort();
      const controller = new AbortController();
      refreshAbortRef.current = controller;
      const version = ++refreshVersionRef.current;
      const abortFromExternal = () => controller.abort();
      if (externalSignal?.aborted) controller.abort();
      else
        externalSignal?.addEventListener("abort", abortFromExternal, {
          once: true,
        });
      setChecking(true);
      setError(null);
      try {
        const result = await getFigmaConnectionStatus({
          signal: controller.signal,
        });
        if (
          !controller.signal.aborted &&
          version === refreshVersionRef.current
        ) {
          setConnection(result);
        }
      } catch (reason) {
        if (
          !controller.signal.aborted &&
          version === refreshVersionRef.current
        ) {
          // Preserve the last known status on a transient refresh failure. A
          // failed GET must never turn a connected user into an apparent
          // disconnected user and prompt them to paste their token again.
          setError(
            reason instanceof Error
              ? reason.message
              : tRef.current("chat.figmaLink.connectionCheckFailed"),
          );
        }
      } finally {
        externalSignal?.removeEventListener("abort", abortFromExternal);
        if (
          !controller.signal.aborted &&
          version === refreshVersionRef.current
        ) {
          setChecking(false);
        }
      }
    },
    [],
  );

  useEffect(
    () => () => {
      refreshVersionRef.current += 1;
      refreshAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setToken("");
    setError(null);
    void refreshConnection(controller.signal);
    return () => controller.abort();
  }, [link.url, refreshConnection]);

  useEffect(() => {
    const handleConnectionChange = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key && key !== "FIGMA_ACCESS_TOKEN") return;
      void refreshConnection();
    };
    window.addEventListener(
      "agent-engine:configured-changed",
      handleConnectionChange,
    );
    return () =>
      window.removeEventListener(
        "agent-engine:configured-changed",
        handleConnectionChange,
      );
  }, [refreshConnection]);

  const handleConnect = useCallback(async () => {
    if (!token.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveFigmaAccessToken(token);
      refreshVersionRef.current += 1;
      refreshAbortRef.current?.abort();
      setConnection(result);
      setChecking(false);
      setToken("");
    } catch (reason) {
      // Do not retain a rejected credential in component state or the DOM.
      setToken("");
      setError(
        reason instanceof Error
          ? reason.message
          : t("chat.figmaLink.connectFailed"),
      );
    } finally {
      setSaving(false);
    }
  }, [saving, t, token]);

  const handleAgentAction = useCallback(
    (action: FigmaLinkChatAction) => {
      const prompt = buildFigmaLinkChatPrompt(action, link, designId);
      sendToDesignAgentChat({
        ...prompt,
        submit: false,
        openSidebar: false,
      });
    },
    [designId, link],
  );

  return (
    <div className="mx-3 mb-1.5 rounded-lg border border-border bg-muted/35 px-2.5 py-2 shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <IconBrandFigma className="size-4 shrink-0 text-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {link.kind === "frame"
              ? t("chat.figmaLink.frameDetected")
              : t("chat.figmaLink.fileDetected")}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {link.url}
          </p>
        </div>
        {connection?.connected ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            <IconCheck className="size-3 text-emerald-500" />
            {connection.last4
              ? t("chat.figmaLink.connectedLast4", {
                  last4: connection.last4,
                })
              : t("chat.figmaLink.connected")}
          </span>
        ) : null}
      </div>

      {checking ? (
        <div
          className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground"
          role="status"
        >
          <IconLoader2 className="size-3 animate-spin" />
          {t("chat.figmaLink.checkingConnection")}
        </div>
      ) : !connection ? null : connection.connected ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => handleAgentAction("import")}
          >
            {link.kind === "frame"
              ? t("chat.figmaLink.importFrame")
              : t("chat.figmaLink.chooseFrame")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => handleAgentAction("inspect")}
          >
            {t("chat.figmaLink.inspect")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={!designId}
            onClick={() => handleAgentAction("export-svg")}
          >
            {t("chat.figmaLink.exportSvg")}
          </Button>
          <span className="min-w-0 flex-1 text-end text-[9px] leading-tight text-muted-foreground">
            {t("chat.figmaLink.actionsPrefill")}
          </span>
        </div>
      ) : (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleConnect();
          }}
        >
          <p className="mb-1.5 text-[10px] leading-snug text-muted-foreground">
            {t("chat.figmaLink.connectDescription")}
          </p>
          <div className="flex items-center gap-1.5">
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={t("chat.figmaLink.tokenLabel")}
              placeholder={t("chat.figmaLink.tokenPlaceholder")}
              className="h-7 min-w-0 flex-1 px-2 text-[11px]"
            />
            <Button
              type="submit"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={!token.trim() || saving}
            >
              {saving ? <IconLoader2 className="size-3 animate-spin" /> : null}
              {saving
                ? t("chat.figmaLink.connecting")
                : t("chat.figmaLink.connect")}
            </Button>
            <a
              href={connection?.docsUrl ?? FIGMA_TOKEN_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t("chat.figmaLink.getToken")}
              <IconExternalLink className="size-3" />
            </a>
          </div>
        </form>
      )}

      {error ? (
        <div
          role="alert"
          className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-destructive"
        >
          <IconAlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{error}</span>
          {!checking && !connection ? (
            <button
              type="button"
              className="ms-auto shrink-0 underline underline-offset-2"
              onClick={() => void refreshConnection()}
            >
              {t("chat.figmaLink.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
