import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconArrowLeft } from "@tabler/icons-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";

import {
  aggregateSharedEmails,
  callAppAction,
  fetchAppEmailCatalog,
  type AppEmailCatalog,
  type AppTransactionalEmail,
  type LocalTransactionalEmailCatalog,
} from "../../client/transactional-emails";
import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import {
  ActivityTable,
  type EmailActivityEntry,
} from "../../components/transactional-email-activity";
import {
  OpenRateCell,
  SendsCell,
  LastSentCell,
  type EmailEngagement,
  type ProviderMetricsResult,
} from "../../components/transactional-email-metrics";
import { EmailPreviewPane } from "../../components/transactional-email-preview";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";

export function meta() {
  return [{ title: "Transactional email detail — Dispatch" }];
}

const WINDOW_DAYS = 30;
const ACTIVITY_LIMIT = 50;

interface WorkspaceAppRef {
  id: string;
  name: string;
  path: string;
  status?: "ready" | "pending";
}

/**
 * Resolves the one email this page shows, plus the app name/path to display.
 * The "core" appId is Dispatch's own registry, not a cross-app fetch — see
 * the same split in transactional-email.tsx.
 */
function useEmailDetail(appId: string, id: string) {
  const isCore = appId === "core";
  const t = useT();

  const localQuery = useActionQuery<LocalTransactionalEmailCatalog>(
    "list-transactional-emails",
    { windowDays: WINDOW_DAYS },
    { enabled: isCore },
  );

  const appsQuery = useActionQuery<WorkspaceAppRef[]>("list-workspace-apps", {
    includeAgentCards: false,
  });
  const readyApps = useMemo(
    () =>
      (appsQuery.data ?? []).filter(
        (candidate) => candidate.status !== "pending",
      ),
    [appsQuery.data],
  );
  const app = useMemo(
    () => readyApps.find((candidate) => candidate.id === appId),
    [readyApps, appId],
  );
  const coreCatalogQueries = useQueries({
    queries: readyApps.map((candidate) => ({
      queryKey: ["transactional-email-catalog", candidate.id, WINDOW_DAYS],
      queryFn: () => fetchAppEmailCatalog(candidate, WINDOW_DAYS),
      enabled: isCore,
      staleTime: Infinity,
    })),
  });
  const remoteQuery = useQuery({
    queryKey: ["transactional-email-catalog", appId, WINDOW_DAYS],
    queryFn: () => fetchAppEmailCatalog(app!, WINDOW_DAYS),
    enabled: !isCore && !!app,
    staleTime: Infinity,
  });

  if (isCore) {
    const appCatalogs = coreCatalogQueries
      .map((query) => query.data)
      .filter((catalog): catalog is AppEmailCatalog => Boolean(catalog));
    const aggregate = localQuery.data
      ? aggregateSharedEmails(localQuery.data, appCatalogs)
      : undefined;
    const email = aggregate?.emails.find((candidate) => candidate.id === id);
    const catalogError = coreCatalogQueries.find(
      (query) => query.data?.error || query.data?.statsError,
    )?.data;
    const queryError = coreCatalogQueries.find((query) => query.isError)?.error;
    const isLoading =
      localQuery.isLoading ||
      appsQuery.isLoading ||
      coreCatalogQueries.some((query) => query.isLoading);
    const isError =
      localQuery.isError || appsQuery.isError || Boolean(queryError);
    return {
      isLoading,
      isError,
      error: localQuery.error ?? appsQuery.error ?? queryError,
      onRetry: () => {
        void localQuery.refetch();
        void appsQuery.refetch();
        for (const query of coreCatalogQueries) void query.refetch();
      },
      appName: t("dispatch.transactionalEmail.sharedTitle"),
      appPath: t("dispatch.transactionalEmail.sharedSubtitle"),
      email,
      catalogError:
        aggregate?.statsError ??
        catalogError?.error ??
        catalogError?.statsError ??
        null,
      notFound: !isLoading && !isError && !email,
    };
  }

  const notFound =
    !appsQuery.isLoading &&
    !appsQuery.isError &&
    (!app ||
      (!remoteQuery.isLoading &&
        !remoteQuery.isError &&
        !remoteQuery.data?.error &&
        !remoteQuery.data?.emails.some((candidate) => candidate.id === id)));

  return {
    isLoading: appsQuery.isLoading || remoteQuery.isLoading,
    isError: appsQuery.isError || remoteQuery.isError,
    error: appsQuery.error ?? remoteQuery.error,
    onRetry: () => {
      void appsQuery.refetch();
      void remoteQuery.refetch();
    },
    appName: app?.name ?? appId,
    appPath: app?.path ?? "",
    email: remoteQuery.data?.emails.find((candidate) => candidate.id === id),
    catalogError: remoteQuery.data?.error ?? null,
    notFound,
  };
}

export default function TransactionalEmailDetailRoute() {
  const t = useT();
  const params = useParams<{ appId: string; id: string }>();
  const appId = params.appId ?? "";
  const id = params.id ?? "";

  const detail = useEmailDetail(appId, id);

  const sharedProviderReason = t(
    "dispatch.transactionalEmail.sharedProviderMetricsUnavailable",
  );
  const engagementQuery = useQuery({
    queryKey: ["list-email-engagement", detail.appPath, id, WINDOW_DAYS],
    queryFn: () =>
      callAppAction<ProviderMetricsResult<EmailEngagement[]>>(
        detail.appPath,
        "list-email-engagement",
        { templateIds: [id], windowDays: WINDOW_DAYS },
        "POST",
      ),
    enabled: appId !== "core" && id.length > 0 && detail.appPath.length > 0,
  });
  const engagementResult = engagementQuery.data;
  const engagementUnavailable =
    appId === "core"
      ? sharedProviderReason
      : engagementResult && !engagementResult.available
        ? engagementResult.reason
        : engagementQuery.isError
          ? engagementQuery.error instanceof Error
            ? engagementQuery.error.message
            : String(engagementQuery.error)
          : null;
  const engagement = engagementResult?.available
    ? engagementResult.data.find((entry) => entry.templateId === id)
    : undefined;

  const activityQuery = useQuery({
    queryKey: ["list-email-activity", detail.appPath, id, ACTIVITY_LIMIT],
    queryFn: () =>
      callAppAction<ProviderMetricsResult<EmailActivityEntry[]>>(
        detail.appPath,
        "list-email-activity",
        { templateId: id, limit: ACTIVITY_LIMIT },
        "GET",
      ),
    enabled:
      appId !== "core" &&
      id.length > 0 &&
      detail.appPath.length > 0 &&
      !engagementUnavailable,
  });

  return (
    <DispatchShell
      title={detail.email?.name ?? t("dispatch.transactionalEmail.title")}
      description={t("dispatch.transactionalEmail.description")}
    >
      <div className="max-w-3xl space-y-4">
        <Button asChild size="sm" variant="ghost" className="-ml-2">
          <Link to="/transactional-email">
            <IconArrowLeft size={15} className="mr-1.5" />
            {t("dispatch.transactionalEmail.title")}
          </Link>
        </Button>

        {detail.isError ? (
          <ActionQueryError error={detail.error} onRetry={detail.onRetry} />
        ) : detail.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : detail.notFound || !detail.email ? (
          <Alert variant="destructive">
            <IconAlertTriangle className="size-4" />
            <AlertTitle>
              {t("dispatch.transactionalEmail.emailNotFound")}
            </AlertTitle>
            <AlertDescription>
              {detail.catalogError ??
                t("dispatch.transactionalEmail.emailNotFoundDescription")}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <section className="rounded-2xl bg-card p-5">
              <div className="text-lg font-semibold text-foreground">
                {detail.email.name}
              </div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {detail.email.id}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {detail.appName}
                {detail.appPath ? ` · ${detail.appPath}` : ""}
              </div>

              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("dispatch.transactionalEmail.trigger")}
                  </dt>
                  <dd className="mt-1 text-foreground">
                    {detail.email.trigger}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("dispatch.transactionalEmail.recipient")}
                  </dt>
                  <dd className="mt-1 text-foreground">
                    {detail.email.recipient}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("dispatch.transactionalEmail.sender")}
                  </dt>
                  <dd className="mt-1 text-foreground">
                    {detail.email.sender}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-6 border-t pt-4 text-sm">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("dispatch.transactionalEmail.sends")}
                  </div>
                  <div className="mt-1">
                    <SendsCell
                      sent={detail.email.sent}
                      failed={detail.email.failed}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("dispatch.transactionalEmail.openRate")}
                  </div>
                  <div className="mt-1">
                    <OpenRateCell
                      engagement={engagement}
                      unavailableReason={engagementUnavailable}
                      loading={engagementQuery.isLoading}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("dispatch.transactionalEmail.lastSent")}
                  </div>
                  <div className="mt-1">
                    <LastSentCell
                      lastSentAt={detail.email.lastSentAt}
                      sent={detail.email.sent}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-card p-5">
              <h2 className="text-sm font-medium text-foreground">
                {t("dispatch.transactionalEmail.preview")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("dispatch.transactionalEmail.previewDescription")}
              </p>
              <div className="mt-4">
                <EmailPreviewPane
                  appId={appId}
                  appPath={detail.appPath}
                  id={detail.email.id}
                  name={detail.email.name}
                />
              </div>
            </section>

            <section className="rounded-2xl bg-card p-5">
              <h2 className="text-sm font-medium text-foreground">
                {t("dispatch.transactionalEmail.activityLink")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("dispatch.transactionalEmail.retentionNote")}
              </p>
              <div className="mt-4">
                <ActivityTable
                  result={
                    engagementUnavailable
                      ? { available: false, reason: engagementUnavailable }
                      : activityQuery.data
                  }
                  isLoading={activityQuery.isLoading}
                  isError={activityQuery.isError}
                  error={activityQuery.error}
                  onRetry={() => void activityQuery.refetch()}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </DispatchShell>
  );
}
