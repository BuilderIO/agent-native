import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
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

function resetTocTargets(root: HTMLElement) {
  root
    .querySelectorAll<HTMLElement>("[data-plan-toc-target]")
    .forEach((target) => {
      target.removeAttribute("id");
      target.removeAttribute("data-plan-toc-target");
    });
}

function assignPlanTocTargets(root: HTMLElement, items: PlanTocItem[]) {
  resetTocTargets(root);
  // TOC items and rendered elements share document order, so heading items map
  // to document headings positionally and block items map by their block id.
  const headings = documentHeadingElements(root);
  let headingCursor = 0;

  for (const item of items) {
    let target: HTMLElement | null = null;
    if (item.kind === "block") {
      target = findBlockElement(root, item.blockId);
    } else {
      target = headings[headingCursor] ?? null;
      headingCursor += 1;
    }
    if (!target) continue;
    target.id = item.id;
    target.setAttribute("data-plan-toc-target", "");
  }
}

export function PlanTableOfContents({ content }: { content: PlanContent }) {
  if (typeof window !== "undefined") {
    (window as unknown as { __planTocBuild?: number }).__planTocBuild = 7;
  }
  const navRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState("");
  const items = useMemo(
    () => collectPlanTocItems(content.blocks),
    [content.blocks],
  );

  // Keep TOC anchors in sync with the asynchronously-mounted document editor.
  useEffect(() => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) {
      setActiveId("");
      return;
    }

    const OFFSET = 140;
    const MAX_ROOT_ATTEMPTS = 30;
    let scrollTarget: HTMLElement | Window | null = null;
    let mutationObserver: MutationObserver | null = null;
    let rootRaf = 0;
    let syncRaf = 0;
    let scrollRaf = 0;
    let rootAttempts = 0;

    const getActiveId = () =>
      getActivePlanTocId(
        ids,
        (id) => document.getElementById(id),
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

    // Assign ids to the rendered headings/blocks, then bind the scroll listener
    // once a target exists. The document editor (Tiptap) mounts asynchronously,
    // so this can run several times before the headings appear in the DOM.
    const sync = (root: HTMLElement) => {
      assignPlanTocTargets(root, items);
      if (!scrollTarget) {
        const firstEl = document.getElementById(ids[0]);
        if (firstEl) {
          scrollTarget = findScrollParent(firstEl);
          scrollTarget.addEventListener("scroll", scheduleUpdateActiveId, {
            passive: true,
          });
        }
      }
      updateActiveId();
    };

    const scheduleSync = (root: HTMLElement) => {
      if (syncRaf) return;
      syncRaf = window.requestAnimationFrame(() => {
        syncRaf = 0;
        sync(root);
      });
    };

    const start = () => {
      const root = findDocumentFlow(navRef.current);
      if (!root) {
        if (rootAttempts < MAX_ROOT_ATTEMPTS) {
          rootAttempts += 1;
          rootRaf = window.requestAnimationFrame(start);
        }
        return;
      }
      // Re-sync whenever the document subtree changes (editor mount, block
      // inserts, async rendering) so targets and the active item stay correct.
      mutationObserver = new MutationObserver(() => scheduleSync(root));
      mutationObserver.observe(root, { childList: true, subtree: true });
      sync(root);
    };

    rootRaf = window.requestAnimationFrame(start);

    return () => {
      window.cancelAnimationFrame(rootRaf);
      window.cancelAnimationFrame(syncRaf);
      window.cancelAnimationFrame(scrollRaf);
      mutationObserver?.disconnect();
      scrollTarget?.removeEventListener("scroll", scheduleUpdateActiveId);
    };
  }, [items]);

  if (items.length < 2) return null;

  return (
    <aside className="plan-document-toc" aria-label="Plan sections">
      <nav ref={navRef} className="plan-document-toc__nav">
        <p className="plan-document-toc__heading">On this plan</p>
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
                  const target = document.getElementById(item.id);
                  if (!target) return;
                  event.preventDefault();
                  target.scrollIntoView({
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "auto"
                      : "smooth",
                    block: "start",
                  });
                  window.history.replaceState(null, "", `#${item.id}`);
                  setActiveId(item.id);
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
