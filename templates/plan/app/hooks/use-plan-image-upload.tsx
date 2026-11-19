import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  uploadEditorImage,
  useFileUploadStatus,
} from "@agent-native/core/client/uploads";
import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import { useCallback, useEffect, useRef, useState } from "react";

/** No storage is connected that can keep the plan's image. */
export class PlanImageStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanImageStorageUnavailableError";
  }
}

/**
 * Adds an image to a plan. The image is stored privately and loads only for
 * people who can open the plan.
 */
export async function uploadPlanImage(
  file: File,
  planId: string,
): Promise<{ src: string; alt?: string }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be uploaded.");
  }
  const form = new FormData();
  form.append("file", file);
  form.append("planId", planId);
  const response = await fetch(agentNativePath("/_agent-native/plan-asset"), {
    method: "POST",
    body: form,
    credentials: "include",
    headers: { "X-Agent-Native-CSRF": "1" },
  });
  // coercion-ok: a body that isn't JSON falls back to the status message below
  const body = (await response.json().catch(() => null)) as {
    url?: unknown;
    error?: unknown;
    code?: unknown;
  } | null;
  const message =
    typeof body?.error === "string" && body.error
      ? body.error
      : `Image upload failed (${response.status}).`;
  if (response.status === 503 && body?.code === "storage_unavailable") {
    throw new PlanImageStorageUnavailableError(message);
  }
  if (!response.ok || typeof body?.url !== "string" || !body.url) {
    throw new Error(message);
  }
  const alt = file.name ? file.name.replace(/\.[^./\\]+$/, "") : "";
  return { src: body.url, alt };
}

/**
 * A plan opened from a local folder has no database row for the image route
 * to check access against.
 */
function isLocalFolderPlanId(planId: string): boolean {
  return planId.startsWith("local-");
}

/**
 * Image uploads into one plan, with the prompt to connect storage when none
 * is. Without a plan, `uploadImage` refuses: an image belongs to a plan.
 */
export function usePlanImageUpload(planId: string | null | undefined) {
  const { data, isError, isSuccess, refetch } = useFileUploadStatus();
  const storageConfigured = !isError && data?.configured === true;
  const storageMissing =
    !import.meta.env.DEV && isSuccess && data?.configured === false;
  const canUploadImages = import.meta.env.DEV || storageConfigured;
  const [uploadAttempted, setUploadAttempted] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [storageRefused, setStorageRefused] = useState(false);
  const pendingUploadsRef = useRef<
    Array<{
      file: File;
      resolve: (result: { src: string; alt?: string }) => void;
      reject: (error: unknown) => void;
    }>
  >([]);
  const upload = useCallback(
    async (file: File) => {
      if (!planId) throw new Error("Save the plan before adding images.");
      // A local folder plan's images keep going where they did before private
      // storage, until the folder can hold them itself.
      if (isLocalFolderPlanId(planId)) return uploadEditorImage(file);
      try {
        return await uploadPlanImage(file, planId);
      } catch (error) {
        // The server has no storage for the image even though the status
        // said some was connected: offer to connect it.
        if (error instanceof PlanImageStorageUnavailableError) {
          setStorageRefused(true);
          setSetupOpen(true);
        }
        throw error;
      }
    },
    [planId],
  );

  useEffect(() => {
    if (!canUploadImages) return;

    setSetupOpen(false);
    setUploadAttempted(false);
    for (const pending of pendingUploadsRef.current.splice(0)) {
      void upload(pending.file).then(pending.resolve, pending.reject);
    }
  }, [canUploadImages, upload]);

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

  // An editor keeps the upload it was created with, so `uploadImage` stays
  // one function that reads the hook's current state when it runs. A stale
  // copy would queue a file after the queue had already been drained.
  const latestRef = useRef({ requestUpload, upload });
  useEffect(() => {
    latestRef.current = { requestUpload, upload };
  });
  const uploadImage = useCallback((file: File) => {
    const latest = latestRef.current;
    if (latest.requestUpload()) return latest.upload(file);

    return new Promise<{ src: string; alt?: string }>((resolve, reject) => {
      pendingUploadsRef.current.push({ file, resolve, reject });
    });
  }, []);

  const handleSetupOpenChange = useCallback(
    (open: boolean, reason?: "dismiss" | "setup" | "connected") => {
      setSetupOpen(open);
      if (!open) {
        setUploadAttempted(false);
        setStorageRefused(false);
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
            {...((isError || !isSuccess) && !storageRefused
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
