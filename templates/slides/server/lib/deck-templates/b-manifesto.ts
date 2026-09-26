import { bDeck, bRoot } from "./b-shared.js";

const C = {
  acid: "#E2FF1F", // guard:allow-raw-color — authored slide palette, not app chrome.
  black: "#0B0B0B", // guard:allow-raw-color — authored slide palette, not app chrome.
  muted: "#3A3D14", // guard:allow-raw-color — authored slide palette, not app chrome.
  paper: "#FFFEF4", // guard:allow-raw-color — authored slide palette, not app chrome.
  orange: "#FF4A1C", // guard:allow-raw-color — authored slide palette, not app chrome.
};

const TOKENS = `--deck-bg:${C.acid};--deck-ink:${C.black};--deck-muted:${C.muted};--deck-accent:${C.orange};--deck-surface:${C.paper};--deck-heading-font:'Anton',sans-serif;--deck-body-font:'Archivo',sans-serif;--deck-radius:0px;font-family:'Archivo',sans-serif;`;

const slide = (style: string, body: string) =>
  bRoot(TOKENS, `clip-path:inset(0);${style}`, body);

const RULE = `4px solid var(--deck-ink)`;
const H1 = `margin:0;font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;color:var(--deck-ink);letter-spacing:-0.01em;`;
const DISPLAY = `font-family:var(--deck-heading-font);font-weight:400;text-transform:uppercase;`;
const TAG = `font-size:15px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;`;
const BOX = `background:var(--deck-surface);border:${RULE};box-shadow:8px 8px 0 var(--deck-ink);border-radius:var(--deck-radius);`;

/** A band of repeated uppercase text, sized so every phrase stays on the canvas. */
const marquee = (text: string, count: number, style = "") =>
  `<div style="display:flex;justify-content:space-between;align-items:center;white-space:nowrap;background:var(--deck-ink);color:var(--deck-bg);padding:9px 24px 7px;${style}">${Array.from(
    { length: count },
    () =>
      `<span style="${DISPLAY}font-size:24px;color:var(--deck-accent);">/</span><span style="${DISPLAY}font-size:24px;letter-spacing:0.04em;">${text}</span>`,
  ).join(
    "",
  )}<span style="${DISPLAY}font-size:24px;color:var(--deck-accent);">/</span></div>`;

const THESES = [
  "Boring is a choice.",
  "Taste is a verb.",
  "Constraints are fuel.",
  "One idea per slide.",
  "Grids are for breaking.",
  "Ship the ugly draft.",
  "Loud is not noisy.",
];

const versusRow = (text: string, loud: boolean) =>
  `<li style="padding:14px 0;border-top:${loud ? `2px solid ${C.acid}` : RULE};font-size:20px;font-weight:${loud ? 800 : 500};line-height:1.3;${loud ? "" : `text-decoration:line-through;text-decoration-color:var(--deck-accent);text-decoration-thickness:3px;`}">${text}</li>`;

export const MANIFESTO_DECK = bDeck(
  "starter-manifesto",
  "Loud Manifesto",
  "keynote",
  "A neo-brutalist design talk: acid yellow, massive condensed caps, thick black rules, and numbered theses that refuse to whisper.",
  [
    [
      "title",
      slide(
        `padding:0;`,
        `${marquee("Stop designing for nobody", 2)}
        <div style="flex:1;min-height:0;display:flex;align-items:flex-end;justify-content:space-between;gap:32px;padding:20px 40px 28px;">
          <h1 style="${H1}font-size:176px;line-height:0.86;white-space:nowrap;">Make it<br>louder.</h1>
          <div style="${BOX}width:270px;padding:20px 22px;display:flex;flex-direction:column;gap:14px;margin-bottom:12px;">
            <p style="margin:0;font-size:19px;font-weight:600;line-height:1.35;">A manifesto for people tired of polite, forgettable work.</p>
            <span style="${TAG}border-top:${RULE};padding-top:12px;">Speaker Name</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);border-top:${RULE};">
          <span style="${TAG}padding:16px 40px;border-right:${RULE};">Seven theses</span>
          <span style="${TAG}padding:16px 40px;border-right:${RULE};">Sample Conference 2026</span>
          <span style="${TAG}padding:16px 40px;">Zero apologies</span>
        </div>`,
      ),
      "Walk out, let the slide shout for you, then say the title once. Replace the speaker name and event with your own. The marquee line is the one sentence you want quoted afterwards.",
    ],
    [
      "content",
      slide(
        `padding:0;flex-direction:row;`,
        `<div style="width:300px;flex:none;background:var(--deck-ink);color:var(--deck-bg);padding:36px 32px;display:flex;flex-direction:column;justify-content:space-between;">
          <h1 style="${H1}color:var(--deck-bg);font-size:104px;line-height:0.86;">Seven<br>theses</h1>
          <p style="margin:0;font-size:17px;line-height:1.45;color:${C.paper};">Each one gets its own slide. Argue with all of them afterwards.</p>
        </div>
        <ol style="list-style:none;margin:0;padding:18px 40px;flex:1;display:flex;flex-direction:column;justify-content:space-between;">
          ${THESES.map(
            (thesis, index) =>
              `<li style="display:flex;align-items:baseline;gap:22px;padding:6px 0 7px;${index ? `border-top:${RULE};` : ""}"><span style="${DISPLAY}font-size:32px;line-height:1;width:44px;">${String(index + 1).padStart(2, "0")}</span><span style="font-size:23px;font-weight:700;letter-spacing:-0.01em;">${thesis}</span></li>`,
          ).join("")}
        </ol>`,
      ),
      "The contract for the talk: read the list fast, don't explain yet. Rewrite the seven theses in your own words; keep each under five words so the list stays readable from the back row.",
    ],
    [
      "statement",
      slide(
        `padding:44px 48px;justify-content:space-between;`,
        `<span aria-hidden="true" style="position:absolute;right:24px;top:8px;${DISPLAY}font-size:440px;line-height:0.9;color:var(--deck-ink);">01</span>
        <span style="${TAG}align-self:flex-start;background:var(--deck-ink);color:var(--deck-bg);padding:8px 12px;">Thesis 01 / 07</span>
        <div style="display:flex;flex-direction:column;align-items:flex-start;gap:26px;">
          <h1 style="${H1}font-size:112px;line-height:0.86;">Boring is<br>a choice.</h1>
          <div style="${BOX}padding:18px 22px;max-width:470px;">
            <p style="margin:0;font-size:20px;font-weight:600;line-height:1.4;">Every safe default is a decision someone made for you. Make it yourself, on purpose.</p>
          </div>
        </div>`,
      ),
      "One thesis, one slide. Say the headline, pause, then read the box. Duplicate this slide for each thesis and change only the number, the headline, and the box; keep the layout identical so the rhythm becomes the point.",
    ],
    [
      "statement",
      slide(
        `padding:64px 80px;align-items:center;justify-content:center;text-align:center;gap:28px;`,
        `${marquee("Say something", 3, "position:absolute;left:0;right:0;top:40px;transform:rotate(-2.5deg);")}
        ${marquee("Or say nothing", 3, `position:absolute;left:0;right:0;bottom:40px;transform:rotate(2deg);background:${C.paper};color:var(--deck-ink);border-top:${RULE};border-bottom:${RULE};`)}
        <h1 style="${H1}font-size:84px;line-height:0.92;max-width:760px;">If everyone agrees, you said nothing.</h1>
        <p style="margin:0;max-width:520px;font-size:20px;font-weight:600;line-height:1.4;">Disagreement is the signal that you finally said something worth hearing.</p>`,
      ),
      "The provocation. Let the room react before you move on. Swap the quote for the most contested line in your talk; if nobody would argue with it, it is not the right line.",
    ],
    [
      "content",
      slide(
        `padding:40px 48px;gap:26px;`,
        `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:32px;">
          <h1 style="${H1}font-size:76px;line-height:0.9;">Say it like<br>you mean it.</h1>
          <p style="margin:0;max-width:300px;font-size:18px;font-weight:600;line-height:1.4;">Same idea, two ways. Only one gets remembered.</p>
        </div>
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;border:${RULE};box-shadow:8px 8px 0 var(--deck-ink);">
          <div style="background:var(--deck-surface);padding:20px 26px;border-right:${RULE};">
            <h2 style="margin:0 0 8px;${DISPLAY}font-size:34px;">Polite</h2>
            <ul style="list-style:none;margin:0;padding:0;">${["Leveraging synergies across the journey", "A holistic, best-in-class experience", "Exploring a range of options"].map((item) => versusRow(item, false)).join("")}</ul>
          </div>
          <div style="background:var(--deck-ink);color:var(--deck-bg);padding:20px 26px;">
            <h2 style="margin:0 0 8px;${DISPLAY}font-size:34px;">Loud</h2>
            <ul style="list-style:none;margin:0;padding:0;">${["Make the thing faster.", "Make one thing great.", "Pick one. Defend it."].map((item) => versusRow(item, true)).join("")}</ul>
          </div>
        </div>`,
      ),
      "Read the polite column in a flat voice, then the loud column with conviction. Replace both with real before-and-after lines from your own work; the contrast only lands when the examples are recognizable.",
    ],
    [
      "title",
      slide(
        `padding:28px;`,
        `<div style="flex:1;background:var(--deck-ink);color:var(--deck-bg);padding:40px 44px;display:flex;flex-direction:column;justify-content:space-between;">
          <h1 style="${H1}color:var(--deck-bg);font-size:150px;line-height:0.84;">Now go break<br>something.</h1>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:32px;">
            <p style="margin:0;max-width:420px;font-size:20px;line-height:1.4;color:${C.paper};">Questions, arguments, and loud disagreement are all welcome.</p>
            <span style="${TAG}font-size:18px;background:var(--deck-bg);color:var(--deck-ink);padding:12px 16px;box-shadow:6px 6px 0 var(--deck-accent);">@yourhandle</span>
          </div>
        </div>`,
      ),
      "End on the dare, then open the floor. Replace the handle with where people can find you. Leave this slide up through Q&A.",
    ],
  ],
);
