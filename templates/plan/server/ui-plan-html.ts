type UiPlanState = {
  name: string;
  description: string;
};

type UiPlanComponent = {
  name: string;
  description: string;
};

export const FIGMA_BOARD_UI_PLAN_DEFAULT = false;
const DEFAULT_BOARD_SKETCHINESS = 38;

export type BuildUiPlanHtmlInput = {
  title: string;
  brief: string;
  source?: string;
  repoPath?: string | null;
  states?: UiPlanState[];
  components?: UiPlanComponent[];
  implementationNotes?: string;
  figmaBoardMode?: boolean;
  sketchiness?: number;
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
  if (input.figmaBoardMode ?? FIGMA_BOARD_UI_PLAN_DEFAULT) {
    return buildFigmaBoardUiPlanHtml(input);
  }

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

function buildFigmaBoardUiPlanHtml(input: BuildUiPlanHtmlInput): string {
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
      "Keep implementation detail under the board so the first pass stays visual. Use the file cards to capture what changes after the user approves the direction.",
  );
  const sketchiness = clampSketchiness(input.sketchiness);
  const board = buildBoardLayout(states, components);

  return `<!doctype html>
<html lang="en" data-board-density="regular" style="--board-zoom:.72; --sketch:${(sketchiness / 100).toFixed(2)}; --accent:#3f6fd9; --accent-soft:rgba(63,111,217,.13);">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${FIGMA_BOARD_UI_PLAN_CSS}</style>
</head>
<body data-ui-plan-mode="figma-board">
  <svg class="rough-defs" aria-hidden="true" focusable="false">
    <filter id="ui-plan-roughen">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="8" result="noise" />
      <feDisplacementMap data-rough-map in="SourceGraphic" in2="noise" scale="${Math.round(sketchiness / 12)}" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>

  <header class="board-topbar">
    <div class="board-file">
      <span class="file-dot"></span>
      <strong>${title}</strong>
      <span>${source}${repoPath ? ` / ${repoPath}` : ""}</span>
    </div>
    <div class="board-controls" aria-label="Board controls">
      <button type="button" data-zoom-out aria-label="Zoom out">-</button>
      <button type="button" data-zoom-reset><span data-zoom-label>72%</span></button>
      <button type="button" data-zoom-in aria-label="Zoom in">+</button>
    </div>
  </header>

  <main class="figma-board" data-plan-section-id="figma-style-board" aria-label="${title} Figma-style UI plan board">
    <div class="board-world" data-board-world style="width:calc(${board.width}px * var(--board-zoom));height:calc(${board.height}px * var(--board-zoom));">
      <div class="board-canvas" data-board-canvas style="width:${board.width}px;height:${board.height}px;">
        <section class="board-note intro-note" style="${frameStyle(80, 82, 520, 260)}" data-plan-visual data-label="Plan brief">
          <p class="eyebrow">UI plan board</p>
          <h1>${title}</h1>
          <p>${brief}</p>
          <div class="note-meta">
            <span>${source}</span>
            ${repoPath ? `<span>${repoPath}</span>` : ""}
          </div>
        </section>

        <div class="board-group-label" style="${frameStyle(80, 346, 420, 42)}">A - Screen directions</div>
        ${states.map((state, index) => renderBoardStateFrame(state, index)).join("")}

        <div class="board-group-label" style="${frameStyle(80, board.componentY - 58, 430, 42)}">B - Interaction notes</div>
        ${components.map((component, index) => renderBoardComponentFrame(component, index, board)).join("")}

        <div class="board-group-label" style="${frameStyle(80, board.implementationY - 58, 460, 42)}">C - Build handoff</div>
        ${renderBoardImplementationFrame(implementationNotes, board)}
        ${renderBoardHandoffFrame(board)}
      </div>
    </div>
  </main>

  <aside class="tweaks-panel" aria-label="Board tweaks">
    <div class="tweaks-head">
      <strong>Tweaks</strong>
      <button type="button" data-close-tweaks aria-label="Hide tweaks">x</button>
    </div>
    <div class="tweak-group">
      <p>Layout</p>
      <div class="segmented">
        <button type="button" data-density-option="compact">compact</button>
        <button type="button" class="is-active" data-density-option="regular">regular</button>
        <button type="button" data-density-option="roomy">roomy</button>
      </div>
    </div>
    <div class="tweak-group">
      <p>Sketch</p>
      <label class="range-row">
        <span>Sketchiness</span>
        <span data-sketch-label>${sketchiness}%</span>
      </label>
      <input type="range" min="0" max="100" value="${sketchiness}" data-sketchiness />
    </div>
    <div class="tweak-group">
      <p>Accent</p>
      <div class="swatches">
        <button type="button" class="is-active" data-accent="#3f6fd9" style="--swatch:#3f6fd9" aria-label="Blue accent"></button>
        <button type="button" data-accent="#cf5432" style="--swatch:#cf5432" aria-label="Red accent"></button>
        <button type="button" data-accent="#4d9f68" style="--swatch:#4d9f68" aria-label="Green accent"></button>
        <button type="button" data-accent="#8359d8" style="--swatch:#8359d8" aria-label="Purple accent"></button>
        <button type="button" data-accent="#5f5b54" style="--swatch:#5f5b54" aria-label="Graphite accent"></button>
      </div>
    </div>
  </aside>

  <script>${FIGMA_BOARD_UI_PLAN_JS}</script>
</body>
</html>`;
}

function clampSketchiness(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BOARD_SKETCHINESS;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildBoardLayout(
  states: UiPlanState[],
  components: UiPlanComponent[],
) {
  const secondaryCount = Math.max(0, states.length - 1);
  const stateRows = Math.max(1, Math.ceil(secondaryCount / 4));
  const componentRows = Math.max(1, Math.ceil(components.length / 4));
  const componentY = 1040 + (stateRows - 1) * 610;
  const implementationY = componentY + componentRows * 330 + 92;
  return {
    width: 2680,
    height: implementationY + 520,
    componentY,
    implementationY,
  };
}

function frameStyle(x: number, y: number, width: number, height: number) {
  return `left:${x}px;top:${y}px;width:${width}px;height:${height}px;`;
}

function stateFrameLayout(index: number) {
  if (index === 0) {
    return { x: 80, y: 410, width: 780, height: 520, kind: "desktop" };
  }
  const secondary = index - 1;
  return {
    x: 940 + (secondary % 4) * 360,
    y: 390 + Math.floor(secondary / 4) * 610,
    width: 302,
    height: 560,
    kind: "mobile",
  };
}

function renderBoardStateFrame(state: UiPlanState, index: number) {
  const layout = stateFrameLayout(index);
  const label = escapeHtml(state.name);
  const description = escapeHtml(state.description);
  const id = `board-state-${index}`;
  const isDesktop = layout.kind === "desktop";
  const inner = isDesktop
    ? renderBoardDesktopScreen(state, index)
    : renderBoardPhoneScreen(state, index);
  return `<article id="${id}" class="board-frame ${isDesktop ? "desktop-frame" : "phone-frame"}" style="${frameStyle(layout.x, layout.y, layout.width, layout.height)}" data-plan-visual data-label="${label}" aria-label="${label} artboard">
    <div class="frame-label"><span>::</span><strong>${label}</strong></div>
    ${inner}
    <p class="frame-caption">${description}</p>
  </article>`;
}

function renderBoardDesktopScreen(state: UiPlanState, index: number) {
  return `<div class="wire-window rough-target">
    <div class="window-bar"><span></span><span></span><span></span><i>${escapeHtml(state.name)}</i></div>
    <div class="desktop-shell">
      <aside class="sketch-sidebar">
        <b>Workspace</b>
        <i class="is-active"></i>
        <i></i>
        <i></i>
        <i></i>
      </aside>
      <section class="sketch-main">
        <div class="screen-head">
          <div>
            <h2>${escapeHtml(state.name)}</h2>
            <p>${escapeHtml(state.description)}</p>
          </div>
          <button type="button">Primary</button>
        </div>
        <div class="pill-row">
          <span class="pill is-active">All</span>
          <span class="pill">Active</span>
          <span class="pill">Done</span>
        </div>
        <div class="task-list">
          ${[0, 1, 2, 3].map((item) => renderSketchTaskRow(item, index)).join("")}
        </div>
      </section>
    </div>
  </div>`;
}

function renderBoardPhoneScreen(state: UiPlanState, index: number) {
  const mode = state.name.toLowerCase();
  const isForm =
    mode.includes("add") || mode.includes("edit") || mode.includes("new");
  const isDetail = mode.includes("detail") || mode.includes("task");
  return `<div class="phone-shell rough-target">
    <div class="phone-status"><span>9:41</span><i></i><i></i><i></i></div>
    <div class="phone-header"><button type="button">${isForm ? "Cancel" : "Back"}</button><strong>${escapeHtml(state.name)}</strong><button type="button">${isForm ? "Save" : "..."}</button></div>
    ${
      isForm
        ? `<div class="phone-form">
            <label>Title</label><div class="input-line"></div>
            <label>Notes</label><div class="textarea-line"></div>
            <label>When</label><div class="chip-grid"><span>Today</span><span class="is-active">Tomorrow</span><span>This week</span></div>
          </div>`
        : isDetail
          ? `<div class="phone-detail"><div class="task-title"></div><div class="priority-row"><span></span><span></span></div><div class="notes-lines"><i></i><i></i><i></i></div><div class="check-list">${[0, 1, 2].map((item) => renderPhoneCheck(item)).join("")}</div></div>`
          : `<div class="phone-list"><div class="pill-row"><span class="pill is-active">All</span><span class="pill">Active</span><span class="pill">Done</span></div>${[0, 1, 2, 3].map((item) => renderPhoneTask(item, index)).join("")}</div>`
    }
  </div>`;
}

function renderSketchTaskRow(item: number, stateIndex: number) {
  const urgent = (item + stateIndex) % 3 === 0;
  return `<div class="task-row">
    <span class="check ${item === 2 ? "checked" : ""}"></span>
    <div><b></b><i></i></div>
    <em class="${urgent ? "hot" : ""}">${urgent ? "Soon" : "Later"}</em>
  </div>`;
}

function renderPhoneTask(item: number, stateIndex: number) {
  return `<div class="phone-task">
    <span class="check ${item === 3 ? "checked" : ""}"></span>
    <div><b></b><i></i></div>
    <em>${(item + stateIndex) % 2 === 0 ? "2 PM" : ""}</em>
  </div>`;
}

function renderPhoneCheck(item: number) {
  return `<div class="phone-check"><span class="check ${item === 0 ? "checked" : ""}"></span><i></i></div>`;
}

function renderBoardComponentFrame(
  component: UiPlanComponent,
  index: number,
  board: ReturnType<typeof buildBoardLayout>,
) {
  const x = 80 + (index % 4) * 410;
  const y = board.componentY + Math.floor(index / 4) * 330;
  return `<article class="board-card component-card" style="${frameStyle(x, y, 370, 250)}" data-plan-visual data-label="${escapeHtml(component.name)}">
    <p class="eyebrow">Component</p>
    <h3>${escapeHtml(component.name)}</h3>
    <p>${escapeHtml(component.description)}</p>
    <div class="component-mini">
      <span></span><span></span><button type="button">Action</button>
    </div>
  </article>`;
}

function renderBoardImplementationFrame(
  implementationNotes: string,
  board: ReturnType<typeof buildBoardLayout>,
) {
  return `<article class="board-frame implementation-frame" style="${frameStyle(80, board.implementationY, 1240, 360)}" data-plan-visual data-label="Implementation map">
    <div class="frame-label"><span>::</span><strong>Implementation map</strong></div>
    <div class="implementation-grid">
      <div class="implementation-copy">
        <p>${implementationNotes}</p>
      </div>
      <div class="file-cards">
        <div class="file-card"><strong>PlansPage.tsx</strong><span>Reader chrome, annotations, board runtime</span></div>
        <div class="file-card"><strong>create-ui-plan.ts</strong><span>Boolean mode, action args, event payload</span></div>
        <div class="file-card"><strong>ui-plan-html.ts</strong><span>Sketch artboards, pan/zoom, tweaks</span></div>
        <div class="file-card"><strong>ui-plan/SKILL.md</strong><span>When to request board mode</span></div>
      </div>
    </div>
  </article>`;
}

function renderBoardHandoffFrame(board: ReturnType<typeof buildBoardLayout>) {
  return `<article class="board-card handoff-card" style="${frameStyle(1390, board.implementationY, 620, 360)}" data-plan-visual data-label="Reviewer handoff">
    <p class="eyebrow">Agent handoff</p>
    <h3>Review on the board first.</h3>
    <ul>
      <li>Compare the artboards side by side.</li>
      <li>Use comments or drawing marks on specific frames.</li>
      <li>Send the open feedback back to the agent before editing code.</li>
    </ul>
    <div class="handoff-actions"><button type="button">Comment</button><button type="button">Send to agent</button></div>
  </article>`;
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
      ? `<div class="selection">selected UI copy</div><div class="comment-pop"><textarea placeholder="Add a comment..." readonly tabindex="-1"></textarea><button type="button" disabled>Save</button></div>`
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
        <div class="bottom-sheet"><textarea placeholder="Add a comment..." readonly tabindex="-1"></textarea><button type="button" disabled>Save</button></div>
      </div>
    </div>
    <div class="phone">
      <div class="phone-screen">
        <div class="phone-top"><strong>Send</strong><span>...</span></div>
        <div class="phone-body"><div class="comment-summary"><p>2 comments ready</p></div><div class="comment-summary"><p>Send to inline agent</p></div><div class="comment-summary"><p>Copy for host agent</p></div></div>
        <div class="bottom-sheet"><button type="button" disabled>Send to agent</button></div>
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

const FIGMA_BOARD_UI_PLAN_CSS = `
:root { color-scheme: light; --board-bg: #f4f5f1; --grid-major: rgba(50,50,45,.07); --grid-minor: rgba(50,50,45,.035); --ink: #34302b; --muted: #837d73; --paper: #fffefd; --paper-alt: #fbfaf5; --line: #3d3831; --soft-line: rgba(61,56,49,.2); --shadow: 0 20px 48px rgba(43,40,34,.12); --wire-font: "Comic Sans MS", "Bradley Hand", "Marker Felt", cursive; --ui-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --density-scale: 1; }
* { box-sizing: border-box; }
html { min-width: 100%; min-height: 100%; background: var(--board-bg); scroll-behavior: auto; }
body { min-width: 100%; min-height: 100%; margin: 0; color: var(--ink); background-color: var(--board-bg); background-image: linear-gradient(var(--grid-minor) 1px, transparent 1px), linear-gradient(90deg, var(--grid-minor) 1px, transparent 1px), linear-gradient(var(--grid-major) 1px, transparent 1px), linear-gradient(90deg, var(--grid-major) 1px, transparent 1px); background-size: 48px 48px, 48px 48px, 240px 240px, 240px 240px; font-family: var(--ui-font); line-height: 1.45; cursor: grab; }
body.is-panning { cursor: grabbing; user-select: none; }
button, input { font: inherit; }
.rough-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.board-topbar { position: fixed; z-index: 20; left: 0; right: 0; top: 0; display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid rgba(38,35,30,.13); background: rgba(252,251,247,.88); padding: 0 18px; box-shadow: 0 10px 32px rgba(45,41,34,.08); backdrop-filter: blur(16px); cursor: default; }
.board-file { display: flex; min-width: 0; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; }
.board-file strong { max-width: 42vw; overflow: hidden; color: var(--ink); text-overflow: ellipsis; white-space: nowrap; }
.board-file span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-dot { width: 20px; height: 20px; flex: 0 0 auto; border: 1.5px solid var(--accent); border-radius: 6px; background: var(--accent-soft); }
.board-controls { display: inline-flex; align-items: center; gap: 2px; border: 1px solid rgba(38,35,30,.13); border-radius: 8px; background: #fff; padding: 3px; }
.board-controls button { min-width: 34px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); padding: 0 10px; font-weight: 750; cursor: pointer; }
.board-controls button:hover { background: rgba(52,48,43,.08); }
.figma-board { position: relative; min-width: 100%; padding-top: 66px; }
.board-world { position: relative; transform-origin: 0 0; }
.board-canvas { position: absolute; left: 0; top: 0; transform: scale(var(--board-zoom)); transform-origin: 0 0; }
.board-note, .board-frame, .board-card, .board-group-label { position: absolute; }
.board-note, .board-frame, .board-card { color: var(--ink); cursor: default; }
.intro-note { display: flex; flex-direction: column; justify-content: space-between; border: 1.6px solid var(--line); border-radius: 7px; background: rgba(255,254,252,.88); padding: 22px 24px; box-shadow: var(--shadow); }
.intro-note::after, .board-frame::after, .board-card::after { content: ""; position: absolute; inset: calc(var(--sketch) * -3px); border: calc(1px + var(--sketch) * 1.4px) solid rgba(61,56,49,.36); border-radius: inherit; opacity: calc(var(--sketch) * .72); transform: translate(calc(var(--sketch) * 2px), calc(var(--sketch) * -1px)) rotate(calc(var(--sketch) * .28deg)); pointer-events: none; }
.eyebrow { margin: 0 0 10px; color: var(--muted); font: 750 11px/1.2 var(--ui-font); text-transform: uppercase; letter-spacing: 0; }
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 12px; font: 400 34px/1.08 var(--wire-font); letter-spacing: 0; }
h2 { margin-bottom: 4px; font: 400 25px/1.1 var(--wire-font); letter-spacing: 0; }
h3 { margin-bottom: 10px; font: 400 25px/1.12 var(--wire-font); letter-spacing: 0; }
.intro-note p, .board-card p, .frame-caption { color: var(--muted); font-size: 15px; }
.note-meta { display: flex; flex-wrap: wrap; gap: 7px; }
.note-meta span { max-width: 100%; overflow: hidden; border: 1px solid rgba(61,56,49,.18); border-radius: 999px; background: #f2efe7; padding: 5px 9px; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.board-group-label { display: flex; align-items: center; color: var(--ink); font: 400 26px/1 var(--wire-font); }
.board-group-label::before { content: ""; display: inline-block; width: 18px; height: 18px; margin-right: 10px; border: 1.5px dashed var(--accent); border-radius: 5px; background: var(--accent-soft); }
.board-frame { border: 1.6px solid rgba(61,56,49,.76); border-radius: 7px; background: var(--paper); box-shadow: var(--shadow); }
.frame-label { position: absolute; left: 0; right: 0; top: -32px; display: flex; align-items: center; gap: 9px; color: var(--muted); font: 650 15px/1.1 var(--ui-font); }
.frame-label span { color: rgba(61,56,49,.48); font-weight: 900; letter-spacing: 0; }
.frame-label strong { color: var(--ink); font: 400 20px/1 var(--wire-font); }
.wire-window { position: absolute; inset: 14px 14px 76px; overflow: hidden; border: 1.5px solid var(--line); border-radius: 5px; background: #fff; filter: url(#ui-plan-roughen); }
.window-bar { display: flex; height: 28px; align-items: center; gap: 6px; border-bottom: 1.4px solid var(--line); padding: 0 9px; }
.window-bar span { width: 7px; height: 7px; border: 1.2px solid var(--line); border-radius: 999px; }
.window-bar i { margin-left: 7px; color: var(--muted); font: 400 11px/1 var(--wire-font); font-style: normal; }
.desktop-shell { display: grid; height: calc(100% - 28px); grid-template-columns: 154px 1fr; }
.sketch-sidebar { display: flex; flex-direction: column; gap: 13px; border-right: 1.4px solid var(--line); padding: 18px 15px; }
.sketch-sidebar b { margin-bottom: 4px; font: 400 15px/1 var(--wire-font); }
.sketch-sidebar i { display: block; height: calc(27px * var(--density-scale)); border: 1.3px solid rgba(61,56,49,.42); border-radius: 5px; background: #f7f5ed; }
.sketch-sidebar i.is-active { background: var(--accent-soft); border-color: var(--accent); }
.sketch-main { min-width: 0; padding: 22px 24px; }
.screen-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.screen-head p { max-width: 420px; margin: 0; color: var(--muted); font: 400 14px/1.35 var(--wire-font); }
.screen-head button, .handoff-actions button { min-height: 34px; border: 1.5px solid var(--accent); border-radius: 5px; background: var(--accent); color: #fff; padding: 0 14px; font: 750 13px/1 var(--ui-font); cursor: default; }
.pill-row { display: flex; flex-wrap: wrap; gap: 9px; margin: 20px 0 18px; }
.pill { display: inline-flex; min-height: 26px; align-items: center; border: 1.3px solid var(--line); border-radius: 999px; background: #fff; padding: 0 11px; font: 400 13px/1 var(--wire-font); }
.pill.is-active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.task-list { display: grid; gap: calc(12px * var(--density-scale)); }
.task-row { display: grid; min-height: calc(52px * var(--density-scale)); grid-template-columns: 22px 1fr 58px; align-items: center; gap: 12px; border-top: 1.2px solid rgba(61,56,49,.18); }
.check { display: inline-block; width: 15px; height: 15px; border: 1.5px solid var(--line); border-radius: 4px; background: #fff; }
.check.checked { background: var(--accent); box-shadow: inset 0 0 0 3px #fff; }
.task-row b, .task-row i, .phone-task b, .phone-task i, .phone-check i, .notes-lines i, .task-title, .input-line, .textarea-line { display: block; border-radius: 999px; background: #d8d1c3; }
.task-row b { width: 54%; height: 10px; margin-bottom: 8px; }
.task-row i { width: 34%; height: 8px; }
.task-row em { justify-self: end; border: 1.2px solid var(--line); border-radius: 999px; padding: 3px 7px; color: var(--muted); font: 400 11px/1 var(--wire-font); font-style: normal; }
.task-row em.hot { border-color: #cf5432; color: #cf5432; }
.frame-caption { position: absolute; left: 16px; right: 16px; bottom: 14px; margin: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font: 400 14px/1.25 var(--wire-font); }
.phone-frame { padding: 13px; background: #fffdfa; }
.phone-shell { position: absolute; inset: 13px 13px 56px; overflow: hidden; border: 1.5px solid var(--line); border-radius: 25px; background: #fff; filter: url(#ui-plan-roughen); }
.phone-status { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 13px; color: var(--muted); font: 650 10px/1 var(--ui-font); }
.phone-status span { flex: 1; }
.phone-status i { width: 12px; height: 4px; border-radius: 99px; background: #8c867e; }
.phone-header { display: grid; height: 40px; grid-template-columns: 54px 1fr 54px; align-items: center; border-bottom: 1.3px solid var(--line); padding: 0 9px; text-align: center; }
.phone-header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 14px/1 var(--wire-font); }
.phone-header button { border: 0; background: transparent; color: var(--accent); padding: 0; font: 750 11px/1 var(--ui-font); }
.phone-list, .phone-form, .phone-detail { padding: 17px 14px; }
.phone-list .pill-row { margin-top: 0; gap: 7px; }
.phone-task { display: grid; min-height: calc(48px * var(--density-scale)); grid-template-columns: 18px 1fr 38px; align-items: center; gap: 8px; border-bottom: 1px solid rgba(61,56,49,.16); }
.phone-task b { width: 68%; height: 8px; margin-bottom: 7px; }
.phone-task i { width: 43%; height: 7px; }
.phone-task em { color: var(--muted); font: 400 10px/1 var(--wire-font); font-style: normal; }
.phone-form label { display: block; margin: 13px 0 5px; color: var(--muted); font: 750 9px/1 var(--ui-font); text-transform: uppercase; letter-spacing: 0; }
.input-line { height: 32px; border: 1.2px solid var(--line); background: transparent; }
.textarea-line { height: 72px; border: 1.2px solid var(--line); border-radius: 5px; background: transparent; }
.chip-grid { display: flex; flex-wrap: wrap; gap: 7px; }
.chip-grid span { border: 1.2px solid var(--line); border-radius: 999px; padding: 5px 8px; font: 400 11px/1 var(--wire-font); }
.chip-grid span.is-active { border-color: var(--accent); color: var(--accent); }
.task-title { width: 84%; height: 21px; margin-bottom: 18px; }
.priority-row { display: flex; gap: 8px; margin-bottom: 26px; }
.priority-row span { width: 66px; height: 22px; border: 1.2px solid var(--accent); border-radius: 999px; background: var(--accent-soft); }
.notes-lines { display: grid; gap: 9px; margin-bottom: 24px; }
.notes-lines i { height: 9px; }
.notes-lines i:nth-child(2) { width: 82%; }
.notes-lines i:nth-child(3) { width: 48%; }
.check-list { display: grid; gap: 15px; }
.phone-check { display: grid; grid-template-columns: 18px 1fr; gap: 8px; align-items: center; }
.phone-check i { height: 8px; }
.board-card { border: 1.6px solid var(--line); border-radius: 7px; background: #fff9df; padding: 19px 20px; box-shadow: var(--shadow); }
.component-card:nth-of-type(2n) { background: #e8f2e8; }
.component-card:nth-of-type(3n) { background: #e9edf9; }
.component-card p { font: 400 15px/1.35 var(--wire-font); }
.component-mini { position: absolute; left: 20px; right: 20px; bottom: 18px; display: grid; grid-template-columns: 1fr 1fr auto; gap: 9px; align-items: center; }
.component-mini span { height: 26px; border: 1.3px solid rgba(61,56,49,.46); border-radius: 5px; background: rgba(255,255,255,.5); }
.component-mini button { min-height: 28px; border: 1.3px solid var(--accent); border-radius: 5px; background: var(--accent-soft); color: var(--accent); padding: 0 10px; font-weight: 750; }
.implementation-frame { padding: 24px; }
.implementation-grid { display: grid; height: 100%; grid-template-columns: .7fr 1.3fr; gap: 22px; }
.implementation-copy { display: flex; align-items: center; border-right: 1px solid rgba(61,56,49,.16); padding-right: 22px; }
.implementation-copy p { margin: 0; color: var(--muted); font: 400 19px/1.35 var(--wire-font); }
.file-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-content: center; }
.file-card { min-height: 110px; border: 1.3px solid rgba(61,56,49,.42); border-radius: 6px; background: var(--paper-alt); padding: 14px; }
.file-card strong { display: block; margin-bottom: 8px; font: 750 13px/1.2 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.file-card span { color: var(--muted); font-size: 13px; }
.handoff-card { background: #eef4fb; }
.handoff-card ul { display: grid; gap: 9px; margin: 16px 0 22px; padding-left: 18px; color: var(--muted); font: 400 16px/1.3 var(--wire-font); }
.handoff-actions { display: flex; gap: 9px; }
.handoff-actions button:first-child { background: #fff; color: var(--accent); }
.tweaks-panel { position: fixed; z-index: 21; right: 18px; bottom: 18px; width: min(344px, calc(100vw - 36px)); border: 1px solid rgba(38,35,30,.14); border-radius: 8px; background: rgba(255,254,252,.94); padding: 16px; box-shadow: 0 22px 58px rgba(40,36,30,.18); backdrop-filter: blur(18px); cursor: default; }
.tweaks-panel[hidden] { display: none; }
.tweaks-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.tweaks-head strong { font-size: 16px; }
.tweaks-head button { width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
.tweaks-head button:hover { background: rgba(52,48,43,.08); color: var(--ink); }
.tweak-group { display: grid; gap: 9px; padding: 11px 0; border-top: 1px solid rgba(61,56,49,.13); }
.tweak-group p { margin: 0; color: var(--muted); font-size: 11px; font-weight: 760; text-transform: uppercase; letter-spacing: 0; }
.segmented { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; border-radius: 8px; background: #eeeae1; padding: 3px; }
.segmented button { min-height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); cursor: pointer; }
.segmented button.is-active { background: #fff; box-shadow: 0 1px 4px rgba(45,40,34,.12); }
.range-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 13px; }
input[type="range"] { width: 100%; accent-color: var(--accent); }
.swatches { display: flex; gap: 9px; }
.swatches button { width: 46px; height: 46px; border: 1px solid rgba(61,56,49,.18); border-radius: 8px; background: var(--swatch); box-shadow: inset 0 0 0 0 #fff; cursor: pointer; }
.swatches button.is-active { box-shadow: inset 0 0 0 3px #fff, 0 0 0 2px var(--accent); }
:root[data-board-density="compact"] { --density-scale: .78; }
:root[data-board-density="roomy"] { --density-scale: 1.18; }
:root[data-board-density="compact"] .frame-caption { -webkit-line-clamp: 1; }
:root[data-board-density="roomy"] .task-list { gap: 17px; }
:root[data-board-density="roomy"] .phone-task { min-height: 58px; }
@media (max-width: 760px) {
  .board-topbar { align-items: flex-start; flex-direction: column; padding: 10px 12px; }
  .board-controls { align-self: flex-end; }
  .tweaks-panel { left: 12px; right: 12px; bottom: 12px; width: auto; }
}
`;

const FIGMA_BOARD_UI_PLAN_JS = `
(() => {
  const root = document.documentElement;
  const world = document.querySelector("[data-board-world]");
  const canvas = document.querySelector("[data-board-canvas]");
  const zoomLabel = document.querySelector("[data-zoom-label]");
  const sketchInput = document.querySelector("[data-sketchiness]");
  const sketchLabel = document.querySelector("[data-sketch-label]");
  const roughMap = document.querySelector("[data-rough-map]");
  let zoom = 0.72;
  const minZoom = 0.42;
  const maxZoom = 1.35;
  const boardWidth = canvas ? canvas.offsetWidth : 2680;
  const boardHeight = canvas ? canvas.offsetHeight : 1800;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function syncRuntimeMarkers() {
    window.dispatchEvent(new Event("resize"));
  }

  function setZoom(nextZoom, clientX, clientY) {
    const x = typeof clientX === "number" ? clientX : window.innerWidth / 2;
    const y = typeof clientY === "number" ? clientY : window.innerHeight / 2;
    const beforeX = (window.scrollX + x) / zoom;
    const beforeY = (window.scrollY + y) / zoom;
    zoom = clamp(nextZoom, minZoom, maxZoom);
    root.style.setProperty("--board-zoom", zoom.toFixed(3));
    if (world) {
      world.style.width = boardWidth * zoom + "px";
      world.style.height = boardHeight * zoom + "px";
    }
    if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + "%";
    window.scrollTo({
      left: Math.max(0, beforeX * zoom - x),
      top: Math.max(0, beforeY * zoom - y),
      behavior: "instant"
    });
    requestAnimationFrame(syncRuntimeMarkers);
  }

  function setSketchiness(value) {
    const next = clamp(Number(value) || 0, 0, 100);
    root.style.setProperty("--sketch", (next / 100).toFixed(2));
    if (roughMap) roughMap.setAttribute("scale", String(Math.round(next / 12)));
    if (sketchLabel) sketchLabel.textContent = Math.round(next) + "%";
  }

  function setAccent(value) {
    const accent = value || "#3f6fd9";
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-soft", hexToRgba(accent, 0.13));
  }

  function hexToRgba(hex, alpha) {
    const raw = String(hex || "").replace("#", "");
    if (raw.length !== 6) return "rgba(63,111,217," + alpha + ")";
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  document.querySelector("[data-zoom-out]")?.addEventListener("click", () => setZoom(zoom - 0.08));
  document.querySelector("[data-zoom-in]")?.addEventListener("click", () => setZoom(zoom + 0.08));
  document.querySelector("[data-zoom-reset]")?.addEventListener("click", () => setZoom(0.72));
  sketchInput?.addEventListener("input", (event) => setSketchiness(event.target.value));

  for (const button of document.querySelectorAll("[data-density-option]")) {
    button.addEventListener("click", () => {
      root.dataset.boardDensity = button.getAttribute("data-density-option") || "regular";
      for (const candidate of document.querySelectorAll("[data-density-option]")) {
        candidate.classList.toggle("is-active", candidate === button);
      }
      requestAnimationFrame(syncRuntimeMarkers);
    });
  }

  for (const button of document.querySelectorAll("[data-accent]")) {
    button.addEventListener("click", () => {
      setAccent(button.getAttribute("data-accent") || "");
      for (const candidate of document.querySelectorAll("[data-accent]")) {
        candidate.classList.toggle("is-active", candidate === button);
      }
    });
  }

  document.querySelector("[data-close-tweaks]")?.addEventListener("click", () => {
    document.querySelector(".tweaks-panel")?.setAttribute("hidden", "true");
  });

  window.addEventListener("wheel", (event) => {
    if (!(event.metaKey || event.ctrlKey || event.altKey)) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setZoom(zoom + direction * 0.06, event.clientX, event.clientY);
  }, { passive: false });

  let panStart = null;
  document.addEventListener("pointerdown", (event) => {
    if (root.classList.contains("an-plan-annotating")) return;
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".board-topbar,.tweaks-panel,.board-frame,.board-card,.board-note,button,input,textarea,a")) return;
    panStart = {
      x: event.clientX,
      y: event.clientY,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
    document.body.classList.add("is-panning");
    event.preventDefault();
  });

  document.addEventListener("pointermove", (event) => {
    if (!panStart) return;
    window.scrollTo({
      left: panStart.scrollX + panStart.x - event.clientX,
      top: panStart.scrollY + panStart.y - event.clientY,
      behavior: "instant"
    });
  });

  document.addEventListener("pointerup", () => {
    panStart = null;
    document.body.classList.remove("is-panning");
  });

  document.addEventListener("pointercancel", () => {
    panStart = null;
    document.body.classList.remove("is-panning");
  });

  setZoom(zoom, 0, 0);
  setSketchiness(sketchInput ? sketchInput.value : 38);
  requestAnimationFrame(() => window.scrollTo({ left: 0, top: 0, behavior: "instant" }));
})();
`;

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
.comment-pop textarea[readonly], .bottom-sheet textarea[readonly], .comment-pop button:disabled, .bottom-sheet button:disabled { pointer-events: none; opacity: .72; cursor: default; }
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
