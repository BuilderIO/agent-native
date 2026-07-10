import { IconTemplate } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

export function TemplatePreview({
  html,
  title,
  width,
  height,
}: {
  html?: string | null;
  title: string;
  width?: number | null;
  height?: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const naturalWidth = Math.max(width ?? 1280, 320);
  const naturalHeight = Math.max(height ?? 720, 240);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const availableWidth = element.clientWidth;
      const availableHeight = element.clientHeight;
      if (availableWidth > 0 && availableHeight > 0) {
        setScale(
          Math.max(
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

  if (!html) {
    return (
      <div className="flex aspect-video items-center justify-center bg-muted/50">
        <IconTemplate className="size-8 text-muted-foreground/35" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative aspect-video overflow-hidden bg-white"
    >
      <iframe
        title={`${title} preview`}
        srcDoc={html}
        sandbox=""
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        style={{
          width: `${naturalWidth}px`,
          height: `${naturalHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
