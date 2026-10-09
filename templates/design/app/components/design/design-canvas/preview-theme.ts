import type {
  DarkStyleSupport,
  PreviewColorScheme,
} from "@shared/preview-color-scheme";
import { useEffect, useRef, type RefObject } from "react";

import { previewThemeBridgeScript } from "../../../../.generated/bridge/preview-theme.generated";

export const PREVIEW_COLOR_SCHEME_MESSAGE = "agent-native:preview-color-scheme";
export const PREVIEW_THEME_STATE_MESSAGE = "agent-native:preview-theme-state";

/**
 * What the editor knows about a preview's theme support. `unavailable` is
 * decided from how the frame is hosted (the page never runs our bridge), not
 * from a missing reply, so a slow frame is never reported as unsupported.
 */
export type PreviewThemeStatus =
  | { kind: "unavailable" }
  | {
      kind: "ready";
      scheme: PreviewColorScheme | null;
      darkStyles: DarkStyleSupport;
    };

/**
 * One constant string: the bridge text is part of the srcdoc and of the
 * live-edit registration key, so it must not vary with the scheme. A markup
 * frame's starting scheme comes from its `name` attribute instead (see
 * `previewColorSchemeFrameName`); every frame is synced by message after load.
 */
export const PREVIEW_THEME_BRIDGE_SCRIPT = `<script data-agent-native-preview-theme-bridge>${previewThemeBridgeScript}</script>`;

function readDarkStyles(value: unknown): DarkStyleSupport {
  return value === "yes" || value === "no" ? value : "unknown";
}

function postScheme(
  frame: HTMLIFrameElement | null,
  scheme: PreviewColorScheme | null,
): void {
  frame?.contentWindow?.postMessage(
    { type: PREVIEW_COLOR_SCHEME_MESSAGE, scheme },
    "*",
  );
}

/**
 * Keeps one preview frame on the scheme the editor wants and reports what its
 * document supports. The bridge announces itself on every load, which is also
 * how a reloaded or newly mounted frame gets the current scheme.
 */
export function usePreviewThemeChannel({
  iframeRef,
  scheme,
  screenId,
  bridgeReachable,
  onStatus,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  scheme: PreviewColorScheme | null;
  screenId: string | undefined;
  bridgeReachable: boolean;
  onStatus?: (screenId: string | undefined, status: PreviewThemeStatus) => void;
}): void {
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    postScheme(iframeRef.current, scheme);
  }, [iframeRef, scheme]);

  useEffect(() => {
    if (!bridgeReachable) {
      onStatusRef.current?.(screenId, { kind: "unavailable" });
    }
  }, [bridgeReachable, screenId]);

  useEffect(() => {
    if (!bridgeReachable) return;
    const handleMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as {
        type?: unknown;
        scheme?: unknown;
        darkStyles?: unknown;
      } | null;
      if (data?.type !== PREVIEW_THEME_STATE_MESSAGE) return;
      const applied =
        data.scheme === "light" || data.scheme === "dark" ? data.scheme : null;
      if (applied !== schemeRef.current) {
        postScheme(frame, schemeRef.current);
      }
      onStatusRef.current?.(screenId, {
        kind: "ready",
        scheme: applied,
        darkStyles: readDarkStyles(data.darkStyles),
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [bridgeReachable, iframeRef, screenId]);
}
