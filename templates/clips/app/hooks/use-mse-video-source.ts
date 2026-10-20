import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { sniffFragmentedMp4 } from "@/lib/fmp4";
import { MseVideoLoader, isMediaSourceSupported } from "@/lib/mse-video-loader";

const ACCESS_PASS_QUERY_PARAMS = [
  "t",
  "password",
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-Security-Token",
  "X-Amz-Signature",
  "X-Amz-SignedHeaders",
  "AWSAccessKeyId",
  "Expires",
  "Signature",
];

export function mseVideoSourceIdentity(sourceUrl: string | undefined): string {
  if (!sourceUrl) return "";
  try {
    const base =
      typeof window === "undefined"
        ? "http://clips.local"
        : window.location.href;
    const parsed = new URL(sourceUrl, base);
    parsed.hash = "";
    for (const key of ACCESS_PASS_QUERY_PARAMS) {
      parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return sourceUrl;
  }
}

export type MseSourceMode = "pending" | "native" | "mse";

export interface UseMseVideoSourceParams {
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceUrl: string | undefined;
  durationMs: number;
  videoFormat?: "webm" | "mp4" | null;
  disabled?: boolean;
}

export interface UseMseVideoSourceResult {
  mode: MseSourceMode;
  objectUrl: string | undefined;
  fallbackToNative: () => void;
}

export function useMseVideoSource({
  videoRef,
  sourceUrl,
  durationMs,
  videoFormat,
  disabled,
}: UseMseVideoSourceParams): UseMseVideoSourceResult {
  const eligible =
    !disabled &&
    !!sourceUrl &&
    videoFormat !== "webm" &&
    isMediaSourceSupported();
  const sourceIdentity = mseVideoSourceIdentity(sourceUrl);

  const [mode, setMode] = useState<MseSourceMode>(() =>
    eligible ? "pending" : "native",
  );
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);
  const loaderRef = useRef<MseVideoLoader | null>(null);
  const sourceUrlRef = useRef(sourceUrl);
  sourceUrlRef.current = sourceUrl;

  const durationMsRef = useRef(durationMs);
  durationMsRef.current = durationMs;

  useEffect(() => {
    loaderRef.current?.destroy();
    loaderRef.current = null;
    setObjectUrl(undefined);

    if (!eligible || !sourceUrl) {
      setMode("native");
      return;
    }

    setMode("pending");
    let cancelled = false;

    void sniffFragmentedMp4(sourceUrl)
      .then((isFragmented) => {
        if (cancelled) return;
        const video = videoRef.current;
        if (!isFragmented || !video) {
          setMode("native");
          return;
        }
        try {
          const loader = new MseVideoLoader({
            url: sourceUrlRef.current ?? sourceUrl,
            durationMs: durationMsRef.current,
            video,
            onFatal: () => {
              if (cancelled) return;
              loaderRef.current?.destroy();
              loaderRef.current = null;
              setObjectUrl(undefined);
              setMode("native");
            },
          });
          loaderRef.current = loader;
          setObjectUrl(loader.objectUrl);
          setMode("mse");
        } catch {
          setMode("native");
        }
      })
      .catch(() => {
        if (!cancelled) setMode("native");
      });

    return () => {
      cancelled = true;
      loaderRef.current?.destroy();
      loaderRef.current = null;
    };
    // videoRef is a stable ref object. `durationMs` is intentionally excluded:
    // it only seeds the timeline and is pushed to the live loader by the effect
    // below, so a metadata-poll update must not rebuild the loader (which would
    // revoke the object URL and restart playback from byte zero).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, sourceIdentity]);

  useEffect(() => {
    if (sourceUrl) loaderRef.current?.updateUrl(sourceUrl);
  }, [sourceUrl]);

  useEffect(() => {
    loaderRef.current?.setDuration(durationMs);
  }, [durationMs]);

  const fallbackToNative = useCallback(() => {
    loaderRef.current?.destroy();
    loaderRef.current = null;
    setObjectUrl(undefined);
    setMode("native");
  }, []);

  return { mode, objectUrl, fallbackToNative };
}
