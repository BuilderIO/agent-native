import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  canvas: "#EDEFE4",
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#1F2A24",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#6F7A73",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "#DDE2D5",
  // guard:allow-raw-color — authored template palette, not app chrome.
  green: "#79B98B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  greenDeep: "#2F7D4B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  bubble: "#F7F8F2",
};

const people = [
  ["Anna", "Are we still on for 3?", "A"],
  ["Ben", "Sent the latest draft", "B"],
  ["Chloe", "Thanks, that works!", "C"],
  ["Dev team", "Release notes are live", "D"],
  ["Elena", "Can you review this?", "E"],
]
  .map(
    ([name, preview, initial], index) =>
      `<li${index === 1 ? ' class="active"' : ""}><span class="avatar">${initial}</span><div><b>${name}</b><small>${preview}</small></div></li>`,
  )
  .join("");

export const messagingApp: DesignTemplatePreset = {
  id: "preset-messaging-app",
  title: "Messaging app",
  description: "Build a fast, modern chat experience.",
  category: "other",
  width: 1440,
  height: 900,
  filename: "messaging-app.html",
  content: presetDocument({
    title: "Relay — Messaging app",
    width: 1440,
    height: 900,
    fonts: "family=DM+Sans:wght@400;500;700",
    palette: {
      canvas: C.canvas,
      paper: C.paper,
      ink: C.ink,
      muted: C.muted,
      line: C.line,
      green: C.green,
      deep: C.greenDeep,
      bubble: C.bubble,
    },
    css: `
      .artboard { color:var(--ink); font-family:'DM Sans', sans-serif; }
      .inbox { position:absolute; left:0; top:0; bottom:0; width:360px; z-index:1; padding:88px 16px 24px; background:var(--paper); border-right:1px solid var(--line); }
      .inbox li { display:flex; align-items:center; gap:14px; padding:14px; border-radius:14px; }
      .inbox li.active { background:var(--canvas); }
      .avatar { display:grid; place-items:center; flex:none; width:44px; height:44px; border-radius:50%; background:var(--green); color:var(--paper); font-size:17px; font-weight:700; }
      .inbox b { display:block; font-size:16px; font-weight:700; }
      .inbox small { display:block; margin-top:3px; color:var(--muted); font-size:14px; }
      .thread-head { position:absolute; left:360px; right:0; top:0; z-index:1; display:flex; align-items:center; gap:14px; height:84px; padding:0 40px; border-bottom:1px solid var(--line); background:color-mix(in srgb, var(--paper) 80%, transparent); }
      .thread-head b { font-size:18px; font-weight:700; }
      .thread-head small { display:block; color:var(--deep); font-size:13px; font-weight:500; }
      .thread { position:absolute; left:360px; right:0; top:84px; bottom:112px; z-index:1; display:flex; flex-direction:column; justify-content:flex-start; gap:16px; padding:48px 64px 0; }
      .msg { max-width:520px; padding:16px 20px; border-radius:20px; font-size:18px; line-height:1.4; background:var(--bubble); border:1px solid var(--line); }
      .msg.me { align-self:flex-end; background:var(--green); border-color:var(--green); color:var(--paper); border-bottom-right-radius:6px; }
      .msg.them { border-bottom-left-radius:6px; }
      .composer { position:absolute; left:424px; right:64px; bottom:32px; z-index:1; display:flex; align-items:center; justify-content:space-between; height:64px; padding:0 12px 0 28px; border-radius:999px; background:var(--paper); border:1px solid var(--line); color:var(--muted); font-size:17px; }
      .send { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:var(--deep); }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.canvas}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <aside class="inbox" data-agent-native-node-id="inbox" data-agent-native-layer-name="Inbox">
        <ul>${people}</ul>
      </aside>
      <div style="position:absolute;left:24px;top:28px;z-index:2;display:flex;align-items:center;gap:10px;color:${C.ink};font:700 22px/1 'DM Sans',sans-serif;letter-spacing:-.02em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="14" fill="${C.greenDeep}"/><path d="M8 13h12M8 17h7" stroke="${C.paper}" stroke-width="2.4" stroke-linecap="round"/></svg>
        <span>Relay</span>
      </div>
      <header class="thread-head" data-agent-native-node-id="thread-header" data-agent-native-layer-name="Thread header">
        <span class="avatar">B</span>
        <div><b>Ben</b><small>Online</small></div>
      </header>
      <section class="thread" data-agent-native-node-id="thread" data-agent-native-layer-name="Conversation">
        <p class="msg them">Hey, how are you?</p>
        <p class="msg me">I'm good, thanks! Just got it.</p>
        <p class="msg them">Did you get my email?</p>
        <p class="msg me">Reading it now, looks promising!</p>
      </section>
      <div class="composer" data-agent-native-node-id="composer" data-agent-native-layer-name="Composer">
        <span>Type a message</span>
        <span class="send"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13M11 5l5 5-5 5" fill="none" stroke="${C.paper}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </div>`,
  }),
};
