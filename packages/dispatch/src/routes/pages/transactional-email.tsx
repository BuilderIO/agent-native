import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconEye,
  IconInfoCircle,
  IconList,
  IconMail,
} from "@tabler/icons-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";

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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";

export function meta() {
  return [{ title: "Transactional email — Dispatch" }];
}

const WINDOW_DAYS = 30;
const ACTIVITY_LIMIT = 50;

interface WorkspaceAppRef {
  id: string;
  name: string;
  path: string;
  status?: "ready" | "pending";
}

/** Shape of the local `list-transactional-emails` action response. */
function PreviewDialog({
  email,
  appId,
  appPath,
  open,
  onOpenChange,
}: {
  email: AppTransactionalEmail;
  appId: string;
  appPath: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{email.name}</DialogTitle>
          <DialogDescription>
            {t("dispatch.transactionalEmail.previewDescription")}
          </DialogDescription>
        </DialogHeader>
        {/* Dialog content only mounts while open, so this fetches on open and
            drops the request when closed rather than needing an enabled flag. */}
        <EmailPreviewPane
          appId={appId}
          appPath={appPath}
          id={email.id}
          name={email.name}
        />
      </DialogContent>
    </Dialog>
  );
}

function ActivityDialog({
  email,
  appPath,
  unavailableReason,
  open,
  onOpenChange,
}: {
  email: AppTransactionalEmail;
  appPath: string;
  unavailableReason: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const t = useT();
  const activityQuery = useQuery({
    queryKey: ["list-email-activity", appPath, email.id, ACTIVITY_LIMIT],
    queryFn: () =>
      callAppAction<ProviderMetricsResult<EmailActivityEntry[]>>(
        appPath,
        "list-email-activity",
        { templateId: email.id, limit: ACTIVITY_LIMIT },
        "GET",
      ),
    enabled: open && !unavailableReason,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {t("dispatch.transactionalEmail.activityTitle", {
              name: email.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("dispatch.transactionalEmail.retentionNote")}
          </DialogDescription>
        </DialogHeader>
        <ActivityTable
          result={
            unavailableReason
              ? { available: false, reason: unavailableReason }
              : activityQuery.data
          }
          isLoading={activityQuery.isLoading}
          isError={activityQuery.isError}
          error={activityQuery.error}
          onRetry={() => void activityQuery.refetch()}
        />
      </DialogContent>
    </Dialog>
  );
}

function EmailRow({
  email,
  appId,
  appPath,
  engagement,
  engagementUnavailable,
  engagementLoading,
}: {
  email: AppTransactionalEmail;
  appId: string;
  appPath: string;
  engagement: EmailEngagement | undefined;
  engagementUnavailable: string | null;
  engagementLoading: boolean;
}) {
  const t = useT();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <TableRow>
      <TableCell className="align-top">
        <Link
          to={`/transactional-email/${appId}/${email.id}`}
          className="text-sm font-medium text-foreground hover:underline"
        >
          {email.name}
        </Link>
        <div className="font-mono text-xs text-muted-foreground">
          {email.id}
        </div>
      </TableCell>
      <TableCell className="max-w-64 align-top text-xs text-muted-foreground">
        {email.trigger}
      </TableCell>
      <TableCell className="max-w-56 align-top text-xs text-muted-foreground">
        {email.recipientLabel}
      </TableCell>
      <TableCell className="max-w-56 align-top text-xs text-muted-foreground">
        {email.senderLabel}
      </TableCell>
      <TableCell className="align-top text-sm">
        <SendsCell sent={email.sent} failed={email.failed} />
      </TableCell>
      <TableCell className="align-top text-sm">
        <OpenRateCell
          engagement={engagement}
          unavailableReason={engagementUnavailable}
          loading={engagementLoading}
        />
      </TableCell>
      <TableCell className="align-top text-xs text-muted-foreground">
        <LastSentCell lastSentAt={email.lastSentAt} sent={email.sent} />
      </TableCell>
      <TableCell className="align-top">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
          >
            <IconEye className="size-4" />
            {t("dispatch.transactionalEmail.preview")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActivityOpen(true)}
          >
            <IconList className="size-4" />
            {t("dispatch.transactionalEmail.activityLink")}
          </Button>
        </div>
        <PreviewDialog
          email={email}
          appId={appId}
          appPath={appPath}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
        <ActivityDialog
          email={email}
          appPath={appPath}
          unavailableReason={engagementUnavailable}
          open={activityOpen}
          onOpenChange={setActivityOpen}
        />
      </TableCell>
    </TableRow>
  );
}

function AppEmailTable({
  catalog,
  engagementByTemplate,
  engagementUnavailable,
  engagementLoading,
}: {
  catalog: AppEmailCatalog;
  engagementByTemplate: Map<string, EmailEngagement>;
  engagementUnavailable: string | null;
  engagementLoading: boolean;
}) {
  const t = useT();

  if (catalog.error) {
    return (
      <Alert variant="destructive">
        <IconAlertTriangle className="size-4" />
        <AlertTitle>
          {t("dispatch.transactionalEmail.catalogUnreadable")}
        </AlertTitle>
        <AlertDescription>{catalog.error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {catalog.statsError ? (
        <Alert className="mb-4">
          <IconInfoCircle className="size-4" />
          <AlertTitle>
            {t("dispatch.transactionalEmail.countsUnreadable")}
          </AlertTitle>
          <AlertDescription>{catalog.statsError}</AlertDescription>
        </Alert>
      ) : null}
      {catalog.emails.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          {t("dispatch.transactionalEmail.appSendsNoEmail")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("dispatch.transactionalEmail.email")}</TableHead>
              <TableHead>{t("dispatch.transactionalEmail.trigger")}</TableHead>
              <TableHead>
                {t("dispatch.transactionalEmail.recipient")}
              </TableHead>
              <TableHead>{t("dispatch.transactionalEmail.sender")}</TableHead>
              <TableHead>{t("dispatch.transactionalEmail.sends")}</TableHead>
              <TableHead>{t("dispatch.transactionalEmail.openRate")}</TableHead>
              <TableHead>{t("dispatch.transactionalEmail.lastSent")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalog.emails.map((email) => (
              <EmailRow
                key={email.id}
                email={email}
                appId={catalog.appId}
                appPath={catalog.appPath}
                engagement={engagementByTemplate.get(email.id)}
                engagementUnavailable={engagementUnavailable}
                engagementLoading={engagementLoading}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

function AppEmailCard({
  name,
  path,
  open,
  onOpenChange,
  catalog,
  isLoading,
  isError,
  error,
  onRetry,
  engagementByTemplate,
  engagementUnavailable,
  engagementLoading,
}: {
  name: string;
  path: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  catalog: AppEmailCatalog | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  engagementByTemplate: Map<string, EmailEngagement>;
  engagementUnavailable: string | null;
  engagementLoading: boolean;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-2xl bg-card"
    >
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-3 p-5 text-left hover:bg-muted/20">
        <span className="flex items-center gap-2">
          <IconChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="text-sm font-medium text-foreground">{name}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground">{path}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-5 pb-5 pt-4">
        {isError ? (
          <ActionQueryError error={error} onRetry={onRetry} />
        ) : isLoading || !catalog ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <AppEmailTable
            catalog={catalog}
            engagementByTemplate={engagementByTemplate}
            engagementUnavailable={engagementUnavailable}
            engagementLoading={engagementLoading}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function TransactionalEmailRoute() {
  const t = useT();
  const appsQuery = useActionQuery<WorkspaceAppRef[]>("list-workspace-apps", {
    includeAgentCards: false,
  });

  const apps = useMemo(
    () =>
      (appsQuery.data ?? [])
        .filter((app) => app.status !== "pending")
        .map((app) => ({ id: app.id, name: app.name, path: app.path })),
    [appsQuery.data],
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sharedOpen, setSharedOpen] = useState(true);

  const sharedQuery = useActionQuery<LocalTransactionalEmailCatalog>(
    "list-transactional-emails",
    { windowDays: WINDOW_DAYS },
  );

  const catalogQueries = useQueries({
    queries: apps.map((app) => ({
      queryKey: ["transactional-email-catalog", app.id, WINDOW_DAYS],
      queryFn: () => fetchAppEmailCatalog(app, WINDOW_DAYS),
      enabled: sharedOpen || expanded[app.id] === true,
      staleTime: Infinity,
    })),
  });

  const sharedCatalog = useMemo<AppEmailCatalog | undefined>(() => {
    if (!sharedQuery.data) return undefined;
    const aggregate = aggregateSharedEmails(
      sharedQuery.data,
      catalogQueries
        .map((query) => query.data)
        .filter((catalog): catalog is AppEmailCatalog => Boolean(catalog)),
    );
    return {
      appId: "core",
      appName: t("dispatch.transactionalEmail.sharedTitle"),
      appPath: t("dispatch.transactionalEmail.sharedSubtitle"),
      emails: aggregate.emails,
      error: null,
      statsError: aggregate.statsError,
    };
  }, [sharedQuery.data, catalogQueries, t]);

  const engagementQueries = useQueries({
    queries: apps.map((app, index) => {
      const catalog = catalogQueries[index]?.data;
      const templateIds =
        catalog && !catalog.error
          ? catalog.emails.map((email) => email.id)
          : [];
      return {
        queryKey: [
          "list-email-engagement",
          app.id,
          templateIds.join(","),
          WINDOW_DAYS,
        ],
        queryFn: () =>
          callAppAction<ProviderMetricsResult<EmailEngagement[]>>(
            app.path,
            "list-email-engagement",
            { templateIds, windowDays: WINDOW_DAYS },
            "POST",
          ),
        enabled: expanded[app.id] === true && templateIds.length > 0,
      };
    }),
  });

  const sharedLoading =
    sharedQuery.isLoading ||
    (sharedOpen && catalogQueries.some((query) => query.isLoading));
  const sharedError = catalogQueries.find((query) => query.isError)?.error;
  const sharedProviderReason = t(
    "dispatch.transactionalEmail.sharedProviderMetricsUnavailable",
  );

  return (
    <DispatchShell
      title={t("dispatch.transactionalEmail.title")}
      description={t("dispatch.transactionalEmail.description")}
    >
      <div className="flex flex-col gap-4">
        <Alert>
          <IconInfoCircle className="size-4" />
          <AlertTitle>
            {t("dispatch.transactionalEmail.retentionTitle")}
          </AlertTitle>
          <AlertDescription>
            {t("dispatch.transactionalEmail.retentionNote")}
          </AlertDescription>
        </Alert>

        {appsQuery.isError ? (
          <ActionQueryError
            error={appsQuery.error}
            onRetry={() => void appsQuery.refetch()}
          />
        ) : null}

        {appsQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : null}

        {!appsQuery.isLoading && apps.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            <IconMail className="mx-auto mb-2 size-5" />
            {t("dispatch.transactionalEmail.noApps")}
          </div>
        ) : null}

        <AppEmailCard
          name={t("dispatch.transactionalEmail.sharedTitle")}
          path={t("dispatch.transactionalEmail.sharedSubtitle")}
          open={sharedOpen}
          onOpenChange={setSharedOpen}
          catalog={sharedCatalog}
          isLoading={sharedLoading}
          isError={sharedQuery.isError || Boolean(sharedError)}
          error={sharedQuery.error ?? sharedError}
          onRetry={() => {
            void sharedQuery.refetch();
            for (const query of catalogQueries) void query.refetch();
          }}
          engagementByTemplate={new Map()}
          engagementUnavailable={sharedProviderReason}
          engagementLoading={false}
        />

        {apps.map((app, index) => {
          const query = catalogQueries[index];
          const engagementQuery = engagementQueries[index];
          const engagementResult = engagementQuery?.data;
          const engagementUnavailable =
            engagementResult && !engagementResult.available
              ? engagementResult.reason
              : engagementQuery?.isError
                ? engagementQuery.error instanceof Error
                  ? engagementQuery.error.message
                  : String(engagementQuery.error)
                : null;
          const engagementByTemplate = new Map<string, EmailEngagement>();
          if (engagementResult?.available) {
            for (const entry of engagementResult.data) {
              engagementByTemplate.set(entry.templateId, entry);
            }
          }
          return (
            <AppEmailCard
              key={app.id}
              name={app.name}
              path={app.path}
              open={expanded[app.id] === true}
              onOpenChange={(next) =>
                setExpanded((current) => ({ ...current, [app.id]: next }))
              }
              catalog={query?.data}
              isLoading={query?.isLoading ?? false}
              isError={query?.isError ?? false}
              error={query?.error}
              onRetry={() => void query?.refetch()}
              engagementByTemplate={engagementByTemplate}
              engagementUnavailable={engagementUnavailable}
              engagementLoading={engagementQuery?.isLoading ?? false}
            />
          );
        })}
      </div>
    </DispatchShell>
  );
}
