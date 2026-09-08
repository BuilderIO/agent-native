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
export const DESKTOP_ARTBOARD_HEIGHT = 1240;
export const MOBILE_ARTBOARD_WIDTH = 390;
export const MOBILE_ARTBOARD_HEIGHT = 1200;

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
  { value: "12k", label: "Sessions logged", tone: "lime" },
  { value: "48", label: "Live classes weekly", tone: "coral" },
  { value: "94%", label: "Stick with it", tone: "cyan" },
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

function Wordmark({ onDark }: { onDark?: boolean }) {
  return (
    <span className={onDark ? "ft-wordmark is-on-dark" : "ft-wordmark"}>
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
          <div key={stat.label} className={`ft-stat is-${stat.tone}`}>
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

      <section className="ft-band">
        <span className="ft-band-title">Your first two weeks are on us.</span>
        <span className="ft-band-cta">Get started</span>
      </section>
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
          <div key={stat.label} className={`ft-stat is-${stat.tone}`}>
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
    </div>
  );
}

export const DESIGN_FITNESS_CSS = [
  // Palette. Fixed, not theme-derived: this is the user's design sitting on the
  // canvas, so it must look identical whether the editor around it is light or
  // dark — exactly like a real artboard.
  ".design-mock .ft { --ft-ink: #140c2e; --ft-ink-soft: rgba(20, 12, 46, 0.62); --ft-ink-faint: rgba(20, 12, 46, 0.38); --ft-surface: #fffdf8; --ft-card: #ffffff; --ft-line: rgba(20, 12, 46, 0.1); --ft-lime: #d8ff3e; --ft-coral: #ff5b4a; --ft-cyan: #3fe0d0; --ft-violet: #7c4dff; --ft-amber: #ffb020; }",
  ".design-mock .ft { width: 100%; height: 100%; overflow: hidden; background: var(--ft-surface); color: var(--ft-ink); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }",
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
  ".design-mock .ft-wordmark-dot { color: var(--ft-coral); }",
  ".design-mock .ft-wordmark.is-on-dark { color: var(--ft-surface); }",
  ".design-mock .ft-nav-links { display: flex; flex: 1; align-items: center; gap: 32px; color: var(--ft-ink-soft); font-size: 17px; font-weight: 500; }",
  ".design-mock .ft-nav-cta { display: flex; height: 48px; flex-shrink: 0; align-items: center; padding: 0 26px; border-radius: 999px; background: var(--ft-ink); color: var(--ft-surface); font-size: 17px; font-weight: 600; }",
  ".design-mock .ft-nav-menu { margin-left: auto; color: var(--ft-ink-soft); font-size: 16px; font-weight: 600; }",

  // Hero
  ".design-mock .ft-hero { position: relative; display: flex; flex-shrink: 0; align-items: center; gap: 48px; overflow: hidden; margin: 0 24px; padding: 44px 48px; border-radius: 36px; background: var(--ft-ink); color: var(--ft-surface); }",
  ".design-mock .ft-hero-blob { position: absolute; border-radius: 999px; filter: blur(4px); opacity: 0.55; }",
  ".design-mock .ft-hero-blob-a { width: 420px; height: 420px; right: -120px; top: -180px; background: radial-gradient(circle, var(--ft-violet), transparent 68%); }",
  ".design-mock .ft-hero-blob-b { width: 360px; height: 360px; left: -140px; bottom: -200px; background: radial-gradient(circle, var(--ft-cyan), transparent 68%); }",
  ".design-mock .ft-hero-copy { position: relative; flex: 1; min-width: 0; }",
  ".design-mock .ft-eyebrow { display: inline-flex; align-items: center; height: 30px; padding: 0 14px; border-radius: 999px; background: rgba(216, 255, 62, 0.16); color: var(--ft-lime); font-size: 14px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }",
  ".design-mock .ft-headline { margin: 20px 0 0; font-size: 68px; font-weight: 700; letter-spacing: -0.04em; line-height: 1.02; }",
  ".design-mock .ft-headline em { color: var(--ft-lime); font-style: italic; }",
  ".design-mock .ft-subhead { margin: 20px 0 0; max-width: 440px; color: rgba(255, 253, 248, 0.72); font-size: 19px; line-height: 1.5; }",
  ".design-mock .ft-hero-actions { display: flex; align-items: center; gap: 16px; margin-top: 32px; }",
  ".design-mock .ft-cta-ghost { display: flex; height: 52px; align-items: center; padding: 0 24px; border: 2px solid rgba(255, 253, 248, 0.32); border-radius: 999px; color: var(--ft-surface); font-size: 17px; font-weight: 600; }",
  ".design-mock .ft-hero-art { width: 460px; height: 380px; flex-shrink: 0; border-radius: 28px; }",

  // The selected `Start free trial` CTA and its editor chrome.
  ".design-mock .ft-selected { position: relative; width: 160px; }",
  ".design-mock .ft-selected.is-full { width: 100%; }",
  ".design-mock .ft-cta { display: flex; height: 52px; align-items: center; justify-content: center; border-radius: 999px; background: var(--ft-lime); color: var(--ft-ink); font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }",
  `.design-mock .ft-sel-outline { position: absolute; inset: 0; border: ${inverse(1.5)} solid var(--dm-accent); border-radius: 999px; pointer-events: none; }`,
  `.design-mock .ft-sel-handle { position: absolute; z-index: 2; width: ${inverse(7)}; height: ${inverse(7)}; border: ${inverse(1)} solid var(--dm-accent); border-radius: ${inverse(1)}; background: #ffffff; }`,
  `.design-mock .ft-sel-handle-tl { left: ${inverse(-4)}; top: ${inverse(-4)}; }`,
  `.design-mock .ft-sel-handle-tr { right: ${inverse(-4)}; top: ${inverse(-4)}; }`,
  `.design-mock .ft-sel-handle-bl { left: ${inverse(-4)}; bottom: ${inverse(-4)}; }`,
  `.design-mock .ft-sel-handle-br { right: ${inverse(-4)}; bottom: ${inverse(-4)}; }`,
  `.design-mock .ft-sel-badge { position: absolute; left: 50%; top: calc(100% + ${inverse(6)}); z-index: 2; transform: translateX(-50%); padding: ${inverse(2)} ${inverse(6)}; border-radius: ${inverse(3)}; background: var(--dm-accent); color: var(--dm-accent-contrast); font-size: ${inverse(10)}; font-weight: 600; line-height: ${inverse(12)}; font-variant-numeric: tabular-nums; white-space: nowrap; }`,

  // Stat strip
  ".design-mock .ft-stats { display: grid; flex-shrink: 0; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 24px 0; }",
  ".design-mock .ft-stat { display: flex; flex-direction: column; gap: 6px; padding: 24px 26px; border-radius: 24px; }",
  ".design-mock .ft-stat.is-lime { background: var(--ft-lime); }",
  ".design-mock .ft-stat.is-coral { background: var(--ft-coral); color: var(--ft-surface); }",
  ".design-mock .ft-stat.is-cyan { background: var(--ft-cyan); }",
  ".design-mock .ft-stat-value { font-size: 44px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }",
  ".design-mock .ft-stat-label { font-size: 15px; font-weight: 600; opacity: 0.72; }",

  // Sections
  ".design-mock .ft-section { flex-shrink: 0; padding: 30px 48px 0; }",
  ".design-mock .ft-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }",
  ".design-mock .ft-section-title { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: -0.03em; }",
  ".design-mock .ft-section-link { color: var(--ft-violet); font-size: 16px; font-weight: 600; }",
  ".design-mock .ft-class-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }",
  ".design-mock .ft-class { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 2px solid var(--ft-line); border-radius: 26px; background: var(--ft-card); }",
  // Covers are ~345px wide, so 190 keeps the roughly 4:3 photos from being
  // sliced into letterbox strips without pushing the frame into the toolbar.
  ".design-mock .ft-class .ft-slot { height: 190px; border-radius: 18px; }",
  ".design-mock .ft-class-title { font-size: 21px; font-weight: 700; letter-spacing: -0.02em; }",
  ".design-mock .ft-class-meta { color: var(--ft-ink-soft); font-size: 15px; font-weight: 500; }",

  // Closing band
  ".design-mock .ft-band { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; margin: 28px 24px 24px; padding: 30px 40px; border-radius: 32px; background: linear-gradient(100deg, var(--ft-violet), var(--ft-coral) 62%, var(--ft-amber)); color: var(--ft-surface); }",
  ".design-mock .ft-band-title { font-size: 30px; font-weight: 700; letter-spacing: -0.03em; }",
  ".design-mock .ft-band-cta { display: flex; height: 52px; align-items: center; padding: 0 26px; border-radius: 999px; background: var(--ft-surface); color: var(--ft-ink); font-size: 17px; font-weight: 700; }",

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
].join("\n");
