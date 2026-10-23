import { authoredDeck, slideRoot } from "./a-shared.js";

// guard:allow-raw-color — authored slide palette, not app chrome.
const [paper, ink, muted, signal, surface] = [
  "#F2EFE8", // guard:allow-raw-color
  "#0B0B0A", // guard:allow-raw-color
  "#5F5B53", // guard:allow-raw-color
  "#E8401C", // guard:allow-raw-color
  "#E3DED3", // guard:allow-raw-color
];

const tokens = `--deck-bg:${paper};--deck-ink:${ink};--deck-muted:${muted};--deck-accent:${signal};--deck-surface:${surface};--deck-heading-font:'Archivo',sans-serif;--deck-body-font:'Archivo',sans-serif;--deck-radius:0px;`;

const grid =
  "display:grid;grid-template-columns:repeat(12,1fr);column-gap:24px;";
const display =
  "font-family:'Archivo',Helvetica,sans-serif;font-weight:800;letter-spacing:-0.04em;word-spacing:0.06em;margin:0;";

const slide = (body: string, style = "") =>
  slideRoot(
    tokens,
    `font-family:'Archivo',Helvetica,sans-serif;padding:32px 48px 36px;display:flex;flex-direction:column;${style}`,
    body,
  );

const runningHead = (page: number, section: string) =>
  `<div style="${grid}align-items:baseline;font-size:14px;font-weight:600;letter-spacing:-0.005em;padding-bottom:10px;border-bottom:1px solid var(--deck-ink);"><span style="grid-column:1/4;">Company Name</span><span style="grid-column:4/10;color:var(--deck-muted);">${section}</span><span style="grid-column:10/13;text-align:right;font-variant-numeric:tabular-nums;">0${page} / 06</span></div>`;

export const PITCH_DECK = authoredDeck(
  "starter-swiss-pitch",
  "Swiss pitch",
  "pitch",
  "A strict-grid investor pitch in black, paper, and one signal red: problem, product, market, model, and the ask.",
  [
    {
      layout: "title",
      content: slide(
        `${runningHead(1, "Seed round, 20XX")}
<div style="position:absolute;right:0;top:84px;width:260px;height:330px;background:radial-gradient(circle at 165px 165px,var(--deck-accent) 0 164.5px,transparent 165px);"></div>
<h1 style="${display}position:relative;margin-top:44px;font-size:108px;line-height:0.88;max-width:600px;">Make the next step obvious.</h1>
<div style="${grid}margin-top:auto;padding-top:18px;border-top:1px solid var(--deck-ink);align-items:start;">
<p style="grid-column:1/7;margin:0;font-size:19px;line-height:1.35;font-weight:500;letter-spacing:-0.01em;">Company Name gives operations teams one place to see, decide, and finish the work in front of them.</p>
<div style="grid-column:8/10;font-size:14px;line-height:1.45;"><span style="display:block;color:var(--deck-muted);">Presented by</span><span style="display:block;font-weight:600;">Name Surname</span></div>
<div style="grid-column:10/13;font-size:14px;line-height:1.45;"><span style="display:block;color:var(--deck-muted);">Raising</span><span style="display:block;font-weight:600;">$0.0M Seed</span></div>
</div>`,
      ),
      notes:
        "Open with the one-line promise, then stop talking for a beat. Replace Company Name, the presenter, and the round size. The red circle is the only decoration in the deck; keep it that way.",
    },
    {
      layout: "content",
      content: slide(
        `${runningHead(2, "The problem")}
<div style="${grid}margin-top:44px;">
<div style="grid-column:1/4;display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;align-self:start;padding-top:12px;"><span style="width:12px;height:12px;background:var(--deck-accent);"></span><span>Problem</span></div>
<h1 style="${display}grid-column:4/13;font-size:64px;line-height:0.96;">Work gets lost between the tools meant to hold it.</h1>
</div>
<div style="${grid}margin-top:auto;">
<div style="grid-column:4/7;border-top:2px solid var(--deck-ink);padding-top:14px;"><h3 style="margin:0 0 8px;font-size:19px;font-weight:700;letter-spacing:-0.02em;">Who feels it</h3><p style="margin:0;font-size:16px;line-height:1.4;color:var(--deck-muted);">Operations leads who coordinate work across five or more tools every day.</p></div>
<div style="grid-column:7/10;border-top:2px solid var(--deck-ink);padding-top:14px;"><h3 style="margin:0 0 8px;font-size:19px;font-weight:700;letter-spacing:-0.02em;">What it costs</h3><p style="margin:0;font-size:16px;line-height:1.4;color:var(--deck-muted);">Status meetings, missed handoffs, and decisions made on stale numbers.</p></div>
<div style="grid-column:10/13;border-top:2px solid var(--deck-accent);padding-top:14px;"><h3 style="margin:0 0 8px;font-size:19px;font-weight:700;letter-spacing:-0.02em;">Why now</h3><p style="margin:0;font-size:16px;line-height:1.4;color:var(--deck-muted);">Teams are consolidating software and want fewer, better systems.</p></div>
</div>`,
      ),
      notes:
        "Make the problem feel specific before you mention the product. Swap each column for evidence from your own customer interviews, and cite a source for any figure you add.",
    },
    {
      layout: "content",
      content: slide(
        `<div style="position:absolute;left:0;top:0;bottom:0;width:404px;background:var(--deck-accent);"></div>
<div style="${grid}position:relative;height:100%;">
<div style="grid-column:1/6;display:flex;flex-direction:column;padding-right:8px;">
<span style="font-size:14px;font-weight:600;padding-bottom:10px;border-bottom:1px solid var(--deck-ink);">The product</span>
<h1 style="${display}margin-top:36px;font-size:56px;line-height:0.94;">One place where work moves forward.</h1>
<p style="margin:auto 0 0;font-size:18px;line-height:1.38;font-weight:500;">Company Name connects the tools a team already uses and turns them into one ordered list of next steps.</p>
</div>
<div style="grid-column:7/13;display:flex;flex-direction:column;">
<span style="font-size:14px;font-weight:600;padding-bottom:10px;border-bottom:1px solid var(--deck-ink);text-align:right;font-variant-numeric:tabular-nums;">03 / 06</span>
<div style="display:grid;grid-template-columns:72px 1fr;column-gap:12px;padding:22px 0 20px;border-bottom:1px solid var(--deck-ink);margin-top:auto;"><span style="${display}font-size:64px;line-height:0.8;">1</span><div><h3 style="margin:0 0 6px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">Connect</h3><p style="margin:0;font-size:16px;line-height:1.4;color:var(--deck-muted);">Link existing tools in minutes. Nothing to migrate.</p></div></div>
<div style="display:grid;grid-template-columns:72px 1fr;column-gap:12px;padding:22px 0 20px;border-bottom:1px solid var(--deck-ink);"><span style="${display}font-size:64px;line-height:0.8;">2</span><div><h3 style="margin:0 0 6px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">Prioritise</h3><p style="margin:0;font-size:16px;line-height:1.4;color:var(--deck-muted);">Every open item is ranked by impact and due date.</p></div></div>
<div style="display:grid;grid-template-columns:72px 1fr;column-gap:12px;padding:22px 0 0;"><span style="${display}font-size:64px;line-height:0.8;color:var(--deck-accent);">3</span><div><h3 style="margin:0 0 6px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">Finish</h3><p style="margin:0;font-size:16px;line-height:1.4;color:var(--deck-muted);">Close the loop where the work started, automatically.</p></div></div>
</div>
</div>`,
      ),
      notes:
        "Walk the three steps left to right in under a minute. Describe capabilities that exist today; move anything on the roadmap to a later slide and label it as such.",
    },
    {
      layout: "statement",
      content: slide(
        `${runningHead(4, "Market")}
<div style="${grid}flex:1;margin-top:28px;">
<div style="grid-column:1/9;display:flex;flex-direction:column;">
<h1 style="${display}font-size:36px;line-height:1.02;max-width:520px;">A large market still run on spreadsheets and email.</h1>
<span style="${display}margin-top:auto;font-size:236px;line-height:0.74;letter-spacing:-0.07em;color:var(--deck-accent);">$00B</span>
</div>
<div style="grid-column:9/13;display:flex;flex-direction:column;justify-content:flex-end;">
<div style="border-top:2px solid var(--deck-ink);padding:12px 0 14px;"><span style="${display}display:block;font-size:34px;line-height:1;">$00B</span><span style="display:block;margin-top:4px;font-size:15px;line-height:1.35;color:var(--deck-muted);">Total addressable: every team that coordinates work</span></div>
<div style="border-top:1px solid var(--deck-ink);padding:12px 0 14px;"><span style="${display}display:block;font-size:34px;line-height:1;">$0.0B</span><span style="display:block;margin-top:4px;font-size:15px;line-height:1.35;color:var(--deck-muted);">Serviceable: mid-market operations teams</span></div>
<div style="border-top:1px solid var(--deck-ink);padding:12px 0 0;"><span style="${display}display:block;font-size:34px;line-height:1;color:var(--deck-accent);">$000M</span><span style="display:block;margin-top:4px;font-size:15px;line-height:1.35;color:var(--deck-muted);">Obtainable in five years</span></div>
</div>
</div>
<p style="margin:14px 0 0;font-size:14px;color:var(--deck-muted);">Sample figures. Replace with sourced estimates and cite each source.</p>`,
      ),
      notes:
        "Every figure on this slide is a placeholder. Replace each one with a sourced estimate, say how you sized it, and be ready to defend the bottom-up number rather than the headline.",
    },
    {
      layout: "content",
      content: slide(
        `${runningHead(5, "Business model")}
<div style="${grid}margin-top:30px;align-items:end;">
<h1 style="${display}grid-column:1/9;font-size:42px;line-height:0.98;">Priced per team. Expanding with every seat.</h1>
<p style="grid-column:9/13;margin:0;font-size:16px;line-height:1.4;color:var(--deck-muted);">Teams start on a self-serve plan and grow into annual contracts as more of the company joins.</p>
</div>
<div style="${grid}margin-top:30px;">
<div style="grid-column:1/5;border-top:2px solid var(--deck-ink);padding-top:12px;"><h3 style="margin:0;font-size:16px;font-weight:700;">Starter</h3><span style="${display}display:block;margin-top:12px;font-size:76px;line-height:0.9;">$00</span><span style="display:block;margin-top:6px;font-size:14px;color:var(--deck-muted);">per seat, per month</span></div>
<div style="grid-column:5/9;border-top:2px solid var(--deck-ink);padding-top:12px;"><h3 style="margin:0;font-size:16px;font-weight:700;">Team</h3><span style="${display}display:block;margin-top:12px;font-size:76px;line-height:0.9;">$00</span><span style="display:block;margin-top:6px;font-size:14px;color:var(--deck-muted);">per seat, billed annually</span></div>
<div style="grid-column:9/13;border-top:2px solid var(--deck-accent);padding-top:12px;"><h3 style="margin:0;font-size:16px;font-weight:700;">Enterprise</h3><span style="${display}display:block;margin-top:12px;font-size:76px;line-height:0.9;color:var(--deck-accent);">$0k+</span><span style="display:block;margin-top:6px;font-size:14px;color:var(--deck-muted);">annual contract, custom terms</span></div>
</div>
<div style="margin-top:auto;display:grid;grid-template-columns:3fr 5fr 4fr;font-size:15px;font-weight:600;">
<div style="background:var(--deck-surface);padding:12px 14px;">Land with one team</div>
<div style="background:var(--deck-ink);color:var(--deck-bg);padding:12px 14px;">Expand across departments</div>
<div style="background:var(--deck-accent);padding:12px 14px;">Renew on an annual plan</div>
</div>`,
      ),
      notes:
        "Explain how a customer grows from the first team to a company-wide contract. Replace the sample prices with your real plans, and drop a tier rather than invent one.",
    },
    {
      layout: "statement",
      content: slide(
        `${runningHead(6, "The ask")}
<div style="${grid}margin-top:36px;">
<h1 style="${display}grid-column:1/10;font-size:76px;line-height:0.9;">Raising $0.0M to reach the next milestone.</h1>
</div>
<div style="margin-top:auto;">
<p style="margin:0 0 14px;font-size:17px;line-height:1.4;font-weight:500;max-width:560px;">Twenty-four months of runway to prove repeatable sales in two segments.</p>
<div style="display:grid;grid-template-columns:50fr 32fr 18fr;border-top:2px solid var(--deck-ink);">
<div style="padding-top:10px;border-right:1px solid var(--deck-ink);"><div style="height:18px;background:var(--deck-accent);margin-right:12px;"></div><span style="display:block;margin-top:8px;font-size:15px;font-weight:600;">Product and engineering, 00%</span></div>
<div style="padding:10px 0 0 12px;border-right:1px solid var(--deck-ink);"><div style="height:18px;background:var(--deck-ink);margin-right:12px;"></div><span style="display:block;margin-top:8px;font-size:15px;font-weight:600;">Go-to-market, 00%</span></div>
<div style="padding:10px 0 0 12px;"><div style="height:18px;background:var(--deck-surface);"></div><span style="display:block;margin-top:8px;font-size:15px;font-weight:600;">Operations, 00%</span></div>
</div>
<div style="display:flex;justify-content:space-between;margin-top:22px;font-size:15px;"><span style="font-weight:600;">Name Surname, Founder</span><span style="color:var(--deck-muted);">founder@company.example</span></div>
</div>`,
      ),
      notes:
        "State the amount and what it buys in one breath, then pause for questions. Replace the round size, the use-of-funds split, and the contact details with your own.",
    },
  ],
);
