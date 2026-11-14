import { SESSION_REPLAY_IFRAME_ATTRIBUTE } from "@agent-native/core/client/host";
import { IconTemplate } from "@tabler/icons-react";
import type { ComponentProps } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  connectNativePreviewSurface,
  nativePreviewSurfaceDocumentKey,
  prepareNativePreviewSurface,
} from "@/components/design/design-canvas/native-preview-surface";
import {
  connectPrivateReplayScreenshotPreview,
  preparePrivateReplayScreenshotPreviewDocument,
} from "@/components/design/design-canvas/private-replay-screenshot-preview";
import { SCALED_IFRAME_PAINT_RETENTION_STYLE } from "@/components/design/scaled-iframe-paint";
import { useNativeShaderApprovals } from "@/components/design/use-native-shader-approvals";
import { cn } from "@/lib/utils";

import { NativePreviewErrorBoundary } from "../design/NativePreviewErrorBoundary";
import { templatePreviewDocument } from "./template-preview-document";

function TemplatePreviewContent({
  html,
  designId,
  title,
  width,
  height,
  className,
  fit = "contain",
  interactive = false,
  recordSessionReplay = false,
  onNavigate,
  onEscape,
}: {
  html?: string | null;
  designId?: string;
  title: string;
  width?: number | null;
  height?: number | null;
  className?: string;
  fit?: "contain" | "cover";
  interactive?: boolean;
  recordSessionReplay?: boolean;
  onNavigate?: (href: string) => void;
  onEscape?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const nativeCleanupRef = useRef<(() => void) | null>(null);
  const [scale, setScale] = useState(0.25);
  const [sessionReplayVisibility, setSessionReplayVisibility] = useState({
    enabled: recordSessionReplay,
    html,
    visible: false,
  });
  if (
    sessionReplayVisibility.html !== html ||
    sessionReplayVisibility.enabled !== recordSessionReplay
  ) {
    setSessionReplayVisibility({
      enabled: recordSessionReplay,
      html,
      visible: false,
    });
  }
  const sessionReplayVisible =
    recordSessionReplay &&
    sessionReplayVisibility.html === html &&
    sessionReplayVisibility.enabled &&
    sessionReplayVisibility.visible;
  const naturalWidth = Math.max(width ?? 1280, 320);
  const naturalHeight = Math.max(height ?? 720, 240);
  const document = useMemo(() => {
    if (!html) return undefined;
    return preparePrivateReplayScreenshotPreviewDocument(
      templatePreviewDocument(html, { recordSessionReplay }),
      { designId },
    );
  }, [designId, html, recordSessionReplay]);
  const { syncFrame: syncNativeShaderApprovals, approvedDefinitionHashes } =
    useNativeShaderApprovals({
      designId,
      fileId: undefined,
      scope: "design",
      enabled: Boolean(html?.includes("application/x-agent-native-effects")),
    });
  const nativePreviewDocument = useMemo(
    () =>
      document
        ? prepareNativePreviewSurface({
            html: document.html,
            approvedHashes: approvedDefinitionHashes,
            sandbox: "allow-scripts",
            profile: interactive ? "interactive" : "thumbnail",
            baseHref:
              typeof window === "undefined" ? undefined : window.location.href,
          })
        : null,
    [document, interactive, approvedDefinitionHashes],
  );
  const connectFrame = useCallback(
    (frame: HTMLIFrameElement | null) => {
      nativeCleanupRef.current?.();
      frameRef.current = frame;
      nativeCleanupRef.current = frame
        ? connectNativePreviewSurface(frame, nativePreviewDocument)
        : null;
    },
    [nativePreviewDocument],
  );

  useEffect(() => {
    if (!interactive) return;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== "null"
      )
        return;
      if (
        event.data?.type === "design-template-preview:navigate" &&
        typeof event.data.href === "string"
      )
        onNavigate?.(event.data.href);
      if (event.data?.type === "design-template-preview:escape") onEscape?.();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [interactive, onNavigate, onEscape]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const availableWidth = element.clientWidth;
      const availableHeight = element.clientHeight;
      if (availableWidth > 0 && availableHeight > 0) {
        const fitScale = fit === "cover" ? Math.max : Math.min;
        setScale(
          fitScale(
            availableWidth / naturalWidth,
            availableHeight / naturalHeight,
          ),
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit, naturalHeight, naturalWidth]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!recordSessionReplay || !frame) return;
    let latestIntersection: IntersectionObserverEntry | undefined;
    let hasMarkedVisible = false;
    const markVisiblePreview = () => {
      if (hasMarkedVisible) return;
      const entry = latestIntersection;
      const hasVisibleArea =
        entry?.isIntersecting &&
        entry.intersectionRatio > 0 &&
        entry.intersectionRect.width > 0 &&
        entry.intersectionRect.height > 0;
      if (!hasVisibleArea) return;

      for (
        let current: Element | null = frame;
        current;
        current = current.parentElement
      ) {
        const styles = window.getComputedStyle(current);
        const hasZeroOpacityFilter =
          /(?:^|\s)opacity\(\s*(?:0+(?:\.0*)?|\.0+)%?\s*\)(?:\s|$)/i.test(
            styles.filter || "",
          );
        if (
          styles.display === "none" ||
          styles.contentVisibility === "hidden" ||
          (styles.opacity !== "" && Number(styles.opacity) === 0) ||
          hasZeroOpacityFilter ||
          (current === frame &&
            (styles.visibility === "hidden" ||
              styles.visibility === "collapse"))
        ) {
          return;
        }
      }

      hasMarkedVisible = true;
      setSessionReplayVisibility({
        enabled: recordSessionReplay,
        html,
        visible: true,
      });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        latestIntersection = entry;
        markVisiblePreview();
      },
      { threshold: [0, Number.MIN_VALUE] },
    );
    const styleObserver = new MutationObserver(markVisiblePreview);
    for (
      let current: Element | null = frame;
      current;
      current = current.parentElement
    ) {
      styleObserver.observe(current, {
        attributes: true,
        attributeFilter: ["class", "hidden", "style"],
      });
    }
    for (const eventName of [
      "animationend",
      "animationcancel",
      "transitionend",
      "transitioncancel",
    ]) {
      window.document.addEventListener(eventName, markVisiblePreview, true);
    }
    observer.observe(frame);
    return () => {
      observer.disconnect();
      styleObserver.disconnect();
      for (const eventName of [
        "animationend",
        "animationcancel",
        "transitionend",
        "transitioncancel",
      ]) {
        window.document.removeEventListener(
          eventName,
          markVisiblePreview,
          true,
        );
      }
    };
  }, [html, recordSessionReplay]);

  if (!html) {
    return (
      <div
        className={cn(
          "flex aspect-video items-center justify-center bg-muted/50",
          className,
        )}
      >
        <IconTemplate className="size-8 text-muted-foreground/35" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden bg-muted",
        interactive ? "h-full w-full" : "aspect-video",
        className,
      )}
    >
      <iframe
        key={nativePreviewSurfaceDocumentKey(nativePreviewDocument)}
        ref={connectFrame}
        {...(recordSessionReplay && sessionReplayVisible
          ? { [SESSION_REPLAY_IFRAME_ATTRIBUTE]: "" }
          : {})}
        title={title}
        srcDoc={nativePreviewDocument?.html}
        sandbox="allow-scripts"
        {...{ credentialless: "" }}
        referrerPolicy="no-referrer"
        loading={interactive ? "eager" : "lazy"}
        onLoad={(event) => {
          syncNativeShaderApprovals(event.currentTarget);
          const frame = event.currentTarget;
          if (designId)
            connectPrivateReplayScreenshotPreview(
              frame,
              document?.screenshotPaths ?? [],
              document?.nonce ?? null,
              designId,
            );
        }}
        data-fit={fit}
        tabIndex={interactive ? 0 : -1}
        aria-hidden={!interactive || undefined}
        className={cn(
          "design-template-preview-frame",
          interactive && "design-template-preview-interactive",
        )}
        style={
          {
            ...SCALED_IFRAME_PAINT_RETENTION_STYLE,
            "--design-template-width": `${naturalWidth}px`,
            "--design-template-height": `${naturalHeight}px`,
            "--design-template-scale": scale,
          } as CSSProperties
        }
      />
    </div>
  );
}

export function TemplatePreview(
  props: ComponentProps<typeof TemplatePreviewContent>,
) {
  const documentKey = useMemo(
    () => JSON.stringify([props.designId, props.html]),
    [props.designId, props.html],
  );
  return (
    <NativePreviewErrorBoundary key={documentKey} className={props.className}>
      <TemplatePreviewContent {...props} />
    </NativePreviewErrorBoundary>
  );
}
