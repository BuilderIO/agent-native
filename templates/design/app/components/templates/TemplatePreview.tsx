import { SESSION_REPLAY_IFRAME_ATTRIBUTE } from "@agent-native/core/client/host";
import { IconTemplate } from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { SCALED_IFRAME_PAINT_RETENTION_STYLE } from "@/components/design/scaled-iframe-paint";
import { cn } from "@/lib/utils";

import { templatePreviewDocument } from "./template-preview-document";

export function TemplatePreview({
  html,
  title,
  width,
  height,
  className,
  interactive = false,
  recordSessionReplay = false,
  onNavigate,
  onEscape,
}: {
  html?: string | null;
  title: string;
  width?: number | null;
  height?: number | null;
  className?: string;
  interactive?: boolean;
  recordSessionReplay?: boolean;
  onNavigate?: (href: string) => void;
  onEscape?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
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
  const document = useMemo(
    () => (html ? templatePreviewDocument(html) : undefined),
    [html],
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
        setScale(
          Math.min(
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
  }, [naturalHeight, naturalWidth]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!recordSessionReplay || !frame) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const hasVisibleArea =
          entry.isIntersecting &&
          entry.intersectionRatio > 0 &&
          entry.intersectionRect.width > 0 &&
          entry.intersectionRect.height > 0;
        if (!hasVisibleArea) return;
        setSessionReplayVisibility({
          enabled: recordSessionReplay,
          html,
          visible: true,
        });
      },
      { threshold: [0, Number.MIN_VALUE] },
    );
    observer.observe(frame);
    return () => observer.disconnect();
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
        ref={frameRef}
        {...(recordSessionReplay && sessionReplayVisible
          ? { [SESSION_REPLAY_IFRAME_ATTRIBUTE]: "" }
          : {})}
        title={title}
        srcDoc={document}
        sandbox="allow-scripts"
        {...{ credentialless: "" }}
        referrerPolicy="no-referrer"
        loading={interactive ? "eager" : "lazy"}
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
