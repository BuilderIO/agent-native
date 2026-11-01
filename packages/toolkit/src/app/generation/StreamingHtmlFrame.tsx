import {
  buildStreamingFrameDocument,
  connectStreamingFrame,
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
  // The private channel to the document this component wrote; null until it
  // is ready, and again once the frame navigates away.
  const portRef = useRef<MessagePort | null>(null);
  const renderable = useMemo(() => renderableHtmlPrefix(html), [html]);
  const latestRef = useRef(renderable);
  latestRef.current = renderable;
  const sentRef = useRef<string | null>(null);
  // A fresh token per document: only the document this component wrote may
  // claim to be ready, not one the frame was navigated to.
  const token = useMemo(() => frameToken(), [baseHref]);
  const shell = useMemo(
    () => buildStreamingFrameDocument({ baseHref, token }),
    [baseHref, token],
  );
  // How many times the frame has loaded this document. The first load is the
  // document itself; any later one means a script navigated the frame away.
  const loadsRef = useRef(0);
  const navigatedRef = useRef(false);

  const accentRef = useRef<string | undefined>(accent);
  const send = (frame: HTMLIFrameElement, port: MessagePort, value: string) => {
    if (!accentRef.current) {
      accentRef.current =
        getComputedStyle(frame)
          .getPropertyValue("--an-generating-accent")
          .trim() || undefined;
    }
    sentRef.current = value;
    postStreamingFrameHtml(port, value, { accent: accentRef.current });
  };

  const closePort = () => {
    portRef.current?.close();
    portRef.current = null;
  };

  const markReady = () => {
    const frame = frameRef.current;
    if (!frame || navigatedRef.current || portRef.current) return;
    const port = connectStreamingFrame(frame);
    if (!port) return;
    portRef.current = port;
    send(frame, port, latestRef.current);
  };

  // A layout effect, so the listener is in place before the new document can
  // post that it is ready; a passive effect could miss that one message.
  useLayoutEffect(() => {
    closePort();
    sentRef.current = null;
    loadsRef.current = 0;
    navigatedRef.current = false;
    const onMessage = (event: MessageEvent) => {
      if (isStreamingFrameReadyMessage(event, frameRef.current, token)) {
        markReady();
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      closePort();
    };
  }, [shell, token]);

  const onLoad = () => {
    loadsRef.current += 1;
    if (loadsRef.current === 1) {
      // The frame's script is listening by the time it loads, so the first
      // load is a second chance at the handshake.
      markReady();
      return;
    }
    navigatedRef.current = true;
    closePort();
  };

  useEffect(() => {
    const frame = frameRef.current;
    const port = portRef.current;
    if (!frame || !port || sentRef.current === renderable) return;
    send(frame, port, renderable);
  }, [renderable]);

  return (
    <iframe
      ref={frameRef}
      srcDoc={shell}
      onLoad={onLoad}
      sandbox="allow-scripts"
      title={title}
      tabIndex={-1}
      className={className}
      style={{ border: 0, display: "block", pointerEvents: "none", ...style }}
    />
  );
}

function frameToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
