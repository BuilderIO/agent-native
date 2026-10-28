import {
  buildStreamingFrameDocument,
  isStreamingFrameReadyMessage,
  postStreamingFrameHtml,
  renderableHtmlPrefix,
} from "@agent-native/core/client/generation-stream";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";

export interface StreamingHtmlFrameProps {
  /** The HTML document so far; cut-off tags and scripts are held back. */
  html: string;
  title: string;
  /** Resolves relative URLs in the streamed document. */
  baseHref?: string | undefined;
  /**
   * The color each new element's frame is drawn in. Defaults to the
   * surrounding `GeneratingFrame` accent.
   */
  accent?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/**
 * A sandboxed frame that shows an HTML document while it is still being
 * written. The frame loads once and is patched in place, so it never flashes
 * and text grows inside elements already on screen.
 */
export function StreamingHtmlFrame({
  html,
  title,
  baseHref,
  accent,
  className,
  style,
}: StreamingHtmlFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const renderable = useMemo(() => renderableHtmlPrefix(html), [html]);
  const latestRef = useRef(renderable);
  latestRef.current = renderable;
  const sentRef = useRef<string | null>(null);
  const shell = useMemo(
    () => buildStreamingFrameDocument({ baseHref }),
    [baseHref],
  );

  const accentRef = useRef<string | undefined>(accent);
  const send = (frame: HTMLIFrameElement, value: string) => {
    if (!accentRef.current) {
      accentRef.current =
        getComputedStyle(frame)
          .getPropertyValue("--an-generating-accent")
          .trim() || undefined;
    }
    sentRef.current = value;
    postStreamingFrameHtml(frame, value, { accent: accentRef.current });
  };

  const markReady = () => {
    const frame = frameRef.current;
    if (!frame) return;
    readyRef.current = true;
    if (sentRef.current !== latestRef.current) send(frame, latestRef.current);
  };

  // A layout effect, so the listener is in place before the new document can
  // post that it is ready; a passive effect could miss that one message.
  useLayoutEffect(() => {
    readyRef.current = false;
    sentRef.current = null;
    const onMessage = (event: MessageEvent) => {
      if (isStreamingFrameReadyMessage(event, frameRef.current)) markReady();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [shell]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !readyRef.current || sentRef.current === renderable) return;
    send(frame, renderable);
  }, [renderable]);

  return (
    <iframe
      ref={frameRef}
      srcDoc={shell}
      // The frame's script is listening by the time it loads, so load is a
      // second chance at the handshake.
      onLoad={markReady}
      sandbox="allow-scripts"
      title={title}
      tabIndex={-1}
      className={className}
      style={{ border: 0, display: "block", pointerEvents: "none", ...style }}
    />
  );
}
