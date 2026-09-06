import { type ChangeEvent, type ReactNode, useCallback, useRef } from "react";
import { useNavigate } from "react-router";

import { setPendingUploadFile } from "@/lib/pending-upload-file";

const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,video/*";

export function useUploadVideoPicker(): {
  openUploadPicker: (destination: string) => void;
  input: ReactNode;
} {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef("/record");

  const openUploadPicker = useCallback((destination: string) => {
    destinationRef.current = destination;
    inputRef.current?.click();
  }, []);

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
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        className="hidden"
        onChange={handleChange}
      />
    ),
  };
}
