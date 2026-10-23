import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  canvas: "#FBF1E3",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#3A2412",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#8C6B4F",
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#FFFAF2",
  // guard:allow-raw-color — authored template palette, not app chrome.
  todo: "#F3C99A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  doing: "#E89A5E",
  // guard:allow-raw-color — authored template palette, not app chrome.
  done: "#C96F3B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  lane: "#F6E3CB",
};

type Task = [string, string];
const columns: [string, string, Task[]][] = [
  [
    "To do",
    "todo",
    [
      ["Draft onboarding emails", "Mara"],
      ["Audit pricing page copy", "Jules"],
      ["Plan Q3 roadmap review", "Sam"],
    ],
  ],
  [
    "In progress",
    "doing",
    [
      ["Redesign settings screen", "Ines"],
      ["Ship search filters", "Theo"],
      ["Prepare launch checklist", "Mara"],
    ],
  ],
  [
    "Done",
    "done",
    [
      ["Fix sign-in redirect", "Sam"],
      ["Publish changelog v2.4", "Jules"],
      ["Migrate analytics events", "Theo"],
    ],
  ],
];

const lanes = columns
  .map(
    ([name, tone, tasks]) => `
        <section class="lane" data-agent-native-node-id="lane-${tone}" data-agent-native-layer-name="${name}">
          <h2><span>${name}</span><b>${tasks.length}</b></h2>
          ${tasks
            .map(
              ([title, owner]) =>
                `<article class="task ${tone}"><p>${title}</p><small>${owner}</small></article>`,
            )
            .join("")}
        </section>`,
  )
  .join("");

export const projectTasks: DesignTemplatePreset = {
  id: "preset-project-tasks",
  title: "Project tasks",
  description: "Plan, assign, and ship work faster.",
  category: "other",
  width: 1440,
  height: 900,
  filename: "project-tasks.html",
  content: presetDocument({
    title: "Tally — Project tasks",
    width: 1440,
    height: 900,
    fonts: "family=Manrope:wght@400;600;700;800",
    palette: {
      canvas: C.canvas,
      ink: C.ink,
      muted: C.muted,
      paper: C.paper,
      todo: C.todo,
      doing: C.doing,
      done: C.done,
      lane: C.lane,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Manrope', sans-serif; }
      .top { position:absolute; left:56px; right:56px; top:36px; z-index:1; display:flex; justify-content:flex-end; align-items:center; gap:12px; height:44px; }
      .top span { padding:10px 18px; border-radius:999px; background:var(--lane); color:var(--muted); font-size:14px; font-weight:600; }
      .top span.primary { background:var(--ink); color:var(--paper); }
      .board { position:absolute; left:56px; right:56px; top:112px; bottom:56px; z-index:1; display:grid; grid-template-columns:repeat(3,1fr); gap:24px; }
      .lane { padding:20px; border-radius:20px; background:var(--lane); }
      .lane h2 { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; color:var(--muted); font-size:13px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
      .lane h2 b { padding:2px 10px; border-radius:999px; background:var(--paper); font-size:12px; }
      .task { display:flex; flex-direction:column; justify-content:space-between; height:150px; margin-bottom:16px; padding:20px 22px; border-radius:16px; box-shadow:0 8px 24px color-mix(in srgb, var(--ink) 14%, transparent); }
      .task p { font-size:20px; font-weight:700; line-height:1.25; letter-spacing:-.01em; }
      .task small { font-size:14px; font-weight:400; opacity:.75; }
      .task.todo { background:var(--todo); }
      .task.doing { background:var(--doing); }
      .task.done { background:var(--done); color:var(--paper); }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.canvas}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div style="position:absolute;left:56px;top:40px;z-index:2;display:flex;align-items:center;gap:10px;color:${C.ink};font:800 24px/1 'Manrope',sans-serif;letter-spacing:-.03em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="9" fill="${C.done}"/><path d="M8 15.5l4.5 4.5L22 10" fill="none" stroke="${C.paper}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Tally</span>
      </div>
      <header class="top" data-agent-native-node-id="toolbar" data-agent-native-layer-name="Toolbar">
        <span>This sprint</span><span>Filter</span><span class="primary">New task</span>
      </header>
      <div class="board" data-agent-native-node-id="board" data-agent-native-layer-name="Board">${lanes}
      </div>`,
  }),
};
