// i18n-raw-literal-disable-file -- Static Dispatch artwork, not interactive UI.
import { AgentNativeIcon } from "@agent-native/core/client/ui";
import {
  IconActivity,
  IconAlertTriangle,
  IconApps,
  IconArrowUpRight,
  IconBolt,
  IconBrandSlack,
  IconCalendar,
  IconChartBar,
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconClipboardList,
  IconClock,
  IconDots,
  IconFileText,
  IconLayoutSidebarLeftCollapse,
  IconLayoutBoard,
  IconMail,
  IconMessageQuestion,
  IconPhoto,
  IconPlus,
  IconPresentation,
  IconSearch,
  IconSend,
  IconSettings,
  IconUsers,
  IconWaveSine,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import "./DispatchLandingMock.css";

export type DispatchLandingVariant =
  | "delegate-from-one-conversation"
  | "recurring-team-updates"
  | "investigate-agent-activity";

export function DispatchLandingMock({
  className = "",
  label,
  variant,
}: {
  className?: string;
  label: string;
  variant?: DispatchLandingVariant;
}) {
  return (
    <div
      className={
        "dispatch-landing-art dispatch-landing-art--" +
        (variant ?? "delegation") +
        (variant === undefined ? " dispatch-landing-art--hero" : "") +
        " " +
        className
      }
      role="img"
      aria-label={label}
    >
      <div className="dispatch-app-shell">
        {variant === undefined ? <DispatchSidebar /> : null}
        <main className="dispatch-app-main">
          {variant === "recurring-team-updates" ? <AutomationView /> : null}
          {variant === "investigate-agent-activity" ? <RunReviewView /> : null}
          {variant === undefined ||
          variant === "delegate-from-one-conversation" ? (
            <DelegationChat />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function DispatchSidebar() {
  return (
    <aside className="dispatch-app-nav">
      <div className="dispatch-brand">
        <AgentNativeIcon className="dispatch-brand-mark" aria-hidden="true" />
        <b>Dispatch</b>
        <span className="dispatch-nav-collapse" aria-hidden="true">
          <IconLayoutSidebarLeftCollapse />
        </span>
      </div>
      <div className="dispatch-nav-workspace">
        <span className="dispatch-workspace-mark">A</span>
        <span>Acme workspace</span>
        <IconChevronDown />
      </div>
      <nav aria-label="Dispatch">
        <div className="dispatch-nav-row">
          <IconActivity />
          <span>Overview</span>
        </div>
        <div className="dispatch-nav-row is-current">
          <IconMessageQuestion />
          <span>Chat</span>
          <i>3</i>
        </div>
        <div className="dispatch-nav-row">
          <IconApps />
          <span>Apps</span>
          <IconChevronDown className="dispatch-nav-disclosure" />
        </div>
        <div className="dispatch-nav-row">
          <IconUsers />
          <span>Agents</span>
        </div>
      </nav>
      <DispatchWorkspaceApps />
      <div className="dispatch-nav-footer">
        <div className="dispatch-nav-row">
          <IconSettings />
          <span>Admin</span>
        </div>
        <div className="dispatch-nav-row">
          <IconSettings />
          <span>Settings</span>
        </div>
        <div className="dispatch-user-profile">
          <span>MC</span>
          <div>
            <b>Maya Chen</b>
            <small>Acme workspace</small>
          </div>
          <IconDots />
        </div>
      </div>
    </aside>
  );
}

function DispatchWorkspaceApps() {
  const apps = [
    { id: "analytics", name: "Analytics", icon: <IconChartBar /> },
    { id: "assets", name: "Assets", icon: <IconPhoto /> },
    { id: "calendar", name: "Calendar", icon: <IconCalendar /> },
    { id: "content", name: "Content", icon: <IconFileText /> },
    { id: "forms", name: "Forms", icon: <IconClipboardList /> },
    { id: "mail", name: "Mail", icon: <IconMail /> },
    { id: "plan", name: "Plan", icon: <IconLayoutBoard /> },
    { id: "slides", name: "Slides", icon: <IconPresentation /> },
  ];

  return (
    <section className="dispatch-workspace-apps" aria-label="Workspace apps">
      <div className="dispatch-workspace-apps-heading">
        <span>Workspace apps</span>
        <IconPlus />
      </div>
      <ul>
        {apps.map((app) => (
          <li key={app.id}>
            <span
              className={
                "dispatch-workspace-app-icon dispatch-workspace-app-icon--" +
                app.id
              }
            >
              {app.icon}
            </span>
            <span>{app.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DelegationChat() {
  return (
    <section className="dispatch-chat-view">
      <div className="dispatch-chat-thread">
        <div className="dispatch-message dispatch-message--user">
          <p>
            Pull the latest signup trends, gather the customer feedback from
            Mail, and draft a concise launch update for Monday.
          </p>
          <span className="dispatch-message-avatar">MC</span>
        </div>
        <div className="dispatch-message dispatch-message--agent">
          <span className="dispatch-agent-mark">
            <AgentNativeIcon aria-hidden="true" />
          </span>
          <div className="dispatch-agent-response">
            <div className="dispatch-agent-label">
              <b>Dispatch</b>
              <span>·</span>
              <small>Worked across 3 apps</small>
            </div>
            <p>
              Signup momentum is up <strong>18%</strong>, led by the new team
              invite flow. I’ve checked the source data, gathered the latest
              customer themes, and started your update.
            </p>
            <div className="dispatch-task-card">
              <div className="dispatch-task-card-head">
                <span>DELEGATED WORK</span>
                <span className="dispatch-task-summary">
                  <IconCheck /> 1 of 3 complete
                </span>
              </div>
              <DispatchTask
                icon={<IconChartBar />}
                title="Compare signups"
                app="Analytics"
                description="30-day trend · activation by source"
                state="Complete"
                tone="done"
              />
              <DispatchTask
                icon={<IconMail />}
                title="Find launch feedback"
                app="Mail"
                description="Customer themes · latest 14 days"
                state="Working"
                tone="working"
              />
              <DispatchTask
                icon={<IconFileText />}
                title="Draft Monday update"
                app="Content"
                description="Pull in verified numbers and sources"
                state="Queued"
                tone="queued"
              />
            </div>
            <div className="dispatch-answer-card">
              <div className="dispatch-answer-heading">
                <span className="dispatch-answer-chart">
                  <IconWaveSine />
                </span>
                <span>
                  <b>Signup momentum is up 18%</b>
                  <small>Analytics · Oct 1–30 · 4,218 total signups</small>
                </span>
                <IconArrowUpRight />
              </div>
              <div className="dispatch-mini-chart" aria-hidden="true">
                <div className="dispatch-chart-axis">
                  <span>1.5k</span>
                  <span>1.0k</span>
                  <span>500</span>
                </div>
                <div className="dispatch-chart-bars">
                  {[24, 33, 30, 45, 42, 59, 65, 58, 76, 87, 82, 100].map(
                    (height, index) => (
                      <i
                        key={index}
                        className={index > 8 ? "is-highlight" : ""}
                        style={{ height: height + "%" }}
                      />
                    ),
                  )}
                </div>
                <div className="dispatch-chart-dates">
                  <span>Oct 1</span>
                  <span>Oct 15</span>
                  <span>Oct 30</span>
                </div>
              </div>
              <div className="dispatch-answer-note">
                Most of the lift came from the team invite flow.
                <span>
                  Open in Analytics <IconArrowUpRight />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ChatComposer />
    </section>
  );
}

function DispatchTask({
  icon,
  title,
  app,
  description,
  state,
  tone,
}: {
  icon: ReactNode;
  title: string;
  app: string;
  description?: string;
  state: string;
  tone: "done" | "working" | "queued";
}) {
  return (
    <div className="dispatch-task-row">
      <span
        className={
          "dispatch-task-icon dispatch-task-icon--" + app.toLowerCase()
        }
      >
        {icon}
      </span>
      <span className="dispatch-task-copy">
        <b>{title}</b>
        <small>
          {app}
          {description ? (
            <>
              {" "}
              <i>·</i> {description}
            </>
          ) : null}
        </small>
      </span>
      <span className={"dispatch-task-state is-" + tone}>
        {tone === "done" ? <IconCircleCheck /> : null}
        {tone === "working" ? <IconWaveSine /> : null}
        {state}
      </span>
    </div>
  );
}

function ChatComposer() {
  return (
    <div className="dispatch-composer-wrap">
      <div className="dispatch-composer">
        <div className="dispatch-composer-prompt">
          Ask Dispatch to coordinate work across your apps…
        </div>
        <div className="dispatch-composer-toolbar">
          <span className="dispatch-context-button">
            <IconPlus />
            Add context
          </span>
          <span className="dispatch-composer-divider" />
          <span className="dispatch-mode-button">
            <AgentNativeIcon />
            Dispatch
            <IconChevronDown />
          </span>
          <span className="dispatch-composer-spacer" />
          <span className="dispatch-composer-mode">Chat</span>
          <span className="dispatch-voice-button">
            <IconWaveSine />
          </span>
          <span className="dispatch-send-button">
            <IconSend />
          </span>
        </div>
      </div>
      <div className="dispatch-composer-footnote">
        Dispatch routes work to connected apps and keeps results in this thread.
      </div>
    </div>
  );
}

function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="dispatch-page-header">
      <h1>{title}</h1>
      <div className="dispatch-page-actions">
        {children}
        <span className="dispatch-page-agent-toggle">
          <AgentNativeIcon />
        </span>
      </div>
    </header>
  );
}

function AutomationView() {
  return (
    <div className="dispatch-ops-page">
      <PageHeader title="Automations" />
      <section className="dispatch-automation-view">
        <div className="dispatch-automation-toolbar">
          <div className="dispatch-automation-search">
            <IconSearch />
            <span>Search automations</span>
          </div>
          <span className="dispatch-enabled-count">
            <IconBolt />4 enabled <i>·</i> 1 needs review
          </span>
          <span className="dispatch-automation-filter">
            Dispatch automations <IconChevronDown />
          </span>
          <span className="dispatch-new-automation">
            <IconPlus />
            New automation
          </span>
        </div>
        <div className="dispatch-automation-grid">
          <div className="dispatch-automation-list">
            <AutomationRow
              selected
              title="Weekly growth pulse"
              schedule="Every Monday · 9:00 AM"
              target="Analytics → Slack · #growth"
              last="Last ran today at 9:00 AM"
              tone="on"
            />
            <AutomationRow
              title="Friday team digest"
              schedule="Every Friday · 3:00 PM"
              target="Mail → Slack · #team"
              last="Last ran Friday at 3:00 PM"
              tone="on"
            />
            <AutomationRow
              title="Trial account check-in"
              schedule="Every day · 11:00 AM"
              target="Analytics → Mail"
              last="Run needs review"
              tone="warning"
            />
          </div>
          <AutomationDetails />
        </div>
      </section>
    </div>
  );
}

function AutomationRow({
  title,
  schedule,
  target,
  last,
  tone,
  selected = false,
}: {
  title: string;
  schedule: string;
  target: string;
  last: string;
  tone: "on" | "warning";
  selected?: boolean;
}) {
  return (
    <div
      className={"dispatch-automation-row" + (selected ? " is-selected" : "")}
    >
      <div className="dispatch-automation-row-head">
        <span className={"dispatch-status-dot is-" + tone} />
        <b>{title}</b>
        <span className={"dispatch-status-badge is-" + tone}>
          {tone === "warning" ? "Needs review" : "Enabled"}
        </span>
      </div>
      <p>{schedule}</p>
      <small>{target}</small>
      <span className="dispatch-automation-last">{last}</span>
    </div>
  );
}

function AutomationDetails() {
  return (
    <aside className="dispatch-automation-details">
      <div className="dispatch-details-heading">
        <div className="dispatch-details-status">
          <span className="dispatch-status-dot is-on" />
          <span className="dispatch-status-badge is-on">Enabled</span>
        </div>
        <h2>Weekly growth pulse</h2>
        <p>Schedule · Workspace automation</p>
      </div>
      <div className="dispatch-details-body">
        <section className="dispatch-detail-section">
          <h3>Prompt</h3>
          <p className="dispatch-automation-prompt">
            Every Monday, summarize signups, activation, and top customer
            themes. Draft a sourced update for #growth and ask for approval
            before posting.
          </p>
        </section>
        <section className="dispatch-detail-section">
          <h3>Configuration</h3>
          <div className="dispatch-config-grid">
            <span>
              <small>Trigger</small>
              <b>Scheduled</b>
            </span>
            <span>
              <small>Schedule</small>
              <b>Mon · 9:00 AM</b>
            </span>
            <span>
              <small>Timezone</small>
              <b>America/Los_Angeles</b>
            </span>
            <span>
              <small>Destination</small>
              <b>
                <IconBrandSlack /> #growth
              </b>
            </span>
          </div>
        </section>
        <section className="dispatch-detail-section dispatch-last-run">
          <h3>
            Last run <span>Today, 9:00 AM</span>
          </h3>
          <p>
            <IconCircleCheck /> Completed in 1m 24s · awaiting approval
          </p>
        </section>
      </div>
    </aside>
  );
}

function RunReviewView() {
  return (
    <div className="dispatch-ops-page">
      <PageHeader title="Thread Debug">
        <span className="dispatch-debug-refresh">
          <IconActivity />
        </span>
      </PageHeader>
      <section className="dispatch-debug-view">
        <div className="dispatch-debug-tabs">
          <span className="is-active">Failed runs</span>
          <span>Threads</span>
        </div>
        <div className="dispatch-debug-filters">
          <div className="dispatch-debug-heading">
            <span>
              <b>Run health</b>
              <small>Start with the failure pattern, then inspect a run.</small>
            </span>
            <span className="dispatch-debug-refresh">
              <IconActivity />
            </span>
          </div>
          <div className="dispatch-filter-row">
            <span>
              Current Dispatch DB <IconChevronDown />
            </span>
            <span>
              All statuses <IconChevronDown />
            </span>
            <span>
              All run types <IconChevronDown />
            </span>
            <span>
              Last 24 hours <IconChevronDown />
            </span>
          </div>
        </div>
        <div className="dispatch-run-debug-grid">
          <section className="dispatch-failure-list">
            <div className="dispatch-failure-list-head">
              <span>
                <b>Needs attention</b>
                <small>2 runs ended unexpectedly</small>
              </span>
              <i>4</i>
            </div>
            <FailureRow
              selected
              title="Weekly growth pulse"
              status="Errored"
              time="Today · 9:01 AM"
              detail="Scheduled job · worker timeout"
            />
            <FailureRow
              title="Customer follow-up"
              status="Aborted"
              time="Today · 8:42 AM"
              detail="Interactive chat · stopped by owner"
            />
            <FailureRow
              title="Import Q4 leads"
              status="Errored"
              time="Yesterday · 4:16 PM"
              detail="Scheduled job · provider unavailable"
            />
          </section>
          <RunDetail />
        </div>
      </section>
    </div>
  );
}

function FailureRow({
  title,
  status,
  time,
  detail,
  selected = false,
}: {
  title: string;
  status: string;
  time: string;
  detail: string;
  selected?: boolean;
}) {
  return (
    <div className={"dispatch-failure-row" + (selected ? " is-selected" : "")}>
      <div className="dispatch-failure-title">
        <span
          className={
            "dispatch-run-status-dot " +
            (status === "Errored" ? "is-error" : "is-stopped")
          }
        />
        <b>{title}</b>
        <span className={"dispatch-run-status is-" + status.toLowerCase()}>
          {status}
        </span>
      </div>
      <small>{detail}</small>
      <span className="dispatch-failure-time">
        <IconClock /> {time}
      </span>
    </div>
  );
}

function RunDetail() {
  return (
    <section className="dispatch-run-detail">
      <div className="dispatch-run-detail-heading">
        <div>
          <span className="dispatch-run-status is-errored">Errored</span>
          <h2>Weekly growth pulse</h2>
          <p>
            Run <code>run-4c92b7</code> <i>·</i> Today at 9:00 AM
          </p>
        </div>
        <span className="dispatch-run-open">
          Open thread <IconArrowUpRight />
        </span>
      </div>
      <div className="dispatch-diagnosis">
        <div className="dispatch-diagnosis-mark">
          <IconAlertTriangle />
        </div>
        <div>
          <div className="dispatch-diagnosis-title">
            <b>Tool call failed during handoff</b>
            <code>TOOL_EXECUTION_FAILED</code>
          </div>
          <p>
            The analytics report was ready, but delivery stopped while Dispatch
            was preparing the Slack approval request.
          </p>
          <small>
            <b>Next check:</b> Inspect the last tool event and retry the
            delivery step.
          </small>
        </div>
      </div>
      <div className="dispatch-run-evidence">
        <span>
          <small>Run type</small>
          <b>Scheduled job</b>
        </span>
        <span>
          <small>Last heartbeat</small>
          <b>9:01:24 AM</b>
        </span>
        <span>
          <small>Worker stage</small>
          <b>Tool execution</b>
        </span>
        <span>
          <small>Evidence</small>
          <b>18 events · 3 tools</b>
        </span>
      </div>
      <div className="dispatch-run-timeline">
        <div className="dispatch-timeline-heading">
          <span>
            <IconActivity /> Run timeline
          </span>
          <small>18 events retained · 3 tool starts</small>
        </div>
        <TimelineRow
          state="done"
          time="09:00:02"
          title="Schedule trigger received"
          detail="Weekly growth pulse · Monday 9:00 AM"
        />
        <TimelineRow
          state="done"
          time="09:00:14"
          title="Read Analytics summary"
          detail="Activation +18% · 30-day date range"
        />
        <TimelineRow
          state="error"
          time="09:01:24"
          title="Prepare approval in Slack"
          detail="Tool execution failed · delivery not sent"
        />
      </div>
    </section>
  );
}

function TimelineRow({
  state,
  time,
  title,
  detail,
}: {
  state: "done" | "error";
  time: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="dispatch-timeline-row">
      <span className={"dispatch-timeline-icon is-" + state}>
        {state === "done" ? <IconCheck /> : <IconAlertTriangle />}
      </span>
      <span className="dispatch-timeline-time">{time}</span>
      <span className="dispatch-timeline-copy">
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      {state === "error" ? (
        <IconAlertTriangle className="dispatch-timeline-warning" />
      ) : null}
    </div>
  );
}
