/**
 * Static, decorative recreation of a three-screen product flow on the Design
 * canvas — plan, payment, confirmation, wired together with prototype links and
 * listed in the Screens panel beside them — used as the art for the "Work
 * through product flows" use-case row on the Design landing page.
 *
 * The connectors are the point of the picture: three unlinked screens would
 * read as three designs, and the row's promise is that you walk the steps
 * before committing to them.
 *
 * The design is a fictional `atlas` travel-pass signup, deliberately not the
 * hero's `pulse` brand or the variants row's `kettle`, so the three use-case
 * pictures do not read as one screenshot cropped three ways.
 *
 * All CSS lives here, scoped under `.design-flow-mock`. The real Design
 * stylesheet (templates/design/app/global.css) is deliberately NOT imported: it
 * declares `:root`/`html`/`body` palette rules that would reskin the whole docs
 * site.
 *
 * Every length inside a screen is an artboard pixel: each screen is authored at
 * SCREEN_WIDTH and multiplied by `--df-scale`, so type and spacing shrink in
 * the proportion a real board zoom would produce rather than being faked with
 * tiny font sizes.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (a fake brand's fake signup flow).
 */
import { IconDeviceMobile, IconLink } from "@tabler/icons-react";
import { Fragment } from "react";

const SCREEN_WIDTH = 390;

const SCREEN_BODY_HEIGHT = 250;

const SCREEN_ROWS = [
  { id: "plan", label: "Choose pass", active: true },
  { id: "payment", label: "Payment" },
  { id: "confirm", label: "Confirmed" },
];

const PASSES = [
  { name: "City day", price: "$12", meta: "24 hours, all zones", chosen: true },
  { name: "Weekender", price: "$28", meta: "Friday to Sunday" },
  { name: "Month", price: "$64", meta: "Renews monthly" },
  { name: "Commuter", price: "$96", meta: "Peak hours, all year" },
];

function StatusBar() {
  return (
    <div className="at-status">
      <span>9:41</span>
      <span className="at-status-dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

function PlanScreen() {
  return (
    <div className="at">
      <StatusBar />
      <div className="at-head">
        <span className="at-step">Step 1 of 3</span>
        <span className="at-title">Choose your pass</span>
      </div>
      <div className="at-list">
        {PASSES.map((pass) => (
          <div
            key={pass.name}
            className={pass.chosen ? "at-option is-chosen" : "at-option"}
          >
            <span className="at-radio" />
            <span className="at-option-copy">
              <span className="at-option-name">{pass.name}</span>
              <span className="at-option-meta">{pass.meta}</span>
            </span>
            <span className="at-option-price">{pass.price}</span>
          </div>
        ))}
      </div>
      <div className="at-footer">
        <span className="at-primary">Continue</span>
      </div>
    </div>
  );
}

function PaymentScreen() {
  return (
    <div className="at">
      <StatusBar />
      <div className="at-head">
        <span className="at-step">Step 2 of 3</span>
        <span className="at-title">How are you paying?</span>
      </div>
      <div className="at-list">
        <div className="at-card">
          <span className="at-card-top">
            <span className="at-card-chip" />
            <span className="at-card-brand">atlas</span>
          </span>
          <span className="at-card-number">4242 •••• •••• 4242</span>
          <span className="at-card-foot">
            <span className="at-card-name">A. Rivera</span>
            <span className="at-card-expiry">04 / 29</span>
          </span>
        </div>
        <div className="at-field">
          <span className="at-field-label">Card number</span>
          <span className="at-field-value">4242 4242 4242 4242</span>
        </div>
        <div className="at-field-row">
          <div className="at-field">
            <span className="at-field-label">Expiry</span>
            <span className="at-field-value">04 / 29</span>
          </div>
          <div className="at-field">
            <span className="at-field-label">CVC</span>
            <span className="at-field-value">•••</span>
          </div>
        </div>
        <div className="at-summary">
          <span>City day pass</span>
          <span className="at-summary-total">$12.00</span>
        </div>
        <div className="at-option">
          <span className="at-radio" />
          <span className="at-option-copy">
            <span className="at-option-name">Save this card</span>
            <span className="at-option-meta">For faster renewals</span>
          </span>
        </div>
      </div>
      <div className="at-footer">
        <span className="at-primary">Pay $12.00</span>
      </div>
    </div>
  );
}

function ConfirmScreen() {
  return (
    <div className="at">
      <StatusBar />
      <div className="at-confirm">
        <span className="at-check">
          <span className="at-check-mark" />
        </span>
        <span className="at-title">You&rsquo;re all set</span>
        <span className="at-confirm-meta">
          City day pass, active until tomorrow 9:41.
        </span>
        <div className="at-ticket">
          <span className="at-ticket-code" />
          <span className="at-ticket-label">Scan at the gate</span>
        </div>
        <div className="at-detail">
          <span className="at-detail-label">Zones</span>
          <span className="at-detail-value">All</span>
        </div>
        <div className="at-detail">
          <span className="at-detail-label">Paid</span>
          <span className="at-detail-value">$12.00</span>
        </div>
        <div className="at-detail">
          <span className="at-detail-label">Reference</span>
          <span className="at-detail-value">AT-20418</span>
        </div>
      </div>
      <div className="at-footer">
        <span className="at-primary">Add to wallet</span>
        <span className="at-secondary">View pass details</span>
      </div>
    </div>
  );
}

const FLOW_SCREENS = [
  { id: "plan", label: "Choose pass", render: PlanScreen },
  { id: "payment", label: "Payment", render: PaymentScreen },
  { id: "confirm", label: "Confirmed", render: ConfirmScreen },
] as const;

const DESIGN_FLOW_MOCK_CSS = [
  ".design-flow-mock { position: relative; width: 100%; pointer-events: none; }",
  ".design-flow-mock, .design-flow-mock * { box-sizing: border-box; }",

  ".design-flow-mock { --df-scale: 0.3; --df-frame-bg: hsl(0 0% 13%); --df-canvas-bg: hsl(0 0% 10%); --df-border: hsl(0 0% 24%); --df-divider: hsl(0 0% 22%); --df-fg: hsl(0 0% 90%); --df-fg-muted: hsl(0 0% 60%); --df-active-row: hsl(0 0% 20%); --df-link: #01c8f1; }",
  "html.light .design-flow-mock { --df-frame-bg: hsl(0 0% 100%); --df-canvas-bg: hsl(0 0% 92%); --df-border: hsl(0 0% 90%); --df-divider: hsl(0 0% 90%); --df-fg: hsl(0 0% 10%); --df-fg-muted: hsl(0 0% 45%); --df-active-row: rgba(38, 38, 38, 0.08); }",

  ".design-flow-mock-frame { display: flex; overflow: hidden; border: 1px solid var(--df-border); border-radius: 12px; background: var(--df-frame-bg); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: var(--df-fg); }",

  ".design-flow-mock .df-panel { display: flex; width: 120px; flex-shrink: 0; flex-direction: column; border-right: 1px solid var(--df-divider); }",
  ".design-flow-mock .df-panel-title { display: flex; height: 34px; flex-shrink: 0; align-items: center; padding: 0 10px; font-size: 11px; font-weight: 600; }",
  ".design-flow-mock .df-panel-row { display: flex; height: 26px; align-items: center; gap: 6px; margin: 0 6px; padding: 0 6px; border-radius: 5px; color: var(--df-fg-muted); font-size: 11px; font-weight: 500; }",
  ".design-flow-mock .df-panel-row.is-active { background: var(--df-active-row); color: var(--df-fg); font-weight: 600; }",
  ".design-flow-mock .df-panel-glyph { flex-shrink: 0; }",
  ".design-flow-mock .df-panel-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",

  ".design-flow-mock .df-canvas { display: flex; flex: 1; min-width: 0; align-items: flex-start; justify-content: center; overflow: hidden; padding: 22px 16px 0; background: var(--df-canvas-bg); }",

  `.design-flow-mock .df-screen { width: calc(${SCREEN_WIDTH}px * var(--df-scale)); flex-shrink: 0; }`,
  ".design-flow-mock .df-screen-label { display: flex; height: 20px; align-items: center; gap: 4px; padding-left: 2px; color: var(--df-fg-muted); font-size: 10px; font-weight: 500; }",
  `.design-flow-mock .df-screen-body { height: ${SCREEN_BODY_HEIGHT}px; overflow: hidden; background: var(--at-bg); box-shadow: inset 0 0 0 1px var(--df-border); }`,
  `.design-flow-mock .df-artboard { width: ${SCREEN_WIDTH}px; min-height: calc(${SCREEN_BODY_HEIGHT}px / var(--df-scale)); transform: scale(var(--df-scale)); transform-origin: top left; }`,

  ".design-flow-mock .df-link { position: relative; display: flex; width: 34px; flex-shrink: 0; align-items: center; justify-content: center; align-self: stretch; color: var(--df-link); }",
  ".design-flow-mock .df-link-line { position: absolute; left: 2px; right: 2px; top: 50%; height: 1.5px; background: var(--df-link); }",
  ".design-flow-mock .df-link-arrow { position: absolute; right: 0; top: 50%; width: 0; height: 0; transform: translateY(-50%); border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 6px solid var(--df-link); }",
  ".design-flow-mock .df-link-glyph { position: relative; display: flex; align-items: center; justify-content: center; padding: 2px; border-radius: 999px; background: var(--df-canvas-bg); }",

  ".design-flow-mock { --at-bg: #0c0c0e; --at-elevated: #16161a; --at-fg: #a9a9af; --at-fg-soft: rgba(169, 169, 175, 0.62); --at-line: rgba(169, 169, 175, 0.12); --at-line-strong: rgba(169, 169, 175, 0.26); --at-accent: #cdcdd1; --at-accent-on: #0c0c0e; }",
  "html.light .design-flow-mock { --at-bg: #f4f4f5; --at-elevated: #ffffff; --at-fg: #55555e; --at-fg-soft: rgba(85, 85, 94, 0.62); --at-line: rgba(85, 85, 94, 0.14); --at-line-strong: rgba(85, 85, 94, 0.28); --at-accent: #26262b; --at-accent-on: #f4f4f5; }",
  `.design-flow-mock .at { display: flex; min-height: calc(${SCREEN_BODY_HEIGHT}px / var(--df-scale)); flex-direction: column; background: var(--at-bg); color: var(--at-fg); }`,

  ".design-flow-mock .at-status { display: flex; height: 44px; flex-shrink: 0; align-items: center; justify-content: space-between; padding: 0 26px; color: var(--at-fg-soft); font-size: 15px; font-weight: 600; }",
  ".design-flow-mock .at-status-dots { display: flex; align-items: center; gap: 5px; }",
  ".design-flow-mock .at-status-dots span { width: 8px; height: 8px; border-radius: 999px; background: var(--at-line-strong); }",

  ".design-flow-mock .at-head { display: flex; flex-shrink: 0; flex-direction: column; gap: 8px; padding: 18px 26px 0; }",
  ".design-flow-mock .at-step { color: var(--at-fg-soft); font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }",
  ".design-flow-mock .at-title { font-size: 34px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }",

  ".design-flow-mock .at-list { display: flex; flex-shrink: 0; flex-direction: column; gap: 14px; padding: 24px 26px 0; }",
  ".design-flow-mock .at-option { display: flex; align-items: center; gap: 14px; padding: 18px; border: 2px solid var(--at-line); border-radius: 20px; background: var(--at-elevated); }",
  ".design-flow-mock .at-option.is-chosen { border-color: var(--at-accent); }",
  ".design-flow-mock .at-radio { width: 22px; height: 22px; flex-shrink: 0; border: 2px solid var(--at-line-strong); border-radius: 999px; }",
  ".design-flow-mock .at-option.is-chosen .at-radio { border-color: var(--at-accent); background: var(--at-accent); box-shadow: inset 0 0 0 4px var(--at-elevated); }",
  ".design-flow-mock .at-option-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }",
  ".design-flow-mock .at-option-name { font-size: 19px; font-weight: 700; letter-spacing: -0.02em; }",
  ".design-flow-mock .at-option-meta { color: var(--at-fg-soft); font-size: 15px; }",
  ".design-flow-mock .at-option-price { flex-shrink: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.03em; }",

  ".design-flow-mock .at-card { display: flex; flex-direction: column; justify-content: space-between; aspect-ratio: 1.586 / 1; padding: 22px; border-radius: 22px; background: linear-gradient(135deg, var(--at-accent) 0%, var(--at-fg) 100%); color: var(--at-accent-on); }",
  ".design-flow-mock .at-card-top { display: flex; align-items: center; justify-content: space-between; }",
  ".design-flow-mock .at-card-chip { width: 42px; height: 32px; border-radius: 6px; background: linear-gradient(180deg, rgba(12, 12, 14, 0.16) 0 30%, rgba(12, 12, 14, 0.34) 30% 36%, rgba(12, 12, 14, 0.16) 36% 62%, rgba(12, 12, 14, 0.34) 62% 68%, rgba(12, 12, 14, 0.16) 68% 100%); }",
  ".design-flow-mock .at-card-brand { font-size: 18px; font-weight: 700; letter-spacing: -0.03em; opacity: 0.8; }",
  ".design-flow-mock .at-card-number { font-size: 24px; font-weight: 600; letter-spacing: 0.06em; font-variant-numeric: tabular-nums; }",
  ".design-flow-mock .at-card-foot { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; opacity: 0.78; }",
  ".design-flow-mock .at-field { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 6px; padding: 14px 18px; border: 2px solid var(--at-line); border-radius: 18px; background: var(--at-elevated); }",
  ".design-flow-mock .at-field-row { display: flex; gap: 14px; }",
  ".design-flow-mock .at-field-label { color: var(--at-fg-soft); font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }",
  ".design-flow-mock .at-field-value { overflow: hidden; font-size: 19px; font-weight: 600; letter-spacing: -0.01em; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-flow-mock .at-summary { display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 2px solid var(--at-line); font-size: 17px; font-weight: 600; }",
  ".design-flow-mock .at-summary-total { font-size: 24px; font-weight: 700; letter-spacing: -0.03em; }",

  ".design-flow-mock .at-confirm { display: flex; flex-shrink: 0; flex-direction: column; align-items: center; gap: 14px; padding: 42px 26px 0; text-align: center; }",
  ".design-flow-mock .at-check { display: flex; width: 74px; height: 74px; align-items: center; justify-content: center; border-radius: 999px; background: var(--at-accent); }",
  ".design-flow-mock .at-check-mark { width: 30px; height: 16px; margin-bottom: 8px; border-left: 5px solid var(--at-accent-on); border-bottom: 5px solid var(--at-accent-on); transform: rotate(-45deg); }",
  ".design-flow-mock .at-confirm-meta { max-width: 260px; color: var(--at-fg-soft); font-size: 16px; line-height: 1.45; }",
  ".design-flow-mock .at-ticket { display: flex; width: 100%; flex-direction: column; align-items: center; gap: 12px; margin-top: 8px; padding: 22px; border: 2px solid var(--at-line); border-radius: 22px; background: var(--at-elevated); }",
  ".design-flow-mock .at-ticket-code { width: 100%; height: 56px; background: repeating-linear-gradient(90deg, var(--at-fg) 0 3px, transparent 3px 5px, var(--at-fg) 5px 6px, transparent 6px 9px, var(--at-fg) 9px 13px, transparent 13px 15px, var(--at-fg) 15px 16px, transparent 16px 18px, var(--at-fg) 18px 19px, transparent 19px 23px, var(--at-fg) 23px 27px, transparent 27px 28px, var(--at-fg) 28px 30px, transparent 30px 34px, var(--at-fg) 34px 35px, transparent 35px 37px, var(--at-fg) 37px 41px, transparent 41px 43px, var(--at-fg) 43px 44px, transparent 44px 46px, var(--at-fg) 46px 49px, transparent 49px 53px, var(--at-fg) 53px 54px, transparent 54px 56px, var(--at-fg) 56px 60px, transparent 60px 63px); opacity: 0.85; }",
  ".design-flow-mock .at-ticket-label { color: var(--at-fg-soft); font-size: 14px; font-weight: 600; }",

  ".design-flow-mock .at-detail { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 12px 4px; border-bottom: 2px solid var(--at-line); font-size: 16px; }",
  ".design-flow-mock .at-detail-label { color: var(--at-fg-soft); font-weight: 600; }",
  ".design-flow-mock .at-detail-value { font-weight: 700; }",
  ".design-flow-mock .at-footer { display: flex; flex-shrink: 0; flex-direction: column; align-items: center; gap: 12px; margin-top: auto; padding: 26px; }",
  ".design-flow-mock .at-primary { display: flex; width: 100%; height: 54px; align-items: center; justify-content: center; border-radius: 999px; background: var(--at-accent); color: var(--at-accent-on); font-size: 18px; font-weight: 700; }",
  ".design-flow-mock .at-secondary { color: var(--at-fg-soft); font-size: 16px; font-weight: 600; }",

  "@media (max-width: 1320px) { .design-flow-mock { --df-scale: 0.26; } .design-flow-mock .df-link { width: 26px; } .design-flow-mock .df-canvas { padding: 18px 10px 0; } }",
  "@media (max-width: 560px) { .design-flow-mock { --df-scale: 0.2; } .design-flow-mock .df-panel { width: 86px; } .design-flow-mock .df-link { width: 20px; } }",
  "@media (max-width: 480px) { .design-flow-mock { --df-scale: 0.17; } .design-flow-mock .df-panel { display: none; } .design-flow-mock .df-link { width: 18px; } }",
].join("\n");

export function DesignFlowMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`design-flow-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{DESIGN_FLOW_MOCK_CSS}</style>
      <div className="design-flow-mock-frame" aria-hidden="true">
        <div className="df-panel">
          <span className="df-panel-title">Screens</span>
          {SCREEN_ROWS.map((row) => (
            <div
              key={row.id}
              className={row.active ? "df-panel-row is-active" : "df-panel-row"}
            >
              <IconDeviceMobile size={13} className="df-panel-glyph" />
              <span className="df-panel-label">{row.label}</span>
            </div>
          ))}
        </div>

        <div className="df-canvas">
          {FLOW_SCREENS.map((screen, index) => {
            const Screen = screen.render;
            return (
              <Fragment key={screen.id}>
                {index > 0 ? (
                  <span className="df-link">
                    <span className="df-link-line" />
                    <span className="df-link-arrow" />
                    <span className="df-link-glyph">
                      <IconLink size={11} />
                    </span>
                  </span>
                ) : null}
                <div className="df-screen">
                  <div className="df-screen-label">{screen.label}</div>
                  <div className="df-screen-body">
                    <div className="df-artboard">
                      <Screen />
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
