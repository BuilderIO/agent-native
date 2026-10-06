import type { PlanBlock } from "@shared/plan-content";
import { useEffect, useMemo, useRef } from "react";

import {
  collectPlanTocItems,
  resolvePlanTocElements,
  type PlanTocItem,
} from "./PlanTableOfContents.utils";

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

const SETTLE_MS = 6000;
const TICK_MS = 100;
const STABLE_TICKS = 3;
const DRIFT_TOLERANCE = 4;

export function usePlanHashScroll(blocks: PlanBlock[]) {
  const items = useMemo(() => collectPlanTocItems(blocks), [blocks]);
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
      if (!target) return;

      const top = target.getBoundingClientRect().top;
      if (
        everScrolled &&
        alignedTop !== null &&
        Math.abs(top - alignedTop) <= DRIFT_TOLERANCE
      ) {
        if (++stableHits >= STABLE_TICKS) stop();
        return;
      }

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

    const onUserTakeOver = () => {
      userTookOver = true;
      stop();
    };
    const takeOverEvents = ["wheel", "touchmove", "keydown"] as const;
    takeOverEvents.forEach((type) =>
      window.addEventListener(type, onUserTakeOver, { passive: true }),
    );

    begin();
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
