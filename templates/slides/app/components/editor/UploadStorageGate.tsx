import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import type { RefObject } from "react";
import { useEffect } from "react";

export function UploadStorageGate({
  configured,
  unavailable,
  open,
  onOpenChange,
  onRetry,
  onConnected,
  anchorRef,
}: {
  configured: boolean;
  unavailable: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onConnected?: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (configured && open) onOpenChange(false);
  }, [configured, onOpenChange, open]);
  if (!open || configured) return null;
  return (
    <FileStorageSetupPopover
      open
      onOpenChange={onOpenChange}
      onConnected={onConnected}
      anchorRef={anchorRef}
      {...(unavailable
        ? { status: "unavailable" as const, onRetry }
        : { status: "missing" as const })}
    />
  );
}
