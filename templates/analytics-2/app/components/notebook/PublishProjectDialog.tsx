import { appPath } from "@agent-native/core/client/api-path";
import {
  actionErrorCode,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { IconChevronDown, IconExternalLink } from "@tabler/icons-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { AppLayoutSnapshot } from "@/components/published/AppLayoutSnapshot";
import { usePublishedResultPages } from "@/components/published/usePublishedResultPages";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import type createPublishPreview from "../../../actions/create-project-publish-preview";
import type getPublishPreview from "../../../actions/get-project-publish-preview";
import type publishProject from "../../../actions/publish-project";
import type { DraftHead } from "../../../shared/notebook-snapshot-contract";
import { useLastRunLabel } from "./NotebookRunControls";
import { PublishNotebookDiff } from "./PublishNotebookDiff";
import { toNotebookError } from "./utils";

type PreviewCreated = Awaited<ReturnType<typeof createPublishPreview.run>>;
export type PublishPreview = Awaited<ReturnType<typeof getPublishPreview.run>>;
type Release = Awaited<ReturnType<typeof publishProject.run>>;
type PublishInput = Parameters<typeof publishProject.run>[0];

type PublishDialogProps = {
  projectId: string;
  canForce: boolean;
  publishedAppPath?: string | undefined;
  onClose: () => void;
  onPublished: (release: Release) => void;
  onPublishingChange: (pending: boolean) => void;
  prepare: () => Promise<{
    expectedHead: DraftHead;
    expectedReleaseId: string | null;
  }>;
};

export const PUBLISH_DIALOG_PARAM = "publish";

export function PublishProjectDialog(props: PublishDialogProps) {
  const [attempt, setAttempt] = useState(0);
  const [description, setDescription] = useState("");
  useEffect(() => {
    const open = new URL(window.location.href);
    open.searchParams.set("dialog", PUBLISH_DIALOG_PARAM);
    window.history.replaceState(window.history.state, "", open);
    return () => {
      const close = new URL(window.location.href);
      if (close.searchParams.get("dialog") !== PUBLISH_DIALOG_PARAM) return;
      close.searchParams.delete("dialog");
      window.history.replaceState(window.history.state, "", close);
    };
  }, []);
  return (
    <PublishAttempt
      {...props}
      key={attempt}
      description={description}
      setDescription={setDescription}
      onRestart={() => setAttempt((current) => current + 1)}
    />
  );
}

function PublishAttempt({
  projectId,
  canForce,
  publishedAppPath,
  description,
  setDescription,
  onClose,
  onPublished,
  onPublishingChange,
  onRestart,
  prepare,
}: PublishDialogProps & {
  description: string;
  setDescription: (value: string) => void;
  onRestart: () => void;
}) {
  const t = useT();
  const id = useId();
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState("app");
  const [previewTab, setPreviewTab] = useState<string | null>(null);
  const [previewCreated, setPreviewCreated] = useState<PreviewCreated | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createRequestId] = useState(() => crypto.randomUUID());
  const lifecycle = useRef({
    mounted: false,
    started: false,
    submitted: false,
    published: false,
    publishing: false,
    cancelled: false,
  });
  const publishIntent = useRef<{ intent: string; id: string } | undefined>(
    undefined,
  );
  const { mutateAsync: create } = useActionMutation<PreviewCreated>(
    "create-project-publish-preview",
    { errorNotification: "caller", skipActionQueryInvalidation: true },
  );
  const { mutateAsync: cancel } = useActionMutation(
    "cancel-project-publish-preview",
    { skipActionQueryInvalidation: true },
  );
  const { mutateAsync: commit } = useActionMutation<Release, PublishInput>(
    "publish-project",
    { errorNotification: "caller", skipActionQueryInvalidation: true },
  );
  async function cancelPreview() {
    const state = lifecycle.current;
    if (
      !state.submitted ||
      state.cancelled ||
      state.published ||
      state.publishing
    )
      return;
    state.cancelled = true;
    await cancel({
      projectId,
      createRequestId,
      requestId: crypto.randomUUID(),
    });
  }
  async function requestReview() {
    const copied = await writeClipboardText(window.location.href);
    if (copied) toast.success(t("publishedApp.reviewLinkCopied"));
    else toast.error(t("publishedApp.reviewLinkCopyFailed"));
  }
  const cancelOnUnmount = useEffectEvent(() => {
    void cancelPreview().catch((cause: unknown) => {
      console.error("Could not cancel publish preview", cause);
    });
  });
  function previewIsOpen() {
    return lifecycle.current.mounted && !lifecycle.current.cancelled;
  }
  const start = useEffectEvent(async () => {
    const state = lifecycle.current;
    try {
      const barrier = await prepare();
      if (!previewIsOpen()) return;
      state.submitted = true;
      const next = await create({
        ...barrier,
        projectId,
        requestId: createRequestId,
      });
      if (previewIsOpen()) setPreviewCreated(next);
    } catch (cause) {
      if (previewIsOpen()) setError(toNotebookError(cause).message);
    }
  });
  useEffect(() => {
    const state = lifecycle.current;
    state.mounted = true;
    if (!state.started) {
      state.started = true;
      void start();
    }
    return () => {
      state.mounted = false;
      queueMicrotask(() => {
        if (!state.mounted) cancelOnUnmount();
      });
    };
  }, []);

  const previewQuery = useActionQuery<PublishPreview>(
    "get-project-publish-preview",
    { projectId, previewId: previewCreated?.previewId ?? "" },
    {
      enabled: previewCreated !== null,
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.state === "running" ||
        query.state.data?.state === "queued"
          ? 750
          : false,
    },
  );
  const preview = previewQuery.data;
  const { outputs, loadPage } = usePublishedResultPages(
    preview?.outputs ?? [],
    { previewId: previewCreated?.previewId ?? "" },
  );
  for (const { attempt, state } of preview?.run?.attempts ?? []) {
    if (state.status === "queued" || state.status === "running")
      outputs[attempt.cellId] ??= { artifactLoading: true };
  }
  const replacingAge = useLastRunLabel(preview?.compared?.publishedAt);
  const problem =
    error ??
    (previewQuery.error ? toNotebookError(previewQuery.error).message : null);
  const failed = preview?.state === "failed";
  const running =
    !problem &&
    (!preview || preview.state === "queued" || preview.state === "running");

  function close(restart = false) {
    const state = lifecycle.current;
    if (state.publishing) return;
    state.mounted = false;
    void cancelPreview().catch((cause: unknown) => {
      console.error("Could not cancel publish preview", cause);
    });
    if (restart) onRestart();
    else onClose();
  }

  async function publish(mode: PublishInput["mode"]) {
    const state = lifecycle.current;
    if (!preview || state.publishing || state.cancelled) return;
    const intent = {
      projectId,
      previewId: preview.previewId,
      expectedHead: preview.head,
      expectedReleaseId: preview.compareReleaseId,
      expectedManifestRevision: preview.manifestRevision,
      description,
      mode,
    };
    const fingerprint = JSON.stringify(intent);
    if (publishIntent.current?.intent !== fingerprint)
      publishIntent.current = { intent: fingerprint, id: crypto.randomUUID() };
    state.publishing = true;
    onPublishingChange(true);
    setPending(true);
    setError(null);
    try {
      const release = await commit({
        ...intent,
        requestId: publishIntent.current.id,
      });
      state.published = true;
      onPublished(release);
      if (!state.mounted) return;
      onClose();
      const href = appPath(release.appHref);
      const copied = await writeClipboardText(
        new URL(href, window.location.origin).href,
      );
      toast.success(
        t(copied ? "publishedApp.linkCopied" : "publishedApp.published"),
        {
          action: {
            label: t("publishedApp.openInNewTab"),
            onClick: () => window.open(href, "_blank", "noopener,noreferrer"),
          },
        },
      );
    } catch (cause) {
      if (state.mounted) {
        setError(toNotebookError(cause).message);
        if (actionErrorCode(cause) === "preview_manifest_changed")
          await previewQuery.refetch();
      }
    } finally {
      state.publishing = false;
      onPublishingChange(false);
      if (state.mounted) setPending(false);
      else
        void cancelPreview().catch((cause: unknown) => {
          console.error("Could not cancel publish preview", cause);
        });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1120px] flex-col gap-0 p-0"
        closeDisabled={pending}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          descriptionRef.current?.focus();
        }}
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{t("publishedApp.publish")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_290px] md:overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            if (preview?.state === "ready" || failed)
              void publish(failed ? "accept-errors" : "ready");
          }}
        >
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="min-w-0 p-5 md:overflow-y-auto"
          >
            <TabsList>
              <TabsTrigger value="app">{t("publishedApp.preview")}</TabsTrigger>
              <TabsTrigger value="diff">
                {t("publishedApp.notebookDiff")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="app" className="mt-5">
              {preview ? (
                <AppLayoutSnapshot
                  cells={preview.project.cells}
                  visualizationScope={{ previewId: preview.previewId }}
                  resultIds={Object.fromEntries(
                    preview.outputs.map(({ cellId, resultId }) => [
                      cellId,
                      resultId,
                    ]),
                  )}
                  outputs={outputs}
                  layout={preview.project.appLayout}
                  tabBookmark={previewTab}
                  onTabChange={setPreviewTab}
                  canViewSource
                  values={{}}
                  onLoadPage={loadPage}
                />
              ) : !problem ? (
                <div aria-busy="true">
                  <span role="status" className="sr-only">
                    {t("publishedApp.preparingPreview")}
                  </span>
                  <Skeleton className="h-56 w-full" />
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="diff" className="mt-5">
              {preview ? (
                <PublishNotebookDiff preview={preview} />
              ) : !problem ? (
                <Skeleton className="h-56 w-full" />
              ) : null}
            </TabsContent>
          </Tabs>
          <aside className="flex flex-col gap-5 border-t bg-muted/25 p-5 md:overflow-y-auto md:border-s md:border-t-0">
            {preview?.project.appLayout ? (
              <details open>
                <summary className="cursor-pointer text-sm font-medium">
                  {t("publishedApp.runSettings")}
                </summary>
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-2 text-sm">
                  <dt>{t("publishedApp.runFromScratch")}</dt>
                  <dd>
                    {t(
                      preview.project.appLayout.settings.scratchOnLoad
                        ? "publishedApp.on"
                        : "publishedApp.off",
                    )}
                  </dd>
                  <dt>{t("publishedApp.autoRefresh")}</dt>
                  <dd>
                    {t(
                      preview.project.appLayout.settings.autoRefresh
                        ? "publishedApp.on"
                        : "publishedApp.off",
                    )}
                  </dd>
                  <dt>{t("publishedApp.autoRerun")}</dt>
                  <dd>
                    {t(
                      preview.project.appLayout.settings.autoRerun
                        ? "publishedApp.on"
                        : "publishedApp.off",
                    )}
                  </dd>
                </dl>
              </details>
            ) : null}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor={id}>
                  {t("publishedApp.versionDetails")}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTab("diff")}
                >
                  {t("publishedApp.compare")}
                </Button>
              </div>
              {publishedAppPath != null ? (
                <Link
                  className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                  to={publishedAppPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconExternalLink size={14} aria-hidden="true" />
                  {t("notebookHeader.viewPublishedApp")}
                </Link>
              ) : null}
              {preview?.compared ? (
                <div className="grid gap-1 border-s ps-3 text-sm text-muted-foreground">
                  <span>{t("publishedApp.replacingVersion")}</span>
                  {preview.compared.description ? (
                    <span>{preview.compared.description}</span>
                  ) : null}
                  {replacingAge ? <span>{replacingAge}</span> : null}
                  <Link
                    className="inline-flex w-fit items-center gap-1 text-foreground underline-offset-4 hover:underline"
                    to={`/app/${encodeURIComponent(projectId)}/latest`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <IconExternalLink size={14} aria-hidden="true" />
                    {t("publishedApp.goToLiveApp")}
                  </Link>
                </div>
              ) : null}
              <Textarea
                id={id}
                ref={descriptionRef}
                placeholder={t("publishedApp.versionDescription")}
                value={description}
                maxLength={2000}
                disabled={pending}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {failed ? (
              <div
                role="alert"
                className="grid gap-2 rounded-md border border-destructive p-3 text-sm"
              >
                <p className="font-medium">{t("publishedApp.projectErrors")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => void close(true)}
                >
                  {t("publishedApp.restartRun")}
                </Button>
              </div>
            ) : null}
            {problem ? (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            ) : null}
            <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
              {problem ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void close(true)}
                >
                  {t("publishedApp.restartRun")}
                </Button>
              ) : preview?.state === "ready" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => void close(true)}
                >
                  {t("publishedApp.prepareNewPreview")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={pending || running}
                onClick={() => void requestReview()}
              >
                {t("publishedApp.requestReview")}
              </Button>
              <Button
                type="submit"
                variant={failed ? "destructive" : "default"}
                disabled={pending || (preview?.state !== "ready" && !failed)}
                aria-busy={pending || running}
                title={failed ? t("publishedApp.errorsTooltip") : undefined}
              >
                {running
                  ? t("publishedApp.running")
                  : failed
                    ? t("publishedApp.publishErrors")
                    : t("publishedApp.publish")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    disabled={pending}
                    aria-label={t("publishedApp.publishActions")}
                  >
                    <IconChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canForce && running && preview ? (
                    <DropdownMenuItem onSelect={() => void publish("force")}>
                      {t("publishedApp.forcePublish")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={() => void close()}>
                    {t("publishedApp.cancel")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </aside>
        </form>
      </DialogContent>
    </Dialog>
  );
}
