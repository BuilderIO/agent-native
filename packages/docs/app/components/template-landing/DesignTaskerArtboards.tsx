/**
 * "The user's design" half of the Design landing hero: a fictional `tasker` app
 * authored as a desktop screen plus its mobile breakpoint, rendered inside the
 * editor chrome in `DesignOverviewMock`. Kept separate from that file because
 * the chrome and the artboards are unrelated concerns and share nothing but the
 * board scale.
 *
 * Every length below is an artboard pixel, not a screen pixel: each artboard is
 * laid out at its logical size and multiplied by BOARD_SCALE. The type is sized
 * like a large-type app on purpose — at 0.4 a normal 16px body line lands at
 * 6.4px and turns to mush, so the design itself is authored chunky.
 *
 * i18n-raw-literal-disable-file -- artwork, not UI copy. See the header comment
 * in DesignOverviewMock.tsx; the whole tree renders inside an `aria-hidden`
 * wrapper under a `role="img"` with a localized label.
 */

/** Board zoom. Matches the `40%` readout in the inspector. */
export const BOARD_SCALE = 0.4;

export const DESKTOP_ARTBOARD_WIDTH = 1280;
export const DESKTOP_ARTBOARD_HEIGHT = 1400;
export const MOBILE_ARTBOARD_WIDTH = 390;
export const MOBILE_ARTBOARD_HEIGHT = 1100;

/**
 * Selection chrome lives inside the scaled artboard so it tracks the element it
 * outlines instead of being positioned by hand, which means every length has to
 * be divided by the board scale to land at its intended on-screen size. CSS
 * transforms scale vector borders exactly, so a 1.5px outline authored as
 * 3.75px is still a crisp 1.5px.
 */
const inverse = (screenPx: number) => `${screenPx / BOARD_SCALE}px`;

const NAV_ITEMS = [
  { label: "Inbox", count: "7", active: true },
  { label: "Today" },
  { label: "Upcoming" },
  { label: "Settings" },
];

type Task = {
  title: string;
  chips: { label: string; tone?: "priority" }[];
};

const PRIORITY_TASKS: Task[] = [
  {
    title: "Confirm launch sequence with the team",
    chips: [
      { label: "Launch" },
      { label: "Today" },
      { label: "High priority", tone: "priority" },
    ],
  },
  {
    title: "Review the onboarding checklist",
    chips: [
      { label: "Product" },
      { label: "Today" },
      { label: "High priority", tone: "priority" },
    ],
  },
];

const IN_PROGRESS_TASKS: Task[] = [
  {
    title: "Draft the weekly customer note",
    chips: [{ label: "Comms" }, { label: "Tomorrow" }],
  },
  {
    title: "Map the Q4 research themes",
    chips: [{ label: "Research" }, { label: "Aug 21" }],
  },
];

const LATER_TASKS: Task[] = [
  {
    title: "Refresh the workspace templates",
    chips: [{ label: "Ops" }, { label: "Aug 27" }],
  },
];

function TaskCard({ task }: { task: Task }) {
  return (
    <div className="tk-card">
      <span className="tk-card-title">{task.title}</span>
      <span className="tk-card-meta">
        {task.chips.map((chip) => (
          <span
            key={chip.label}
            className={
              chip.tone === "priority" ? "tk-chip is-priority" : "tk-chip"
            }
          >
            {chip.label}
          </span>
        ))}
        <span className="tk-card-link">Details →</span>
      </span>
    </div>
  );
}

function TaskSection({ title, tasks }: { title: string; tasks: Task[] }) {
  return (
    <div className="tk-section">
      <div className="tk-section-head">
        <h3 className="tk-section-title">{title}</h3>
        <span className="tk-section-count">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
      </div>
      <div className="tk-section-body">
        {tasks.map((task) => (
          <TaskCard key={task.title} task={task} />
        ))}
      </div>
    </div>
  );
}

function Greeting() {
  return (
    <h2 className="tk-headline">
      Good evening, <em>Maya.</em>
    </h2>
  );
}

/**
 * The element the editor has selected. The outline, handles, and dimension
 * badge are part of the editor, not the design, but they are drawn here so they
 * stay glued to the button through any layout change above it.
 */
function SelectedAddTask({ full = false }: { full?: boolean }) {
  return (
    <div className={full ? "tk-selected is-full" : "tk-selected"}>
      <span className="tk-add">+ Add task</span>
      <span className="tk-sel-outline" />
      <span className="tk-sel-handle tk-sel-handle-tl" />
      <span className="tk-sel-handle tk-sel-handle-tr" />
      <span className="tk-sel-handle tk-sel-handle-bl" />
      <span className="tk-sel-handle tk-sel-handle-br" />
      <span className="tk-sel-badge">120 × 48</span>
    </div>
  );
}

export function TaskerDesktopArtboard() {
  return (
    <div className="tk tk-desktop">
      <aside className="tk-sidebar">
        <span className="tk-wordmark">tasker.</span>
        <span className="tk-tagline">Focused work, clearly grouped.</span>
        <div className="tk-nav">
          {NAV_ITEMS.map((item) => (
            <span
              key={item.label}
              className={item.active ? "tk-nav-item is-active" : "tk-nav-item"}
            >
              <span>{item.label}</span>
              {item.count ? (
                <span className="tk-nav-count">{item.count}</span>
              ) : null}
            </span>
          ))}
        </div>
        <div className="tk-sidebar-footer">
          <span className="tk-sidebar-footer-label">Workspace</span>
          <span className="tk-sidebar-footer-value">Northstar</span>
        </div>
      </aside>

      <main className="tk-main">
        <span className="tk-eyebrow">Tuesday, August 18</span>
        <Greeting />
        <p className="tk-support">
          A clear view of the work that needs your attention, without the noise.
        </p>
        <SelectedAddTask />

        <div className="tk-tabs">
          <span className="tk-tab is-active">All tasks</span>
          <span className="tk-tab">Open</span>
          <span className="tk-tab">Completed</span>
          <span className="tk-tabs-meta">5 open tasks</span>
        </div>

        <TaskSection title="Priority" tasks={PRIORITY_TASKS} />
        <TaskSection title="In progress" tasks={IN_PROGRESS_TASKS} />
        <TaskSection title="Later" tasks={LATER_TASKS} />

        <div className="tk-footer">
          <span>5 tasks across 3 sections</span>
          <span>Last synced a moment ago</span>
        </div>
      </main>
    </div>
  );
}

export function TaskerMobileArtboard() {
  return (
    <div className="tk tk-mobile">
      <div className="tk-m-topbar">
        <span className="tk-wordmark">tasker.</span>
        <span className="tk-m-menu">Menu</span>
      </div>
      <span className="tk-eyebrow">Tuesday, August 18</span>
      <Greeting />
      <p className="tk-support">
        A clear view of the work that needs your attention, without the noise.
      </p>
      <SelectedAddTask full />

      <div className="tk-tabs">
        <span className="tk-tab is-active">All tasks</span>
        <span className="tk-tab">Open</span>
        <span className="tk-tab">Completed</span>
      </div>
      <span className="tk-tabs-meta">5 open tasks</span>

      <TaskSection title="Priority" tasks={PRIORITY_TASKS} />
      <TaskSection title="In progress" tasks={IN_PROGRESS_TASKS} />
    </div>
  );
}

export const DESIGN_TASKER_CSS = [
  // Palette. Fixed, not theme-derived: this is the user's design sitting on the
  // canvas, so it must look identical whether the editor around it is light or
  // dark — exactly like a real artboard.
  ".design-mock .tk { --tk-surface: #fbf9f5; --tk-card: #ffffff; --tk-ink: #24221e; --tk-ink-soft: rgba(36, 34, 30, 0.62); --tk-ink-faint: rgba(36, 34, 30, 0.42); --tk-line: rgba(36, 34, 30, 0.1); --tk-chip-bg: rgba(36, 34, 30, 0.06); --tk-priority-ink: #7d4b13; --tk-priority-bg: rgba(125, 75, 19, 0.1); }",
  ".design-mock .tk { width: 100%; height: 100%; overflow: hidden; background: var(--tk-surface); color: var(--tk-ink); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }",
  // The docs shell colors every h1-h4 and prose paragraph directly, so an
  // artboard heading would otherwise pick up the docs foreground instead of the
  // design's own ink. `currentColor` fills below depend on this.
  ".design-mock .tk h2, .design-mock .tk h3, .design-mock .tk p { color: inherit; }",

  ".design-mock .tk-desktop { display: flex; }",

  // Sidebar
  ".design-mock .tk-sidebar { display: flex; width: 200px; flex-shrink: 0; flex-direction: column; padding: 40px 24px; border-right: 1px solid var(--tk-line); }",
  ".design-mock .tk-wordmark { font-size: 28px; font-weight: 600; letter-spacing: -0.03em; }",
  ".design-mock .tk-tagline { margin-top: 10px; color: var(--tk-ink-faint); font-size: 13px; line-height: 1.45; }",
  ".design-mock .tk-nav { display: flex; flex-direction: column; gap: 4px; margin-top: 36px; }",
  ".design-mock .tk-nav-item { display: flex; height: 36px; align-items: center; justify-content: space-between; padding: 0 12px; border-radius: 8px; color: var(--tk-ink-soft); font-size: 16px; font-weight: 500; }",
  ".design-mock .tk-nav-item.is-active { background: var(--tk-chip-bg); color: var(--tk-ink); font-weight: 600; }",
  ".design-mock .tk-nav-count { color: var(--tk-ink-faint); font-size: 13px; font-variant-numeric: tabular-nums; }",
  ".design-mock .tk-sidebar-footer { display: flex; flex-direction: column; gap: 4px; margin-top: auto; padding-top: 24px; border-top: 1px solid var(--tk-line); }",
  ".design-mock .tk-sidebar-footer-label { color: var(--tk-ink-faint); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }",
  ".design-mock .tk-sidebar-footer-value { font-size: 15px; font-weight: 500; }",

  // Main column
  ".design-mock .tk-main { display: flex; flex: 1; min-width: 0; flex-direction: column; padding: 40px 48px; }",
  ".design-mock .tk-eyebrow { color: var(--tk-ink-faint); font-size: 13px; font-weight: 600; letter-spacing: 0.14em; line-height: 16px; text-transform: uppercase; }",
  ".design-mock .tk-headline { margin: 14px 0 0; font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; font-size: 64px; font-weight: 400; letter-spacing: -0.02em; line-height: 1.05; }",
  ".design-mock .tk-headline em { font-style: italic; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 6px; }",
  ".design-mock .tk-support { margin: 14px 0 0; max-width: 520px; color: var(--tk-ink-soft); font-size: 20px; line-height: 1.5; }",

  // The selected `+ Add task` element and its editor chrome.
  ".design-mock .tk-selected { position: relative; width: 120px; margin-top: 24px; }",
  ".design-mock .tk-selected.is-full { width: 100%; }",
  ".design-mock .tk-add { display: flex; height: 48px; align-items: center; justify-content: center; border-radius: 10px; background: var(--tk-ink); color: var(--tk-surface); font-size: 16px; font-weight: 600; }",
  `.design-mock .tk-sel-outline { position: absolute; inset: 0; border: ${inverse(1.5)} solid var(--dm-accent); border-radius: ${inverse(1)}; pointer-events: none; }`,
  `.design-mock .tk-sel-handle { position: absolute; z-index: 2; width: ${inverse(7)}; height: ${inverse(7)}; border: ${inverse(1)} solid var(--dm-accent); border-radius: ${inverse(1)}; background: #ffffff; }`,
  `.design-mock .tk-sel-handle-tl { left: ${inverse(-4)}; top: ${inverse(-4)}; }`,
  `.design-mock .tk-sel-handle-tr { right: ${inverse(-4)}; top: ${inverse(-4)}; }`,
  `.design-mock .tk-sel-handle-bl { left: ${inverse(-4)}; bottom: ${inverse(-4)}; }`,
  `.design-mock .tk-sel-handle-br { right: ${inverse(-4)}; bottom: ${inverse(-4)}; }`,
  `.design-mock .tk-sel-badge { position: absolute; left: 50%; top: calc(100% + ${inverse(6)}); z-index: 2; transform: translateX(-50%); padding: ${inverse(2)} ${inverse(6)}; border-radius: ${inverse(3)}; background: var(--dm-accent); color: var(--dm-accent-contrast); font-size: ${inverse(10)}; font-weight: 600; line-height: ${inverse(12)}; font-variant-numeric: tabular-nums; white-space: nowrap; }`,

  // Tabs
  // 60px, not the 28px the rhythm would suggest: the selection badge under the
  // `+ Add task` button hangs into this gap and would otherwise cover the tabs.
  ".design-mock .tk-tabs { display: flex; align-items: center; gap: 8px; margin-top: 60px; }",
  ".design-mock .tk-tab { display: flex; height: 40px; align-items: center; padding: 0 20px; border-radius: 999px; color: var(--tk-ink-soft); font-size: 16px; font-weight: 500; }",
  ".design-mock .tk-tab.is-active { background: var(--tk-ink); color: var(--tk-surface); font-weight: 600; }",
  ".design-mock .tk-tabs-meta { margin-left: auto; color: var(--tk-ink-faint); font-size: 14px; }",

  // Sections and cards
  ".design-mock .tk-section { margin-top: 32px; }",
  ".design-mock .tk-section-head { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--tk-line); }",
  ".design-mock .tk-section-title { margin: 0; font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; font-size: 30px; font-weight: 400; letter-spacing: -0.01em; }",
  ".design-mock .tk-section-count { color: var(--tk-ink-faint); font-size: 13px; font-variant-numeric: tabular-nums; }",
  ".design-mock .tk-section-body { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }",
  ".design-mock .tk-card { display: flex; flex-direction: column; gap: 14px; padding: 22px 24px; border: 1px solid var(--tk-line); border-radius: 14px; background: var(--tk-card); }",
  ".design-mock .tk-card-title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; }",
  ".design-mock .tk-card-meta { display: flex; align-items: center; gap: 8px; }",
  ".design-mock .tk-chip { display: flex; height: 24px; align-items: center; padding: 0 10px; border-radius: 999px; background: var(--tk-chip-bg); color: var(--tk-ink-soft); font-size: 13px; font-weight: 500; }",
  ".design-mock .tk-chip.is-priority { background: var(--tk-priority-bg); color: var(--tk-priority-ink); }",
  ".design-mock .tk-card-link { margin-left: auto; color: var(--tk-ink-faint); font-size: 13px; font-weight: 500; }",
  ".design-mock .tk-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 36px; padding-top: 20px; border-top: 1px solid var(--tk-line); color: var(--tk-ink-faint); font-size: 13px; }",

  // Mobile breakpoint. Same design, stacked, with the tabs meta on its own row
  // because 390px cannot carry it beside three pills.
  ".design-mock .tk-mobile { display: flex; flex-direction: column; padding: 28px 24px; }",
  ".design-mock .tk-mobile .tk-m-topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }",
  ".design-mock .tk-mobile .tk-m-menu { color: var(--tk-ink-soft); font-size: 15px; font-weight: 500; }",
  ".design-mock .tk-mobile .tk-headline { font-size: 40px; }",
  ".design-mock .tk-mobile .tk-support { max-width: none; font-size: 16px; }",
  ".design-mock .tk-mobile .tk-tabs { gap: 6px; }",
  ".design-mock .tk-mobile .tk-tab { height: 34px; padding: 0 14px; font-size: 14px; }",
  ".design-mock .tk-mobile .tk-tabs-meta { margin: 16px 0 0; }",
  ".design-mock .tk-mobile .tk-section-title { font-size: 24px; }",
  ".design-mock .tk-mobile .tk-card { padding: 18px; }",
  ".design-mock .tk-mobile .tk-card-title { font-size: 17px; }",
  ".design-mock .tk-mobile .tk-card-link { display: none; }",
].join("\n");
