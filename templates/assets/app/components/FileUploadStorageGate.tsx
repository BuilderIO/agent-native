import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import { useEffect } from "react";

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
  open,
  onOpenChange,
  onDismiss,
  onRetry,
}: {
  state: FileUploadStorageState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss?: () => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    if (open && state === "configured") onOpenChange(false);
  }, [onOpenChange, open, state]);

  if (!open || state === "configured") return null;
  return (
    <FileStorageSetupPopover
      open={open}
      onOpenChange={(nextOpen, reason) => {
        if (!nextOpen && reason === "dismiss") onDismiss?.();
        onOpenChange(nextOpen);
      }}
      {...(state === "unknown"
        ? { status: "unavailable" as const, onRetry }
        : { status: "missing" as const })}
    />
  );
}
