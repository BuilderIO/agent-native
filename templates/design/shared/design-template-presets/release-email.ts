import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";
import { guideFrame } from "./guide.js";

// A product changelog email built from reusable blocks, plus a block
// library frame that shows each block on its own. Both frames share the
// same block classes and tokens, so a block copied from the library drops
// into the email already styled.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#EEF0F4",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#151B2E",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#525C74",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(21, 27, 46, 0.12)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accent: "#3552D4",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentSoft: "#E4E9FB",
  // guard:allow-raw-color — authored template palette, not app chrome.
  sun: "#F2B544",
  // guard:allow-raw-color — authored template palette, not app chrome.
  mint: "#3FB68B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  rose: "#E86F6F",
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
  sun: C.sun,
  mint: C.mint,
  rose: C.rose,
};

const FONTS = "family=Manrope:wght@700;800&family=Inter:wght@400;500;600";

const MSG = {
  product: "Northdeck",
  release: "November release",
  headline: "Plan the whole quarter on one timeline.",
};

const EMAIL_H = 2280;
const LIBRARY_H = 1940;

// Blocks: every class here is a reusable block used by both frames.
const BASE_CSS = `
      .artboard { color:var(--ink); font-family:'Inter', sans-serif; font-size:16px; line-height:1.6; }
      .display { font-family:'Manrope', sans-serif; font-weight:800; letter-spacing:-.025em; }
      .eyebrow { color:var(--accent); font-size:13px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
      .btn { display:inline-block; height:48px; padding:0 26px; border-radius:10px; font-size:16px; font-weight:600; line-height:48px; text-decoration:none; }
      .btn-primary { background:var(--accent); color:var(--surface); }
      .btn-light { background:var(--surface); color:var(--ink); }
      .text-link { color:var(--accent); font-size:15px; font-weight:600; text-decoration:none; }
      .block-divider { height:1px; margin:44px 0; background:var(--line); }
      .feature { display:flex; gap:20px; }
      .feature + .feature { margin-top:32px; }
      .feature-icon { display:grid; place-items:center; flex:none; width:48px; height:48px; border-radius:12px; background:var(--accent-soft); }
      .feature h3 { font-family:'Manrope', sans-serif; font-size:19px; font-weight:700; line-height:1.3; letter-spacing:-.01em; }
      .feature p { margin-top:6px; color:var(--soft); font-size:16px; }
      .feature .text-link { display:inline-block; margin-top:8px; }
      .media { display:flex; align-items:center; gap:24px; }
      .media-art { flex:none; display:grid; place-items:center; width:200px; height:150px; border-radius:14px; background:var(--accent-soft); }
      .media h3 { font-family:'Manrope', sans-serif; font-size:19px; font-weight:700; line-height:1.3; }
      .media p { margin-top:6px; color:var(--soft); font-size:16px; }
      .quote { padding:28px 32px; border-left:4px solid var(--accent); border-radius:0 14px 14px 0; background:var(--paper); }
      .quote p { font-family:'Manrope', sans-serif; font-size:20px; font-weight:700; line-height:1.45; letter-spacing:-.01em; }
      .quote-by { display:flex; align-items:center; gap:12px; margin-top:18px; color:var(--soft); font-size:15px; }
      .quote-by b { color:var(--ink); font-weight:600; }
      .avatar { display:grid; place-items:center; flex:none; width:36px; height:36px; border-radius:50%; background:var(--accent); color:var(--surface); font-size:14px; font-weight:600; }
      .cta { padding:44px 40px; border-radius:18px; background:var(--ink); color:var(--surface); text-align:center; }
      .cta h2 { font-size:28px; line-height:1.2; }
      .cta p { margin:10px auto 0; max-width:420px; color:var(--paper); font-size:16px; }
      .cta .btn { margin-top:26px; }
      .list h3 { font-family:'Manrope', sans-serif; font-size:19px; font-weight:700; }
      .list ul { margin-top:14px; }
      .list li { display:flex; gap:14px; padding:12px 0; border-top:1px solid var(--line); font-size:16px; line-height:1.5; }
      .list li:last-child { border-bottom:1px solid var(--line); }
      .list li i { flex:none; width:8px; height:8px; margin-top:8px; border-radius:50%; background:var(--accent); }
      .list li span b { font-weight:600; }
`;

const background = `<div style="position:absolute;inset:0;background:var(--paper)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

const logo = (size: number, top: number, left: number) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.4)}px;color:var(--ink);font:800 ${size}px/1 'Manrope',sans-serif;letter-spacing:-.03em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="${Math.round(size * 1.3)}" height="${Math.round(size * 1.3)}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" style="fill:var(--accent)"/><path d="M9 23V9l14 14V9" style="fill:none;stroke:var(--surface)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${MSG.product}</span>
      </div>`;

// Small line icons for feature blocks.
const icon = (kind: "repeat" | "guest" | "keys" | "spark") => {
  const paths = {
    repeat: `<path d="M5 10a7 7 0 0 1 12-4l2 2M19 14a7 7 0 0 1-12 4l-2-2" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/><path d="M19 4v4h-4M5 20v-4h4" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    guest: `<circle cx="9" cy="8" r="3.5" style="fill:none;stroke:var(--accent)" stroke-width="2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/><path d="M18 8v6M15 11h6" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/>`,
    keys: `<rect x="3" y="6" width="18" height="12" rx="2.5" style="fill:none;stroke:var(--accent)" stroke-width="2"/><path d="M7 10h1M11 10h1M15 10h2M7 14h10" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/>`,
    spark: `<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" style="fill:none;stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/>`,
  };
  return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">${paths[kind]}</svg>`;
};

const feature = (
  kind: "repeat" | "guest" | "keys" | "spark",
  title: string,
  body: string,
  link: string,
  id: string,
) => `
          <div class="feature" data-agent-native-node-id="${id}" data-agent-native-layer-name="Feature: ${title}">
            <span class="feature-icon">${icon(kind)}</span>
            <div><h3>${title}</h3><p>${body}</p><a class="text-link" href="#">${link} →</a></div>
          </div>`;

// Hero illustration: a quarter timeline with project bars and a today line.
const bar = (y: number, x: number, w: number, fill: string, label: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="26" rx="7" style="fill:var(--${fill})"/><text x="${x + 12}" y="${y + 17.5}" style="fill:var(--surface);font:600 12px 'Inter',sans-serif">${label}</text>`;

const timelineArt = `
          <svg width="544" height="272" viewBox="0 0 544 272" aria-hidden="true">
            <rect x="24" y="24" width="496" height="224" rx="14" style="fill:var(--surface)"/>
            <path d="M24 64h496" style="stroke:var(--line)" stroke-width="1"/>
            <path d="M189 64v184M354 64v184" style="stroke:var(--line)" stroke-width="1"/>
            <text x="44" y="49" style="fill:var(--soft);font:600 12px 'Inter',sans-serif">October</text>
            <text x="209" y="49" style="fill:var(--soft);font:600 12px 'Inter',sans-serif">November</text>
            <text x="374" y="49" style="fill:var(--soft);font:600 12px 'Inter',sans-serif">December</text>
            <path d="M200 60v192" style="stroke:var(--ink)" stroke-width="2" stroke-dasharray="4 4"/>
            ${bar(84, 44, 160, "accent", "Pricing page refresh")}
            ${bar(124, 214, 190, "mint", "Mobile checkout")}
            ${bar(164, 370, 135, "sun", "Holiday campaign")}
            ${bar(204, 230, 130, "rose", "Hiring: 2 designers")}
            <path d="M204 97h4a6 6 0 0 1 6 6v21" style="fill:none;stroke:var(--accent)" stroke-width="2"/>
            <rect x="176" y="250" width="48" height="20" rx="10" style="fill:var(--ink)"/>
            <text x="200" y="264" text-anchor="middle" style="fill:var(--surface);font:600 11px 'Inter',sans-serif">Today</text>
          </svg>`;

// Small illustration for the image + text block.
const mediaArt = `
              <svg width="150" height="104" viewBox="0 0 150 104" aria-hidden="true">
                <rect x="0" y="0" width="150" height="104" rx="10" style="fill:var(--surface)"/>
                <rect x="14" y="16" width="56" height="8" rx="4" style="fill:var(--line)"/>
                <rect x="14" y="36" width="86" height="14" rx="5" style="fill:var(--accent)"/>
                <rect x="40" y="58" width="96" height="14" rx="5" style="fill:var(--mint)"/>
                <rect x="24" y="80" width="62" height="14" rx="5" style="fill:var(--sun)"/>
              </svg>`;

const email = presetDocument({
  title: `${MSG.product} — ${MSG.release} email`,
  width: 640,
  height: EMAIL_H,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .email { position:relative; z-index:2; width:640px; margin:0 auto; }
      .email-head { display:flex; justify-content:flex-end; align-items:center; height:104px; padding:0 40px; color:var(--soft); font-size:14px; }
      .email-head a { color:var(--soft); }
      .email-body { padding:52px 48px 48px; border-radius:20px 20px 0 0; background:var(--surface); }
      .hero h1 { margin-top:14px; font-size:40px; line-height:1.1; }
      .hero > p { margin-top:16px; color:var(--soft); font-size:18px; line-height:1.6; }
      .hero-art { display:grid; place-items:center; margin:32px -24px 0; border-radius:18px; background:var(--accent-soft); line-height:0; }
      .hero .btn { margin-top:32px; }
      .section-label { margin-bottom:28px; }
      .email-cta { padding:0 48px 48px; background:var(--surface); }
      .email-foot { padding:40px 48px 56px; color:var(--soft); font-size:14px; line-height:1.6; text-align:center; }
      .email-foot p + p { margin-top:10px; }
      .email-foot a { color:var(--ink); font-weight:600; }
    `,
  body: `
      ${background}
      ${logo(22, 40, 40)}
      <div class="email" data-agent-native-node-id="email" data-agent-native-layer-name="Email">
        <div class="email-head" data-agent-native-node-id="email-header" data-agent-native-layer-name="Header">
          <a href="#">View in browser</a>
        </div>
        <div class="email-body" data-agent-native-node-id="email-body" data-agent-native-layer-name="Body">
          <div class="hero" data-agent-native-node-id="hero" data-agent-native-layer-name="Hero feature">
            <p class="eyebrow" data-agent-native-node-id="eyebrow" data-agent-native-layer-name="Eyebrow">${MSG.release} · Timeline view</p>
            <h1 class="display" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">${MSG.headline}</h1>
            <p data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">Timeline lays every project out by week, so you can see what overlaps, what slips and who's stretched thin. Drag a bar to move a deadline and everything that depends on it moves too.</p>
            <div class="hero-art" data-agent-native-node-id="hero-illustration" data-agent-native-layer-name="Timeline illustration">${timelineArt}</div>
            <a class="btn btn-primary" href="#" data-agent-native-node-id="hero-button" data-agent-native-layer-name="Hero button">Open Timeline</a>
          </div>
          <div class="block-divider" data-agent-native-node-id="divider-1" data-agent-native-layer-name="Divider"></div>
          <p class="eyebrow section-label" data-agent-native-node-id="features-label" data-agent-native-layer-name="Section label">Also new this month</p>
          <div data-agent-native-node-id="features" data-agent-native-layer-name="Feature blocks">
            ${feature("repeat", "Recurring tasks that skip holidays", "Set a task to repeat every other Monday and it moves itself when the office is closed.", "Set one up", "feature-recurring")}
            ${feature("guest", "Free guest seats for clients", "Invite a client to a single project. They can comment and approve, and they never see the rest of your workspace.", "Invite a guest", "feature-guests")}
            ${feature("keys", "A command bar for everything", "Press ⌘K to jump to a project, assign a task or change a due date without leaving the keyboard.", "See all shortcuts", "feature-command")}
          </div>
          <div class="block-divider" data-agent-native-node-id="divider-2" data-agent-native-layer-name="Divider"></div>
          <div class="list" data-agent-native-node-id="fixes" data-agent-native-layer-name="Smaller fixes">
            <h3>Smaller fixes</h3>
            <ul>
              <li><i></i><span><b>Faster boards.</b> Boards with 500+ cards now open in under a second.</span></li>
              <li><i></i><span><b>Calendar sync</b> no longer duplicates events after a time zone change.</span></li>
              <li><i></i><span><b>CSV export</b> keeps custom fields and subtasks in their own columns.</span></li>
              <li><i></i><span><b>Mentions</b> in comments now notify people on mobile too.</span></li>
              <li><i></i><span><b>Dark mode</b> fixes for charts, tooltips and the date picker.</span></li>
            </ul>
          </div>
        </div>
        <div class="email-cta">
          <div class="cta" data-agent-native-node-id="cta" data-agent-native-layer-name="Call to action">
            <h2 class="display">Your timeline is already built.</h2>
            <p>We filled it in from the projects you have today. Open it and drag things where they belong.</p>
            <a class="btn btn-light" href="#">Open Timeline</a>
          </div>
        </div>
        <div class="email-foot" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer">
          <p>You're getting this because you have a ${MSG.product} workspace. We send product news about once a month.</p>
          <p><a href="#">Unsubscribe</a> · <a href="#">Email preferences</a> · <a href="#">Changelog</a></p>
          <p>${MSG.product}, 418 Alder Street, Portland, OR 97205</p>
        </div>
      </div>`,
});

const libItem = (label: string, id: string, inner: string) => `
        <section class="lib-item" data-agent-native-node-id="${id}" data-agent-native-layer-name="${label}">
          <p class="lib-label">${label}</p>
          <div class="lib-card">${inner}</div>
        </section>`;

const library = presetDocument({
  title: `${MSG.product} — Email block library`,
  width: 640,
  height: LIBRARY_H,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .lib { position:absolute; top:104px; left:40px; right:40px; z-index:2; }
      .lib h1 { font-size:34px; line-height:1.15; }
      .lib-intro { margin-top:10px; color:var(--soft); font-size:16px; }
      .lib-item { margin-top:36px; }
      .lib-label { display:inline-block; margin-bottom:10px; padding:2px 10px; border-radius:6px; background:var(--accent-soft); color:var(--accent); font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; }
      .lib-card { padding:32px; border-radius:16px; background:var(--surface); }
      .lib-card .block-divider { margin:8px 0; }
    `,
  body: `
      ${background}
      ${logo(22, 40, 40)}
      <div class="lib" data-agent-native-node-id="library" data-agent-native-layer-name="Block library">
        <h1 class="display" data-agent-native-node-id="library-title" data-agent-native-layer-name="Title">Block library</h1>
        <p class="lib-intro" data-agent-native-node-id="library-intro" data-agent-native-layer-name="Intro">Every block the email is made of. Copy one in and it picks up the same colors and type.</p>
        ${libItem(
          "Feature block",
          "block-feature",
          feature(
            "spark",
            "Smart due dates",
            "Northdeck suggests a due date from how long similar tasks took your team last time.",
            "Learn more",
            "block-feature-sample",
          ),
        )}
        ${libItem(
          "Image + text",
          "block-media",
          `<div class="media" data-agent-native-node-id="block-media-sample" data-agent-native-layer-name="Image and text">
            <div class="media-art">${mediaArt}</div>
            <div><h3>Start from a proven plan</h3><p>Pick a template your team already trusts and adjust the dates.</p><a class="text-link" href="#">Browse templates →</a></div>
          </div>`,
        )}
        ${libItem(
          "Quote",
          "block-quote",
          `<blockquote class="quote" data-agent-native-node-id="block-quote-sample" data-agent-native-layer-name="Quote">
            <p>“We used to rebuild the plan in a spreadsheet every Monday. Now we just open Timeline.”</p>
            <div class="quote-by"><span class="avatar">DW</span><span><b>Dana Whitfield</b> · Ops lead, Fernway Supply</span></div>
          </blockquote>`,
        )}
        ${libItem(
          "CTA",
          "block-cta",
          `<div class="cta" data-agent-native-node-id="block-cta-sample" data-agent-native-layer-name="Call to action">
            <h2 class="display">Try it on your next project.</h2>
            <p>It takes about two minutes to set up.</p>
            <a class="btn btn-light" href="#">Get started</a>
          </div>`,
        )}
        ${libItem(
          "Divider",
          "block-divider",
          `<div class="block-divider" data-agent-native-node-id="block-divider-sample" data-agent-native-layer-name="Divider"></div>`,
        )}
        ${libItem(
          "List",
          "block-list",
          `<div class="list" data-agent-native-node-id="block-list-sample" data-agent-native-layer-name="List">
            <h3>Coming next month</h3>
            <ul>
              <li><i></i><span><b>Workload view</b> to see who has room this week.</span></li>
              <li><i></i><span><b>Approvals</b> with a clear yes or no on each task.</span></li>
              <li><i></i><span><b>Weekly digests</b> that land in your inbox on Friday.</span></li>
            </ul>
          </div>`,
        )}
      </div>`,
});

const GUIDE_Y = Math.max(EMAIL_H, LIBRARY_H) + 240;

const guide = guideFrame({
  title: "How this email works",
  documentTitle: `${MSG.product} — How this email works`,
  intro:
    "The email is a stack of blocks. Swap, reorder or add them, and they keep the same look.",
  steps: [
    {
      title: "Edit a block",
      body: "Each block is its own layer, so you can rewrite one without touching the rest.",
      prompt: "Rewrite the hero for a Workload view launch.",
    },
    {
      title: "Restyle with tokens",
      body: "Colors and fonts are tokens shared by the email and the library.",
      prompt: "Make the accent a deep teal everywhere.",
    },
    {
      title: "Add from the library",
      body: "The block library holds ready-made pieces that match the email.",
      prompt: "Add the quote block from the library above the CTA.",
    },
  ],
  logo: logo(20, 52, 96),
  fonts: FONTS,
  palette: PALETTE,
  displayFont: "'Manrope', sans-serif",
  bodyFont: "'Inter', sans-serif",
  width: 1400,
  height: 620,
});

export const releaseEmail: DesignTemplatePreset = {
  id: "preset-release-email",
  title: "Release notes email",
  description:
    "A 640-wide product changelog email built from blocks, with a block library to pull from and a guide.",
  category: "other",
  width: 640,
  height: EMAIL_H,
  filename: "release-email.html",
  content: email,
  frames: [
    {
      key: "library",
      filename: "email-block-library.html",
      x: 760,
      y: 0,
      width: 640,
      height: LIBRARY_H,
      content: library,
    },
    {
      key: "guide",
      filename: "how-this-email-works.html",
      x: 0,
      y: GUIDE_Y,
      width: 1400,
      height: 620,
      content: guide,
    },
  ],
};
