import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import {
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../../lib/workspace-apps";
import { ActionQueryError } from "../action-query-error";
import { AppIcon } from "../app-icon";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { useDispatchChatFirstPane } from "./chat-first-context";

interface EmbedSessionResult {
  startUrl: string;
}

interface EmbedSessionInput {
  app: string;
  path?: string;
  url?: string;
  chrome: "minimal";
}

export function ChatFirstAppPane({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const { pane, closePane } = useDispatchChatFirstPane();
  const appsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    { includeAgentCards: false },
  );
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<Error | null>(null);
  const [embedAttempt, setEmbedAttempt] = useState(0);
  const apps = appsQuery.data ?? [];
  const app = useMemo(
    () => apps.find((candidate) => candidate.id === pane?.appId) ?? null,
    [apps, pane?.appId],
  );
  const href = app ? workspaceAppHref(app) : null;
  const createEmbedSession = useActionMutation<
    EmbedSessionResult,
    EmbedSessionInput
  >("create_embed_session", { skipActionQueryInvalidation: true });
  const embedInput = useMemo<EmbedSessionInput | null>(() => {
    if (!app || app.status === "pending") return null;
    if (pane?.path?.startsWith("/")) {
      return { app: app.id, path: pane.path, chrome: "minimal" };
    }
    // `app.path` is the Dispatch mount path, not necessarily the target
    // app's own route. Once the registry has an absolute app URL, the gateway
    // action already scopes the request with `app`, so the app root is the
    // only portable default and avoids double-prefixing `/mail/mail`.
    if (app.url?.trim()) {
      return { app: app.id, path: "/", chrome: "minimal" };
    }
    if (app.path.startsWith("/")) {
      return { app: app.id, path: app.path, chrome: "minimal" };
    }
    if (!href) return null;
    return { app: app.id, url: href, chrome: "minimal" };
  }, [app, href, pane?.path]);

  useEffect(() => {
    if (!pane || !app || !embedInput) return;
    let cancelled = false;
    setEmbedUrl(null);
    setEmbedError(null);
    void createEmbedSession
      .mutateAsync(embedInput)
      .then((result) => {
        if (!cancelled) setEmbedUrl(result.startUrl);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setEmbedError(
            cause instanceof Error ? cause : new Error(String(cause)),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [app?.id, createEmbedSession.mutateAsync, embedAttempt, embedInput]);

  if (!pane) return null;

  const content = (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        {app ? (
          <AppIcon
            id={app.id}
            name={app.name}
            size="sm"
            className="size-6 rounded-md"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {app?.name ?? pane.appId}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {pane.view
              ? t("dispatch.pages.chatFirstContextualView", {
                  view: pane.view,
                })
              : pane.path
                ? t("dispatch.pages.chatFirstAppView")
                : t("dispatch.pages.chatFirstWorkspaceApp")}
          </p>
        </div>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("dispatch.pages.chatFirstCloseAppPane")}
          onClick={closePane}
        >
          <IconX size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="relative min-h-0 flex-1 bg-muted/20">
        {appsQuery.isError ? (
          <div className="p-4">
            <ActionQueryError
              error={appsQuery.error}
              onRetry={() => void appsQuery.refetch()}
            />
          </div>
        ) : appsQuery.isLoading && !app ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : !app ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {t("dispatch.pages.chatFirstAppUnavailable")}
          </div>
        ) : embedUrl ? (
          <>
            {/* The action returns a server-minted, grant-scoped URL. This
                first-party surface intentionally keeps scripts/storage working
                for authenticated app flows; the gateway is the security boundary. */}
            <iframe
              data-dispatch-chat-first-app-frame
              src={embedUrl}
              title={app.name}
              referrerPolicy="no-referrer"
              className="h-full w-full border-0 bg-background"
            />
          </>
        ) : embedError ? (
          <div className="flex h-full items-center justify-center p-4">
            <ActionQueryError
              error={embedError}
              onRetry={() => setEmbedAttempt((attempt) => attempt + 1)}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
            <span className="sr-only">
              {t("dispatch.pages.chatFirstLoadingApp")}
            </span>
          </div>
        )}
      </div>
    </>
  );

  return embedded ? (
    <div className="flex h-full min-h-0 w-full flex-col">{content}</div>
  ) : (
    <aside className="dispatch-chat-first-app-pane flex min-w-[320px] min-h-0 w-[40%] shrink-0 flex-col border-s border-border bg-background">
      {content}
    </aside>
  );
}
