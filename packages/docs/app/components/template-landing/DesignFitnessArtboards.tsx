/**
 * "The user's design" half of the Design landing hero: a fictional `pulse`
 * fitness-app landing page, authored as a desktop screen plus its mobile
 * breakpoint and rendered inside the editor chrome in `DesignOverviewMock`.
 * Kept separate from that file because the chrome and the artboards are
 * unrelated concerns and share nothing but the board scale.
 *
 * Every length below is an artboard pixel, not a screen pixel: each artboard is
 * laid out at its logical size and multiplied by BOARD_SCALE. The type is sized
 * like a large-type marketing page on purpose — at 0.4 a normal 16px body line
 * lands at 6.4px and turns to mush, so the design itself is authored chunky.
 *
 * `ImageSlot` crops a photo to the box the design gives it. Each one takes an
 * `objectPosition`, since these stock shots are rarely centred on their subject.
 *
 * i18n-raw-literal-disable-file -- artwork, not UI copy. See the header comment
 * in DesignOverviewMock.tsx; the whole tree renders inside an `aria-hidden`
 * wrapper under a `role="img"` with a localized label.
 */

/** Board zoom. Matches the `40%` readout in the inspector. */
export const BOARD_SCALE = 0.4;

export const DESKTOP_ARTBOARD_WIDTH = 1280;
export const MOBILE_ARTBOARD_WIDTH = 390;

/**
 * Screen height of a frame body, deliberately taller than the canvas viewport
 * so both screens run off the bottom edge and get cut there. A design that
 * stopped neatly inside the canvas would read as a fixed-height graphic; real
 * pages keep going past the fold, and the editor just clips them.
 */
export const FRAME_BODY_HEIGHT = 700;

/**
 * Floor for the artboards, not a fixed size: height is content-driven so a
 * short screen can never leave white space above the cut, and a long one simply
 * extends further past it.
 */
export const ARTBOARD_MIN_HEIGHT = FRAME_BODY_HEIGHT / BOARD_SCALE;

/**
 * The design's page background. Exported so the frame body behind the artboard
 * matches it — the frame is taller than the content, and a white backing would
 * flash below the fold.
 */
export const ARTBOARD_BG = "#0c0c0e";

/** Logical size of the selected CTA, mirrored by the inspector's W/H fields. */
export const SELECTED_CTA_WIDTH = 160;
export const SELECTED_CTA_HEIGHT = 52;

/**
 * Selection chrome lives inside the scaled artboard so it tracks the element it
 * outlines instead of being positioned by hand, which means every length has to
 * be divided by the board scale to land at its intended on-screen size. CSS
 * transforms scale vector borders exactly, so a 1.5px outline authored as
 * 3.75px is still a crisp 1.5px.
 */
const inverse = (screenPx: number) => `${screenPx / BOARD_SCALE}px`;

/**
 * The runner sits in the right third of the frame, so the near-square hero crop
 * has to bias right or it cuts him in half. `width` is ~2x the 460px slot for
 * retina; no `height`, so the CDN keeps the source aspect ratio and
 * `object-fit: cover` does the cropping.
 */
const HERO_ATHLETE_SRC =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9eb46e6b1f494d6694c8b93785d3cb77?format=webp&width=920";
const HERO_ATHLETE_POSITION = "75% center";

const NAV_LINKS = ["Programs", "Classes", "Coaches", "Pricing"];

const STATS = [
  { value: "12k", label: "Sessions logged" },
  { value: "48", label: "Live classes weekly" },
  { value: "94%", label: "Stick with it" },
];

const PLANS = [
  {
    name: "Drop in",
    price: "$0",
    meta: "Two classes a week",
    cta: "Start free",
  },
  {
    name: "Unlimited",
    price: "$29",
    meta: "Every class, every plan",
    cta: "Go unlimited",
    featured: true,
  },
  {
    name: "Coached",
    price: "$89",
    meta: "Weekly 1:1 review",
    cta: "Get matched",
  },
];

const CLASSES = [
  {
    title: "Sprint Intervals",
    meta: "28 min · HIIT",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F756dda96e9774315951d2635dcbbb4c4?format=webp&width=660",
  },
  {
    title: "Deep Mobility",
    meta: "35 min · Recovery",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F153d1f4a1b4b4915bed9ee5114d6c93f?format=webp&width=660",
  },
  {
    title: "Heavy Compound",
    meta: "45 min · Strength",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F576a17db99384c2da0b1976ea2d215a0?format=webp&width=660",
  },
];

function ImageSlot({
  className = "",
  src,
  objectPosition,
}: {
  className?: string;
  src: string;
  /** Crop focus, since these photos are rarely centred on their subject. */
  objectPosition?: string;
}) {
  return (
    <div className={["ft-slot", className].join(" ").trim()}>
      <img
        className="ft-slot-img"
        src={src}
        alt=""
        crossOrigin="anonymous"
        decoding="async"
        style={{ objectPosition }}
      />
    </div>
  );
}

/**
 * The element the editor has selected. The outline, handles, and dimension
 * badge are part of the editor, not the design, but they are drawn here so they
 * stay glued to the button through any layout change above it.
 */
function SelectedCta({ full = false }: { full?: boolean }) {
  return (
    <div className={full ? "ft-selected is-full" : "ft-selected"}>
      <span className="ft-cta">Start free trial</span>
      <span className="ft-sel-outline" />
      <span className="ft-sel-handle ft-sel-handle-tl" />
      <span className="ft-sel-handle ft-sel-handle-tr" />
      <span className="ft-sel-handle ft-sel-handle-bl" />
      <span className="ft-sel-handle ft-sel-handle-br" />
      <span className="ft-sel-badge">
        {SELECTED_CTA_WIDTH} × {SELECTED_CTA_HEIGHT}
      </span>
    </div>
  );
}

function Wordmark() {
  return (
    <span className="ft-wordmark">
      pulse<span className="ft-wordmark-dot">.</span>
    </span>
  );
}

export function FitnessDesktopArtboard() {
  return (
    <div className="ft ft-desktop">
      <header className="ft-nav">
        <Wordmark />
        <nav className="ft-nav-links">
          {NAV_LINKS.map((link) => (
            <span key={link}>{link}</span>
          ))}
        </nav>
        <span className="ft-nav-cta">Join now</span>
      </header>

      <section className="ft-hero">
        <span className="ft-hero-blob ft-hero-blob-a" />
        <span className="ft-hero-blob ft-hero-blob-b" />
        <div className="ft-hero-copy">
          <span className="ft-eyebrow">New · Spring programs</span>
          <h2 className="ft-headline">
            Train like it&rsquo;s
            <br />
            <em>personal.</em>
          </h2>
          <p className="ft-subhead">
            Adaptive plans, live classes, and coaches who actually watch your
            form.
          </p>
          <div className="ft-hero-actions">
            <SelectedCta />
            <span className="ft-cta-ghost">Watch demo</span>
          </div>
        </div>
        <ImageSlot
          className="ft-hero-art"
          src={HERO_ATHLETE_SRC}
          objectPosition={HERO_ATHLETE_POSITION}
        />
      </section>

      <section className="ft-stats">
        {STATS.map((stat) => (
          <div key={stat.label} className="ft-stat">
            <span className="ft-stat-value">{stat.value}</span>
            <span className="ft-stat-label">{stat.label}</span>
          </div>
        ))}
      </section>

      <section className="ft-section">
        <div className="ft-section-head">
          <h3 className="ft-section-title">This week&rsquo;s classes</h3>
          <span className="ft-section-link">See all 48 →</span>
        </div>
        <div className="ft-class-grid">
          {CLASSES.map((item) => (
            <div key={item.title} className="ft-class">
              <ImageSlot src={item.src} />
              <span className="ft-class-title">{item.title}</span>
              <span className="ft-class-meta">{item.meta}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ft-section">
        <div className="ft-section-head">
          <h3 className="ft-section-title">Pick your pace</h3>
          <span className="ft-section-link">Compare plans →</span>
        </div>
        <div className="ft-plan-grid">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={plan.featured ? "ft-plan is-featured" : "ft-plan"}
            >
              <span className="ft-plan-name">{plan.name}</span>
              <span className="ft-plan-price">
                {plan.price}
                <span className="ft-plan-period">/mo</span>
              </span>
              <span className="ft-plan-meta">{plan.meta}</span>
              <span className="ft-plan-cta">{plan.cta}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ft-band">
        <span className="ft-band-title">Your first two weeks are on us.</span>
        <span className="ft-band-cta">Get started</span>
      </section>

      <footer className="ft-footer">
        <Wordmark />
        <span className="ft-footer-links">
          {NAV_LINKS.map((link) => (
            <span key={link}>{link}</span>
          ))}
        </span>
      </footer>
    </div>
  );
}

export function FitnessMobileArtboard() {
  return (
    <div className="ft ft-mobile">
      <header className="ft-nav">
        <Wordmark />
        <span className="ft-nav-menu">Menu</span>
      </header>

      <section className="ft-hero">
        <span className="ft-hero-blob ft-hero-blob-a" />
        <div className="ft-hero-copy">
          <span className="ft-eyebrow">New · Spring</span>
          <h2 className="ft-headline">
            Train like it&rsquo;s <em>personal.</em>
          </h2>
          <p className="ft-subhead">
            Adaptive plans and coaches who watch your form.
          </p>
          <SelectedCta full />
        </div>
        <ImageSlot
          className="ft-hero-art"
          src={HERO_ATHLETE_SRC}
          objectPosition={HERO_ATHLETE_POSITION}
        />
      </section>

      <section className="ft-stats">
        {STATS.slice(0, 2).map((stat) => (
          <div key={stat.label} className="ft-stat">
            <span className="ft-stat-value">{stat.value}</span>
            <span className="ft-stat-label">{stat.label}</span>
          </div>
        ))}
      </section>

      <section className="ft-section">
        <div className="ft-section-head">
          <h3 className="ft-section-title">Classes</h3>
          <span className="ft-section-link">All →</span>
        </div>
        <div className="ft-class-grid">
          {CLASSES.slice(0, 2).map((item) => (
            <div key={item.title} className="ft-class">
              <ImageSlot src={item.src} />
              <span className="ft-class-title">{item.title}</span>
              <span className="ft-class-meta">{item.meta}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ft-section">
        <div className="ft-section-head">
          <h3 className="ft-section-title">Plans</h3>
          <span className="ft-section-link">All →</span>
        </div>
        <div className="ft-plan-grid">
          {PLANS.slice(0, 2).map((plan) => (
            <div
              key={plan.name}
              className={plan.featured ? "ft-plan is-featured" : "ft-plan"}
            >
              <span className="ft-plan-name">{plan.name}</span>
              <span className="ft-plan-price">
                {plan.price}
                <span className="ft-plan-period">/mo</span>
              </span>
              <span className="ft-plan-meta">{plan.meta}</span>
              <span className="ft-plan-cta">{plan.cta}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ft-band">
        <span className="ft-band-title">Your first two weeks are on us.</span>
        <span className="ft-band-cta">Get started</span>
      </section>
    </div>
  );
}

export const DESIGN_FITNESS_CSS = [
  // Palette. Fixed, not theme-derived: this is the user's design sitting on the
  // canvas, so it must look identical whether the editor around it is light or
  // dark — exactly like a real artboard.
  //
  // Dark and monochrome with a single accent. The earlier five-hue palette
  // turned the artboard into the loudest thing on the page and competed with
  // the editor for attention — the mock is meant to read as a design being
  // worked on, not as the hero image. Structure now comes from surface steps
  // and hairlines; `--ft-accent` is rationed to the emphasis word, the
  // wordmark dot, and the two real calls to action.
  //
  // `--ft-ink` stays dark on purpose: it is the text colour for accent fills,
  // not a surface.
  `.design-mock .ft { --ft-ink: #0c0c0e; --ft-bg: ${ARTBOARD_BG}; --ft-elevated: #16161a; --ft-hero-bg: #131317; --ft-fg: #f2f2f4; --ft-fg-soft: rgba(242, 242, 244, 0.6); --ft-line: rgba(242, 242, 244, 0.1); --ft-line-strong: rgba(242, 242, 244, 0.24); --ft-accent: #d8ff3e; }`,
  ".design-mock .ft { width: 100%; min-height: 100%; background: var(--ft-bg); color: var(--ft-fg); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }",
  // The docs shell colors every h1-h4 and prose paragraph directly, so an
  // artboard heading would otherwise pick up the docs foreground instead of the
  // design's own ink.
  ".design-mock .ft h2, .design-mock .ft h3, .design-mock .ft p { color: inherit; }",
  ".design-mock .ft-desktop, .design-mock .ft-mobile { display: flex; flex-direction: column; }",

  // Photo slots
  ".design-mock .ft-slot { position: relative; overflow: hidden; border-radius: 16px; }",
  ".design-mock .ft-slot-img { display: block; width: 100%; height: 100%; object-fit: cover; }",

  // Nav
  ".design-mock .ft-nav { display: flex; height: 88px; flex-shrink: 0; align-items: center; gap: 48px; padding: 0 48px; }",
  ".design-mock .ft-wordmark { font-size: 32px; font-weight: 700; letter-spacing: -0.04em; }",
  ".design-mock .ft-wordmark-dot { color: var(--ft-accent); }",
  ".design-mock .ft-nav-links { display: flex; flex: 1; align-items: center; gap: 32px; color: var(--ft-fg-soft); font-size: 17px; font-weight: 500; }",
  ".design-mock .ft-nav-cta { display: flex; height: 48px; flex-shrink: 0; align-items: center; padding: 0 26px; border: 2px solid var(--ft-line-strong); border-radius: 999px; color: var(--ft-fg); font-size: 17px; font-weight: 600; }",
  ".design-mock .ft-nav-menu { margin-left: auto; color: var(--ft-fg-soft); font-size: 16px; font-weight: 600; }",

  // Hero
  ".design-mock .ft-hero { position: relative; display: flex; flex-shrink: 0; align-items: center; gap: 48px; overflow: hidden; margin: 0 24px; padding: 44px 48px; border-radius: 36px; background: var(--ft-hero-bg); color: var(--ft-fg); }",
  // Barely-there glows. At the old 0.7 these were two saturated colour fields;
  // now they only lift the corners of the hero panel off the page.
  ".design-mock .ft-hero-blob { position: absolute; border-radius: 999px; filter: blur(4px); opacity: 0.12; }",
  ".design-mock .ft-hero-blob-a { width: 420px; height: 420px; right: -120px; top: -180px; background: radial-gradient(circle, var(--ft-accent), transparent 68%); }",
  ".design-mock .ft-hero-blob-b { width: 360px; height: 360px; left: -140px; bottom: -200px; background: radial-gradient(circle, #ffffff, transparent 68%); }",
  ".design-mock .ft-hero-copy { position: relative; flex: 1; min-width: 0; }",
  ".design-mock .ft-eyebrow { display: inline-flex; align-items: center; height: 30px; padding: 0 14px; border-radius: 999px; background: rgba(242, 242, 244, 0.08); color: var(--ft-fg-soft); font-size: 14px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }",
  ".design-mock .ft-headline { margin: 20px 0 0; font-size: 68px; font-weight: 700; letter-spacing: -0.04em; line-height: 1.02; }",
  ".design-mock .ft-headline em { color: var(--ft-accent); font-style: italic; }",
  ".design-mock .ft-subhead { margin: 20px 0 0; max-width: 440px; color: var(--ft-fg-soft); font-size: 19px; line-height: 1.5; }",
  ".design-mock .ft-hero-actions { display: flex; align-items: center; gap: 16px; margin-top: 32px; }",
  ".design-mock .ft-cta-ghost { display: flex; height: 52px; align-items: center; padding: 0 24px; border: 2px solid var(--ft-line-strong); border-radius: 999px; color: var(--ft-fg); font-size: 17px; font-weight: 600; }",
  ".design-mock .ft-hero-art { width: 460px; height: 380px; flex-shrink: 0; border-radius: 28px; }",

  // The selected `Start free trial` CTA and its editor chrome.
  ".design-mock .ft-selected { position: relative; width: 160px; }",
  ".design-mock .ft-selected.is-full { width: 100%; }",
  ".design-mock .ft-cta { display: flex; height: 52px; align-items: center; justify-content: center; border-radius: 999px; background: var(--ft-accent); color: var(--ft-ink); font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }",
  `.design-mock .ft-sel-outline { position: absolute; inset: 0; border: ${inverse(1.5)} solid var(--dm-selection); border-radius: 999px; pointer-events: none; }`,
  `.design-mock .ft-sel-handle { position: absolute; z-index: 2; width: ${inverse(7)}; height: ${inverse(7)}; border: ${inverse(1)} solid var(--dm-selection); border-radius: ${inverse(1)}; background: #ffffff; }`,
  `.design-mock .ft-sel-handle-tl { left: ${inverse(-4)}; top: ${inverse(-4)}; }`,
  `.design-mock .ft-sel-handle-tr { right: ${inverse(-4)}; top: ${inverse(-4)}; }`,
  `.design-mock .ft-sel-handle-bl { left: ${inverse(-4)}; bottom: ${inverse(-4)}; }`,
  `.design-mock .ft-sel-handle-br { right: ${inverse(-4)}; bottom: ${inverse(-4)}; }`,
  `.design-mock .ft-sel-badge { position: absolute; left: 50%; top: calc(100% + ${inverse(6)}); z-index: 2; transform: translateX(-50%); padding: ${inverse(2)} ${inverse(6)}; border-radius: ${inverse(3)}; background: var(--dm-selection); color: var(--dm-selection-contrast); font-size: ${inverse(10)}; font-weight: 600; line-height: ${inverse(12)}; font-variant-numeric: tabular-nums; white-space: nowrap; }`,

  // Stat strip
  ".design-mock .ft-stats { display: grid; flex-shrink: 0; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 24px 0; }",
  ".design-mock .ft-stat { display: flex; flex-direction: column; gap: 6px; padding: 24px 26px; border: 2px solid var(--ft-line); border-radius: 24px; background: var(--ft-elevated); }",
  ".design-mock .ft-stat-value { font-size: 44px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }",
  ".design-mock .ft-stat-label { color: var(--ft-fg-soft); font-size: 15px; font-weight: 600; }",

  // Sections
  ".design-mock .ft-section { flex-shrink: 0; padding: 30px 48px 0; }",
  ".design-mock .ft-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }",
  ".design-mock .ft-section-title { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: -0.03em; }",
  ".design-mock .ft-section-link { color: var(--ft-fg-soft); font-size: 16px; font-weight: 600; }",
  ".design-mock .ft-class-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }",
  ".design-mock .ft-class { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 2px solid var(--ft-line); border-radius: 26px; background: var(--ft-elevated); }",
  // Covers are ~345px wide, so 190 keeps the roughly 4:3 photos from being
  // sliced into letterbox strips without pushing the frame into the toolbar.
  ".design-mock .ft-class .ft-slot { height: 190px; border-radius: 18px; }",
  ".design-mock .ft-class-title { font-size: 21px; font-weight: 700; letter-spacing: -0.02em; }",
  ".design-mock .ft-class-meta { color: var(--ft-fg-soft); font-size: 15px; font-weight: 500; }",

  // Plans
  ".design-mock .ft-plan-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }",
  ".design-mock .ft-plan { display: flex; flex-direction: column; gap: 8px; padding: 28px; border: 2px solid var(--ft-line); border-radius: 26px; background: var(--ft-elevated); }",
  // The featured plan is marked with the accent hairline and its price, not a
  // filled panel — a block of accent this large was most of the old glare.
  ".design-mock .ft-plan.is-featured { border-color: var(--ft-accent); }",
  ".design-mock .ft-plan-name { font-size: 17px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.6; }",
  ".design-mock .ft-plan-price { font-size: 50px; font-weight: 700; letter-spacing: -0.04em; line-height: 1.05; }",
  ".design-mock .ft-plan-period { font-size: 18px; font-weight: 600; opacity: 0.5; }",
  ".design-mock .ft-plan.is-featured .ft-plan-price { color: var(--ft-accent); }",
  ".design-mock .ft-plan-meta { color: var(--ft-fg-soft); font-size: 15px; font-weight: 500; }",
  ".design-mock .ft-plan-cta { display: flex; height: 48px; align-items: center; justify-content: center; margin-top: 12px; border: 2px solid var(--ft-line); border-radius: 999px; font-size: 16px; font-weight: 700; }",
  ".design-mock .ft-plan.is-featured .ft-plan-cta { border-color: transparent; background: var(--ft-accent); color: var(--ft-ink); }",

  // Closing band
  ".design-mock .ft-band { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; margin: 28px 24px 24px; padding: 30px 40px; border: 2px solid var(--ft-line); border-radius: 32px; background: var(--ft-elevated); color: var(--ft-fg); }",
  ".design-mock .ft-band-title { font-size: 30px; font-weight: 700; letter-spacing: -0.03em; }",
  ".design-mock .ft-band-cta { display: flex; height: 52px; align-items: center; padding: 0 26px; border-radius: 999px; background: var(--ft-accent); color: var(--ft-ink); font-size: 17px; font-weight: 700; }",

  // Footer
  ".design-mock .ft-footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; margin: 0 48px; padding: 32px 0 40px; border-top: 2px solid var(--ft-line); }",
  ".design-mock .ft-footer-links { display: flex; align-items: center; gap: 28px; color: var(--ft-fg-soft); font-size: 16px; font-weight: 500; }",

  // Mobile breakpoint. Same design, stacked.
  ".design-mock .ft-mobile .ft-nav { height: 68px; gap: 0; padding: 0 20px; }",
  ".design-mock .ft-mobile .ft-wordmark { font-size: 24px; }",
  ".design-mock .ft-mobile .ft-hero { flex-direction: column; align-items: stretch; gap: 24px; margin: 0 16px; padding: 28px 24px; border-radius: 28px; }",
  ".design-mock .ft-mobile .ft-headline { margin-top: 14px; font-size: 38px; }",
  ".design-mock .ft-mobile .ft-subhead { margin-top: 12px; max-width: none; font-size: 15px; }",
  ".design-mock .ft-mobile .ft-selected { margin-top: 22px; }",
  ".design-mock .ft-mobile .ft-hero-art { width: 100%; height: 200px; }",
  ".design-mock .ft-mobile .ft-stats { grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 16px 16px 0; }",
  ".design-mock .ft-mobile .ft-stat { padding: 16px 18px; border-radius: 20px; }",
  ".design-mock .ft-mobile .ft-stat-value { font-size: 30px; }",
  ".design-mock .ft-mobile .ft-stat-label { font-size: 12px; }",
  ".design-mock .ft-mobile .ft-section { padding: 26px 16px 0; }",
  ".design-mock .ft-mobile .ft-section-title { font-size: 24px; }",
  ".design-mock .ft-mobile .ft-section-link { font-size: 13px; }",
  ".design-mock .ft-mobile .ft-class-grid { grid-template-columns: 1fr; gap: 14px; }",
  ".design-mock .ft-mobile .ft-class .ft-slot { height: 170px; }",
  ".design-mock .ft-mobile .ft-class-title { font-size: 17px; }",
  ".design-mock .ft-mobile .ft-class-meta { font-size: 13px; }",
  ".design-mock .ft-mobile .ft-plan-grid { grid-template-columns: 1fr; gap: 14px; }",
  ".design-mock .ft-mobile .ft-plan { gap: 6px; padding: 20px; border-radius: 22px; }",
  ".design-mock .ft-mobile .ft-plan-name { font-size: 13px; }",
  ".design-mock .ft-mobile .ft-plan-price { font-size: 34px; }",
  ".design-mock .ft-mobile .ft-plan-period { font-size: 14px; }",
  ".design-mock .ft-mobile .ft-plan-meta { font-size: 13px; }",
  ".design-mock .ft-mobile .ft-plan-cta { height: 40px; margin-top: 8px; font-size: 14px; }",
  ".design-mock .ft-mobile .ft-band { margin: 22px 16px 24px; padding: 22px; border-radius: 26px; }",
  ".design-mock .ft-mobile .ft-band-title { font-size: 20px; }",
  ".design-mock .ft-mobile .ft-band-cta { height: 42px; padding: 0 18px; font-size: 14px; }",
].join("\n");
