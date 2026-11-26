import { useCallback, useEffect, useState } from "react";

export const REFERENCE_FRAME_LOAD_TIMEOUT_MS = 8_000;

/**
 * A cross-origin preview counts as failed only while its document is still
 * unloaded. A late successful load clears the failure for that URL.
 */
export function useReferenceFrameFailure({
  url,
  eligible,
  loaded,
}: {
  url: string | null | undefined;
  eligible: boolean;
  loaded: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (loaded) {
      setFailedUrl(null);
      return;
    }
    if (!eligible || !url) return;
    const timeout = window.setTimeout(
      () => setFailedUrl(url),
      REFERENCE_FRAME_LOAD_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [url, eligible, loaded]);
  const markFailed = useCallback(() => {
    if (url) setFailedUrl(url);
  }, [url]);
  return {
    failed: Boolean(url) && eligible && !loaded && failedUrl === url,
    markFailed,
  };
}
