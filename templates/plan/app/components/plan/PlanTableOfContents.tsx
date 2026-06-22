import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PlanContent } from "@shared/plan-content";
import {
  collectPlanTocItems,
  getActivePlanTocId,
  resolvePlanTocElements,
  type PlanTocItem,
} from "./PlanTableOfContents.utils";

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  const planReader = el?.closest<HTMLElement>("[data-plan-reader]");
  if (planReader) return planReader;

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

function findDocumentFlow(nav: HTMLElement | null) {
  return nav?.closest<HTMLElement>(".plan-document-shell") ?? null;
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
