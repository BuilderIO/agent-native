/**
 * Static, decorative recreation of two landing-page directions for the same
 * brief sitting side by side on the Design canvas, the right one selected —
 * used as the art for the "Explore landing-page ideas" use-case row on the
 * Design landing page.
 *
 * Two boards, not one, is the whole point of the picture: the row's promise is
 * that you review a message and a layout against an alternative, so a single
 * artboard would illustrate "made a page" instead.
 *
 * The design is a fictional `kettle` coffee subscription, deliberately not the
 * hero's `pulse` brand — three use-case rows showing the same fake product read
 * as one screenshot cropped three ways.
 *
 * All CSS lives here, scoped under `.design-variants-mock`. The real Design
 * stylesheet (templates/design/app/global.css) is deliberately NOT imported: it
 * declares `:root`/`html`/`body` palette rules that would reskin the whole docs
 * site.
 *
 * Every length inside a board is an artboard pixel: the board is authored at
 * BOARD_WIDTH and multiplied by `--dv-scale`, so type and spacing shrink in the
 * proportion a real board zoom would produce rather than being faked with tiny
 * font sizes. The design is authored chunky for the same reason the hero's is.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (a fake brand's fake landing page).
 */
import {
  DESIGN_CANVAS_TOOLBAR_CSS,
  DesignCanvasToolbar,
} from "./DesignCanvasToolbar";

const BOARD_WIDTH = 600;

const BOARD_LABEL_HEIGHT = 22;
const CANVAS_TOP_PAD = 24;

const BOARD_VISIBLE_HEIGHT = 300;

const BOARD_BODY_HEIGHT = 400;

const canvasHeight = (topPad: number) =>
  topPad + BOARD_LABEL_HEIGHT + BOARD_VISIBLE_HEIGHT;

const HERO_ILLUSTRATION_SRC =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F0daad3243582418486e48030d8edb0ab?format=webp&width=440";

const PRODUCT_CARDS = [
  {
    title: "Single origin",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fecc0185836ac40f9a2445196ba6232a4?format=webp&width=340",
  },
  {
    title: "House blend",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd47d098c90064b12a6bd2409fc8f8365?format=webp&width=340",
  },
  {
    title: "Decaf",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdcf0d03a1eb9491684ffdc407561d7f6?format=webp&width=340",
  },
];

const SUBSCRIPTION_PLANS = [
  {
    cadence: "Weekly",
    price: "$18",
    ships: "Every Friday",
    perks: ["Two 250g bags", "Free shipping"],
  },
  {
    cadence: "Biweekly",
    price: "$16",
    ships: "Every other Friday",
    perks: ["Swap roasts anytime", "Free shipping"],
    featured: true,
  },
  {
    cadence: "Monthly",
    price: "$14",
    ships: "First Friday",
    perks: ["Pause anytime", "Free shipping"],
  },
];

const NAV_LINKS = ["Roasts", "Subscriptions", "Story"];

function Wordmark() {
  return (
    <span className="kt-wordmark">
      kettle<span className="kt-wordmark-dot">.</span>
    </span>
  );
}

function Nav() {
  return (
    <div className="kt-nav">
      <Wordmark />
      <div className="kt-nav-links">
        {NAV_LINKS.map((link) => (
          <span key={link}>{link}</span>
        ))}
      </div>
      <span className="kt-nav-cta">Subscribe</span>
    </div>
  );
}

function VariantABoard() {
  return (
    <div className="kt kt-a">
      <Nav />
      <div className="kt-hero">
        <div className="kt-hero-copy">
          <span className="kt-eyebrow">Fresh every Friday</span>
          <span className="kt-headline">
            Coffee that
            <br />
            shows up.
          </span>
          <span className="kt-subhead">
            Roasted to order, ground how you brew it, delivered the week it
            lands.
          </span>
          <div className="kt-hero-actions">
            <span className="kt-cta">Build your box</span>
            <span className="kt-cta-ghost">See roasts</span>
          </div>
        </div>
        <div className="kt-hero-art">
          <img
            className="kt-hero-art-img"
            src={HERO_ILLUSTRATION_SRC}
            alt=""
            crossOrigin="anonymous"
            decoding="async"
            loading="lazy"
          />
        </div>
      </div>
      <div className="kt-card-row">
        {PRODUCT_CARDS.map((card) => (
          <div key={card.title} className="kt-card">
            <div className="kt-card-art">
              <img
                className="kt-card-art-img"
                src={card.src}
                alt=""
                crossOrigin="anonymous"
                decoding="async"
                loading="lazy"
              />
            </div>
            <span className="kt-card-title">{card.title}</span>
            <span className="kt-card-meta">From $16 · 250g</span>
          </div>
        ))}
      </div>
      <div className="kt-band">
        <span className="kt-band-title">First bag ships free.</span>
        <span className="kt-cta">Build your box</span>
      </div>
    </div>
  );
}

function VariantBBoard() {
  return (
    <div className="kt kt-b">
      <Nav />
      <div className="kt-hero">
        <div className="kt-hero-copy">
          <span className="kt-eyebrow">Fresh every Friday</span>
          <span className="kt-headline">
            Never run out
            <br />
            of good coffee.
          </span>
          <span className="kt-subhead">
            Pick a roast and a rhythm. Skip, swap, or pause any week.
          </span>
          <span className="kt-cta">Start a subscription</span>
        </div>
      </div>
      <div className="kt-plan-row">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <div
            key={plan.cadence}
            className={plan.featured ? "kt-plan is-featured" : "kt-plan"}
          >
            <span className="kt-plan-head">
              <span className="kt-plan-cadence">{plan.cadence}</span>
              {plan.featured ? (
                <span className="kt-plan-tag">Popular</span>
              ) : null}
            </span>
            <span className="kt-plan-price">
              {plan.price}
              <span className="kt-plan-unit">/bag</span>
            </span>
            <span className="kt-plan-meta">{plan.ships}</span>
            <span className="kt-plan-rule" />
            <span className="kt-plan-perks">
              {plan.perks.map((perk) => (
                <span key={perk} className="kt-plan-perk">
                  <span className="kt-plan-tick" />
                  {perk}
                </span>
              ))}
            </span>
            <span className="kt-plan-choose">Choose</span>
          </div>
        ))}
      </div>
      <div className="kt-quote">
        <span className="kt-quote-text">
          “The only subscription I have never once thought about cancelling.”
        </span>
        <span className="kt-quote-by">Ana R. · subscriber since 2023</span>
      </div>
      <div className="kt-band">
        <span className="kt-band-title">First bag ships free.</span>
        <span className="kt-cta">Start a subscription</span>
      </div>
    </div>
  );
}

const DESIGN_VARIANTS_MOCK_CSS = [
  ".design-variants-mock { position: relative; width: 100%; pointer-events: none; }",
  ".design-variants-mock, .design-variants-mock * { box-sizing: border-box; }",

  ".design-variants-mock { --dv-scale: 0.4; --dv-frame-bg: hsl(0 0% 13%); --dv-canvas-bg: hsl(0 0% 10%); --dv-border: hsl(0 0% 24%); --dv-fg: hsl(0 0% 90%); --dv-fg-muted: hsl(0 0% 60%); --dv-selection: #01c8f1; }",
  "html.light .design-variants-mock { --dv-frame-bg: hsl(0 0% 100%); --dv-canvas-bg: hsl(0 0% 92%); --dv-border: hsl(0 0% 90%); --dv-fg: hsl(0 0% 10%); --dv-fg-muted: hsl(0 0% 45%); }",

  ".design-variants-mock-frame { position: relative; overflow: hidden; border: 1px solid var(--dv-border); border-radius: 12px; background: var(--dv-frame-bg); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",
  `.design-variants-mock-canvas { display: flex; height: ${canvasHeight(CANVAS_TOP_PAD)}px; justify-content: center; gap: 24px; overflow: hidden; padding: ${CANVAS_TOP_PAD}px 20px 0; background: var(--dv-canvas-bg); }`,

  `.design-variants-mock .dv-board { position: relative; width: calc(${BOARD_WIDTH}px * var(--dv-scale)); flex-shrink: 0; align-self: flex-start; }`,
  ".design-variants-mock .dv-board-label { display: flex; height: 22px; align-items: center; gap: 5px; padding-left: 2px; color: var(--dv-fg-muted); font-size: 11px; font-weight: 500; }",
  ".design-variants-mock .dv-board.is-selected .dv-board-label { color: var(--dv-selection); }",
  `.design-variants-mock .dv-board-body { position: relative; height: ${BOARD_BODY_HEIGHT}px; overflow: hidden; background: var(--kt-bg); box-shadow: inset 0 0 0 1px var(--dv-border); }`,
  `.design-variants-mock .dv-artboard { width: ${BOARD_WIDTH}px; min-height: calc(${BOARD_BODY_HEIGHT}px / var(--dv-scale)); transform: scale(var(--dv-scale)); transform-origin: top left; }`,

  ".design-variants-mock .dv-sel-outline { position: absolute; inset: 22px 0 0; border: 1.5px solid var(--dv-selection); pointer-events: none; }",
  ".design-variants-mock .dv-sel-handle { position: absolute; z-index: 2; width: 7px; height: 7px; border: 1px solid var(--dv-selection); border-radius: 1px; background: #ffffff; }",
  ".design-variants-mock .dv-sel-handle-tl { left: -4px; top: 18px; }",
  ".design-variants-mock .dv-sel-handle-tr { right: -4px; top: 18px; }",
  ".design-variants-mock .dv-sel-handle-bl { left: -4px; bottom: -4px; }",
  ".design-variants-mock .dv-sel-handle-br { right: -4px; bottom: -4px; }",

  ".design-variants-mock { --kt-bg: #0c0c0e; --kt-elevated: #16161a; --kt-fg: #a9a9af; --kt-fg-soft: rgba(169, 169, 175, 0.62); --kt-line: rgba(169, 169, 175, 0.12); --kt-accent: #cdcdd1; --kt-accent-on: #0c0c0e; --kt-plate: #ededf0; }",
  "html.light .design-variants-mock { --kt-bg: #f4f4f5; --kt-elevated: #ffffff; --kt-fg: #55555e; --kt-fg-soft: rgba(85, 85, 94, 0.62); --kt-line: rgba(85, 85, 94, 0.14); --kt-accent: #26262b; --kt-accent-on: #f4f4f5; --kt-plate: #ffffff; }",
  ".design-variants-mock .kt { display: flex; min-height: 100%; flex-direction: column; background: var(--kt-bg); color: var(--kt-fg); }",

  ".design-variants-mock .kt-nav { display: flex; height: 74px; flex-shrink: 0; align-items: center; gap: 34px; padding: 0 34px; }",
  ".design-variants-mock .kt-wordmark { font-size: 28px; font-weight: 700; letter-spacing: -0.04em; }",
  ".design-variants-mock .kt-wordmark-dot { color: var(--kt-accent); }",
  ".design-variants-mock .kt-nav-links { display: flex; flex: 1; align-items: center; gap: 24px; color: var(--kt-fg-soft); font-size: 16px; font-weight: 500; }",
  ".design-variants-mock .kt-nav-cta { display: flex; height: 40px; flex-shrink: 0; align-items: center; padding: 0 20px; border: 2px solid var(--kt-line); border-radius: 999px; font-size: 16px; font-weight: 600; }",

  ".design-variants-mock .kt-hero { display: flex; flex-shrink: 0; align-items: center; gap: 34px; padding: 26px 34px 0; }",
  ".design-variants-mock .kt-hero-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }",
  ".design-variants-mock .kt-eyebrow { display: inline-flex; height: 28px; width: fit-content; align-items: center; padding: 0 14px; border-radius: 999px; background: var(--kt-line); color: var(--kt-fg-soft); font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }",
  ".design-variants-mock .kt-headline { margin-top: 18px; font-size: 44px; font-weight: 700; letter-spacing: -0.04em; line-height: 1.02; }",
  ".design-variants-mock .kt-subhead { margin-top: 16px; color: var(--kt-fg-soft); font-size: 19px; line-height: 1.45; }",
  ".design-variants-mock .kt-hero-actions { display: flex; align-items: center; gap: 14px; margin-top: 26px; }",
  ".design-variants-mock .kt-cta { display: flex; height: 48px; width: fit-content; flex-shrink: 0; align-items: center; padding: 0 26px; border-radius: 999px; background: var(--kt-accent); color: var(--kt-accent-on); font-size: 17px; font-weight: 700; white-space: nowrap; }",
  ".design-variants-mock .kt-cta-ghost { display: flex; height: 48px; flex-shrink: 0; align-items: center; padding: 0 22px; border: 2px solid var(--kt-line); border-radius: 999px; font-size: 17px; font-weight: 600; white-space: nowrap; }",
  ".design-variants-mock .kt-hero-art { position: relative; display: flex; width: 180px; height: 210px; flex-shrink: 0; align-items: center; justify-content: center; overflow: hidden; border-radius: 26px; background: var(--kt-plate); box-shadow: inset 0 0 0 2px var(--kt-line); }",
  ".design-variants-mock .kt-hero-art-img { width: 100%; height: 100%; object-fit: contain; padding: 14px; }",

  ".design-variants-mock .kt-card-row { display: grid; flex-shrink: 0; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 30px 34px 0; }",
  ".design-variants-mock .kt-card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 2px solid var(--kt-line); border-radius: 22px; background: var(--kt-elevated); }",
  ".design-variants-mock .kt-card-art { display: flex; height: 92px; align-items: center; justify-content: center; overflow: hidden; border-radius: 16px; background: var(--kt-plate); }",
  ".design-variants-mock .kt-card-art-img { width: 100%; height: 100%; object-fit: contain; padding: 6px; }",
  ".design-variants-mock .kt-card-title { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }",
  ".design-variants-mock .kt-card-meta { color: var(--kt-fg-soft); font-size: 14px; font-weight: 500; }",

  ".design-variants-mock .kt-b .kt-hero { padding-top: 40px; }",
  ".design-variants-mock .kt-b .kt-hero-copy { align-items: center; text-align: center; }",
  ".design-variants-mock .kt-b .kt-headline { font-size: 44px; }",
  ".design-variants-mock .kt-b .kt-subhead { max-width: 380px; }",
  ".design-variants-mock .kt-b .kt-cta { margin-top: 26px; }",
  ".design-variants-mock .kt-plan-row { display: grid; flex-shrink: 0; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 38px 34px 0; }",
  ".design-variants-mock .kt-plan { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 18px 16px; border: 2px solid var(--kt-line); border-radius: 22px; background: var(--kt-elevated); }",
  ".design-variants-mock .kt-plan.is-featured { border-color: var(--kt-accent); }",
  ".design-variants-mock .kt-plan-head { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; }",
  ".design-variants-mock .kt-plan-cadence { color: var(--kt-fg-soft); font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }",
  ".design-variants-mock .kt-plan-tag { display: inline-flex; align-items: center; padding: 0 8px; border-radius: 999px; background: var(--kt-accent); color: var(--kt-accent-on); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }",
  ".design-variants-mock .kt-plan-price { display: flex; align-items: baseline; gap: 3px; font-size: 28px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }",
  ".design-variants-mock .kt-plan-unit { color: var(--kt-fg-soft); font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }",
  ".design-variants-mock .kt-plan-meta { color: var(--kt-fg-soft); font-size: 13px; }",
  ".design-variants-mock .kt-plan-rule { width: 100%; height: 2px; margin: 4px 0; background: var(--kt-line); }",
  ".design-variants-mock .kt-plan-perks { display: flex; width: 100%; flex-direction: column; gap: 6px; }",
  ".design-variants-mock .kt-plan-perk { display: flex; align-items: center; gap: 8px; color: var(--kt-fg-soft); font-size: 13px; font-weight: 500; }",
  ".design-variants-mock .kt-plan-tick { width: 10px; height: 10px; flex-shrink: 0; border-radius: 999px; border: 2px solid var(--kt-accent); }",
  ".design-variants-mock .kt-plan-choose { display: flex; width: 100%; height: 34px; align-items: center; justify-content: center; margin-top: 8px; border: 2px solid var(--kt-line); border-radius: 999px; font-size: 14px; font-weight: 700; }",
  ".design-variants-mock .kt-plan.is-featured .kt-plan-choose { border-color: transparent; background: var(--kt-accent); color: var(--kt-accent-on); }",
  ".design-variants-mock .kt-band { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 16px; margin: 32px 24px 24px; padding: 22px 26px; border: 2px solid var(--kt-line); border-radius: 26px; background: var(--kt-elevated); }",
  ".design-variants-mock .kt-band-title { font-size: 24px; font-weight: 700; letter-spacing: -0.03em; }",
  ".design-variants-mock .kt-quote { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 34px 48px 0; text-align: center; }",
  ".design-variants-mock .kt-quote-text { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; }",
  ".design-variants-mock .kt-quote-by { color: var(--kt-fg-soft); font-size: 14px; font-weight: 500; }",

  DESIGN_CANVAS_TOOLBAR_CSS,

  `@media (max-width: 1320px) { .design-variants-mock { --dv-scale: 0.34; } .design-variants-mock-canvas { height: ${canvasHeight(20)}px; gap: 18px; padding: 20px 16px 0; } }`,
  `@media (max-width: 560px) { .design-variants-mock { --dv-scale: 0.26; } .design-variants-mock-canvas { height: ${canvasHeight(16)}px; gap: 12px; padding: 16px 12px 0; } }`,
  `@media (max-width: 480px) { .design-variants-mock { --dv-scale: 0.21; } .design-variants-mock-canvas { height: ${canvasHeight(14)}px; gap: 10px; padding: 14px 10px 0; } }`,
].join("\n");

function Board({
  label,
  selected,
  children,
}: {
  label: string;
  selected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={selected ? "dv-board is-selected" : "dv-board"}>
      <div className="dv-board-label">{label}</div>
      <div className="dv-board-body">
        <div className="dv-artboard">{children}</div>
      </div>
      {selected ? (
        <>
          <span className="dv-sel-outline" />
          <span className="dv-sel-handle dv-sel-handle-tl" />
          <span className="dv-sel-handle dv-sel-handle-tr" />
          <span className="dv-sel-handle dv-sel-handle-bl" />
          <span className="dv-sel-handle dv-sel-handle-br" />
        </>
      ) : null}
    </div>
  );
}

export function DesignVariantsMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`design-variants-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{DESIGN_VARIANTS_MOCK_CSS}</style>
      <div className="design-variants-mock-frame" aria-hidden="true">
        <div className="design-variants-mock-canvas">
          <Board label="Variant A">
            <VariantABoard />
          </Board>
          <Board label="Variant B" selected>
            <VariantBBoard />
          </Board>
        </div>
        <DesignCanvasToolbar />
      </div>
    </div>
  );
}
