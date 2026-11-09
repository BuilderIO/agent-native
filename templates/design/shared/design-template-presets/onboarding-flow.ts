import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";
import { guideFrame } from "./guide.js";

// A four-screen mobile onboarding flow for a houseplant care app. Every
// screen shares the same status bar, header, progress dots, primary button
// and type, all drawn from one set of tokens, so a single edit carries
// across the whole flow.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F3F1E8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#16281F",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#55635A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(22, 40, 31, 0.13)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accent: "#2E7A4C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentSoft: "#DCEBDC",
  // guard:allow-raw-color — authored template palette, not app chrome.
  leaf: "#5E9F6C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#C7CEC3",
  // guard:allow-raw-color — authored template palette, not app chrome.
  pot: "#D9825B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  potShade: "#B9663F",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(22, 40, 31, 0.08)",
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
  leaf: C.leaf,
  muted: C.muted,
  pot: C.pot,
  "pot-shade": C.potShade,
  shadow: C.shadow,
};

const FONTS =
  "family=Fraunces:opsz,wght@9..144,600&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700";

// Names in one place, so "rename the app" is a one-line change.
const MSG = {
  app: "Tendril",
  user: "Robin",
  total: 4,
};

const W = 390;
const H = 844;

// Shared components: status bar, header, progress dots, primary button,
// secondary link and form fields. Every screen uses these same classes.
const BASE_CSS = `
      .artboard { color:var(--ink); font-family:'DM Sans', sans-serif; }
      .display { font-family:'Fraunces', serif; font-weight:600; letter-spacing:-.02em; }
      .status { position:absolute; top:0; left:0; right:0; height:54px; z-index:3; display:flex; align-items:center; justify-content:space-between; padding:6px 30px 0 36px; font-size:16px; font-weight:600; }
      .status-icons { display:flex; align-items:center; gap:7px; }
      .header { position:absolute; top:62px; left:24px; right:24px; height:36px; z-index:2; display:flex; align-items:center; justify-content:flex-end; }
      .step { color:var(--soft); font-size:14px; font-weight:500; }
      .content { position:absolute; top:126px; left:24px; right:24px; z-index:2; }
      .title { font-size:32px; line-height:1.08; }
      .sub { margin-top:12px; color:var(--soft); font-size:17px; line-height:1.5; }
      .foot { position:absolute; left:24px; right:24px; bottom:34px; z-index:2; display:flex; flex-direction:column; align-items:center; gap:20px; }
      .dots { display:flex; gap:8px; }
      .dot { display:block; width:8px; height:8px; border-radius:999px; background:var(--muted); }
      .dot.on { width:28px; background:var(--accent); }
      .btn { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; height:56px; border-radius:16px; font-size:17px; font-weight:600; text-decoration:none; }
      .btn-primary { background:var(--ink); color:var(--surface); }
      .btn-ghost { border:1.5px solid var(--line); background:var(--surface); color:var(--ink); }
      .link { height:20px; color:var(--soft); font-size:14px; line-height:20px; text-align:center; }
      .link b { color:var(--ink); font-weight:600; }
      .field { display:block; }
      .field span { display:block; font-size:14px; font-weight:600; }
      .input { display:flex; align-items:center; justify-content:space-between; height:52px; margin-top:8px; padding:0 16px; border:1.5px solid var(--line); border-radius:14px; background:var(--surface); font-size:16px; }
      .input.focus { border-color:var(--accent); box-shadow:0 0 0 4px var(--accent-soft); }
      .home { position:absolute; left:50%; bottom:8px; z-index:3; width:134px; height:5px; margin-left:-67px; border-radius:999px; background:var(--ink); }
`;

const background = `<div style="position:absolute;inset:0;background:var(--paper)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

const logo = (size: number, top: number, left: number) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.4)}px;color:var(--ink);font:600 ${size}px/1 'Fraunces',serif;letter-spacing:-.02em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="${Math.round(size * 1.4)}" height="${Math.round(size * 1.4)}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="10" style="fill:var(--accent)"/><path d="M16 25V14" style="fill:none;stroke:var(--surface)" stroke-width="2.4" stroke-linecap="round"/><path d="M16 15c0-4.5 3-7 7.5-7 0 4.5-3 7-7.5 7Z" style="fill:var(--surface)"/><path d="M16 19c0-3.5-2.4-5.5-6-5.5 0 3.5 2.4 5.5 6 5.5Z" style="fill:var(--surface)"/></svg>
        <span>${MSG.app}</span>
      </div>`;

const statusBar = `
      <div class="status" data-agent-native-node-id="status-bar" data-agent-native-layer-name="Status bar">
        <span>9:41</span>
        <span class="status-icons" aria-hidden="true">
          <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" style="fill:var(--ink)"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" style="fill:var(--ink)"/><rect x="10" y="3" width="3" height="9" rx="1" style="fill:var(--ink)"/><rect x="15" y="0" width="3" height="12" rx="1" style="fill:var(--ink)"/></svg>
          <svg width="16" height="12" viewBox="0 0 16 12"><path d="M1 4.2a10 10 0 0 1 14 0M3.6 6.9a6.3 6.3 0 0 1 8.8 0" style="fill:none;stroke:var(--ink)" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="10" r="1.6" style="fill:var(--ink)"/></svg>
          <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".75" y=".75" width="22.5" height="11.5" rx="3.5" style="fill:none;stroke:var(--ink)" stroke-width="1.2" opacity=".4"/><rect x="2.5" y="2.5" width="17" height="8" rx="2" style="fill:var(--ink)"/><path d="M25 4.5v4" style="stroke:var(--ink)" stroke-width="1.6" stroke-linecap="round" opacity=".45"/></svg>
        </span>
      </div>`;

const header = (n: number) => `
      <div class="header" data-agent-native-node-id="header" data-agent-native-layer-name="Header">
        ${n > 1 ? `<span class="step" data-agent-native-node-id="step-count" data-agent-native-layer-name="Step count">Step ${n} of ${MSG.total}</span>` : ""}
      </div>`;

const dots = (active: number) =>
  `<div class="dots" aria-label="Step ${active} of ${MSG.total}" data-agent-native-node-id="progress-dots" data-agent-native-layer-name="Progress dots">${Array.from(
    { length: MSG.total },
    (_, i) => `<i class="dot${i + 1 === active ? " on" : ""}"></i>`,
  ).join("")}</div>`;

const foot = (step: number, button: string, link: string) => `
      <div class="foot" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer">
        ${dots(step)}
        <a class="btn btn-primary" href="#" data-agent-native-node-id="primary-button" data-agent-native-layer-name="Primary button">${button}</a>
        <p class="link" data-agent-native-node-id="secondary-link" data-agent-native-layer-name="Secondary link">${link}</p>
      </div>
      <div class="home" aria-hidden="true" data-agent-native-node-id="home-indicator" data-agent-native-layer-name="Home indicator"></div>`;

const screen = (title: string, css: string, step: number, body: string) =>
  presetDocument({
    title: `${MSG.app} onboarding — ${title}`,
    width: W,
    height: H,
    fonts: FONTS,
    palette: PALETTE,
    css: `${BASE_CSS}${css}`,
    body: `
      ${background}
      ${statusBar}
      ${logo(20, 66, 24)}
      ${header(step)}
      ${body}`,
  });

// 1. Welcome
const pot = `
          <svg width="230" height="230" viewBox="0 0 230 230" aria-hidden="true">
            <circle cx="115" cy="118" r="98" style="fill:var(--surface)" opacity=".55"/>
            <path d="M115 150V70" style="fill:none;stroke:var(--accent)" stroke-width="5" stroke-linecap="round"/>
            <path d="M115 96c-6-26-26-40-54-38 2 28 22 44 54 38Z" style="fill:var(--leaf)"/>
            <path d="M115 84c8-30 30-44 60-40-2 30-26 46-60 40Z" style="fill:var(--accent)"/>
            <path d="M115 124c-4-18-20-28-40-26 2 20 18 30 40 26Z" style="fill:var(--accent)"/>
            <path d="M115 118c6-20 22-30 44-28-2 22-20 32-44 28Z" style="fill:var(--leaf)"/>
            <path d="M70 150h90l-10 56a8 8 0 0 1-8 7H88a8 8 0 0 1-8-7Z" style="fill:var(--pot)"/>
            <rect x="62" y="142" width="106" height="20" rx="6" style="fill:var(--pot-shade)"/>
            <circle cx="186" cy="56" r="7" style="fill:var(--leaf)" opacity=".5"/>
            <circle cx="42" cy="170" r="5" style="fill:var(--accent)" opacity=".35"/>
          </svg>`;

const welcome = screen(
  "Welcome",
  `
      .hero { display:grid; place-items:center; height:304px; border-radius:28px; background:var(--accent-soft); }
      .welcome-title { margin-top:32px; font-size:36px; line-height:1.06; }
    `,
  1,
  `
      <div class="content" data-agent-native-node-id="welcome-content" data-agent-native-layer-name="Welcome">
        <div class="hero" data-agent-native-node-id="welcome-illustration" data-agent-native-layer-name="Illustration">${pot}</div>
        <h1 class="display welcome-title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Every plant, cared for right on time.</h1>
        <p class="sub" data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">${MSG.app} learns what each of your plants needs and nudges you when it's thirsty, not a day too late.</p>
      </div>
      ${foot(1, "Get started", `I already have an account · <b>Log in</b>`)}`,
);

// 2. Sign up
const signUp = screen(
  "Sign up",
  `
      .form { display:flex; flex-direction:column; gap:16px; margin-top:28px; }
      .check { display:flex; align-items:center; gap:12px; margin-top:4px; font-size:15px; }
      .box { display:grid; place-items:center; flex:none; width:22px; height:22px; border-radius:7px; background:var(--accent); }
      .or { display:flex; align-items:center; gap:14px; margin:20px 0 16px; color:var(--soft); font-size:14px; }
      .or::before, .or::after { content:""; flex:1; height:1px; background:var(--line); }
      .show { color:var(--accent); font-size:14px; font-weight:600; }
      .caret { display:inline-block; width:2px; height:20px; margin-left:1px; vertical-align:-4px; background:var(--accent); }
    `,
  2,
  `
      <div class="content" data-agent-native-node-id="signup-content" data-agent-native-layer-name="Sign up">
        <h1 class="display title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Create your account</h1>
        <p class="sub" data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">Sync your reminders across every device.</p>
        <div class="form" data-agent-native-node-id="signup-form" data-agent-native-layer-name="Form">
          <label class="field" data-agent-native-node-id="field-name" data-agent-native-layer-name="Name field"><span>Your name</span><div class="input">${MSG.user} Okafor</div></label>
          <label class="field" data-agent-native-node-id="field-email" data-agent-native-layer-name="Email field"><span>Email</span><div class="input focus"><span style="font-size:16px;font-weight:400">robin.okafor@example.com<i class="caret"></i></span></div></label>
          <label class="field" data-agent-native-node-id="field-password" data-agent-native-layer-name="Password field"><span>Password</span><div class="input"><span style="font-size:20px;font-weight:400;letter-spacing:.12em">••••••••••</span><span class="show">Show</span></div></label>
          <div class="check" data-agent-native-node-id="digest-check" data-agent-native-layer-name="Digest checkbox">
            <span class="box" aria-hidden="true"><svg width="12" height="10" viewBox="0 0 12 10"><path d="M1.5 5.2 4.4 8 10.5 1.8" style="fill:none;stroke:var(--surface)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <span>Send me a short care tip each Sunday</span>
          </div>
        </div>
        <p class="or" data-agent-native-node-id="divider" data-agent-native-layer-name="Divider">or</p>
        <a class="btn btn-ghost" href="#" data-agent-native-node-id="passkey-button" data-agent-native-layer-name="Passkey button">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.5" cy="7.5" r="4.5" style="fill:none;stroke:var(--ink)" stroke-width="1.8"/><path d="M10.8 10.8 17 17M14.5 14.5l2-2" style="fill:none;stroke:var(--ink)" stroke-width="1.8" stroke-linecap="round"/></svg>
          Continue with a passkey
        </a>
      </div>
      ${foot(2, "Create account", `By continuing you agree to our <b>Terms</b>`)}`,
);

// 3. Set-up choice
const leafIcon = (variant: number) => {
  const shapes = [
    `<path d="M14 24V12" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/><path d="M14 14c0-5 3-8 8-8 0 5-3 8-8 8Z M14 17c0-4-3-6-7-6 0 4 3 6 7 6Z" style="fill:var(--accent)"/>`,
    `<path d="M10 24c-1-7 0-14 3-19 1 6 1 13-1 19Z M16 24c0-6 1-11 4-15 1 5 0 10-2 15Z" style="fill:var(--accent)"/>`,
    `<path d="M6 8c6-2 12 0 14 6M20 14c-2 4-6 6-10 5" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="9" r="3.4" style="fill:var(--leaf)"/><circle cx="19" cy="13" r="3.4" style="fill:var(--accent)"/><circle cx="12" cy="19" r="3.4" style="fill:var(--leaf)"/>`,
    `<path d="M14 25V15" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/><path d="M14 16c-6 0-9-4-8-10 6 0 9 4 8 10Z" style="fill:var(--leaf)"/><path d="M14 16c6 0 9-4 8-10-6 0-9 4-8 10Z" style="fill:var(--accent)"/>`,
    `<circle cx="14" cy="15" r="7" style="fill:var(--leaf)"/><path d="M14 8v14M7 15h14M9 10l10 10M19 10 9 20" style="fill:none;stroke:var(--accent)" stroke-width="1.6" stroke-linecap="round"/>`,
    `<path d="M14 24V8" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/><path d="M14 10c-3 0-5-2-5-4 3 0 5 2 5 4Z M14 15c3 0 5-2 5-4-3 0-5 2-5 4Z M14 20c-3 0-5-2-5-4 3 0 5 2 5 4Z" style="fill:var(--accent)"/>`,
  ];
  return `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">${shapes[variant]}</svg>`;
};

const plantCard = (
  i: number,
  name: string,
  note: string,
  id: string,
  selected = false,
) => `
          <li class="pick${selected ? " on" : ""}" data-agent-native-node-id="${id}" data-agent-native-layer-name="${name}">
            <span class="pick-icon">${leafIcon(i)}</span>
            <span class="pick-name">${name}</span>
            <span class="pick-note">${note}</span>
            ${selected ? `<span class="tick" aria-hidden="true"><svg width="11" height="9" viewBox="0 0 12 10"><path d="M1.5 5.2 4.4 8 10.5 1.8" style="fill:none;stroke:var(--surface)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ""}
          </li>`;

const setup = screen(
  "Pick your plants",
  `
      .picks { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:24px; }
      .setup-title { max-width:300px; }
      .pick { position:relative; display:flex; flex-direction:column; padding:14px 16px; border:1.5px solid var(--line); border-radius:18px; background:var(--surface); }
      .pick.on { border-color:var(--accent); background:var(--accent-soft); }
      .pick-icon { display:grid; place-items:center; width:36px; height:36px; border-radius:11px; background:var(--paper); }
      .pick.on .pick-icon { background:var(--surface); }
      .pick-name { margin-top:10px; font-size:16px; font-weight:600; }
      .pick-note { margin-top:2px; color:var(--soft); font-size:13px; }
      .tick { position:absolute; top:14px; right:14px; display:grid; place-items:center; width:22px; height:22px; border-radius:50%; background:var(--accent); }
    `,
  3,
  `
      <div class="content" data-agent-native-node-id="setup-content" data-agent-native-layer-name="Pick plants">
        <h1 class="display title setup-title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Which plants live with you?</h1>
        <p class="sub" data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">Pick a few and we'll tailor every care tip.</p>
        <ul class="picks" data-agent-native-node-id="plant-options" data-agent-native-layer-name="Plant options">
          ${plantCard(0, "Monstera", "Water weekly", "plant-monstera", true)}
          ${plantCard(1, "Snake plant", "Every 3 weeks", "plant-snake")}
          ${plantCard(2, "Pothos", "Water weekly", "plant-pothos", true)}
          ${plantCard(3, "Fiddle leaf fig", "Every 10 days", "plant-fig")}
          ${plantCard(4, "Succulents", "Every 2 weeks", "plant-succulents")}
          ${plantCard(5, "Calathea", "Keep it misted", "plant-calathea", true)}
        </ul>
      </div>
      ${foot(3, "Continue with 3 plants", `I'll add plants later`)}`,
);

// 4. First success
const reminder = (
  icon: number,
  task: string,
  when: string,
  id: string,
  first = false,
) => `
          <li class="rem${first ? " first" : ""}" data-agent-native-node-id="${id}" data-agent-native-layer-name="${task}">
            <span class="pick-icon">${leafIcon(icon)}</span>
            <span style="flex:1"><span class="rem-task">${task}</span><span class="rem-when">${when}</span></span>
            ${first ? `<span class="badge">Next up</span>` : ""}
          </li>`;

const success = screen(
  "All set",
  `
      .done { display:grid; place-items:center; width:132px; height:132px; margin:4px auto 0; border-radius:50%; background:var(--accent-soft); }
      .done-title { margin-top:24px; font-size:32px; line-height:1.08; text-align:center; }
      .done-sub { text-align:center; }
      .rems { margin-top:28px; padding:6px; border:1px solid var(--line); border-radius:22px; background:var(--surface); box-shadow:0 16px 40px var(--shadow); }
      .rem { display:flex; align-items:center; gap:14px; padding:12px; border-radius:16px; }
      .rem + .rem { border-top:1px solid var(--line); border-radius:0; }
      .rem.first { background:var(--paper); }
      .pick-icon { display:grid; place-items:center; flex:none; width:40px; height:40px; border-radius:12px; background:var(--accent-soft); }
      .rem.first .pick-icon { background:var(--surface); }
      .rem-task { display:block; font-size:16px; font-weight:600; }
      .rem-when { display:block; margin-top:2px; color:var(--soft); font-size:14px; }
      .badge { padding:5px 10px; border-radius:999px; background:var(--accent); color:var(--surface); font-size:12px; font-weight:700; }
    `,
  4,
  `
      <div class="content" data-agent-native-node-id="success-content" data-agent-native-layer-name="All set">
        <div class="done" data-agent-native-node-id="success-illustration" data-agent-native-layer-name="Check mark">
          <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="32" style="fill:var(--accent)"/><path d="M22 37.5 31.5 47 51 27" style="fill:none;stroke:var(--surface)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h1 class="display done-title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">You're all set, ${MSG.user}.</h1>
        <p class="sub done-sub" data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">Your first reminder is on the calendar. Here's the week ahead.</p>
        <ul class="rems" data-agent-native-node-id="reminders" data-agent-native-layer-name="Reminders">
          ${reminder(0, "Water the Monstera", "Thursday · 8:00 AM", "reminder-monstera", true)}
          ${reminder(2, "Water the Pothos", "Thursday · 8:00 AM", "reminder-pothos")}
          ${reminder(5, "Mist the Calathea", "Saturday · 9:30 AM", "reminder-calathea")}
        </ul>
      </div>
      ${foot(4, "Go to my plants", `Share plants with someone · <b>Invite</b>`)}`,
);

const guide = guideFrame({
  title: "How this flow works",
  documentTitle: `${MSG.app} onboarding — How this flow works`,
  intro:
    "Four screens built from the same parts. Change one piece and ask the agent to carry it through the flow.",
  steps: [
    {
      title: "Keep screens in sync",
      body: "The status bar, header, dots and button share one style, so a change on one screen fits the rest.",
      prompt: "Rename the app to Fernhouse on every screen.",
    },
    {
      title: "Restyle with tokens",
      body: "Every color is a token. Change a few values and all four screens follow, illustrations included.",
      prompt: "Switch the whole flow to dark mode using the tokens.",
    },
    {
      title: "Add a matching screen",
      body: "New screens start from the ones you have, so they get the same parts and the dots count up.",
      prompt: "Add a fifth screen for turning on notifications.",
    },
  ],
  logo: logo(20, 52, 96),
  fonts: FONTS,
  palette: PALETTE,
  displayFont: "'Fraunces', serif",
  bodyFont: "'DM Sans', sans-serif",
  width: 1920,
  height: 620,
});

export const onboardingFlow: DesignTemplatePreset = {
  id: "preset-onboarding-flow",
  title: "Mobile onboarding flow",
  description:
    "Four 390 × 844 phone screens (welcome, sign up, set-up choice and first success) that share one status bar, button and progress style, plus a guide.",
  category: "other",
  width: W,
  height: H,
  filename: "onboarding-welcome.html",
  content: welcome,
  frames: [
    {
      key: "signup",
      filename: "onboarding-sign-up.html",
      x: 510,
      y: 0,
      width: W,
      height: H,
      content: signUp,
    },
    {
      key: "setup",
      filename: "onboarding-pick-plants.html",
      x: 1020,
      y: 0,
      width: W,
      height: H,
      content: setup,
    },
    {
      key: "success",
      filename: "onboarding-all-set.html",
      x: 1530,
      y: 0,
      width: W,
      height: H,
      content: success,
    },
    {
      key: "guide",
      filename: "how-this-flow-works.html",
      x: 0,
      y: 1084,
      width: 1920,
      height: 620,
      content: guide,
    },
  ],
};
