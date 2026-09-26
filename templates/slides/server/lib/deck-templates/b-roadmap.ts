import { bDeck, bRoot, tint } from "./b-shared.js";

const C = {
  bg: "#F4F3FE", // guard:allow-raw-color — authored slide palette, not app chrome.
  ink: "#17153A", // guard:allow-raw-color — authored slide palette, not app chrome.
  muted: "#57548A", // guard:allow-raw-color — authored slide palette, not app chrome.
  indigo: "#5440F0", // guard:allow-raw-color — authored slide palette, not app chrome.
  sky: "#2F86F0", // guard:allow-raw-color — authored slide palette, not app chrome.
  orchid: "#A24BE0", // guard:allow-raw-color — authored slide palette, not app chrome.
  lilac: "#CFC8FF", // guard:allow-raw-color — authored slide palette, not app chrome.
  white: "#FFFFFF", // guard:allow-raw-color — authored slide palette, not app chrome.
};

const TOKENS = `--deck-bg:${C.bg};--deck-ink:${C.ink};--deck-muted:${C.muted};--deck-accent:${C.indigo};--deck-surface:${C.white};--deck-heading-font:'Space Grotesk',sans-serif;--deck-body-font:'Manrope',sans-serif;--deck-radius:14px;font-family:'Manrope',sans-serif;`;

const LINE = `1px solid ${tint(C.indigo, 18)}`;
const H1 = `margin:0;font-family:'Space Grotesk',sans-serif;font-weight:700;color:var(--deck-ink);letter-spacing:-0.035em;`;
const HEAD = `font-family:var(--deck-heading-font);font-weight:700;letter-spacing:-0.02em;`;
const MONO = `font-family:'JetBrains Mono',monospace;font-size:14px;letter-spacing:0.02em;`;
const CARD = `background:var(--deck-surface);border:${LINE};border-radius:var(--deck-radius);`;

const slide = (style: string, body: string) =>
  bRoot(TOKENS, `padding:56px 64px;gap:22px;${style}`, body);

const header = (title: string, aside: string) =>
  `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px;">
    <h1 style="${H1}font-size:44px;line-height:1.02;">${title}</h1>
    <p style="margin:0;max-width:330px;font-size:16px;line-height:1.5;color:var(--deck-muted);">${aside}</p>
  </div>`;

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
/** Left edge and width as fractions of the four-quarter track. */
const span = (start: number, length: number) =>
  `left:${start * 25}%;width:calc(${length * 25}% - 8px);`;

const bar = (
  start: number,
  length: number,
  color: string,
  label: string,
  top: number,
  planned = false,
) =>
  `<div style="position:absolute;top:${top}px;${span(start, length)}height:30px;border-radius:8px;background:${planned ? tint(color, 18) : color};color:${planned ? color : C.white};${planned ? `border:1px dashed ${color};` : ""}display:flex;align-items:center;padding:0 12px;box-sizing:border-box;font-size:14px;font-weight:700;white-space:nowrap;">${label}</div>`;

const milestone = (at: number, color: string, label: string, top: number) =>
  `<div style="position:absolute;top:${top}px;left:calc(${at * 25}% - 8px);display:flex;align-items:center;gap:8px;"><span style="width:14px;height:14px;background:${color};transform:rotate(45deg);"></span><span style="${MONO}color:var(--deck-ink);">${label}</span></div>`;

const lane = (name: string, color: string, body: string) =>
  `<div style="display:grid;grid-template-columns:150px 1fr;border-top:${LINE};">
    <div style="display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;"><span style="width:10px;height:10px;border-radius:3px;background:${color};"></span>${name}</div>
    <div style="position:relative;height:88px;">${body}</div>
  </div>`;

const item = (code: string, title: string, color: string) =>
  `<div style="${CARD}padding:12px 14px;display:flex;flex-direction:column;gap:4px;"><span style="${MONO}color:${color};">${code}</span><span style="font-size:17px;font-weight:700;line-height:1.3;">${title}</span></div>`;

const column = (
  name: string,
  horizon: string,
  color: string,
  fill: string,
  items: string,
) =>
  `<div style="display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:18px;background:${fill};">
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 4px 4px;"><h2 style="margin:0;${HEAD}font-size:24px;color:${color};">${name}</h2><span style="${MONO}color:var(--deck-muted);">${horizon}</span></div>
    ${items}
  </div>`;

const confidence = (level: number) =>
  `<span style="display:inline-flex;gap:4px;">${[1, 2, 3].map((dot) => `<span style="width:14px;height:6px;border-radius:3px;background:${dot <= level ? C.indigo : tint(C.indigo, 18)};"></span>`).join("")}</span>`;

const bet = (
  code: string,
  color: string,
  title: string,
  belief: string,
  signal: string,
  level: number,
  levelName: string,
) => `
  <div style="${CARD}padding:22px;display:flex;flex-direction:column;gap:14px;border-top:6px solid ${color};">
    <span style="${MONO}color:${color};">${code}</span>
    <h2 style="margin:0;${HEAD}font-size:24px;line-height:1.1;">${title}</h2>
    <p style="margin:0;font-size:16px;line-height:1.5;"><b>We believe</b> ${belief}</p>
    <p style="margin:0;font-size:16px;line-height:1.5;color:var(--deck-muted);"><b style="color:var(--deck-ink);">We'll know when</b> ${signal}</p>
    <div style="margin-top:auto;padding-top:12px;border-top:${LINE};display:flex;justify-content:space-between;align-items:center;"><span style="${MONO}color:var(--deck-muted);white-space:nowrap;">Confidence: ${levelName}</span>${confidence(level)}</div>
  </div>`;

const IMPACT: Record<string, string> = {
  High: C.orchid,
  Med: C.sky,
  Low: C.muted,
};
const risk = (text: string, impact: string, owner: string) =>
  `<tr style="border-top:${LINE};"><td style="padding:12px 12px 12px 0;font-size:16px;line-height:1.4;font-weight:600;">${text}</td><td style="padding:12px;"><span style="${MONO}padding:3px 10px;border-radius:999px;background:${tint(IMPACT[impact], 14)};color:${IMPACT[impact]};font-weight:700;">${impact}</span></td><td style="padding:12px 0 12px 12px;${MONO}color:var(--deck-muted);white-space:nowrap;">${owner}</td></tr>`;

const dependency = (label: string, note: string, last = false) =>
  `<div style="${CARD}padding:12px 16px;"><div style="font-weight:700;font-size:16px;">${label}</div><div style="${MONO}color:var(--deck-muted);">${note}</div></div>${last ? "" : `<div style="width:2px;height:16px;margin-left:24px;background:${C.indigo};"></div>`}`;

export const ROADMAP_DECK = bDeck(
  "starter-roadmap",
  "Product Roadmap",
  "roadmap",
  "A calm planning deck in indigo and lilac: north-star metric, Now/Next/Later, a swimlane quarter timeline, bets, risks, and the decisions you need.",
  [
    [
      "title",
      slide(
        `flex-direction:row;align-items:center;gap:48px;`,
        `<div style="flex:1;display:flex;flex-direction:column;gap:22px;">
          <span style="${MONO}color:var(--deck-accent);">Sample · v0.1 · Planning cycle Q0 2026</span>
          <h1 style="${H1}font-size:64px;line-height:0.98;">2026 product roadmap</h1>
          <p style="margin:0;max-width:380px;font-size:19px;line-height:1.5;color:var(--deck-muted);">Where we're investing, what we're deliberately not doing, and how we'll know it's working.</p>
        </div>
        <div aria-hidden="true" style="${CARD}width:390px;flex:none;padding:18px 20px 22px;box-shadow:0 18px 40px -24px ${tint(C.indigo, 45)};">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);${MONO}color:var(--deck-muted);padding-bottom:10px;border-bottom:${LINE};">${QUARTERS.map((q) => `<span>${q}</span>`).join("")}</div>
          <div style="position:relative;height:196px;background:repeating-linear-gradient(90deg,${tint(C.indigo, 10)} 0 1px,transparent 1px 25%);">
            <div style="position:absolute;top:0;bottom:0;left:37%;width:2px;background:var(--deck-ink);"></div>
            ${bar(0, 2, C.indigo, "Onboarding", 18)}
            ${bar(1, 2, C.sky, "Public API", 60)}
            ${bar(0.5, 1.5, C.orchid, "Billing", 102)}
            ${bar(2, 2, C.indigo, "Later", 144, true)}
          </div>
        </div>`,
      ),
      "Set expectations first: this is a plan, not a promise, and it will change. Replace the version and planning cycle with your own; keep the version number so people know which copy they are looking at.",
    ],
    [
      "statement",
      slide(
        `align-items:center;justify-content:center;text-align:center;gap:14px;`,
        `<span style="${MONO}color:var(--deck-accent);">North star metric</span>
        <h1 style="${H1}font-size:60px;line-height:1;">Weekly active teams</h1>
        <p style="margin:0;font-size:19px;line-height:1.5;color:var(--deck-muted);">Teams with three or more people creating work together in a given week.</p>
        <div style="display:flex;align-items:center;gap:18px;margin:8px 0 6px;">
          <span style="${HEAD}font-size:40px;color:var(--deck-muted);">00,000</span>
          <span style="width:60px;height:2px;background:var(--deck-accent);"></span>
          <span style="${HEAD}font-size:40px;color:var(--deck-accent);">00,000</span>
          <span style="${MONO}color:var(--deck-muted);text-align:left;">today → target<br>by Q4 2026</span>
        </div>
        <div style="position:relative;width:100%;display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding-top:26px;">
          <div style="position:absolute;top:0;left:16.6%;right:16.6%;height:14px;border:2px solid ${tint(C.indigo, 30)};border-bottom:0;border-radius:10px 10px 0 0;"></div>
          <div style="position:absolute;top:-12px;left:50%;width:2px;height:12px;background:${tint(C.indigo, 30)};"></div>
          ${[
            ["Activation", "00%", "reach first value in week 1"],
            ["Collaboration", "00%", "invite three or more people"],
            ["Retention", "00%", "still active in week 4"],
          ]
            .map(
              ([name, value, text]) =>
                `<div style="${CARD}padding:14px 16px;text-align:left;display:flex;align-items:center;gap:14px;"><span style="${HEAD}font-size:30px;color:var(--deck-accent);">${value}</span><span style="font-size:15px;line-height:1.35;"><b>${name}</b><br><span style="color:var(--deck-muted);">${text}</span></span></div>`,
            )
            .join("")}
        </div>`,
      ),
      "One metric that tells us the product is working, and the three inputs we can move directly. All values are placeholders; fill in today's baseline and the target, and say who owns each input.",
    ],
    [
      "content",
      slide(
        ``,
        `${header("Now, next, later", "Confidence drops as we look further out. Later items are problems we intend to solve, not promises.")}
        <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
          ${column("Now", "this quarter", C.indigo, tint(C.indigo, 12), item("EXP-01", "Onboarding in under five minutes", C.indigo) + item("GRW-02", "Usage-based billing", C.indigo) + item("PLT-03", "Audit log for admins", C.indigo))}
          ${column("Next", "next 1–2 quarters", C.sky, tint(C.sky, 10), item("EXP-04", "Shared team templates", C.sky) + item("PLT-05", "Public API, version 2", C.sky) + item("PLT-06", "Self-serve single sign-on", C.sky))}
          ${column("Later", "exploring", C.orchid, tint(C.orchid, 7), item("EXP-07", "Work without a connection", C.orchid) + item("GRW-08", "Let partners extend the product", C.orchid))}
        </div>`,
      ),
      "Walk left to right and slow down on Now: that is the commitment. Replace the items and codes with your own backlog references. Resist adding dates to Later; that is what keeps this format honest.",
    ],
    [
      "content",
      slide(
        ``,
        `${header("2026 at a glance", "Solid bars are committed, dashed bars are planned, diamonds are milestones. Sample plan.")}
        <div style="${CARD}padding:14px 22px 6px;">
          <div style="display:grid;grid-template-columns:150px 1fr;padding-bottom:10px;">
            <span></span>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);${MONO}color:var(--deck-muted);">${QUARTERS.map((q) => `<span>${q} 2026</span>`).join("")}</div>
          </div>
          <div style="position:relative;">
            <div style="position:absolute;top:-6px;bottom:0;left:calc(150px + (100% - 150px) * 0.37);width:0;border-left:2px dashed var(--deck-ink);z-index:1;"></div>
            <span style="position:absolute;bottom:8px;left:calc(150px + (100% - 150px) * 0.37 - 26px);${MONO}font-weight:700;background:var(--deck-ink);color:${C.white};padding:1px 8px;border-radius:6px;z-index:1;">Today</span>
            ${lane("Experience", C.indigo, bar(0, 1.6, C.indigo, "Faster onboarding", 12) + bar(1.6, 2.4, C.indigo, "Team templates", 48, true))}
            ${lane("Platform", C.sky, bar(0.3, 1.7, C.sky, "Audit log", 12) + milestone(2, C.sky, "API v2 beta", 54) + bar(2.3, 1.7, C.sky, "API v2 GA", 12, true))}
            ${lane("Growth", C.orchid, bar(0, 2.2, C.orchid, "Usage-based billing", 12) + milestone(3, C.orchid, "Pricing launch", 54))}
          </div>
        </div>`,
      ),
      "Point to the Today line first, then read each lane left to right. Swap in your own lanes and windows. Every date here is a placeholder; if a window is a guess, say so out loud.",
    ],
    [
      "content",
      slide(
        ``,
        `${header("Three bets for this year", "Each bet names the belief behind it and the signal that would prove us wrong.")}
        <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
          ${bet("Bet 01 · Experience", C.indigo, "Setup in minutes, not days", "new teams leave because setup takes too long.", "time to first value is under 00 minutes.", 2, "medium")}
          ${bet("Bet 02 · Growth", C.orchid, "Pay for what you use", "usage pricing lowers the barrier for small teams.", "paid conversion reaches 00%.", 1, "low")}
          ${bet("Bet 03 · Platform", C.sky, "Built to be built on", "an open API turns customers into contributors.", "00 partner integrations ship.", 3, "high")}
        </div>`,
      ),
      "A bet is a belief we're funding, with a clear way to be wrong. Read the belief, then the signal. Replace the numbers with your real targets and be honest about confidence; a roadmap of only high-confidence bets is not ambitious enough.",
    ],
    [
      "content",
      slide(
        ``,
        `${header("Risks and dependencies", "What could slow us down, who is watching it, and what has to land first.")}
        <div style="flex:1;display:grid;grid-template-columns:1.5fr 1fr;gap:36px;">
          <table style="width:100%;border-collapse:collapse;align-self:start;">
            <thead><tr><th style="text-align:left;padding:0 0 8px;${MONO}color:var(--deck-muted);font-weight:500;">Risk</th><th style="text-align:left;padding:0 12px 8px;${MONO}color:var(--deck-muted);font-weight:500;">Impact</th><th style="text-align:left;padding:0 0 8px 12px;${MONO}color:var(--deck-muted);font-weight:500;">Owner</th></tr></thead>
            <tbody>
              ${risk("Billing migration slips past Q2", "High", "Team Name")}
              ${risk("API v2 needs a security review", "Med", "Team Name")}
              ${risk("Hiring for two platform roles", "Med", "Team Name")}
              ${risk("Partner demand is lower than expected", "Low", "Team Name")}
            </tbody>
          </table>
          <div style="display:flex;flex-direction:column;">
            <h2 style="margin:0 0 12px;${MONO}color:var(--deck-muted);font-weight:500;">Critical path</h2>
            ${dependency("Billing rewrite", "blocks usage-based pricing")}
            ${dependency("Usage-based pricing", "blocks pricing launch")}
            ${dependency("Pricing launch", "Q0 2026 · sample", true)}
          </div>
        </div>`,
      ),
      "Name the top risks before someone else does. Replace the owners with real names and update impact ratings each planning cycle. The critical path should be the one chain that would move every date if it slipped.",
    ],
    [
      "content",
      slide(
        `flex-direction:row;gap:40px;`,
        `<div style="flex:1.4;display:flex;flex-direction:column;gap:18px;">
          <h1 style="${H1}font-size:44px;line-height:1.02;">What we need from you</h1>
          <p style="margin:0;font-size:17px;line-height:1.5;color:var(--deck-muted);">Three decisions unblock the plan. Each has an owner and a date.</p>
          <ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;">
            ${[
              ["Approve two platform hires", "Month 00"],
              ["Choose the pricing model to test", "Month 00"],
              ["Confirm the API v2 launch partner", "Month 00"],
            ]
              .map(
                ([text, date], i) =>
                  `<li style="${CARD}display:flex;align-items:center;gap:16px;padding:14px 18px;"><span style="${MONO}color:var(--deck-accent);font-weight:700;">D0${i + 1}</span><span style="flex:1;font-size:18px;font-weight:700;">${text}</span><span style="${MONO}color:var(--deck-muted);">by ${date}</span></li>`,
              )
              .join("")}
          </ol>
        </div>
        <div style="flex:1;border-radius:18px;background:var(--deck-ink);color:${C.white};padding:26px 26px;display:flex;flex-direction:column;gap:14px;">
          <h2 style="margin:0;${HEAD}font-size:26px;color:${C.lilac};">Not doing this year</h2>
          <ul style="margin:0;padding:0 0 0 18px;display:flex;flex-direction:column;gap:16px;font-size:19px;line-height:1.45;color:${tint(C.white, 88)};">
            <li>A native desktop app</li>
            <li>Custom enterprise contracts under a set size</li>
            <li>New regions beyond the current two</li>
            <li>A rebuild of the reporting module</li>
          </ul>
          <span style="margin-top:auto;${MONO}color:${C.lilac};">Saying no is part of the plan.</span>
        </div>`,
      ),
      "End on the asks, not a thank-you slide. Read each decision and its deadline, then pause for objections. The Not-doing list prevents scope creep; replace it with the real trade-offs you've made.",
    ],
  ],
);
