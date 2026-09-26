import { useT } from "@agent-native/core/client/i18n";
import { FileStorageSetupCard } from "@agent-native/core/client/setup-connections";
import type { useFileUploadStatus } from "@agent-native/core/client/uploads";

import { Button } from "@/components/ui/button";

type FileUploadStatus = ReturnType<typeof useFileUploadStatus>;

export function FileStorageStatusGate({
  status,
}: {
  status: FileUploadStatus;
}) {
  const t = useT();

  if (status.isError || !status.isSuccess) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4 text-sm text-muted-foreground"
        role="status"
      >
        <span>{t("onboarding.fileStorage.statusUnavailable")}</span>
        <Button
          type="button"
          data-testid="file-storage-retry"
          variant="link"
          size="sm"
          className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void status.refetch()}
        >
          {t("database.retry")}
        </Button>
      </div>
    );
  }

  return status.data.configured ? null : <FileStorageSetupCard />;
}
