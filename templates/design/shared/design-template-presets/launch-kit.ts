import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

// One launch message carried across four formats, plus a guide frame that
// shows how to change it everywhere with the agent. Every frame shares the
// same palette tokens, so "make the accent cobalt" restyles the whole kit.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F4F1EA",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#14231C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#5B6B62",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(20, 35, 28, 0.12)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accent: "#FF6A3D",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentSoft: "#FFE3D8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  live: "#2F7A55",
  // guard:allow-raw-color — authored template palette, not app chrome.
  avatarA: "#4361E8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  avatarB: "#8247D6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(20, 35, 28, 0.10)",
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
  live: C.live,
  "avatar-a": C.avatarA,
  "avatar-b": C.avatarB,
  shadow: C.shadow,
};

const FONTS =
  "family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Inter:wght@400;500;600";

// The message, in one place, so every frame says the same thing.
const MSG = {
  product: "Harbor",
  release: "Harbor 2.0",
  headline: "Reply together, never twice.",
  lede: "See who's answering a ticket before you start typing. Shared drafts and handoff notes keep your whole support team on one reply.",
  date: "Live June 12",
};

const BASE_CSS = `
      .artboard { color:var(--ink); font-family:'Inter', sans-serif; }
      .display { font-family:'Bricolage Grotesque', sans-serif; font-weight:700; letter-spacing:-.035em; }
      .pill { display:inline-flex; align-items:center; gap:10px; border-radius:999px; background:var(--accent-soft); color:var(--ink); font-weight:600; }
      .pill i { display:block; border-radius:50%; background:var(--accent); }
      .btn { display:inline-flex; align-items:center; justify-content:center; border-radius:999px; font-weight:600; text-decoration:none; }
      .btn-primary { background:var(--ink); color:var(--paper); }
      .btn-ghost { border:1.5px solid var(--line); color:var(--ink); }
      .avatar { display:grid; place-items:center; flex:none; border-radius:50%; color:var(--surface); font-weight:600; }
      .card { border:1px solid var(--line); border-radius:20px; background:var(--surface); box-shadow:0 24px 60px var(--shadow); }
      .collide { display:flex; align-items:center; gap:12px; border-radius:12px; background:var(--accent-soft); color:var(--ink); font-weight:500; }
      .collide b { font-weight:600; }
      .typing { display:inline-flex; gap:4px; }
      .typing i { display:block; border-radius:50%; background:var(--accent); }
      .live-dot { display:inline-block; border-radius:50%; background:var(--live); }
`;

const background = `<div style="position:absolute;inset:0;background:var(--paper)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

const logo = (size: number, top: number, left: number) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.32)}px;color:var(--ink);font:700 ${size}px/1 'Bricolage Grotesque',sans-serif;letter-spacing:-.03em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="${Math.round(size * 1.15)}" height="${Math.round(size * 1.15)}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" style="fill:var(--ink)"/><path d="M7 14c3-3 6-3 9 0s6 3 9 0M7 20c3-3 6-3 9 0s6 3 9 0" style="fill:none;stroke:var(--accent)" stroke-width="2.6" stroke-linecap="round"/></svg>
        <span>${MSG.product}</span>
      </div>`;

const typing = (dot: number) =>
  `<span class="typing" aria-hidden="true"><i style="width:${dot}px;height:${dot}px"></i><i style="width:${dot}px;height:${dot}px;opacity:.6"></i><i style="width:${dot}px;height:${dot}px;opacity:.3"></i></span>`;

// The feature itself: a ticket with a teammate already replying.
const collisionCard = (s: number, id: string) => `
      <div class="card" style="width:${560 * s}px;padding:${28 * s}px;border-radius:${22 * s}px" data-agent-native-node-id="${id}" data-agent-native-layer-name="Ticket card">
        <div style="display:flex;align-items:center;gap:${14 * s}px">
          <span class="avatar" style="width:${48 * s}px;height:${48 * s}px;background:var(--ink);font-size:${18 * s}px">JR</span>
          <div style="flex:1">
            <div style="font-size:${19 * s}px;font-weight:600">Jordan Reyes</div>
            <div style="margin-top:${2 * s}px;color:var(--soft);font-size:${15 * s}px">#4182 · Refund for a double charge</div>
          </div>
          <span style="color:var(--soft);font-size:${14 * s}px">2m</span>
        </div>
        <p style="margin-top:${18 * s}px;font-size:${18 * s}px;line-height:1.5">Hi! I was charged twice for the annual plan this morning. Can you refund one of them?</p>
        <div class="collide" style="margin-top:${22 * s}px;padding:${14 * s}px ${16 * s}px;font-size:${16 * s}px">
          <span class="avatar" style="width:${32 * s}px;height:${32 * s}px;background:var(--avatar-b);font-size:${13 * s}px">MK</span>
          <span style="flex:1"><b>Maya</b> is replying</span>
          ${typing(6 * s)}
        </div>
      </div>`;

// A full inbox for the hero: list on the left, the ticket on the right.
const inboxRow = (
  initials: string,
  color: string,
  name: string,
  subject: string,
  time: string,
  active = false,
  note = "",
) => `
            <div style="display:flex;gap:12px;padding:14px 16px;border-radius:12px;${active ? `background:var(--paper);` : ""}">
              <span class="avatar" style="width:34px;height:34px;background:${color};font-size:13px">${initials}</span>
              <div style="flex:1;min-width:0">
                <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600"><span>${name}</span><span style="color:var(--soft);font-weight:400">${time}</span></div>
                <div style="margin-top:3px;color:var(--soft);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${subject}</div>
                ${note}
              </div>
            </div>`;

const inbox = `
      <div class="card" style="position:absolute;left:700px;top:176px;z-index:2;display:grid;grid-template-columns:270px 1fr;width:660px;height:560px;overflow:hidden;border-radius:24px" data-agent-native-node-id="inbox" data-agent-native-layer-name="Inbox">
        <div style="padding:16px 10px;border-right:1px solid var(--line)" data-agent-native-node-id="inbox-list" data-agent-native-layer-name="Ticket list">
          <div style="padding:6px 16px 14px;font-size:13px;font-weight:600;color:var(--soft)">Open · 12</div>
          ${inboxRow("JR", "var(--ink)", "Jordan Reyes", "Refund for a double charge", "2m", true, `<div style="display:flex;align-items:center;gap:6px;margin-top:8px;color:var(--ink);font-size:12px;font-weight:600">${typing(4)}<span>Maya is replying</span></div>`)}
          ${inboxRow("AL", "var(--avatar-a)", "Ana López", "Can't invite teammates", "14m")}
          ${inboxRow("TW", "var(--live)", "Theo Walsh", "Single sign-on setup", "1h")}
          ${inboxRow("PS", "var(--avatar-b)", "Priya Shah", "Export to CSV is blank", "3h")}
        </div>
        <div style="display:flex;flex-direction:column;padding:26px 26px 22px" data-agent-native-node-id="inbox-ticket" data-agent-native-layer-name="Ticket">
          <div style="font-size:13px;color:var(--soft)">#4182</div>
          <div style="margin-top:4px;font-size:19px;font-weight:600">Refund for a double charge</div>
          <p style="margin-top:20px;padding:16px 18px;border-radius:14px;background:var(--paper);font-size:15px;line-height:1.5">Hi! I was charged twice for the annual plan this morning. Can you refund one of them?</p>
          <div class="collide" style="margin-top:auto;padding:12px 14px;font-size:14px">
            <span class="avatar" style="width:28px;height:28px;background:var(--avatar-b);font-size:11px">MK</span>
            <span style="flex:1"><b>Maya</b> is replying. Add a note instead?</span>
            ${typing(5)}
          </div>
          <div style="margin-top:12px;padding:14px 16px;border:1.5px solid var(--line);border-radius:14px">
            <div style="color:var(--soft);font-size:14px">Shared draft · Maya and you</div>
            <div style="margin-top:8px;font-size:15px;line-height:1.45">Sorry about that, Jordan! I've refunded the second charge. It'll show in 3–5 days.</div>
            <div style="display:flex;justify-content:flex-end;margin-top:12px"><span class="btn btn-primary" style="height:34px;padding:0 16px;font-size:13px">Send</span></div>
          </div>
        </div>
      </div>`;

const hero = presetDocument({
  title: `${MSG.release} — Launch hero`,
  width: 1440,
  height: 900,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .nav { position:absolute; top:40px; left:460px; right:96px; z-index:3; display:flex; align-items:center; justify-content:flex-end; gap:36px; font-size:15px; font-weight:500; }
      .nav a { color:var(--soft); text-decoration:none; }
      .copy { position:absolute; left:96px; top:236px; z-index:2; width:560px; }
      .copy h1 { margin-top:28px; font-size:84px; line-height:.95; }
      .copy p { margin-top:28px; color:var(--soft); font-size:20px; line-height:1.5; }
      .ctas { display:flex; gap:12px; margin-top:40px; }
      .date { position:absolute; left:96px; bottom:72px; z-index:2; display:flex; align-items:center; gap:10px; color:var(--soft); font-size:15px; font-weight:500; }
    `,
  body: `
      ${background}
      ${logo(26, 36, 96)}
      <nav class="nav" data-agent-native-node-id="nav" data-agent-native-layer-name="Navigation">
        <a href="#">Product</a><a href="#">Pricing</a><a href="#">Changelog</a><a href="#">Sign in</a>
        <a class="btn btn-primary" href="#" style="height:42px;padding:0 20px;color:var(--paper)">Start free</a>
      </nav>
      <div class="copy" data-agent-native-node-id="hero-copy" data-agent-native-layer-name="Hero copy">
        <p class="pill" style="height:36px;padding:0 16px;font-size:15px;color:var(--ink)" data-agent-native-node-id="release-pill" data-agent-native-layer-name="Release pill"><i style="width:8px;height:8px"></i>New in ${MSG.release}</p>
        <h1 class="display" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">${MSG.headline}</h1>
        <p data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">${MSG.lede}</p>
        <div class="ctas" data-agent-native-node-id="ctas" data-agent-native-layer-name="Buttons">
          <a class="btn btn-primary" href="#" style="height:54px;padding:0 28px;font-size:17px">Try ${MSG.release}</a>
          <a class="btn btn-ghost" href="#" style="height:54px;padding:0 28px;font-size:17px">See what's new</a>
        </div>
      </div>
      ${inbox}
      <p class="date" data-agent-native-node-id="launch-date" data-agent-native-layer-name="Launch date"><span class="live-dot" style="width:8px;height:8px"></span>${MSG.date} · All plans</p>`,
});

const linkPreview = presetDocument({
  title: `${MSG.release} — Link preview`,
  width: 1200,
  height: 628,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .copy { position:absolute; left:72px; top:150px; z-index:2; width:500px; }
      .copy h1 { margin-top:24px; font-size:68px; line-height:.95; }
      .date { position:absolute; left:72px; bottom:60px; z-index:2; display:flex; align-items:center; gap:10px; color:var(--soft); font-size:20px; font-weight:500; }
      .stage { position:absolute; left:620px; top:0; width:580px; height:628px; z-index:1; background:var(--accent-soft); }
      .stage-card { position:absolute; left:660px; top:150px; z-index:2; }
    `,
  body: `
      ${background}
      <div class="stage" aria-hidden="true" data-agent-native-node-id="stage" data-agent-native-layer-name="Accent panel"></div>
      ${logo(28, 60, 72)}
      <div class="copy" data-agent-native-node-id="link-copy" data-agent-native-layer-name="Copy">
        <p class="pill" style="height:40px;padding:0 18px;font-size:17px;background:var(--surface)" data-agent-native-node-id="release-pill" data-agent-native-layer-name="Release pill"><i style="width:9px;height:9px"></i>New in ${MSG.release}</p>
        <h1 class="display" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">${MSG.headline}</h1>
      </div>
      <p class="date" data-agent-native-node-id="launch-date" data-agent-native-layer-name="Launch date"><span class="live-dot" style="width:10px;height:10px"></span>${MSG.date}</p>
      <div class="stage-card">${collisionCard(0.88, "ticket-card")}</div>`,
});

const square = presetDocument({
  title: `${MSG.release} — Square post`,
  width: 1080,
  height: 1080,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .headline { position:absolute; left:80px; top:200px; width:800px; z-index:2; font-size:104px; line-height:.94; }
      .stage { position:absolute; left:0; right:0; bottom:0; height:500px; z-index:1; background:var(--accent-soft); }
      .stage-card { position:absolute; left:120px; top:520px; z-index:2; }
      .footer { position:absolute; left:80px; right:80px; bottom:64px; z-index:2; display:flex; justify-content:space-between; font-size:24px; font-weight:600; }
      .footer span:last-child { display:flex; align-items:center; gap:12px; color:var(--soft); font-weight:500; }
    `,
  body: `
      ${background}
      <div class="stage" aria-hidden="true" data-agent-native-node-id="stage" data-agent-native-layer-name="Accent panel"></div>
      ${logo(34, 80, 80)}
      <h1 class="display headline" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">${MSG.headline}</h1>
      <div class="stage-card">${collisionCard(1.5, "ticket-card")}</div>
      <p class="footer" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"><span>${MSG.release}</span><span><span class="live-dot" style="width:10px;height:10px"></span>${MSG.date}</span></p>`,
});

const feature = (n: string, title: string, body: string, id: string) => `
        <li class="card" style="display:flex;gap:28px;padding:40px;border-radius:32px" data-agent-native-node-id="${id}" data-agent-native-layer-name="${title}">
          <span class="display" style="flex:none;display:grid;place-items:center;width:72px;height:72px;border-radius:50%;background:var(--accent-soft);font-size:32px">${n}</span>
          <div><div style="font-size:38px;font-weight:600;letter-spacing:-.01em">${title}</div><div style="margin-top:10px;color:var(--soft);font-size:28px;line-height:1.4">${body}</div></div>
        </li>`;

const story = presetDocument({
  title: `${MSG.release} — Story`,
  width: 1080,
  height: 1920,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .headline { position:absolute; left:80px; right:80px; top:440px; z-index:2; font-size:136px; line-height:.92; }
      .features { position:absolute; left:64px; right:64px; top:880px; z-index:2; display:flex; flex-direction:column; gap:24px; }
      .cta { position:absolute; left:64px; right:64px; bottom:96px; z-index:2; height:132px; font-size:42px; }
    `,
  body: `
      ${background}
      ${logo(40, 120, 80)}
      <p class="pill" style="position:absolute;top:118px;right:80px;z-index:3;height:56px;padding:0 26px;font-size:24px" data-agent-native-node-id="release-pill" data-agent-native-layer-name="Release pill"><i style="width:12px;height:12px"></i>New</p>
      <h1 class="display headline" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">${MSG.headline}</h1>
      <ul class="features" data-agent-native-node-id="features" data-agent-native-layer-name="Features">
        ${feature("1", "See who's replying", "A live marker shows when a teammate is already on the ticket.", "feature-collision")}
        ${feature("2", "Shared drafts", "Write one reply together instead of two separate ones.", "feature-drafts")}
        ${feature("3", "Handoff notes", "Pass a ticket on with context, so nobody starts over.", "feature-handoff")}
      </ul>
      <a class="btn btn-primary cta" href="#" data-agent-native-node-id="cta" data-agent-native-layer-name="Button">${MSG.date} · See what's new</a>`,
});

const step = (
  n: string,
  title: string,
  body: string,
  prompt: string,
  id: string,
) => `
        <li class="card" style="display:flex;flex-direction:column;padding:32px;border-radius:24px;box-shadow:none" data-agent-native-node-id="${id}" data-agent-native-layer-name="Step ${n}">
          <span class="display" style="display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--ink);color:var(--paper);font-size:20px">${n}</span>
          <div style="margin-top:22px;font-size:24px;font-weight:600;letter-spacing:-.01em">${title}</div>
          <div style="margin-top:8px;color:var(--soft);font-size:17px;line-height:1.5">${body}</div>
          <div style="margin-top:auto;padding-top:24px"><div style="padding:14px 16px;border-radius:12px;background:var(--paper);font-size:16px;line-height:1.4"><span style="color:var(--soft)">Try: </span>“${prompt}”</div></div>
        </li>`;

const guide = presetDocument({
  title: `${MSG.release} — How this kit works`,
  width: 1440,
  height: 620,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .head { position:absolute; left:96px; top:108px; right:96px; z-index:2; display:flex; justify-content:space-between; align-items:flex-end; }
      .head h2 { font-size:44px; line-height:1; }
      .head p { margin-top:12px; color:var(--soft); font-size:18px; }
      .head small { color:var(--soft); font-size:15px; }
      .steps { position:absolute; left:96px; right:96px; top:236px; bottom:56px; z-index:2; display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; }
    `,
  body: `
      <div style="position:absolute;inset:0;background:var(--surface);border:2px dashed var(--line)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      ${logo(20, 52, 96)}
      <div class="head" data-agent-native-node-id="guide-head" data-agent-native-layer-name="Heading">
        <div><h2 class="display">How this kit works</h2><p>Four formats, one message. Change it once and ask the agent to carry it everywhere.</p></div>
        <small>Delete this frame before you share the kit.</small>
      </div>
      <ol class="steps" data-agent-native-node-id="guide-steps" data-agent-native-layer-name="Steps">
        ${step("1", "Change the message", "Edit the headline or date in one frame, then have the agent match the rest.", "Change the launch date to July 8 in every frame.", "step-message")}
        ${step("2", "Restyle with tokens", "Every frame reads the same colors and fonts, so one change restyles the kit.", "Make the accent cobalt blue.", "step-tokens")}
        ${step("3", "Add a format", "New sizes start from the frames you already have.", "Add a 600×200 email header based on the hero.", "step-format")}
      </ol>`,
});

export const launchKit: DesignTemplatePreset = {
  id: "preset-launch-kit",
  title: "Product launch kit",
  description:
    "One launch in four formats: a 1440 × 900 hero, link preview, square post and story, plus a guide to changing them all at once.",
  category: "social",
  width: 1440,
  height: 900,
  filename: "launch-hero.html",
  content: hero,
  frames: [
    {
      key: "link",
      filename: "launch-link-preview.html",
      x: 1560,
      y: 0,
      width: 1200,
      height: 628,
      content: linkPreview,
    },
    {
      key: "square",
      filename: "launch-square.html",
      x: 1560,
      y: 900,
      width: 1080,
      height: 1080,
      content: square,
    },
    {
      key: "story",
      filename: "launch-story.html",
      x: 2880,
      y: 0,
      width: 1080,
      height: 1920,
      content: story,
    },
    {
      key: "guide",
      filename: "how-this-kit-works.html",
      x: 0,
      y: 1200,
      width: 1440,
      height: 620,
      content: guide,
    },
  ],
};
