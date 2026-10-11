import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  DASHBOARD_FOLDER_SYNC_ACTIONS,
  type ApplyFolderSyncResult,
  type DashboardFolderSyncPreview,
  type DashboardSyncRow,
  type DashboardSyncStatus,
  type ExportFolderSyncResult,
  type GitHubFolderLink,
} from "@shared/dashboard-github-sync";
import {
  IconAlertTriangle,
  IconDownload,
  IconExternalLink,
  IconLink,
  IconRefresh,
  IconUnlink,
  IconUpload,
} from "@tabler/icons-react";
import { useId, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Translate = ReturnType<typeof useT>;

type LinkForm = { owner: string; repo: string; branch: string; path: string };
type LinkFormErrors = Partial<Record<keyof LinkForm, string>>;
type SyncResult =
  | { kind: "apply"; data: ApplyFolderSyncResult }
  | { kind: "export"; data: ExportFolderSyncResult };
type SkippedItem = { dashboardId: string; reason: string };

const DEFAULT_LINK_FORM: LinkForm = {
  owner: "",
  repo: "",
  branch: "main",
  path: "dashboards",
};

const STATUS_LABEL_KEYS: Record<DashboardSyncStatus, string> = {
  "in-sync": "githubFolderSync.statuses.inSync",
  "github-changed": "githubFolderSync.statuses.githubChanged",
  "app-changed": "githubFolderSync.statuses.appChanged",
  "both-changed": "githubFolderSync.statuses.bothChanged",
  conflict: "githubFolderSync.statuses.conflict",
  "not-exported": "githubFolderSync.statuses.notExported",
  "new-in-github": "githubFolderSync.statuses.newInGithub",
  "removed-in-github": "githubFolderSync.statuses.removedInGithub",
  "export-pending": "githubFolderSync.statuses.exportPending",
  "no-access": "githubFolderSync.statuses.noAccess",
};

const PR_STATE_LABEL_KEYS = {
  open: "githubFolderSync.prOpen",
  merged: "githubFolderSync.prMerged",
  closed: "githubFolderSync.prClosed",
} as const;

export function GitHubFolderSyncDialog({
  folder,
  open,
  onOpenChange,
}: {
  folder: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const formId = useId();
  const folderId = folder.id;
  const [linkForm, setLinkForm] = useState<LinkForm>(DEFAULT_LINK_FORM);
  const [linkErrors, setLinkErrors] = useState<LinkFormErrors>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const preview = useActionQuery<DashboardFolderSyncPreview>(
    DASHBOARD_FOLDER_SYNC_ACTIONS.preview,
    { folderId },
    { enabled: open },
  );
  const configure = useActionMutation<
    { folderId: string; link: GitHubFolderLink | null },
    { folderId: string; link: GitHubFolderLink | null }
  >(DASHBOARD_FOLDER_SYNC_ACTIONS.configure);
  const apply = useActionMutation<ApplyFolderSyncResult, { folderId: string }>(
    DASHBOARD_FOLDER_SYNC_ACTIONS.apply,
  );
  const exportSync = useActionMutation<
    ExportFolderSyncResult,
    { folderId: string }
  >(DASHBOARD_FOLDER_SYNC_ACTIONS.export);

  const data = preview.data;
  const link = data?.link ?? null;
  const busy = configure.isPending || apply.isPending || exportSync.isPending;
  const previewError = preview.error
    ? messageOf(preview.error, t("githubFolderSync.loadFailed"))
    : null;
  const errorText = actionError ?? previewError;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setActionError(null);
      setResult(null);
    }
    onOpenChange(next);
  };

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    setResult(null);
    try {
      await action();
    } catch (error) {
      setActionError(messageOf(error, t("githubFolderSync.actionFailed")));
    }
  };

  const updateLinkField = (key: keyof LinkForm, value: string) => {
    setLinkForm((current) => ({ ...current, [key]: value }));
    setLinkErrors((current) => ({ ...current, [key]: undefined }));
  };

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: GitHubFolderLink = {
      owner: linkForm.owner.trim(),
      repo: linkForm.repo.trim(),
      branch: linkForm.branch.trim(),
      path: linkForm.path.trim().replace(/^\/+|\/+$/g, ""),
    };
    const errors: LinkFormErrors = {};
    if (!next.owner) errors.owner = t("githubFolderSync.ownerRequired");
    if (!next.repo) errors.repo = t("githubFolderSync.repoRequired");
    if (!next.branch) errors.branch = t("githubFolderSync.branchRequired");
    setLinkErrors(errors);
    if (Object.keys(errors).length > 0) return;

    void runAction(async () => {
      await configure.mutateAsync({ folderId, link: next });
      await preview.refetch();
    });
  };

  const checkGitHub = () => {
    setActionError(null);
    void preview.refetch();
  };

  const pull = () =>
    runAction(async () => {
      const applied = await apply.mutateAsync({ folderId });
      setResult({ kind: "apply", data: applied });
      await preview.refetch();
    });

  const exportToGitHub = () =>
    runAction(async () => {
      const exported = await exportSync.mutateAsync({ folderId });
      setResult({ kind: "export", data: exported });
      await preview.refetch();
    });

  const disconnect = () =>
    runAction(async () => {
      await configure.mutateAsync({ folderId, link: null });
      await preview.refetch();
    });

  return (
    // Nested modals fight over focus in this install, so the confirm hides the sync dialog instead of stacking on it.
    <>
      <Dialog open={open && !disconnectOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("githubFolderSync.title", { name: folder.name })}
            </DialogTitle>
          </DialogHeader>

          {errorText ? (
            <Alert variant="destructive">
              <IconAlertTriangle />
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          ) : null}

          {!data ? (
            preview.isError ? (
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => void preview.refetch()}
                >
                  {t("sidebar.retry")}
                </Button>
              </DialogFooter>
            ) : (
              <DashboardSyncTable rows={null} t={t} />
            )
          ) : link === null ? (
            <form onSubmit={connect} noValidate className="space-y-4">
              <LinkField
                id={`${formId}-owner`}
                label={t("githubFolderSync.owner")}
                value={linkForm.owner}
                error={linkErrors.owner}
                onChange={(value) => updateLinkField("owner", value)}
                autoFocus
              />
              <LinkField
                id={`${formId}-repo`}
                label={t("githubFolderSync.repo")}
                value={linkForm.repo}
                error={linkErrors.repo}
                onChange={(value) => updateLinkField("repo", value)}
              />
              <LinkField
                id={`${formId}-branch`}
                label={t("githubFolderSync.branch")}
                value={linkForm.branch}
                error={linkErrors.branch}
                onChange={(value) => updateLinkField("branch", value)}
              />
              <LinkField
                id={`${formId}-path`}
                label={t("githubFolderSync.path")}
                value={linkForm.path}
                onChange={(value) => updateLinkField("path", value)}
              />
              <DialogFooter>
                <Button type="submit" disabled={configure.isPending}>
                  {configure.isPending ? <Spinner /> : <IconLink />}
                  {t("githubFolderSync.connect")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">
                  {t("githubFolderSync.linkedTo")}
                </dt>
                <dd className="min-w-0 truncate font-medium">
                  {`${link.owner}/${link.repo}`}
                </dd>
                <dt className="text-muted-foreground">
                  {t("githubFolderSync.branch")}
                </dt>
                <dd className="min-w-0 truncate">{link.branch}</dd>
                <dt className="text-muted-foreground">
                  {t("githubFolderSync.path")}
                </dt>
                <dd className="min-w-0 truncate">
                  {link.path || t("githubFolderSync.rootPath")}
                </dd>
                {data.pendingExport ? (
                  <>
                    <dt className="text-muted-foreground">
                      {t("githubFolderSync.exportPullRequest")}
                    </dt>
                    <dd className="flex min-w-0 flex-wrap items-center gap-2">
                      <a
                        href={data.pendingExport.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 underline underline-offset-4"
                      >
                        {t("githubFolderSync.pullRequest", {
                          number: data.pendingExport.prNumber,
                        })}
                        <IconExternalLink className="size-3.5" />
                      </a>
                      <Badge variant="outline">
                        {t(PR_STATE_LABEL_KEYS[data.pendingExport.state])}
                      </Badge>
                    </dd>
                  </>
                ) : null}
              </dl>

              {result ? (
                <SyncResultNotice
                  result={result}
                  rows={data.dashboards}
                  t={t}
                />
              ) : null}

              <DashboardSyncTable rows={data.dashboards} t={t} />

              <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive sm:me-auto"
                  disabled={busy}
                  onClick={() => setDisconnectOpen(true)}
                >
                  <IconUnlink />
                  {t("githubFolderSync.disconnect")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || preview.isFetching}
                  onClick={checkGitHub}
                >
                  <IconRefresh />
                  {t("githubFolderSync.checkGitHub")}
                </Button>
                <Button variant="outline" disabled={busy} onClick={pull}>
                  {apply.isPending ? <Spinner /> : <IconDownload />}
                  {t("githubFolderSync.pullFromGitHub")}
                </Button>
                <Button disabled={busy} onClick={exportToGitHub}>
                  {exportSync.isPending ? <Spinner /> : <IconUpload />}
                  {t("githubFolderSync.exportToGitHub")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("githubFolderSync.disconnectTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("githubFolderSync.disconnectDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void disconnect()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("githubFolderSync.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LinkField({
  id,
  label,
  value,
  error,
  onChange,
  autoFocus = false,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const SKELETON_ROW_KEYS = ["a", "b", "c"];

function DashboardSyncTable({
  rows,
  t,
}: {
  rows: DashboardSyncRow[] | null;
  t: Translate;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("githubFolderSync.dashboard")}</TableHead>
          <TableHead className="w-44">{t("githubFolderSync.status")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows === null ? (
          SKELETON_ROW_KEYS.map((key) => (
            <TableRow key={key} aria-busy="true">
              <TableCell>
                <Skeleton className="h-4 w-48" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-24 rounded-md" />
              </TableCell>
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={2} className="text-muted-foreground">
              {t("dashboardOverview.noDashboards")}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.dashboardId}>
              <TableCell className="align-top whitespace-normal">
                <p className="font-medium">
                  {row.title || t("sidebar.untitledDashboard")}
                </p>
                {row.status === "conflict" ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {row.conflicts.map((unit) => (
                      <li key={unit}>{conflictLabel(unit, t)}</li>
                    ))}
                  </ul>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={statusBadgeVariant(row.status)}>
                  {t(STATUS_LABEL_KEYS[row.status])}
                </Badge>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function SyncResultNotice({
  result,
  rows,
  t,
}: {
  result: SyncResult;
  rows: DashboardSyncRow[];
  t: Translate;
}) {
  if (result.kind === "apply") {
    const { finalizedExport, skipped } = result.data;
    return (
      <Alert>
        <AlertDescription className="space-y-2">
          <p>{t("githubFolderSync.pulled")}</p>
          {finalizedExport ? (
            <p>
              {t(
                finalizedExport === "merged"
                  ? "githubFolderSync.finalizedMerged"
                  : "githubFolderSync.finalizedClosed",
              )}
            </p>
          ) : null}
          <SkippedList skipped={skipped} rows={rows} t={t} />
        </AlertDescription>
      </Alert>
    );
  }

  const { prUrl, prNumber, skipped } = result.data;
  return (
    <Alert>
      <AlertDescription className="space-y-2">
        {prUrl ? (
          <p>
            {t("githubFolderSync.exported")}{" "}
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {prNumber === null
                ? prUrl
                : t("githubFolderSync.pullRequest", { number: prNumber })}
            </a>
          </p>
        ) : (
          <p>{t("githubFolderSync.nothingToExport")}</p>
        )}
        <SkippedList skipped={skipped} rows={rows} t={t} />
      </AlertDescription>
    </Alert>
  );
}

function SkippedList({
  skipped,
  rows,
  t,
}: {
  skipped: SkippedItem[];
  rows: DashboardSyncRow[];
  t: Translate;
}) {
  if (skipped.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="font-medium">{t("githubFolderSync.skippedHeading")}</p>
      <ul className="list-disc space-y-0.5 ps-5">
        {skipped.map((item) => (
          <li key={item.dashboardId}>
            {t("githubFolderSync.skippedItem", {
              title:
                rows.find((row) => row.dashboardId === item.dashboardId)
                  ?.title || item.dashboardId,
              reason: item.reason,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function conflictLabel(unit: string, t: Translate): string {
  if (unit === "order") return t("githubFolderSync.conflictOrder");
  if (unit === "meta") return t("githubFolderSync.conflictMeta");
  if (unit.startsWith("panel:")) {
    return t("githubFolderSync.conflictPanel", {
      id: unit.slice("panel:".length),
    });
  }
  return unit;
}

function statusBadgeVariant(status: DashboardSyncStatus) {
  if (status === "in-sync") return "secondary" as const;
  if (status === "conflict" || status === "removed-in-github") {
    return "destructive" as const;
  }
  return "outline" as const;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
