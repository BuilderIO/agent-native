import { FileStorageSetupPopover } from "@agent-native/core/client/setup-connections";
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
  onRetry,
}: {
  state: FileUploadStorageState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    if (open && state === "configured") onOpenChange(false);
  }, [onOpenChange, open, state]);

  if (!open || state === "configured") return null;
  return (
    <FileStorageSetupPopover
      open={open}
      onOpenChange={onOpenChange}
      {...(state === "unknown"
        ? { status: "unavailable" as const, onRetry }
        : { status: "missing" as const })}
    />
  );
}
