import type { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import { useEffect } from "react";

type FileUploadStatus = ReturnType<typeof useFileUploadStatus>;
type FileStorageSetupCloseReason = "dismiss" | "setup" | "connected";

export function FileStorageStatusGate({
  status,
  open,
  onOpenChange,
}: {
  status: FileUploadStatus;
  open: boolean;
  onOpenChange: (open: boolean, reason?: FileStorageSetupCloseReason) => void;
}) {
  const configured = status.isSuccess && status.data?.configured === true;
  const unknown =
    status.isError ||
    !status.isSuccess ||
    typeof status.data?.configured !== "boolean";

  useEffect(() => {
    if (configured && open) onOpenChange(false, "connected");
  }, [configured, onOpenChange, open]);

  if (!open || configured) return null;

  return (
    <FileStorageSetupPopover
      open={open}
      onOpenChange={onOpenChange}
      {...(unknown
        ? {
            status: "unavailable" as const,
            onRetry: () => void status.refetch(),
          }
        : { status: "missing" as const })}
    />
  );
}
