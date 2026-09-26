import { FileStorageSetupPopover } from "@agent-native/core/client/setup-connections";
import { useEffect } from "react";

export function UploadStorageGate({
  configured,
  unavailable,
  open,
  onOpenChange,
  onRetry,
}: {
  configured: boolean;
  unavailable: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    if (configured && open) onOpenChange(false);
  }, [configured, onOpenChange, open]);
  if (!open || configured) return null;
  return (
    <FileStorageSetupPopover
      open
      onOpenChange={onOpenChange}
      {...(unavailable
        ? { status: "unavailable" as const, onRetry }
        : { status: "missing" as const })}
    />
  );
}
