import { inHiddenBlockFieldPanel } from "./blockFieldTabs";

// Blocks field tabs keep every editor mounted and hide the closed ones, so the
// reading column is the first editor that isn't in a hidden panel.
function visibleReadingColumn(container: HTMLElement): HTMLElement | null {
  for (const column of container.querySelectorAll<HTMLElement>(
    ".content-editor",
  )) {
    if (!inHiddenBlockFieldPanel(column)) return column;
  }
  return null;
}

export function observeCommentLane(
  container: HTMLElement,
  lane: HTMLElement,
  onOffset: (offset: number) => void,
): () => void {
  let readingColumn: HTMLElement | null = null;
  let frame = 0;
  let disposed = false;

  const update = () => {
    if (disposed || !lane.isConnected || !container.isConnected) return;
    const nextColumn = visibleReadingColumn(container);
    if (nextColumn !== readingColumn) {
      if (readingColumn) resizeObserver?.unobserve(readingColumn);
      readingColumn = nextColumn;
      if (readingColumn) resizeObserver?.observe(readingColumn);
    }
    if (!readingColumn) return;
    const laneLeft = lane.getBoundingClientRect().left;
    const readingRight = readingColumn.getBoundingClientRect().right;
    onOffset(Math.min(0, readingRight - laneLeft));
  };

  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  resizeObserver?.observe(container);
  resizeObserver?.observe(lane);
  const mountObserver = new MutationObserver(schedule);
  mountObserver.observe(container, {
    attributeFilter: ["hidden"],
    childList: true,
    subtree: true,
  });
  window.addEventListener("resize", schedule);
  update();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    mountObserver.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", schedule);
  };
}
