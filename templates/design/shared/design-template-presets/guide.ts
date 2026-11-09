import { presetDocument } from "./doc.js";

export interface GuideStep {
  title: string;
  body: string;
  /** A prompt the user can paste into the agent chat to try this step. */
  prompt: string;
}

/**
 * The "How this works" frame that ships beside a multi-frame template: a
 * heading, one line of context, and three steps that each end in a prompt
 * to try. The palette must define `surface`, `paper`, `ink`, `soft` and
 * `line`. `logo` is the template's locked logo markup, so the frame keeps
 * the same two locked layers as every other frame.
 */
export function guideFrame({
  title,
  documentTitle,
  intro,
  steps,
  logo,
  fonts,
  palette,
  displayFont,
  bodyFont,
  width = 1440,
  height = 620,
}: {
  title: string;
  documentTitle: string;
  intro: string;
  steps: [GuideStep, GuideStep, GuideStep];
  logo: string;
  fonts: string;
  palette: Record<string, string>;
  displayFont: string;
  bodyFont: string;
  width?: number;
  height?: number;
}): string {
  const step = ({ title: heading, body, prompt }: GuideStep, i: number) => `
        <li class="guide-step" data-agent-native-node-id="guide-step-${i + 1}" data-agent-native-layer-name="Step ${i + 1}">
          <span class="guide-num">${i + 1}</span>
          <div class="guide-title">${heading}</div>
          <div class="guide-body">${body}</div>
          <div class="guide-try"><div><span>Try: </span>“${prompt}”</div></div>
        </li>`;
  return presetDocument({
    title: documentTitle,
    width,
    height,
    fonts,
    palette,
    css: `
      .artboard { color:var(--ink); font-family:${bodyFont}; }
      .guide-head { position:absolute; left:96px; top:108px; right:96px; z-index:2; display:flex; justify-content:space-between; align-items:flex-end; gap:40px; }
      .guide-head h2 { font:700 44px/1 ${displayFont}; letter-spacing:-.03em; }
      .guide-head p { margin-top:12px; color:var(--soft); font-size:18px; line-height:1.4; }
      .guide-head small { flex:none; color:var(--soft); font-size:15px; }
      .guide-steps { position:absolute; left:96px; right:96px; top:236px; bottom:56px; z-index:2; display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; }
      .guide-step { display:flex; flex-direction:column; padding:32px; border:1px solid var(--line); border-radius:24px; background:var(--surface); }
      .guide-num { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:var(--ink); color:var(--surface); font:700 20px/1 ${displayFont}; }
      .guide-title { margin-top:22px; font-size:24px; font-weight:600; letter-spacing:-.01em; }
      .guide-body { margin-top:8px; color:var(--soft); font-size:17px; line-height:1.5; }
      .guide-try { margin-top:auto; padding-top:24px; }
      .guide-try div { padding:14px 16px; border-radius:12px; background:var(--paper); font-size:16px; line-height:1.4; }
      .guide-try span { color:var(--soft); }
    `,
    body: `
      <div style="position:absolute;inset:0;background:var(--surface);border:2px dashed var(--line)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      ${logo}
      <div class="guide-head" data-agent-native-node-id="guide-head" data-agent-native-layer-name="Heading">
        <div><h2>${title}</h2><p>${intro}</p></div>
        <small>Delete this frame before you share.</small>
      </div>
      <ol class="guide-steps" data-agent-native-node-id="guide-steps" data-agent-native-layer-name="Steps">${steps.map(step).join("")}
      </ol>`,
  });
}
