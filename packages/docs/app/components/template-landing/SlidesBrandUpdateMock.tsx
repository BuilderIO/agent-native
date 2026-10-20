/**
 * Static, decorative recreation of a saved design system applied to a business
 * update slide — the swatch and type row from the Design systems card above the
 * slide it produces — used as the art for the "Share business updates"
 * use-case row on the Slides landing page.
 *
 * Showing the system and its output together is the whole point: the claim is
 * that recurring updates come out on-brand without being restyled by hand, and
 * a slide on its own cannot make that claim.
 *
 * The slide overrides the deck's default `--ds-*` values with this system's
 * palette, which is exactly the mechanism the real renderer uses — the same
 * layout component, different injected custom properties.
 *
 * All CSS lives here, scoped under `.slides-brand-mock`. The real Slides
 * stylesheet is deliberately NOT imported: it declares `:root`/`html`/`body`
 * palette rules that would reskin the whole docs site. The card is flat on
 * purpose, matching the other use-case rows.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (a fake brand and a fake update slide).
 */
import { IconCircleCheck } from "@tabler/icons-react";

import {
  SLIDE_ARTWORK_CSS,
  UpdateSlide,
  VarScaledSlide,
} from "./SlidesDeckArtwork";

const BRAND_SWATCHES = ["#1b2a4a", "#c2410c", "#f0b429", "#e8e2d6", "#ffffff"];

const SLIDES_BRAND_MOCK_CSS = [
  ".slides-brand-mock { position: relative; width: 100%; }",
  ".slides-brand-mock, .slides-brand-mock * { box-sizing: border-box; }",
  ".slides-brand-mock-frame { display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; background: var(--brand-window-bg); border: 1px solid var(--brand-window-border); font-family: 'Inter Variable', 'Inter', system-ui, -apple-system, sans-serif; }",

  ".slides-brand-mock { --brand-window-bg: hsl(0 0% 13%); --brand-workspace-bg: hsl(0 0% 10%); --brand-window-border: hsl(0 0% 24%); --brand-fg: hsl(0 0% 93%); --brand-fg-muted: hsl(0 0% 55%); }",

  ".slides-brand-mock-system { display: flex; flex-shrink: 0; align-items: center; gap: 12px; padding: 14px 16px; }",
  ".slides-brand-mock-swatches { display: flex; flex-shrink: 0; align-items: center; }",
  ".slides-brand-mock-swatch { width: 24px; height: 24px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18); }",
  ".slides-brand-mock-swatch + .slides-brand-mock-swatch { margin-left: -6px; }",
  ".slides-brand-mock-meta { display: flex; min-width: 0; flex-direction: column; gap: 2px; }",
  ".slides-brand-mock-name { overflow: hidden; color: var(--brand-fg); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }",
  ".slides-brand-mock-fonts { overflow: hidden; color: var(--brand-fg-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }",
  ".slides-brand-mock-badge { display: flex; flex-shrink: 0; align-items: center; gap: 5px; margin-left: auto; padding: 4px 9px; border: 1px solid var(--brand-window-border); border-radius: 999px; color: var(--brand-fg-muted); font-size: 11px; }",

  ".slides-brand-mock-workspace { --sd-scale: 0.45; display: flex; justify-content: center; overflow: hidden; padding: 24px; border-top: 1px solid var(--brand-window-border); background: var(--brand-workspace-bg); }",
  ".slides-brand-mock-workspace .sd-slide-box { border-radius: 2px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.07); }",

  "html.light .slides-brand-mock { --brand-window-bg: hsl(0 0% 100%); --brand-workspace-bg: hsl(0 0% 96%); --brand-window-border: hsl(0 0% 90%); --brand-fg: hsl(0 0% 10%); --brand-fg-muted: hsl(0 0% 46%); }",
  "html.light .slides-brand-mock .slides-brand-mock-workspace .sd-slide-box { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.22); }",

  SLIDE_ARTWORK_CSS,

  ".slides-brand-mock-workspace .sd-slide-box, .slides-brand-mock-workspace .sd-slide { --ds-bg: #141a2a; --ds-text: #f6f2ea; --ds-text-muted: rgba(246, 242, 234, 0.7); --ds-accent: #f97316; --ds-surface: rgba(255, 255, 255, 0.07); }",
  "html.light .slides-brand-mock-workspace .sd-slide-box, html.light .slides-brand-mock-workspace .sd-slide { --ds-bg: #fbf8f1; --ds-text: #1b2a4a; --ds-text-muted: #5a6478; --ds-accent: #c2410c; --ds-surface: #ffffff; }",

  "@media (max-width: 1320px) { .slides-brand-mock-workspace { --sd-scale: 0.4; } }",
  "@media (max-width: 560px) { .slides-brand-mock-workspace { --sd-scale: 0.29; padding: 16px; } }",
].join("\n");

export function SlidesBrandUpdateMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`slides-brand-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{SLIDES_BRAND_MOCK_CSS}</style>
      <div className="slides-brand-mock-frame" aria-hidden="true">
        <div className="slides-brand-mock-system">
          <span className="slides-brand-mock-swatches">
            {BRAND_SWATCHES.map((color) => (
              <span
                key={color}
                className="slides-brand-mock-swatch"
                style={{ background: color }}
              />
            ))}
          </span>
          <span className="slides-brand-mock-meta">
            <span className="slides-brand-mock-name">Northwind Brand</span>
            <span className="slides-brand-mock-fonts">
              Söhne · Inter · 2 logos
            </span>
          </span>
          <span className="slides-brand-mock-badge">
            <IconCircleCheck size={13} />
            Applied
          </span>
        </div>
        <div className="slides-brand-mock-workspace">
          <VarScaledSlide>
            <UpdateSlide />
          </VarScaledSlide>
        </div>
      </div>
    </div>
  );
}
