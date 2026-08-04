import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconEye,
  IconInfoCircle,
  IconList,
  IconMail,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  fetchAppEmailCatalog,
  fetchEmailPreview,
  type AppEmailCatalog,
  type AppTransactionalEmail,
} from "../../client/transactional-emails";
import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";

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

interface EmailEngagement {
  templateId: string;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  /** null when nothing was delivered in the window, so there is no rate yet. */
  openRate: number | null;
}

interface EmailActivityEntry {
  msgId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  status: string;
  opensCount: number;
  clicksCount: number;
  lastEventTime: string;
}

type ProviderMetricsResult<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

/**
 * Renders a metric the backend could not read. "Unknown" and "zero" must stay
 * visibly different — a dash with a reason is the only honest rendering.
 */
function UnknownMetric({ reason }: { reason: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">
          —
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{reason}</TooltipContent>
    </Tooltip>
  );
}

function SendsCell({ email }: { email: AppTransactionalEmail }) {
  const t = useT();
  if (email.sent === null) {
    return (
      <UnknownMetric reason={t("dispatch.transactionalEmail.sendLogUnread")} />
    );
  }
  return (
    <span className="tabular-nums">
      {email.sent}
      {email.failed !== null && email.failed > 0 ? (
        <span className="ml-2 text-xs text-destructive">
          {t("dispatch.transactionalEmail.failedCount", {
            count: email.failed,
          })}
        </span>
      ) : null}
      {email.failed === null ? (
        <span className="ml-2 text-xs text-muted-foreground">
          {t("dispatch.transactionalEmail.failuresUnknown")}
        </span>
      ) : null}
    </span>
  );
}

function OpenRateCell({
  engagement,
  unavailableReason,
  loading,
}: {
  engagement: EmailEngagement | undefined;
  unavailableReason: string | null;
  loading: boolean;
}) {
  const t = useT();
  if (unavailableReason) {
    return <UnknownMetric reason={unavailableReason} />;
  }
  if (loading) return <Skeleton className="h-4 w-10" />;
  if (!engagement) {
    return (
      <UnknownMetric
        reason={t("dispatch.transactionalEmail.noProviderRecord")}
      />
    );
  }
  if (engagement.openRate === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("dispatch.transactionalEmail.noDeliveredMail")}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {`${(engagement.openRate * 100).toFixed(1)}%`}
    </span>
  );
}

function PreviewDialog({
  email,
  appPath,
  open,
  onOpenChange,
}: {
  email: AppTransactionalEmail;
  appPath: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const t = useT();
  const preview = useQuery({
    queryKey: ["transactional-email-preview", appPath, email.id],
    queryFn: () => fetchEmailPreview(appPath, email.id),
    enabled: open,
    retry: false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{email.name}</DialogTitle>
          <DialogDescription>
            {t("dispatch.transactionalEmail.previewDescription")}
          </DialogDescription>
        </DialogHeader>
        {preview.isError ? (
          <Alert variant="destructive">
            <IconAlertTriangle className="size-4" />
            <AlertTitle>
              {t("dispatch.transactionalEmail.previewFailed")}
            </AlertTitle>
            <AlertDescription>
              {preview.error instanceof Error
                ? preview.error.message
                : String(preview.error)}
            </AlertDescription>
          </Alert>
        ) : preview.isLoading || !preview.data ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground">
                {t("dispatch.transactionalEmail.subject")}
              </div>
              <div className="text-sm font-medium text-foreground">
                {preview.data.subject}
              </div>
            </div>
            {/* sandbox="" (no allow-scripts) keeps arbitrary email HTML from
                running script in the Dispatch origin. */}
            <iframe
              title={t("dispatch.transactionalEmail.previewFrameTitle", {
                name: email.name,
              })}
              sandbox=""
              srcDoc={preview.data.html}
              className="h-96 w-full rounded-xl border bg-white"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ActivityDialog({
  email,
  open,
  onOpenChange,
}: {
  email: AppTransactionalEmail;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const t = useT();
  const activityQuery = useActionQuery<
    ProviderMetricsResult<EmailActivityEntry[]>
  >(
    "list-email-activity",
    { templateId: email.id, limit: ACTIVITY_LIMIT },
    { enabled: open },
  );
  const result = activityQuery.data;

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
        {activityQuery.isError ? (
          <ActionQueryError
            error={activityQuery.error}
            onRetry={() => void activityQuery.refetch()}
          />
        ) : activityQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : result && !result.available ? (
          <Alert>
            <IconInfoCircle className="size-4" />
            <AlertTitle>
              {t("dispatch.transactionalEmail.activityUnavailable")}
            </AlertTitle>
            <AlertDescription>{result.reason}</AlertDescription>
          </Alert>
        ) : result && result.data.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
            {t("dispatch.transactionalEmail.activityEmpty")}
          </div>
        ) : result ? (
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("dispatch.transactionalEmail.recipient")}
                  </TableHead>
                  <TableHead>
                    {t("dispatch.transactionalEmail.subject")}
                  </TableHead>
                  <TableHead>
                    {t("dispatch.transactionalEmail.status")}
                  </TableHead>
                  <TableHead>
                    {t("dispatch.transactionalEmail.opens")}
                  </TableHead>
                  <TableHead>
                    {t("dispatch.transactionalEmail.lastEvent")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((entry) => (
                  <TableRow key={entry.msgId}>
                    <TableCell className="text-xs">{entry.toEmail}</TableCell>
                    <TableCell className="text-xs">{entry.subject}</TableCell>
                    <TableCell className="text-xs">{entry.status}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {entry.opensCount}
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.lastEventTime}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EmailRow({
  email,
  appPath,
  engagement,
  engagementUnavailable,
  engagementLoading,
}: {
  email: AppTransactionalEmail;
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
        <div className="text-sm font-medium text-foreground">{email.name}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {email.id}
        </div>
      </TableCell>
      <TableCell className="max-w-64 align-top text-xs text-muted-foreground">
        {email.trigger}
      </TableCell>
      <TableCell className="max-w-56 align-top text-xs text-muted-foreground">
        <div>{email.recipient}</div>
        <div className="mt-1">{email.sender}</div>
      </TableCell>
      <TableCell className="align-top text-sm">
        <SendsCell email={email} />
      </TableCell>
      <TableCell className="align-top text-sm">
        <OpenRateCell
          engagement={engagement}
          unavailableReason={engagementUnavailable}
          loading={engagementLoading}
        />
      </TableCell>
      <TableCell className="align-top text-xs text-muted-foreground">
        {email.lastSentAt === null ? (
          <UnknownMetric
            reason={t("dispatch.transactionalEmail.lastSentUnknown")}
          />
        ) : (
          new Date(email.lastSentAt).toLocaleString()
        )}
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
          appPath={appPath}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
        <ActivityDialog
          email={email}
          open={activityOpen}
          onOpenChange={setActivityOpen}
        />
      </TableCell>
    </TableRow>
  );
}

function AppCatalogSection({
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

  return (
    <section className="rounded-2xl bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">
          {catalog.appName}
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {catalog.appPath}
        </span>
      </div>

      {catalog.error ? (
        <Alert variant="destructive" className="mt-4">
          <IconAlertTriangle className="size-4" />
          <AlertTitle>
            {t("dispatch.transactionalEmail.catalogUnreadable")}
          </AlertTitle>
          <AlertDescription>{catalog.error}</AlertDescription>
        </Alert>
      ) : (
        <>
          {catalog.statsError ? (
            <Alert className="mt-4">
              <IconInfoCircle className="size-4" />
              <AlertTitle>
                {t("dispatch.transactionalEmail.countsUnreadable")}
              </AlertTitle>
              <AlertDescription>{catalog.statsError}</AlertDescription>
            </Alert>
          ) : null}
          {catalog.emails.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
              {t("dispatch.transactionalEmail.appSendsNoEmail")}
            </div>
          ) : (
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("dispatch.transactionalEmail.email")}
                    </TableHead>
                    <TableHead>
                      {t("dispatch.transactionalEmail.trigger")}
                    </TableHead>
                    <TableHead>
                      {t("dispatch.transactionalEmail.recipientAndSender")}
                    </TableHead>
                    <TableHead>
                      {t("dispatch.transactionalEmail.sends")}
                    </TableHead>
                    <TableHead>
                      {t("dispatch.transactionalEmail.openRate")}
                    </TableHead>
                    <TableHead>
                      {t("dispatch.transactionalEmail.lastSent")}
                    </TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalog.emails.map((email) => (
                    <EmailRow
                      key={email.id}
                      email={email}
                      appPath={catalog.appPath}
                      engagement={engagementByTemplate.get(email.id)}
                      engagementUnavailable={engagementUnavailable}
                      engagementLoading={engagementLoading}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </section>
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

  // The per-app catalog is a plain fetch against each mounted app, not a
  // Dispatch action, so the fan-out lives in a query of its own.
  const catalogsQuery = useQuery({
    queryKey: [
      "transactional-email-catalogs",
      apps.map((app) => app.id).join(","),
      WINDOW_DAYS,
    ],
    queryFn: () =>
      Promise.all(apps.map((app) => fetchAppEmailCatalog(app, WINDOW_DAYS))),
    enabled: apps.length > 0,
  });

  const catalogs = catalogsQuery.data ?? [];
  const templateIds = useMemo(
    () => catalogs.flatMap((catalog) => catalog.emails.map((e) => e.id)),
    [catalogs],
  );

  const engagementQuery = useQuery({
    queryKey: ["list-email-engagement", templateIds.join(","), WINDOW_DAYS],
    queryFn: () =>
      callAction<ProviderMetricsResult<EmailEngagement[]>>(
        "list-email-engagement",
        { templateIds, windowDays: WINDOW_DAYS },
      ),
    enabled: templateIds.length > 0,
  });

  const engagementResult = engagementQuery.data;
  const engagementUnavailable =
    engagementResult && !engagementResult.available
      ? engagementResult.reason
      : engagementQuery.isError
        ? engagementQuery.error instanceof Error
          ? engagementQuery.error.message
          : String(engagementQuery.error)
        : null;

  const engagementByTemplate = useMemo(() => {
    const map = new Map<string, EmailEngagement>();
    if (engagementResult?.available) {
      for (const entry of engagementResult.data) {
        map.set(entry.templateId, entry);
      }
    }
    return map;
  }, [engagementResult]);

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

        {engagementUnavailable ? (
          <Alert>
            <IconAlertTriangle className="size-4" />
            <AlertTitle>
              {t("dispatch.transactionalEmail.openRatesUnavailable")}
            </AlertTitle>
            <AlertDescription>{engagementUnavailable}</AlertDescription>
          </Alert>
        ) : null}

        {appsQuery.isError ? (
          <ActionQueryError
            error={appsQuery.error}
            onRetry={() => void appsQuery.refetch()}
          />
        ) : null}

        {catalogsQuery.isError ? (
          <Alert variant="destructive">
            <IconAlertTriangle className="size-4" />
            <AlertTitle>
              {t("dispatch.transactionalEmail.catalogFanoutFailed")}
            </AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                {catalogsQuery.error instanceof Error
                  ? catalogsQuery.error.message
                  : String(catalogsQuery.error)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void catalogsQuery.refetch()}
              >
                {t("dispatch.transactionalEmail.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {appsQuery.isLoading || catalogsQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        ) : null}

        {!appsQuery.isLoading &&
        !catalogsQuery.isLoading &&
        catalogs.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            <IconMail className="mx-auto mb-2 size-5" />
            {t("dispatch.transactionalEmail.noApps")}
          </div>
        ) : null}

        {catalogs.map((catalog) => (
          <AppCatalogSection
            key={catalog.appId}
            catalog={catalog}
            engagementByTemplate={engagementByTemplate}
            engagementUnavailable={engagementUnavailable}
            engagementLoading={engagementQuery.isLoading}
          />
        ))}
      </div>
    </DispatchShell>
  );
}
