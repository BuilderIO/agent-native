import { FileStorageSetupDialog } from "@agent-native/core/client/setup-connections";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";

import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";
import { setPendingUploadFile } from "@/lib/pending-upload-file";

const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,video/*";

export function useUploadVideoPicker(): {
  openUploadPicker: (destination: string) => void;
  input: ReactNode;
} {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef("/record");
  const storageStatus = useVideoStorageStatus();
  const storageConfigured =
    storageStatus.data?.configured === true && !storageStatus.isError;
  const [storageSetupOpen, setStorageSetupOpen] = useState(false);

  useEffect(() => {
    if (storageConfigured) setStorageSetupOpen(false);
  }, [storageConfigured]);

  const openUploadPicker = useCallback(
    (destination: string) => {
      destinationRef.current = destination;
      if (storageConfigured) {
        inputRef.current?.click();
        return;
      }
      if (storageStatus.data?.configured === false && !storageStatus.isError) {
        setStorageSetupOpen(true);
        return;
      }
      void storageStatus.refetch().then((result) => {
        if (!result.isError && result.data?.configured) {
          inputRef.current?.click();
        } else {
          setStorageSetupOpen(true);
        }
      });
    },
    [storageConfigured, storageStatus],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setPendingUploadFile(file);
      void navigate(destinationRef.current);
    },
    [navigate],
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
        <FileStorageSetupDialog
          open={storageSetupOpen}
          onOpenChange={setStorageSetupOpen}
          onConnected={() => void storageStatus.refetch()}
        />
      </>
    ),
  };
}
