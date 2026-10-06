/**
 * Static, decorative recreation of one generated plan slide open on the editor
 * canvas with the contextual slide toolbar above it — used as the art for the
 * "Present plans and strategies" use-case row on the Slides landing page.
 *
 * The toolbar is the point of the picture: the neighbouring card already shows
 * the agent generating a deck, so this one has to show that what comes out is a
 * real editable slide rather than an export.
 *
 * All CSS lives here, scoped under `.slides-strategy-mock`. The real Slides
 * stylesheet is deliberately NOT imported: it declares `:root`/`html`/`body`
 * palette rules that would reskin the whole docs site. The card is flat on
 * purpose, matching the other use-case rows, which sit directly on the section
 * background.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (a fake roadmap slide).
 */
import {
  IconBolt,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignRight,
  IconList,
  IconPalette,
  IconStack2,
  IconTypography,
} from "@tabler/icons-react";

import {
  PlanSlide,
  SLIDE_ARTWORK_CSS,
  VarScaledSlide,
} from "./SlidesDeckArtwork";

const CONTEXT_TOOLS = [
  IconBolt,
  IconPalette,
  IconTypography,
  IconList,
  IconStack2,
] as const;

const ALIGN_TOOLS = [
  IconLayoutAlignLeft,
  IconLayoutAlignCenter,
  IconLayoutAlignRight,
] as const;

const SLIDES_STRATEGY_MOCK_CSS = [
  ".slides-strategy-mock { position: relative; width: 100%; }",
  ".slides-strategy-mock, .slides-strategy-mock * { box-sizing: border-box; }",
  ".slides-strategy-mock-frame { display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; background: var(--strategy-window-bg); border: 1px solid var(--strategy-window-border); font-family: 'Inter Variable', 'Inter', system-ui, -apple-system, sans-serif; }",

  ".slides-strategy-mock { --strategy-window-bg: hsl(0 0% 13%); --strategy-workspace-bg: hsl(0 0% 10%); --strategy-window-border: hsl(0 0% 24%); --strategy-fg-muted: hsl(0 0% 55%); }",

  ".slides-strategy-mock-toolbar { display: flex; height: 40px; flex-shrink: 0; align-items: center; gap: 2px; padding: 0 12px; }",
  ".slides-strategy-mock-btn { display: flex; width: 28px; height: 28px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 6px; color: var(--strategy-fg-muted); }",
  ".slides-strategy-mock-divider { width: 1px; height: 18px; flex-shrink: 0; margin: 0 6px; background: var(--strategy-window-border); }",
  ".slides-strategy-mock-spacer { flex: 1; min-width: 8px; }",

  ".slides-strategy-mock-workspace { --sd-scale: 0.44; display: flex; justify-content: center; overflow: hidden; padding: 24px; background: var(--strategy-workspace-bg); }",
  ".slides-strategy-mock-workspace .sd-slide-box { border-radius: 2px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.07); }",

  "html.light .slides-strategy-mock { --strategy-window-bg: hsl(0 0% 100%); --strategy-workspace-bg: hsl(0 0% 96%); --strategy-window-border: hsl(0 0% 90%); --strategy-fg-muted: hsl(0 0% 46%); }",
  "html.light .slides-strategy-mock .slides-strategy-mock-workspace .sd-slide-box { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.22); }",

  SLIDE_ARTWORK_CSS,

  "@media (max-width: 1320px) { .slides-strategy-mock-workspace { --sd-scale: 0.4; } }",
  "@media (max-width: 560px) { .slides-strategy-mock-workspace { --sd-scale: 0.29; padding: 16px; } }",
].join("\n");

export function SlidesStrategyMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`slides-strategy-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{SLIDES_STRATEGY_MOCK_CSS}</style>
      <div className="slides-strategy-mock-frame" aria-hidden="true">
        <div className="slides-strategy-mock-toolbar">
          {CONTEXT_TOOLS.map((Tool, index) => (
            <span key={index} className="slides-strategy-mock-btn">
              <Tool size={15} />
            </span>
          ))}
          <span className="slides-strategy-mock-divider" />
          {ALIGN_TOOLS.map((Tool, index) => (
            <span key={index} className="slides-strategy-mock-btn">
              <Tool size={15} />
            </span>
          ))}
          <span className="slides-strategy-mock-spacer" />
        </div>
        <div className="slides-strategy-mock-workspace">
          <VarScaledSlide>
            <PlanSlide />
          </VarScaledSlide>
        </div>
      </div>
    </div>
  );
}
