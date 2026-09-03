import {
  injectSessionReplayIframeBootstrap,
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
} from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { IconCode } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { withLocalRuntimes } from "@/components/design/design-canvas/local-runtime";

export function DesignThumbnail({ html }: { html: string | null }) {
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
      if (w > 0) setScale(w / NATURAL_WIDTH);
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
      <div className="aspect-video bg-muted/50 flex items-center justify-center">
        <IconCode className="w-8 h-8 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative aspect-video overflow-hidden bg-muted"
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
        className="relative bg-muted transition-opacity duration-200"
        style={{
          width: `${NATURAL_WIDTH}px`,
          height: `${NATURAL_HEIGHT}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: 0,
          pointerEvents: "none",
          opacity: loaded ? 1 : 0,
        }}
      />
    </div>
  );
}
