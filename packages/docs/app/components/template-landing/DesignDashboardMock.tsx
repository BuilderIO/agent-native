/**
 * Static, decorative recreation of an internal dashboard on the Design canvas
 * with the linked design system open beside it — used as the art for the
 * "Design dashboards and internal tools" use-case row on the Design landing
 * page.
 *
 * The panel is the point of the picture: a dashboard on its own would say "made
 * a screen", and the row's promise is that an internal tool comes out on brand
 * because the colours, type, and radii it uses are the ones the design system
 * declares.
 *
 * The design is a fictional `ledger` billing-operations console, deliberately
 * not the hero's `pulse` brand, the variants row's `kettle`, or the flow row's
 * `atlas`, so the three use-case pictures do not read as one screenshot cropped
 * three ways.
 *
 * All CSS lives here, scoped under `.design-dashboard-mock`. The real Design
 * stylesheet (templates/design/app/global.css) is deliberately NOT imported: it
 * declares `:root`/`html`/`body` palette rules that would reskin the whole docs
 * site.
 *
 * Every length inside the board is an artboard pixel: the board is authored at
 * BOARD_WIDTH and multiplied by `--dd-scale`, so type and spacing shrink in the
 * proportion a real board zoom would produce rather than being faked with tiny
 * font sizes. The panel beside it is chrome and stays at screen scale.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (a fake brand's fake admin console).
 */
import { IconChevronDown } from "@tabler/icons-react";

const BOARD_WIDTH = 1100;

const BOARD_BODY_HEIGHT = 300;

const SIDEBAR_ITEMS = [
  { label: "Overview", active: true },
  { label: "Invoices" },
  { label: "Disputes" },
  { label: "Payouts" },
  { label: "Customers" },
  { label: "Audit log" },
];

const METRICS = [
  { label: "Open invoices", value: "1,284", delta: "+6.2%" },
  { label: "Overdue", value: "$41.8k", delta: "−12%" },
  { label: "Collected this week", value: "$318k", delta: "+3.4%" },
];

const BARS = [38, 54, 47, 68, 61, 82, 74, 91, 66, 88, 79, 96];

const QUEUE_ROWS = [
  { id: "INV-4821", account: "Northwind Foods", amount: "$12,400", age: "2d" },
  { id: "INV-4817", account: "Halcyon Labs", amount: "$3,980", age: "5d" },
  { id: "INV-4802", account: "Redpine Freight", amount: "$28,150", age: "9d" },
  { id: "INV-4795", account: "Owl & Oak", amount: "$1,220", age: "14d" },
  { id: "INV-4788", account: "Marrow & Sons", amount: "$7,640", age: "18d" },
  {
    id: "INV-4771",
    account: "Bluefin Logistics",
    amount: "$19,300",
    age: "21d",
  },
  { id: "INV-4764", account: "Cedarworks", amount: "$2,450", age: "26d" },
  { id: "INV-4750", account: "Atlas Print Co", amount: "$9,875", age: "33d" },
];

const TYPE_SCALE = [
  { name: "Display", spec: "40 / 700" },
  { name: "Section", spec: "20 / 600" },
  { name: "Body", spec: "15 / 450" },
  { name: "Caption", spec: "13 / 500" },
];

const TOKEN_SWATCHES = [
  { name: "ink", value: "#1b1b1f" },
  { name: "surface", value: "#f4f4f5" },
  { name: "line", value: "#d6d6da" },
  { name: "accent", value: "#cdcdd1" },
];

function DashboardBoard() {
  return (
    <div className="lg-board">
      <div className="lg-sidebar">
        <span className="lg-wordmark">ledger</span>
        {SIDEBAR_ITEMS.map((item) => (
          <span
            key={item.label}
            className={item.active ? "lg-nav-item is-active" : "lg-nav-item"}
          >
            {item.label}
          </span>
        ))}
      </div>

      <div className="lg-main">
        <div className="lg-topbar">
          <span className="lg-topbar-title">Billing overview</span>
          <span className="lg-filter">Last 30 days</span>
          <span className="lg-primary">Run collection</span>
        </div>

        <div className="lg-metrics">
          {METRICS.map((metric) => (
            <div key={metric.label} className="lg-metric">
              <span className="lg-metric-label">{metric.label}</span>
              <span className="lg-metric-value">{metric.value}</span>
              <span className="lg-metric-delta">{metric.delta}</span>
            </div>
          ))}
        </div>

        <div className="lg-split">
          <div className="lg-panel lg-chart-panel">
            <span className="lg-panel-title">Collections by week</span>
            <div className="lg-chart">
              {BARS.map((height, index) => (
                <span
                  key={index}
                  className="lg-bar"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
          <div className="lg-panel lg-aging-panel">
            <span className="lg-panel-title">Aging</span>
            <div className="lg-donut" />
            <span className="lg-aging-meta">62% under 30 days</span>
          </div>
        </div>

        <div className="lg-panel lg-queue">
          <span className="lg-panel-title">Needs attention</span>
          {QUEUE_ROWS.map((row) => (
            <div key={row.id} className="lg-row">
              <span className="lg-row-id">{row.id}</span>
              <span className="lg-row-account">{row.account}</span>
              <span className="lg-row-amount">{row.amount}</span>
              <span className="lg-row-age">{row.age}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SystemPanel() {
  return (
    <div className="dd-panel">
      <div className="dd-panel-head">
        <span className="dd-panel-name">Ledger Ops</span>
        <IconChevronDown size={12} className="dd-panel-chevron" />
      </div>

      <div className="dd-section">
        <span className="dd-section-label">Color</span>
        <div className="dd-swatches">
          {TOKEN_SWATCHES.map((token) => (
            <div key={token.name} className="dd-swatch-row">
              <span className="dd-swatch" style={{ background: token.value }} />
              <span className="dd-swatch-name">{token.name}</span>
              <span className="dd-swatch-value">{token.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dd-section">
        <span className="dd-section-label">Type</span>
        {TYPE_SCALE.map((step) => (
          <div key={step.name} className="dd-type-row">
            <span className={`dd-type-sample is-${step.name.toLowerCase()}`}>
              Ag
            </span>
            <span className="dd-type-name">{step.name}</span>
            <span className="dd-type-spec">{step.spec}</span>
          </div>
        ))}
      </div>

      <div className="dd-section">
        <span className="dd-section-label">Radius</span>
        <div className="dd-radius-row">
          <span className="dd-radius is-sm" />
          <span className="dd-radius is-md" />
          <span className="dd-radius is-lg" />
          <span className="dd-radius is-pill" />
        </div>
      </div>
    </div>
  );
}

const DESIGN_DASHBOARD_MOCK_CSS = [
  ".design-dashboard-mock { position: relative; width: 100%; pointer-events: none; }",
  ".design-dashboard-mock, .design-dashboard-mock * { box-sizing: border-box; }",

  ".design-dashboard-mock { --dd-scale: 0.34; --dd-frame-bg: hsl(0 0% 13%); --dd-canvas-bg: hsl(0 0% 10%); --dd-border: hsl(0 0% 24%); --dd-divider: hsl(0 0% 22%); --dd-control-bg: hsl(0 0% 18%); --dd-fg: hsl(0 0% 90%); --dd-fg-muted: hsl(0 0% 60%); }",
  "html.light .design-dashboard-mock { --dd-frame-bg: hsl(0 0% 100%); --dd-canvas-bg: hsl(0 0% 92%); --dd-border: hsl(0 0% 90%); --dd-divider: hsl(0 0% 90%); --dd-control-bg: hsl(0 0% 95%); --dd-fg: hsl(0 0% 10%); --dd-fg-muted: hsl(0 0% 45%); }",

  ".design-dashboard-mock-frame { display: flex; overflow: hidden; border: 1px solid var(--dd-border); border-radius: 12px; background: var(--dd-frame-bg); color: var(--dd-fg); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",
  ".design-dashboard-mock .dd-canvas { display: flex; flex: 1; min-width: 0; justify-content: center; overflow: hidden; padding: 22px 18px 0; background: var(--dd-canvas-bg); }",

  `.design-dashboard-mock .dd-board { width: calc(${BOARD_WIDTH}px * var(--dd-scale)); flex-shrink: 0; }`,
  ".design-dashboard-mock .dd-board-label { display: flex; height: 20px; align-items: center; gap: 5px; padding-left: 2px; color: var(--dd-fg-muted); font-size: 10px; font-weight: 500; }",
  ".design-dashboard-mock .dd-board-width { font-size: 10px; font-variant-numeric: tabular-nums; opacity: 0.5; }",
  `.design-dashboard-mock .dd-board-body { height: ${BOARD_BODY_HEIGHT}px; overflow: hidden; background: var(--lg-bg); box-shadow: inset 0 0 0 1px var(--dd-border); }`,
  `.design-dashboard-mock .dd-artboard { width: ${BOARD_WIDTH}px; min-height: calc(${BOARD_BODY_HEIGHT}px / var(--dd-scale)); transform: scale(var(--dd-scale)); transform-origin: top left; }`,

  ".design-dashboard-mock .dd-panel { display: flex; width: 148px; flex-shrink: 0; flex-direction: column; overflow: hidden; border-left: 1px solid var(--dd-divider); }",
  ".design-dashboard-mock .dd-panel-head { display: flex; height: 34px; flex-shrink: 0; align-items: center; gap: 4px; padding: 0 10px; border-bottom: 1px solid var(--dd-divider); }",
  ".design-dashboard-mock .dd-panel-name { flex: 1; min-width: 0; overflow: hidden; font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-dashboard-mock .dd-panel-chevron { flex-shrink: 0; color: var(--dd-fg-muted); }",
  ".design-dashboard-mock .dd-section { display: flex; flex-direction: column; gap: 5px; padding: 9px 10px; box-shadow: inset 0 -1px var(--dd-divider); }",
  ".design-dashboard-mock .dd-section-label { color: var(--dd-fg-muted); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }",

  ".design-dashboard-mock .dd-swatches { display: flex; flex-direction: column; gap: 4px; }",
  ".design-dashboard-mock .dd-swatch-row { display: flex; align-items: center; gap: 6px; }",
  ".design-dashboard-mock .dd-swatch { width: 14px; height: 14px; flex-shrink: 0; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.35); }",
  ".design-dashboard-mock .dd-swatch-name { flex: 1; min-width: 0; overflow: hidden; font-size: 10px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-dashboard-mock .dd-swatch-value { flex-shrink: 0; color: var(--dd-fg-muted); font-size: 9px; font-variant-numeric: tabular-nums; }",

  ".design-dashboard-mock .dd-type-row { display: flex; align-items: baseline; gap: 6px; }",
  ".design-dashboard-mock .dd-type-sample { width: 20px; flex-shrink: 0; letter-spacing: -0.02em; }",
  ".design-dashboard-mock .dd-type-sample.is-display { font-size: 15px; font-weight: 700; }",
  ".design-dashboard-mock .dd-type-sample.is-section { font-size: 13px; font-weight: 600; }",
  ".design-dashboard-mock .dd-type-sample.is-body { font-size: 11px; font-weight: 450; }",
  ".design-dashboard-mock .dd-type-sample.is-caption { font-size: 10px; font-weight: 500; }",
  ".design-dashboard-mock .dd-type-name { flex: 1; min-width: 0; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-dashboard-mock .dd-type-spec { flex-shrink: 0; color: var(--dd-fg-muted); font-size: 9px; font-variant-numeric: tabular-nums; }",

  ".design-dashboard-mock .dd-radius-row { display: flex; align-items: center; gap: 6px; }",
  ".design-dashboard-mock .dd-radius { width: 24px; height: 20px; border: 1px solid var(--dd-border); background: var(--dd-control-bg); }",
  ".design-dashboard-mock .dd-radius.is-sm { border-radius: 2px; }",
  ".design-dashboard-mock .dd-radius.is-md { border-radius: 5px; }",
  ".design-dashboard-mock .dd-radius.is-lg { border-radius: 9px; }",
  ".design-dashboard-mock .dd-radius.is-pill { border-radius: 999px; }",

  ".design-dashboard-mock { --lg-bg: #0c0c0e; --lg-elevated: #16161a; --lg-chrome: #131317; --lg-fg: #a9a9af; --lg-fg-soft: rgba(169, 169, 175, 0.62); --lg-line: rgba(169, 169, 175, 0.12); --lg-line-strong: rgba(169, 169, 175, 0.26); --lg-accent: #cdcdd1; --lg-accent-on: #0c0c0e; }",
  "html.light .design-dashboard-mock { --lg-bg: #f4f4f5; --lg-elevated: #ffffff; --lg-chrome: #e8e8ea; --lg-fg: #55555e; --lg-fg-soft: rgba(85, 85, 94, 0.62); --lg-line: rgba(85, 85, 94, 0.14); --lg-line-strong: rgba(85, 85, 94, 0.28); --lg-accent: #26262b; --lg-accent-on: #f4f4f5; }",
  `.design-dashboard-mock .lg-board { display: flex; min-height: calc(${BOARD_BODY_HEIGHT}px / var(--dd-scale)); background: var(--lg-bg); color: var(--lg-fg); }`,

  ".design-dashboard-mock .lg-sidebar { display: flex; width: 210px; flex-shrink: 0; flex-direction: column; gap: 6px; padding: 26px 18px; background: var(--lg-chrome); }",
  ".design-dashboard-mock .lg-wordmark { margin-bottom: 18px; padding: 0 12px; font-size: 26px; font-weight: 700; letter-spacing: -0.04em; }",
  ".design-dashboard-mock .lg-nav-item { display: flex; height: 40px; align-items: center; padding: 0 12px; border-radius: 12px; color: var(--lg-fg-soft); font-size: 16px; font-weight: 500; }",
  ".design-dashboard-mock .lg-nav-item.is-active { background: var(--lg-elevated); color: var(--lg-fg); font-weight: 700; }",

  ".design-dashboard-mock .lg-main { display: flex; min-width: 0; flex: 1; flex-direction: column; padding: 26px 28px; }",
  ".design-dashboard-mock .lg-topbar { display: flex; align-items: center; gap: 14px; }",
  ".design-dashboard-mock .lg-topbar-title { flex: 1; min-width: 0; font-size: 30px; font-weight: 700; letter-spacing: -0.03em; }",
  ".design-dashboard-mock .lg-filter { display: flex; height: 38px; align-items: center; padding: 0 16px; border: 2px solid var(--lg-line); border-radius: 999px; color: var(--lg-fg-soft); font-size: 15px; font-weight: 600; }",
  ".design-dashboard-mock .lg-primary { display: flex; height: 38px; align-items: center; padding: 0 18px; border-radius: 999px; background: var(--lg-accent); color: var(--lg-accent-on); font-size: 15px; font-weight: 700; }",

  ".design-dashboard-mock .lg-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 20px; }",
  ".design-dashboard-mock .lg-metric { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border: 2px solid var(--lg-line); border-radius: 18px; background: var(--lg-elevated); }",
  ".design-dashboard-mock .lg-metric-label { color: var(--lg-fg-soft); font-size: 13px; font-weight: 600; }",
  ".design-dashboard-mock .lg-metric-value { font-size: 30px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }",
  ".design-dashboard-mock .lg-metric-delta { color: var(--lg-fg-soft); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }",

  ".design-dashboard-mock .lg-split { display: grid; grid-template-columns: 1.7fr 1fr; gap: 14px; margin-top: 14px; }",
  ".design-dashboard-mock .lg-panel { display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 2px solid var(--lg-line); border-radius: 18px; background: var(--lg-elevated); }",
  ".design-dashboard-mock .lg-panel-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }",
  ".design-dashboard-mock .lg-chart { display: flex; height: 120px; align-items: flex-end; gap: 8px; }",
  ".design-dashboard-mock .lg-bar { flex: 1; border-radius: 4px; background: var(--lg-line-strong); }",
  ".design-dashboard-mock .lg-bar:last-child { background: var(--lg-accent); }",
  ".design-dashboard-mock .lg-aging-panel { align-items: center; }",
  ".design-dashboard-mock .lg-donut { width: 110px; height: 110px; border-radius: 999px; background: conic-gradient(var(--lg-accent) 0 62%, var(--lg-line-strong) 62% 84%, var(--lg-line) 84% 100%); mask: radial-gradient(circle, transparent 54%, #000 55%); -webkit-mask: radial-gradient(circle, transparent 54%, #000 55%); }",
  ".design-dashboard-mock .lg-aging-meta { color: var(--lg-fg-soft); font-size: 14px; font-weight: 600; }",

  ".design-dashboard-mock .lg-queue { margin-top: 14px; gap: 6px; }",
  ".design-dashboard-mock .lg-row { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-top: 2px solid var(--lg-line); font-size: 15px; }",
  ".design-dashboard-mock .lg-row-id { width: 110px; flex-shrink: 0; font-weight: 700; font-variant-numeric: tabular-nums; }",
  ".design-dashboard-mock .lg-row-account { flex: 1; min-width: 0; overflow: hidden; color: var(--lg-fg-soft); text-overflow: ellipsis; white-space: nowrap; }",
  ".design-dashboard-mock .lg-row-amount { flex-shrink: 0; font-weight: 700; font-variant-numeric: tabular-nums; }",
  ".design-dashboard-mock .lg-row-age { width: 48px; flex-shrink: 0; color: var(--lg-fg-soft); text-align: right; font-variant-numeric: tabular-nums; }",

  "@media (max-width: 1320px) { .design-dashboard-mock { --dd-scale: 0.3; } .design-dashboard-mock .dd-canvas { padding: 18px 12px 0; } }",
  "@media (max-width: 560px) { .design-dashboard-mock { --dd-scale: 0.22; } .design-dashboard-mock .dd-panel { width: 124px; } }",
].join("\n");

export function DesignDashboardMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`design-dashboard-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{DESIGN_DASHBOARD_MOCK_CSS}</style>
      <div className="design-dashboard-mock-frame" aria-hidden="true">
        <div className="dd-canvas">
          <div className="dd-board">
            <div className="dd-board-label">
              <span>Billing overview</span>
              <span className="dd-board-width">{BOARD_WIDTH}px</span>
            </div>
            <div className="dd-board-body">
              <div className="dd-artboard">
                <DashboardBoard />
              </div>
            </div>
          </div>
        </div>
        <SystemPanel />
      </div>
    </div>
  );
}
