import { authoredDeck, slideRoot } from "./a-shared.js";

// guard:allow-raw-color — authored slide palette, not app chrome.
const [sand, ink, muted, terracotta, surface] = [
  "#F3E9DB", // guard:allow-raw-color
  "#2B211A", // guard:allow-raw-color
  "#6F6155", // guard:allow-raw-color
  "#B9583A", // guard:allow-raw-color
  "#E9D9C3", // guard:allow-raw-color
];
// guard:allow-raw-color — authored duotone photo placeholder tones, not app chrome.
const [forest, clay, peach] = ["#1F3D33", "#E3A07C", "#F2CDAE"];

const tokens = `--deck-bg:${sand};--deck-ink:${ink};--deck-muted:${muted};--deck-accent:${terracotta};--deck-surface:${surface};--deck-heading-font:'Bricolage Grotesque',sans-serif;--deck-body-font:'Lora',Georgia,serif;--deck-radius:18px;--cs-forest:${forest};--cs-clay:${clay};--cs-peach:${peach};`;

const grotesk = "font-family:'Bricolage Grotesque',sans-serif;";
const lora = "font-family:'Lora',Georgia,serif;";
const h1 = `${grotesk}font-weight:700;letter-spacing:-0.03em;margin:0;`;
const tag = `${grotesk}display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;`;

const slide = (body: string, style = "") =>
  slideRoot(
    tokens,
    `font-family:'Lora',Georgia,serif;padding:40px 52px;display:flex;flex-direction:column;${style}`,
    body,
  );

/** Duotone scenes that stand in for photography; the caption tells the author what to shoot. */
const scenes = {
  landscape:
    "radial-gradient(circle at 74% 30%,var(--cs-peach) 0 9%,transparent 9.5%),radial-gradient(ellipse 75% 42% at 22% 104%,var(--cs-forest) 0 99%,transparent 100%),radial-gradient(ellipse 85% 50% at 92% 110%,color-mix(in srgb,var(--cs-forest) 75%,var(--deck-ink)) 0 99%,transparent 100%),radial-gradient(ellipse 120% 60% at 50% 100%,color-mix(in srgb,var(--deck-accent) 70%,var(--cs-forest)) 0 99%,transparent 100%),linear-gradient(180deg,var(--cs-clay),var(--deck-accent))",
  portrait:
    "radial-gradient(circle at 50% 40%,var(--cs-peach) 0 17%,transparent 17.5%),radial-gradient(ellipse 42% 30% at 50% 100%,var(--cs-peach) 0 99%,transparent 100%),linear-gradient(165deg,var(--deck-accent),var(--cs-forest))",
  workshop:
    "linear-gradient(0deg,color-mix(in srgb,var(--deck-ink) 55%,transparent) 0 22%,transparent 22%),repeating-linear-gradient(90deg,transparent 0 46px,color-mix(in srgb,var(--cs-forest) 35%,transparent) 46px 50px),radial-gradient(circle at 30% 42%,var(--cs-peach) 0 8%,transparent 8.5%),radial-gradient(circle at 64% 38%,var(--cs-peach) 0 7%,transparent 7.5%),linear-gradient(160deg,var(--cs-clay),var(--cs-forest))",
} as const;

const photo = (
  scene: keyof typeof scenes,
  caption: string,
  style: string,
  showCaption = true,
) =>
  `<div role="img" aria-label="Photo placeholder: ${caption}" style="position:relative;background:${scenes[scene]};${style}">${showCaption ? `<span style="${grotesk}position:absolute;left:14px;bottom:14px;padding:4px 10px;border-radius:999px;font-size:14px;background:color-mix(in srgb,var(--deck-bg) 88%,transparent);color:var(--deck-ink);">Photo: ${caption}</span>` : ""}</div>`;

export const CASE_STUDY_DECK = authoredDeck(
  "starter-customer-story",
  "Customer story",
  "case-study",
  "A warm, human case study with duotone photo placeholders: the customer, their challenge, the approach, a big quote, and the results.",
  [
    {
      layout: "title",
      content: slide(
        `${photo("landscape", "the customer's team on site", "position:absolute;left:0;top:0;bottom:0;width:420px;")}
<span style="${tag}position:absolute;left:28px;top:28px;padding:6px 12px;border-radius:999px;background:var(--deck-bg);color:var(--deck-accent);">Customer story</span>
<div style="margin-left:400px;display:flex;flex-direction:column;height:100%;">
<h1 style="${h1}margin-top:12px;font-size:48px;line-height:1.02;">How Customer Name gave its field teams their afternoons back</h1>
<p style="${lora}margin:18px 0 0;font-size:20px;line-height:1.45;font-style:italic;color:var(--deck-muted);">A story about replacing four tools with one calm, shared workflow.</p>
<div style="margin-top:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding-top:16px;border-top:1px solid color-mix(in srgb,var(--deck-ink) 25%,transparent);">
<div><span style="${grotesk}display:block;font-size:14px;color:var(--deck-muted);">Industry</span><span style="${grotesk}font-size:16px;font-weight:700;">Field services</span></div>
<div><span style="${grotesk}display:block;font-size:14px;color:var(--deck-muted);">Team size</span><span style="${grotesk}font-size:16px;font-weight:700;">000 people</span></div>
<div><span style="${grotesk}display:block;font-size:14px;color:var(--deck-muted);">Region</span><span style="${grotesk}font-size:16px;font-weight:700;">Sample region</span></div>
</div>
</div>`,
      ),
      notes:
        "Tell the headline as a story, not a statistic. Replace Customer Name and the facts with a real customer who has approved being named, and swap the photo placeholder for a real image.",
    },
    {
      layout: "content",
      content: slide(
        `<div style="display:grid;grid-template-columns:1fr 330px;gap:52px;height:100%;">
<div style="display:flex;flex-direction:column;">
<h1 style="${h1}font-size:44px;line-height:1.02;">Meet Customer Name</h1>
<p style="margin:18px 0 0;font-size:18px;line-height:1.6;">A family-run field services company with crews spread across a wide region. Their dispatchers kept the whole operation running from whiteboards, group chats, and a spreadsheet only one person fully understood.</p>
<dl style="margin:auto 0 0;display:grid;grid-template-columns:auto 1fr;gap:10px 24px;font-size:16px;">
<dt style="${grotesk}font-weight:700;">Founded</dt><dd style="margin:0;color:var(--deck-muted);">20XX, as a two-person crew</dd>
<dt style="${grotesk}font-weight:700;">Crews</dt><dd style="margin:0;color:var(--deck-muted);">00 teams across 0 depots</dd>
<dt style="${grotesk}font-weight:700;">Customer since</dt><dd style="margin:0;color:var(--deck-muted);">Q0 20XX</dd>
</dl>
</div>
${photo("portrait", "operations lead at the depot", "border-radius:999px 999px var(--deck-radius) var(--deck-radius);")}
</div>`,
      ),
      notes:
        "Introduce the customer as people first: who they are and what a normal day looks like. Replace the description and facts with approved details, and use a real portrait in place of the placeholder.",
    },
    {
      layout: "statement",
      content: slide(
        `<h1 style="${h1}margin-top:8px;font-size:72px;line-height:0.98;max-width:820px;">Every handoff lived somewhere <span style="${lora}font-weight:400;font-style:italic;color:var(--deck-accent);">different.</span></h1>
<div style="margin-top:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:0;">
<div style="padding-right:28px;"><h3 style="${grotesk}margin:0 0 8px;font-size:20px;font-weight:700;">Scattered schedules</h3><p style="margin:0;font-size:16px;line-height:1.55;color:var(--deck-muted);">Crews checked three places each morning to learn where to go first.</p></div>
<div style="padding:0 28px;border-left:1px dashed color-mix(in srgb,var(--deck-ink) 35%,transparent);"><h3 style="${grotesk}margin:0 0 8px;font-size:20px;font-weight:700;">Lost context</h3><p style="margin:0;font-size:16px;line-height:1.55;color:var(--deck-muted);">Notes from one visit rarely reached the next person on the job.</p></div>
<div style="padding-left:28px;border-left:1px dashed color-mix(in srgb,var(--deck-ink) 35%,transparent);"><h3 style="${grotesk}margin:0 0 8px;font-size:20px;font-weight:700;">Late evenings</h3><p style="margin:0;font-size:16px;line-height:1.55;color:var(--deck-muted);">Dispatchers rebuilt tomorrow's plan by hand after everyone else went home.</p></div>
</div>`,
      ),
      notes:
        "Let the customer's pain speak in their own terms. Replace these three symptoms with what your customer actually described, ideally in their words from the interview.",
    },
    {
      layout: "content",
      content: slide(
        `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px;">
<h1 style="${h1}font-size:44px;line-height:1.02;white-space:nowrap;">The approach, in three steps</h1>
<p style="margin:0;max-width:240px;font-size:16px;line-height:1.5;font-style:italic;color:var(--deck-muted);">Small, visible changes, rolled out one depot at a time.</p>
</div>
<div style="position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:36px;margin:auto 0;">
<span style="position:absolute;left:60px;right:calc(33% - 30px);top:60px;border-top:2px dashed var(--deck-accent);"></span>
<div style="position:relative;">${photo("workshop", "listening session", "width:120px;height:120px;border-radius:50%;", false)}<span style="${tag}display:block;margin-top:18px;color:var(--deck-accent);">Weeks 0 to 0</span><h3 style="${grotesk}margin:6px 0 8px;font-size:22px;font-weight:700;">Listen</h3><p style="margin:0;font-size:16px;line-height:1.5;color:var(--deck-muted);">Rode along with crews and mapped every handoff on paper.</p></div>
<div style="position:relative;">${photo("landscape", "pilot depot", "width:120px;height:120px;border-radius:50%;", false)}<span style="${tag}display:block;margin-top:18px;color:var(--deck-accent);">Weeks 0 to 0</span><h3 style="${grotesk}margin:6px 0 8px;font-size:22px;font-weight:700;">Pilot</h3><p style="margin:0;font-size:16px;line-height:1.5;color:var(--deck-muted);">Moved one depot to a single shared schedule and daily brief.</p></div>
<div style="position:relative;">${photo("portrait", "crew lead", "width:120px;height:120px;border-radius:50%;", false)}<span style="${tag}display:block;margin-top:18px;color:var(--deck-accent);">Weeks 0 to 0</span><h3 style="${grotesk}margin:6px 0 8px;font-size:22px;font-weight:700;">Roll out</h3><p style="margin:0;font-size:16px;line-height:1.5;color:var(--deck-muted);">Trained a champion in each depot, then switched off the old tools.</p></div>
</div>`,
      ),
      notes:
        "Walk the three steps as a timeline and name who was involved at each one. Replace the week ranges and descriptions with what really happened, and use real photos from each stage.",
    },
    {
      layout: "statement",
      content: slide(
        `<div style="display:grid;grid-template-columns:1fr 250px;gap:48px;align-items:center;height:100%;">
<div>
<span aria-hidden="true" style="${lora}display:block;height:60px;font-size:130px;line-height:0.9;color:var(--cs-clay);">&ldquo;</span>
<h1 style="${lora}margin:0;font-size:38px;font-weight:400;font-style:italic;line-height:1.28;letter-spacing:-0.01em;">For the first time in years, our crews finish the day knowing tomorrow is already sorted.</h1>
<p style="${grotesk}margin:26px 0 0;font-size:17px;line-height:1.4;"><span style="font-weight:700;">Name Surname</span><span style="color:color-mix(in srgb,var(--deck-bg) 75%,transparent);">, Operations lead at Customer Name</span></p>
</div>
${photo("portrait", "speaker portrait", "height:320px;border-radius:999px;")}
</div>`,
        "background:var(--cs-forest);color:var(--deck-bg);padding:40px 60px;",
      ),
      notes:
        "Read the quote slowly and credit the speaker by name. Use a verbatim, approved quote from your customer, and replace the portrait placeholder with their photo.",
    },
    {
      layout: "content",
      content: slide(
        `<div style="display:grid;grid-template-columns:1fr 240px;gap:44px;height:100%;">
<div style="display:flex;flex-direction:column;">
<h1 style="${h1}font-size:44px;line-height:1.02;">What changed in the first six months</h1>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:auto;">
<div style="border-top:2px solid var(--deck-ink);padding-top:14px;"><span style="${grotesk}display:block;font-size:72px;font-weight:700;line-height:0.95;letter-spacing:-0.04em;color:var(--deck-accent);">00%</span><span style="display:block;margin-top:10px;font-size:16px;line-height:1.45;">fewer scheduling calls each week</span></div>
<div style="border-top:2px solid var(--deck-ink);padding-top:14px;"><span style="${grotesk}display:block;font-size:72px;font-weight:700;line-height:0.95;letter-spacing:-0.04em;color:var(--deck-accent);">0.0h</span><span style="display:block;margin-top:10px;font-size:16px;line-height:1.45;">saved per dispatcher, every day</span></div>
<div style="border-top:2px solid var(--deck-ink);padding-top:14px;"><span style="${grotesk}display:block;font-size:72px;font-weight:700;line-height:0.95;letter-spacing:-0.04em;color:var(--deck-accent);">0x</span><span style="display:block;margin-top:10px;font-size:16px;line-height:1.45;">more jobs closed on the first visit</span></div>
</div>
<p style="${grotesk}margin:22px 0 0;font-size:14px;color:var(--deck-muted);">Sample figures. Replace with measured results and state the measurement period.</p>
</div>
${photo("workshop", "morning brief", "border-radius:var(--deck-radius);")}
</div>`,
      ),
      notes:
        "Land on the single most meaningful number and explain how it was measured. Every figure here is a placeholder; only publish results the customer has verified and approved.",
    },
  ],
);
