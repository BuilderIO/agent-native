import { useT } from "@agent-native/core/client/i18n";
import {
  GeneratingFrame,
  StreamingHtmlFrame,
} from "@agent-native/toolkit/app/generation";
import { useEffect, useMemo, useRef, useState } from "react";

import { withLocalRuntimes } from "@/components/design/design-canvas/local-runtime";
import type { GeneratingDesignPreview as Preview } from "@/hooks/use-generating-design-preview";

const DEFAULT_SIZE = { width: 1440, height: 900 };

/**
 * The screen the agent is writing, at its final size, filling in as the HTML
 * streams. Before any HTML arrives it holds a skeleton at that size. With
 * `canvasScale` it is drawn at the canvas zoom; otherwise it fits its column.
 */
export function GeneratingDesignPreview({
  preview,
  savedHtml,
  settling = false,
  canvasScale,
}: {
  preview: Preview | null;
  /** The screen as saved so far, shown whenever no call is streaming. */
  savedHtml?: string | undefined;
  settling?: boolean | undefined;
  canvasScale?: number;
}) {
  const t = useT();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0);
  const scale = canvasScale ?? fitScale;
  const width = preview?.width ?? DEFAULT_SIZE.width;
  const height = preview?.height ?? DEFAULT_SIZE.height;
  // A streaming call shows what it has written; between calls the saved
  // screen shows, so each edit of a skeleton-first build drafts in place.
  const source =
    preview?.status === "streaming" && preview.html
      ? preview.html
      : savedHtml || preview?.html || "";
  const html = useMemo(
    () => (source ? withLocalRuntimes(source) : ""),
    [source],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || canvasScale !== undefined) return;
    const update = () => setFitScale(surface.clientWidth / width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [canvasScale, width]);

  return (
    <div
      ref={surfaceRef}
      className={canvasScale === undefined ? "w-full" : undefined}
      style={
        canvasScale === undefined
          ? {
              maxWidth: `min(960px, calc((100vh - 240px) * ${width / height}))`,
            }
          : { width: width * canvasScale }
      }
    >
      <GeneratingFrame
        status={
          // A failed call never reads as finished, even while settling.
          preview?.status === "failed"
            ? "failed"
            : settling
              ? "done"
              : html
                ? "streaming"
                : "pending"
        }
        label={t("designEditor.generating")}
        className="[--agent-native-generating-accent:var(--design-editor-accent-color)]"
        surfaceClassName="rounded-md bg-[var(--design-editor-panel-bg)]"
        surfaceStyle={{ aspectRatio: `${width} / ${height}` }}
      >
        {html && scale > 0 ? (
          <StreamingHtmlFrame
            html={html}
            title={t("designEditor.generating")}
            baseHref={window.location.href}
            style={{
              width,
              height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        ) : undefined}
      </GeneratingFrame>
    </div>
  );
}
