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
 * The deck keeps its own light paper palette in both docs themes. A slide is
 * a document, not chrome: the real editor renders the deck's own colours on a
 * dark workspace, and re-skinning the paper with the docs theme would show
 * something the product never does.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. Every mock
 * that renders these slides is a `role="img"` with a localized `aria-label`
 * and an `aria-hidden` frame, so no assistive tech ever reads these strings;
 * they are the pixels of a product screenshot (a fake quarterly deck).
 */
import type { ReactNode } from "react";

export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;

/** Deck accent, matching the renderer's own `--ds-accent` fallback. */
export const DECK_ACCENT = "#2457d6";

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

  // Mirrors SlideInner's injected custom properties, with the renderer's own
  // fallback values for a deck that has no design system attached.
  `.sd-slide-box, .sd-slide { --ds-bg: #f5f2ea; --ds-text: #1f2933; --ds-text-muted: #667085; --ds-accent: ${DECK_ACCENT}; --ds-surface: #ffffff; --ds-radius: 12px; --ds-heading-font: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --ds-body-font: var(--ds-heading-font); }`,
  ".sd-slide, .sd-slide * { box-sizing: border-box; }",
  ".sd-slide { background: var(--ds-bg); color: var(--ds-text); font-family: var(--ds-body-font); }",

  // The renderer's layout paddings: 64px vertical, 80px horizontal.
  ".sd-slide .sd-layout { display: flex; height: 100%; flex-direction: column; padding: 64px 80px; }",
  ".sd-slide .sd-layout-title { align-items: flex-start; justify-content: center; gap: 24px; }",
  ".sd-slide .sd-layout-content { justify-content: center; gap: 40px; }",
  ".sd-slide .sd-layout-statement { align-items: center; justify-content: center; gap: 24px; text-align: center; }",

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
].join("\n");
