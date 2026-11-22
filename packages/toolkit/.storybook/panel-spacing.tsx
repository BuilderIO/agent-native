import { useLayoutEffect, useRef } from "react";

export function PanelSpacing() {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    const ctx = canvas.getContext("2d");
    if (!host || !ctx) return;
    const regions = ".design-property-inspector, .design-file-panel";
    const controls =
      ".input, .select-trigger, .segmented-control, .icon-button, .toggle, .workspace-share, .paint-editor-trigger, .design-property-inspector-transform";
    const observedPanels = new Set<Element>();
    let frame = 0;
    const paint = () => {
      frame = 0;
      const origin = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio;
      const width = Math.round(origin.width * ratio);
      const height = Math.round(origin.height * ratio);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, origin.width, origin.height);
      const panels = new Set(host.querySelectorAll(regions));
      for (const panel of observedPanels) {
        if (!panels.has(panel)) {
          sizes.unobserve(panel);
          observedPanels.delete(panel);
        }
      }
      for (const panel of panels) {
        if (!observedPanels.has(panel)) {
          sizes.observe(panel);
          observedPanels.add(panel);
        }
        const r = panel.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const style = getComputedStyle(panel);
        const rtl = style.direction === "rtl";
        const dark = style.colorScheme === "dark";
        const minor = dark ? "rgba(255,90,170,.10)" : "rgba(220,40,130,.09)";
        const major = dark ? "rgba(255,90,170,.22)" : "rgba(220,40,130,.20)";
        ctx.save();
        ctx.translate(r.x - origin.x, r.y - origin.y);
        ctx.beginPath();
        ctx.rect(0, 0, r.width, r.height);
        ctx.clip();
        for (let i = 0; i < Math.max(r.width, r.height); i += 8) {
          ctx.fillStyle = i % 32 ? minor : major;
          ctx.fillRect(rtl ? r.width - i - 1 : i, 0, 1, r.height);
          ctx.fillRect(0, i, r.width, 1);
        }
        const columns = new Set<number>();
        const file = panel.matches(".design-file-panel");
        if (file) {
          const header = panel.querySelector(
            ".design-file-panel-header, .design-file-panel-section-header",
          );
          if (header) {
            const inset = parseFloat(
              getComputedStyle(header).paddingInlineStart,
            );
            const step = parseFloat(
              style.getPropertyValue("--sb-layer-column-step"),
            );
            if (step > 0) {
              for (
                let offset = inset;
                offset < r.width - inset;
                offset += step
              ) {
                columns.add(rtl ? r.width - offset : offset);
              }
            }
            columns.add(rtl ? inset : r.width - inset);
          }
        }
        for (const node of panel.querySelectorAll(
          controls +
            ", .segmented-control-item, .inspector-section-header, .layer-tree-row, .design-file-panel-section-header",
        )) {
          const box = node.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          const x = Math.round(box.left - r.left),
            y = Math.round(box.top - r.top);
          const w = Math.round(box.width),
            h = Math.round(box.height);
          const control = node.matches(controls);
          const insetPart = node.parentElement?.closest(controls);
          const collaboration = node.closest(
            ".design-property-inspector-collaboration",
          );
          if (!file && control && !insetPart && !collaboration) {
            columns.add(x);
            columns.add(x + w);
          }
          if (box.bottom <= r.top || box.top >= r.bottom) continue;
          const inlineStart = rtl ? Math.round(r.right - box.right) : x;
          const off =
            !node.matches(".segmented-control-item") &&
            (inlineStart % 4 || h % 4 || (control && w % 4));
          ctx.strokeStyle = off
            ? "darkorange"
            : dark
              ? "rgba(255,90,170,.45)"
              : "rgba(220,40,130,.38)";
          ctx.lineWidth = off ? 1.5 : 1;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          if (off) {
            ctx.fillStyle = ctx.strokeStyle;
            ctx.font = "10px monospace";
            ctx.fillText(w + "×" + h + " @" + inlineStart, x, y - 1);
          }
        }
        ctx.fillStyle = dark ? "rgba(90,170,255,.55)" : "rgba(20,110,220,.45)";
        for (const x of columns) ctx.fillRect(x, 0, 1, r.height);
        ctx.restore();
      }
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(paint);
    }
    const sizes = new ResizeObserver(schedule);
    sizes.observe(host);
    const changes = new MutationObserver((records) => {
      if (records.some((record) => record.target !== canvas)) schedule();
    });
    changes.observe(host, { subtree: true, childList: true, attributes: true });
    const stage = host.closest("[data-storybook-stage]");
    if (stage) changes.observe(stage, { attributes: true });
    host.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    paint();
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      sizes.disconnect();
      host.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-panel-spacing=""
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
      }}
    />
  );
}
