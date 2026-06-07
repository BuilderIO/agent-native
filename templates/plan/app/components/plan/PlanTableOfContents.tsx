import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PlanContent } from "@shared/plan-content";
import {
  collectPlanTocItems,
  getActivePlanTocId,
  type PlanHeadingTocItem,
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

function headingElementsForBlock(root: HTMLElement, item: PlanHeadingTocItem) {
  const blockEl = findBlockElement(root, item.blockId);
  if (blockEl) {
    return Array.from(
      blockEl.querySelectorAll<HTMLElement>(
        ".an-rich-md-prose > h1, .an-rich-md-prose > h2, .an-rich-md-prose > h3",
      ),
    );
  }

  return Array.from(
    root.querySelectorAll<HTMLElement>(
      ".plan-document-editor .an-rich-md-prose > h1, .plan-document-editor .an-rich-md-prose > h2, .plan-document-editor .an-rich-md-prose > h3",
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
  let fallbackHeadingIndex = 0;
  const fallbackHeadings = Array.from(
    root.querySelectorAll<HTMLElement>(
      ".plan-document-editor .an-rich-md-prose > h1, .plan-document-editor .an-rich-md-prose > h2, .plan-document-editor .an-rich-md-prose > h3",
    ),
  ).filter((heading) => !heading.closest(".plan-block-node"));

  for (const item of items) {
    let target: HTMLElement | null = null;
    if (item.kind === "block") {
      target = findBlockElement(root, item.blockId);
    } else {
      const headings = headingElementsForBlock(root, item);
      target =
        headings[item.headingIndex ?? 0] ??
        fallbackHeadings[fallbackHeadingIndex] ??
        null;
      fallbackHeadingIndex += 1;
    }
    if (!target) continue;
    target.id = item.id;
    target.setAttribute("data-plan-toc-target", "");
  }
}

export function PlanTableOfContents({ content }: { content: PlanContent }) {
  const navRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState("");
  const items = useMemo(
    () => collectPlanTocItems(content.blocks),
    [content.blocks],
  );

  useEffect(() => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) {
      setActiveId("");
      return;
    }

    const OFFSET = 180;
    const MAX_BIND_ATTEMPTS = 8;
    let scrollTarget: HTMLElement | Window | null = null;
    let mutationObserver: MutationObserver | null = null;
    let raf = 0;
    let retryTimer = 0;
    let scrollRaf = 0;
    let bindAttempts = 0;

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

    const syncTargets = () => {
      const root = findDocumentFlow(navRef.current);
      if (!root) return false;
      assignPlanTocTargets(root, items);
      updateActiveId();
      return true;
    };

    const bindScrollTarget = () => {
      const synced = syncTargets();
      const firstEl = document.getElementById(ids[0]);
      if ((!synced || !firstEl) && bindAttempts < MAX_BIND_ATTEMPTS) {
        bindAttempts += 1;
        retryTimer = window.setTimeout(bindScrollTarget, 80);
        return;
      }

      if (!firstEl) return;
      scrollTarget = findScrollParent(firstEl);
      scrollTarget.addEventListener("scroll", scheduleUpdateActiveId, {
        passive: true,
      });

      const root = findDocumentFlow(navRef.current);
      if (root) {
        mutationObserver = new MutationObserver(() => {
          window.cancelAnimationFrame(raf);
          raf = window.requestAnimationFrame(syncTargets);
        });
        mutationObserver.observe(root, { childList: true, subtree: true });
      }
    };

    raf = window.requestAnimationFrame(bindScrollTarget);

    return () => {
      window.cancelAnimationFrame(raf);
      window.cancelAnimationFrame(scrollRaf);
      window.clearTimeout(retryTimer);
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
