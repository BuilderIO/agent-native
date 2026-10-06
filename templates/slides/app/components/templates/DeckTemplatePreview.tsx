import { useEffect, useRef, useState, type CSSProperties } from "react";

import { prepareImportedFonts } from "@/components/deck/SlideRenderer";

export function DeckTemplatePreview({
  html,
  title,
}: {
  html: string;
  title: string;
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
  const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    ${fontPreconnects}${fontLinks}
    <style>html,body{margin:0;overflow:hidden;width:960px;height:540px}</style>
  </head>
  <body>${previewHtml}</body>
</html>`;
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / 960);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
        style={{ "--deck-template-scale": scale } as CSSProperties}
      />
    </div>
  );
}
