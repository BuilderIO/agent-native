import {
  injectSessionReplayIframeBootstrap,
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
} from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { IconCode } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { withLocalRuntimes } from "@/components/design/design-canvas/local-runtime";
import { cn } from "@/lib/utils";

import { SCALED_IFRAME_PAINT_RETENTION_STYLE } from "./scaled-iframe-paint";

export function DesignThumbnail({
  html,
  className,
}: {
  html: string | null;
  className?: string;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const [loaded, setLoaded] = useState(false);

  // Designs are generated for a desktop-ish viewport. Render at 1280×720 then
  // shrink — close enough to 16:10 for the aspect-video card without leaving
  // a sliver of letterbox at the bottom.
  const NATURAL_WIDTH = 1280;
  const NATURAL_HEIGHT = 720;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0)
        setScale(Math.min(w / NATURAL_WIDTH, h / NATURAL_HEIGHT));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setLoaded(false);
  }, [html]);

  if (!html) {
    return (
      <div
        className={cn(
          "flex aspect-video items-center justify-center bg-muted/50",
          className,
        )}
      >
        <IconCode className="w-8 h-8 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative aspect-video overflow-hidden bg-muted",
        className,
      )}
    >
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <IconCode className="h-8 w-8 text-muted-foreground/40" />
        </div>
      ) : null}
      <iframe
        {...{ [SESSION_REPLAY_IFRAME_ATTRIBUTE]: "" }}
        srcDoc={injectSessionReplayIframeBootstrap(withLocalRuntimes(html))}
        sandbox="allow-scripts"
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        title={t("home.designPreview")}
        onLoad={() => setLoaded(true)}
        className="absolute left-1/2 top-1/2 bg-muted transition-opacity duration-200"
        style={{
          width: `${NATURAL_WIDTH}px`,
          height: `${NATURAL_HEIGHT}px`,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
          border: 0,
          pointerEvents: "none",
          opacity: loaded ? 1 : 0,
          ...SCALED_IFRAME_PAINT_RETENTION_STYLE,
        }}
      />
    </div>
  );
}
