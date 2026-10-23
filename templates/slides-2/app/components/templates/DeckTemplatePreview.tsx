import { useEffect, useRef, useState, type CSSProperties } from "react";

import { prepareImportedFonts } from "@/components/deck/SlideRenderer";

export function DeckTemplatePreview({
  html,
  title,
  width = 960,
  height = 540,
  stylesheetUrl,
}: {
  html: string;
  title: string;
  width?: number;
  height?: number;
  stylesheetUrl?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const { html: previewHtml, hrefs: fontHrefs } = prepareImportedFonts(html);
  const fontLinks = fontHrefs
    .map(
      (href) =>
        `<link rel="stylesheet" href="${href.replaceAll("&", "&amp;")}">`,
    )
    .join("");
  const fontPreconnects = fontHrefs.length
    ? '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    : "";
  const stylesheetLink = stylesheetUrl
    ? `<link rel="stylesheet" href="${stylesheetUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`
    : "";
  const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    ${stylesheetLink}${fontPreconnects}${fontLinks}
    <style>html,body{margin:0;overflow:hidden;width:${width}px;height:${height}px}</style>
  </head>
  <body><div data-slide-content-scope style="width:${width}px;height:${height}px;overflow:hidden">${previewHtml}</div></body>
</html>`;
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-video overflow-hidden bg-background"
    >
      <iframe
        title={title}
        srcDoc={srcDoc}
        sandbox=""
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        className="deck-template-preview-frame"
        style={
          {
            "--deck-template-scale": scale,
            width: `${width}px`,
            height: `${height}px`,
          } as CSSProperties
        }
      />
    </div>
  );
}
