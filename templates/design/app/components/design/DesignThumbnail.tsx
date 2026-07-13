import { useT } from "@agent-native/core/client";
import { IconCode } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export function DesignThumbnail({
  html,
  className,
  fallbackClassName,
}: {
  html: string | null | undefined;
  className?: string;
  fallbackClassName?: string;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);

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

  if (!html) {
    return (
      <div
        className={cn(
          "flex aspect-video items-center justify-center bg-muted/50",
          fallbackClassName,
          className,
        )}
      >
        <IconCode className="size-8 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative aspect-video overflow-hidden bg-white",
        className,
      )}
    >
      <iframe
        srcDoc={html}
        sandbox="allow-scripts"
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        title={t("home.designPreview")}
        style={{
          width: `${NATURAL_WIDTH}px`,
          height: `${NATURAL_HEIGHT}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
