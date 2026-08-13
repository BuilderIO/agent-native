import {
  ChatFirstAppPane,
  defaultChatFirstCopy,
  type ChatFirstCopy,
} from "@agent-native/core/client/chat-first";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import { IconArrowLeft, IconClockHour4 } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { isEmbedSessionExpiredMessage } from "../lib/embed-session-recovery";
import {
  workspaceAppDirectHref,
  workspaceAppEmbedTarget,
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../lib/workspace-apps";
import { ActionQueryError } from "./action-query-error";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

interface EmbedSessionResult {
  startUrl: string;
}

interface EmbedSessionInput {
  app?: string;
  path?: string;
  url?: string;
  chrome: "minimal";
}

export function buildChatFirstEmbedSessionInput(
  appId: string,
  path: string,
): EmbedSessionInput {
  return { app: appId, path, chrome: "minimal" };
}

export interface WorkspaceAppFrameApp {
  id: string;
  name: string;
  path?: string | null;
  url?: string | null;
}

interface WorkspaceAppFrameProps {
  app: WorkspaceAppFrameApp;
  /** Chat-first app tabs use their own route while standalone hosts use app metadata. */
  embedPath?: string;
  copy?: ChatFirstCopy;
}

export function WorkspaceAppFrame({
  app,
  embedPath,
  copy = defaultChatFirstCopy,
}: WorkspaceAppFrameProps) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<Error | null>(null);
  const [embedAttempt, setEmbedAttempt] = useState(0);
  const embedFrameRef = useRef<HTMLIFrameElement>(null);
  const createEmbedSession = useActionMutation<
    EmbedSessionResult,
    EmbedSessionInput
  >("create_embed_session", {
    skipActionQueryInvalidation: true,
  });
  const appHref = workspaceAppHref({
    id: app.id,
    name: app.name,
    path: app.path ?? "",
    url: app.url,
  });
  const embedInput = useMemo<EmbedSessionInput | null>(() => {
    if (embedPath !== undefined) {
      return buildChatFirstEmbedSessionInput(app.id, embedPath);
    }
    if (!appHref) return null;
    return {
      app: app.id,
      ...workspaceAppEmbedTarget({ path: app.path ?? "", url: app.url }),
      chrome: "minimal",
    };
  }, [app.id, app.path, app.url, appHref, embedPath]);

  useEffect(() => {
    if (!embedInput) return;
    let cancelled = false;
    setEmbedUrl(null);
    setEmbedError(null);
    void createEmbedSession
      .mutateAsync(embedInput)
      .then((result) => {
        if (!cancelled) setEmbedUrl(result.startUrl);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setEmbedUrl(
          workspaceAppDirectHref(
            { path: app.path ?? "", url: app.url },
            embedPath ?? "/",
          ),
        );
        setEmbedError(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    app.id,
    app.path,
    app.url,
    createEmbedSession.mutateAsync,
    embedInput,
    embedPath,
    embedAttempt,
  ]);

  useEffect(() => {
    const handleEmbedSessionExpired = (event: MessageEvent) => {
      if (
        !isEmbedSessionExpiredMessage(event, embedFrameRef.current, embedUrl)
      ) {
        return;
      }
      setEmbedAttempt((attempt) => attempt + 1);
    };

    window.addEventListener("message", handleEmbedSessionExpired);
    return () =>
      window.removeEventListener("message", handleEmbedSessionExpired);
  }, [embedUrl]);

  return (
    <ChatFirstAppPane
      app={app}
      status={
        embedUrl
          ? "ready"
          : embedError
            ? "error"
            : embedInput
              ? "loading"
              : "unresolved"
      }
      embedUrl={embedUrl}
      errorMessage={embedError?.message}
      onRetry={
        embedInput ? () => setEmbedAttempt((attempt) => attempt + 1) : undefined
      }
      renderEmbed={({ url, title }) => (
        <iframe
          key={url + ":" + embedAttempt}
          data-dispatch-workspace-app-frame
          src={url}
          title={title ?? app.name}
          ref={embedFrameRef}
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
          className="h-full w-full border-0 bg-background"
        />
      )}
      copy={copy}
    />
  );
}

export function WorkspaceAppHost({ appId }: { appId?: string }) {
  const t = useT();
  const appsQuery = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
  });
  const { data: apps = [], isLoading } = appsQuery;
  const app = useMemo(
    () =>
      (apps as WorkspaceAppSummary[]).find((item) => item.id === appId) ?? null,
    [appId, apps],
  );

  if (appsQuery.isError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <ActionQueryError
            error={appsQuery.error}
            onRetry={() => void appsQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  if (isLoading && !app) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-3 rounded-xl border bg-card p-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-6">
          <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
            <Link to="/apps">
              <IconArrowLeft size={15} className="mr-1.5" />
              {t("dispatch.nav.apps")}
            </Link>
          </Button>
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              {t("dispatch.pages.appNotFound")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("dispatch.pages.pageNotFoundDescription")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (app.status === "pending") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-6">
          <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
            <Link to="/apps">
              <IconArrowLeft size={15} className="mr-1.5" />
              {t("dispatch.nav.apps")}
            </Link>
          </Button>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {app.name}
              </h2>
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <IconClockHour4 size={12} />
                {t("dispatch.pages.building")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("dispatch.pages.appBuildingPrefix")}{" "}
              <span className="font-mono text-foreground">{app.path}</span>{" "}
              {t("dispatch.pages.appBuildingSuffix")}
            </p>
            {app.builderUrl ? (
              <Button asChild>
                <a
                  href={withBuilderUtmTrackingParams(app.builderUrl, {
                    campaign: "product",
                    content: "dispatch_branch",
                  })}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("dispatch.pages.openBuilderBranch", {
                    defaultValue: "Open in Builder",
                  })}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-dispatch-workspace-app-host
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <div className="min-h-0 flex-1 bg-muted/20">
        <WorkspaceAppFrame app={app} />
      </div>
    </div>
  );
}

const MAX_KEEP_ALIVE_APPS = 3;

export function WorkspaceAppKeepAlive({
  activeAppId,
}: {
  activeAppId: string | null;
}) {
  const [visitedAppIds, setVisitedAppIds] = useState<string[]>(() =>
    activeAppId ? [activeAppId] : [],
  );

  useEffect(() => {
    if (!activeAppId) return;
    setVisitedAppIds((current) =>
      [activeAppId, ...current.filter((appId) => appId !== activeAppId)].slice(
        0,
        MAX_KEEP_ALIVE_APPS,
      ),
    );
  }, [activeAppId]);

  const renderedAppIds =
    activeAppId && !visitedAppIds.includes(activeAppId)
      ? [activeAppId, ...visitedAppIds]
      : visitedAppIds;

  return (
    <div
      data-dispatch-workspace-app-cache
      className={activeAppId ? "absolute inset-0 overflow-hidden" : "hidden"}
    >
      {renderedAppIds.map((appId) => {
        const active = appId === activeAppId;
        return (
          <div
            key={appId}
            data-dispatch-workspace-app-cache-entry={appId}
            aria-hidden={!active}
            className={active ? "h-full min-h-0" : "hidden"}
          >
            <WorkspaceAppHost appId={appId} />
          </div>
        );
      })}
    </div>
  );
}
