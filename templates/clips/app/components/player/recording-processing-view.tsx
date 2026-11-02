import { useT } from "@agent-native/core/client/i18n";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/library/page-header";
import { Spinner } from "@/components/ui/spinner";

export function RecordingProcessingView({
  breadcrumb,
  isPrivateRecipient,
  progress,
}: {
  breadcrumb: ReactNode;
  isPrivateRecipient: boolean;
  progress: number;
}) {
  const t = useT();
  const hasProgress = progress > 0;
  const shownProgress = Math.min(100, Math.max(0, progress));
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <PageHeader>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">{breadcrumb}</div>
          {isPrivateRecipient ? (
            <span className="shrink-0 whitespace-nowrap text-sm font-medium text-muted-foreground">
              {t("recordingPage.sharedWithYou")}
            </span>
          ) : null}
        </div>
      </PageHeader>
      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
        <div className="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-xl bg-foreground">
          <div className="flex flex-col items-center gap-3 text-center text-background">
            <Spinner className="size-8" />
            <p className="text-sm font-medium">
              {t("recordingPage.finishingClip")}
            </p>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          <p className="text-center text-sm text-muted-foreground">
            {t("recordingPage.uploadingAssembling")}
          </p>
          {hasProgress ? (
            <div
              role="progressbar"
              aria-label={t("recordRoute.savingRecording")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={shownProgress}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-foreground transition-[width]"
                style={{ width: `${shownProgress}%` }}
              />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
