// i18n-raw-literal-disable-file -- Static Content artwork, not interactive UI.
import "./ContentLandingMock.css";
import {
  IconChevronDown,
  IconClock,
  IconDatabase,
  IconFileText,
  IconFolderOpen,
  IconPin,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";

import { LogoMark } from "../website-redesign/ds/logo-mark";

export type ContentLandingVariant =
  | "write-and-review-content"
  | "track-work-with-agents"
  | "collect-project-requests";

export function ContentLandingMock({
  className = "",
  label,
  variant,
  sidebarCollapsed = false,
}: {
  className?: string;
  label: string;
  variant?: ContentLandingVariant;
  sidebarCollapsed?: boolean;
}) {
  return (
    <div
      className={`content-landing-art content-landing-art--${variant ?? "document"}${sidebarCollapsed ? " content-landing-art--sidebar-collapsed" : ""} ${className}`}
      role="img"
      aria-label={label}
    >
      <div className="content-app-shell">
        <nav className="content-app-nav">
          <div className="content-brand">
            <LogoMark />
            <b>Content</b>
            <span className="content-brand-control">‹</span>
          </div>
          <div className="content-workspace">
            <span className="content-workspace-avatar">N</span>
            <b>Northstar Studio</b>
            <i>⌄</i>
          </div>
          <div className="content-nav-utilities">
            <div className="content-nav-row">
              <IconSearch />
              <span className="content-nav-copy">Search</span>
              <kbd>⌘ K</kbd>
            </div>
            <div className="content-nav-row">
              <IconPlus />
              <span className="content-nav-copy">New page</span>
            </div>
          </div>
          <div className="content-nav-section">
            <div className="content-nav-section-heading">
              <span>Favorites</span>
              <IconPlus />
            </div>
            <div className="content-nav-row">
              <IconPin />
              <span className="content-nav-copy">Q4 launch brief</span>
            </div>
            <div className="content-nav-row">
              <IconPin />
              <span className="content-nav-copy">Product roadmap</span>
            </div>
          </div>
          <div className="content-nav-section">
            <div className="content-nav-section-heading">
              <span>Recent</span>
              <IconPlus />
            </div>
            <div className="content-nav-row">
              <IconClock />
              <span className="content-nav-copy">Launch goals</span>
            </div>
            <div className="content-nav-row">
              <IconClock />
              <span className="content-nav-copy">Customer interviews</span>
            </div>
          </div>
          <div className="content-nav-section content-nav-section--files">
            <div className="content-nav-section-heading">
              <span>Private</span>
              <IconPlus />
            </div>
            <div className="content-nav-row is-active">
              <IconFolderOpen />
              <span className="content-nav-copy">Projects</span>
              <IconChevronDown className="content-nav-chevron" />
            </div>
            <div className="content-nav-nested">
              <div>
                <IconFileText /> Launch plan
              </div>
              <div>
                <IconFileText /> Product research
              </div>
            </div>
            <div className="content-nav-row">
              <IconDatabase />
              <span className="content-nav-copy">Databases</span>
            </div>
          </div>
          <div className="content-app-profile">
            <span>JM</span>
            <small>Jamie Morgan</small>
          </div>
        </nav>
        <main className="content-app-main">
          <header className="content-app-toolbar">
            <div className="content-breadcrumb">
              Projects <span>/</span>{" "}
              {variant === "track-work-with-agents"
                ? "Product roadmap"
                : variant === "collect-project-requests"
                  ? "Design requests"
                  : "Q4 launch brief"}
            </div>
            <div className="content-toolbar-actions">
              <span>Edited 2m ago</span>
              <span>Share</span>
              <i>JM</i>
            </div>
          </header>
          {variant === "track-work-with-agents" ? <TaskWorkspace /> : null}
          {variant === "collect-project-requests" ? <RequestWorkspace /> : null}
          {variant === undefined || variant === "write-and-review-content" ? (
            <DocumentWorkspace />
          ) : null}
        </main>
        <aside className="content-agent-sidebar">
          {variant === "collect-project-requests" ? (
            <RequestAgent />
          ) : variant === "track-work-with-agents" ? (
            <TaskAgent />
          ) : (
            <WritingAgent />
          )}
        </aside>
      </div>
    </div>
  );
}

function DocumentWorkspace() {
  return (
    <article className="content-document">
      <div className="content-doc-toolbar">
        <span>↶</span>
        <span>↷</span>
        <i />
        <span>Normal text ⌄</span>
        <span>B</span>
        <span>
          <em>I</em>
        </span>
        <span>↗</span>
        <span className="content-doc-toolbar-spacer" />
        <span className="content-comment-control">
          Comments <b>2</b>
        </span>
      </div>
      <div className="content-doc-layout">
        <div className="content-doc-body">
          <div className="content-doc-cover">
            <span>FIELD NOTES / OCTOBER 2026</span>
            <i />
            <i />
            <i />
          </div>
          <div className="content-doc-content">
            <div className="content-doc-icon">↗</div>
            <h2>Q4 launch brief</h2>
            <div className="content-doc-byline">
              <span>Jamie Morgan</span>
              <i /> Edited today <i /> 6 min read
            </div>
            <div className="content-doc-toc">
              <small>ON THIS PAGE</small>
              <span>Launch goals</span>
              <span>What we learned</span>
              <span>First week rollout</span>
            </div>
            <h3>Launch goals</h3>
            <p>
              Help new teams reach their first shared workspace faster. The
              invite flow is the first moment where the product starts to feel
              collaborative.
            </p>
            <blockquote>
              Make the next step obvious, especially when a teammate joins from
              a link.
            </blockquote>
            <h3>What we learned</h3>
            <p>
              Teams with two or more members are{" "}
              <mark>18% more likely to complete setup</mark> in their first
              session.
            </p>
            <div className="content-doc-inline-comment">
              <span>2</span>
              <p>
                <b>Codex · Suggested edit</b>Clarify whether invited teammates
                inherit the owner's role.
              </p>
            </div>
          </div>
        </div>
        <div className="content-doc-outline">
          <small>DOCUMENT</small>
          <b>Q4 launch brief</b>
          <span>Launch goals</span>
          <span>What we learned</span>
          <span>First week rollout</span>
          <div className="content-doc-outline-meta">
            <small>PAGE DETAILS</small>
            <span>
              Owner <b>Jamie</b>
            </span>
            <span>
              Updated <b>Oct 6</b>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function TaskWorkspace() {
  return (
    <section className="content-database">
      <div className="content-database-heading">
        <div>
          <small>PROJECT DATABASE</small>
          <h2>Product roadmap</h2>
          <p>Next steps across the launch team.</p>
        </div>
        <span>＋ New task</span>
      </div>
      <div className="content-database-toolbar">
        <b>All work</b>
        <span>Board</span>
        <span>Calendar</span>
        <i />
        <span>Filter</span>
        <span>Sort</span>
      </div>
      <div className="content-table">
        <div className="content-table-head">
          <span>TASK</span>
          <span>OWNER</span>
          <span>STATUS</span>
          <span>DUE DATE</span>
        </div>
        <div className="content-table-row">
          <span>
            <i className="content-checkbox is-checked">✓</i>
            <b>Map invite acceptance flow</b>
          </span>
          <span>
            <i className="content-person person-jm">JM</i> Jamie
          </span>
          <span>
            <em className="status-done">Done</em>
          </span>
          <span>Oct 3</span>
        </div>
        <div className="content-table-row">
          <span>
            <i className="content-checkbox" />
            <b>Update welcome email</b>
            <small>Agent drafted copy from launch brief</small>
          </span>
          <span>
            <i className="content-person person-cx">CX</i> Customer
          </span>
          <span>
            <em className="status-review">Review</em>
          </span>
          <span>Oct 8</span>
        </div>
        <div className="content-table-row content-task-highlight">
          <span>
            <i className="content-checkbox" />
            <b>Publish invite guide</b>
            <small>Depends on the new setup flow</small>
          </span>
          <span>
            <i className="content-person person-ai">AI</i> Codex
          </span>
          <span>
            <em className="status-progress">In progress</em>
          </span>
          <span>Oct 10</span>
        </div>
        <div className="content-table-row">
          <span>
            <i className="content-checkbox" />
            <b>Share launch notes with sales</b>
          </span>
          <span>
            <i className="content-person person-rk">RK</i> Riley
          </span>
          <span>
            <em className="status-planned">Planned</em>
          </span>
          <span>Oct 14</span>
        </div>
        <div className="content-table-empty">＋ Add a task</div>
      </div>
      <div className="content-database-instruction">
        <span>✧</span>
        <b>Agent instructions</b>
        <p>
          When marking a task complete, add a short result to its page and link
          any source doc.
        </p>
        <small>Used by Codex and the built-in agent</small>
      </div>
    </section>
  );
}

function RequestWorkspace() {
  return (
    <section className="content-database content-request-workspace">
      <div className="content-database-heading">
        <div>
          <small>TEAM REQUESTS · 12 OPEN</small>
          <h2>Design requests</h2>
          <p>Each request has a page for its brief and discussion.</p>
        </div>
        <span>＋ New request</span>
      </div>
      <div className="content-database-toolbar">
        <b>Needs review</b>
        <span>All requests</span>
        <span>Board</span>
        <i />
        <span>Filter</span>
      </div>
      <div className="content-request-cards">
        <div className="content-request-card is-priority">
          <div>
            <span>WEBSITE</span>
            <em>High priority</em>
          </div>
          <h3>New pricing comparison page</h3>
          <p>We need a side-by-side feature view for the sales team.</p>
          <div>
            <i className="content-person person-rk">RK</i>
            <span>Riley K. · Oct 5</span>
            <b>Missing: audience</b>
          </div>
        </div>
        <div className="content-request-card">
          <div>
            <span>ONBOARDING</span>
            <em>Normal</em>
          </div>
          <h3>Update first-run checklist</h3>
          <p>Add a path for teams importing existing docs.</p>
          <div>
            <i className="content-person person-jm">JM</i>
            <span>Jamie M. · Oct 4</span>
            <b className="request-complete">Brief ready</b>
          </div>
        </div>
        <div className="content-request-card">
          <div>
            <span>BRAND</span>
            <em>Normal</em>
          </div>
          <h3>Refresh partner kit</h3>
          <p>Need updated screenshots before the event.</p>
          <div>
            <i className="content-person person-cx">CX</i>
            <span>Customer team · Oct 2</span>
            <b className="request-complete">Brief ready</b>
          </div>
        </div>
      </div>
      <div className="content-request-instruction">
        <b>Design request · Field guidance</b>
        <span>Audience</span>
        <p>Ask which customers this is for if the request doesn't say.</p>
      </div>
    </section>
  );
}

function WritingAgent() {
  return (
    <ContentAgent title="Q4 launch brief" subtitle="Connected to this document">
      <div className="content-agent-user">
        Review the invite section. Leave a comment if you find a missing
        decision.
      </div>
      <div className="content-agent-response">
        <b>
          <span>AI</span> Codex
        </b>
        <p>
          I found one detail to confirm before implementation: should invited
          teammates use a preset role, or can the owner choose one?
        </p>
        <div className="content-agent-link">↗ Comment on “Launch goals”</div>
      </div>
      <div className="content-agent-note">
        <small>DOCUMENT CONTEXT</small>
        <p>Q4 launch brief · “First week rollout”</p>
        <span>Read only until you ask for an edit</span>
      </div>
      <div className="content-agent-composer">
        Ask about this page… <b>↑</b>
      </div>
    </ContentAgent>
  );
}

function TaskAgent() {
  return (
    <ContentAgent
      title="Product roadmap"
      subtitle="Agent updated this database"
    >
      <div className="content-agent-user">
        Move the invite guide behind the email update and add the source page.
      </div>
      <div className="content-agent-response">
        <b>
          <span>AI</span> Codex
        </b>
        <p>
          Updated the dependency and linked the welcome email draft. The task
          now reflects the launch brief's rollout order.
        </p>
        <div className="content-agent-change">
          <i>↗</i>
          <div>
            <b>Publish invite guide</b>
            <small>Due Oct 10 · In progress</small>
          </div>
        </div>
      </div>
      <div className="content-agent-note">
        <small>FIELD INSTRUCTION</small>
        <p>Link the source doc when updating a task.</p>
        <span>Applied to this database</span>
      </div>
      <div className="content-agent-composer">
        Ask about this project… <b>↑</b>
      </div>
    </ContentAgent>
  );
}

function RequestAgent() {
  return (
    <ContentAgent
      title="Design requests"
      subtitle="Helping complete each brief"
    >
      <div className="content-agent-user">Which requests need more detail?</div>
      <div className="content-agent-response">
        <b>
          <span>AI</span> Content agent
        </b>
        <p>
          “New pricing comparison page” needs an audience before design can
          start. The field instruction says to ask when it is missing.
        </p>
        <div className="content-agent-change">
          <i>!</i>
          <div>
            <b>1 detail missing</b>
            <small>Audience · New pricing comparison</small>
          </div>
        </div>
        <div className="content-agent-inline-action">
          Draft a question for Riley
        </div>
      </div>
      <div className="content-agent-note">
        <small>REQUEST PAGE</small>
        <p>Requirements, owner, due date, and discussion stay together.</p>
        <span>Page linked to this database row</span>
      </div>
      <div className="content-agent-composer">
        Ask about requests… <b>↑</b>
      </div>
    </ContentAgent>
  );
}

function ContentAgent({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="content-agent-head">
        <span>AI</span>
        <div>
          <b>{title}</b>
          <small>{subtitle}</small>
        </div>
        <i>···</i>
      </div>
      <div className="content-agent-body">{children}</div>
    </>
  );
}
