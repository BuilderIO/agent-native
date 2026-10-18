import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { IconAlertTriangle, IconMarkdown } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import {
  PageBreadcrumb,
  PageHeader,
  PageHeaderActionGroup,
  PageHeaderPrimaryAction,
} from "@/components/library/page-header";
import { Button } from "@/components/ui/button";
import {
  getFolderAncestorPath,
  useFolders,
  useOrganizations,
  useRecordings,
} from "@/hooks/use-library";
import enMessages from "@/i18n/en-US";
import { recordingShareUrl } from "@/lib/recording-link";
import { buildStepGuide, stepGuideMarkdown } from "@shared/step-guide";

export function meta() {
  return [{ title: enMessages.stepGuide.pageTitle }];
}

/** The most screenshots one guide reads; a step capture is far shorter. */
const GUIDE_LIMIT = 500;

export default function LibraryFolderGuideRoute() {
  const t = useT();
  const { folderId } = useParams<{ folderId: string }>();

  const { data: organizations } = useOrganizations();
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;
  const { data: folders } = useFolders({
    organizationId: currentOrganizationId,
  });
  const folderPath = useMemo(
    () => getFolderAncestorPath(folders?.folders ?? [], folderId),
    [folders, folderId],
  );
  const folder = folderPath[folderPath.length - 1];
  const folderName = folder?.name ?? t("navigation.folder");

  const { data, isLoading, isError, refetch, isRefetching } = useRecordings({
    view: "library",
    kind: "image",
    folderId,
    sort: "oldest",
    limit: GUIDE_LIMIT,
  });
  const steps = useMemo(
    () => buildStepGuide(data?.recordings ?? []),
    [data?.recordings],
  );

  async function copyMarkdown() {
    const markdown = stepGuideMarkdown({
      title: folderName,
      steps: steps.map((step) => ({
        number: step.number,
        title: step.title,
        imageUrl: step.recording.thumbnailUrl
          ? new URL(step.recording.thumbnailUrl, window.location.href).href
          : null,
        linkUrl: recordingShareUrl(step.recording.id),
      })),
    });
    if (await writeClipboardText(markdown)) {
      toast.success(t("stepGuide.copied"));
    } else {
      toast.error(t("stepGuide.copyFailed"));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">
            <PageBreadcrumb
              items={[
                { label: t("navigation.library"), to: "/library" },
                ...folderPath.map((entry) => ({
                  label: entry.name,
                  to: `/library/folder/${entry.id}`,
                })),
                { label: t("stepGuide.guide") },
              ]}
            />
          </div>
          {steps.length > 0 && (
            <PageHeaderActionGroup>
              <PageHeaderPrimaryAction onClick={() => void copyMarkdown()}>
                <IconMarkdown />
                {t("stepGuide.copyMarkdown")}
              </PageHeaderPrimaryAction>
            </PageHeaderActionGroup>
          )}
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={isLoading}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="animate-pulse space-y-3">
                <div className="h-5 w-1/2 rounded bg-muted" />
                <div className="aspect-video rounded-lg bg-muted" />
              </div>
            ))
          ) : isError && steps.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-destructive/10">
                <IconAlertTriangle className="h-10 w-10 text-destructive" />
              </div>
              <h2 className="mb-1 text-base font-semibold text-foreground">
                {t("libraryGrid.loadFailedTitle")}
              </h2>
              <p className="mb-5 max-w-sm text-sm text-muted-foreground">
                {t("libraryGrid.loadFailedBody")}
              </p>
              <Button
                onClick={() => refetch()}
                disabled={isRefetching}
                size="sm"
              >
                {t("libraryGrid.retry")}
              </Button>
            </div>
          ) : steps.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              {t("stepGuide.empty")}
            </p>
          ) : (
            <>
              <header className="space-y-1">
                <h1 className="text-xl font-semibold text-foreground">
                  {folderName}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("stepGuide.stepCount", { count: steps.length })}
                </p>
              </header>
              <ol className="flex flex-col gap-10">
                {steps.map((step) => {
                  const label =
                    step.title || t("stepGuide.step", { number: step.number });
                  return (
                    <li key={step.recording.id} className="space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                          {step.number}
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <h2 className="break-words font-medium text-foreground">
                            {label}
                          </h2>
                          {step.recording.sourceAppName ? (
                            <p className="text-xs text-muted-foreground">
                              {step.recording.sourceAppName}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <Link
                        to={`/r/${step.recording.id}`}
                        className="block overflow-hidden rounded-lg border border-border bg-muted"
                        aria-label={t("stepGuide.openStep", {
                          number: step.number,
                        })}
                      >
                        {step.recording.thumbnailUrl ? (
                          <img
                            src={step.recording.thumbnailUrl}
                            alt={label}
                            width={step.recording.width || undefined}
                            height={step.recording.height || undefined}
                            loading="lazy"
                            className="h-auto w-full"
                          />
                        ) : (
                          <div className="aspect-video" />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ol>
              <p className="text-xs text-muted-foreground">
                {t("stepGuide.imageAccessNote")}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
