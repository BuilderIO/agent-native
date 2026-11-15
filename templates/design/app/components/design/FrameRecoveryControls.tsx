import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Canvas selection hit surfaces cover the page; recovery controls belong above them. */
export function FrameRecoveryControls({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [bounds, setBounds] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!active || !anchorRef.current) return;
    const anchor = anchorRef.current;
    const update = () => {
      const frame = anchor.getBoundingClientRect();
      const canvas = anchor
        .closest("[data-multi-screen-canvas-surface]")
        ?.getBoundingClientRect();
      const left = Math.max(frame.left, canvas?.left ?? 0) + 8;
      const top = Math.max(frame.top, canvas?.top ?? 0) + 8;
      const right =
        Math.min(frame.right, canvas?.right ?? window.innerWidth) - 8;
      const bottom = Math.min(
        frame.bottom,
        canvas?.bottom ?? window.innerHeight,
      );
      const next =
        right > left && bottom > top
          ? { left, top, width: right - left }
          : null;
      setBounds((previous) =>
        previous?.left === next?.left &&
        previous?.top === next?.top &&
        previous?.width === next?.width
          ? previous
          : next,
      );
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(anchor);
    const mutation = new MutationObserver(update);
    for (
      let parent = anchor.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      mutation.observe(parent, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active]);
  return (
    <>
      <span ref={anchorRef} className="pointer-events-none absolute inset-0" />
      {active && bounds
        ? createPortal(
            <div
              data-design-frame-recovery-controls
              className="pointer-events-auto fixed"
              style={{
                left: bounds.left,
                top: bounds.top,
                maxWidth: bounds.width,
                zIndex: 1000001,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
