import { useT } from "@agent-native/core/client";
import { IconCheck, IconCopy, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

interface TocItem {
  id: string;
  label: string;
  /** Heading depth: 2=top-level, 3=indented, 4=double-indented */
  level?: number;
  /** Legacy boolean alias — treated as level 3 when true */
  indent?: boolean;
}

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return window;
}

export function getActiveTocId(
  ids: string[],
  getElementById: (
    id: string,
  ) => Pick<HTMLElement, "getBoundingClientRect"> | null,
  offset = 120,
) {
  let active = ids[0] ?? "";
  for (const id of ids) {
    const el = getElementById(id);
    if (el && el.getBoundingClientRect().top <= offset) {
      active = id;
    } else if (el) {
      break;
    }
  }
  return active;
}

type MarkdownWriter = (text: string) => Promise<void> | void;

export async function copyMarkdownFromUrl(
  markdownUrl: string,
  writeText: MarkdownWriter = (text) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("Clipboard API is unavailable");
    }
    return navigator.clipboard.writeText(text);
  },
) {
  const response = await fetch(markdownUrl, {
    headers: {
      Accept: "text/markdown, text/plain;q=0.9, */*;q=0.1",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Markdown: ${response.status}`);
  }
  await writeText(await response.text());
}

/** Resolve indent depth (in multiples of 12px) from a TocItem. */
function indentDepth(item: TocItem): number {
  if (item.level && item.level >= 3) return item.level - 2; // h3→1, h4→2
  if (item.indent) return 1;
  return 0;
}

interface TableOfContentsProps {
  items: TocItem[];
  markdownUrl?: string;
}

export default function TableOfContents({
  items,
  markdownUrl,
}: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [isCopying, setIsCopying] = useState(false);
  const copyResetTimer = useRef<number | null>(null);
  const t = useT();

  useEffect(() => {
    return () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) {
      setActiveId("");
      return;
    }

    const OFFSET = 120;
    const MAX_BIND_ATTEMPTS = 5;
    let scrollTarget: HTMLElement | Window | null = null;
    let raf = 0;
    let retryTimer = 0;
    let bindAttempts = 0;

    const getActiveId = () =>
      getActiveTocId(ids, (id) => document.getElementById(id), OFFSET);

    const onScroll = () => {
      const next = getActiveId();
      setActiveId((prev) => (prev === next ? prev : next));
    };

    const bindScrollTarget = () => {
      const firstEl = document.getElementById(ids[0]);
      if (!firstEl && bindAttempts < MAX_BIND_ATTEMPTS) {
        bindAttempts += 1;
        retryTimer = window.setTimeout(bindScrollTarget, 50);
        return;
      }

      scrollTarget = findScrollParent(firstEl);
      setActiveId(getActiveId());
      scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    };

    raf = window.requestAnimationFrame(bindScrollTarget);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(retryTimer);
      scrollTarget?.removeEventListener("scroll", onScroll);
    };
  }, [items]);

  const resetCopyStatusSoon = () => {
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
    }
    copyResetTimer.current = window.setTimeout(() => {
      setCopyStatus("idle");
      copyResetTimer.current = null;
    }, 1600);
  };

  const handleCopyMarkdown = async () => {
    if (!markdownUrl || isCopying) return;
    setIsCopying(true);
    try {
      await copyMarkdownFromUrl(markdownUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    } finally {
      setIsCopying(false);
      resetCopyStatusSoon();
    }
  };

  const copyTooltip =
    copyStatus === "copied"
      ? t("docs.copiedMarkdown")
      : copyStatus === "error"
        ? t("docs.copyMarkdownError")
        : t("docs.copyMarkdown");

  return (
    <aside className="hidden w-[200px] shrink-0 xl:block">
      <nav className="sticky top-[65px] max-h-[calc(100vh-65px)] overflow-y-auto pb-8 pt-8 ps-4">
        <div className="mb-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs font-semibold text-[var(--fg-secondary)]">
            {t("docs.onThisPage")}
          </p>
          {markdownUrl ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("docs.copyMarkdown")}
                    disabled={isCopying}
                    onClick={handleCopyMarkdown}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg-secondary)] transition hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] disabled:cursor-wait disabled:opacity-60"
                  >
                    {copyStatus === "copied" ? (
                      <IconCheck className="size-3.5" />
                    ) : copyStatus === "error" ? (
                      <IconX className="size-3.5" />
                    ) : (
                      <IconCopy className="size-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">{copyTooltip}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        <ul className="list-none space-y-0 p-0">
          {items.map((item) => {
            const depth = indentDepth(item);
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`toc-link${activeId === item.id ? " is-active" : ""}`}
                  style={
                    depth > 0 ? { paddingInlineStart: 12 * depth } : undefined
                  }
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
