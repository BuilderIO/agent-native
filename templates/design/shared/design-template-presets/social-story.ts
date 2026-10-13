import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  base: "#EEE9F8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  baseDeep: "#E2DAF4",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#1C1733",
  // guard:allow-raw-color — authored template palette, not app chrome.
  inkSoft: "#4A4366",
  // guard:allow-raw-color — authored template palette, not app chrome.
  peach: "#FFB199",
  // guard:allow-raw-color — authored template palette, not app chrome.
  lilac: "#AE98FF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  mint: "#8FE3CC",
  // guard:allow-raw-color — authored template palette, not app chrome.
  butter: "#FFE08A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  glass: "rgba(255, 255, 255, 0.46)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  glassEdge: "rgba(255, 255, 255, 0.85)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(46, 30, 94, 0.14)",
};

const icon = (path: string) =>
  `<svg class="row-icon" viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="${C.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</g></svg>`;

export const socialStory: DesignTemplatePreset = {
  id: "preset-social-story",
  title: "Event story — vertical",
  description:
    "A 1080 × 1920 story with a soft aurora gradient and glass cards for date, time, and place.",
  category: "social",
  width: 1080,
  height: 1920,
  filename: "event-story.html",
  content: presetDocument({
    title: "Halcyon — Night Garden",
    width: 1080,
    height: 1920,
    fonts:
      "family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600",
    palette: {
      canvas: C.base,
      ink: C.ink,
      "ink-soft": C.inkSoft,
      glass: C.glass,
      "glass-edge": C.glassEdge,
      shadow: C.shadow,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Instrument Sans', sans-serif; }
      .aurora { position:absolute; inset:0; z-index:0; pointer-events:none; }
      .aurora span { position:absolute; border-radius:50%; filter:blur(110px); }
      .issue { position:absolute; top:118px; right:80px; z-index:3; padding:14px 24px; border:1.5px solid var(--glass-edge); border-radius:999px; background:var(--glass); font-size:24px; font-weight:500; letter-spacing:.02em; }
      .title { position:absolute; left:80px; right:80px; top:380px; z-index:2; font:400 212px/.9 'Instrument Serif', serif; letter-spacing:-.035em; }
      .title em { display:block; padding-left:120px; font-style:italic; }
      .lede { position:absolute; left:80px; top:846px; z-index:2; width:760px; color:var(--ink-soft); font-size:38px; line-height:1.3; letter-spacing:-.01em; }
      .details { position:absolute; left:64px; right:64px; top:1040px; z-index:2; padding:12px 40px; border:1.5px solid var(--glass-edge); border-radius:48px; background:var(--glass); box-shadow:0 30px 80px var(--shadow); }
      .row { display:grid; grid-template-columns:72px 1fr; align-items:center; gap:28px; padding:34px 0; }
      .row + .row { border-top:1.5px solid var(--glass-edge); }
      .row-icon { width:72px; height:72px; padding:18px; border-radius:50%; background:var(--glass-edge); }
      .row dt { color:var(--ink-soft); font-size:24px; font-weight:500; letter-spacing:.04em; }
      .row dd { margin-top:4px; font:400 54px/1.05 'Instrument Serif', serif; letter-spacing:-.01em; }
      .lineup { position:absolute; left:80px; right:80px; top:1580px; z-index:2; display:flex; flex-wrap:wrap; gap:14px; }
      .lineup li { padding:16px 26px; border:1.5px solid var(--glass-edge); border-radius:999px; background:var(--glass); font-size:28px; font-weight:500; }
      .rsvp { position:absolute; left:64px; right:64px; top:1712px; z-index:2; display:flex; align-items:center; justify-content:space-between; height:128px; padding:0 20px 0 52px; border-radius:999px; background:var(--ink); color:var(--canvas); font-size:40px; font-weight:600; letter-spacing:-.01em; text-decoration:none; box-shadow:0 24px 60px var(--shadow); }
      .rsvp span:last-child { display:grid; place-items:center; width:92px; height:92px; border-radius:50%; background:var(--canvas); }
      .rsvp svg { width:36px; height:36px; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:linear-gradient(170deg, ${C.base} 0%, ${C.baseDeep} 100%)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="aurora" aria-hidden="true" data-agent-native-node-id="aurora" data-agent-native-layer-name="Aurora">
        <span style="width:760px;height:760px;left:-220px;top:-80px;background:${C.peach}"></span>
        <span style="width:820px;height:820px;right:-320px;top:360px;background:${C.lilac}"></span>
        <span style="width:700px;height:700px;left:-160px;top:1120px;background:${C.mint}"></span>
        <span style="width:560px;height:560px;right:-120px;top:1500px;background:${C.butter}"></span>
      </div>
      <div style="position:absolute;top:112px;left:80px;z-index:3;display:flex;align-items:center;gap:16px;color:${C.ink};font:400 52px/1 'Instrument Serif',serif;letter-spacing:-.01em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="${C.ink}" stroke-width="2.5"/><circle cx="36" cy="20" r="18" fill="none" stroke="${C.ink}" stroke-width="2.5"/></svg>
        <span>Halcyon</span>
      </div>
      <p class="issue" data-agent-native-node-id="issue-pill" data-agent-native-layer-name="Issue pill">Sessions — Vol. 12</p>
      <h1 class="title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Night <em>Garden</em></h1>
      <p class="lede" data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">A listening evening of ambient sets, low light, and long tables under glass.</p>
      <dl class="details" data-agent-native-node-id="event-details" data-agent-native-layer-name="Event details">
        <div class="row">${icon('<rect x="5" y="7" width="22" height="20" rx="4"/><path d="M5 13h22M11 4v6M21 4v6"/>')}<div><dt>Date</dt><dd>Saturday, 18 October</dd></div></div>
        <div class="row">${icon('<circle cx="16" cy="16" r="11"/><path d="M16 10v6l4 3"/>')}<div><dt>Doors</dt><dd>7 pm until late</dd></div></div>
        <div class="row">${icon('<path d="M16 28s9-8.2 9-15a9 9 0 0 0-18 0c0 6.8 9 15 9 15z"/><circle cx="16" cy="13" r="3.2"/>')}<div><dt>Place</dt><dd>The Glasshouse, Pier 9</dd></div></div>
      </dl>
      <ul class="lineup" aria-label="Lineup" data-agent-native-node-id="lineup" data-agent-native-layer-name="Lineup">
        <li>Mira Sol</li><li>Tidewater</li><li>Olu Park</li><li>Fen &amp; Ash</li>
      </ul>
      <a class="rsvp" href="#" data-agent-native-node-id="rsvp" data-agent-native-layer-name="RSVP button"><span>Reserve a seat</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span></a>`,
  }),
};
