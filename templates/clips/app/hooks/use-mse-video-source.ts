/**
 * Decides whether a recording should play through Media Source Extensions and,
 * when it should, owns the `MseVideoLoader` lifecycle.
 *
 * Raw fragmented-MP4 recordings (from the desktop live-streaming pipeline)
 * declare no up-front duration, so the browser's progressive `<video src>`
 * pipeline stalls when they're served from a CDN. This hook sniffs the asset,
 * and for fragmented files hands the video element a `MediaSource` object URL
 * driven by range requests with the duration supplied from the DB. Classic MP4,
 * WebM, Loom, and anything the browser can't MSE fall back to the native path
 * unchanged.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { sniffFragmentedMp4 } from "@/lib/fmp4";
import { MseVideoLoader, isMediaSourceSupported } from "@/lib/mse-video-loader";

export type MseSourceMode = "pending" | "native" | "mse";

export interface UseMseVideoSourceParams {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The resolved asset URL (proxied same-origin or provider URL). */
  sourceUrl: string | undefined;
  /** Authoritative duration in ms from the DB. */
  durationMs: number;
  /** Container format hint. WebM is never eligible for this MP4-only loader. */
  videoFormat?: "webm" | "mp4" | null;
  /** True for Loom embeds / formats the browser cannot decode — never MSE. */
  disabled?: boolean;
}

export interface UseMseVideoSourceResult {
  mode: MseSourceMode;
  /** MediaSource object URL to use as `<video src>` when `mode === "mse"`. */
  objectUrl: string | undefined;
  /** Drop MSE and revert to the plain `<video src>` path. */
  fallbackToNative: () => void;
}

export function useMseVideoSource({
  videoRef,
  sourceUrl,
  durationMs,
  videoFormat,
  disabled,
}: UseMseVideoSourceParams): UseMseVideoSourceResult {
  // WebM recordings use the native Infinity-duration workaround; only MP4 (and
  // unknown-format, which the sniff will confirm) are candidates.
  const eligible =
    !disabled &&
    !!sourceUrl &&
    videoFormat !== "webm" &&
    isMediaSourceSupported();

  const [mode, setMode] = useState<MseSourceMode>(() =>
    eligible ? "pending" : "native",
  );
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);
  const loaderRef = useRef<MseVideoLoader | null>(null);

  // Latest duration, kept in a ref so the (deliberately duration-independent)
  // rebuild effect below seeds a freshly created loader with the current value
  // even if it changed during the async sniff. Updating a ref in render is
  // side-effect-free and safe.
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
            url: sourceUrl,
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
  }, [eligible, sourceUrl]);

  // Recording metadata polling can raise the DB duration while the same
  // fragmented asset is still playing; apply it to the live loader in place.
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
