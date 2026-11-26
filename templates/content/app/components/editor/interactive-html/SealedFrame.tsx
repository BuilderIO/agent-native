import { useIsDark } from "@agent-native/toolkit/app/blocks";
import { useEffect, useMemo, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { useContentMediaWrittenIn } from "./content-media";
import { useInteractiveHtmlDisplaySources } from "./display-sources";
import {
  focusSealedFrame,
  readSealedFrameMessage,
  SEALED_FRAME_ALLOW,
  SEALED_FRAME_SANDBOX,
  sealedFrameDocument,
} from "./sealed-frame";

export const SEALED_FRAME_FIRST_HEIGHT = 400;

export function SealedFrame({
  source,
  title,
  fullScreen,
  onEscape,
}: {
  source: string;
  title: string;
  fullScreen: boolean;
  onEscape: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sources = useInteractiveHtmlDisplaySources();
  const html = useContentMediaWrittenIn(source);
  const dark = useIsDark();
  const [height, setHeight] = useState(SEALED_FRAME_FIRST_HEIGHT);
  const ready = useMemo(
    () =>
      sources && html !== null ? sealedFrameDocument(html, sources) : null,
    [html, sources],
  );
  const [shown, setShown] = useState(ready);
  if (ready !== null && ready !== shown) setShown(ready);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const message = readSealedFrameMessage(event.data);
      if (message?.type === "escape") onEscape();
      if (message?.type === "height" && !fullScreen) {
        setHeight(message.height);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fullScreen, onEscape]);

  const focus = () => {
    if (fullScreen && frameRef.current) focusSealedFrame(frameRef.current);
  };
  useEffect(focus, [fullScreen]);

  if (shown === null) {
    return (
      <Skeleton
        className="w-full"
        style={{ height: SEALED_FRAME_FIRST_HEIGHT }}
      />
    );
  }
  return (
    <iframe
      ref={frameRef}
      sandbox={SEALED_FRAME_SANDBOX}
      allow={SEALED_FRAME_ALLOW}
      allowFullScreen
      srcDoc={shown}
      title={title}
      onLoad={focus}
      className="content-interactive-html__frame"
      style={{
        height: fullScreen ? undefined : height,
        colorScheme: dark ? "dark" : "light",
      }}
    />
  );
}
