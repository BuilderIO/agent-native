import {
  uploadEditorImage,
  useFileUploadStatus,
} from "@agent-native/core/client/uploads";
import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import { useCallback, useEffect, useRef, useState } from "react";

export function usePlanImageUpload() {
  const { data, isError, isSuccess, refetch } = useFileUploadStatus();
  const storageConfigured = !isError && data?.configured === true;
  const storageMissing =
    !import.meta.env.DEV && isSuccess && data?.configured === false;
  const canUploadImages = import.meta.env.DEV || storageConfigured;
  const [uploadAttempted, setUploadAttempted] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const pendingUploadsRef = useRef<
    Array<{
      file: File;
      resolve: (result: { src: string; alt?: string }) => void;
      reject: (error: unknown) => void;
    }>
  >([]);
  useEffect(() => {
    if (!canUploadImages) return;

    setSetupOpen(false);
    setUploadAttempted(false);
    for (const pending of pendingUploadsRef.current.splice(0)) {
      void uploadEditorImage(pending.file).then(
        pending.resolve,
        pending.reject,
      );
    }
  }, [canUploadImages]);

  useEffect(
    () => () => {
      for (const pending of pendingUploadsRef.current.splice(0)) {
        pending.reject(new Error("Image upload was canceled."));
      }
    },
    [],
  );

  useEffect(() => {
    if (uploadAttempted && (storageMissing || isError || !isSuccess)) {
      setSetupOpen(true);
    }
  }, [isError, isSuccess, storageMissing, uploadAttempted]);

  const requestUpload = useCallback(() => {
    if (canUploadImages) return true;

    setUploadAttempted(true);
    if (storageMissing) setSetupOpen(true);
    else if (isError) void refetch();
    return false;
  }, [canUploadImages, isError, refetch, storageMissing]);

  const uploadImage = useCallback(
    (file: File) => {
      if (requestUpload()) return uploadEditorImage(file);

      return new Promise<{ src: string; alt?: string }>((resolve, reject) => {
        pendingUploadsRef.current.push({ file, resolve, reject });
      });
    },
    [requestUpload],
  );

  const handleSetupOpenChange = useCallback(
    (open: boolean, reason?: "dismiss" | "setup" | "connected") => {
      setSetupOpen(open);
      if (!open) {
        setUploadAttempted(false);
        if (reason === "dismiss") {
          for (const pending of pendingUploadsRef.current.splice(0)) {
            pending.reject(new Error("Image upload was canceled."));
          }
        }
      }
    },
    [],
  );

  return {
    canUploadImages,
    requestUpload,
    uploadImage,
    storagePrompt: (
      <>
        {setupOpen ? (
          <FileStorageSetupPopover
            open
            onOpenChange={handleSetupOpenChange}
            onConnected={() => void refetch()}
            {...(isError || !isSuccess
              ? {
                  status: "unavailable" as const,
                  onRetry: () => void refetch(),
                }
              : { status: "missing" as const })}
          />
        ) : null}
      </>
    ),
  };
}
