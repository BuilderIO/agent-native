import { bDeck, bRoot } from "./b-shared.js";

const C = {
  paper: "#F2EFE7", // guard:allow-raw-color — authored slide palette, not app chrome.
  sumi: "#1F1F1C", // guard:allow-raw-color — authored slide palette, not app chrome.
  muted: "#67625A", // guard:allow-raw-color — authored slide palette, not app chrome.
  rule: "#CFC9BC", // guard:allow-raw-color — authored slide palette, not app chrome.
  sage: "#A5AD96", // guard:allow-raw-color — authored slide palette, not app chrome.
  moss: "#6D775F", // guard:allow-raw-color — authored slide palette, not app chrome.
  stone: "#B9B1A2", // guard:allow-raw-color — authored slide palette, not app chrome.
  mist: "#E4E0D5", // guard:allow-raw-color — authored slide palette, not app chrome.
  seal: "#A8412C", // guard:allow-raw-color — authored slide palette, not app chrome.
};

const TOKENS = `--deck-bg:${C.paper};--deck-ink:${C.sumi};--deck-muted:${C.muted};--deck-accent:${C.seal};--deck-surface:${C.mist};--deck-heading-font:'Cormorant Garamond',serif;--deck-body-font:'Jost',sans-serif;--deck-radius:0px;font-family:'Jost',sans-serif;`;

const slide = (style: string, body: string) =>
  bRoot(TOKENS, `padding:56px 64px;${style}`, body);

const H1 = `margin:0;font-family:'Cormorant Garamond',serif;font-weight:400;color:var(--deck-ink);letter-spacing:-0.01em;`;
const SERIF = `font-family:var(--deck-heading-font);font-weight:400;`;
const CAPS = `font-size:14px;font-weight:400;letter-spacing:0.28em;text-transform:uppercase;color:var(--deck-muted);`;
const BODY = `margin:0;font-size:17px;font-weight:300;line-height:1.65;color:var(--deck-ink);`;
const HAIR = `1px solid ${C.rule}`;

/** A tonal stand-in for a photograph; the caption says what belongs there. */
const frame = (style: string, from: string, to: string, label: string) =>
  `<div style="position:absolute;${style}background:linear-gradient(160deg,${from},${to});border-radius:var(--deck-radius);display:flex;align-items:flex-end;padding:14px 16px;box-sizing:border-box;"><span style="${CAPS}letter-spacing:0.2em;background:var(--deck-bg);padding:5px 10px;">${label}</span></div>`;

const vertical = (style: string, text: string) =>
  `<span style="position:absolute;${style}writing-mode:vertical-rl;${CAPS}">${text}</span>`;

const seal = (style: string) =>
  `<span aria-hidden="true" style="position:absolute;${style}width:34px;height:34px;background:var(--deck-accent);color:${C.paper};display:flex;align-items:center;justify-content:center;${SERIF}font-size:17px;letter-spacing:0.04em;">FL</span>`;

const PROJECTS = [
  ["Still Water", "Identity system", "2025"],
  ["Paper Lantern", "Object series", "2024"],
  ["North Room", "Exhibition design", "2023"],
  ["Fieldnotes", "Editorial", "2022"],
  ["Low Tide", "Packaging", "2021"],
];

const meta = (label: string, value: string) =>
  `<div style="display:flex;flex-direction:column;gap:4px;"><span style="${CAPS}">${label}</span><span style="${SERIF}font-size:21px;">${value}</span></div>`;

export const PORTFOLIO_DECK = bDeck(
  "starter-portfolio",
  "Quiet Portfolio",
  "portfolio",
  "A minimal, Japanese-inspired creative portfolio: washi paper tones, sumi ink, small Garamond, tracked caps, vertical rules, and asymmetric image frames.",
  [
    [
      "title",
      slide(
        `justify-content:space-between;`,
        `<span style="${CAPS}">Firstname Lastname</span>
        <div style="position:absolute;left:560px;top:0;bottom:0;width:0;border-left:${HAIR};"></div>
        ${frame("left:600px;top:56px;width:250px;height:350px;", C.sage, C.stone, "Image · portrait 3:4")}
        ${vertical("right:44px;top:56px;", "Portfolio 2020 — 2026")}
        ${seal("left:816px;top:430px;")}
        <div style="display:flex;flex-direction:column;gap:22px;max-width:420px;">
          <h1 style="${H1}font-size:84px;line-height:0.95;">Selected <i>works</i></h1>
          <p style="${BODY}max-width:360px;color:var(--deck-muted);">Independent designer working across identity, objects, and space. Replace this line with your own practice in one sentence.</p>
        </div>`,
      ),
      "Let the page breathe for a moment before speaking. Replace the name, the years, and the seal initials with your own. Drop a portrait or a signature image into the frame; keep it muted so the type stays in charge.",
    ],
    [
      "content",
      slide(
        `flex-direction:row;gap:0;`,
        `<div style="width:260px;flex:none;display:flex;flex-direction:column;justify-content:space-between;padding-right:40px;border-right:${HAIR};">
          <h1 style="${H1}font-size:56px;line-height:1;font-style:italic;">Contents</h1>
          <p style="${BODY}font-size:16px;color:var(--deck-muted);">Five projects from the last five years, chosen for how they were made rather than how they looked.</p>
        </div>
        <ol style="list-style:none;margin:0;padding:0 0 0 48px;flex:1;display:flex;flex-direction:column;justify-content:center;">
          ${PROJECTS.map(
            ([name, kind, year], i) =>
              `<li style="display:grid;grid-template-columns:44px 1fr 214px 52px;align-items:baseline;padding:15px 0;${i ? `border-top:${HAIR};` : ""}"><span style="${SERIF}font-size:18px;color:var(--deck-muted);">${String(i + 1).padStart(2, "0")}</span><span style="${SERIF}font-size:26px;">${name}</span><span style="${CAPS}">${kind}</span><span style="${SERIF}font-size:18px;color:var(--deck-muted);text-align:right;">${year}</span></li>`,
          ).join("")}
        </ol>`,
      ),
      "A contents page sets pace: read the project names only, not the details. Replace the five projects with your own and keep the list short; five strong pieces beat twelve good ones.",
    ],
    [
      "title",
      slide(
        `padding:56px 64px 56px 560px;justify-content:center;gap:24px;`,
        `${frame("left:0;top:0;bottom:0;width:500px;", C.moss, C.sage, "Image · hero photograph, full bleed")}
        ${vertical("left:516px;top:56px;", "Project 01")}
        <span style="${CAPS}">Identity system · 2025</span>
        <h1 style="${H1}font-size:68px;line-height:0.95;">Still Water</h1>
        <p style="${BODY}">An identity for a small tea house built on a single brushstroke and a great deal of empty space. Replace with two sentences on the brief and your answer.</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding-top:20px;border-top:${HAIR};">
          ${meta("Role", "Lead designer")}${meta("Scope", "Identity")}${meta("Year", "2025")}
        </div>`,
      ),
      "Open each project with its best single image. Say what the client needed in one sentence, then what you did. All project details are placeholders; replace them and credit collaborators by name.",
    ],
    [
      "content",
      slide(
        ``,
        `${frame("left:64px;top:56px;width:420px;height:300px;", C.stone, C.mist, "a · Ink studies")}
        ${frame("left:512px;top:56px;width:180px;height:230px;", C.sage, C.moss, "b · Detail")}
        ${frame("left:720px;top:120px;width:176px;height:236px;", C.mist, C.stone, "c · In use")}
        <div style="position:absolute;left:64px;right:64px;top:388px;display:grid;grid-template-columns:420px 1fr;gap:28px;">
          <h1 style="${H1}font-size:40px;line-height:1.05;font-style:italic;">From sketch to shelf</h1>
          <p style="${BODY}font-size:16px;">Forty ink studies narrowed to one mark, tested on paper, cloth, and ceramic before it was final. Replace with the story of your process in two sentences.</p>
        </div>`,
      ),
      "The process slide. Walk the frames in order, a to c, and name the decision each one shows. Replace the frames with your own images; keep the uneven sizes, as the asymmetry is the point.",
    ],
    [
      "statement",
      slide(
        `align-items:center;justify-content:center;text-align:center;gap:24px;`,
        `<div style="width:1px;height:56px;background:var(--deck-ink);"></div>
        <h1 style="${H1}font-size:46px;line-height:1.15;font-style:italic;max-width:620px;">Remove until only the necessary remains.</h1>
        <p style="margin:0;${CAPS}">A working principle, not a style</p>`,
      ),
      "A pause between projects. Say the line, then say what it means for how you work, in your own words. Replace it with the principle you actually return to.",
    ],
    [
      "content",
      slide(
        `flex-direction:row;gap:48px;align-items:stretch;`,
        `${frame("left:64px;top:56px;width:240px;height:320px;", C.stone, C.sage, "Image · portrait")}
        <div style="width:240px;flex:none;"></div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding-left:48px;border-left:${HAIR};">
          <div style="display:flex;flex-direction:column;gap:18px;">
            <h1 style="${H1}font-size:56px;line-height:1;">About me</h1>
            <p style="${BODY}max-width:430px;">Designer based in City, Country, working with small studios and independent makers. Replace with three sentences about who you are and the work you want next.</p>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px 24px;padding-top:22px;border-top:${HAIR};">
            ${meta("Email", "hello@yourname.example")}${meta("Studio", "City, Country")}${meta("Elsewhere", "@yourname")}${meta("Available", "From Month 2026")}
          </div>
        </div>
        ${seal("left:270px;top:450px;")}`,
      ),
      "Close with who you are and how to reach you. Replace every contact detail and the availability date. Leave this slide up during questions.",
    ],
  ],
);
