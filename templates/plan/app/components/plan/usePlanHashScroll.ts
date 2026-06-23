import { useEffect, useMemo, useRef } from "react";
import type { PlanBlock } from "@shared/plan-content";
import {
  collectPlanTocItems,
  resolvePlanTocElements,
  type PlanTocItem,
} from "./PlanTableOfContents.utils";

// Query the whole shell (not via the TOC nav) so deep links still resolve when
// the contents rail is hidden and when wide blocks render in a breakout flow.
function findDocumentRoot(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(".plan-document-shell") ??
    document.querySelector<HTMLElement>(".plan-document-flow")
  );
}

function readHashTarget(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ""));
  } catch {
    return window.location.hash.replace(/^#/, "");
  }
}

// Settle-window tuning.
const SETTLE_MS = 6000; // hard cap; re-pinning stops earlier once stable
const TICK_MS = 100;
const STABLE_TICKS = 3; // ≈300ms on-target before we stop
const DRIFT_TOLERANCE = 4; // px slack for sub-pixel jitter

/**
 * Scroll a plan to the `#plan-heading-…` / `#plan-section-…` section in the URL
 * on initial load, reload, and browser back/forward — paths the TOC's own click
 * handler doesn't cover.
 *
 * Two complications beyond a native anchor jump: the editor mounts async (the
 * heading isn't there yet, and editable-view ids are lazy), and heavy blocks
 * below the fold grow the document afterwards, shoving an already-scrolled
 * target back out of view. So we re-resolve like the TOC does and re-pin on a
 * short poll until the target stops drifting (or the user scrolls).
 */
export function usePlanHashScroll(blocks: PlanBlock[]) {
  const items = useMemo(() => collectPlanTocItems(blocks), [blocks]);
  // Read latest items from the mount-only effect without re-running it (and
  // re-scrolling) on every content poll.
  const itemsRef = useRef<PlanTocItem[]>(items);
  itemsRef.current = items;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let intervalId = 0;
    let deadlineId = 0;
    let userTookOver = false;
    let everScrolled = false;
    let alignedTop: number | null = null;
    let stableHits = 0;

    const itemFor = (id: string) =>
      itemsRef.current.find((item) => item.id === id) ?? null;

    const stop = () => {
      window.clearInterval(intervalId);
      window.clearTimeout(deadlineId);
      intervalId = 0;
      deadlineId = 0;
    };

    // Resolve like the TOC does; null while the section is still mounting. Also
    // writes a stable id so native back/forward keeps working in read-only view.
    const resolveTarget = (): HTMLElement | null => {
      const id = readHashTarget();
      const item = itemFor(id);
      if (!item) return null;
      const root = findDocumentRoot();
      if (!root) return null;
      const target = resolvePlanTocElements(root, [item]).get(id) ?? null;
      if (target && !target.id) target.id = id;
      return target;
    };

    const tick = () => {
      if (userTookOver) return stop();
      const target = resolveTarget();
      if (!target) return; // still mounting — keep polling

      const top = target.getBoundingClientRect().top;
      if (
        everScrolled &&
        alignedTop !== null &&
        Math.abs(top - alignedTop) <= DRIFT_TOLERANCE
      ) {
        // Stable since the last pin; stop once it holds for a few ticks.
        if (++stableHits >= STABLE_TICKS) stop();
        return;
      }

      // First pin, or drifted as content grew — (re)align and reset.
      target.scrollIntoView({ behavior: "auto", block: "start" });
      everScrolled = true;
      stableHits = 0;
      alignedTop = target.getBoundingClientRect().top;
    };

    const begin = () => {
      stop();
      if (!itemFor(readHashTarget())) return;
      userTookOver = false;
      everScrolled = false;
      alignedTop = null;
      stableHits = 0;
      tick();
      intervalId = window.setInterval(tick, TICK_MS);
      deadlineId = window.setTimeout(stop, SETTLE_MS);
    };

    // A real user scroll cancels pinning; programmatic scroll fires `scroll`,
    // not these, so it can't trip this.
    const onUserTakeOver = () => {
      userTookOver = true;
      stop();
    };
    const takeOverEvents = ["wheel", "touchmove", "keydown"] as const;
    takeOverEvents.forEach((type) =>
      window.addEventListener(type, onUserTakeOver, { passive: true }),
    );

    begin();
    // `popstate` covers back/forward to pushState'd hashes (which skip
    // `hashchange`); `begin` no-ops when the hash isn't a known section.
    window.addEventListener("hashchange", begin);
    window.addEventListener("popstate", begin);

    return () => {
      window.removeEventListener("hashchange", begin);
      window.removeEventListener("popstate", begin);
      takeOverEvents.forEach((type) =>
        window.removeEventListener(type, onUserTakeOver),
      );
      stop();
    };
  }, []);
}
