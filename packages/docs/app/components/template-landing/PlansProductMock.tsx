// i18n-raw-literal-disable-file -- Static Plans artwork, not interactive UI.
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconCheck,
  IconDots,
  IconLayoutSidebarRight,
  IconMessageCircle,
  IconPlus,
  IconShare3,
} from "@tabler/icons-react";

import "./PlansProductMock.css";

type PlansProductMockProps = {
  label: string;
  variant?: "architecture" | "interface" | "recap";
  className?: string;
};

export function PlansProductMock({
  label,
  variant,
  className = "",
}: PlansProductMockProps) {
  const resolvedVariant = variant ?? "architecture";
  return (
    <div
      className={
        "plans-product-art plans-product-art--" +
        resolvedVariant +
        (variant === undefined ? " plans-product-art--hero" : "") +
        " " +
        className
      }
      role="img"
      aria-label={label}
    >
      <div className="plans-floating-tools">
        {variant !== "recap" ? (
          <span className="plans-back-button" aria-hidden="true">
            <IconArrowLeft />
          </span>
        ) : null}
        <div className="plans-toolbar-group">
          <span className="plans-toolbar-button">
            <IconShare3 />
            Share
          </span>
          {variant !== "recap" ? (
            <span className="plans-toolbar-icon" aria-hidden="true">
              <IconMessageCircle />
              <i>2</i>
            </span>
          ) : null}
          <span className="plans-toolbar-icon" aria-hidden="true">
            <IconDots />
          </span>
          {variant !== "recap" ? (
            <span className="plans-toolbar-icon" aria-hidden="true">
              <IconLayoutSidebarRight />
            </span>
          ) : null}
        </div>
      </div>

      {resolvedVariant === "architecture" ? (
        <TodayViewPlan showAllScreens={variant === undefined} />
      ) : null}
      {resolvedVariant === "interface" ? <HabitDetailPlan /> : null}
      {resolvedVariant === "recap" ? <RecapPlan /> : null}
    </div>
  );
}

function TodayViewPlan({
  showAllScreens = false,
}: {
  showAllScreens?: boolean;
}) {
  return (
    <>
      <section className="plans-canvas plans-canvas--wireframe">
        <div className="plans-board-note">
          <span>CANVAS</span>
          <span>
            {showAllScreens
              ? "Personal Habit Tracker · 3 screens"
              : "Today view · Mobile"}
          </span>
        </div>
        {showAllScreens ? (
          <div className="plans-canvas-artboard-strip">
            <PlanCanvasArtboard index="01" label="Today view" screen="today" />
            <PlanCanvasArtboard
              index="02"
              label="Habit detail"
              screen="detail"
            />
            <PlanCanvasArtboard
              index="03"
              label="Weekly stats"
              screen="stats"
            />
          </div>
        ) : (
          <>
            <PhoneFrame screen="today" />
            <div className="plans-canvas-annotation">
              <span>01</span>
              <div>
                <b>Today view</b>
                <small>Mark a habit done in one tap.</small>
              </div>
            </div>
          </>
        )}
        <ZoomControls />
      </section>
      <PlanDocument kind="today" />
    </>
  );
}

function HabitDetailPlan() {
  return (
    <>
      <section className="plans-canvas plans-canvas--prototype">
        <div className="plans-prototype-tabs">
          <span className="is-selected">Prototype</span>
          <span>Wireframes</span>
        </div>
        <div className="plans-prototype-caption">
          <span className="plans-prototype-dot" />
          Habit detail · 30-day history
        </div>
        <PhoneFrame screen="detail" />
        <div className="plans-canvas-annotation plans-canvas-annotation--detail">
          <span>02</span>
          <div>
            <b>Keep the streak in context</b>
            <small>Scheduled days are distinct from missed days.</small>
          </div>
        </div>
        <ZoomControls />
      </section>
      <PlanDocument kind="detail" />
    </>
  );
}

function ZoomControls() {
  return (
    <div className="plans-zoom-controls" aria-hidden="true">
      <span>−</span>
      <b>68%</b>
      <span>+</span>
    </div>
  );
}

function PlanCanvasArtboard({
  index,
  label,
  screen,
}: {
  index: string;
  label: string;
  screen: "today" | "detail" | "stats";
}) {
  return (
    <div className="plans-canvas-artboard">
      <div className="plans-canvas-artboard-label">
        <span>{index}</span>
        <b>{label}</b>
        <small>Mobile</small>
      </div>
      <PhoneFrame screen={screen} canvas />
    </div>
  );
}

function PhoneFrame({
  screen,
  canvas = false,
}: {
  screen: "today" | "detail" | "stats";
  canvas?: boolean;
}) {
  return (
    <div
      className={
        "plans-phone plans-phone--" +
        screen +
        (canvas ? " plans-phone--canvas" : "")
      }
    >
      <div className="plans-phone-status">
        <b>9:41</b>
        <span>●●● &nbsp; ▰</span>
      </div>
      {screen === "today" ? <TodayScreen /> : null}
      {screen === "detail" ? <HabitDetailScreen /> : null}
      {screen === "stats" ? <WeeklyStatsScreen /> : null}
    </div>
  );
}

function TodayScreen() {
  return (
    <div className="plans-today-screen">
      <div className="plans-mobile-heading">
        <div>
          <small>FRIDAY, JUNE 6</small>
          <h2>Today</h2>
        </div>
        <span className="plans-add-habit">
          <IconPlus />
          Add Habit
        </span>
      </div>
      <div className="plans-progress-card">
        <div>
          <small>DAILY PROGRESS</small>
          <b>
            5 <i>of 7 done</i>
          </b>
        </div>
        <div className="plans-progress-ring">
          <b>71%</b>
        </div>
      </div>
      <div className="plans-habit-heading">
        <b>HABITS</b>
        <span>
          4-day streak <i>↗</i>
        </span>
      </div>
      <HabitRow title="Morning run" note="7:00 AM" checked color="blue" />
      <HabitRow title="Read 20 pages" note="Any time" checked color="violet" />
      <HabitRow title="Meditate" note="10 min" color="green" />
      <HabitRow title="No sugar" note="All day" color="amber" />
      <HabitRow title="Drink 2L water" note="Goal" checked color="blue" />
      <div className="plans-habit-heading plans-habit-heading--completed">
        <b>COMPLETED</b>
      </div>
      <HabitRow title="Journaling" checked color="violet" />
      <HabitRow title="Cold shower" checked color="green" />
    </div>
  );
}

function HabitDetailScreen() {
  return (
    <div className="plans-detail-screen">
      <div className="plans-detail-top">
        <span className="plans-back-chevron">‹</span>
        <span>Habit detail</span>
        <IconDots />
      </div>
      <div className="plans-detail-title">
        <span className="plans-habit-glyph plans-habit-glyph--green">✦</span>
        <div>
          <small>DAILY · ANY TIME</small>
          <h2>Meditate</h2>
        </div>
      </div>
      <div className="plans-streak-card">
        <span>
          <b>12 days</b>
          <small>Current streak</small>
        </span>
        <span>
          <b>28 days</b>
          <small>Best streak</small>
        </span>
      </div>
      <div className="plans-history-heading">
        <b>Last 30 days</b>
        <span>May 7 – Jun 6</span>
      </div>
      <div className="plans-heatmap" aria-hidden="true">
        {Array.from({ length: 30 }, (_, index) => (
          <i
            key={index}
            className={
              index % 9 === 3 || index % 11 === 7
                ? "is-unscheduled"
                : index > 25
                  ? "is-today"
                  : index % 7 === 4
                    ? "is-missed"
                    : "is-done"
            }
          />
        ))}
      </div>
      <div className="plans-heatmap-legend">
        <span>
          <i className="is-done" /> Done
        </span>
        <span>
          <i className="is-missed" /> Missed
        </span>
        <span>
          <i className="is-unscheduled" /> Not scheduled
        </span>
      </div>
      <div className="plans-detail-action">
        <IconCheck />
        Mark today complete
      </div>
    </div>
  );
}

function WeeklyStatsScreen() {
  return (
    <div className="plans-stats-screen">
      <div className="plans-stats-heading">
        <span>WEEKLY STATS</span>
        <b>Jun 2–8</b>
      </div>
      <h2>This week</h2>
      <div className="plans-stats-summary">
        <span>
          <b>82%</b>
          <small>completion</small>
        </span>
        <span>
          <b>29 / 35</b>
          <small>habits done</small>
        </span>
      </div>
      <div className="plans-stats-chart-heading">
        <b>Daily completion</b>
        <span>+12% vs last week</span>
      </div>
      <div className="plans-stats-chart" aria-hidden="true">
        {[54, 76, 63, 88, 72, 94, 82].map((height, index) => (
          <span key={index}>
            <i style={{ height: height + "%" }} />
            <small>{["M", "T", "W", "T", "F", "S", "S"][index]}</small>
          </span>
        ))}
      </div>
      <div className="plans-stats-habits-heading">
        <b>By habit</b>
        <span>Last 7 days</span>
      </div>
      <StatsHabitRow title="Morning run" pattern="111n011" />
      <StatsHabitRow title="Read 20 pages" pattern="1111110" />
      <StatsHabitRow title="Meditate" pattern="1101111" />
      <div className="plans-stats-legend">
        <span>
          <i className="is-done" /> Done
        </span>
        <span>
          <i className="is-missed" /> Missed
        </span>
        <span>
          <i className="is-unscheduled" /> Not scheduled
        </span>
      </div>
    </div>
  );
}

function StatsHabitRow({ title, pattern }: { title: string; pattern: string }) {
  return (
    <div className="plans-stats-habit-row">
      <b>{title}</b>
      <span aria-hidden="true">
        {pattern.split("").map((day, index) => (
          <i
            key={index}
            className={
              day === "1"
                ? "is-done"
                : day === "n"
                  ? "is-unscheduled"
                  : "is-missed"
            }
          />
        ))}
      </span>
    </div>
  );
}

function HabitRow({
  title,
  note,
  checked = false,
  color,
}: {
  title: string;
  note?: string;
  checked?: boolean;
  color: "blue" | "violet" | "green" | "amber";
}) {
  const glyph =
    color === "blue"
      ? "↗"
      : color === "violet"
        ? "▤"
        : color === "green"
          ? "✦"
          : "○";
  return (
    <div className="plans-habit-row">
      <span className={"plans-habit-glyph plans-habit-glyph--" + color}>
        {glyph}
      </span>
      <span className="plans-habit-copy">
        <b>{title}</b>
        {note ? <small>{note}</small> : null}
      </span>
      <span className={"plans-habit-check" + (checked ? " is-checked" : "")}>
        {checked ? <IconCheck /> : null}
      </span>
    </div>
  );
}

function PlanDocument({ kind }: { kind: "today" | "detail" }) {
  return (
    <section className="plans-document-region">
      <article className="plans-document">
        <div className="plans-document-kicker">VISUAL PLAN</div>
        <h1>Personal Habit Tracker</h1>
        <p className="plans-document-brief">
          A mobile habit-tracking app with three key screens: Today view, Habit
          detail, and Weekly stats.
        </p>
        <div className="plans-document-content">
          <h2>{kind === "today" ? "Goal" : "Habit detail"}</h2>
          <p>
            {kind === "today"
              ? "Build a focused daily loop: see what is due, check it off in one tap, and understand progress without slowing down."
              : "See a habit’s schedule and 30-day completion history. Separate completed, missed, and not-scheduled days so a broken streak is clear at a glance."}
          </p>
          <div className="plans-document-section">
            <span>01</span>
            <div>
              <h3>{kind === "today" ? "Today view" : "Thirty-day history"}</h3>
              <p>
                {kind === "today"
                  ? "A progress summary and a short list of habits due today. Tapping the check circle toggles completion without leaving the screen."
                  : "A five-by-six completion calendar keeps history compact, with streak and longest-streak counters above it."}
              </p>
            </div>
          </div>
          <div className="plans-document-section plans-document-section--muted">
            <span>02</span>
            <div>
              <h3>{kind === "today" ? "Habit detail" : "Weekly stats"}</h3>
              <p>
                {kind === "today"
                  ? "A schedule, 30-day heatmap, and streak history for each routine."
                  : "Compare completion by day, then see each habit’s seven-day pattern."}
              </p>
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}

function RecapPlan() {
  return (
    <section className="plans-recap-region">
      <article className="plans-recap-document">
        <div className="plans-recap-heading">
          <div className="plans-document-kicker">VISUAL RECAP</div>
          <span className="plans-recap-source">
            <IconArrowUpRight />
            agent-native / framework · PR #5824
          </span>
        </div>
        <h1>Habit history now respects scheduled days</h1>
        <p className="plans-recap-brief">
          A reviewable summary of the change, the files it touched, and the
          behavior to verify.
        </p>
        <div className="plans-recap-stats">
          <span>
            <b>3</b> files changed
          </span>
          <span>
            <b>2</b> comments resolved
          </span>
          <span className="plans-recap-merged">
            <i /> Merged
          </span>
        </div>
        <div className="plans-recap-files">
          <div className="plans-recap-file-row is-selected">
            <span className="plans-file-mark">TS</span>
            <b>habit-history.ts</b>
            <small>+18&nbsp; −4</small>
          </div>
          <div className="plans-recap-file-row">
            <span className="plans-file-mark">TS</span>
            <b>weekly-stats.ts</b>
            <small>+11&nbsp; −2</small>
          </div>
          <div className="plans-recap-file-row">
            <span className="plans-file-mark">TS</span>
            <b>habit-history.spec.ts</b>
            <small>+26&nbsp; −0</small>
          </div>
        </div>
        <div className="plans-recap-diff">
          <header>
            <span>habit-history.ts</span>
            <span>Updated · 2 days ago</span>
          </header>
          <pre>
            <span className="is-context"> const day = calendar[index];</span>
            <span className="is-removed">
              - return completions.has(day.date);
            </span>
            <span className="is-added">
              + if (!day.scheduled) return "not-scheduled";
            </span>
            <span className="is-added">
              + return completions.has(day.date) ? "done" : "missed";
            </span>
            <span className="is-context"> return history;</span>
          </pre>
        </div>
        <div className="plans-recap-comment">
          <span>MC</span>
          <p>
            <b>Maya Chen</b> · Scheduled days now stay out of the streak count.
          </p>
          <IconCheck />
        </div>
      </article>
    </section>
  );
}
