import type { PlanSource } from "../shared/types.js";

export type VisualQuestionsOption = {
  value?: string;
  label: string;
  description?: string;
  recommended?: boolean;
  preview?: "desktop" | "mobile" | "split" | "flow" | "diagram";
  bullets?: string[];
};

export type VisualQuestion = {
  id: string;
  type: "single" | "multi" | "freeform" | "visual";
  title: string;
  subtitle?: string;
  options?: VisualQuestionsOption[];
  allowOther?: boolean;
  placeholder?: string;
  required?: boolean;
};

export type BuildVisualQuestionsHtmlInput = {
  title: string;
  brief: string;
  source?: PlanSource;
  repoPath?: string;
  questions?: VisualQuestion[];
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function toKebab(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "option"
  );
}

function optionValue(option: VisualQuestionsOption): string {
  return option.value || toKebab(option.label);
}

export function defaultVisualQuestions(): VisualQuestion[] {
  return [
    {
      id: "form-factor",
      type: "single",
      title: "What form factor should lead?",
      subtitle: "Where should the first design direction feel native?",
      required: true,
      allowOther: true,
      options: [
        {
          label: "Desktop web app",
          description: "Start from a roomy workspace and derive mobile later.",
        },
        {
          label: "Mobile app",
          description:
            "Lead with compact flows, thumb zones, and quick actions.",
        },
        {
          label: "Both / responsive",
          description: "Design desktop and mobile states side by side.",
          recommended: true,
        },
        {
          label: "Decide for me",
          description:
            "Let the agent choose from the brief and product context.",
        },
      ],
    },
    {
      id: "aesthetic",
      type: "multi",
      title: "What aesthetic direction appeals?",
      subtitle: "Pick any signals worth exploring.",
      allowOther: true,
      options: [
        {
          label: "Calm & minimal",
          description: "Quiet, document-like, lots of breathing room.",
        },
        {
          label: "Dense & productive",
          description: "Power-user surface with compact controls.",
        },
        {
          label: "Playful & colorful",
          description: "More expressive states, motion, and warmth.",
        },
        {
          label: "Editorial / typographic",
          description: "Strong hierarchy and refined prose rhythm.",
        },
        {
          label: "Sleek dark mode",
          description: "Dark-first interface with crisp contrast.",
        },
        {
          label: "Explore a few options",
          description: "Show directions side by side before committing.",
        },
      ],
    },
    {
      id: "features",
      type: "multi",
      title: "Which features matter?",
      subtitle: "Pick the pieces the plan must include.",
      allowOther: true,
      options: [
        { label: "Projects / lists" },
        { label: "Due dates" },
        { label: "Priorities / flags" },
        { label: "Tags / labels" },
        { label: "Subtasks" },
        { label: "Notes / comments" },
        { label: "Drag to reorder" },
        { label: "Empty states" },
        { label: "Keyboard-first" },
        { label: "Decide for me" },
      ],
    },
    {
      id: "layout-model",
      type: "visual",
      title: "Which layout model feels closest?",
      subtitle:
        "Choose a visual direction, or use tabs to compare the options.",
      required: true,
      options: [
        {
          label: "Sidebar workspace",
          description: "Persistent navigation with a main work surface.",
          preview: "desktop",
          recommended: true,
          bullets: ["Best for repeated use", "Room for filters and lists"],
        },
        {
          label: "Top nav focus",
          description: "Horizontal nav with a lighter page frame.",
          preview: "split",
          bullets: ["Cleaner first impression", "Good for simple tools"],
        },
        {
          label: "Mobile-first stack",
          description: "Primary flow starts as a narrow single-column app.",
          preview: "mobile",
          bullets: ["Fast add/edit loops", "Great for quick capture"],
        },
      ],
    },
    {
      id: "flow-depth",
      type: "visual",
      title: "How complex should the flow be?",
      subtitle: "This helps decide how much canvas vs document the plan needs.",
      options: [
        {
          label: "One polished path",
          description: "Go deep on one likely flow with states.",
          preview: "flow",
          bullets: ["Fastest to approve", "Fewer branches"],
        },
        {
          label: "A few variations",
          description: "Compare competing directions before planning code.",
          preview: "diagram",
          recommended: true,
          bullets: ["Useful when direction is fuzzy", "Shows tradeoffs"],
        },
      ],
    },
    {
      id: "special-interactions",
      type: "multi",
      title: "What interactions should feel special?",
      subtitle: "Where should the polish go?",
      allowOther: true,
      options: [
        { label: "Satisfying completion" },
        { label: "Quick-add / keyboard-first" },
        { label: "Smooth drag & drop" },
        { label: "Swipe gestures" },
        { label: "Inline comments" },
        { label: "Empty-state moments" },
        { label: "Decide for me" },
      ],
    },
    {
      id: "notes",
      type: "freeform",
      title: "Anything the agent should know?",
      subtitle: "Constraints, inspirations, must-haves, or things to avoid.",
      placeholder:
        "Example: keep it Notion-like, show mobile and desktop, avoid a marketing feel...",
    },
  ];
}

export function buildVisualQuestionsHtml(
  input: BuildVisualQuestionsHtmlInput,
): string {
  const questions = input.questions?.length
    ? input.questions
    : defaultVisualQuestions();
  const title = input.title || "Visual questions";
  const brief = input.brief || "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${VISUAL_QUESTIONS_CSS}</style>
</head>
<body data-visual-questions="true">
  <svg class="roughen-svg" aria-hidden="true">
    <filter id="visual-questions-roughen">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
  <main class="vq-shell">
    <header class="vq-cover" data-plan-section-id="visual-questions-brief">
      <p class="vq-kicker">Visual intake</p>
      <h1>${escapeHtml(title)}</h1>
    </header>

    <section class="vq-form" data-plan-section-id="visual-questions-form">
      ${questions.map(renderQuestion).join("\n")}
    </section>

    <section class="vq-summary" data-plan-section-id="visual-questions-summary">
      <div>
        <p class="vq-eyebrow">Generated handoff</p>
        <h2>Answer summary for the planning agent</h2>
        <p>This prompt can feed the next UI plan or visual plan step.</p>
      </div>
      <textarea id="visual-questions-summary" readonly aria-label="Generated answer summary"></textarea>
    </section>
  </main>

  <footer class="vq-action-bar" aria-live="polite">
    <div>
      <strong id="visual-questions-progress">0/${questions.length} answered</strong>
      <span>Use this as the intake before a UI/visual plan.</span>
    </div>
    <button type="button" class="vq-secondary" data-vq-copy>Copy prompt</button>
    <button type="button" class="vq-primary" data-vq-send>Send to agent</button>
  </footer>

  <script>
    window.__VISUAL_QUESTIONS__ = {
      title: ${safeJson(title)},
      brief: ${safeJson(brief)},
      source: ${safeJson(input.source ?? "manual")},
      repoPath: ${safeJson(input.repoPath ?? "")},
      questions: ${safeJson(questions)}
    };
  </script>
  <script>${VISUAL_QUESTIONS_SCRIPT}</script>
</body>
</html>`;
}

function renderQuestion(question: VisualQuestion, index: number): string {
  const id = escapeHtml(question.id);
  const subtitle = question.subtitle
    ? `<p>${escapeHtml(question.subtitle)}</p>`
    : "";
  return `<article class="vq-question" data-question-id="${id}" data-question-type="${escapeHtml(question.type)}">
    <div class="vq-question-heading">
      <span>${index + 1}</span>
      <div>
        <h2>${escapeHtml(question.title)}</h2>
        ${subtitle}
      </div>
    </div>
    ${renderQuestionControl(question)}
  </article>`;
}

function renderQuestionControl(question: VisualQuestion): string {
  if (question.type === "freeform") {
    return `<textarea class="vq-textarea" data-freeform-input placeholder="${escapeHtml(question.placeholder ?? "Add notes...")}"></textarea>`;
  }
  if (question.type === "visual") {
    return renderVisualChoice(question);
  }
  return renderChipChoices(question);
}

// Multiple-choice questions always offer a write-in answer unless an author
// explicitly opts out with `allowOther: false`, so a reviewer can give a custom
// response instead of the listed options.
function renderWriteIn(question: VisualQuestion): string {
  if (question.allowOther === false) return "";
  const placeholder = escapeHtml(
    question.placeholder ?? "Other — type your own answer…",
  );
  return `<input class="vq-other" data-other-input placeholder="${placeholder}" />`;
}

function renderChipChoices(question: VisualQuestion): string {
  const options = question.options ?? [];
  const other = renderWriteIn(question);
  return `<div class="vq-chip-cloud">
    ${options
      .map((option) => {
        const value = optionValue(option);
        return `<button type="button" class="vq-chip" data-choice="${escapeHtml(value)}" aria-pressed="false">
          <span>${escapeHtml(option.label)}</span>
          ${option.recommended ? `<em>Recommended</em>` : ""}
        </button>`;
      })
      .join("\n")}
    ${other}
  </div>`;
}

function renderVisualChoice(question: VisualQuestion): string {
  const options = question.options ?? [];
  return `<div class="vq-visual-options" role="radiogroup" aria-label="${escapeHtml(question.title)} options">
    ${options
      .map((option, index) => {
        const value = optionValue(option);
        return `<div class="vq-visual-option">
          <button type="button" class="vq-visual-card" data-choice="${escapeHtml(value)}" role="radio" aria-checked="false">
            ${renderPreview(option, index)}
            <span class="vq-visual-copy">
              <span class="vq-visual-title"><span aria-hidden="true"></span><strong>${escapeHtml(option.label)}</strong></span>
              ${option.description ? `<span>${escapeHtml(option.description)}</span>` : ""}
            </span>
          </button>
          ${renderBullets(option.bullets)}
        </div>`;
      })
      .join("\n")}
    ${renderWriteIn(question)}
  </div>`;
}

function renderBullets(bullets: string[] | undefined): string {
  if (!bullets?.length) return "";
  return `<ul class="vq-bullets">${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderPreview(option: VisualQuestionsOption, index: number): string {
  const preview = option.preview ?? (index % 2 === 0 ? "desktop" : "mobile");
  if (preview === "mobile") {
    return `<span class="vq-preview vq-preview-mobile" aria-hidden="true">
      <i></i><b></b><b></b><b></b><em></em>
    </span>`;
  }
  if (preview === "split") {
    return `<span class="vq-preview vq-preview-split" aria-hidden="true">
      <i></i><b></b><b></b><b></b><strong></strong>
    </span>`;
  }
  if (preview === "flow") {
    return `<span class="vq-preview vq-preview-flow" aria-hidden="true">
      <b>1</b><i></i><b>2</b><i></i><b>3</b>
    </span>`;
  }
  if (preview === "diagram") {
    return `<span class="vq-preview vq-preview-diagram" aria-hidden="true">
      <b></b><b></b><b></b><i></i><i></i>
    </span>`;
  }
  return `<span class="vq-preview vq-preview-desktop" aria-hidden="true">
    <i></i><b></b><b></b><b></b><strong></strong>
  </span>`;
}

const VISUAL_QUESTIONS_CSS = `
@font-face { font-family: "Excalifont"; src: url("/fonts/Excalifont-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
:root { color-scheme: light dark; --bg: #faf9f7; --paper: #ffffff; --paper-soft: #f3f2ef; --canvas: #f3f2ef; --ink: #181817; --muted: #6f6e68; --line: #dfded9; --line-strong: #c9c8c2; --accent: #2f6fed; --accent-soft: rgba(47,111,237,.1); --sketch: #20201e; --wire-surface: #ffffff; --wire-soft: #f4f4f5; --wire-mark: #d4d4d8; --wire-line: #20201e; --wire-line-soft: #c9c8c2; --shadow: none; }
:root[data-agent-native-theme="dark"] { color-scheme: dark; --bg: #1f1e1d; --paper: #242423; --paper-soft: #2b2a2a; --canvas: #1d1c1b; --ink: #f4f3ef; --muted: #aaa8a4; --line: #444341; --line-strong: #5a5955; --accent: #4d86ff; --accent-soft: rgba(77,134,255,.18); --sketch: #f0eee8; --wire-surface: #202020; --wire-soft: #2a2a2a; --wire-mark: #686868; --wire-line: rgba(244,244,242,.78); --wire-line-soft: rgba(244,244,242,.26); --shadow: none; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
button, input, textarea { font: inherit; }
.roughen-svg { position: absolute; width: 0; height: 0; overflow: hidden; }
.vq-shell { width: min(1040px, calc(100vw - 96px)); margin: 0 auto; padding: 60px 0 132px; }
.vq-cover { max-width: 700px; }
.vq-kicker, .vq-eyebrow { margin: 0 0 12px; color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(30px, 4vw, 52px); line-height: 1.05; letter-spacing: -.03em; }
.vq-form { display: grid; gap: 46px; margin-top: 48px; }
.vq-question { display: grid; gap: 17px; }
.vq-question-heading { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 14px; align-items: start; }
.vq-question-heading > span { display: inline-flex; width: 18px; height: 18px; margin-top: 4px; align-items: center; justify-content: center; border-radius: 99px; background: transparent; color: var(--muted); font-size: 11px; font-weight: 650; opacity: .62; }
.vq-question h2 { margin: 0; font-size: clamp(21px, 2.2vw, 28px); letter-spacing: -.02em; line-height: 1.16; }
.vq-question p { max-width: 680px; margin: 6px 0 0; color: var(--muted); font-size: 15px; }
.vq-chip-cloud { display: flex; flex-wrap: wrap; gap: 12px; padding-left: 34px; }
.vq-chip, .vq-secondary, .vq-primary { min-height: 40px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); color: var(--ink); padding: 0 18px; font-weight: 650; cursor: pointer; transition: border-color .16s ease, background .16s ease, color .16s ease, transform .16s ease; }
.vq-chip:hover { border-color: var(--line-strong); background: var(--paper-soft); }
.vq-chip.is-selected { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); }
.vq-chip em { margin-left: 8px; color: var(--accent); font-style: normal; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.vq-other { min-height: 40px; width: min(280px, 100%); border: 1px solid var(--line); border-radius: 999px; background: var(--paper); color: var(--ink); padding: 0 18px; outline: none; }
.vq-other:focus, .vq-textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.vq-textarea { min-height: 120px; width: calc(100% - 34px); margin-left: 34px; resize: vertical; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink); padding: 16px 18px; outline: none; }
.vq-visual-options { display: grid; gap: 34px; padding-left: 34px; }
.vq-visual-option { display: grid; grid-template-columns: minmax(280px, 520px) minmax(220px, 1fr); gap: 24px; align-items: start; }
.vq-visual-option + .vq-visual-option { padding-top: 34px; border-top: 1px solid color-mix(in srgb, var(--line) 68%, transparent); }
.vq-visual-card { display: grid; gap: 14px; width: 100%; border: 0; border-radius: 0; background: transparent; color: var(--ink); padding: 0; text-align: left; cursor: pointer; box-shadow: none; }
.vq-visual-card:hover .vq-visual-title strong { color: var(--accent); }
.vq-visual-card:focus-visible { outline: 0; }
.vq-visual-card:focus-visible .vq-preview { outline: 2px solid var(--accent); outline-offset: 4px; }
.vq-visual-card.is-selected .vq-visual-title span { border-color: var(--accent); background: var(--accent); box-shadow: inset 0 0 0 4px var(--paper); }
.vq-visual-card.is-selected .vq-preview { outline: 2px solid var(--accent-soft); outline-offset: 4px; }
.vq-visual-copy { display: grid; gap: 4px; }
.vq-visual-title { display: flex; align-items: center; gap: 9px; color: var(--ink); }
.vq-visual-title span { width: 14px; height: 14px; flex: 0 0 auto; border: 1px solid var(--line-strong); border-radius: 99px; background: transparent; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
.vq-visual-copy strong { font-size: 18px; }
.vq-visual-copy > span:not(.vq-visual-title), .vq-bullets { color: var(--muted); }
.vq-bullets { margin: 26px 0 0; padding-left: 20px; font-size: 15px; }
.vq-preview { position: relative; display: block; min-height: 190px; overflow: hidden; border: 1.5px solid var(--wire-line); border-radius: 7px; background: var(--wire-surface); filter: url(#visual-questions-roughen); }
.vq-preview::after, .vq-preview-flow b::after, .vq-preview-diagram b::after { content: ""; position: absolute; inset: -2px; border: 1px solid var(--wire-line-soft); border-radius: inherit; transform: translate(2px, -1px) rotate(.18deg); pointer-events: none; }
.vq-preview-desktop i, .vq-preview-split i { position: absolute; inset: 0 auto 0 0; width: 26%; border-right: 1px solid var(--wire-line-soft); background: var(--wire-soft); }
.vq-preview-desktop b, .vq-preview-split b, .vq-preview-mobile b { position: absolute; left: 32%; right: 8%; height: 12px; border-radius: 99px; background: var(--wire-mark); opacity: .72; }
.vq-preview-desktop b:nth-of-type(1), .vq-preview-split b:nth-of-type(1), .vq-preview-mobile b:nth-of-type(1) { top: 46px; }
.vq-preview-desktop b:nth-of-type(2), .vq-preview-split b:nth-of-type(2), .vq-preview-mobile b:nth-of-type(2) { top: 82px; right: 22%; }
.vq-preview-desktop b:nth-of-type(3), .vq-preview-split b:nth-of-type(3), .vq-preview-mobile b:nth-of-type(3) { top: 118px; right: 34%; }
.vq-preview-desktop strong, .vq-preview-split strong { position: absolute; left: 32%; right: 8%; bottom: 18px; height: 34px; border: 1.4px solid var(--accent); border-radius: 7px; }
.vq-preview-split i { inset: 0 0 auto 0; width: auto; height: 38px; border-right: 0; border-bottom: 1px solid var(--wire-line-soft); }
.vq-preview-split b { left: 8%; }
.vq-preview-mobile { width: min(210px, 100%); margin: 0 auto; border-radius: 28px; min-height: 230px; }
.vq-preview-mobile i { position: absolute; left: 50%; top: 12px; width: 42px; height: 5px; border-radius: 99px; background: var(--wire-line-soft); transform: translateX(-50%); }
.vq-preview-mobile b { left: 18%; right: 18%; }
.vq-preview-mobile em { position: absolute; right: 18px; bottom: 18px; width: 42px; height: 42px; border-radius: 99px; background: var(--accent); }
.vq-preview-flow { display: flex; min-height: 128px; align-items: center; justify-content: center; gap: 14px; background: var(--wire-surface); border-style: solid; }
.vq-preview-flow b { position: relative; display: inline-flex; width: 54px; height: 54px; align-items: center; justify-content: center; border-radius: 7px; background: var(--wire-surface); border: 1.5px solid var(--wire-line); color: var(--accent); font: 400 24px/1 Excalifont, ui-sans-serif, system-ui; filter: url(#visual-questions-roughen); }
.vq-preview-flow i { width: 54px; border-top: 2px solid var(--accent); filter: url(#visual-questions-roughen); }
.vq-preview-diagram b { position: absolute; width: 118px; height: 56px; border: 1.5px solid var(--wire-line); border-radius: 7px; background: var(--wire-surface); filter: url(#visual-questions-roughen); }
.vq-preview-diagram b:nth-of-type(1) { left: 32px; top: 32px; }
.vq-preview-diagram b:nth-of-type(2) { right: 38px; top: 42px; }
.vq-preview-diagram b:nth-of-type(3) { left: 42%; bottom: 28px; }
.vq-preview-diagram i { position: absolute; width: 120px; border-top: 2px dashed var(--accent); transform: rotate(12deg); }
.vq-preview-diagram i:nth-of-type(1) { left: 140px; top: 78px; }
.vq-preview-diagram i:nth-of-type(2) { right: 132px; bottom: 74px; transform: rotate(-18deg); }
.vq-summary { display: grid; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); gap: 36px; margin-top: 76px; padding-top: 42px; border-top: 1px solid var(--line); }
.vq-summary h2 { margin: 0; font-size: clamp(24px, 3vw, 34px); letter-spacing: -.024em; }
.vq-summary p { color: var(--muted); }
#visual-questions-summary { min-height: 300px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper-soft); color: var(--ink); padding: 18px; font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; resize: vertical; }
.vq-action-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: flex; align-items: center; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--line); background: color-mix(in srgb, var(--bg) 92%, transparent); padding: 12px max(22px, calc((100vw - 1120px) / 2)); backdrop-filter: blur(16px); }
.vq-action-bar div { display: grid; gap: 2px; margin-right: auto; color: var(--muted); font-size: 13px; }
.vq-action-bar strong { color: var(--ink); }
.vq-secondary:hover, .vq-primary:hover { transform: translateY(-1px); }
.vq-primary { border-color: var(--accent); background: var(--accent); color: white; }
@media (max-width: 760px) {
  .vq-shell { width: min(100vw - 28px, 1040px); padding-top: 44px; }
  .vq-summary, .vq-visual-option { grid-template-columns: 1fr; }
  .vq-chip-cloud, .vq-visual-options, .vq-textarea { margin-left: 0; padding-left: 0; width: 100%; }
  .vq-question-heading { grid-template-columns: 1fr; }
  .vq-action-bar { align-items: stretch; flex-wrap: wrap; }
  .vq-action-bar div { flex: 1 1 100%; }
}
`;

const VISUAL_QUESTIONS_SCRIPT = `
(function () {
  const config = window.__VISUAL_QUESTIONS__ || { questions: [] };
  const state = { answers: {}, activeVisual: {} };

  function normalize(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function attr(value) {
    return String(value || "").replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\"");
  }

  function optionValue(option) {
    return option.value || String(option.label || "option").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "option";
  }

  function defaultAnswer(question) {
    if (question.type === "multi") return { values: [], other: "" };
    if (question.type === "freeform") return "";
    return { value: "", other: "" };
  }

  for (const question of config.questions) {
    state.answers[question.id] = defaultAnswer(question);
    if (question.type === "visual" && question.options?.[0]) {
      state.activeVisual[question.id] = optionValue(question.options[0]);
    }
  }

  function labelFor(question, value) {
    if (value === "other") return "Other";
    const option = (question.options || []).find((item) => optionValue(item) === value);
    return option?.label || value;
  }

  function answerText(question) {
    const answer = state.answers[question.id];
    if (question.type === "freeform") return normalize(answer) || "No answer yet";
    if (question.type === "multi") {
      const labels = (answer.values || []).map((value) => labelFor(question, value));
      if (answer.other) labels.push("Other: " + answer.other);
      return labels.length ? labels.join(", ") : "No answer yet";
    }
    if (answer.value === "other" && answer.other) return "Other: " + answer.other;
    return answer.value ? labelFor(question, answer.value) : "No answer yet";
  }

  function isAnswered(question) {
    const answer = state.answers[question.id];
    if (question.type === "freeform") return Boolean(normalize(answer));
    if (question.type === "multi") return Boolean((answer.values || []).length || normalize(answer.other));
    return Boolean(answer.value && (answer.value !== "other" || normalize(answer.other)));
  }

  function serializedAnswers() {
    return config.questions.map((question) => ({
      id: question.id,
      title: question.title,
      type: question.type,
      answer: answerText(question),
      raw: state.answers[question.id]
    }));
  }

  function buildPrompt() {
    const lines = [
      "Use these visual intake answers to create or refine a UI-first visual plan.",
      "",
      "Project: " + config.title,
      "Brief: " + config.brief,
      config.source ? "Source: " + config.source : "",
      config.repoPath ? "Repo: " + config.repoPath : "",
      "",
      "Answers:"
    ].filter(Boolean);
    for (const question of config.questions) {
      lines.push("- " + question.title + ": " + answerText(question));
    }
    lines.push(
      "",
      "Next step: create a visual/UI plan from these answers. Prefer a top pan/zoom wireframe canvas when screens, flows, diagrams, or visual options are useful, then continue with a restrained Notion-like document. Preserve explicit answers; make reasonable choices for anything unanswered."
    );
    return lines.join("\\n");
  }

  function setVisualPanel(questionId, value) {
    const scope = document.querySelector('[data-question-id="' + attr(questionId) + '"]');
    if (!scope) return;
    state.activeVisual[questionId] = value;
    for (const tab of scope.querySelectorAll("[data-visual-tab]")) {
      const selected = tab.getAttribute("data-visual-tab") === value;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    }
    for (const panel of scope.querySelectorAll("[data-visual-panel]")) {
      const selected = panel.getAttribute("data-visual-panel") === value;
      panel.classList.toggle("is-active", selected);
      panel.hidden = !selected;
    }
  }

  function updateUi() {
    for (const question of config.questions) {
      const scope = document.querySelector('[data-question-id="' + attr(question.id) + '"]');
      if (!scope) continue;
      const answer = state.answers[question.id];
      for (const choice of scope.querySelectorAll("[data-choice]")) {
        const value = choice.getAttribute("data-choice");
        const selected =
          question.type === "multi"
            ? (answer.values || []).includes(value)
            : answer.value === value;
        choice.classList.toggle("is-selected", selected);
        if (choice.getAttribute("role") === "radio") {
          choice.setAttribute("aria-checked", String(selected));
        } else {
          choice.setAttribute("aria-pressed", String(selected));
        }
      }
    }
    const answered = config.questions.filter(isAnswered).length;
    const progress = document.getElementById("visual-questions-progress");
    if (progress) progress.textContent = answered + "/" + config.questions.length + " answered";
    const summary = document.getElementById("visual-questions-summary");
    if (summary) summary.value = buildPrompt();
  }

  document.addEventListener("click", (event) => {
    const tab = event.target instanceof Element ? event.target.closest("[data-visual-tab]") : null;
    if (tab) {
      const question = tab.closest("[data-question-id]");
      const questionId = question?.getAttribute("data-question-id");
      const value = tab.getAttribute("data-visual-tab");
      if (questionId && value) setVisualPanel(questionId, value);
      return;
    }
    const choice = event.target instanceof Element ? event.target.closest("[data-choice]") : null;
    if (!choice) return;
    const scope = choice.closest("[data-question-id]");
    const questionId = scope?.getAttribute("data-question-id");
    const question = config.questions.find((item) => item.id === questionId);
    const value = choice.getAttribute("data-choice");
    if (!question || !value) return;
    if (question.type === "multi") {
      const values = state.answers[question.id].values;
      const index = values.indexOf(value);
      if (index >= 0) values.splice(index, 1);
      else values.push(value);
    } else {
      state.answers[question.id].value = value;
      if (question.type === "visual") setVisualPanel(question.id, value);
      if (value !== "other") state.answers[question.id].other = "";
    }
    updateUi();
  });

  document.addEventListener("input", (event) => {
    const input = event.target instanceof Element ? event.target : null;
    const scope = input?.closest("[data-question-id]");
    const questionId = scope?.getAttribute("data-question-id");
    const question = config.questions.find((item) => item.id === questionId);
    if (!question) return;
    if (input.matches("[data-freeform-input]")) {
      state.answers[question.id] = input.value;
    }
    if (input.matches("[data-other-input]")) {
      if (question.type === "multi") {
        state.answers[question.id].other = input.value.trim();
      } else {
        state.answers[question.id].value = "other";
        state.answers[question.id].other = input.value.trim();
      }
    }
    updateUi();
  });

  function parentOrigin() {
    const explicit = typeof window.__agentNativePlanParentOrigin === "string"
      ? window.__agentNativePlanParentOrigin
      : "";
    if (explicit && explicit !== "null") return explicit;
    try {
      const referrerOrigin = new URL(document.referrer).origin;
      return referrerOrigin && referrerOrigin !== "null" ? referrerOrigin : "";
    } catch {
      return "";
    }
  }

  function post(type) {
    const targetOrigin = parentOrigin();
    if (!targetOrigin) return;
    window.parent.postMessage({
      type,
      title: config.title,
      summary: buildPrompt(),
      answers: serializedAnswers()
    }, targetOrigin);
  }

  document.querySelector("[data-vq-copy]")?.addEventListener("click", () => post("agent-native-visual-questions-copy"));
  document.querySelector("[data-vq-send]")?.addEventListener("click", () => post("agent-native-visual-questions-send-to-agent"));
  updateUi();
})();
`;
