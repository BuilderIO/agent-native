import { appPath } from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { DefaultSpinner } from "@agent-native/core/client/ui";
import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconClockHour4,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  redirect,
  useParams,
  type ClientLoaderFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { resolveServerCatchAllTarget } from "../../lib/catch-all-target";
import {
  navigateToWorkspaceApp,
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../../lib/workspace-apps";

export function meta() {
  return [{ title: "Workspace app - Dispatch" }];
}

function dispatchSelfRedirect(appId: string | undefined): string | null {
  if (appId === "dispatch") return appPath("/overview");
  return null;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const appId = params.appId;
  if (!appId) return null;
  const selfTarget = dispatchSelfRedirect(appId);
  if (selfTarget) throw withSsrHtmlContentType(redirect(selfTarget));
  const target = await resolveServerCatchAllTarget(appId);
  if (target) throw withSsrHtmlContentType(redirect(target));
  return null;
}

export async function clientLoader({
  params,
  serverLoader,
}: ClientLoaderFunctionArgs) {
  const selfTarget = dispatchSelfRedirect(params.appId);
  if (selfTarget) throw withSsrHtmlContentType(redirect(selfTarget));
  return serverLoader();
}

export default function WorkspaceAppCatchAllRoute() {
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
  const isSelfReference = appId === "dispatch";
  const hasApp = app !== null;
  const appIsPending = app?.status === "pending";
  const [navigationFailed, setNavigationFailed] = useState(false);

  useEffect(() => {
    if (isSelfReference) return;
    if (!hasApp || appIsPending || !href) {
      setNavigationFailed(false);
      return;
    }
    setNavigationFailed(!navigateToWorkspaceApp(href));
  }, [appIsPending, hasApp, href, isSelfReference]);

  if (isSelfReference) {
    return <Navigate to={appPath("/overview")} replace />;
  }

  if (appsQuery.isError) {
    return (
      <DispatchShell
        title={t("dispatch.pages.dataLoadFailed")}
        description={t("dispatch.pages.pageNotFoundDescription")}
      >
        <ActionQueryError
          error={appsQuery.error}
          onRetry={() => void appsQuery.refetch()}
        />
      </DispatchShell>
    );
  }

  if (navigationFailed && href) {
    return (
      <DispatchShell
        title={t("dispatch.pages.dataLoadFailed")}
        description={t("dispatch.pages.pageNotFoundDescription")}
      >
        <ActionQueryError
          onRetry={() => setNavigationFailed(!navigateToWorkspaceApp(href))}
        />
      </DispatchShell>
    );
  }

  if (
    (isLoading && !app) ||
    (app && app.status !== "pending" && href && !navigationFailed)
  ) {
    return <DefaultSpinner />;
  }

  return (
    <DispatchShell
      title={app?.name || t("dispatch.pages.pageNotFound")}
      description={t("dispatch.pages.pageNotFoundDescription")}
    >
      <div className="max-w-2xl rounded-lg bg-card p-5">
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
          <Link to={appPath("/overview")}>
            <IconArrowLeft size={15} className="mr-1.5" />
            {t("dispatch.nav.overview")}
          </Link>
        </Button>

        {app?.status === "pending" ? (
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
                  <IconArrowUpRight size={15} className="ml-1.5" />
                </a>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              {t("dispatch.pages.pageNotFound")}
            </h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-foreground">/{appId}</span> isn't
              {t("dispatch.pages.notDispatchOrWorkspaceApp")}
            </p>
            <Button asChild>
              <Link to={appPath("/apps")}>
                {t("dispatch.pages.browseApps")}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </DispatchShell>
  );
}
