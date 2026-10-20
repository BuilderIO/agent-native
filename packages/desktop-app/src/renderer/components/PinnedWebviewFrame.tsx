import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Keeps a webview in one DOM parent for the whole session and lays it over
 * whichever slot currently shows it. Moving a `<webview>` to another parent
 * reloads its guest, and the tab slots mount and unmount as the layout
 * changes, so a webview that must outlive them cannot live inside them.
 */
export function PinnedWebviewFrame({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef(() => {});
  placeRef.current = () => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = slot?.isConnected ? slot.getBoundingClientRect() : null;
    const visible =
      !!slot &&
      !!rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(slot).visibility !== "hidden";
    // A hidden frame keeps its last size so the guest does not relayout.
    frame.style.visibility = visible ? "visible" : "hidden";
    frame.style.pointerEvents = visible ? "auto" : "none";
    if (!visible || !rect) return;
    frame.style.left = `${rect.left}px`;
    frame.style.top = `${rect.top}px`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;
  };

  // Tab switches and visibility class flips re-render the hub, not the slot.
  useLayoutEffect(() => placeRef.current());

  useLayoutEffect(() => {
    const place = () => placeRef.current();
    window.addEventListener("resize", place);
    const observer = slot ? new ResizeObserver(place) : null;
    if (slot) observer?.observe(slot);
    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [slot]);

  return (
    <div
      ref={frameRef}
      className="fixed inset-0"
      style={{ visibility: "hidden", pointerEvents: "none" }}
    >
      {children}
    </div>
  );
}
