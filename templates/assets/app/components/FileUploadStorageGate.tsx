import { useT } from "@agent-native/core/client/i18n";
import { FileStorageSetupCard } from "@agent-native/core/client/setup-connections";

import { Button } from "@/components/ui/button";

export type FileUploadStorageState = "configured" | "missing" | "unknown";

export function getFileUploadStorageState(status: {
  data?: { configured?: unknown };
  isError: boolean;
  isSuccess: boolean;
}): FileUploadStorageState {
  if (status.isError || !status.isSuccess) return "unknown";
  if (status.data?.configured === true) return "configured";
  if (status.data?.configured === false) return "missing";
  return "unknown";
}

export function FileUploadStorageGate({
  state,
  onRetry,
  className,
}: {
  state: FileUploadStorageState;
  onRetry: () => void;
  className?: string;
}) {
  const t = useT();

  if (state === "configured") return null;
  if (state === "missing") {
    return (
      <div className={className}>
        <FileStorageSetupCard />
      </div>
    );
  }

  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 text-sm text-muted-foreground ${className ?? ""}`}
    >
      <span>
        {t("settings.storage")}: {t("settings.statusUnavailable")}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        {t("brandKitDetail.refresh")}
      </Button>
    </div>
  );
}
