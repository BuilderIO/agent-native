import { appPath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import {
  IconArrowLeft,
  IconExclamationCircle,
  IconTrash,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../../shared/labs";
import { SESSION_REPLAY_AT_MS_PARAM } from "../../../shared/session-replay-agent-access";
import {
  SESSION_REPORT_SUMMARY_MAX,
  SESSION_REPORT_TITLE_MAX,
  sessionReportPath,
  type SessionReport,
} from "../../../shared/session-reports";
import { formatOffsetClock } from "./session-replay-devtools";
import { SessionsLabGate } from "./SessionsLabGate";

const MANAGING_ROLES = new Set(["owner", "admin"]);
const EDITING_ROLES = new Set(["owner", "admin", "editor"]);

function sessionMomentPath(recordingId: string, atMs: number): string {
  return `/sessions/${encodeURIComponent(recordingId)}?${SESSION_REPLAY_AT_MS_PARAM}=${atMs}`;
}

function errorIssuePath(issueId: string): string {
  return `/monitoring?view=errors&issue=${encodeURIComponent(issueId)}`;
}

export default function SessionReportPage() {
  const t = useT();
  const lab = useLabState(ANALYTICS_SESSIONS_TRIAGE_LAB);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <SessionsLabGate lab={lab} needsLab={t("sessions.reportNeedsLab")}>
        <SessionReportBody />
      </SessionsLabGate>
    </div>
  );
}

function SessionReportBody() {
  const t = useT();
  const { reportId = "" } = useParams();
  const { data, isLoading, error } = useActionQuery(
    "get-session-report",
    { id: reportId },
    { enabled: Boolean(reportId) },
  );

  if (error) {
    const notFound = (error as { status?: number }).status === 404;
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-destructive">
          <IconExclamationCircle className="h-5 w-5 shrink-0" />
          {notFound
            ? t("sessions.reportNotFound")
            : t("sessions.reportLoadFailed", {
                message: error instanceof Error ? error.message : String(error),
              })}
        </CardContent>
      </Card>
    );
  }
  if (isLoading || !data) return <ReportSkeleton />;
  return <ReportView report={data} />;
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function ReportView({ report }: { report: SessionReport & { role: string } }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = EDITING_ROLES.has(report.role);
  const canManage = MANAGING_ROLES.has(report.role);
  const [title, setTitle] = useState(report.title);
  const [summary, setSummary] = useState(report.summary);
  useEffect(() => setTitle(report.title), [report.title]);
  useEffect(() => setSummary(report.summary), [report.summary]);

  const update = useActionMutation("update-session-report");
  const remove = useActionMutation("delete-session-report");

  function save(
    patch: { title: string } | { summary: string },
    rollback: () => void,
  ) {
    update.mutate(
      { id: report.id, ...patch },
      {
        onError: (error) => {
          rollback();
          toast.error(
            t("sessions.reportSaveFailed", {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        },
      },
    );
  }

  function saveTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(report.title);
      return;
    }
    if (next === report.title) return;
    save({ title: next }, () => setTitle(report.title));
  }

  function saveSummary() {
    const next = summary.trim();
    if (next === report.summary) return;
    save({ summary: next }, () => setSummary(report.summary));
  }

  function handleDelete() {
    remove.mutate(
      { id: report.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-session-reports"],
          });
          void navigate(`/sessions/${encodeURIComponent(report.recordingId)}`);
        },
        onError: (error) =>
          toast.error(
            t("sessions.reportSaveFailed", {
              message: error instanceof Error ? error.message : String(error),
            }),
          ),
      },
    );
  }

  const shareUrl =
    typeof window === "undefined"
      ? undefined
      : window.location.origin + appPath(sessionReportPath(report.id));

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to={`/sessions/${encodeURIComponent(report.recordingId)}`}>
            <IconArrowLeft className="h-4 w-4" />
            {t("sessions.reportBackToSession")}
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <ShareButton
            resourceType="session-report"
            resourceId={report.id}
            allowedRoles={["viewer", "editor", "admin"]}
            resourceTitle={report.title}
            variant="compact"
            shareUrl={shareUrl}
          />
          {canManage ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("sessions.reportDelete")}
                  disabled={remove.isPending}
                >
                  <IconTrash className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("sessions.reportDeleteTitle")}
                  </AlertDialogTitle>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    {t("sessions.reportDelete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {canEdit ? (
          <Input
            aria-label={t("sessions.reportTitleLabel")}
            value={title}
            maxLength={SESSION_REPORT_TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="h-auto border-transparent px-2 py-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-input"
          />
        ) : (
          <h1 className="px-2 text-xl font-semibold">{report.title}</h1>
        )}
        {canEdit ? (
          <Textarea
            aria-label={t("sessions.reportSummaryLabel")}
            placeholder={t("sessions.reportSummaryPlaceholder")}
            value={summary}
            maxLength={SESSION_REPORT_SUMMARY_MAX}
            onChange={(event) => setSummary(event.target.value)}
            onBlur={saveSummary}
            className="min-h-28 border-transparent px-2 text-sm leading-6 shadow-none hover:border-input focus-visible:border-input"
          />
        ) : report.summary ? (
          <p className="whitespace-pre-wrap px-2 text-sm leading-6">
            {report.summary}
          </p>
        ) : null}
      </div>

      {report.keyMoments.length > 0 ? (
        <section className="flex flex-col gap-2 px-2">
          <h2 className="text-sm font-semibold">
            {t("sessions.reportKeyMoments")}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {report.keyMoments.map((moment) => (
              <li
                key={`${moment.atMs}-${moment.label}`}
                className="flex gap-3 text-sm"
              >
                <Link
                  to={sessionMomentPath(report.recordingId, moment.atMs)}
                  className="shrink-0 font-mono text-xs leading-5 text-primary underline-offset-2 hover:underline"
                >
                  {formatOffsetClock(moment.atMs)}
                </Link>
                <span>{moment.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.reproSteps.length > 0 ? (
        <section className="flex flex-col gap-2 px-2">
          <h2 className="text-sm font-semibold">
            {t("sessions.reportReproSteps")}
          </h2>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            {report.reproSteps.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-2 text-sm">
        {report.errorIssueId ? (
          <>
            <dt className="text-muted-foreground">
              {t("sessions.reportErrorIssue")}
            </dt>
            <dd>
              <Link
                to={errorIssuePath(report.errorIssueId)}
                className="font-mono text-xs text-primary underline-offset-2 hover:underline"
              >
                {report.errorIssueId}
              </Link>
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t("sessions.reportCommit")}</dt>
        <dd className="font-mono text-xs leading-5">
          {report.build?.commit ??
            report.build?.latestCommit ??
            t("sessions.reportNoCommit")}
        </dd>
      </dl>
    </article>
  );
}
