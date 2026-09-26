import { useT } from "@agent-native/core/client/i18n";
import { FileStorageSetupCard } from "@agent-native/core/client/setup-connections";
import { IconAlertTriangle } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export function UploadStorageGate({
  configured,
  unavailable,
  onRetry,
}: {
  configured: boolean;
  unavailable: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  if (unavailable) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm"
        role="alert"
        data-testid="upload-storage-unavailable"
      >
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <IconAlertTriangle className="size-4 shrink-0" />
          <span>{t("home.fileStorageStatusUnavailable")}</span>
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("home.retry")}
        </Button>
      </div>
    );
  }
  return configured ? null : <FileStorageSetupCard />;
}
