import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";
import { guideFrame } from "./guide.js";

// A guided first file: a welcome cover, three short practice lessons and a
// recap. Every frame reads the same tokens, so lesson 3's accent change shows
// up on the cover and in the other lessons too.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F6F3EE",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#1E2733",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#56606D",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(30, 39, 51, 0.12)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accent: "#4C5BD4",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentSoft: "#E7E9FB",
  // guard:allow-raw-color — authored template palette, not app chrome.
  mint: "#DCEFE5",
  // guard:allow-raw-color — authored template palette, not app chrome.
  peach: "#FCE5D6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  sky: "#DDE9F7",
  // guard:allow-raw-color — authored template palette, not app chrome.
  dot: "rgba(30, 39, 51, 0.13)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(30, 39, 51, 0.08)",
};

const PALETTE = {
  canvas: C.paper,
  paper: C.paper,
  surface: C.surface,
  ink: C.ink,
  soft: C.soft,
  line: C.line,
  accent: C.accent,
  "accent-soft": C.accentSoft,
  mint: C.mint,
  peach: C.peach,
  sky: C.sky,
  dot: C.dot,
  shadow: C.shadow,
};

const FONTS =
  "family=DM+Serif+Display&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700";

// Where every frame sits on the canvas. The cover's map is drawn from these,
// so it always matches the real layout.
const LAYOUT = {
  cover: { x: 0, y: 0, width: 1440, height: 900 },
  lesson1: { x: 1560, y: 0, width: 960, height: 620 },
  lesson2: { x: 2640, y: 0, width: 960, height: 620 },
  lesson3: { x: 3720, y: 0, width: 960, height: 620 },
  guide: { x: 0, y: 1140, width: 1440, height: 620 },
};

const LESSONS = [
  {
    n: "1",
    title: "Edit by hand",
    blurb: "Select any text and type over it.",
    color: "mint",
  },
  {
    n: "2",
    title: "Ask the agent",
    blurb: "Describe a change in plain words.",
    color: "peach",
  },
  {
    n: "3",
    title: "Use tokens",
    blurb: "Change one color, restyle the file.",
    color: "sky",
  },
] as const;

const PROMPTS = {
  lesson1: "Put Sam Ortiz, pastry chef in Montreal, on the profile card.",
  lesson2: "Make this card feel like a summer festival.",
  lesson3: "Change the accent token to a deep forest green.",
};

const BASE_CSS = `
      .artboard { color:var(--ink); font-family:'DM Sans', sans-serif; }
      .serif { font-family:'DM Serif Display', serif; font-weight:400; letter-spacing:-.01em; }
      .num { display:grid; place-items:center; flex:none; border-radius:50%; color:var(--ink); font-weight:700; }
      .card { border:1px solid var(--line); border-radius:20px; background:var(--surface); box-shadow:0 18px 44px var(--shadow); }
      .try { padding:14px 16px; border-radius:12px; background:var(--paper); font-size:15px; line-height:1.45; }
      .try span { color:var(--soft); }
      .dots { background-color:var(--surface); background-image:radial-gradient(var(--dot) 1.2px, transparent 1.4px); background-size:20px 20px; }
`;

const background = `<div style="position:absolute;inset:0;background:var(--paper)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

const logo = (size: number, top: number, left: number) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.4)}px;color:var(--ink);font:600 ${size}px/1 'DM Sans',sans-serif;letter-spacing:-.01em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="${Math.round(size * 1.3)}" height="${Math.round(size * 1.3)}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="10" style="fill:var(--ink)"/><circle cx="11.5" cy="11.5" r="4.5" style="fill:var(--mint)"/><rect x="16" y="7" width="9" height="9" rx="2.5" style="fill:var(--peach)"/><rect x="7" y="17" width="18" height="8" rx="4" style="fill:var(--accent)"/></svg>
        <span>Start here</span>
      </div>`;

// ---------------------------------------------------------------- cover

const MAP_W = 536;
const SPAN_X = LAYOUT.lesson3.x + LAYOUT.lesson3.width;
const SCALE = MAP_W / SPAN_X;
const MAP_H = Math.round((LAYOUT.guide.y + LAYOUT.guide.height) * SCALE);

const mapRect = (
  r: { x: number; y: number; width: number; height: number },
  inner: string,
  bg: string,
  id: string,
  name: string,
) =>
  `<div style="position:absolute;left:${Math.round(r.x * SCALE)}px;top:${Math.round(r.y * SCALE)}px;width:${Math.round(r.width * SCALE)}px;height:${Math.round(r.height * SCALE)}px;display:grid;place-items:center;border-radius:8px;background:var(--${bg});border:1px solid var(--line);color:var(--ink);font-size:13px;font-weight:600;text-align:center;line-height:1.2" data-agent-native-node-id="${id}" data-agent-native-layer-name="${name}">${inner}</div>`;

const mapRow = (n: string, title: string, blurb: string, color: string) => `
            <li style="display:flex;align-items:center;gap:16px;padding:14px 0;border-top:1px solid var(--line)" data-agent-native-node-id="map-row-${n}" data-agent-native-layer-name="Lesson ${n}">
              <span class="num" style="width:36px;height:36px;background:var(--${color});font-size:15px">${n}</span>
              <span style="flex:1;font-size:17px;font-weight:600">${title}</span>
              <span style="color:var(--soft);font-size:15px">${blurb}</span>
            </li>`;

const cover = presetDocument({
  title: "Start here — Welcome",
  width: LAYOUT.cover.width,
  height: LAYOUT.cover.height,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .badge { position:absolute; top:52px; right:96px; z-index:2; display:inline-flex; align-items:center; gap:8px; height:36px; padding:0 16px; border-radius:999px; background:var(--surface); color:var(--ink); font-size:15px; font-weight:500; }
      .badge i { width:8px; height:8px; border-radius:50%; background:var(--accent); }
      .copy { position:absolute; left:96px; top:228px; width:500px; z-index:2; }
      .copy .eyebrow { color:var(--accent); font-size:16px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
      .copy h1 { margin-top:20px; font-size:104px; line-height:.98; }
      .copy p { margin-top:28px; color:var(--soft); font-size:20px; line-height:1.55; }
      .copy .next { display:inline-flex; align-items:center; gap:10px; margin-top:36px; height:52px; padding:0 24px; border-radius:999px; background:var(--accent); color:var(--surface); font-size:17px; font-weight:600; }
      .map { position:absolute; left:${1440 - 96 - 648}px; top:150px; width:648px; z-index:2; padding:32px; }
      .map h2 { font-size:15px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--soft); }
      .canvas-map { position:relative; margin-top:20px; height:${MAP_H + 48}px; padding:24px; border-radius:14px; }
      .canvas-map .inner { position:relative; width:${MAP_W}px; height:${MAP_H}px; }
      .map ol { margin-top:20px; }
    `,
  body: `
      ${background}
      ${logo(22, 52, 96)}
      <span class="badge" data-agent-native-node-id="tour-badge" data-agent-native-layer-name="Tour badge"><i></i>A five-minute tour</span>
      <div class="copy" data-agent-native-node-id="welcome-copy" data-agent-native-layer-name="Welcome copy">
        <p class="eyebrow" style="margin-top:0;color:var(--accent);font-size:16px" data-agent-native-node-id="eyebrow" data-agent-native-layer-name="Eyebrow">Your first file</p>
        <h1 class="serif" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Welcome<br>to Design</h1>
        <p data-agent-native-node-id="intro" data-agent-native-layer-name="Intro">This file is a practice board. Three small lessons sit to the right, each with one thing to try. Nothing here is precious, so change whatever you like.</p>
        <span class="next" data-agent-native-node-id="start-button" data-agent-native-layer-name="Start button">Start with lesson 1 <span aria-hidden="true">→</span></span>
      </div>
      <div class="card map" data-agent-native-node-id="file-map" data-agent-native-layer-name="Map of this file">
        <h2>Map of this file</h2>
        <div class="canvas-map dots" data-agent-native-node-id="map-canvas" data-agent-native-layer-name="Mini canvas">
          <div class="inner">
            ${mapRect(LAYOUT.cover, "You are<br>here", "accent-soft", "map-cover", "Map: cover")}
            ${mapRect(LAYOUT.lesson1, `<span style="font:400 26px/1 'DM Serif Display',serif">1</span>`, "mint", "map-lesson-1", "Map: lesson 1")}
            ${mapRect(LAYOUT.lesson2, `<span style="font:400 26px/1 'DM Serif Display',serif">2</span>`, "peach", "map-lesson-2", "Map: lesson 2")}
            ${mapRect(LAYOUT.lesson3, `<span style="font:400 26px/1 'DM Serif Display',serif">3</span>`, "sky", "map-lesson-3", "Map: lesson 3")}
            ${mapRect(LAYOUT.guide, "Recap", "surface", "map-guide", "Map: recap")}
          </div>
        </div>
        <ol data-agent-native-node-id="map-list" data-agent-native-layer-name="Lesson list">
          ${LESSONS.map((l) => mapRow(l.n, l.title, l.blurb, l.color)).join("")}
          <li style="display:flex;align-items:center;gap:16px;padding:14px 0 0;border-top:1px solid var(--line)" data-agent-native-node-id="map-row-recap" data-agent-native-layer-name="Recap">
            <span class="num" style="width:36px;height:36px;border:1.5px dashed var(--soft);font-size:15px">✓</span>
            <span style="flex:1;font-size:17px;font-weight:600">Recap</span>
            <span style="color:var(--soft);font-size:15px">Below this frame, all three prompts.</span>
          </li>
        </ol>
      </div>`,
});

// -------------------------------------------------------------- lessons

const lesson = ({
  n,
  title,
  color,
  lede,
  steps,
  tryText,
  stageLabel,
  stage,
  stageCss = "",
}: {
  n: string;
  title: string;
  color: string;
  lede: string;
  steps: [string, string, string];
  tryText: string;
  stageLabel: string;
  stage: string;
  stageCss?: string;
}) =>
  presetDocument({
    title: `Start here — Lesson ${n}: ${title}`,
    width: 960,
    height: 620,
    fonts: FONTS,
    palette: PALETTE,
    css: `${BASE_CSS}
      .progress { position:absolute; top:40px; right:48px; z-index:2; display:inline-flex; align-items:center; height:32px; padding:0 14px; border-radius:999px; background:var(--${color}); font-size:14px; font-weight:600; }
      .panel { position:absolute; left:48px; top:100px; width:368px; height:472px; z-index:2; display:flex; flex-direction:column; padding:32px; box-shadow:none; }
      .panel h2 { margin-top:20px; font-size:38px; line-height:1.05; }
      .panel .lede { margin-top:10px; color:var(--soft); font-size:16px; line-height:1.5; }
      .panel ol { display:grid; gap:10px; margin-top:20px; counter-reset:s; }
      .panel ol li { display:flex; gap:12px; font-size:15px; line-height:1.45; counter-increment:s; }
      .panel ol li::before { content:counter(s); flex:none; display:grid; place-items:center; width:22px; height:22px; margin-top:-1px; border-radius:50%; background:var(--paper); font-size:12px; font-weight:700; }
      .panel .try { margin-top:auto; }
      .stage { position:absolute; left:440px; top:100px; width:472px; height:472px; z-index:2; display:grid; place-items:center; border:1px solid var(--line); border-radius:20px; overflow:hidden; }
      .stage-label { position:absolute; top:18px; left:20px; padding:5px 10px; border-radius:999px; background:var(--surface); color:var(--soft); font-size:13px; font-weight:600; }
${stageCss}
    `,
    body: `
      ${background}
      ${logo(18, 44, 48)}
      <span class="progress" data-agent-native-node-id="lesson-progress" data-agent-native-layer-name="Progress">Lesson ${n} of 3</span>
      <div class="card panel" data-agent-native-node-id="instructions" data-agent-native-layer-name="Instructions">
        <span class="num serif" style="width:44px;height:44px;background:var(--${color});font-size:24px;font-weight:400">${n}</span>
        <h2 class="serif" data-agent-native-node-id="lesson-title" data-agent-native-layer-name="Lesson title">${title}</h2>
        <p class="lede" data-agent-native-node-id="lesson-lede" data-agent-native-layer-name="Lesson intro">${lede}</p>
        <ol data-agent-native-node-id="lesson-steps" data-agent-native-layer-name="Steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        <div class="try" data-agent-native-node-id="lesson-try" data-agent-native-layer-name="Prompt to try">${tryText}</div>
      </div>
      <div class="stage dots" data-agent-native-node-id="practice-area" data-agent-native-layer-name="Practice area">
        <span class="stage-label">${stageLabel}</span>
        ${stage}
      </div>`,
  });

const lesson1 = lesson({
  n: "1",
  title: "Edit by hand",
  color: "mint",
  lede: "Text in a design is real text. Change it the way you would in a document.",
  steps: [
    "Select the name on the card.",
    "Type your own name over it.",
    "Do the same for the job title.",
  ],
  tryText: `<span>Or ask the agent: </span>“${PROMPTS.lesson1}”`,
  stageLabel: "Practice: make it yours",
  stageCss: `
      .profile { width:340px; padding:28px; text-align:center; }
      .profile .avatar { display:grid; place-items:center; width:80px; height:80px; margin:0 auto; border-radius:50%; background:var(--mint); font:400 32px/1 'DM Serif Display',serif; }
      .profile h3 { margin-top:18px; font-size:26px; font-weight:700; letter-spacing:-.01em; }
      .profile .role { margin-top:4px; color:var(--soft); font-size:16px; }
      .profile dl { display:grid; grid-template-columns:1fr 1fr; margin-top:22px; padding-top:18px; border-top:1px solid var(--line); }
      .profile dt { color:var(--soft); font-size:13px; }
      .profile dd { margin-top:2px; font-size:16px; font-weight:600; }
      .profile .hello { display:flex; align-items:center; justify-content:center; height:46px; margin-top:22px; border-radius:999px; background:var(--accent); color:var(--surface); font-size:16px; font-weight:600; }
    `,
  stage: `
        <div class="card profile" data-agent-native-node-id="profile-card" data-agent-native-layer-name="Profile card">
          <div class="avatar" data-agent-native-node-id="profile-avatar" data-agent-native-layer-name="Avatar">RL</div>
          <h3 data-agent-native-node-id="profile-name" data-agent-native-layer-name="Name">Rosa Lindqvist</h3>
          <p class="role" data-agent-native-node-id="profile-title" data-agent-native-layer-name="Job title">Illustrator at Little Fern Studio</p>
          <dl data-agent-native-node-id="profile-details" data-agent-native-layer-name="Details">
            <div><dt>Based in</dt><dd>Lisbon</dd></div>
            <div><dt>Joined</dt><dd>March 2024</dd></div>
          </dl>
          <span class="hello" data-agent-native-node-id="profile-button" data-agent-native-layer-name="Button">Say hello</span>
        </div>`,
});

const lesson2 = lesson({
  n: "2",
  title: "Ask the agent",
  color: "peach",
  lede: "This card is plain on purpose. Tell the agent how it should feel and it restyles the design for you.",
  steps: [
    "Read what's on the card.",
    "Send the agent the prompt below.",
    "Not quite right? Say what to change.",
  ],
  tryText: `<span>Try: </span>“${PROMPTS.lesson2}”`,
  stageLabel: "Practice: deliberately plain",
  stageCss: `
      .event { width:360px; padding:22px 24px; border:1px solid var(--ink); background:var(--surface); font-size:16px; line-height:1.5; }
      .event h3 { font-size:20px; font-weight:700; }
      .event p { margin-top:6px; }
      .event a { display:inline-block; margin-top:14px; color:var(--ink); text-decoration:underline; }
    `,
  stage: `
        <div class="event" data-agent-native-node-id="event-card" data-agent-native-layer-name="Event card">
          <h3 data-agent-native-node-id="event-title" data-agent-native-layer-name="Event name">Riverside Night Market</h3>
          <p data-agent-native-node-id="event-date" data-agent-native-layer-name="Date">Saturday, July 19, 5 to 11 pm</p>
          <p data-agent-native-node-id="event-place" data-agent-native-layer-name="Place">Pier 4 Lawn, Harbor Street</p>
          <p data-agent-native-node-id="event-description" data-agent-native-layer-name="Description">Food stalls, live music and a lantern walk at dusk. Bring a blanket.</p>
          <a href="#" data-agent-native-node-id="event-link" data-agent-native-layer-name="Tickets link">Get tickets</a>
        </div>`,
});

const token = (name: string, label: string, ring = false) => `
            <li style="display:flex;align-items:center;gap:12px" data-agent-native-node-id="token-${name}" data-agent-native-layer-name="Token: ${name}">
              <span style="flex:none;width:36px;height:36px;border-radius:10px;background:var(--${name});${ring ? "border:1px solid var(--line);" : ""}"></span>
              <span style="flex:1"><span style="display:block;font-size:15px;font-weight:600">--${name}</span><span style="display:block;color:var(--soft);font-size:13px">${label}</span></span>
            </li>`;

const lesson3 = lesson({
  n: "3",
  title: "Use tokens",
  color: "sky",
  lede: "Every color here comes from a token: a named value set once for the whole file.",
  steps: [
    "Each swatch on the right is a token.",
    "Ask the agent to change the accent.",
    "Check the cover. It changed too.",
  ],
  tryText: `<span>Try: </span>“${PROMPTS.lesson3}”`,
  stageLabel: "Practice: one token, many parts",
  stageCss: `
      .kit { width:392px; padding:26px; }
      .kit ul.tokens { display:grid; grid-template-columns:1fr 1fr; gap:14px 16px; padding-bottom:20px; border-bottom:1px solid var(--line); }
      .kit .row { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:20px; }
      .chip { display:inline-flex; align-items:center; height:32px; padding:0 14px; border-radius:999px; font-size:14px; font-weight:600; }
      .chip-solid { background:var(--accent); color:var(--surface); }
      .chip-soft { background:var(--accent-soft); color:var(--ink); }
      .chip-line { border:1.5px solid var(--accent); color:var(--accent); }
      .kbtn { display:inline-flex; align-items:center; justify-content:center; height:44px; padding:0 20px; border-radius:12px; font-size:15px; font-weight:600; }
      .kbtn-primary { background:var(--accent); color:var(--surface); }
      .kbtn-soft { background:var(--accent-soft); color:var(--ink); }
      .switch { display:inline-flex; align-items:center; width:46px; height:26px; padding:3px; border-radius:999px; background:var(--accent); justify-content:flex-end; }
      .switch i { width:20px; height:20px; border-radius:50%; background:var(--surface); }
      .meter { flex:1; height:8px; border-radius:999px; background:var(--accent-soft); overflow:hidden; }
      .meter i { display:block; width:64%; height:100%; border-radius:999px; background:var(--accent); }
    `,
  stage: `
        <div class="card kit" data-agent-native-node-id="token-kit" data-agent-native-layer-name="Token kit">
          <ul class="tokens" data-agent-native-node-id="token-swatches" data-agent-native-layer-name="Swatches">
            ${token("accent", "Buttons, chips")}
            ${token("accent-soft", "Soft fills")}
            ${token("ink", "Text")}
            ${token("paper", "Backgrounds", true)}
          </ul>
          <div class="row" data-agent-native-node-id="token-chips" data-agent-native-layer-name="Chips">
            <span class="chip chip-solid">New</span><span class="chip chip-soft">Popular</span><span class="chip chip-line">Saved</span>
          </div>
          <div class="row" data-agent-native-node-id="token-buttons" data-agent-native-layer-name="Buttons">
            <span class="kbtn kbtn-primary">Get started</span><span class="kbtn kbtn-soft">Learn more</span>
          </div>
          <div class="row" data-agent-native-node-id="token-controls" data-agent-native-layer-name="Controls">
            <span class="switch" aria-hidden="true"><i></i></span><span style="font-size:14px;font-weight:600">Reminders</span><span class="meter" aria-hidden="true"><i></i></span><span style="color:var(--soft);font-size:14px">64%</span>
          </div>
        </div>`,
});

// ---------------------------------------------------------------- guide

const guide = guideFrame({
  title: "Recap: three habits",
  documentTitle: "Start here — Recap",
  intro:
    "You'll use these on every design. Each prompt works again in any file you make.",
  steps: [
    {
      title: "Edit by hand",
      body: "Small text changes are fastest done yourself. Select and type.",
      prompt: PROMPTS.lesson1,
    },
    {
      title: "Ask the agent",
      body: "For a new look, describe the feeling and let the agent restyle it.",
      prompt: PROMPTS.lesson2,
    },
    {
      title: "Use tokens",
      body: "Colors live in tokens, so one change carries through every frame.",
      prompt: PROMPTS.lesson3,
    },
  ],
  logo: logo(18, 52, 96),
  fonts: FONTS,
  palette: PALETTE,
  displayFont: "'DM Sans', sans-serif",
  bodyFont: "'DM Sans', sans-serif",
  width: LAYOUT.guide.width,
  height: LAYOUT.guide.height,
});

export const startHere: DesignTemplatePreset = {
  id: "preset-start-here",
  title: "Start here",
  description:
    "A five-minute tour for your first file: a welcome cover, three short practice lessons and a recap of the prompts to try.",
  category: "other",
  width: LAYOUT.cover.width,
  height: LAYOUT.cover.height,
  filename: "welcome.html",
  content: cover,
  frames: [
    {
      key: "lesson-1",
      filename: "lesson-1-edit-by-hand.html",
      ...LAYOUT.lesson1,
      content: lesson1,
    },
    {
      key: "lesson-2",
      filename: "lesson-2-ask-the-agent.html",
      ...LAYOUT.lesson2,
      content: lesson2,
    },
    {
      key: "lesson-3",
      filename: "lesson-3-use-tokens.html",
      ...LAYOUT.lesson3,
      content: lesson3,
    },
    {
      key: "guide",
      filename: "recap.html",
      ...LAYOUT.guide,
      content: guide,
    },
  ],
};
