import { useT } from "@agent-native/core/client/i18n";
import { FileStorageSetupPopover } from "@agent-native/core/client/setup-connections";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";
import { setPendingUploadFile } from "@/lib/pending-upload-file";

const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,video/*";

export function useUploadVideoPicker(): {
  openUploadPicker: (destination: string) => void;
  input: ReactNode;
} {
  const t = useT();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef("/record");
  const awaitingPickerAfterSetupRef = useRef(false);
  const pendingUploadRef = useRef<{ file: File; destination: string } | null>(
    null,
  );
  const storageStatus = useVideoStorageStatus();
  const storageConfigured =
    storageStatus.data?.configured === true && !storageStatus.isError;
  const [storageSetupOpen, setStorageSetupOpen] = useState(false);

  const completePendingUpload = useCallback(() => {
    const pending = pendingUploadRef.current;
    if (!pending) return;
    pendingUploadRef.current = null;
    setPendingUploadFile(pending.file);
    void navigate(pending.destination);
  }, [navigate]);

  useEffect(() => {
    if (!storageConfigured) return;
    setStorageSetupOpen(false);
    if (pendingUploadRef.current) {
      completePendingUpload();
      return;
    }
    if (awaitingPickerAfterSetupRef.current) {
      awaitingPickerAfterSetupRef.current = false;
      toast(t("preRecord.import"), {
        action: {
          label: t("preRecord.uploadVideo"),
          onClick: () => inputRef.current?.click(),
        },
      });
    }
  }, [completePendingUpload, storageConfigured, t]);

  const handleSetupOpenChange = useCallback(
    (open: boolean, reason?: "dismiss" | "setup" | "connected") => {
      setStorageSetupOpen(open);
      if (!open && reason === "dismiss") {
        awaitingPickerAfterSetupRef.current = false;
      }
    },
    [],
  );

  const openUploadPicker = useCallback(
    (destination: string) => {
      destinationRef.current = destination;
      if (storageConfigured) {
        awaitingPickerAfterSetupRef.current = false;
        inputRef.current?.click();
        return;
      }
      awaitingPickerAfterSetupRef.current = true;
      setStorageSetupOpen(true);
    },
    [storageConfigured],
  );

  const handleChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      pendingUploadRef.current = {
        file,
        destination: destinationRef.current,
      };
      if (!storageConfigured) {
        try {
          const result = await storageStatus.refetch();
          if (result.isError || typeof result.data?.configured !== "boolean") {
            setStorageSetupOpen(true);
            return;
          }
          if (!result.data.configured) {
            setStorageSetupOpen(true);
            return;
          }
        } catch {
          setStorageSetupOpen(true);
          return;
        }
      }
      completePendingUpload();
    },
    [completePendingUpload, storageConfigured, storageStatus],
  );

  return {
    openUploadPicker,
    input: (
      <>
        <input
          ref={inputRef}
          type="file"
          accept={VIDEO_ACCEPT}
          className="hidden"
          data-button-group-ignore="true"
          onChange={handleChange}
        />
        <FileStorageSetupPopover
          open={storageSetupOpen}
          onOpenChange={handleSetupOpenChange}
          onConnected={() => void storageStatus.refetch()}
          {...(!storageStatus.isSuccess || storageStatus.isError
            ? {
                status: "unavailable" as const,
                onRetry: () => void storageStatus.refetch(),
              }
            : { status: "missing" as const })}
        />
      </>
    ),
  };
}
