import { useEffect, useMemo, useRef, useState } from "react";
import { IconList } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { PlanContent } from "@shared/plan-content";
import {
  collectPlanTocItems,
  getActivePlanTocId,
  type PlanTocItem,
} from "./PlanTableOfContents.utils";

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

function escapeAttributeValue(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findDocumentFlow(nav: HTMLElement | null) {
  return (
    nav
      ?.closest(".plan-document-shell")
      ?.querySelector<HTMLElement>(".plan-document-flow") ?? null
  );
}

function findBlockElement(root: HTMLElement, blockId: string) {
  return root.querySelector<HTMLElement>(
    `[data-block-id="${escapeAttributeValue(blockId)}"]`,
  );
}

function documentHeadingElements(root: HTMLElement) {
  // Section headings render as direct children of the document body prose. In
  // editable mode that body is a single merged Tiptap editor; in read-only mode
  // each rich-text block renders its own prose. In both cases the headings
  // appear in document order, and headings nested inside a custom block NodeView
  // (`.plan-block-node`) are block content, not document sections.
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      ".an-rich-md-prose > h1, .an-rich-md-prose > h2, .an-rich-md-prose > h3",
    ),
  ).filter((heading) => !heading.closest(".plan-block-node"));
}

function resolvePlanTocElements(root: HTMLElement, items: PlanTocItem[]) {
  // Map each TOC item to its rendered element WITHOUT mutating the DOM. Heading
  // items and document headings share document order, so they map positionally;
  // block items map by their block id. We deliberately avoid writing ids onto
  // editor-managed nodes — the document editor (Tiptap/ProseMirror) reconciles
  // its own DOM and would fight any attributes we add, so anchoring is done
  // against live element references instead.
  const headings = documentHeadingElements(root);
  let headingCursor = 0;
  const map = new Map<string, HTMLElement>();

  for (const item of items) {
    let target: HTMLElement | null = null;
    if (item.kind === "block") {
      target = findBlockElement(root, item.blockId);
    } else {
      target = headings[headingCursor] ?? null;
      headingCursor += 1;
    }
    if (target) map.set(item.id, target);
  }
  return map;
}

export function PlanTableOfContents({
  content,
  isRecap = false,
  omitBlockId,
}: {
  content: PlanContent;
  isRecap?: boolean;
  /**
   * A block whose anchor should be dropped from the contents — e.g. the recap
   * "Files touched" block, which on wide screens is relocated to a permanent
   * left sidebar (outside `.plan-document-flow`), so a contents link to it would
   * resolve to a hidden, unscrollable element.
   */
  omitBlockId?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [activeId, setActiveId] = useState("");
  const items = useMemo(
    () =>
      collectPlanTocItems(content.blocks).filter(
        (item) => item.blockId !== omitBlockId,
      ),
    [content.blocks, omitBlockId],
  );

  // Keep the item -> element map and the active section in sync with the
  // asynchronously-mounted document editor, reading the DOM only.
  useEffect(() => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) {
      elementsRef.current = new Map();
      setActiveId("");
      return;
    }

    const OFFSET = 140;
    const MAX_ROOT_ATTEMPTS = 30;
    let scrollTarget: HTMLElement | Window | null = null;
    let mutationObserver: MutationObserver | null = null;
    let rootTimer = 0;
    let syncTimer = 0;
    let scrollRaf = 0;
    let rootAttempts = 0;

    const getActiveId = () =>
      getActivePlanTocId(
        ids,
        (id) => elementsRef.current.get(id) ?? null,
        OFFSET,
        scrollTarget instanceof HTMLElement ? scrollTarget : null,
      );

    const updateActiveId = () => {
      const next = getActiveId();
      setActiveId((prev) => (prev === next ? prev : next));
    };

    const scheduleUpdateActiveId = () => {
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0;
        updateActiveId();
      });
    };

    // Resolve element references, then bind the scroll listener once a target
    // exists. The editor mounts asynchronously, so this re-resolves on every
    // document mutation until the headings appear.
    const sync = (root: HTMLElement) => {
      elementsRef.current = resolvePlanTocElements(root, items);
      if (!scrollTarget) {
        const firstEl = elementsRef.current.get(ids[0]);
        if (firstEl) {
          scrollTarget = findScrollParent(firstEl);
          scrollTarget.addEventListener("scroll", scheduleUpdateActiveId, {
            passive: true,
          });
        }
      }
      updateActiveId();
    };

    // Debounce with setTimeout (not requestAnimationFrame, which is paused in
    // background tabs) to coalesce the editor's mutation bursts. Because sync
    // never writes to the editor DOM, this cannot feed back into the observer.
    const scheduleSync = (root: HTMLElement) => {
      if (syncTimer) return;
      syncTimer = window.setTimeout(() => {
        syncTimer = 0;
        sync(root);
      }, 120);
    };

    const start = () => {
      const root = findDocumentFlow(navRef.current);
      if (!root) {
        // The document flow shares this render, so it is normally present
        // immediately; retry briefly in case of an SSR/hydration gap.
        if (rootAttempts < MAX_ROOT_ATTEMPTS) {
          rootAttempts += 1;
          rootTimer = window.setTimeout(start, 50);
        }
        return;
      }
      mutationObserver = new MutationObserver(() => scheduleSync(root));
      mutationObserver.observe(root, { childList: true, subtree: true });
      sync(root);
    };

    start();

    return () => {
      window.clearTimeout(rootTimer);
      window.clearTimeout(syncTimer);
      window.cancelAnimationFrame(scrollRaf);
      mutationObserver?.disconnect();
      scrollTarget?.removeEventListener("scroll", scheduleUpdateActiveId);
    };
  }, [items]);

  if (items.length < 2) return null;

  return (
    <aside className="plan-document-toc" aria-label="Plan sections">
      <nav ref={navRef} className="plan-document-toc__nav">
        <p className="plan-document-toc__heading">
          {isRecap ? "On this recap" : "On this plan"}
        </p>
        <ol className="plan-document-toc__list">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={activeId === item.id ? "true" : undefined}
                className={cn(
                  "plan-document-toc__link",
                  activeId === item.id && "is-active",
                  item.level > 0 && "is-nested",
                )}
                onClick={(event) => {
                  const target = elementsRef.current.get(item.id);
                  if (!target) return;
                  event.preventDefault();
                  // Set a stable `id` on the target element so the browser's
                  // native hash-navigation (and back/forward) works. We write
                  // it lazily here rather than during DOM setup to avoid
                  // fighting the Tiptap editor's own reconcile passes.
                  if (!target.id) target.id = item.id;
                  target.scrollIntoView({
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "auto"
                      : "smooth",
                    block: "start",
                  });
                  setActiveId(item.id);
                  // Update the URL hash so the deep link is shareable and the
                  // browser back-button returns to this section.
                  try {
                    history.pushState(null, "", `#${item.id}`);
                  } catch {
                    // Sandboxed or cross-origin — ignore.
                  }
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}

/**
 * Compact floating "On this plan" button that appears in the bottom-right
 * corner of the document area on viewports narrower than 1400px (where the
 * full sidebar TOC is hidden). Only rendered when the plan has 3+ sections.
 * The button opens a Popover listing the same TOC entries; clicking any entry
 * scrolls to that section using the same element-resolution logic as the
 * desktop TOC.
 */
export function PlanTocFallback({
  content,
  isRecap = false,
  omitBlockId,
}: {
  content: PlanContent;
  isRecap?: boolean;
  omitBlockId?: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [open, setOpen] = useState(false);
  const items = useMemo(
    () =>
      collectPlanTocItems(content.blocks).filter(
        (item) => item.blockId !== omitBlockId,
      ),
    [content.blocks, omitBlockId],
  );

  // Resolve element map lazily when the popover opens (the document is
  // already mounted by then, so we don't need the full mutation-observer
  // retry loop that the sidebar TOC uses).
  useEffect(() => {
    if (!open) return;
    const nav = anchorRef.current;
    if (!nav) return;
    const root =
      nav
        .closest(".plan-document-shell")
        ?.querySelector<HTMLElement>(".plan-document-flow") ?? null;
    if (!root) return;

    const headings = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".an-rich-md-prose > h1, .an-rich-md-prose > h2, .an-rich-md-prose > h3",
      ),
    ).filter((heading) => !heading.closest(".plan-block-node"));

    let headingCursor = 0;
    const map = new Map<string, HTMLElement>();
    for (const item of items) {
      let target: HTMLElement | null = null;
      if (item.kind === "block") {
        target =
          root.querySelector<HTMLElement>(
            `[data-block-id="${CSS.escape(item.blockId)}"]`,
          ) ?? null;
      } else {
        target = headings[headingCursor] ?? null;
        headingCursor += 1;
      }
      if (target) map.set(item.id, target);
    }
    elementsRef.current = map;
  }, [open, items]);

  // Fewer than 3 sections — not worth a button.
  if (items.length < 3) return null;

  const scrollTo = (item: PlanTocItem) => {
    const target = elementsRef.current.get(item.id);
    if (!target) return;
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    setOpen(false);
  };

  return (
    // Wrapper sits in the normal document flow (not fixed/absolute) but the
    // button itself is sticky so it stays visible while the user scrolls.
    // display:none is applied above 1400px via global.css so it never
    // overlaps the full sidebar TOC.
    <div ref={anchorRef} className="plan-toc-fallback">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="plan-toc-fallback__btn h-8 gap-1.5 rounded-full border-border/80 bg-background/90 px-3 text-xs font-medium shadow-md backdrop-blur-sm"
            aria-label={isRecap ? "On this recap" : "On this plan"}
          >
            <IconList className="size-3.5" />
            {isRecap ? "On this recap" : "On this plan"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-56 rounded-xl p-2"
        >
          <p className="plan-document-toc__heading mb-2 px-2">
            {isRecap ? "On this recap" : "On this plan"}
          </p>
          <ol className="space-y-0.5">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(
                    "block w-full rounded-lg px-2 py-1.5 text-left text-sm leading-5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    item.level > 0 && "pl-5",
                  )}
                  onClick={() => scrollTo(item)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
        </PopoverContent>
      </Popover>
    </div>
  );
}
