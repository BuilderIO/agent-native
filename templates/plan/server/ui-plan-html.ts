type UiPlanState = {
  name: string;
  description: string;
};

type UiPlanComponent = {
  name: string;
  description: string;
};

export type BuildUiPlanHtmlInput = {
  title: string;
  brief: string;
  source?: string;
  repoPath?: string | null;
  states?: UiPlanState[];
  components?: UiPlanComponent[];
  implementationNotes?: string;
};

const DEFAULT_STATES: UiPlanState[] = [
  {
    name: "Review",
    description:
      "The plan opens directly on a full-width, high-fidelity mockup with the plan text pushed below the first visual review surface.",
  },
  {
    name: "Comment",
    description:
      "Text selection and click-to-comment stay anchored to the closest visible UI element or text node.",
  },
  {
    name: "Draw",
    description:
      "Drawing tools let the reviewer mark position, hierarchy, and layout problems on the mockup itself.",
  },
  {
    name: "Agent handoff",
    description:
      "Once feedback exists, the primary action becomes sending structured comments to the inline agent or copying them for the host agent.",
  },
  {
    name: "Mobile",
    description:
      "Responsive states show how commenting, drawing, and handoff work on narrow screens.",
  },
];

const DEFAULT_COMPONENTS: UiPlanComponent[] = [
  {
    name: "Floating toolbar",
    description:
      "Compact controls for comment mode, send-to-agent, share, theme, app-shell toggle, and overflow actions.",
  },
  {
    name: "Comment popover",
    description:
      "One-field Figma-like comment composer with no category picker or coordinate metadata in the user-facing bubble.",
  },
  {
    name: "Drawing controls",
    description:
      "Pointer, rectangle, arrow, and freehand tools that attach marks to the active mockup state.",
  },
  {
    name: "Implementation map",
    description:
      "Vertical file tabs with concise intent, snippets, and editor-open controls below the UI mockups.",
  },
];

export function buildUiPlanHtml(input: BuildUiPlanHtmlInput): string {
  const title = escapeHtml(input.title || "UI Plan");
  const brief = escapeHtml(
    input.brief || "Review the UI direction before code.",
  );
  const source = escapeHtml(input.source || "agent");
  const repoPath = input.repoPath ? escapeHtml(input.repoPath) : "";
  const states = normalizeStates(input.states);
  const components = normalizeComponents(input.components);
  const implementationNotes = escapeHtml(
    input.implementationNotes ||
      "Add file-level implementation details after the UI direction is approved. Keep snippets short and show only the shape the agent expects to modify.",
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${UI_PLAN_CSS}</style>
</head>
<body>
  <main class="ui-plan">
    <section class="intro">
      <p class="kicker">UI plan for review</p>
      <h1>${title}</h1>
      <p class="lede">${brief}</p>
      <ul class="plain-bullets">
        <li>UI mockups first, plan prose second.</li>
        <li>Full-width states are available as tabs.</li>
        <li>Comments, drawings, and decisions are structured for the agent.</li>
        <li>Implementation details stay available below the visual review.</li>
      </ul>
      <p class="source-note">Source: ${source}${repoPath ? ` / ${repoPath}` : ""}</p>
    </section>

    <section class="plan-section mockup-section" data-plan-section-id="ui-full-width-mockups">
      <div class="section-heading">
        <div>
          <p class="kicker">Full-width mockups</p>
          <h2>Start with the UI states the user needs to react to.</h2>
        </div>
        <p>These mockups are intentionally close to product fidelity: soft Agent-Native surfaces, real controls, tabbed states, and enough detail for critique.</p>
      </div>

      <div class="visual-tabs fullscreen-tabs" data-plan-tabs>
        <div class="tab-list" role="tablist" aria-label="UI plan states">
          ${states
            .map(
              (state, index) =>
                `<button type="button" class="tab-button${index === 0 ? " is-active" : ""}" data-tab-target="${tabId(state.name, index)}">${escapeHtml(state.name)}</button>`,
            )
            .join("")}
        </div>
        ${states
          .map((state, index) =>
            renderStatePanel(state, index, tabId(state.name, index)),
          )
          .join("")}
      </div>
    </section>

    <section class="plan-section" data-plan-section-id="ui-state-checklist">
      <div class="section-heading">
        <div>
          <p class="kicker">State checklist</p>
          <h2>Cover the paths that usually get missed in text plans.</h2>
        </div>
        <p>Agents should generate concrete state views for each UI path instead of relying on abstract bullets.</p>
      </div>
      <div class="state-grid">
        ${states
          .map(
            (state) => `<article class="state-card">
              <span></span>
              <h3>${escapeHtml(state.name)}</h3>
              <p>${escapeHtml(state.description)}</p>
            </article>`,
          )
          .join("")}
      </div>
    </section>

    <section class="plan-section" data-plan-section-id="ui-component-details">
      <div class="section-heading">
        <div>
          <p class="kicker">Interaction details</p>
          <h2>Small pieces use focused two-column mockups.</h2>
        </div>
        <p>For component-level feedback, keep a detailed mockup on the left and concise intent, constraints, and implementation notes on the right.</p>
      </div>
      <div class="visual-tabs component-tabs" data-plan-tabs>
        <div class="tab-list" role="tablist" aria-label="UI component details">
          ${components
            .map(
              (component, index) =>
                `<button type="button" class="tab-button${index === 0 ? " is-active" : ""}" data-tab-target="${tabId(component.name, index)}">${escapeHtml(component.name)}</button>`,
            )
            .join("")}
        </div>
        ${components
          .map((component, index) =>
            renderComponentPanel(
              component,
              index,
              tabId(component.name, index),
            ),
          )
          .join("")}
      </div>
    </section>

    <section class="plan-section" data-plan-section-id="ui-implementation-map">
      <div class="section-heading">
        <div>
          <p class="kicker">Implementation map</p>
          <h2>Code detail stays present, but below the UI decision.</h2>
        </div>
        <p>${implementationNotes}</p>
      </div>
      <div class="file-map-preview" data-plan-tabs>
        <div class="file-list" role="tablist" aria-label="Implementation files">
          <button class="file-tab is-active" type="button" data-tab-target="ui-file-plans-page"><strong>PlansPage.tsx</strong><span>UI shell, annotation runtime, toolbar states</span></button>
          <button class="file-tab" type="button" data-tab-target="ui-file-create-action"><strong>create-ui-plan.ts</strong><span>Agent action and MCP surface</span></button>
          <button class="file-tab" type="button" data-tab-target="ui-file-skill"><strong>ui-plan/SKILL.md</strong><span>Slash command behavior and generation rules</span></button>
        </div>
        <div class="file-panels">
          <article class="file-detail tab-panel is-active" data-tab-panel="ui-file-plans-page">
            <h3>PlansPage.tsx</h3>
            <p>Owns the immersive reader, annotation runtime, floating toolbar state, tab-aware comment anchors, and agent-sidebar handoff.</p>
            <pre><code><span class="syntax-keyword">type</span> UiPlanAnchor = {
  stateId: <span class="syntax-string">"review"</span> | <span class="syntax-string">"comment"</span> | <span class="syntax-string">"draw"</span>;
  nearbyText?: string;
  nodePath?: string;
  point?: { x: number; y: number };
};</code></pre>
          </article>
          <article class="file-detail tab-panel" data-tab-panel="ui-file-create-action">
            <h3>create-ui-plan.ts</h3>
            <p>Accepts a UI brief, target surface, states, component details, and implementation notes, then creates a reviewable HTML plan bundle.</p>
            <pre><code><span class="syntax-keyword">return</span> createPlan({
  title,
  sections: [<span class="syntax-string">"mockups"</span>, <span class="syntax-string">"states"</span>, <span class="syntax-string">"implementation"</span>],
  html: buildUiPlanHtml(input),
});</code></pre>
          </article>
          <article class="file-detail tab-panel" data-tab-panel="ui-file-skill">
            <h3>ui-plan/SKILL.md</h3>
            <p>Teaches Claude Code, Codex, and other MCP hosts to make UI-first plans: more mockups, fewer paragraphs, and comments before code.</p>
            <pre><code>/ui-plan
- lead with full-width UI states
- include component-level variants
- keep implementation details below the design decision</code></pre>
          </article>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function normalizeStates(states: UiPlanState[] | undefined) {
  const cleaned = (states || [])
    .map((state) => ({
      name: state.name?.trim(),
      description: state.description?.trim(),
    }))
    .filter(hasNameAndDescription);
  return cleaned.length > 0 ? cleaned.slice(0, 8) : DEFAULT_STATES;
}

function normalizeComponents(components: UiPlanComponent[] | undefined) {
  const cleaned = (components || [])
    .map((component) => ({
      name: component.name?.trim(),
      description: component.description?.trim(),
    }))
    .filter(hasNameAndDescription);
  return cleaned.length > 0 ? cleaned.slice(0, 8) : DEFAULT_COMPONENTS;
}

function hasNameAndDescription(
  item: Partial<UiPlanState>,
): item is UiPlanState {
  return Boolean(item.name && item.description);
}

function tabId(label: string, index: number) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `ui-${slug || "state"}-${index}`;
}

function renderStatePanel(state: UiPlanState, index: number, id: string) {
  const active = index === 0 ? " is-active" : "";
  const lowerName = state.name.toLowerCase();
  const mode = lowerName.includes("comment")
    ? "comment"
    : lowerName.includes("draw")
      ? "draw"
      : lowerName.includes("agent") || lowerName.includes("handoff")
        ? "agent"
        : lowerName.includes("mobile")
          ? "mobile"
          : "review";
  return `<div class="tab-panel${active}" data-tab-panel="${id}">
    ${mode === "mobile" ? renderMobileMockup(state) : renderDesktopMockup(state, mode)}
  </div>`;
}

function renderDesktopMockup(
  state: UiPlanState,
  mode: "review" | "comment" | "draw" | "agent",
) {
  const rightPanel =
    mode === "agent"
      ? `<aside class="agent-panel">
          <div class="panel-head"><strong>Plans agent</strong><span>ready</span></div>
          <div class="chat-bubble"><strong>Feedback payload</strong><p>Read comments, update the UI plan, then patch implementation only after review.</p></div>
          <div class="chat-bubble muted"><strong>Host fallback</strong><p>Copy instructions for Claude Code or Codex when inline handoff is unavailable.</p></div>
          <div class="composer">Ask the agent to update this UI plan...</div>
        </aside>`
      : `<aside class="review-panel">
          <div class="panel-head"><strong>Review queue</strong><span>3</span></div>
          <div class="comment-summary"><span>Open</span><p>Make this mockup feel closer to the production surface.</p></div>
          <div class="comment-summary"><span>Question</span><p>Should the primary action stay Comment until feedback exists?</p></div>
        </aside>`;

  const drawing =
    mode === "draw"
      ? `<div class="draw-toolbar"><i></i><i class="active"></i><i></i><i></i></div><div class="draw-mark"></div>`
      : "";
  const comment =
    mode === "comment"
      ? `<div class="selection">selected UI copy</div><div class="comment-pop"><textarea placeholder="Add a comment..."></textarea><button>Save</button></div>`
      : "";
  const pin =
    mode === "review" ? `<button class="pin" type="button">1</button>` : "";

  return `<div class="mock-stage" aria-label="${escapeHtml(state.name)} UI mockup">
    <div class="stage-topbar">
      <div class="brand-lockup"><span class="app-mark"></span><strong>Agent-Native Plans</strong><em>${escapeHtml(state.name)}</em></div>
      <div class="floating-toolbar">
        <button type="button">Comment</button>
        <button type="button" class="primary">${mode === "review" ? "Comment" : "Send to agent"}</button>
        <button type="button">...</button>
      </div>
    </div>
    <div class="stage-grid${mode === "agent" ? " has-agent" : ""}">
      <aside class="left-rail"><span class="active"></span><span></span><span></span><span></span></aside>
      <article class="plan-document">
        <div class="document-bar"><span>UI plan document</span><span>${escapeHtml(state.name)}</span></div>
        <div class="document-body">
          <div class="headline"></div>
          <div class="copy-line wide"></div>
          <div class="copy-line"></div>
          <div class="copy-line short"></div>
          <div class="mockup-row">
            <div class="surface-card active"><span></span><b></b><i></i><i></i></div>
            <div class="surface-card"><span></span><b></b><i></i><i></i></div>
          </div>
          <p class="state-caption">${escapeHtml(state.description)}</p>
        </div>
        ${pin}${comment}${drawing}
      </article>
      ${rightPanel}
    </div>
  </div>`;
}

function renderMobileMockup(state: UiPlanState) {
  return `<div class="mobile-stage" aria-label="${escapeHtml(state.name)} mobile UI mockup">
    <div class="phone">
      <div class="phone-screen">
        <div class="phone-top"><strong>Plan</strong><span>Comment</span></div>
        <div class="phone-body"><div class="phone-title"></div><div class="copy-line wide"></div><div class="copy-line"></div><div class="mobile-card"></div></div>
      </div>
    </div>
    <div class="phone">
      <div class="phone-screen">
        <div class="phone-top"><strong>Select</strong><span>1</span></div>
        <div class="phone-body"><p>${escapeHtml(state.description)}</p><span class="selection mobile">anchored comment</span></div>
        <div class="bottom-sheet"><textarea placeholder="Add a comment..."></textarea><button>Save</button></div>
      </div>
    </div>
    <div class="phone">
      <div class="phone-screen">
        <div class="phone-top"><strong>Send</strong><span>...</span></div>
        <div class="phone-body"><div class="comment-summary"><p>2 comments ready</p></div><div class="comment-summary"><p>Send to inline agent</p></div><div class="comment-summary"><p>Copy for host agent</p></div></div>
        <div class="bottom-sheet"><button>Send to agent</button></div>
      </div>
    </div>
  </div>`;
}

function renderComponentPanel(
  component: UiPlanComponent,
  index: number,
  id: string,
) {
  const active = index === 0 ? " is-active" : "";
  return `<div class="tab-panel${active}" data-tab-panel="${id}">
    <div class="component-detail">
      <div class="component-mock">
        <div class="mini-window">
          <div class="mini-toolbar"><span></span><span></span><button>${escapeHtml(component.name)}</button></div>
          <div class="mini-body"><div class="headline small"></div><div class="copy-line wide"></div><div class="copy-line"></div><div class="surface-card active"><span></span><b></b><i></i></div></div>
        </div>
      </div>
      <div class="component-copy">
        <h3>${escapeHtml(component.name)}</h3>
        <p>${escapeHtml(component.description)}</p>
        <ul>
          <li>Show the default, active, empty, and error states when relevant.</li>
          <li>Keep controls close to the thing being reviewed.</li>
          <li>Store the reviewer feedback as structured comments for the agent.</li>
        </ul>
      </div>
    </div>
  </div>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const UI_PLAN_CSS = `
:root { color-scheme: dark; --bg: #050506; --paper: #0b0c0f; --paper-2: #111217; --paper-3: #171920; --line: rgba(255,255,255,.11); --line-strong: rgba(255,255,255,.18); --text: #f4f5f6; --soft: #d3d5db; --muted: #9b9da7; --accent: #00aeef; --accent-soft: rgba(0,174,239,.14); --accent-line: rgba(0,174,239,.45); --shadow: 0 28px 90px rgba(0,0,0,.38); }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
.ui-plan { width: min(1500px, calc(100vw - 40px)); margin: 0 auto; padding: 76px 0 96px; }
.intro { max-width: 980px; }
.kicker { margin: 0 0 14px; color: var(--accent); text-transform: uppercase; letter-spacing: .18em; font: 800 12px/1.2 inherit; }
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 22px; font-size: clamp(42px, 5vw, 78px); line-height: .98; letter-spacing: -.045em; }
h2 { margin-bottom: 0; font-size: clamp(30px, 3vw, 48px); line-height: 1.06; letter-spacing: -.036em; }
h3 { font-size: 20px; line-height: 1.2; letter-spacing: -.018em; }
.lede { max-width: 900px; margin-bottom: 26px; color: var(--soft); font-size: clamp(20px, 2.1vw, 29px); line-height: 1.38; letter-spacing: -.024em; }
.plain-bullets { display: grid; gap: 8px; margin: 0; padding-left: 20px; color: var(--muted); }
.plain-bullets li::marker { color: var(--accent); }
.source-note { margin: 22px 0 0; color: var(--muted); font-size: 13px; }
.plan-section { margin-top: 80px; padding-top: 30px; border-top: 1px solid var(--line); scroll-margin-top: 80px; }
.section-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: 28px; margin-bottom: 24px; }
.section-heading > p { max-width: 620px; margin: 0; color: var(--muted); font-size: 17px; }
.visual-tabs { display: grid; gap: 18px; }
.tab-list { display: flex; width: fit-content; max-width: 100%; gap: 6px; margin: 0 auto; padding: 6px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.035); overflow-x: auto; }
.component-tabs .tab-list { margin: 0; }
.tab-button { min-height: 36px; border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--muted); padding: 0 14px; font: 700 13px/34px inherit; white-space: nowrap; cursor: pointer; }
.tab-button:hover { color: var(--text); background: rgba(255,255,255,.06); }
.tab-button.is-active { color: #071013; background: #f2f4f5; border-color: rgba(255,255,255,.46); }
.tab-panel { display: none; }
.tab-panel.is-active { display: block; }
.mock-stage { min-height: 760px; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 34px; background: #08090b; box-shadow: var(--shadow); padding: 22px; }
.stage-topbar { height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 18px; padding: 0 12px 0 18px; border: 1px solid var(--line); border-radius: 22px; background: rgba(255,255,255,.035); }
.brand-lockup { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand-lockup strong { font-size: 14px; }
.brand-lockup em { color: var(--muted); font-size: 12px; font-style: normal; }
.app-mark { width: 30px; height: 30px; flex: 0 0 auto; border-radius: 10px; background: linear-gradient(135deg, #eef3f6 0 48%, var(--accent) 49% 100%); }
.floating-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid var(--line); border-radius: 18px; background: rgba(10,11,13,.92); box-shadow: 0 18px 60px rgba(0,0,0,.3); }
.floating-toolbar button, .comment-pop button, .bottom-sheet button { min-height: 38px; border: 0; border-radius: 13px; background: transparent; color: var(--soft); padding: 0 13px; font-weight: 800; cursor: pointer; }
.floating-toolbar .primary, .comment-pop button, .bottom-sheet button { background: #f2f4f5; color: #101114; }
.stage-grid { display: grid; grid-template-columns: 70px minmax(0, 1fr) 320px; gap: 18px; min-height: 640px; }
.stage-grid.has-agent { grid-template-columns: 70px minmax(0, 1fr) 420px; }
.left-rail, .review-panel, .agent-panel { border: 1px solid var(--line); border-radius: 28px; background: rgba(255,255,255,.028); }
.left-rail { display: grid; align-content: start; gap: 10px; padding: 13px; }
.left-rail span { width: 44px; height: 44px; border: 1px solid var(--line); border-radius: 16px; background: rgba(255,255,255,.045); }
.left-rail span.active { background: #f0f2f4; box-shadow: inset 0 0 0 13px #f0f2f4, inset 0 0 0 15px var(--accent); }
.plan-document { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: 30px; background: #070809; }
.document-bar { height: 54px; display: flex; justify-content: space-between; align-items: center; padding: 0 20px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 13px; }
.document-body { width: min(960px, calc(100% - 72px)); margin: 44px auto 58px; }
.headline { width: min(760px, 100%); height: 112px; margin-bottom: 28px; border-radius: 22px; background: linear-gradient(180deg, rgba(255,255,255,.92), rgba(255,255,255,.72)); }
.headline.small { height: 52px; width: 72%; }
.copy-line { height: 12px; width: 68%; margin-bottom: 13px; border-radius: 999px; background: rgba(255,255,255,.13); }
.copy-line.wide { width: 92%; }
.copy-line.short { width: 42%; }
.mockup-row { display: grid; grid-template-columns: 1.1fr .9fr; gap: 18px; margin-top: 34px; }
.surface-card { min-height: 250px; padding: 18px; border: 1px solid var(--line); border-radius: 26px; background: rgba(255,255,255,.04); }
.surface-card.active { border-color: var(--accent-line); background: var(--accent-soft); }
.surface-card span, .surface-card b, .surface-card i { display: block; border-radius: 999px; background: rgba(255,255,255,.18); }
.surface-card span { width: 46%; height: 28px; margin-bottom: 20px; }
.surface-card b { width: 84%; height: 12px; margin-bottom: 12px; }
.surface-card i { width: 64%; height: 12px; margin-bottom: 12px; }
.state-caption { max-width: 720px; margin: 24px 0 0; color: var(--muted); font-size: 15px; }
.pin { position: absolute; left: 57%; top: 39%; width: 34px; height: 34px; border: 0; border-radius: 50%; background: var(--accent); color: #031318; font-weight: 900; box-shadow: 0 10px 26px rgba(0,174,239,.38), 0 0 0 3px rgba(255,255,255,.14); }
.review-panel, .agent-panel { padding: 18px; display: flex; flex-direction: column; gap: 13px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; color: var(--soft); text-transform: uppercase; letter-spacing: .1em; font-size: 12px; }
.comment-summary, .chat-bubble { border: 1px solid var(--line); border-radius: 22px; background: rgba(255,255,255,.045); padding: 14px; }
.comment-summary span { display: inline-flex; min-height: 24px; align-items: center; border-radius: 999px; background: #f2f4f5; color: #101114; padding: 0 9px; font-size: 12px; font-weight: 800; }
.comment-summary p, .chat-bubble p { margin: 8px 0 0; color: var(--soft); font-size: 14px; }
.chat-bubble.muted { color: var(--muted); }
.composer { margin-top: auto; border: 1px solid var(--line-strong); border-radius: 24px; background: rgba(255,255,255,.04); padding: 14px; color: var(--muted); }
.selection { position: absolute; left: 31%; top: 31%; border-radius: 8px; background: var(--accent); color: #071013; padding: 1px 8px 3px; font-weight: 800; }
.comment-pop { position: absolute; left: 42%; top: 39%; width: 360px; padding: 14px; border: 1px solid var(--line-strong); border-radius: 24px; background: rgba(17,18,22,.98); box-shadow: var(--shadow); }
.comment-pop textarea, .bottom-sheet textarea { width: 100%; min-height: 96px; resize: none; border: 1px solid var(--line); border-radius: 18px; background: rgba(255,255,255,.04); color: var(--text); padding: 12px; }
.comment-pop button { float: right; margin-top: 10px; }
.draw-toolbar { position: absolute; z-index: 4; left: 50%; top: 82px; transform: translateX(-50%); display: flex; gap: 8px; padding: 8px; border: 1px solid var(--line-strong); border-radius: 20px; background: rgba(18,19,23,.96); box-shadow: var(--shadow); }
.draw-toolbar i { width: 36px; height: 36px; border: 1px solid var(--line); border-radius: 13px; background: rgba(255,255,255,.08); }
.draw-toolbar i.active { border-color: var(--accent); background: var(--accent); }
.draw-mark { position: absolute; inset: 104px 58px 86px 110px; border: 2px solid var(--accent); border-radius: 28px; background: rgba(0,174,239,.06); box-shadow: 0 0 0 999px rgba(0,0,0,.18); }
.mobile-stage { display: grid; grid-template-columns: repeat(3, minmax(230px, 1fr)); gap: 22px; min-height: 700px; align-items: center; padding: 28px; border: 1px solid var(--line-strong); border-radius: 34px; background: #08090b; box-shadow: var(--shadow); }
.phone { height: 630px; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 42px; background: #08090a; padding: 12px; box-shadow: var(--shadow); }
.phone-screen { position: relative; height: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: 32px; background: #050506; }
.phone-top { height: 56px; display: flex; justify-content: space-between; align-items: center; padding: 0 16px; border-bottom: 1px solid var(--line); }
.phone-body { padding: 28px 18px; }
.phone-title { height: 78px; margin-bottom: 22px; border-radius: 18px; background: rgba(255,255,255,.82); }
.mobile-card { height: 190px; margin-top: 28px; border: 1px solid var(--accent-line); border-radius: 22px; background: var(--accent-soft); }
.selection.mobile { position: static; display: inline-block; margin-top: 10px; }
.bottom-sheet { position: absolute; left: 10px; right: 10px; bottom: 10px; padding: 16px; border: 1px solid var(--line-strong); border-radius: 28px; background: rgba(18,19,23,.98); }
.state-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.state-card { min-height: 190px; padding: 18px; border: 1px solid var(--line); border-radius: 24px; background: rgba(255,255,255,.035); }
.state-card span { display: block; width: 16px; height: 16px; margin-bottom: 22px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 7px var(--accent-soft); }
.state-card p, .component-copy p, .component-copy li { color: var(--muted); }
.component-detail { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(300px, .88fr); gap: 20px; }
.component-mock, .component-copy { min-height: 380px; border: 1px solid var(--line); border-radius: 30px; background: rgba(255,255,255,.03); padding: 26px; }
.mini-window { overflow: hidden; height: 100%; border: 1px solid var(--line); border-radius: 26px; background: #08090a; }
.mini-toolbar { height: 58px; display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid var(--line); }
.mini-toolbar span { width: 38px; height: 38px; border-radius: 14px; background: rgba(255,255,255,.08); }
.mini-toolbar button { min-height: 38px; border: 0; border-radius: 14px; background: #f2f4f5; color: #101114; padding: 0 14px; font-weight: 800; }
.mini-body { padding: 28px; }
.file-map-preview { display: grid; grid-template-columns: minmax(250px, .38fr) minmax(0, 1fr); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.file-list { border-right: 1px solid var(--line); }
.file-tab { width: 100%; display: grid; gap: 4px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--muted); padding: 16px; text-align: left; }
.file-tab:hover { color: var(--text); background: rgba(255,255,255,.035); cursor: pointer; }
.file-tab.is-active { color: var(--text); background: var(--paper-2); box-shadow: inset 3px 0 0 var(--accent); }
.file-tab strong { font: 750 15px/1.3 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.file-tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-panels { min-width: 0; }
.file-detail { min-width: 0; padding: 26px; }
.file-detail p { color: var(--soft); }
pre { margin: 18px 0 0; overflow: auto; border: 1px solid var(--line); border-radius: 22px; background: #070809; padding: 20px 22px; color: #dfe2e7; font: 13px/1.65 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.syntax-keyword { color: #68c8ff; }
.syntax-string { color: #96e39f; }
@media (max-width: 1080px) { .state-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .stage-grid, .stage-grid.has-agent { grid-template-columns: 58px minmax(0, 1fr); } .review-panel, .agent-panel { display: none; } .component-detail, .mockup-row, .file-map-preview { grid-template-columns: 1fr; } .mobile-stage { grid-template-columns: 1fr; } .phone { width: min(360px, 100%); margin: 0 auto; } }
@media (max-width: 720px) { .ui-plan { width: min(100vw - 24px, 1500px); padding-top: 48px; } .section-heading { display: block; } .state-grid { grid-template-columns: 1fr; } .mock-stage { min-height: auto; padding: 12px; } .document-body { width: calc(100% - 28px); margin: 28px auto; } .floating-toolbar { max-width: 100%; overflow-x: auto; } }
`;
