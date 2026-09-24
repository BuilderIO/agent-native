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
    const nextColumn = container.querySelector<HTMLElement>(".notion-editor");
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
  // The editor can mount after the lane, or be replaced when collaboration starts.
  const mountObserver = new MutationObserver(schedule);
  mountObserver.observe(container, { childList: true, subtree: true });
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
