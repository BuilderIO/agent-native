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
      "One-field compact comment composer with no category picker or coordinate metadata in the user-facing bubble.",
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
<html lang="en" data-plan-theme="notion-document" style="--board-zoom:.68; --sketch:${(sketchiness / 100).toFixed(2)}; --accent:#2f6fed; --accent-soft:rgba(47,111,237,.1); --grid-size:19px; --grid-offset-x:34px; --grid-offset-y:28px;">
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
    <div class="canvas-controls" aria-label="Canvas controls">
      <button type="button" data-zoom-out aria-label="Zoom out">-</button>
      <span data-zoom-label>68%</span>
      <button type="button" data-zoom-in aria-label="Zoom in">+</button>
    </div>
    <div class="canvas-viewport" data-board-viewport aria-label="${input.title} pan and zoom wireframe canvas">
      <div class="board-canvas" data-board-canvas style="width:${board.width}px;height:${board.height}px;">
        ${
          input.states.length > 0
            ? `${renderBoardFlowConnectors(input.states)}
              ${input.states.map((state, index) => renderBoardStateFrame(state, index)).join("")}`
            : ""
        }

        ${
          input.components.length > 0
            ? `<div class="board-group-label" style="${frameStyle(80, board.componentY - 48, 430, 42)}">Interaction notes</div>
              ${input.components.map((component, index) => renderBoardComponentFrame(component, index, board)).join("")}`
            : ""
        }

        ${renderCanvasAnnotationLayers(input.states, board, input.sketchiness)}
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
  const componentY = states.length > 0 ? 780 + (stateRows - 1) * 570 : 110;
  return {
    width: 2500,
    height: componentY + Math.max(1, componentRows) * 260 + 170,
    componentY,
    implementationY: componentY + Math.max(1, componentRows) * 260 + 92,
  };
}

function renderCanvasAnnotationLayers(
  states: UiPlanState[],
  board: ReturnType<typeof buildTopCanvasLayout>,
  sketchiness: number,
) {
  const primary = states[0];
  const secondary = states[1];
  const lastState =
    states.length > 0 ? stateFrameLayout(states.length - 1) : null;
  const handoffX = lastState
    ? Math.min(board.width - 380, lastState.x + lastState.width + 96)
    : 1760;
  return `<div class="canvas-annotation handoff-note" style="${frameStyle(handoffX, 118, 340, 176)}">
    <h4>Read this like a design handoff.</h4>
    <ul>
      <li>Pan and zoom to compare frames.</li>
      <li>Leave comments directly on artboards.</li>
      <li>Scroll for the doc spec below.</li>
    </ul>
    <p>Sketchiness ${sketchiness}%</p>
  </div>
  ${
    primary
      ? `<div class="canvas-annotation" style="${frameStyle(104, 572, 430, 94)}">
        <h4>${escapeHtml(primary.name)} frame</h4>
        <p>${escapeHtml(primary.description)}</p>
      </div>
      <div class="annotation-arrow" style="${frameStyle(420, 512, 150, 88)}"><svg viewBox="0 0 150 88"><path d="M 6 80 C 52 34, 92 16, 142 8" /><path d="M 126 3 L 142 8 L 132 22" /></svg></div>`
      : ""
  }
  ${
    secondary
      ? `<div class="canvas-annotation" style="${frameStyle(stateFrameLayout(1).x + 16, stateFrameLayout(1).y + stateFrameLayout(1).height + 32, 310, 96)}">
        <h4>Comment path</h4>
        <p>${escapeHtml(secondary.description)}</p>
      </div>`
      : ""
  }
  <div class="canvas-annotation quiet-note" style="${frameStyle(1550, board.height - 210, 430, 118)}">
    <h4>Document continues below</h4>
    <p>Use the lower section for state tabs, diagrams, code tabs, review prompts, and implementation detail.</p>
  </div>`;
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
    return { x: 80, y: 98, width: 780, height: 440, kind: "desktop" };
  }
  const secondary = index - 1;
  return {
    x: 1000 + (secondary % 4) * 430,
    y: 98 + Math.floor(secondary / 4) * 570,
    width: 302,
    height: 500,
    kind: "mobile",
  };
}

function renderBoardStateFrame(state: UiPlanState, index: number) {
  const layout = stateFrameLayout(index);
  const label = escapeHtml(state.name);
  const id = `board-state-${index}`;
  const isDesktop = layout.kind === "desktop";
  const inner = isDesktop
    ? renderBoardDesktopScreen(state, index)
    : renderBoardPhoneScreen(state, index);
  return `<article id="${id}" class="board-frame ${isDesktop ? "desktop-frame" : "phone-frame"}" style="${frameStyle(layout.x, layout.y, layout.width, layout.height)}" data-plan-visual data-label="${label}" aria-label="${label} artboard">
    <div class="frame-label"><strong>${label}</strong></div>
    ${inner}
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
  const y = board.componentY + Math.floor(index / 4) * 260;
  return `<article class="canvas-annotation component-annotation" style="${frameStyle(x, y, 360, 190)}" data-plan-visual data-label="${escapeHtml(component.name)}">
    <h4>${escapeHtml(component.name)}</h4>
    <p>${escapeHtml(component.description)}</p>
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
  let boardLayoutFrame = 0;
  function requestBoardLayoutSync() {
    if (boardLayoutFrame) return;
    boardLayoutFrame = requestAnimationFrame(() => {
      boardLayoutFrame = 0;
      window.dispatchEvent(new Event("agent-native-plan-board-layout-change"));
    });
  }

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
    requestBoardLayoutSync();
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
    root.style.setProperty("--grid-size", (28 * zoom).toFixed(2) + "px");
    root.style.setProperty("--grid-offset-x", panX.toFixed(2) + "px");
    root.style.setProperty("--grid-offset-y", panY.toFixed(2) + "px");
    if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + "%";
    if (roughMap) roughMap.setAttribute("scale", String(Math.round((Number.parseFloat(root.style.getPropertyValue("--sketch")) || 0.38) * 100 / 12)));
    requestBoardLayoutSync();
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

  function panCanvas(deltaX, deltaY) {
    panX -= deltaX;
    panY -= deltaY;
    applyCanvasTransform();
  }

  document.querySelector("[data-zoom-out]")?.addEventListener("click", () => setZoom(zoom - 0.08));
  document.querySelector("[data-zoom-in]")?.addEventListener("click", () => setZoom(zoom + 0.08));
  viewport.addEventListener("wheel", (event) => {
    if (root.classList.contains("an-plan-annotating")) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey || event.altKey) {
      const zoomStep = Math.min(0.04, Math.abs(event.deltaY) * 0.0045) * (event.deltaY > 0 ? -1 : 1);
      setZoom(zoom + zoomStep, event.clientX, event.clientY);
      return;
    }
    const horizontal = event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)
      ? event.deltaY
      : event.deltaX;
    const vertical = event.shiftKey ? event.deltaX : event.deltaY;
    panCanvas(horizontal, vertical);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    if (root.classList.contains("an-plan-annotating")) return;
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".canvas-controls,.board-frame,.board-card,.board-note,.canvas-helper-note,.canvas-annotation,.annotation-arrow,button,input,textarea,a,details,summary")) return;
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
@font-face { font-family: "Excalifont"; src: url("/fonts/Excalifont-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
:root { color-scheme: light; --bg: #faf9f7; --paper: #ffffff; --paper-soft: #f3f2ef; --ink: #18181b; --soft: #44403c; --muted: #78716c; --line: rgba(28,25,23,.13); --line-strong: rgba(28,25,23,.25); --canvas: #f3f2ef; --grid-line: rgba(28,25,23,.04); --accent: #2f6fed; --accent-soft: rgba(47,111,237,.1); --warning: #fff4bf; --note-ink: #4d4219; --wire-surface: #ffffff; --wire-soft: #f4f4f5; --wire-mark: #d4d4d8; --wire-rule: rgba(63,63,70,.18); --wire-frame-bg: #ffffff; --wire-line: rgba(39,39,42,.8); --wire-line-soft: rgba(39,39,42,.28); --wire-dot: #71717a; --board-shell: rgba(255,255,255,.94); --board-card-bg: #fff9dc; --board-card-bg-2: #e9f4ec; --board-card-bg-3: #edf1fb; --diagram-bg: #f3f2ef; --diagram-node-bg: #ffffff; --code-bg: #f5f5f6; --code-ink: #27272a; --syntax-keyword: #0b67d2; --syntax-string: #287d43; --tab-hover: rgba(28,25,23,.055); --wire-font: "Excalifont", "Comic Sans MS", "Bradley Hand", "Marker Felt", cursive; --doc-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --mono-font: "SFMono-Regular", Consolas, "Liberation Mono", monospace; --shadow-soft: 0 18px 56px rgba(24,24,27,.1); --density-scale: 1; }
:root[data-agent-native-theme="dark"] { color-scheme: dark; --bg: #1f1e1d; --paper: #242423; --paper-soft: #2b2a2a; --ink: #f4f4f2; --soft: #d8d6d2; --muted: #aaa8a4; --line: rgba(244,244,242,.14); --line-strong: rgba(244,244,242,.26); --canvas: #1d1c1b; --grid-line: rgba(244,244,242,.024); --accent: #78a7ff; --accent-soft: rgba(120,167,255,.17); --warning: #3a3216; --note-ink: #ede7c7; --wire-surface: #202020; --wire-soft: #2a2a2a; --wire-mark: #686868; --wire-rule: rgba(244,244,242,.14); --wire-frame-bg: #202020; --wire-line: rgba(244,244,242,.78); --wire-line-soft: rgba(244,244,242,.26); --wire-dot: #aaa8a4; --board-shell: rgba(36,36,35,.95); --board-card-bg: #2a2929; --board-card-bg-2: #282828; --board-card-bg-3: #292a2e; --diagram-bg: #242423; --diagram-node-bg: #202020; --code-bg: #181817; --code-ink: #e7e5e1; --syntax-keyword: #7ab8ff; --syntax-string: #9ee6a3; --tab-hover: rgba(244,244,242,.08); --shadow-soft: 0 18px 56px rgba(0,0,0,.24); }
* { box-sizing: border-box; }
html { background: var(--bg); scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--doc-font); line-height: 1.62; }
button, input, textarea { font: inherit; }
.rough-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.top-canvas-section { position: relative; height: 65vh; border-bottom: 1px solid var(--line); background: var(--canvas); overflow: hidden; }
.canvas-controls { position: absolute; z-index: 10; left: 12px; bottom: 12px; display: inline-flex; align-items: center; gap: 1px; border: 1px solid var(--line); border-radius: 7px; background: color-mix(in srgb, var(--paper) 84%, transparent); padding: 2px; box-shadow: 0 10px 28px rgba(0,0,0,.18); backdrop-filter: blur(14px); }
.canvas-controls button { min-width: 26px; height: 24px; border: 0; border-radius: 5px; background: transparent; color: var(--ink); padding: 0 7px; font-size: 12px; font-weight: 760; cursor: pointer; }
.canvas-controls button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
.canvas-viewport { position: absolute; inset: 0; overflow: hidden; cursor: grab; touch-action: none; background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px); background-size: var(--grid-size) var(--grid-size); background-position: var(--grid-offset-x) var(--grid-offset-y); }
.canvas-viewport.is-panning { cursor: grabbing; user-select: none; }
.board-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.board-note, .board-frame, .board-card, .board-group-label, .flow-connector, .canvas-helper-note, .canvas-annotation, .annotation-arrow { position: absolute; }
.board-note, .board-frame, .board-card, .canvas-helper-note, .canvas-annotation { z-index: 2; color: var(--ink); cursor: default; }
.board-group-label { z-index: 2; display: flex; align-items: center; color: var(--ink); font: 760 18px/1 var(--doc-font); }
.board-group-label::before { display: none; }
.intro-note, .board-card, .canvas-helper-note { border: 1.7px solid var(--wire-line); border-radius: 8px; background: var(--board-shell); box-shadow: var(--shadow-soft); }
.intro-note { display: flex; flex-direction: column; justify-content: space-between; padding: 22px 24px; }
.intro-note::after, .board-card::after { content: ""; position: absolute; inset: calc(var(--sketch) * -3px); border: calc(1px + var(--sketch) * 1.35px) solid var(--wire-line-soft); border-radius: inherit; opacity: calc(var(--sketch) * .7); transform: translate(calc(var(--sketch) * 2px), calc(var(--sketch) * -1px)) rotate(calc(var(--sketch) * .26deg)); pointer-events: none; }
.eyebrow { margin: 0 0 10px; color: var(--muted); font: 750 11px/1.2 var(--doc-font); text-transform: uppercase; letter-spacing: 0; }
h1, h2, h3, p { margin-top: 0; }
.intro-note h2 { margin: 0 0 12px; font: 760 30px/1.08 var(--doc-font); letter-spacing: 0; }
.intro-note p, .board-card p, .frame-caption { color: var(--muted); font-size: 15px; }
.note-meta { display: flex; flex-wrap: wrap; gap: 7px; }
.note-meta span { max-width: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: 999px; background: var(--paper-soft); padding: 5px 9px; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.flow-connector { z-index: 1; pointer-events: none; }
.flow-connector svg { position: absolute; inset: 0; overflow: visible; }
.flow-connector path { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 8 8; opacity: .66; filter: url(#ui-plan-roughen); }
.flow-connector span { position: absolute; display: inline-flex; min-height: 26px; align-items: center; border: 1px solid var(--accent); border-radius: 999px; background: var(--paper); color: var(--accent); padding: 0 9px; font: 760 12px/1 var(--doc-font); }
.frame-label { position: absolute; left: 0; right: 0; top: -26px; display: flex; align-items: center; color: var(--muted); font: 650 15px/1.1 var(--doc-font); }
.frame-label span { display: none; }
.frame-label strong { color: var(--ink); font: 760 15px/1 var(--doc-font); }
.wire-window { position: absolute; inset: 0; overflow: hidden; border: 1.5px solid var(--wire-line); border-radius: 5px; background: var(--wire-surface); color: var(--ink); filter: url(#ui-plan-roughen); box-shadow: none; }
.window-bar { display: flex; height: 28px; align-items: center; gap: 6px; border-bottom: 1.4px solid var(--wire-line); padding: 0 9px; }
.window-bar span { width: 7px; height: 7px; border: 1.2px solid var(--wire-line); border-radius: 999px; }
.window-bar i { margin-left: 7px; color: var(--muted); font: 400 11px/1 var(--wire-font); font-style: normal; }
.desktop-shell { display: grid; height: calc(100% - 28px); grid-template-columns: 154px 1fr; }
.sketch-sidebar { display: flex; flex-direction: column; gap: 13px; border-right: 1.4px solid var(--wire-line); padding: 18px 15px; }
.sketch-sidebar b { margin-bottom: 4px; font: 400 15px/1 var(--wire-font); }
.sketch-sidebar i { display: block; height: calc(27px * var(--density-scale)); border: 1.3px solid var(--wire-line-soft); border-radius: 5px; background: var(--wire-soft); }
.sketch-sidebar i.is-active { background: var(--accent-soft); border-color: var(--accent); }
.sketch-main { min-width: 0; padding: 22px 24px; }
.screen-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.screen-head h2 { margin-bottom: 4px; font: 400 25px/1.1 var(--wire-font); letter-spacing: 0; }
.screen-head p { max-width: 420px; margin: 0; color: var(--muted); font: 400 14px/1.35 var(--wire-font); }
.screen-head button, .handoff-actions button { min-height: 34px; border: 1.5px solid var(--accent); border-radius: 5px; background: var(--accent); color: #fff; padding: 0 14px; font: 750 13px/1 var(--doc-font); cursor: default; }
.pill-row { display: flex; flex-wrap: wrap; gap: 9px; margin: 20px 0 18px; }
.pill { display: inline-flex; min-height: 26px; align-items: center; border: 1.3px solid var(--wire-line); border-radius: 999px; background: var(--wire-surface); padding: 0 11px; font: 400 13px/1 var(--wire-font); }
.pill.is-active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.task-list { display: grid; gap: calc(12px * var(--density-scale)); }
.task-row { display: grid; min-height: calc(52px * var(--density-scale)); grid-template-columns: 22px 1fr 58px; align-items: center; gap: 12px; border-top: 1.2px solid var(--wire-rule); }
.check { display: inline-block; width: 15px; height: 15px; border: 1.5px solid var(--wire-line); border-radius: 4px; background: var(--wire-surface); }
.check.checked { background: var(--accent); box-shadow: inset 0 0 0 3px #fff; }
.task-row b, .task-row i, .phone-task b, .phone-task i, .phone-check i, .notes-lines i, .task-title, .input-line, .textarea-line { display: block; border-radius: 999px; background: var(--wire-mark); }
.task-row b { width: 54%; height: 10px; margin-bottom: 8px; }
.task-row i { width: 34%; height: 8px; }
.task-row em { justify-self: end; border: 1.2px solid var(--wire-line); border-radius: 999px; padding: 3px 7px; color: var(--muted); font: 400 11px/1 var(--wire-font); font-style: normal; }
.task-row em.hot { border-color: #cf5432; color: #cf5432; }
.frame-caption, .annotation-note { display: none; }
.phone-frame { padding: 0; background: transparent; }
.phone-shell { position: absolute; inset: 0; overflow: hidden; border: 1.5px solid var(--wire-line); border-radius: 25px; background: var(--wire-surface); color: var(--ink); filter: url(#ui-plan-roughen); box-shadow: none; }
.phone-status { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 13px; color: var(--muted); font: 650 10px/1 var(--doc-font); }
.phone-status span { flex: 1; }
.phone-status i { width: 12px; height: 4px; border-radius: 99px; background: var(--wire-dot); }
.phone-header { display: grid; height: 40px; grid-template-columns: 54px 1fr 54px; align-items: center; border-bottom: 1.3px solid var(--wire-line); padding: 0 9px; text-align: center; }
.phone-header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 14px/1 var(--wire-font); }
.phone-header button { border: 0; background: transparent; color: var(--accent); padding: 0; font: 750 11px/1 var(--doc-font); }
.phone-list, .phone-form, .phone-detail { padding: 17px 14px; }
.phone-list .pill-row { margin-top: 0; gap: 7px; }
.phone-task { display: grid; min-height: calc(48px * var(--density-scale)); grid-template-columns: 18px 1fr 38px; align-items: center; gap: 8px; border-bottom: 1px solid var(--wire-rule); }
.phone-task b { width: 68%; height: 8px; margin-bottom: 7px; }
.phone-task i { width: 43%; height: 7px; }
.phone-task em { color: var(--muted); font: 400 10px/1 var(--wire-font); font-style: normal; }
.phone-form label { display: block; margin: 13px 0 5px; color: var(--muted); font: 750 9px/1 var(--doc-font); text-transform: uppercase; letter-spacing: 0; }
.input-line { height: 32px; border: 1.2px solid var(--wire-line); background: transparent; }
.textarea-line { height: 72px; border: 1.2px solid var(--wire-line); border-radius: 5px; background: transparent; }
.chip-grid { display: flex; flex-wrap: wrap; gap: 7px; }
.chip-grid span { border: 1.2px solid var(--wire-line); border-radius: 999px; padding: 5px 8px; font: 400 11px/1 var(--wire-font); }
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
.board-card { background: transparent; padding: 0; }
.component-card:nth-of-type(2n), .component-card:nth-of-type(3n) { background: transparent; }
.component-card h3 { margin: 0 0 10px; font: 760 19px/1.2 var(--doc-font); letter-spacing: 0; }
.component-card p { font: 500 14px/1.45 var(--doc-font); }
.component-mini { display: none; }
.canvas-helper-note { padding: 18px 20px; background: color-mix(in srgb, var(--paper) 86%, transparent); font-family: var(--doc-font); }
.canvas-helper-note strong { display: block; margin-bottom: 10px; font-size: 16px; font-weight: 760; }
.canvas-helper-note ul { display: grid; gap: 5px; margin: 0 0 12px; padding-left: 19px; }
.canvas-helper-note p { margin: 0; color: var(--muted); }
.canvas-helper-note span { color: var(--accent); font-size: 13px; }
.canvas-helper-note.muted { background: var(--paper-soft); color: var(--soft); }
.canvas-annotation { font-family: var(--doc-font); pointer-events: auto; }
.canvas-annotation h4 { margin: 0 0 7px; color: var(--ink); font-size: 15px; line-height: 1.15; font-weight: 760; letter-spacing: 0; }
.canvas-annotation p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
.canvas-annotation ul { display: grid; gap: 5px; margin: 0; padding-left: 18px; color: var(--soft); font-size: 13px; line-height: 1.35; }
.canvas-annotation.handoff-note h4, .canvas-annotation.component-annotation h4 { color: var(--ink); }
.canvas-annotation.handoff-note p { margin-top: 12px; color: var(--accent); font-size: 12px; }
.canvas-annotation.quiet-note { color: var(--muted); }
.annotation-arrow { z-index: 1; pointer-events: none; }
.annotation-arrow svg { display: block; width: 100%; height: 100%; overflow: visible; }
.annotation-arrow path { fill: none; stroke: var(--accent); stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; opacity: .72; filter: url(#ui-plan-roughen); }
.notion-plan { width: min(910px, calc(100vw - 44px)); margin: 0 auto; padding: 88px 0 118px; }
.doc-cover { padding-bottom: 34px; border-bottom: 1px solid var(--line); }
.doc-kicker { margin: 0 0 10px; color: var(--muted); font-size: 12px; font-weight: 760; letter-spacing: 0; text-transform: uppercase; }
.doc-cover h1 { margin: 0 0 18px; font-size: clamp(38px, 5vw, 62px); line-height: 1.02; letter-spacing: -.03em; }
.doc-lede { max-width: 780px; margin: 0; color: var(--soft); font-size: clamp(19px, 2.4vw, 25px); line-height: 1.48; letter-spacing: -.012em; }
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
.tab-list { display: inline-flex; width: fit-content; max-width: 100%; gap: 8px; border: 0; overflow-x: auto; }
.tab-button { min-height: 38px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); padding: 0 12px; font-weight: 650; white-space: nowrap; cursor: pointer; }
.tab-button:hover { color: var(--ink); background: var(--tab-hover); }
.tab-button.is-active { border-color: var(--ink); color: var(--ink); }
.tab-button.is-active:hover { color: var(--ink); background: transparent; }
.tab-panel { display: none; }
.tab-panel.is-active { display: block; }
.state-spec { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(280px, .92fr); gap: 28px; align-items: start; }
.inline-wireframe { overflow: hidden; border: 1px solid var(--wire-line-soft); border-radius: 8px; background: var(--wire-surface); filter: url(#ui-plan-roughen); box-shadow: none; }
.inline-wireframe.is-mobile { max-width: 380px; border-radius: 28px; }
.wireframe-top { display: flex; height: 34px; align-items: center; gap: 6px; border-bottom: 1px solid var(--wire-line-soft); padding: 0 10px; }
.wireframe-top span { width: 8px; height: 8px; border: 1px solid var(--wire-line-soft); border-radius: 999px; }
.wireframe-top strong { margin-left: 8px; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; font: 400 13px/1 var(--wire-font); }
.wireframe-body { display: grid; min-height: 330px; grid-template-columns: 92px 1fr; }
.inline-wireframe.is-mobile .wireframe-body { grid-template-columns: 1fr; }
.wireframe-body aside { display: grid; align-content: start; gap: 10px; border-right: 1px solid var(--wire-line-soft); padding: 16px; }
.inline-wireframe.is-mobile aside { display: none; }
.wireframe-body aside i { height: 22px; border: 1px solid var(--wire-line-soft); border-radius: 5px; background: var(--wire-soft); }
.wireframe-body aside i.active { border-color: var(--accent); background: var(--accent-soft); }
.wireframe-body main { padding: 24px; }
.wireframe-body main b, .wireframe-body main p, .wireframe-grid span { display: block; border-radius: 999px; background: var(--wire-mark); }
.wireframe-body main b { width: 58%; height: 28px; margin-bottom: 20px; }
.wireframe-body main p { width: 84%; height: 10px; margin-bottom: 11px; }
.wireframe-body main p.short { width: 46%; }
.wireframe-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 26px; }
.wireframe-grid span { height: 86px; border-radius: 7px; border: 1px solid var(--wire-line-soft); background: var(--wire-soft); }
.wireframe-grid span.accent { border-color: var(--accent); background: var(--accent-soft); }
.state-notes { display: grid; gap: 14px; }
details { border-top: 1px solid var(--line); padding-top: 12px; }
summary { color: var(--ink); font-weight: 720; cursor: pointer; }
details ul { margin: 12px 0 0; padding-left: 18px; color: var(--soft); }
.sketch-flow-diagram { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; border: 1px solid var(--line); border-radius: 8px; background: var(--diagram-bg); padding: 22px; font-family: var(--doc-font); filter: url(#ui-plan-roughen); }
.diagram-step { display: flex; align-items: center; gap: 14px; }
.diagram-node { min-width: 148px; border: 1.5px solid var(--wire-line); border-radius: 8px; background: var(--diagram-node-bg); padding: 12px 14px; }
.diagram-node span { display: inline-grid; width: 22px; height: 22px; place-items: center; margin-right: 8px; border-radius: 999px; background: var(--accent); color: #fff; font-family: var(--doc-font); font-size: 12px; font-weight: 800; }
.diagram-node strong { font-weight: 760; }
.diagram-arrow { color: var(--accent); font-size: 28px; }
.component-spec { display: grid; grid-template-columns: minmax(0, .9fr) minmax(260px, 1.1fr); gap: 28px; align-items: center; }
.component-mini-spec { display: grid; grid-template-columns: 1fr 1fr auto; gap: 11px; align-items: center; border: 1px solid var(--wire-line-soft); border-radius: 8px; background: var(--wire-surface); padding: 20px; min-height: 180px; filter: url(#ui-plan-roughen); }
.component-mini-spec span, .component-mini-spec i { min-height: 30px; border: 1px solid var(--wire-line-soft); border-radius: 6px; background: var(--wire-soft); }
.component-mini-spec button { min-height: 34px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: #fff; padding: 0 14px; font-weight: 760; }
.component-mini-spec i { grid-column: span 3; min-height: 52px; }
.file-map-preview { display: grid; grid-template-columns: minmax(220px, .36fr) minmax(0, 1fr); margin-top: 20px; }
.file-list { border-right: 1px solid var(--line); }
.file-tab { display: grid; width: 100%; gap: 4px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--muted); padding: 16px 14px; text-align: left; cursor: pointer; }
.file-tab:hover { background: var(--tab-hover); color: var(--ink); }
.file-tab.is-active { color: var(--ink); box-shadow: inset 3px 0 0 var(--accent); }
.file-tab strong { font: 760 13px/1.25 var(--mono-font); }
.file-tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.file-panels { min-width: 0; }
.file-detail { min-width: 0; padding: 22px 24px; }
pre { margin: 18px 0 0; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--code-bg); padding: 18px 20px; color: var(--code-ink); font: 13px/1.65 var(--mono-font); }
pre code, pre code * { background: transparent !important; }
.syntax-keyword { color: var(--syntax-keyword); }
.syntax-string { color: var(--syntax-string); }
.doc-table { width: 100%; margin-top: 16px; border-collapse: collapse; font-size: 14px; }
.doc-table th, .doc-table td { border-bottom: 1px solid var(--line); padding: 12px 10px; text-align: left; vertical-align: top; }
.doc-table th { color: var(--muted); font-size: 12px; font-weight: 760; text-transform: uppercase; letter-spacing: 0; }
.doc-table td { color: var(--soft); }
.doc-table td:first-child { color: var(--ink); font-weight: 720; }
@media (max-width: 900px) {
  .top-canvas-section { height: 65vh; }
  .notion-plan { width: min(100vw - 28px, 910px); padding-top: 58px; }
  .state-spec, .component-spec, .file-map-preview { grid-template-columns: 1fr; }
  .file-list { border-right: 0; }
  .doc-cover h1 { font-size: clamp(38px, 10vw, 56px); }
}
@media (max-width: 620px) {
  .canvas-controls { left: 14px; bottom: 14px; }
  .wireframe-body { grid-template-columns: 1fr; }
  .wireframe-body aside { display: none; }
  .sketch-flow-diagram { align-items: stretch; flex-direction: column; }
  .diagram-step { align-items: stretch; flex-direction: column; }
  .diagram-arrow { transform: rotate(90deg); width: fit-content; margin-left: 24px; }
}
`;
