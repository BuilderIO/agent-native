import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import { IconArrowLeft, IconClockHour4 } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { ActionQueryError } from "../../components/action-query-error";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import {
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../../lib/workspace-apps";

interface EmbedSessionResult {
  startUrl: string;
  targetPath?: string;
  expiresAt?: number;
  app: string;
}

interface EmbedSessionInput {
  app: string;
  path?: string;
  url?: string;
  chrome: "minimal";
}

export function meta() {
  return [{ title: "Workspace app - Dispatch" }];
}

export default function WorkspaceAppRoute() {
  const t = useT();
  const { appId } = useParams();
  const appsQuery = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
  });
  const { data: apps = [], isLoading } = appsQuery;
  const app = useMemo(
    () =>
      (apps as WorkspaceAppSummary[]).find((item) => item.id === appId) ?? null,
    [appId, apps],
  );
  const href = app ? workspaceAppHref(app) : null;
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<Error | null>(null);
  const [embedAttempt, setEmbedAttempt] = useState(0);
  const createEmbedSession = useActionMutation<
    EmbedSessionResult,
    EmbedSessionInput
  >("create_embed_session", {
    skipActionQueryInvalidation: true,
  });
  const embedInput = useMemo<EmbedSessionInput | null>(() => {
    if (!app || !href) return null;
    const path = app.path.trim();
    if (path.startsWith("/")) {
      return { app: app.id, path, chrome: "minimal" };
    }
    return { app: app.id, url: href, chrome: "minimal" };
  }, [app?.id, app?.path, href]);

  useEffect(() => {
    if (!app || app.status === "pending" || !embedInput) return;
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
  }, [
    app?.id,
    app?.path,
    app?.status,
    createEmbedSession.mutateAsync,
    embedAttempt,
    embedInput,
  ]);

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
            {app.branchName ? (
              <p className="text-xs text-muted-foreground">
                {t("dispatch.pages.branch", { branch: app.branchName })}
              </p>
            ) : null}
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
                  {t("dispatch.pages.openBuilderBranch")}
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
        {embedUrl ? (
          <iframe
            data-dispatch-workspace-app-frame
            src={embedUrl}
            title={app.name}
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-background"
          />
        ) : embedError ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-2xl">
              <ActionQueryError
                error={embedError}
                onRetry={() => setEmbedAttempt((attempt) => attempt + 1)}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
            <span className="sr-only">{t("dispatch.pages.loading")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
