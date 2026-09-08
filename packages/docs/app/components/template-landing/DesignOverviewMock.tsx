/**
 * Static, decorative recreation of the Design editor's overview board — a set
 * of screen variants on the canvas with one frame selected and one still
 * generating — used as landing-page hero art.
 *
 * All CSS lives here, scoped under `.design-mock`. The real stylesheet
 * (templates/design/app/global.css) is deliberately NOT imported: it declares
 * `:root`/`html`/`body` palette rules that would reskin the whole docs site.
 * The custom properties below mirror the editor's tokens by hand instead.
 *
 * The screens inside each frame are authored at a logical 1440x900 and scaled
 * by BOARD_SCALE, so type and spacing shrink in the same proportion a real
 * board zoom would produce rather than being faked with tiny font sizes.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (fake screen names, placeholder marketing copy
 * inside the artboards, panel labels). Translating them across 11 catalogs would
 * add churn with nothing to show for it, since the localized alt text is what a
 * non-English reader actually gets.
 */
import {
  IconAssembly,
  IconChevronDown,
  IconCode,
  IconDeviceMobile,
  IconFile,
  IconFileImport,
  IconFrame,
  IconHandClick,
  IconLayoutGrid,
  IconMessage,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconPointer,
  IconPuzzle,
  IconScribble,
  IconSquare,
  IconTransformPoint,
  IconTypography,
  IconVectorBezier,
  IconViewportWide,
} from "@tabler/icons-react";

/** Logical artboard size the desktop mini screens are authored at. */
const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 900;
/** Board zoom. Matches the `20%` readout in the inspector. */
const BOARD_SCALE = 0.2;

const FRAME_WIDTH = Math.round(SCREEN_WIDTH * BOARD_SCALE);
const FRAME_HEIGHT = Math.round(SCREEN_HEIGHT * BOARD_SCALE);
const FRAME_LABEL_HEIGHT = 28;
const FRAME_COLUMN_GAP = 24;
const FRAME_ROW_GAP = 32;

// Two columns by three rows. The rail, screens panel, and inspector claim a
// fixed 584px, so a third column would fall outside the canvas entirely.
const COLUMN_X = [0, FRAME_WIDTH + FRAME_COLUMN_GAP];
const ROW_HEIGHT = FRAME_LABEL_HEIGHT + FRAME_HEIGHT + FRAME_ROW_GAP;
const ROW_Y = [0, ROW_HEIGHT, ROW_HEIGHT * 2];

const RAIL_ITEMS = [
  { label: "File", icon: IconFile, active: true },
  { label: "Agent", icon: IconMessage },
  { label: "Assets", icon: IconPhoto },
  { label: "Import", icon: IconFileImport },
  { label: "Tools", icon: IconPuzzle },
  { label: "Tokens", icon: IconAssembly },
];

const SCREEN_ROWS = [
  { label: "Landing — v1" },
  { label: "Landing — v2", active: true },
  { label: "Pricing" },
  { label: "Dashboard" },
  { label: "Landing — v3", badge: "Draft" },
];

const TOOLBAR_TOOLS = [
  { icon: IconPointer, active: true },
  { icon: IconFrame },
  { icon: IconSquare },
  { icon: IconVectorBezier },
  { icon: IconTypography },
  { icon: IconMessage },
];

const TOOLBAR_MODES = [
  { icon: IconScribble },
  { icon: IconTransformPoint, active: true },
  { icon: IconHandClick },
];

function WorkspaceRail() {
  return (
    <div className="dm-rail">
      <div className="dm-rail-project" />
      <div className="dm-rail-divider" />
      {RAIL_ITEMS.map(({ label, icon: Icon, active }) => (
        <div
          key={label}
          className={active ? "dm-rail-item is-active" : "dm-rail-item"}
        >
          <span className="dm-rail-icon">
            <Icon size={16} />
          </span>
          <span className="dm-rail-label">{label}</span>
        </div>
      ))}
      <div className="dm-rail-separator" />
      <div className="dm-rail-item">
        <span className="dm-rail-icon">
          <IconCode size={16} />
        </span>
        <span className="dm-rail-label">Code</span>
      </div>
    </div>
  );
}

function ScreensPanel() {
  return (
    <div className="dm-panel">
      <div className="dm-panel-header">
        <span className="dm-design-name">Acme marketing site</span>
      </div>
      <div className="dm-section-header">
        <span className="dm-section-title">Screens</span>
        <span className="dm-section-action">
          <IconPlus size={16} />
        </span>
      </div>
      <div className="dm-panel-body">
        <div className="dm-row">
          <IconLayoutGrid size={16} className="dm-row-glyph" />
          <span className="dm-row-label">All screens</span>
        </div>
        <div className="dm-row-divider" />
        <div className="dm-row-list">
          {SCREEN_ROWS.map((row) => (
            <div
              key={row.label}
              className={row.active ? "dm-row is-active" : "dm-row"}
            >
              <IconFile size={16} className="dm-row-glyph" />
              <span className="dm-row-label">{row.label}</span>
              {row.badge ? (
                <span className="dm-row-badge">{row.badge}</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Inspector() {
  return (
    <div className="dm-inspector">
      <div className="dm-inspector-toprow">
        <div className="dm-collaborators">
          <span className="dm-avatar dm-avatar-1">PS</span>
          <span className="dm-avatar dm-avatar-2">TL</span>
          <span className="dm-avatar dm-avatar-3">ID</span>
        </div>
        <div className="dm-preview-btn">
          <IconPlayerPlay size={20} />
          <IconChevronDown size={12} />
        </div>
        <div className="dm-share-btn">Share</div>
      </div>

      <div className="dm-inspector-toprow">
        <div className="dm-segmented">
          <span className="dm-segment is-active">
            <IconViewportWide size={14} />
          </span>
          <span className="dm-segment">
            <IconDeviceMobile size={12} />
            <span>390</span>
          </span>
        </div>
        <div className="dm-zoom">
          <span>20%</span>
          <IconChevronDown size={10} />
        </div>
      </div>

      <div className="dm-inspector-context">
        <IconFrame size={14} className="dm-context-glyph" />
        <span className="dm-context-title">Landing — v2</span>
      </div>

      <div className="dm-inspector-section">
        <div className="dm-inspector-section-title">Position</div>
        <div className="dm-field-row">
          <div className="dm-field">
            <span className="dm-field-label">X</span>
            <span className="dm-field-value">1520px</span>
          </div>
          <div className="dm-field">
            <span className="dm-field-label">Y</span>
            <span className="dm-field-value">0px</span>
          </div>
        </div>
      </div>

      <div className="dm-inspector-section">
        <div className="dm-inspector-section-title">Size</div>
        <div className="dm-field-row">
          <div className="dm-field">
            <span className="dm-field-label">W</span>
            <span className="dm-field-value">1440px</span>
          </div>
          <div className="dm-field">
            <span className="dm-field-label">H</span>
            <span className="dm-field-value">900px</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BottomToolbar() {
  return (
    <div className="dm-toolbar">
      {TOOLBAR_TOOLS.map(({ icon: Icon, active }, index) => (
        <span
          // Icon identity is the only distinguishing value in this static list.
          key={index}
          className={active ? "dm-tool is-active" : "dm-tool"}
        >
          <Icon size={18} />
        </span>
      ))}
      <span className="dm-toolbar-divider" />
      <span className="dm-mode-group">
        {TOOLBAR_MODES.map(({ icon: Icon, active }, index) => (
          <span
            key={index}
            className={active ? "dm-mode is-active" : "dm-mode"}
          >
            <Icon size={18} />
          </span>
        ))}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Mini screens. Each is authored at a logical 1440x900 and scaled by the board
 * transform, so every value below is in artboard pixels, not screen pixels.
 * ------------------------------------------------------------------------- */

function ScreenNav({ cta }: { cta: string }) {
  return (
    <div className="ms-nav">
      <span className="ms-logo" />
      <span className="ms-navlinks">
        <span />
        <span />
        <span />
      </span>
      <span className="ms-nav-cta">{cta}</span>
    </div>
  );
}

function LandingV1() {
  return (
    <div className="ms ms-light">
      <ScreenNav cta="Sign up" />
      <div className="ms-v1-body">
        <div className="ms-v1-copy">
          <span className="ms-eyebrow">New · 2024</span>
          <h2 className="ms-h1">Ship the interface you sketched.</h2>
          <p className="ms-sub">
            Prototype, compare, and hand off real markup — no redraw step.
          </p>
          <span className="ms-cta">Start designing</span>
        </div>
        <div className="ms-v1-art">
          <span className="ms-v1-art-bar" />
          <span className="ms-v1-art-bar ms-v1-art-bar-short" />
          <span className="ms-v1-art-block" />
        </div>
      </div>
      <div className="ms-v1-cards">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function LandingV2() {
  return (
    <div className="ms ms-dark">
      <ScreenNav cta="Get access" />
      <div className="ms-v2-body">
        <span className="ms-eyebrow ms-eyebrow-accent">
          Design, agent-native
        </span>
        <h2 className="ms-h1 ms-h1-xl">
          Sketch it once.
          <br />
          Ship the real thing.
        </h2>
        <p className="ms-sub">
          Generate interactive prototypes, compare directions side by side, and
          export the source you already own.
        </p>
        <div className="ms-v2-actions">
          <span className="ms-cta">Start designing</span>
          <span className="ms-cta ms-cta-ghost">See an example</span>
        </div>
      </div>
      <div className="ms-v2-panel">
        <span className="ms-v2-panel-row" />
        <span className="ms-v2-panel-row ms-v2-panel-row-mid" />
        <span className="ms-v2-panel-row ms-v2-panel-row-short" />
      </div>
    </div>
  );
}

function PricingScreen() {
  return (
    <div className="ms ms-light">
      <ScreenNav cta="Sign up" />
      <div className="ms-pricing-head">
        <h2 className="ms-h2">Simple, honest pricing</h2>
        <p className="ms-sub">Every plan includes the full source.</p>
      </div>
      <div className="ms-pricing-grid">
        {["Free", "Team", "Scale"].map((tier, index) => (
          <div
            key={tier}
            className={
              index === 1 ? "ms-price-card is-featured" : "ms-price-card"
            }
          >
            <span className="ms-price-tier">{tier}</span>
            <span className="ms-price-amount">
              {["$0", "$24", "$79"][index]}
            </span>
            <span className="ms-price-line" />
            <span className="ms-price-line" />
            <span className="ms-price-line ms-price-line-short" />
            <span className="ms-price-cta">Choose</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardScreen() {
  return (
    <div className="ms ms-app">
      <div className="ms-app-sidebar">
        <span className="ms-app-logo" />
        <span className="ms-app-navitem is-active" />
        <span className="ms-app-navitem" />
        <span className="ms-app-navitem" />
        <span className="ms-app-navitem" />
      </div>
      <div className="ms-app-main">
        <div className="ms-app-topbar">
          <span className="ms-app-title">Overview</span>
          <span className="ms-app-search" />
        </div>
        <div className="ms-app-stats">
          <span />
          <span />
          <span />
        </div>
        <div className="ms-app-chart">
          {[46, 68, 34, 82, 58, 92, 71, 50].map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function GeneratingScreen() {
  return (
    <div className="ms ms-generating">
      <div className="ms-generating-tile">
        <span className="dm-spinner" />
      </div>
      <span className="ms-generating-label">Generating</span>
    </div>
  );
}

type BoardFrame = {
  label: string;
  x: number;
  y: number;
  screen: React.ReactNode;
  selected?: boolean;
  badge?: string;
  /** Skip the scaled artboard wrapper for states drawn at frame scale. */
  unscaled?: boolean;
};

const BOARD_FRAMES: BoardFrame[] = [
  {
    label: "Landing — v1",
    x: COLUMN_X[0],
    y: ROW_Y[0],
    screen: <LandingV1 />,
  },
  {
    label: "Landing — v2",
    x: COLUMN_X[1],
    y: ROW_Y[0],
    screen: <LandingV2 />,
    selected: true,
    badge: "Review candidate",
  },
  {
    label: "Pricing",
    x: COLUMN_X[0],
    y: ROW_Y[1],
    screen: <PricingScreen />,
  },
  {
    label: "Dashboard",
    x: COLUMN_X[1],
    y: ROW_Y[1],
    screen: <DashboardScreen />,
  },
  {
    label: "Landing — v3",
    x: COLUMN_X[0],
    y: ROW_Y[2],
    screen: <GeneratingScreen />,
    unscaled: true,
  },
];

function BoardFrameView({ frame }: { frame: BoardFrame }) {
  return (
    <div
      className={frame.selected ? "dm-frame is-selected" : "dm-frame"}
      style={{ left: frame.x, top: frame.y }}
    >
      <div className="dm-frame-label">
        <span className="dm-frame-label-text">{frame.label}</span>
        {frame.badge ? (
          <span className="dm-frame-badge">
            <span className="dm-frame-badge-dot" />
            {frame.badge}
          </span>
        ) : null}
      </div>
      <div className="dm-frame-body">
        {frame.unscaled ? (
          frame.screen
        ) : (
          <div className="dm-artboard">{frame.screen}</div>
        )}
        {frame.selected ? (
          <>
            <span className="dm-frame-outline" />
            <span className="dm-handle dm-handle-tl" />
            <span className="dm-handle dm-handle-tr" />
            <span className="dm-handle dm-handle-bl" />
            <span className="dm-handle dm-handle-br" />
          </>
        ) : null}
      </div>
    </div>
  );
}

const DESIGN_MOCK_CSS = [
  // Shell. The hero container sets the height; the window fills the padded box.
  ".design-mock { position: relative; width: 100%; padding: 0 20px 28px; overflow: hidden; }",
  ".design-mock, .design-mock * { box-sizing: border-box; }",
  ".design-mock-frame { position: relative; height: 100%; }",

  // Palette, mirroring templates/design/app/global.css. Dark by default; the
  // `html.light` block below swaps the whole mock when the docs shell is light.
  ".design-mock { --dm-panel-bg: hsl(0 0% 13%); --dm-divider: hsl(0 0% 22%); --dm-border: hsl(0 0% 24%); --dm-canvas-bg: hsl(0 0% 10%); --dm-fg: hsl(0 0% 90%); --dm-fg-muted: hsl(0 0% 60%); --dm-control-bg: hsl(0 0% 18%); --dm-active-row: hsl(0 0% 20%); --dm-hover: rgba(255, 255, 255, 0.08); --dm-selection: rgba(10, 154, 255, 0.24); --dm-badge-bg: hsl(0 0% 16%); --dm-accent: hsl(205 100% 53%); --dm-accent-contrast: #ffffff; --dm-avatar-border: hsl(0 0% 13%); }",

  // Window
  ".design-mock .dm-window { position: absolute; inset: 0; display: flex; overflow: hidden; border-radius: 12px; border: 1px solid var(--dm-divider); background: var(--dm-panel-bg); color: var(--dm-fg); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",

  // Left icon rail — 64px, 48px buttons with a label under the glyph.
  ".design-mock .dm-rail { display: flex; width: 64px; flex-shrink: 0; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0; border-right: 1px solid var(--dm-divider); background: var(--dm-panel-bg); }",
  ".design-mock .dm-rail-project { width: 32px; height: 32px; border-radius: 8px; background: var(--dm-control-bg); }",
  ".design-mock .dm-rail-divider { width: 32px; height: 1px; background: var(--dm-border); }",
  ".design-mock .dm-rail-item { display: flex; width: 48px; height: 48px; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-radius: 8px; color: var(--dm-fg-muted); }",
  ".design-mock .dm-rail-item.is-active { background: var(--dm-selection); color: var(--dm-fg); }",
  ".design-mock .dm-rail-item.is-active .dm-rail-icon { color: var(--dm-accent); }",
  ".design-mock .dm-rail-icon { display: flex; width: 24px; height: 24px; align-items: center; justify-content: center; }",
  ".design-mock .dm-rail-label { max-width: 100%; overflow: hidden; padding: 0 4px; font-size: 11px; font-weight: 450; line-height: 1; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-rail-separator { width: 32px; height: 1px; margin: 4px 0 8px; background: var(--dm-border); }",

  // Screens panel — 280px
  ".design-mock .dm-panel { display: flex; width: 280px; flex-shrink: 0; flex-direction: column; border-right: 1px solid var(--dm-divider); background: var(--dm-panel-bg); }",
  ".design-mock .dm-panel-header { display: flex; height: 40px; flex-shrink: 0; align-items: center; gap: 4px; padding: 0 8px; border-bottom: 1px solid var(--dm-border); }",
  ".design-mock .dm-design-name { overflow: hidden; font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-section-header { display: flex; height: 40px; flex-shrink: 0; align-items: center; justify-content: space-between; padding: 0 12px; }",
  ".design-mock .dm-section-title { font-size: 12px; font-weight: 600; }",
  ".design-mock .dm-section-action { display: flex; color: var(--dm-fg-muted); }",
  ".design-mock .dm-panel-body { flex: 1; min-height: 0; overflow: hidden; padding-bottom: 8px; }",
  ".design-mock .dm-row { display: flex; height: 32px; align-items: center; gap: 8px; margin: 0 8px; padding: 0 8px; border-radius: 5px; font-size: 12px; font-weight: 600; color: var(--dm-fg); }",
  ".design-mock .dm-row.is-active { background: var(--dm-active-row); }",
  ".design-mock .dm-row-glyph { flex-shrink: 0; color: var(--dm-fg-muted); }",
  ".design-mock .dm-row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-row-badge { flex-shrink: 0; padding: 0 4px; border-radius: 2px; background: var(--dm-badge-bg); color: var(--dm-fg-muted); font-size: 10px; font-weight: 400; }",
  ".design-mock .dm-row-divider { margin: 8px 12px; border-top: 1px solid var(--dm-border); }",
  ".design-mock .dm-row-list { display: flex; flex-direction: column; gap: 2px; }",

  // Canvas
  ".design-mock .dm-canvas { position: relative; flex: 1; min-width: 0; overflow: hidden; background: var(--dm-canvas-bg); }",
  `.design-mock .dm-board { position: absolute; left: 24px; top: 40px; width: ${COLUMN_X[1] + FRAME_WIDTH}px; }`,

  // Screen frames. Square corners are intentional: the real editor avoids a
  // card radius because it would read as a document corner radius.
  `.design-mock .dm-frame { position: absolute; width: ${FRAME_WIDTH}px; }`,
  `.design-mock .dm-frame-label { display: flex; height: ${FRAME_LABEL_HEIGHT}px; align-items: center; gap: 6px; padding-left: 4px; color: var(--dm-fg-muted); }`,
  ".design-mock .dm-frame.is-selected .dm-frame-label { color: var(--dm-fg); }",
  ".design-mock .dm-frame-label-text { min-width: 0; overflow: hidden; font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-frame-badge { display: flex; height: 20px; flex-shrink: 0; align-items: center; gap: 4px; padding: 0 6px; border: 1px solid var(--dm-border); border-radius: 999px; background: var(--dm-panel-bg); color: var(--dm-fg); font-size: 9px; font-weight: 500; }",
  ".design-mock .dm-frame-badge-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--dm-fg); }",
  `.design-mock .dm-frame-body { position: relative; height: ${FRAME_HEIGHT}px; overflow: hidden; background: #ffffff; box-shadow: inset 0 0 0 1px var(--dm-border); }`,
  ".design-mock .dm-frame-outline { position: absolute; inset: 0; border: 1.5px solid var(--dm-accent); pointer-events: none; }",
  ".design-mock .dm-handle { position: absolute; z-index: 2; width: 8px; height: 8px; border: 1px solid var(--dm-accent); border-radius: 2px; background: var(--dm-accent-contrast); }",
  ".design-mock .dm-handle-tl { left: -4px; top: -4px; }",
  ".design-mock .dm-handle-tr { right: -4px; top: -4px; }",
  ".design-mock .dm-handle-bl { left: -4px; bottom: -4px; }",
  ".design-mock .dm-handle-br { right: -4px; bottom: -4px; }",
  `.design-mock .dm-artboard { width: ${SCREEN_WIDTH}px; height: ${SCREEN_HEIGHT}px; transform: scale(${BOARD_SCALE}); transform-origin: top left; }`,

  // Generating frame, mirroring GenerationStatusCard.
  ".design-mock .ms-generating { display: flex; height: 100%; flex-direction: column; align-items: center; justify-content: center; background: var(--dm-panel-bg); }",
  ".design-mock .ms-generating-tile { display: flex; width: 48px; height: 48px; align-items: center; justify-content: center; margin-bottom: 16px; border: 1px solid var(--dm-divider); border-radius: 12px; background: var(--dm-panel-bg); box-shadow: 0 18px 50px -34px rgba(0, 0, 0, 0.8); }",
  ".design-mock .ms-generating-label { color: var(--dm-fg-muted); font-size: 14px; }",
  ".design-mock .dm-spinner { display: block; width: 20px; height: 20px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 999px; color: var(--dm-fg-muted); opacity: 0.5; animation: dm-spin 900ms linear infinite; }",
  "@keyframes dm-spin { to { transform: rotate(360deg); } }",
  "@media (prefers-reduced-motion: reduce) { .design-mock .dm-spinner { animation: none; } }",

  // Right inspector — 240px
  ".design-mock .dm-inspector { display: flex; width: 240px; flex-shrink: 0; flex-direction: column; border-left: 1px solid var(--dm-divider); background: var(--dm-panel-bg); }",
  ".design-mock .dm-inspector-toprow { display: flex; height: 40px; flex-shrink: 0; align-items: center; gap: 6px; padding: 0 8px; }",
  ".design-mock .dm-collaborators { display: flex; height: 32px; align-items: center; padding-right: 4px; }",
  ".design-mock .dm-avatar { display: flex; width: 28px; height: 28px; align-items: center; justify-content: center; border: 2px solid var(--dm-avatar-border); border-radius: 999px; color: #ffffff; font-size: 10px; font-weight: 600; }",
  ".design-mock .dm-avatar + .dm-avatar { margin-left: -8px; }",
  ".design-mock .dm-avatar-1 { background: #7c6ff0; }",
  ".design-mock .dm-avatar-2 { background: #2f9e6d; }",
  ".design-mock .dm-avatar-3 { background: #c9613f; }",
  ".design-mock .dm-preview-btn { display: flex; height: 32px; align-items: center; gap: 2px; margin-left: auto; padding: 0 8px; border-radius: 6px; color: var(--dm-fg); }",
  ".design-mock .dm-share-btn { display: flex; height: 32px; align-items: center; padding: 0 12px; border-radius: 6px; background: var(--dm-accent); color: var(--dm-accent-contrast); font-size: 14px; font-weight: 500; }",
  ".design-mock .dm-segmented { display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 6px; background: var(--dm-control-bg); }",
  ".design-mock .dm-segment { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 6px; border-radius: 5px; color: var(--dm-fg-muted); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }",
  ".design-mock .dm-segment.is-active { background: var(--dm-panel-bg); color: var(--dm-accent); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18); }",
  ".design-mock .dm-zoom { display: flex; height: 24px; align-items: center; gap: 2px; margin-left: auto; padding: 0 4px; color: var(--dm-fg-muted); font-size: 10px; font-variant-numeric: tabular-nums; }",
  ".design-mock .dm-inspector-context { display: flex; min-height: 32px; flex-shrink: 0; align-items: center; gap: 6px; padding: 0 12px; border-top: 1px solid var(--dm-border); border-bottom: 1px solid var(--dm-border); }",
  ".design-mock .dm-context-glyph { flex-shrink: 0; color: var(--dm-fg-muted); }",
  ".design-mock .dm-context-title { overflow: hidden; font-size: 13px; font-weight: 600; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-inspector-section { padding: 8px; }",
  ".design-mock .dm-inspector-section-title { margin-bottom: 8px; font-size: 11px; font-weight: 600; color: var(--dm-fg-muted); }",
  ".design-mock .dm-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }",
  ".design-mock .dm-field { display: flex; height: 24px; align-items: center; gap: 6px; padding: 0 6px; border: 1px solid var(--dm-border); border-radius: 5px; background: var(--dm-control-bg); }",
  ".design-mock .dm-field-label { color: var(--dm-fg-muted); font-size: 11px; font-weight: 500; }",
  ".design-mock .dm-field-value { overflow: hidden; font-size: 11px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }",

  // Floating bottom toolbar. Pinned to the dark palette in both themes, exactly
  // like the real toolbar.
  ".design-mock .dm-toolbar { position: absolute; bottom: 16px; left: 50%; z-index: 3; display: flex; max-width: calc(100% - 32px); transform: translateX(-50%); align-items: center; gap: 6px; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; background: rgba(44, 44, 44, 0.95); color: #f5f5f5; box-shadow: 0 22px 55px -24px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.25); backdrop-filter: blur(8px); }",
  ".design-mock .dm-tool { display: flex; width: 32px; height: 32px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 6px; color: #e5e5e5; }",
  ".design-mock .dm-tool.is-active { background: var(--dm-accent); color: #ffffff; }",
  ".design-mock .dm-toolbar-divider { width: 1px; height: 36px; flex-shrink: 0; background: rgba(255, 255, 255, 0.15); }",
  ".design-mock .dm-mode-group { display: flex; flex-shrink: 0; align-items: center; gap: 2px; padding: 2px; border-radius: 6px; background: rgba(255, 255, 255, 0.1); }",
  ".design-mock .dm-mode { display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 6px; color: #d4d4d4; }",
  ".design-mock .dm-mode.is-active { background: rgba(3, 3, 3, 0.7); color: #38bdf8; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 18px -12px rgba(0, 0, 0, 0.95); }",

  /* ----- Mini screens. Values are artboard pixels at 1440x900. ----- */
  ".design-mock .ms { width: 100%; height: 100%; overflow: hidden; font-family: 'Inter Variable', 'Inter', sans-serif; }",
  // The docs shell colors every h1-h4 directly, so an artboard heading would
  // pick up the docs foreground instead of its own palette. Same for prose
  // paragraphs. Re-inherit explicitly; `currentColor` fills depend on it.
  ".design-mock .ms h2, .design-mock .ms p { color: inherit; }",
  ".design-mock .ms-light { background: #fbfaf8; color: #17161a; }",
  ".design-mock .ms-dark { background: #101014; color: #f4f4f6; }",
  ".design-mock .ms-app { display: flex; background: #f4f4f6; color: #17161a; }",

  // Shared nav
  ".design-mock .ms-nav { display: flex; height: 88px; align-items: center; gap: 56px; padding: 0 80px; }",
  ".design-mock .ms-logo { width: 116px; height: 22px; border-radius: 6px; background: currentColor; opacity: 0.85; }",
  ".design-mock .ms-navlinks { display: flex; flex: 1; align-items: center; gap: 40px; }",
  ".design-mock .ms-navlinks span { width: 78px; height: 12px; border-radius: 6px; background: currentColor; opacity: 0.28; }",
  ".design-mock .ms-nav-cta { padding: 14px 28px; border-radius: 10px; background: currentColor; color: transparent; font-size: 20px; font-weight: 600; }",

  // Shared type
  ".design-mock .ms-eyebrow { display: inline-block; font-size: 20px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.5; }",
  ".design-mock .ms-eyebrow-accent { color: #7dd3fc; opacity: 1; }",
  ".design-mock .ms-h1 { margin: 24px 0 0; font-size: 72px; font-weight: 600; line-height: 1.04; letter-spacing: -0.03em; }",
  ".design-mock .ms-h1-xl { font-size: 92px; }",
  ".design-mock .ms-h2 { margin: 0; font-size: 56px; font-weight: 600; line-height: 1.08; letter-spacing: -0.02em; }",
  ".design-mock .ms-sub { margin: 28px 0 0; max-width: 620px; font-size: 24px; line-height: 1.45; opacity: 0.62; }",
  ".design-mock .ms-cta { display: inline-block; margin-top: 40px; padding: 20px 40px; border-radius: 12px; background: currentColor; color: transparent; font-size: 22px; font-weight: 600; }",
  ".design-mock .ms-cta-ghost { background: transparent; border: 2px solid currentColor; color: currentColor; opacity: 0.45; }",

  // Landing v1
  ".design-mock .ms-v1-body { display: flex; align-items: flex-start; gap: 72px; padding: 60px 80px 0; }",
  ".design-mock .ms-v1-copy { flex: 1; min-width: 0; }",
  ".design-mock .ms-v1-art { display: flex; width: 480px; flex-shrink: 0; flex-direction: column; gap: 20px; padding: 32px; border-radius: 20px; background: #17161a; }",
  ".design-mock .ms-v1-art-bar { height: 20px; border-radius: 10px; background: #fbfaf8; opacity: 0.85; }",
  ".design-mock .ms-v1-art-bar-short { width: 58%; opacity: 0.45; }",
  ".design-mock .ms-v1-art-block { height: 220px; border-radius: 14px; background: linear-gradient(135deg, #f472b6, #7c6ff0); }",
  ".design-mock .ms-v1-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; padding: 72px 80px 0; }",
  ".design-mock .ms-v1-cards span { height: 140px; border-radius: 16px; border: 2px solid rgba(23, 22, 26, 0.1); background: #ffffff; }",

  // Landing v2
  ".design-mock .ms-v2-body { padding: 72px 80px 0; }",
  ".design-mock .ms-v2-actions { display: flex; align-items: center; gap: 24px; }",
  ".design-mock .ms-v2-panel { display: flex; flex-direction: column; gap: 20px; margin: 80px 80px 0; padding: 40px; border: 2px solid rgba(244, 244, 246, 0.12); border-radius: 20px; background: #17171d; }",
  ".design-mock .ms-v2-panel-row { height: 24px; border-radius: 12px; background: #f4f4f6; opacity: 0.16; }",
  ".design-mock .ms-v2-panel-row-mid { width: 72%; }",
  ".design-mock .ms-v2-panel-row-short { width: 44%; }",

  // Pricing
  ".design-mock .ms-pricing-head { padding: 72px 80px 0; text-align: center; }",
  ".design-mock .ms-pricing-head .ms-sub { margin-left: auto; margin-right: auto; }",
  ".design-mock .ms-pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; padding: 64px 80px 0; }",
  ".design-mock .ms-price-card { display: flex; flex-direction: column; gap: 20px; padding: 40px 32px; border: 2px solid rgba(23, 22, 26, 0.1); border-radius: 20px; background: #ffffff; }",
  ".design-mock .ms-price-card.is-featured { border-color: #f472b6; }",
  ".design-mock .ms-price-tier { font-size: 22px; font-weight: 600; opacity: 0.55; }",
  ".design-mock .ms-price-amount { font-size: 60px; font-weight: 600; letter-spacing: -0.02em; }",
  ".design-mock .ms-price-line { height: 14px; border-radius: 7px; background: rgba(23, 22, 26, 0.12); }",
  ".design-mock .ms-price-line-short { width: 60%; }",
  ".design-mock .ms-price-cta { margin-top: 12px; padding: 18px 0; border-radius: 12px; background: #17161a; color: transparent; font-size: 20px; font-weight: 600; text-align: center; }",

  // Dashboard
  ".design-mock .ms-app-sidebar { display: flex; width: 260px; flex-shrink: 0; flex-direction: column; gap: 16px; padding: 32px 24px; background: #ffffff; border-right: 2px solid rgba(23, 22, 26, 0.08); }",
  ".design-mock .ms-app-logo { width: 120px; height: 24px; margin-bottom: 24px; border-radius: 8px; background: #17161a; }",
  ".design-mock .ms-app-navitem { height: 44px; border-radius: 10px; background: rgba(23, 22, 26, 0.06); }",
  ".design-mock .ms-app-navitem.is-active { background: rgba(244, 114, 182, 0.24); }",
  ".design-mock .ms-app-main { display: flex; flex: 1; min-width: 0; flex-direction: column; padding: 32px 40px; }",
  ".design-mock .ms-app-topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; }",
  ".design-mock .ms-app-title { font-size: 40px; font-weight: 600; letter-spacing: -0.02em; }",
  ".design-mock .ms-app-search { width: 280px; height: 44px; border-radius: 10px; background: #ffffff; }",
  ".design-mock .ms-app-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 32px; }",
  ".design-mock .ms-app-stats span { height: 128px; border-radius: 16px; background: #ffffff; }",
  ".design-mock .ms-app-chart { display: flex; flex: 1; align-items: flex-end; gap: 20px; padding: 32px; border-radius: 16px; background: #ffffff; }",
  ".design-mock .ms-app-chart span { flex: 1; border-radius: 8px 8px 0 0; background: linear-gradient(180deg, #f472b6, rgba(244, 114, 182, 0.35)); }",

  // Light mode. The docs shell puts `light`/`dark` on <html>, so the mock
  // follows the visitor's theme instead of staying pinned to the dark art.
  "html.light .design-mock { --dm-panel-bg: hsl(0 0% 100%); --dm-divider: hsl(0 0% 90%); --dm-border: hsl(0 0% 90%); --dm-canvas-bg: hsl(0 0% 92%); --dm-fg: hsl(0 0% 10%); --dm-fg-muted: hsl(0 0% 45%); --dm-control-bg: hsl(0 0% 95%); --dm-active-row: rgba(38, 38, 38, 0.08); --dm-hover: rgba(38, 38, 38, 0.06); --dm-selection: rgba(10, 154, 255, 0.14); --dm-badge-bg: hsl(0 0% 95%); --dm-avatar-border: hsl(0 0% 100%); }",

  // Narrow screens. The window is a fixed-width layout, so the whole mock
  // scales down and anchors to the left edge rather than letting the canvas
  // collapse to nothing. This block stays last: it has the same specificity as
  // the base rules above and would otherwise lose to them on source order.
  "@media (max-width: 860px) { .design-mock { padding: 0 16px 18px; } .design-mock .dm-window { width: 1180px; height: 700px; inset: auto; transform: scale(0.52); transform-origin: top left; } }",
].join("\n");

export function DesignOverviewMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={`design-mock ${className}`} role="img" aria-label={label}>
      <style>{DESIGN_MOCK_CSS}</style>
      <div className="design-mock-frame" aria-hidden="true">
        <div className="dm-window">
          <WorkspaceRail />
          <ScreensPanel />
          <div className="dm-canvas">
            <div className="dm-board">
              {BOARD_FRAMES.map((frame) => (
                <BoardFrameView key={frame.label} frame={frame} />
              ))}
            </div>
            <BottomToolbar />
          </div>
          <Inspector />
        </div>
      </div>
    </div>
  );
}
