import { authoredDeck, slideRoot } from "./a-shared.js";

// guard:allow-raw-color — authored slide palette, not app chrome.
const [paper, ink, muted, marker, yellow, dot] = [
  "#FBF9F3", // guard:allow-raw-color
  "#23262D", // guard:allow-raw-color
  "#5E626B", // guard:allow-raw-color
  "#2C57D8", // guard:allow-raw-color
  "#FFE68A", // guard:allow-raw-color
  "#D6D1C4", // guard:allow-raw-color
];
// guard:allow-raw-color — authored sticky-note pastels, not app chrome.
const [pink, sky, mint, peach] = ["#FFC7D4", "#BDE0FF", "#C7EFC1", "#FFD3A6"];

const tokens = `--deck-bg:${paper};--deck-ink:${ink};--deck-muted:${muted};--deck-accent:${marker};--deck-surface:${yellow};--deck-heading-font:'Nunito',sans-serif;--deck-body-font:'Nunito',sans-serif;--deck-radius:4px;--ws-dot:${dot};--ws-pink:${pink};--ws-sky:${sky};--ws-mint:${mint};--ws-peach:${peach};`;

const hand = "font-family:'Caveat',cursive;";
const h1 =
  "font-family:'Nunito',sans-serif;font-weight:700;letter-spacing:-0.02em;margin:0;";

const slide = (body: string) =>
  slideRoot(
    tokens,
    "font-family:'Nunito',sans-serif;background-image:radial-gradient(var(--ws-dot) 1.3px,transparent 1.7px);background-size:24px 24px;background-position:12px 12px;padding:40px 52px;display:flex;flex-direction:column;",
    body,
  );

type Note = "surface" | "pink" | "sky" | "mint" | "peach";
const noteColor = (note: Note) =>
  note === "surface" ? "var(--deck-surface)" : `var(--ws-${note})`;

const sticky = (note: Note, tilt: number, body: string, style = "") =>
  `<div style="position:relative;background:${noteColor(note)};padding:18px 16px 16px;transform:rotate(${tilt}deg);box-shadow:0 8px 16px -6px color-mix(in srgb,var(--deck-ink) 30%,transparent);${style}"><span style="position:absolute;left:50%;top:-9px;width:64px;height:18px;margin-left:-32px;background:color-mix(in srgb,var(--deck-bg) 60%,transparent);transform:rotate(${-tilt * 1.5}deg);"></span>${body}</div>`;

const highlight =
  "background:linear-gradient(transparent 55%,var(--deck-surface) 55% 92%,transparent 92%);padding:0 4px;";

/** A marker arc: the top border of an ellipse, finished with a chevron at its right end. */
const arrow = (style: string, width = 140, height = 70) =>
  `<span aria-hidden="true" style="position:absolute;width:${width}px;height:${height}px;border:3px solid transparent;border-top-color:var(--deck-accent);border-radius:50%;${style}"><span style="position:absolute;right:-1px;top:${height / 2 - 14}px;width:13px;height:13px;border-right:3px solid var(--deck-accent);border-bottom:3px solid var(--deck-accent);transform:rotate(40deg);"></span></span>`;

const circled = (n: number) =>
  `<span style="${hand}display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;border:2.5px solid var(--deck-accent);border-radius:52% 46% 55% 44%;font-size:24px;font-weight:700;color:var(--deck-accent);">${n}</span>`;

const agenda = (time: string, title: string, minutes: string) =>
  `<div style="display:grid;grid-template-columns:64px 1fr auto;align-items:baseline;gap:14px;padding:9px 0;border-bottom:2px dashed color-mix(in srgb,var(--deck-ink) 18%,transparent);"><span style="${hand}font-size:28px;font-weight:700;color:var(--deck-accent);">${time}</span><span style="font-size:19px;font-weight:700;">${title}</span><span style="font-size:15px;color:var(--deck-muted);">${minutes}</span></div>`;

const cluster = (title: string, notes: readonly [Note, number, string][]) =>
  `<div style="display:flex;flex-direction:column;gap:14px;"><h3 style="${hand}margin:0 0 4px;font-size:34px;font-weight:700;line-height:1;"><span style="${highlight}">${title}</span></h3>${notes.map(([note, tilt, text]) => sticky(note, tilt, `<span style="font-size:17px;line-height:1.3;font-weight:700;">${text}</span>`, "padding:14px 14px 12px;")).join("")}</div>`;

const todo = (text: string, owner: string, done = false) =>
  `<div style="display:grid;grid-template-columns:26px 1fr;gap:12px;align-items:start;"><span style="position:relative;width:22px;height:22px;margin-top:2px;border:2.5px solid var(--deck-ink);border-radius:4px 6px 3px 5px;">${done ? `<span style="position:absolute;left:5px;top:-3px;width:9px;height:17px;border-right:3px solid var(--deck-accent);border-bottom:3px solid var(--deck-accent);transform:rotate(40deg);"></span>` : ""}</span><span style="font-size:18px;line-height:1.35;font-weight:700;">${text}<span style="${hand}display:block;font-size:22px;font-weight:400;color:var(--deck-muted);">${owner}</span></span></div>`;

export const WORKSHOP_DECK = authoredDeck(
  "starter-workshop-kit",
  "Workshop kit",
  "workshop",
  "A playful whiteboard kit for facilitators: dotted paper, sticky notes, marker arrows, a timed agenda, an exercise, clustering, and a parking lot.",
  [
    {
      layout: "title",
      content: slide(
        `<div style="display:grid;grid-template-columns:1fr 330px;gap:30px;height:100%;align-items:center;">
<div>
<h1 style="${h1}font-size:62px;line-height:1.02;">Mapping the <span style="${highlight}">customer journey</span></h1>
<p style="${hand}margin:18px 0 0;font-size:34px;line-height:1.1;color:var(--deck-accent);max-width:420px;">A 90-minute working session for the whole team</p>
<span style="display:block;margin-top:34px;font-size:16px;color:var(--deck-muted);">Facilitated by Name Surname &middot; Room 0 &middot; 20XX-00-00</span>
</div>
<div style="position:relative;height:400px;">
${sticky("surface", -5, `<span style="${hand}font-size:30px;line-height:1.05;font-weight:700;">What do customers notice first?</span>`, "position:absolute;left:10px;top:10px;width:180px;height:150px;box-sizing:border-box;")}
${sticky("pink", 6, `<span style="${hand}font-size:30px;line-height:1.05;font-weight:700;">Where do they get stuck?</span>`, "position:absolute;right:0;top:120px;width:170px;height:150px;box-sizing:border-box;")}
${sticky("sky", -3, `<span style="${hand}font-size:30px;line-height:1.05;font-weight:700;">What would delight them?</span>`, "position:absolute;left:40px;top:246px;width:180px;height:140px;box-sizing:border-box;")}
</div>
</div>
${arrow("left:470px;top:392px;transform:rotate(-4deg);", 140, 60)}`,
      ),
      notes:
        "Welcome everyone and read the three questions on the sticky notes aloud; they frame the whole session. Replace the topic, facilitator, room, and date with your own details.",
    },
    {
      layout: "content",
      content: slide(
        `<div style="display:grid;grid-template-columns:270px 1fr;gap:56px;height:100%;align-items:center;">
<div style="display:flex;flex-direction:column;align-items:center;">
<div style="position:relative;width:240px;height:240px;border-radius:50%;background:conic-gradient(var(--deck-accent) 0 11%,color-mix(in srgb,var(--deck-accent) 14%,var(--deck-bg)) 11% 100%);">
<div style="position:absolute;inset:18px;border-radius:50%;background:var(--deck-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;"><span style="${hand}font-size:76px;font-weight:700;line-height:0.9;">90:00</span><span style="font-size:15px;color:var(--deck-muted);">minutes on the clock</span></div>
</div>
<span style="${hand}margin-top:16px;font-size:26px;color:var(--deck-accent);">first up: the warm-up</span>
</div>
<div>
<h1 style="${h1}font-size:42px;line-height:1.05;">Today's plan</h1>
<p style="margin:8px 0 14px;font-size:17px;line-height:1.45;color:var(--deck-muted);">Five blocks, each with a clear output. We will keep to time.</p>
${agenda("0:00", "Warm-up and goals", "10 min")}
${agenda("0:10", "Map the journey, stage by stage", "25 min")}
${agenda("0:35", "Find the friction", "20 min")}
${agenda("0:55", "Dot vote on what to fix", "15 min")}
${agenda("1:10", "Owners and next steps", "20 min")}
</div>
</div>`,
      ),
      notes:
        "Start a visible timer and point to where you are on the agenda at every transition. Adjust block names and timings to your session; keep each block tied to a concrete output.",
    },
    {
      layout: "content",
      content: slide(
        `<h1 style="${h1}font-size:42px;line-height:1.05;">How we'll work together</h1>
<p style="margin:10px 0 0;font-size:18px;line-height:1.45;color:var(--deck-muted);max-width:560px;">Four agreements that keep the session moving and make sure everyone is heard.</p>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:26px;margin:auto 0;">
${sticky("surface", -3, `<span style="${hand}display:block;font-size:34px;font-weight:700;line-height:1;">Yes, and&hellip;</span><span style="display:block;margin-top:14px;font-size:16px;line-height:1.4;">Build on ideas before you judge them.</span>`, "height:220px;box-sizing:border-box;")}
${sticky("pink", 2.5, `<span style="${hand}display:block;font-size:34px;font-weight:700;line-height:1;">Laptops closed</span><span style="display:block;margin-top:14px;font-size:16px;line-height:1.4;">Screens down unless you are the scribe.</span>`, "height:220px;box-sizing:border-box;margin-top:18px;")}
${sticky("sky", -1.5, `<span style="${hand}display:block;font-size:34px;font-weight:700;line-height:1;">One voice at a time</span><span style="display:block;margin-top:14px;font-size:16px;line-height:1.4;">Hold the marker to hold the floor.</span>`, "height:220px;box-sizing:border-box;")}
${sticky("mint", 3.5, `<span style="${hand}display:block;font-size:34px;font-weight:700;line-height:1;">Park it</span><span style="display:block;margin-top:14px;font-size:16px;line-height:1.4;">Good tangents go to the parking lot, not the bin.</span>`, "height:220px;box-sizing:border-box;margin-top:12px;")}
</div>`,
      ),
      notes:
        "Ask the group to agree to these out loud, and invite one more agreement from the room. Swap any rule that does not fit your team's culture.",
    },
    {
      layout: "content",
      content: slide(
        `<div style="display:grid;grid-template-columns:1fr 370px;gap:56px;height:100%;">
<div style="display:flex;flex-direction:column;">
<h1 style="${h1}font-size:40px;line-height:1.05;">How might we?</h1>
<p style="margin:10px 0 0;font-size:18px;line-height:1.45;color:var(--deck-muted);">Turn the friction you found into questions worth solving.</p>
<div style="display:flex;flex-direction:column;gap:18px;margin-top:auto;">
<div style="display:flex;gap:14px;align-items:center;">${circled(1)}<span style="font-size:18px;line-height:1.35;font-weight:700;">On your own, write one question per sticky.</span></div>
<div style="display:flex;gap:14px;align-items:center;">${circled(2)}<span style="font-size:18px;line-height:1.35;font-weight:700;">In pairs, read them aloud and pick your best two.</span></div>
<div style="display:flex;gap:14px;align-items:center;">${circled(3)}<span style="font-size:18px;line-height:1.35;font-weight:700;">Post them under the journey stage they belong to.</span></div>
</div>
<span style="${hand}display:inline-block;align-self:flex-start;margin-top:22px;padding:2px 14px;border:2.5px solid var(--deck-ink);border-radius:18px 14px 20px 12px;font-size:28px;font-weight:700;">8 minutes, then pairs</span>
</div>
<div style="position:relative;align-self:center;">
${sticky("surface", 2, `<span style="${hand}display:block;font-size:40px;font-weight:700;line-height:1.3;">How might we <span style="display:inline-block;width:150px;border-bottom:2.5px solid var(--deck-ink);"></span> for <span style="display:inline-block;width:170px;border-bottom:2.5px solid var(--deck-ink);"></span> so that <span style="display:inline-block;width:120px;border-bottom:2.5px solid var(--deck-ink);"></span>?</span>`, "padding:32px 30px 30px;")}
<span style="${hand}position:absolute;right:6px;top:-50px;font-size:26px;color:var(--deck-accent);transform:rotate(-3deg);">keep it open, not a solution</span>
</div>
</div>
${arrow("left:330px;top:438px;transform:rotate(-16deg);", 175, 56)}`,
      ),
      notes:
        "Model one example on the board before the timer starts. Keep people writing silently first; replace the prompt and timing with whatever your exercise needs.",
    },
    {
      layout: "content",
      content: slide(
        `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:32px;">
<h1 style="${h1}font-size:42px;line-height:1.05;">What we heard</h1>
<p style="margin:0;max-width:360px;font-size:17px;line-height:1.45;color:var(--deck-muted);">Sticky notes grouped by stage. Add a dot to the ones you would fix first.</p>
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:44px;margin-top:24px;">
${cluster("Getting started", [
  ["surface", -2, "Setup asks for things I don't have yet"],
  ["surface", 1.5, "Not sure what to do after signing up"],
  ["peach", -1, "The welcome email felt helpful"],
])}
${cluster("Day to day", [
  ["pink", 2, "Hard to find last week's work"],
  ["pink", -1.5, "Too many notifications, none that matter"],
  ["pink", 1, "Sharing with a teammate takes four clicks"],
])}
${cluster("Getting help", [
  ["sky", -2.5, "Help articles don't match the screens"],
  ["surface", 1.5, "Can't tell if my ticket was seen"],
  ["mint", -1, "Loved the quick reply from support"],
])}
</div>`,
      ),
      notes:
        "Read a few notes from each cluster aloud before voting. These notes are examples; replace them with what your participants actually wrote.",
    },
    {
      layout: "content",
      content: slide(
        `<h1 style="${h1}font-size:42px;line-height:1.05;">Before we go</h1>
<div style="display:grid;grid-template-columns:1fr 330px;gap:48px;flex:1;margin-top:22px;">
<div style="position:relative;border:3px dashed var(--deck-ink);border-radius:22px 16px 26px 14px;padding:18px 22px 22px;transform:rotate(-0.8deg);">
<h3 style="${hand}margin:0;font-size:40px;font-weight:700;line-height:1;">Parking lot</h3>
<p style="margin:4px 0 26px;font-size:16px;line-height:1.4;color:var(--deck-muted);">Good ideas we did not have time for today.</p>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px;">
${sticky("peach", -3, `<span style="${hand}font-size:28px;line-height:1.05;font-weight:700;">Pricing page confusion</span>`, "height:196px;box-sizing:border-box;padding:16px 12px 12px;")}
${sticky("surface", 2.5, `<span style="${hand}font-size:28px;line-height:1.05;font-weight:700;">Mobile onboarding</span>`, "height:196px;box-sizing:border-box;padding:16px 12px 12px;margin-top:16px;")}
${sticky("mint", -1.5, `<span style="${hand}font-size:28px;line-height:1.05;font-weight:700;">Ask sales what they hear</span>`, "height:196px;box-sizing:border-box;padding:16px 12px 12px;")}
</div>
</div>
<div style="display:flex;flex-direction:column;gap:18px;">
<h3 style="${hand}margin:0;font-size:40px;font-weight:700;line-height:1;color:var(--deck-accent);">Next steps</h3>
${todo("Share the photos of the wall", "Name Surname, today", true)}
${todo("Turn the top three votes into briefs", "Name Surname, by Friday")}
${todo("Book a follow-up in two weeks", "Name Surname")}
</div>
</div>`,
      ),
      notes:
        "Close by reading each next step with its owner and date, and confirm when the parking lot will be revisited. Replace the examples with what your group decided.",
    },
  ],
);
