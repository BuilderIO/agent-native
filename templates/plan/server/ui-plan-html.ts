type UiPlanState = {
  name: string;
  description: string;
};

type UiPlanComponent = {
  name: string;
  description: string;
};

const DEFAULT_BOARD_SKETCHINESS = 38;

export type BuildUiPlanHtmlInput = {
  title: string;
  brief: string;
  source?: string;
  repoPath?: string | null;
  states?: UiPlanState[];
  components?: UiPlanComponent[];
  implementationNotes?: string;
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
  const title = escapeHtml(input.title || "UI Plan");
  const brief = escapeHtml(
    input.brief || "Review the UI direction before code.",
  );
  const source = escapeHtml(input.source || "agent");
  const repoPath = input.repoPath ? escapeHtml(input.repoPath) : "";
  const states = cleanStates(input.states);
  const components = cleanComponents(input.components);
  const hasTopCanvas = states.length > 0 || components.length > 0;
  const implementationNotes = escapeHtml(
    input.implementationNotes ||
      "Keep code detail close to the design decisions: files, state ownership, actions, accessibility checks, and the smallest snippets needed to make the implementation shape obvious.",
  );
  const sketchiness = clampSketchiness(input.sketchiness);

  return `<!doctype html>
<html lang="en" data-plan-theme="notion-document" style="--board-zoom:.68; --sketch:${(sketchiness / 100).toFixed(2)}; --accent:#2f6fed; --accent-soft:rgba(47,111,237,.1);">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${UI_PLAN_CSS}</style>
</head>
<body data-ui-plan-mode="hybrid-document"${hasTopCanvas ? ' data-has-top-canvas="true"' : ""}>
  <svg class="rough-defs" aria-hidden="true" focusable="false">
    <filter id="ui-plan-roughen">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="8" result="noise" />
      <feDisplacementMap data-rough-map in="SourceGraphic" in2="noise" scale="${Math.round(sketchiness / 12)}" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>

  ${hasTopCanvas ? renderTopVisualCanvas({ title, brief, source, repoPath, states, components, sketchiness }) : ""}

  <main class="notion-plan">
    <header class="doc-cover" data-plan-section-id="ui-plan-brief">
      <p class="doc-kicker">UI plan</p>
      <h1>${title}</h1>
      <p class="doc-lede">${brief}</p>
      <div class="doc-meta">
        <span>${source}</span>
        ${repoPath ? `<span>${repoPath}</span>` : ""}
        <span>${hasTopCanvas ? "Wireframes + document" : "Document only"}</span>
      </div>
    </header>

    <section class="doc-block" data-plan-section-id="ui-plan-focus">
      <h2>What Matters Most</h2>
      <p>The plan should be read like an interactive product spec: scan the flow first, then use the rich document blocks below to inspect states, edge cases, implementation seams, and feedback prompts.</p>
      ${
        states.length > 0
          ? `<ol class="doc-list">${states
              .slice(0, 5)
              .map(
                (state) =>
                  `<li><strong>${escapeHtml(state.name)}</strong><span>${escapeHtml(state.description)}</span></li>`,
              )
              .join("")}</ol>`
          : `<p class="doc-note">No dedicated top wireframes were supplied, so this plan stays in document mode and keeps the review surface lightweight.</p>`
      }
    </section>

    ${states.length > 0 ? renderDocumentStateTabs(states) : ""}
    ${states.length > 1 ? renderDocumentFlowDiagram(states) : ""}
    ${components.length > 0 ? renderDocumentComponentTabs(components) : ""}
    ${renderDocumentImplementationFrame(implementationNotes)}
    ${renderDocumentReviewBlock(states, components)}
  </main>

  <script>${UI_PLAN_JS}</script>
</body>
</html>`;
}

function renderTopVisualCanvas(input: {
  title: string;
  brief: string;
  source: string;
  repoPath: string;
  states: UiPlanState[];
  components: UiPlanComponent[];
  sketchiness: number;
}) {
  const board = buildTopCanvasLayout(input.states, input.components);
  return `<section class="top-canvas-section" data-plan-section-id="ui-flow-canvas" data-plan-visual data-label="UI flow canvas">
    <div class="canvas-toolbar">
      <div>
        <p class="doc-kicker">Wireframe canvas</p>
        <strong>${input.title}</strong>
      </div>
      <div class="canvas-controls" aria-label="Canvas controls">
        <button type="button" data-zoom-out aria-label="Zoom out">-</button>
        <button type="button" data-zoom-reset><span data-zoom-label>68%</span></button>
        <button type="button" data-zoom-in aria-label="Zoom in">+</button>
      </div>
    </div>
    <div class="canvas-viewport" data-board-viewport aria-label="${input.title} pan and zoom wireframe canvas">
      <div class="board-canvas" data-board-canvas style="width:${board.width}px;height:${board.height}px;">
        <section class="board-note intro-note" style="${frameStyle(72, 72, 510, 246)}" data-plan-visual data-label="Plan brief">
          <p class="eyebrow">Flow brief</p>
          <h2>${input.title}</h2>
          <p>${input.brief}</p>
          <div class="note-meta">
            <span>${input.source}</span>
            ${input.repoPath ? `<span>${input.repoPath}</span>` : ""}
          </div>
        </section>

        ${
          input.states.length > 0
            ? `<div class="board-group-label" style="${frameStyle(72, 350, 520, 42)}">A - UI flow wireframes</div>
              ${renderBoardFlowConnectors(input.states)}
              ${input.states.map((state, index) => renderBoardStateFrame(state, index)).join("")}`
            : ""
        }

        ${
          input.components.length > 0
            ? `<div class="board-group-label" style="${frameStyle(72, board.componentY - 58, 430, 42)}">B - Interaction notes</div>
              ${input.components.map((component, index) => renderBoardComponentFrame(component, index, board)).join("")}`
            : ""
        }

        ${renderTopCanvasHelperNotes(board, input.sketchiness)}
      </div>
    </div>
  </section>`;
}

function buildTopCanvasLayout(
  states: UiPlanState[],
  components: UiPlanComponent[],
) {
  const secondaryCount = Math.max(0, states.length - 1);
  const stateRows = Math.max(1, Math.ceil(secondaryCount / 4));
  const componentRows =
    components.length > 0 ? Math.ceil(components.length / 4) : 0;
  const componentY = states.length > 0 ? 1040 + (stateRows - 1) * 610 : 390;
  return {
    width: 2500,
    height: componentY + Math.max(1, componentRows) * 330 + 230,
    componentY,
    implementationY: componentY + Math.max(1, componentRows) * 330 + 92,
  };
}

function renderTopCanvasHelperNotes(
  board: ReturnType<typeof buildTopCanvasLayout>,
  sketchiness: number,
) {
  return `<aside class="canvas-helper-note" style="${frameStyle(1780, 86, 390, 220)}">
    <strong>Read this like a Figma handoff.</strong>
    <ul>
      <li>Pan and zoom to compare frames.</li>
      <li>Use comments on any labeled artboard.</li>
      <li>Scroll below for the document spec.</li>
    </ul>
    <span>Sketchiness ${sketchiness}%</span>
  </aside>
  <aside class="canvas-helper-note muted" style="${frameStyle(1720, board.height - 320, 420, 210)}">
    <strong>Document continues below</strong>
    <p>The canvas is only the visual preface. State tabs, diagrams, code tabs, and implementation notes live in the refined document section.</p>
  </aside>`;
}

function renderDocumentStateTabs(states: UiPlanState[]) {
  return `<section class="doc-block" data-plan-section-id="ui-state-tabs">
    <h2>Screen States</h2>
    <p>Use these tabs to review each state without turning the plan into a long wall of repeated mockups.</p>
    <div class="visual-tabs doc-state-tabs" data-plan-tabs>
      <div class="tab-list" role="tablist" aria-label="UI state tabs">
        ${states
          .map((state, index) => {
            const id = docTabId("state", state.name, index);
            return `<button type="button" class="tab-button${index === 0 ? " is-active" : ""}" data-tab-target="${id}">${escapeHtml(state.name)}</button>`;
          })
          .join("")}
      </div>
      ${states
        .map((state, index) => {
          const id = docTabId("state", state.name, index);
          return `<article class="tab-panel${index === 0 ? " is-active" : ""}" data-tab-panel="${id}">
            <div class="state-spec">
              ${renderInlineWireframe(state, index)}
              <div class="state-notes">
                <p class="doc-kicker">State</p>
                <h3>${escapeHtml(state.name)}</h3>
                <p>${escapeHtml(state.description)}</p>
                <details open>
                  <summary>Review checklist</summary>
                  <ul>
                    <li>Primary action and empty/error copy are visible.</li>
                    <li>Comment anchors can attach to the important UI region.</li>
                    <li>Mobile behavior is either shown or explicitly called out.</li>
                  </ul>
                </details>
              </div>
            </div>
          </article>`;
        })
        .join("")}
    </div>
  </section>`;
}

function renderInlineWireframe(state: UiPlanState, index: number) {
  const isMobile = state.name.toLowerCase().includes("mobile");
  return `<div class="inline-wireframe ${isMobile ? "is-mobile" : ""}" data-plan-visual data-label="${escapeHtml(state.name)} inline wireframe">
    <div class="wireframe-top"><span></span><span></span><span></span><strong>${escapeHtml(state.name)}</strong></div>
    <div class="wireframe-body">
      <aside><i class="active"></i><i></i><i></i><i></i></aside>
      <main>
        <b></b>
        <p></p>
        <p class="short"></p>
        <div class="wireframe-grid">
          ${[0, 1, 2, 3].map((item) => `<span class="${(item + index) % 3 === 0 ? "accent" : ""}"></span>`).join("")}
        </div>
      </main>
    </div>
  </div>`;
}

function renderDocumentFlowDiagram(states: UiPlanState[]) {
  return `<section class="doc-block" data-plan-section-id="ui-flow-diagram">
    <h2>Flow Diagram</h2>
    <p>A lightweight sketch diagram keeps the sequence visible after the top canvas has scrolled away.</p>
    <div class="sketch-flow-diagram" data-plan-visual data-label="UI flow diagram">
      ${states
        .slice(0, 5)
        .map(
          (state, index) => `<div class="diagram-step">
            <div class="diagram-node"><span>${index + 1}</span><strong>${escapeHtml(state.name)}</strong></div>
            ${index < Math.min(states.length, 5) - 1 ? '<div class="diagram-arrow">-></div>' : ""}
          </div>`,
        )
        .join("")}
    </div>
  </section>`;
}

function renderDocumentComponentTabs(components: UiPlanComponent[]) {
  return `<section class="doc-block" data-plan-section-id="ui-component-tabs">
    <h2>Interaction Details</h2>
    <p>Component notes stay close to a small sketch and focused constraints instead of becoming separate mini specs.</p>
    <div class="visual-tabs doc-component-tabs" data-plan-tabs>
      <div class="tab-list" role="tablist" aria-label="Component detail tabs">
        ${components
          .map((component, index) => {
            const id = docTabId("component", component.name, index);
            return `<button type="button" class="tab-button${index === 0 ? " is-active" : ""}" data-tab-target="${id}">${escapeHtml(component.name)}</button>`;
          })
          .join("")}
      </div>
      ${components
        .map((component, index) => {
          const id = docTabId("component", component.name, index);
          return `<article class="tab-panel${index === 0 ? " is-active" : ""}" data-tab-panel="${id}">
            <div class="component-spec">
              <div class="component-copy">
                <p class="doc-kicker">Component</p>
                <h3>${escapeHtml(component.name)}</h3>
                <p>${escapeHtml(component.description)}</p>
              </div>
              <div class="component-mini-spec" data-plan-visual data-label="${escapeHtml(component.name)} component sketch">
                <span></span><span></span><button type="button">Action</button><i></i><i></i>
              </div>
            </div>
          </article>`;
        })
        .join("")}
    </div>
  </section>`;
}

function renderDocumentImplementationFrame(implementationNotes: string) {
  return `<section class="doc-block" data-plan-section-id="ui-implementation-map">
    <h2>Implementation Map</h2>
    <p>${implementationNotes}</p>
    <div class="file-map-preview" data-plan-tabs>
      <div class="file-list" role="tablist" aria-label="Implementation tabs">
        <button class="file-tab is-active" type="button" data-tab-target="ui-file-plan-page"><strong>PlansPage.tsx</strong><span>Reader chrome, runtime, comments</span></button>
        <button class="file-tab" type="button" data-tab-target="ui-file-create-action"><strong>create-ui-plan.ts</strong><span>Action contract and payload</span></button>
        <button class="file-tab" type="button" data-tab-target="ui-file-skill"><strong>ui-plan/SKILL.md</strong><span>Generation rules for agents</span></button>
      </div>
      <div class="file-panels">
        <article class="file-detail tab-panel is-active" data-tab-panel="ui-file-plan-page">
          <h3>Document review surface</h3>
          <p>Keep the reader quiet: comment/drawing tools float outside the document, while rich tabs and diagrams stay inside the HTML plan.</p>
          <pre><code><span class="syntax-keyword">const</span> planShape = {
  topCanvas: <span class="syntax-string">"when states or components exist"</span>,
  document: <span class="syntax-string">"notion-like rich spec"</span>,
};</code></pre>
        </article>
        <article class="file-detail tab-panel" data-tab-panel="ui-file-create-action">
          <h3>Create UI plan action</h3>
          <p>The action no longer needs a board boolean. Visual data creates the top canvas automatically; otherwise the generated plan remains document-only.</p>
          <pre><code><span class="syntax-keyword">buildUiPlanHtml</span>({
  title,
  brief,
  states,
  components,
  sketchiness,
});</code></pre>
        </article>
        <article class="file-detail tab-panel" data-tab-panel="ui-file-skill">
          <h3>/ui-plan skill</h3>
          <p>Agents should generate UI flow states when a visual review is useful, then use the document blocks for decisions, diagrams, tables, risks, and code handoff.</p>
          <pre><code>/ui-plan
- top canvas for key flows
- notion-style document below
- skip canvas when visuals add no value</code></pre>
        </article>
      </div>
    </div>
  </section>`;
}

function renderDocumentReviewBlock(
  states: UiPlanState[],
  components: UiPlanComponent[],
) {
  return `<section class="doc-block" data-plan-section-id="ui-review-prompts">
    <h2>Review Prompts</h2>
    <table class="doc-table">
      <thead><tr><th>Area</th><th>Ask</th><th>Evidence</th></tr></thead>
      <tbody>
        <tr><td>Flow</td><td>Does the sequence make sense at a bird's-eye view?</td><td>${states.length || "No"} state${states.length === 1 ? "" : "s"}</td></tr>
        <tr><td>Interaction</td><td>Are the important controls close to the thing they affect?</td><td>${components.length || "No"} component note${components.length === 1 ? "" : "s"}</td></tr>
        <tr><td>Handoff</td><td>Can the agent read comments and implement without guessing?</td><td>Anchors, code tabs, and checklist</td></tr>
      </tbody>
    </table>
  </section>`;
}

function docTabId(prefix: string, label: string, index: number) {
  return `${prefix}-${tabId(label, index)}`;
}

function clampSketchiness(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BOARD_SKETCHINESS;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
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
    <div class="annotation-note">Flow ${index + 1}: ${label}</div>
    <p class="frame-caption">${description}</p>
  </article>`;
}

function renderBoardFlowConnectors(states: UiPlanState[]) {
  if (states.length < 2) return "";
  return states
    .slice(1)
    .map((_, index) => {
      const from = stateFrameLayout(index);
      const to = stateFrameLayout(index + 1);
      const startX = from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = to.x;
      const endY = to.y + to.height / 2;
      const left = Math.min(startX, endX) - 26;
      const top = Math.min(startY, endY) - 42;
      const width = Math.abs(endX - startX) + 52;
      const height = Math.abs(endY - startY) + 84;
      const localStartX = startX - left;
      const localStartY = startY - top;
      const localEndX = endX - left;
      const localEndY = endY - top;
      const c1x = localStartX + Math.max(80, width * 0.28);
      const c2x = localEndX - Math.max(80, width * 0.28);
      return `<div class="flow-connector" style="${frameStyle(left, top, width, height)}" aria-hidden="true">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          <path d="M ${localStartX} ${localStartY} C ${c1x} ${localStartY}, ${c2x} ${localEndY}, ${localEndX} ${localEndY}" />
        </svg>
        <span style="left:${Math.max(20, width / 2 - 34)}px;top:${Math.max(12, height / 2 - 13)}px;">Step ${index + 1}</span>
      </div>`;
    })
    .join("");
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
  board: { componentY: number },
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

function normalizeStates(states: UiPlanState[] | undefined) {
  const cleaned = cleanStates(states);
  return cleaned.length > 0 ? cleaned.slice(0, 8) : DEFAULT_STATES;
}

function normalizeComponents(components: UiPlanComponent[] | undefined) {
  const cleaned = cleanComponents(components);
  return cleaned.length > 0 ? cleaned.slice(0, 8) : DEFAULT_COMPONENTS;
}

function cleanStates(states: UiPlanState[] | undefined) {
  return (states || [])
    .map((state) => ({
      name: state.name?.trim(),
      description: state.description?.trim(),
    }))
    .filter(hasNameAndDescription)
    .slice(0, 8);
}

function cleanComponents(components: UiPlanComponent[] | undefined) {
  return (components || [])
    .map((component) => ({
      name: component.name?.trim(),
      description: component.description?.trim(),
    }))
    .filter(hasNameAndDescription)
    .slice(0, 8);
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const UI_PLAN_JS = `
(() => {
  function activateTab(tabset, target, focus) {
    const buttons = Array.from(tabset.querySelectorAll("[data-tab-target]"));
    const panels = Array.from(tabset.querySelectorAll("[data-tab-panel]"));
    for (const button of buttons) {
      const active = button.getAttribute("data-tab-target") === target;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.setAttribute("tabindex", active ? "0" : "-1");
      if (active && focus) button.focus();
    }
    for (const panel of panels) {
      panel.classList.toggle("is-active", panel.getAttribute("data-tab-panel") === target);
    }
    window.dispatchEvent(new Event("resize"));
  }

  for (const tabset of document.querySelectorAll("[data-plan-tabs]")) {
    const buttons = Array.from(tabset.querySelectorAll("[data-tab-target]"));
    if (buttons.length === 0) continue;
    for (const button of buttons) {
      button.addEventListener("click", () => activateTab(tabset, button.getAttribute("data-tab-target") || "", true));
    }
    activateTab(tabset, buttons.find((button) => button.classList.contains("is-active"))?.getAttribute("data-tab-target") || buttons[0].getAttribute("data-tab-target") || "", false);
  }

  const root = document.documentElement;
  const viewport = document.querySelector("[data-board-viewport]");
  const canvas = document.querySelector("[data-board-canvas]");
  const zoomLabel = document.querySelector("[data-zoom-label]");
  const roughMap = document.querySelector("[data-rough-map]");
  if (!viewport || !canvas) return;

  let zoom = 0.68;
  let panX = 34;
  let panY = 28;
  let panStart = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function applyCanvasTransform() {
    canvas.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")";
    root.style.setProperty("--board-zoom", zoom.toFixed(3));
    if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + "%";
    if (roughMap) roughMap.setAttribute("scale", String(Math.round((Number.parseFloat(root.style.getPropertyValue("--sketch")) || 0.38) * 100 / 12)));
    window.dispatchEvent(new Event("resize"));
  }

  function setZoom(nextZoom, clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const x = typeof clientX === "number" ? clientX - rect.left : rect.width / 2;
    const y = typeof clientY === "number" ? clientY - rect.top : rect.height / 2;
    const beforeX = (x - panX) / zoom;
    const beforeY = (y - panY) / zoom;
    zoom = clamp(nextZoom, 0.36, 1.35);
    panX = x - beforeX * zoom;
    panY = y - beforeY * zoom;
    applyCanvasTransform();
  }

  document.querySelector("[data-zoom-out]")?.addEventListener("click", () => setZoom(zoom - 0.08));
  document.querySelector("[data-zoom-in]")?.addEventListener("click", () => setZoom(zoom + 0.08));
  document.querySelector("[data-zoom-reset]")?.addEventListener("click", () => {
    zoom = 0.68;
    panX = 34;
    panY = 28;
    applyCanvasTransform();
  });

  viewport.addEventListener("wheel", (event) => {
    if (!(event.metaKey || event.ctrlKey || event.altKey)) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY > 0 ? -0.06 : 0.06), event.clientX, event.clientY);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    if (root.classList.contains("an-plan-annotating")) return;
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".canvas-toolbar,.board-frame,.board-card,.board-note,.canvas-helper-note,button,input,textarea,a,details,summary")) return;
    panStart = { x: event.clientX, y: event.clientY, panX, panY };
    viewport.classList.add("is-panning");
    event.preventDefault();
  });

  document.addEventListener("pointermove", (event) => {
    if (!panStart) return;
    panX = panStart.panX + event.clientX - panStart.x;
    panY = panStart.panY + event.clientY - panStart.y;
    applyCanvasTransform();
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    document.addEventListener(eventName, () => {
      panStart = null;
      viewport.classList.remove("is-panning");
    });
  }

  applyCanvasTransform();
})();
`;

const UI_PLAN_CSS = `
:root { color-scheme: light; --bg: #fbfaf7; --paper: #fffefa; --paper-soft: #f5f3ee; --ink: #23201d; --soft: #4b4640; --muted: #817970; --line: rgba(36,31,26,.13); --line-strong: rgba(36,31,26,.24); --canvas: #e9edf1; --sketch-line: #cfd5dc; --accent: #2f6fed; --accent-soft: rgba(47,111,237,.1); --warning: #fff4bf; --wire-font: "Comic Sans MS", "Bradley Hand", "Marker Felt", cursive; --doc-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --mono-font: "SFMono-Regular", Consolas, "Liberation Mono", monospace; --shadow-soft: 0 18px 56px rgba(38,32,24,.1); --density-scale: 1; }
* { box-sizing: border-box; }
html { background: var(--bg); scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--doc-font); line-height: 1.62; }
button, input, textarea { font: inherit; }
.rough-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.top-canvas-section { position: relative; min-height: min(720px, 78vh); border-bottom: 1px solid var(--line); background: var(--canvas); overflow: hidden; }
.top-canvas-section::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(44,48,54,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(44,48,54,.055) 1px, transparent 1px); background-size: 44px 44px; pointer-events: none; }
.canvas-toolbar { position: sticky; z-index: 10; top: 0; display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid rgba(35,32,29,.1); background: rgba(251,250,247,.84); padding: 10px 22px; backdrop-filter: blur(14px); }
.canvas-toolbar > div:first-child { min-width: 0; }
.canvas-toolbar strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.canvas-controls { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.72); padding: 3px; }
.canvas-controls button { min-width: 34px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); padding: 0 10px; font-weight: 760; cursor: pointer; }
.canvas-controls button:hover { background: rgba(35,32,29,.07); }
.canvas-viewport { position: absolute; inset: 58px 0 0; overflow: hidden; cursor: grab; touch-action: none; }
.canvas-viewport.is-panning { cursor: grabbing; user-select: none; }
.board-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.board-note, .board-frame, .board-card, .board-group-label, .flow-connector, .canvas-helper-note { position: absolute; }
.board-note, .board-frame, .board-card, .canvas-helper-note { z-index: 2; color: var(--ink); cursor: default; }
.board-group-label { z-index: 2; display: flex; align-items: center; color: var(--ink); font: 400 28px/1 var(--wire-font); }
.board-group-label::before { content: ""; width: 18px; height: 18px; margin-right: 10px; border: 1.5px dashed var(--accent); border-radius: 5px; background: var(--accent-soft); }
.intro-note, .board-frame, .board-card, .canvas-helper-note { border: 1.7px solid rgba(43,39,34,.62); border-radius: 8px; background: rgba(255,254,250,.92); box-shadow: var(--shadow-soft); }
.intro-note { display: flex; flex-direction: column; justify-content: space-between; padding: 22px 24px; }
.intro-note::after, .board-frame::after, .board-card::after { content: ""; position: absolute; inset: calc(var(--sketch) * -3px); border: calc(1px + var(--sketch) * 1.35px) solid rgba(48,43,37,.25); border-radius: inherit; opacity: calc(var(--sketch) * .7); transform: translate(calc(var(--sketch) * 2px), calc(var(--sketch) * -1px)) rotate(calc(var(--sketch) * .26deg)); pointer-events: none; }
.eyebrow { margin: 0 0 10px; color: var(--muted); font: 750 11px/1.2 var(--doc-font); text-transform: uppercase; letter-spacing: 0; }
h1, h2, h3, p { margin-top: 0; }
.intro-note h2 { margin: 0 0 12px; font: 400 34px/1.08 var(--wire-font); letter-spacing: 0; }
.intro-note p, .board-card p, .frame-caption { color: var(--muted); font-size: 15px; }
.note-meta { display: flex; flex-wrap: wrap; gap: 7px; }
.note-meta span { max-width: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: 999px; background: var(--paper-soft); padding: 5px 9px; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.flow-connector { z-index: 1; pointer-events: none; }
.flow-connector svg { position: absolute; inset: 0; overflow: visible; }
.flow-connector path { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 8 8; opacity: .66; filter: url(#ui-plan-roughen); }
.flow-connector span { position: absolute; display: inline-flex; min-height: 26px; align-items: center; border: 1px solid var(--accent); border-radius: 999px; background: #fff; color: var(--accent); padding: 0 9px; font: 400 12px/1 var(--wire-font); box-shadow: 0 8px 18px rgba(40,36,30,.1); }
.frame-label { position: absolute; left: 0; right: 0; top: -32px; display: flex; align-items: center; gap: 9px; color: var(--muted); font: 650 15px/1.1 var(--doc-font); }
.frame-label span { color: rgba(61,56,49,.48); font-weight: 900; letter-spacing: 0; }
.frame-label strong { color: var(--ink); font: 400 20px/1 var(--wire-font); }
.wire-window { position: absolute; inset: 14px 14px 76px; overflow: hidden; border: 1.5px solid rgba(43,39,34,.8); border-radius: 5px; background: #fff; filter: url(#ui-plan-roughen); }
.window-bar { display: flex; height: 28px; align-items: center; gap: 6px; border-bottom: 1.4px solid rgba(43,39,34,.8); padding: 0 9px; }
.window-bar span { width: 7px; height: 7px; border: 1.2px solid rgba(43,39,34,.8); border-radius: 999px; }
.window-bar i { margin-left: 7px; color: var(--muted); font: 400 11px/1 var(--wire-font); font-style: normal; }
.desktop-shell { display: grid; height: calc(100% - 28px); grid-template-columns: 154px 1fr; }
.sketch-sidebar { display: flex; flex-direction: column; gap: 13px; border-right: 1.4px solid rgba(43,39,34,.8); padding: 18px 15px; }
.sketch-sidebar b { margin-bottom: 4px; font: 400 15px/1 var(--wire-font); }
.sketch-sidebar i { display: block; height: calc(27px * var(--density-scale)); border: 1.3px solid rgba(61,56,49,.42); border-radius: 5px; background: #f7f5ed; }
.sketch-sidebar i.is-active { background: var(--accent-soft); border-color: var(--accent); }
.sketch-main { min-width: 0; padding: 22px 24px; }
.screen-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.screen-head h2 { margin-bottom: 4px; font: 400 25px/1.1 var(--wire-font); letter-spacing: 0; }
.screen-head p { max-width: 420px; margin: 0; color: var(--muted); font: 400 14px/1.35 var(--wire-font); }
.screen-head button, .handoff-actions button { min-height: 34px; border: 1.5px solid var(--accent); border-radius: 5px; background: var(--accent); color: #fff; padding: 0 14px; font: 750 13px/1 var(--doc-font); cursor: default; }
.pill-row { display: flex; flex-wrap: wrap; gap: 9px; margin: 20px 0 18px; }
.pill { display: inline-flex; min-height: 26px; align-items: center; border: 1.3px solid rgba(43,39,34,.8); border-radius: 999px; background: #fff; padding: 0 11px; font: 400 13px/1 var(--wire-font); }
.pill.is-active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.task-list { display: grid; gap: calc(12px * var(--density-scale)); }
.task-row { display: grid; min-height: calc(52px * var(--density-scale)); grid-template-columns: 22px 1fr 58px; align-items: center; gap: 12px; border-top: 1.2px solid rgba(61,56,49,.18); }
.check { display: inline-block; width: 15px; height: 15px; border: 1.5px solid rgba(43,39,34,.8); border-radius: 4px; background: #fff; }
.check.checked { background: var(--accent); box-shadow: inset 0 0 0 3px #fff; }
.task-row b, .task-row i, .phone-task b, .phone-task i, .phone-check i, .notes-lines i, .task-title, .input-line, .textarea-line { display: block; border-radius: 999px; background: #d8d1c3; }
.task-row b { width: 54%; height: 10px; margin-bottom: 8px; }
.task-row i { width: 34%; height: 8px; }
.task-row em { justify-self: end; border: 1.2px solid rgba(43,39,34,.8); border-radius: 999px; padding: 3px 7px; color: var(--muted); font: 400 11px/1 var(--wire-font); font-style: normal; }
.task-row em.hot { border-color: #cf5432; color: #cf5432; }
.frame-caption { position: absolute; left: 16px; right: 16px; bottom: 14px; margin: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font: 400 14px/1.25 var(--wire-font); }
.annotation-note { position: absolute; right: -22px; top: 58px; width: 144px; min-height: 62px; border: 1.3px solid rgba(61,56,49,.46); border-radius: 6px; background: var(--warning); padding: 10px; color: #6b5f3f; font: 400 13px/1.2 var(--wire-font); transform: rotate(calc(var(--sketch) * -1.8deg)); box-shadow: 0 12px 24px rgba(43,40,34,.1); }
.phone-frame .annotation-note { right: -38px; width: 132px; }
.phone-frame { padding: 13px; background: #fffdfa; }
.phone-shell { position: absolute; inset: 13px 13px 56px; overflow: hidden; border: 1.5px solid rgba(43,39,34,.8); border-radius: 25px; background: #fff; filter: url(#ui-plan-roughen); }
.phone-status { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 13px; color: var(--muted); font: 650 10px/1 var(--doc-font); }
.phone-status span { flex: 1; }
.phone-status i { width: 12px; height: 4px; border-radius: 99px; background: #8c867e; }
.phone-header { display: grid; height: 40px; grid-template-columns: 54px 1fr 54px; align-items: center; border-bottom: 1.3px solid rgba(43,39,34,.8); padding: 0 9px; text-align: center; }
.phone-header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 14px/1 var(--wire-font); }
.phone-header button { border: 0; background: transparent; color: var(--accent); padding: 0; font: 750 11px/1 var(--doc-font); }
.phone-list, .phone-form, .phone-detail { padding: 17px 14px; }
.phone-list .pill-row { margin-top: 0; gap: 7px; }
.phone-task { display: grid; min-height: calc(48px * var(--density-scale)); grid-template-columns: 18px 1fr 38px; align-items: center; gap: 8px; border-bottom: 1px solid rgba(61,56,49,.16); }
.phone-task b { width: 68%; height: 8px; margin-bottom: 7px; }
.phone-task i { width: 43%; height: 7px; }
.phone-task em { color: var(--muted); font: 400 10px/1 var(--wire-font); font-style: normal; }
.phone-form label { display: block; margin: 13px 0 5px; color: var(--muted); font: 750 9px/1 var(--doc-font); text-transform: uppercase; letter-spacing: 0; }
.input-line { height: 32px; border: 1.2px solid rgba(43,39,34,.8); background: transparent; }
.textarea-line { height: 72px; border: 1.2px solid rgba(43,39,34,.8); border-radius: 5px; background: transparent; }
.chip-grid { display: flex; flex-wrap: wrap; gap: 7px; }
.chip-grid span { border: 1.2px solid rgba(43,39,34,.8); border-radius: 999px; padding: 5px 8px; font: 400 11px/1 var(--wire-font); }
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
.board-card { background: #fff9df; padding: 19px 20px; }
.component-card:nth-of-type(2n) { background: #e8f2e8; }
.component-card:nth-of-type(3n) { background: #e9edf9; }
.component-card h3 { margin: 0 0 10px; font: 400 25px/1.12 var(--wire-font); letter-spacing: 0; }
.component-card p { font: 400 15px/1.35 var(--wire-font); }
.component-mini { position: absolute; left: 20px; right: 20px; bottom: 18px; display: grid; grid-template-columns: 1fr 1fr auto; gap: 9px; align-items: center; }
.component-mini span { height: 26px; border: 1.3px solid rgba(61,56,49,.46); border-radius: 5px; background: rgba(255,255,255,.5); }
.component-mini button { min-height: 28px; border: 1.3px solid var(--accent); border-radius: 5px; background: var(--accent-soft); color: var(--accent); padding: 0 10px; font-weight: 750; }
.canvas-helper-note { padding: 18px 20px; background: rgba(255,254,250,.88); font-family: var(--wire-font); }
.canvas-helper-note strong { display: block; margin-bottom: 10px; font-size: 21px; font-weight: 400; }
.canvas-helper-note ul { display: grid; gap: 5px; margin: 0 0 12px; padding-left: 19px; }
.canvas-helper-note p { margin: 0; color: var(--muted); }
.canvas-helper-note span { color: var(--accent); font-size: 13px; }
.canvas-helper-note.muted { background: #f5f1e7; color: var(--soft); }
.notion-plan { width: min(910px, calc(100vw - 44px)); margin: 0 auto; padding: 88px 0 118px; }
.doc-cover { padding-bottom: 34px; border-bottom: 1px solid var(--line); }
.doc-kicker { margin: 0 0 10px; color: var(--muted); font-size: 12px; font-weight: 760; letter-spacing: 0; text-transform: uppercase; }
.doc-cover h1 { margin: 0 0 20px; font-size: clamp(42px, 6vw, 72px); line-height: .98; letter-spacing: -.035em; }
.doc-lede { max-width: 780px; margin: 0; color: var(--soft); font-size: clamp(19px, 2.4vw, 25px); line-height: 1.48; letter-spacing: -.012em; }
.doc-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.doc-meta span { display: inline-flex; max-width: 100%; min-height: 26px; align-items: center; overflow: hidden; border: 1px solid var(--line); border-radius: 999px; background: var(--paper-soft); color: var(--muted); padding: 0 10px; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.doc-block { padding: 34px 0; border-bottom: 1px solid var(--line); scroll-margin-top: 20px; }
.doc-block h2 { margin: 0 0 12px; font-size: clamp(25px, 3vw, 34px); line-height: 1.14; letter-spacing: -.024em; }
.doc-block h3 { margin: 0 0 10px; font-size: 22px; line-height: 1.2; letter-spacing: -.014em; }
.doc-block > p, .state-notes p, .component-copy p, .file-detail p, .doc-note { color: var(--soft); }
.doc-note { border-left: 3px solid var(--line-strong); margin: 18px 0 0; padding-left: 14px; }
.doc-list { display: grid; gap: 12px; margin: 22px 0 0; padding: 0; list-style: none; counter-reset: doc-list; }
.doc-list li { display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start; counter-increment: doc-list; }
.doc-list li::before { content: counter(doc-list); display: grid; width: 25px; height: 25px; place-items: center; border-radius: 6px; background: var(--paper-soft); color: var(--muted); font-size: 12px; font-weight: 760; }
.doc-list strong { display: block; margin-bottom: 2px; }
.doc-list strong, .doc-list span { grid-column: 2; }
.doc-list span { display: block; color: var(--soft); }
.visual-tabs { display: grid; gap: 18px; margin-top: 20px; }
.tab-list { display: inline-flex; width: fit-content; max-width: 100%; gap: 2px; border-bottom: 1px solid var(--line); overflow-x: auto; }
.tab-button { min-height: 38px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); padding: 0 12px; font-weight: 650; white-space: nowrap; cursor: pointer; }
.tab-button:hover { color: var(--ink); background: rgba(35,32,29,.045); }
.tab-button.is-active { border-color: var(--ink); color: var(--ink); }
.tab-panel { display: none; }
.tab-panel.is-active { display: block; }
.state-spec { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(280px, .92fr); gap: 28px; align-items: start; }
.inline-wireframe { overflow: hidden; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--paper); box-shadow: 0 8px 28px rgba(42,36,28,.06); filter: url(#ui-plan-roughen); }
.inline-wireframe.is-mobile { max-width: 380px; border-radius: 28px; }
.wireframe-top { display: flex; height: 34px; align-items: center; gap: 6px; border-bottom: 1px solid var(--line-strong); padding: 0 10px; }
.wireframe-top span { width: 8px; height: 8px; border: 1px solid var(--line-strong); border-radius: 999px; }
.wireframe-top strong { margin-left: 8px; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; font: 400 13px/1 var(--wire-font); }
.wireframe-body { display: grid; min-height: 330px; grid-template-columns: 92px 1fr; }
.inline-wireframe.is-mobile .wireframe-body { grid-template-columns: 1fr; }
.wireframe-body aside { display: grid; align-content: start; gap: 10px; border-right: 1px solid var(--line-strong); padding: 16px; }
.inline-wireframe.is-mobile aside { display: none; }
.wireframe-body aside i { height: 22px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper-soft); }
.wireframe-body aside i.active { border-color: var(--accent); background: var(--accent-soft); }
.wireframe-body main { padding: 24px; }
.wireframe-body main b, .wireframe-body main p, .wireframe-grid span { display: block; border-radius: 999px; background: #d8d2c7; }
.wireframe-body main b { width: 58%; height: 28px; margin-bottom: 20px; }
.wireframe-body main p { width: 84%; height: 10px; margin-bottom: 11px; }
.wireframe-body main p.short { width: 46%; }
.wireframe-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 26px; }
.wireframe-grid span { height: 86px; border-radius: 7px; border: 1px solid var(--line); background: var(--paper-soft); }
.wireframe-grid span.accent { border-color: var(--accent); background: var(--accent-soft); }
.state-notes { display: grid; gap: 14px; }
details { border-top: 1px solid var(--line); padding-top: 12px; }
summary { color: var(--ink); font-weight: 720; cursor: pointer; }
details ul { margin: 12px 0 0; padding-left: 18px; color: var(--soft); }
.sketch-flow-diagram { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; border: 1px solid var(--line); border-radius: 8px; background: var(--paper-soft); padding: 22px; font-family: var(--wire-font); filter: url(#ui-plan-roughen); }
.diagram-step { display: flex; align-items: center; gap: 14px; }
.diagram-node { min-width: 148px; border: 1.5px solid rgba(43,39,34,.72); border-radius: 8px; background: var(--paper); padding: 12px 14px; }
.diagram-node span { display: inline-grid; width: 22px; height: 22px; place-items: center; margin-right: 8px; border-radius: 999px; background: var(--accent); color: #fff; font-family: var(--doc-font); font-size: 12px; font-weight: 800; }
.diagram-node strong { font-weight: 400; }
.diagram-arrow { color: var(--accent); font-size: 28px; }
.component-spec { display: grid; grid-template-columns: minmax(0, .9fr) minmax(260px, 1.1fr); gap: 28px; align-items: center; }
.component-mini-spec { display: grid; grid-template-columns: 1fr 1fr auto; gap: 11px; align-items: center; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--paper); padding: 20px; min-height: 180px; filter: url(#ui-plan-roughen); }
.component-mini-spec span, .component-mini-spec i { min-height: 30px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper-soft); }
.component-mini-spec button { min-height: 34px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: #fff; padding: 0 14px; font-weight: 760; }
.component-mini-spec i { grid-column: span 3; min-height: 52px; }
.file-map-preview { display: grid; grid-template-columns: minmax(220px, .36fr) minmax(0, 1fr); margin-top: 20px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.file-list { border-right: 1px solid var(--line); }
.file-tab { display: grid; width: 100%; gap: 4px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--muted); padding: 16px 14px; text-align: left; cursor: pointer; }
.file-tab:hover { background: rgba(35,32,29,.045); color: var(--ink); }
.file-tab.is-active { color: var(--ink); box-shadow: inset 3px 0 0 var(--accent); }
.file-tab strong { font: 760 13px/1.25 var(--mono-font); }
.file-tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.file-panels { min-width: 0; }
.file-detail { min-width: 0; padding: 22px 24px; }
pre { margin: 18px 0 0; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: #f6f5f1; padding: 18px 20px; color: #2d2925; font: 13px/1.65 var(--mono-font); }
.syntax-keyword { color: #0b67d2; }
.syntax-string { color: #2f7d45; }
.doc-table { width: 100%; margin-top: 16px; border-collapse: collapse; font-size: 14px; }
.doc-table th, .doc-table td { border-bottom: 1px solid var(--line); padding: 12px 10px; text-align: left; vertical-align: top; }
.doc-table th { color: var(--muted); font-size: 12px; font-weight: 760; text-transform: uppercase; letter-spacing: 0; }
.doc-table td { color: var(--soft); }
.doc-table td:first-child { color: var(--ink); font-weight: 720; }
@media (max-width: 900px) {
  .top-canvas-section { min-height: 620px; }
  .notion-plan { width: min(100vw - 28px, 910px); padding-top: 58px; }
  .state-spec, .component-spec, .file-map-preview { grid-template-columns: 1fr; }
  .file-list { border-right: 0; }
  .doc-cover h1 { font-size: clamp(38px, 10vw, 56px); }
}
@media (max-width: 620px) {
  .canvas-toolbar { align-items: flex-start; flex-direction: column; }
  .canvas-viewport { top: 98px; }
  .wireframe-body { grid-template-columns: 1fr; }
  .wireframe-body aside { display: none; }
  .sketch-flow-diagram { align-items: stretch; flex-direction: column; }
  .diagram-step { align-items: stretch; flex-direction: column; }
  .diagram-arrow { transform: rotate(90deg); width: fit-content; margin-left: 24px; }
}
`;
