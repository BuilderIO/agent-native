import React, { useMemo, useState } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { cn } from "./utils.js";

export interface IframeEmbedProps {
  src?: string;
  aspect?: string;
  title?: string;
  height?: number;
}

const ALLOWED_ASPECTS = new Set(["16/9", "4/3", "1/1", "21/9", "3/2", "2/1"]);

function isSameOriginSrc(src: string): boolean {
  if (typeof window === "undefined") return false;
  const trimmed = src.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) {
    return false;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  try {
    const url = new URL(trimmed, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function aspectToPaddingBottom(aspect: string): string {
  const [w, h] = aspect.split("/").map((n) => Number(n.trim()));
  if (!w || !h) return "56.25%";
  return `${(h / w) * 100}%`;
}

/**
 * Parses the body of a ```embed fenced block. Accepts simple `key: value`
 * lines, ignoring blanks and unknown keys. No YAML — keeps the surface small.
 */
export function parseEmbedBody(body: string): Partial<IframeEmbedProps> {
  const out: Partial<IframeEmbedProps> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (key === "src") out.src = value;
    else if (key === "aspect") out.aspect = value;
    else if (key === "title") out.title = value;
    else if (key === "height") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out.height = n;
    }
  }
  return out;
}

function BlockedEmbed({ reason, src }: { reason: string; src?: string }) {
  return (
    <div className="my-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
      <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="font-medium text-foreground">Embed blocked</div>
        <div className="mt-0.5">{reason}</div>
        {src && (
          <div className="mt-1 font-mono text-[10px] truncate">{src}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline iframe embed for assistant chat. Rendered from a ```embed fenced
 * code block. Same-origin paths only; sandboxed.
 */
export function IframeEmbed({ src, aspect, title, height }: IframeEmbedProps) {
  const [loaded, setLoaded] = useState(false);
  const resolvedAspect =
    aspect && ALLOWED_ASPECTS.has(aspect) ? aspect : "16/9";
  const paddingBottom = useMemo(
    () => aspectToPaddingBottom(resolvedAspect),
    [resolvedAspect],
  );

  if (!src) {
    return <BlockedEmbed reason="Missing src" />;
  }
  if (!isSameOriginSrc(src)) {
    return <BlockedEmbed reason="Cross-origin URL not allowed" src={src} />;
  }

  const style: React.CSSProperties = height
    ? { height: `${height}px` }
    : { paddingBottom };

  return (
    <div
      className={cn(
        "my-2 rounded-lg border border-border overflow-hidden bg-muted/20 relative w-full",
      )}
      style={style}
    >
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-muted/40" />
      )}
      <iframe
        src={src}
        title={title || "Embedded content"}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="same-origin"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className="absolute inset-0 w-full h-full border-0 bg-transparent"
      />
    </div>
  );
}
