import { authoredDeck, slideRoot } from "./a-shared.js";

// guard:allow-raw-color — authored slide palette, not app chrome.
const [cream, ink, muted, oxblood, surface] = [
  "#F3ECDF", // guard:allow-raw-color
  "#1D1814", // guard:allow-raw-color
  "#675B4F", // guard:allow-raw-color
  "#7C1D2A", // guard:allow-raw-color
  "#E8DCC6", // guard:allow-raw-color
];

const tokens = `--deck-bg:${cream};--deck-ink:${ink};--deck-muted:${muted};--deck-accent:${oxblood};--deck-surface:${surface};--deck-heading-font:'Playfair Display',Georgia,serif;--deck-body-font:'Libre Franklin',sans-serif;--deck-radius:0px;`;

const serif = "font-family:'Playfair Display',Georgia,serif;";
const caps =
  "font-size:14px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;";

const slide = (folio: string, section: string, body: string) =>
  slideRoot(
    tokens,
    "font-family:'Libre Franklin',sans-serif;padding:28px 56px 22px;display:flex;flex-direction:column;",
    `<div style="${caps}display:flex;justify-content:space-between;padding-bottom:8px;border-bottom:3px double var(--deck-ink);"><span>The Company Book</span><span style="color:var(--deck-accent);">${section}</span></div>
${body}
<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;padding-top:10px;border-top:1px solid var(--deck-ink);font-size:14px;color:var(--deck-muted);"><span>Company Name</span><span style="${serif}font-style:italic;font-size:16px;color:var(--deck-ink);">${folio}</span><span>Issue 00, Spring 20XX</span></div>`,
  );

export const COMPANY_DECK = authoredDeck(
  "starter-company-book",
  "The company book",
  "company",
  "An editorial company overview set like a print magazine: masthead cover, a drop-cap essay, a pull quote, principles, history, and a closing letter.",
  [
    {
      layout: "title",
      content: slideRoot(
        tokens,
        "font-family:'Libre Franklin',sans-serif;padding:34px 56px 30px;display:flex;flex-direction:column;",
        `<div style="${caps}display:flex;justify-content:space-between;"><span>Issue 00</span><span>Company Name</span><span>Spring 20XX</span></div>
<h1 style="${serif}margin:10px 0 0;padding:6px 0 14px;border-top:3px double var(--deck-ink);border-bottom:1px solid var(--deck-ink);font-size:92px;font-weight:700;line-height:0.95;letter-spacing:-0.02em;text-align:center;">The Company Book</h1>
<div style="display:grid;grid-template-columns:1fr 1.5fr 1fr;flex:1;margin-top:22px;">
<div style="padding-right:24px;border-right:1px solid var(--deck-ink);display:flex;flex-direction:column;gap:14px;">
<span style="${caps}color:var(--deck-accent);">Inside</span>
<span style="${serif}font-size:21px;line-height:1.2;font-style:italic;">Why we exist <span style="font-family:'Libre Franklin',sans-serif;font-style:normal;font-size:14px;color:var(--deck-muted);">2</span></span>
<span style="${serif}font-size:21px;line-height:1.2;font-style:italic;">How we work <span style="font-family:'Libre Franklin',sans-serif;font-style:normal;font-size:14px;color:var(--deck-muted);">4</span></span>
<span style="${serif}font-size:21px;line-height:1.2;font-style:italic;">The year ahead <span style="font-family:'Libre Franklin',sans-serif;font-style:normal;font-size:14px;color:var(--deck-muted);">6</span></span>
</div>
<div style="padding:0 28px;display:flex;flex-direction:column;justify-content:center;">
<p style="${serif}margin:0;font-size:30px;line-height:1.22;font-style:italic;text-align:center;">An introduction to who we are, how we work, and what we are building next.</p>
<span style="margin-top:18px;font-size:14px;text-align:center;color:var(--deck-muted);">Prepared for new colleagues, partners, and friends of the company</span>
</div>
<div style="padding-left:24px;border-left:1px solid var(--deck-ink);display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end;">
<span style="${caps}color:var(--deck-muted);">Number</span>
<span style="${serif}font-size:128px;line-height:0.85;font-weight:700;font-style:italic;color:var(--deck-accent);">00</span>
</div>
</div>`,
      ),
      notes:
        "Treat this like a magazine cover: say the title, then the one-line promise in italics. Replace Company Name, the issue number, and the season. Keep the cover lines in sync with the slides that follow.",
    },
    {
      layout: "content",
      content: slide(
        "2",
        "Why we exist",
        `<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:36px;align-items:end;margin-top:22px;">
<h1 style="${serif}margin:0;font-size:42px;font-weight:700;line-height:1.02;letter-spacing:-0.01em;">A company built on doing fewer things, well.</h1>
<p style="${serif}margin:0;font-size:19px;line-height:1.35;font-style:italic;color:var(--deck-muted);">We started with a simple conviction: the tools people use at work should be as considered as the work itself.</p>
</div>
<div style="columns:3;column-gap:30px;column-rule:1px solid color-mix(in srgb,var(--deck-ink) 30%,transparent);margin-top:20px;padding-top:16px;border-top:1px solid var(--deck-ink);font-size:15px;line-height:1.5;">
<p style="margin:0 0 10px;"><span style="${serif}float:left;font-size:70px;line-height:0.8;font-weight:700;color:var(--deck-accent);padding:5px 8px 0 0;">T</span>he company began around a kitchen table in 20XX, with three founders and one stubborn question: why does good work so often happen in spite of the tools around it?</p>
<p style="margin:0 0 10px;">Our answer was to build fewer features and finish each one properly. That habit still shapes how we hire, how we plan, and what we decline to build.</p>
<p style="margin:0 0 10px;">Today we are a small team of 00 people across 0 cities. We serve customers who care about craft as much as we do, and we measure ourselves by the time we give back to them.</p>
<p style="margin:0;">Replace this essay with your own founding story. Keep it short, specific, and in the first person plural.</p>
</div>`,
      ),
      notes:
        "Read the headline, then let the room skim the essay while you tell the story in your own words. Replace every sentence with your real founding story; numbers are placeholders.",
    },
    {
      layout: "statement",
      content: slide(
        "3",
        "In their words",
        `<div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 60px;">
<span aria-hidden="true" style="${serif}font-size:120px;line-height:0.5;height:52px;font-weight:700;color:var(--deck-accent);">&ldquo;</span>
<h1 style="${serif}margin:0;font-size:42px;font-weight:400;font-style:italic;line-height:1.18;letter-spacing:-0.01em;">We would rather be the best at one thing people need every day than adequate at twenty.</h1>
<span style="display:block;width:64px;margin:24px 0 14px;border-top:1px solid var(--deck-accent);"></span>
<p style="margin:0;${caps}">Name Surname, co-founder and chief executive</p>
</div>`,
      ),
      notes:
        "Pause after the quote and let it land before you speak. Use a real quote from a founder or colleague, with their permission, and attribute it exactly.",
    },
    {
      layout: "content",
      content: slide(
        "4",
        "How we work",
        `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px;margin-top:22px;">
<h1 style="${serif}margin:0;font-size:52px;font-weight:700;line-height:1;letter-spacing:-0.01em;">How we work</h1>
<p style="${serif}margin:0;max-width:380px;font-size:18px;line-height:1.35;font-style:italic;color:var(--deck-muted);text-align:right;">Three principles we hire for, plan by, and hold each other to.</p>
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);margin-top:22px;border-top:1px solid var(--deck-ink);flex:1;">
<div style="padding:20px 26px 0 0;"><span style="${serif}display:block;font-size:64px;line-height:1;font-style:italic;color:var(--deck-accent);">I.</span><h3 style="${serif}margin:14px 0 10px;font-size:24px;font-weight:700;line-height:1.15;">Finish what we start</h3><p style="margin:0;font-size:16px;line-height:1.5;">We ship fewer things and take each one all the way, from first sketch to the help article.</p></div>
<div style="padding:20px 26px 0;border-left:1px solid var(--deck-ink);"><span style="${serif}display:block;font-size:64px;line-height:1;font-style:italic;color:var(--deck-accent);">II.</span><h3 style="${serif}margin:14px 0 10px;font-size:24px;font-weight:700;line-height:1.15;">Write it down</h3><p style="margin:0;font-size:16px;line-height:1.5;">Decisions live in documents anyone can read, so the quietest person in the room is heard.</p></div>
<div style="padding:20px 0 0 26px;border-left:1px solid var(--deck-ink);"><span style="${serif}display:block;font-size:64px;line-height:1;font-style:italic;color:var(--deck-accent);">III.</span><h3 style="${serif}margin:14px 0 10px;font-size:24px;font-weight:700;line-height:1.15;">Meet the customer</h3><p style="margin:0;font-size:16px;line-height:1.5;">Everyone, including engineers and finance, spends time with the people we build for.</p></div>
</div>`,
      ),
      notes:
        "Give one real example for each principle; stories stick better than the words on the slide. Replace the three principles with the values your team actually uses to make decisions.",
    },
    {
      layout: "content",
      content: slide(
        "5",
        "A short history",
        `<div style="display:grid;grid-template-columns:280px 1fr;gap:44px;flex:1;margin-top:22px;">
<div>
<h1 style="${serif}margin:0;font-size:46px;font-weight:700;line-height:1.02;letter-spacing:-0.01em;">A short history</h1>
<p style="margin:16px 0 0;font-size:16px;line-height:1.5;color:var(--deck-muted);">The milestones that shaped us, from the first prototype to the company we are today.</p>
</div>
<div style="font-size:16px;line-height:1.4;">
<div style="display:grid;grid-template-columns:96px 1fr;gap:20px;align-items:baseline;padding:11px 0;border-top:1px solid var(--deck-ink);"><span style="${serif}font-size:26px;font-weight:700;color:var(--deck-accent);">20XX</span><span>Three founders build the first prototype for a friend's team.</span></div>
<div style="display:grid;grid-template-columns:96px 1fr;gap:20px;align-items:baseline;padding:11px 0;border-top:1px dotted var(--deck-ink);"><span style="${serif}font-size:26px;font-weight:700;color:var(--deck-accent);">20XX</span><span>The first paying customer, and the first hire.</span></div>
<div style="display:grid;grid-template-columns:96px 1fr;gap:20px;align-items:baseline;padding:11px 0;border-top:1px dotted var(--deck-ink);"><span style="${serif}font-size:26px;font-weight:700;color:var(--deck-accent);">20XX</span><span>Seed funding and a second office.</span></div>
<div style="display:grid;grid-template-columns:96px 1fr;gap:20px;align-items:baseline;padding:11px 0;border-top:1px dotted var(--deck-ink);"><span style="${serif}font-size:26px;font-weight:700;color:var(--deck-accent);">20XX</span><span>Version two, rebuilt around what customers asked for.</span></div>
<div style="display:grid;grid-template-columns:96px 1fr;gap:20px;align-items:baseline;padding:11px 0;border-top:1px dotted var(--deck-ink);border-bottom:1px solid var(--deck-ink);"><span style="${serif}font-size:26px;font-weight:700;font-style:italic;">Today</span><span>00 people, 0 cities, and one clear focus.</span></div>
</div>
</div>`,
      ),
      notes:
        "Move quickly through the early years and slow down on the most recent milestone. Replace each year and event with your own history; keep it to five rows.",
    },
    {
      layout: "content",
      content: slide(
        "6",
        "The year ahead",
        `<div style="display:grid;grid-template-columns:1fr 1.35fr;gap:48px;flex:1;margin-top:22px;">
<div style="display:flex;flex-direction:column;">
<h1 style="${serif}margin:0;font-size:46px;font-weight:400;font-style:italic;line-height:1.05;">A letter on the year ahead</h1>
<div style="margin-top:auto;margin-bottom:18px;padding:16px 18px;background:var(--deck-surface);">
<span style="${caps}display:block;color:var(--deck-accent);margin-bottom:8px;">Three priorities</span>
<span style="display:block;font-size:15px;line-height:1.6;">Deepen the core product<br>Grow the team with care<br>Earn every renewal</span>
</div>
</div>
<div style="font-size:16px;line-height:1.55;">
<p style="margin:0 0 12px;">Dear colleagues, this year we will do less, and do it better. We will finish the work already in motion before we start anything new.</p>
<p style="margin:0 0 12px;">We will grow deliberately, hiring people who raise the bar for everyone around them. And we will stay close to the customers who trusted us first.</p>
<p style="margin:0;color:var(--deck-muted);">Replace this letter with your own; keep it warm, specific, and short.</p>
<span style="${serif}display:block;margin-top:18px;font-size:26px;font-style:italic;color:var(--deck-accent);">Name Surname</span>
<span style="font-size:14px;color:var(--deck-muted);">Co-founder and chief executive</span>
</div>
</div>`,
      ),
      notes:
        "Close personally: read one sentence of the letter aloud, then open the floor. Rewrite the letter and priorities in your own voice before sharing the deck.",
    },
  ],
);
