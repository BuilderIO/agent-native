/**
 * The fake deck the Slides landing-page mocks render: a handful of slides
 * authored at the renderer's real 960x540 logical size, plus the CSS that
 * styles them.
 *
 * Shared rather than inlined per mock because the hero, the rail thumbnails,
 * and all three use-case cards show the same deck at four different zooms —
 * the same reason DesignFitnessArtboards.tsx exists next door.
 *
 * Slides are authored at full size and scaled with `transform`, exactly how
 * `SlideRenderer` does it, so type and spacing shrink in proportion instead of
 * being faked with tiny font sizes. The custom properties below mirror the
 * ones `SlideInner` injects (`--ds-bg`, `--ds-accent`, `--ds-text`,
 * `--ds-text-muted`, `--ds-heading-font`, `--ds-body-font`, `--ds-surface`,
 * `--ds-radius`) so the layouts read as real design-system output.
 *
 * The deck follows the docs theme: a dark deck on the dark page, paper on the
 * light one. Pinning it to paper made the slide the brightest object on a dark
 * page by a wide margin, so the eye went to the artwork instead of the
 * headline. The dark values follow what the real renderer does on a dark
 * background — white text, `rgba(255, 255, 255, 0.72)` muted text — rather
 * than being a docs-only invention.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. Every mock
 * that renders these slides is a `role="img"` with a localized `aria-label`
 * and an `aria-hidden` frame, so no assistive tech ever reads these strings;
 * they are the pixels of a product screenshot (a fake quarterly deck).
 */
import type { ReactNode } from "react";

export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;

/** Deck accent on paper, matching the renderer's own `--ds-accent` fallback. */
export const DECK_ACCENT = "#2457d6";
/** The dark deck lifts the accent, which is unreadable at the paper value. */
export const DECK_ACCENT_DARK = "#7aa2ff";

export function ScaledSlide({
  scale,
  className = "",
  children,
}: {
  scale: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`sd-slide-box ${className}`}
      style={{
        width: SLIDE_WIDTH * scale,
        height: SLIDE_HEIGHT * scale,
      }}
    >
      <div className="sd-slide" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/**
 * A slide whose zoom comes from the `--sd-scale` custom property rather than a
 * number, so a mock can change it at a breakpoint. The fixed-number variant
 * cannot: these slides are a fixed logical size, and a card that is 500px wide
 * on desktop is 320px wide on a phone.
 */
export function VarScaledSlide({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`sd-slide-box sd-slide-box-var ${className}`}>
      <div className="sd-slide sd-slide-var">{children}</div>
    </div>
  );
}

/** The `title` layout: centred stack, the renderer's 80px/64px padding. */
export function TitleSlide() {
  return (
    <div className="sd-layout sd-layout-title">
      <span className="sd-eyebrow">Northwind · Q3 Review</span>
      <h1 className="sd-title">Growth compounded in every region</h1>
      <p className="sd-subtitle">
        Revenue, retention, and pipeline for the quarter ending September 30
      </p>
    </div>
  );
}

/** The `content` layout carrying a three-up stat row. */
export function StatsSlide() {
  return (
    <div className="sd-layout sd-layout-content">
      <h2 className="sd-heading">Where the quarter landed</h2>
      <div className="sd-stat-row">
        <div className="sd-stat">
          <span className="sd-stat-value">$4.8M</span>
          <span className="sd-stat-label">Net new ARR</span>
        </div>
        <div className="sd-stat">
          <span className="sd-stat-value">118%</span>
          <span className="sd-stat-label">Net revenue retention</span>
        </div>
        <div className="sd-stat">
          <span className="sd-stat-value">2,140</span>
          <span className="sd-stat-label">Teams activated</span>
        </div>
      </div>
      <ul className="sd-bullets">
        <li>Enterprise closed at 141% of plan, led by EMEA.</li>
        <li>Self-serve conversion up 6 points after the new onboarding.</li>
      </ul>
    </div>
  );
}

/**
 * Bar heights are percentages of the plot box, so the chart stays correct at
 * every zoom without a layout pass. The last quarter is the one being
 * presented, so it carries the solid accent and the rest sit back.
 */
const ARR_BY_QUARTER = [
  { quarter: "Q2 '24", value: "$2.1M", height: 34 },
  { quarter: "Q3 '24", value: "$2.6M", height: 42 },
  { quarter: "Q4 '24", value: "$3.0M", height: 49 },
  { quarter: "Q1 '25", value: "$3.4M", height: 55 },
  { quarter: "Q2 '25", value: "$3.9M", height: 64 },
  { quarter: "Q3 '25", value: "$4.8M", height: 82, current: true },
] as const;

/** The `content` layout carrying a chart, the deck's data slide. */
export function ChartSlide() {
  return (
    <div className="sd-layout sd-layout-content">
      <div className="sd-chart-header">
        <h2 className="sd-heading">Net new ARR by quarter</h2>
        <span className="sd-chart-delta">+23% QoQ</span>
      </div>
      <div className="sd-chart">
        <div className="sd-chart-plot">
          <span className="sd-chart-grid sd-chart-grid-1" />
          <span className="sd-chart-grid sd-chart-grid-2" />
          <span className="sd-chart-grid sd-chart-grid-3" />
          {ARR_BY_QUARTER.map((bar) => (
            <span key={bar.quarter} className="sd-bar-col">
              <span className="sd-bar-value">{bar.value}</span>
              <span
                className={
                  "current" in bar && bar.current
                    ? "sd-bar is-current"
                    : "sd-bar"
                }
                style={{ height: `${bar.height}%` }}
              />
            </span>
          ))}
        </div>
        <div className="sd-chart-axis">
          {ARR_BY_QUARTER.map((bar) => (
            <span key={bar.quarter} className="sd-chart-tick">
              {bar.quarter}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The `two-column` layout with an image on one side. The picture is drawn
 * rather than sourced: a stock photo would date the page and add a request to
 * the hero, and the deck only needs to show that a slide can hold an image.
 */
export function ImageSlide() {
  return (
    <div className="sd-layout sd-layout-two-column">
      <div className="sd-column">
        <span className="sd-eyebrow">Field research</span>
        <h2 className="sd-heading">What we heard on site</h2>
        <ul className="sd-bullets">
          <li>Ops teams rebuild the same board deck every quarter.</li>
          <li>Most of the work is restyling, not deciding what to say.</li>
        </ul>
      </div>
      <figure className="sd-figure">
        <div className="sd-image">
          <span className="sd-image-orb sd-image-orb-1" />
          <span className="sd-image-orb sd-image-orb-2" />
          <span className="sd-image-ridge" />
        </div>
        <figcaption className="sd-figure-caption">
          42 interviews across 9 markets
        </figcaption>
      </figure>
    </div>
  );
}

const PLAN_PHASES = [
  {
    phase: "Phase 1",
    window: "Oct — Nov",
    title: "Land the migration",
    detail: "Move the last 40 accounts off the legacy importer.",
  },
  {
    phase: "Phase 2",
    window: "Dec — Jan",
    title: "Open the platform",
    detail: "Public API, partner sandbox, and usage-based billing.",
  },
  {
    phase: "Phase 3",
    window: "Feb — Mar",
    title: "Expand upmarket",
    detail: "SSO, audit trails, and regional data residency.",
  },
] as const;

/** The `two-column` layout, used here as a phased plan. */
export function PlanSlide() {
  return (
    <div className="sd-layout sd-layout-content">
      <h2 className="sd-heading">The path to 2026</h2>
      <div className="sd-phase-row">
        {PLAN_PHASES.map((item) => (
          <div key={item.phase} className="sd-phase">
            <span className="sd-phase-rule" />
            <span className="sd-phase-name">{item.phase}</span>
            <span className="sd-phase-window">{item.window}</span>
            <span className="sd-phase-title">{item.title}</span>
            <span className="sd-phase-detail">{item.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The `content` layout as a monthly business update. */
export function UpdateSlide() {
  return (
    <div className="sd-layout sd-layout-content">
      <span className="sd-eyebrow">September update</span>
      <h2 className="sd-heading">Shipped, learned, and next</h2>
      <div className="sd-update-grid">
        <div className="sd-update-cell">
          <span className="sd-update-label">Shipped</span>
          <span className="sd-update-body">
            Scheduled reports, Slack digests, and the new billing portal.
          </span>
        </div>
        <div className="sd-update-cell">
          <span className="sd-update-label">Learned</span>
          <span className="sd-update-body">
            Teams that connect a data source in week one retain twice as well.
          </span>
        </div>
        <div className="sd-update-cell">
          <span className="sd-update-label">Next</span>
          <span className="sd-update-body">
            Guided setup for the top three sources, starting in October.
          </span>
        </div>
      </div>
    </div>
  );
}

/** The `statement` layout: one centred line at the largest heading size. */
export function StatementSlide() {
  return (
    <div className="sd-layout sd-layout-statement">
      <p className="sd-statement">Every team ships their own reporting now.</p>
      <p className="sd-subtitle">What that changes for the roadmap</p>
    </div>
  );
}

/** The `section` layout: a divider card between deck chapters. */
export function SectionSlide() {
  return (
    <div className="sd-layout sd-layout-title">
      <span className="sd-eyebrow">02</span>
      <h1 className="sd-title">Pipeline</h1>
    </div>
  );
}

export const SLIDE_ARTWORK_CSS = [
  ".sd-slide-box { position: relative; overflow: hidden; flex-shrink: 0; background: var(--ds-bg); }",
  `.sd-slide { position: absolute; left: 0; top: 0; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; transform-origin: top left; }`,
  `.sd-slide-box-var { width: calc(${SLIDE_WIDTH}px * var(--sd-scale)); height: calc(${SLIDE_HEIGHT}px * var(--sd-scale)); }`,
  ".sd-slide-var { transform: scale(var(--sd-scale)); }",

  // Mirrors SlideInner's injected custom properties. Dark first, following the
  // docs shell; the `html.light` block at the end of this file swaps in the
  // renderer's own paper fallbacks. `--ds-grid` and `--ds-image-wash` are the
  // two additions: the renderer has no chart or figure primitive to copy them
  // from, and both need a value that survives the theme swap.
  `.sd-slide-box, .sd-slide { --ds-bg: #14161b; --ds-text: #ffffff; --ds-text-muted: rgba(255, 255, 255, 0.72); --ds-accent: ${DECK_ACCENT_DARK}; --ds-surface: rgba(255, 255, 255, 0.06); --ds-grid: rgba(255, 255, 255, 0.12); --ds-image-wash: #3d2f6b; --ds-radius: 12px; --ds-heading-font: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --ds-body-font: var(--ds-heading-font); }`,
  ".sd-slide, .sd-slide * { box-sizing: border-box; }",
  ".sd-slide { background: var(--ds-bg); color: var(--ds-text); font-family: var(--ds-body-font); }",

  // The renderer's layout paddings: 64px vertical, 80px horizontal.
  ".sd-slide .sd-layout { display: flex; height: 100%; flex-direction: column; padding: 64px 80px; }",
  ".sd-slide .sd-layout-title { align-items: flex-start; justify-content: center; gap: 24px; }",
  ".sd-slide .sd-layout-content { justify-content: center; gap: 40px; }",
  ".sd-slide .sd-layout-statement { align-items: center; justify-content: center; gap: 24px; text-align: center; }",
  // The renderer's `two-column`: equal columns, 32px gap.
  ".sd-slide .sd-layout-two-column { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 32px; }",
  ".sd-slide .sd-column { display: flex; flex-direction: column; gap: 24px; }",

  ".sd-slide .sd-eyebrow { color: var(--ds-accent); font-size: 18px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }",
  ".sd-slide .sd-title { margin: 0; max-width: 720px; font-family: var(--ds-heading-font); font-size: 64px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; }",
  ".sd-slide .sd-heading { margin: 0; font-family: var(--ds-heading-font); font-size: 38px; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; }",
  ".sd-slide .sd-statement { margin: 0; max-width: 760px; font-family: var(--ds-heading-font); font-size: 42px; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; }",
  ".sd-slide .sd-subtitle { margin: 0; max-width: 640px; color: var(--ds-text-muted); font-size: 22px; line-height: 1.4; }",

  ".sd-slide .sd-stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }",
  ".sd-slide .sd-stat { display: flex; flex-direction: column; gap: 8px; padding: 28px 28px 30px; border-radius: var(--ds-radius); background: var(--ds-surface); border-top: 4px solid var(--ds-accent); }",
  ".sd-slide .sd-stat-value { font-family: var(--ds-heading-font); font-size: 46px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; }",
  ".sd-slide .sd-stat-label { color: var(--ds-text-muted); font-size: 18px; line-height: 1.3; }",

  ".sd-slide .sd-bullets { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; }",
  ".sd-slide .sd-bullets li { position: relative; padding-left: 26px; font-size: 20px; line-height: 1.4; color: var(--ds-text-muted); }",
  ".sd-slide .sd-bullets li::before { position: absolute; left: 0; top: 10px; width: 9px; height: 9px; border-radius: 999px; background: var(--ds-accent); content: ''; }",

  // Chart. The plot is a fixed-height box so bar percentages resolve against
  // something definite; the axis is a sibling row on the same grid so ticks
  // stay under their bars without the bars reserving label space.
  ".sd-slide .sd-chart-header { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; }",
  ".sd-slide .sd-chart-delta { flex-shrink: 0; padding: 6px 14px; border-radius: 999px; background: var(--ds-surface); color: var(--ds-accent); font-size: 18px; font-weight: 600; }",
  ".sd-slide .sd-chart { display: flex; flex-direction: column; gap: 14px; }",
  ".sd-slide .sd-chart-plot { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); align-items: end; gap: 28px; height: 232px; border-bottom: 2px solid var(--ds-grid); }",
  ".sd-slide .sd-chart-grid { position: absolute; left: 0; right: 0; height: 1px; background: var(--ds-grid); }",
  ".sd-slide .sd-chart-grid-1 { bottom: 25%; }",
  ".sd-slide .sd-chart-grid-2 { bottom: 50%; }",
  ".sd-slide .sd-chart-grid-3 { bottom: 75%; }",
  ".sd-slide .sd-bar-col { position: relative; display: flex; height: 100%; flex-direction: column; justify-content: flex-end; align-items: center; gap: 10px; }",
  ".sd-slide .sd-bar-value { color: var(--ds-text-muted); font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }",
  ".sd-slide .sd-bar { width: 100%; border-radius: 8px 8px 0 0; background: var(--ds-accent); opacity: 0.38; }",
  ".sd-slide .sd-bar.is-current { opacity: 1; }",
  ".sd-slide .sd-chart-axis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 28px; }",
  ".sd-slide .sd-chart-tick { color: var(--ds-text-muted); font-size: 17px; text-align: center; }",

  // Figure. The image is a drawn composition rather than a photo, so it needs
  // its own stacking context and a clip; the ridge and orbs are positioned
  // against the frame, not the slide.
  ".sd-slide .sd-figure { display: flex; flex-direction: column; gap: 12px; margin: 0; }",
  ".sd-slide .sd-image { position: relative; width: 100%; aspect-ratio: 4 / 3; overflow: hidden; border-radius: var(--ds-radius); background: linear-gradient(135deg, var(--ds-accent), var(--ds-image-wash)); }",
  ".sd-slide .sd-image-orb { position: absolute; border-radius: 999px; background: rgba(255, 255, 255, 0.16); }",
  ".sd-slide .sd-image-orb-1 { right: -12%; top: -18%; width: 62%; aspect-ratio: 1; }",
  ".sd-slide .sd-image-orb-2 { left: -16%; bottom: -26%; width: 74%; aspect-ratio: 1; background: rgba(255, 255, 255, 0.1); }",
  ".sd-slide .sd-image-ridge { position: absolute; right: 0; bottom: 0; left: 0; height: 52%; background: rgba(255, 255, 255, 0.2); clip-path: polygon(0 62%, 26% 20%, 51% 58%, 74% 10%, 100% 44%, 100% 100%, 0 100%); }",
  ".sd-slide .sd-figure-caption { color: var(--ds-text-muted); font-size: 17px; }",

  ".sd-slide .sd-phase-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; }",
  ".sd-slide .sd-phase { display: flex; flex-direction: column; gap: 10px; }",
  ".sd-slide .sd-phase-rule { height: 4px; width: 100%; background: var(--ds-accent); }",
  ".sd-slide .sd-phase-name { color: var(--ds-accent); font-size: 17px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }",
  ".sd-slide .sd-phase-window { color: var(--ds-text-muted); font-size: 17px; }",
  ".sd-slide .sd-phase-title { font-family: var(--ds-heading-font); font-size: 26px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }",
  ".sd-slide .sd-phase-detail { color: var(--ds-text-muted); font-size: 19px; line-height: 1.4; }",

  ".sd-slide .sd-update-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }",
  ".sd-slide .sd-update-cell { display: flex; flex-direction: column; gap: 12px; padding: 26px; border-radius: var(--ds-radius); background: var(--ds-surface); }",
  ".sd-slide .sd-update-label { color: var(--ds-accent); font-size: 17px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }",
  ".sd-slide .sd-update-body { font-size: 20px; line-height: 1.4; color: var(--ds-text-muted); }",

  // Paper. The renderer's own light fallbacks, applied when the docs shell is
  // light. Stays last so it wins on source order over the dark values above.
  `html.light .sd-slide-box, html.light .sd-slide { --ds-bg: #f5f2ea; --ds-text: #1f2933; --ds-text-muted: #667085; --ds-accent: ${DECK_ACCENT}; --ds-surface: #ffffff; --ds-grid: rgba(31, 41, 51, 0.14); --ds-image-wash: #0e9aa7; }`,
].join("\n");
