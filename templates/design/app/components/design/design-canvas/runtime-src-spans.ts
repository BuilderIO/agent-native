import { parse } from "parse5";

import { memoizeByContent } from "../../../../shared/memoize-by-content";

function substitutable(src: string, pinned: RegExp, vendored: RegExp): boolean {
  const version = pinned.exec(src);
  return !version || vendored.test(version[1] ?? "");
}

function tailwindReplacement(src: string): boolean {
  if (!/tailwindcss\/browser/i.test(src)) return false;
  return substitutable(src, /@tailwindcss\/browser@(\d+)/i, /^4$/);
}

function alpineReplacement(src: string): boolean {
  if (/@alpinejs\//i.test(src)) return false;
  if (!/(^|[/@])alpinejs(@|\/|$)/i.test(src)) return false;
  return substitutable(src, /alpinejs@(\d+)/i, /^3$/);
}

export interface SrcSpan {
  start: number;
  end: number;
  runtime: "tailwind" | "alpine";
}

export function runtimeSrcSpansFromTree(root: unknown): SrcSpan[] {
  const spans: SrcSpan[] = [];

  const visit = (node: unknown) => {
    const element = node as {
      tagName?: string;
      attrs?: Array<{ name: string; value: string }>;
      childNodes?: unknown[];
      content?: { childNodes?: unknown[] };
      sourceCodeLocation?: {
        attrs?: Record<string, { startOffset: number; endOffset: number }>;
      } | null;
    };
    if (element.tagName === "script") {
      const src = element.attrs?.find((attr) => attr.name === "src")?.value;
      const at = element.sourceCodeLocation?.attrs?.src;
      if (src && at) {
        const runtime = tailwindReplacement(src)
          ? "tailwind"
          : alpineReplacement(src)
            ? "alpine"
            : null;
        if (runtime) {
          spans.push({ start: at.startOffset, end: at.endOffset, runtime });
        }
      }
    }
    for (const child of [
      ...(element.childNodes ?? []),
      ...(element.content?.childNodes ?? []),
    ]) {
      visit(child);
    }
  };
  visit(root);

  return spans.sort((left, right) => left.start - right.start);
}

export const runtimeSrcSpans = memoizeByContent(256, (html: string) =>
  runtimeSrcSpansFromTree(parse(html, { sourceCodeLocationInfo: true })),
);
