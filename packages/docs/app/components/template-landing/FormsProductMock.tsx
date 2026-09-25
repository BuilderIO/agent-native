// i18n-raw-literal-disable-file -- Static Forms artwork, not interactive UI.
import "./FormsProductMock.css";
import { LogoMark } from "../website-redesign/ds/logo-mark";

type FormsProductMockProps = {
  label: string;
  variant?: "feedback" | "registration" | "request";
  sidebarCollapsed?: boolean;
  className?: string;
};

export function FormsProductMock({
  label,
  variant = "feedback",
  sidebarCollapsed = false,
  className = "",
}: FormsProductMockProps) {
  return (
    <div
      className={`forms-product-art forms-product-art--${variant}${sidebarCollapsed ? " forms-product-art--sidebar-collapsed" : ""} ${className}`}
      role="img"
      aria-label={label}
    >
      <div className="forms-product-shell">
        <nav className="forms-product-nav">
          <div className="forms-product-brand">
            <LogoMark />
            <b>Forms</b>
          </div>
          <div className="forms-product-workspace">
            Acme workspace <span>⌄</span>
          </div>
          <div className="forms-nav-label">WORKSPACE</div>
          <div className="forms-nav-item is-active">
            <span aria-hidden="true">▤</span>
            <span className="forms-nav-copy">My forms</span>
            <b>8</b>
          </div>
          <div className="forms-nav-item">
            <span aria-hidden="true">◉</span>
            <span className="forms-nav-copy">Shared with me</span>
          </div>
          <div className="forms-nav-label forms-nav-label--spaced">RECENT</div>
          <div className="forms-recent-item">
            <i /> Customer feedback
          </div>
          <div className="forms-recent-item">
            <i /> Product waitlist
          </div>
          <div className="forms-recent-item">
            <i /> Design request
          </div>
          <div className="forms-product-profile">
            <span>JM</span>
            <small>Jamie Morgan</small>
          </div>
        </nav>
        <main className="forms-product-main">
          <header className="forms-product-toolbar">
            <div className="forms-product-breadcrumb">
              My forms <span>/</span>{" "}
              {variant === "request"
                ? "Design request"
                : variant === "registration"
                  ? "Product launch RSVP"
                  : "Customer feedback"}
            </div>
            <div className="forms-toolbar-actions">
              <span className="forms-published">Published</span>
              <span className="forms-share">Share form</span>
            </div>
          </header>
          <div className="forms-product-tabs">
            <span className={variant === "request" ? "" : "is-active"}>
              Edit
            </span>
            <span className={variant === "request" ? "is-active" : ""}>
              Responses <b>128</b>
            </span>
            <span>Settings</span>
            <span className="forms-tab-spacer" />
            <span className="forms-preview-button">Preview</span>
          </div>
          {variant === "feedback" ? <FeedbackBuilder /> : null}
          {variant === "registration" ? <RegistrationPreview /> : null}
          {variant === "request" ? <ResponseReview /> : null}
        </main>
        <aside className="forms-product-agent">
          {variant === "request" ? <ResponseAgent /> : <BuilderAgent />}
        </aside>
      </div>
    </div>
  );
}

function FeedbackBuilder() {
  return (
    <div className="forms-builder-layout">
      <section className="forms-builder-canvas">
        <div className="forms-form-title">
          <small>FORM TITLE</small>
          <h2>How was your experience?</h2>
          <p>Your feedback helps us make the product better.</p>
        </div>
        <div className="forms-builder-field">
          <div className="forms-field-controls">
            <span>☷</span>
            <small>SHORT TEXT</small>
            <span className="forms-control-dots">···</span>
          </div>
          <b>What should we call you?</b>
          <div className="forms-field-input">
            Your name <i />
          </div>
        </div>
        <div className="forms-builder-field is-selected">
          <div className="forms-field-controls">
            <span>☷</span>
            <small>RATING</small>
            <span className="forms-control-dots">···</span>
          </div>
          <b>How likely are you to recommend us?</b>
          <div className="forms-rating-options">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span className="is-choice">5</span>
          </div>
          <div className="forms-required">
            <span>Required</span>
            <span>Scale · 1 to 5</span>
          </div>
        </div>
        <div className="forms-add-field">
          ＋ Add a question <span>Use a field suggestion</span>
        </div>
        <div className="forms-builder-footer">
          <span>128 responses</span>
          <span>Live link · forms.agent-native.com/f/feedback</span>
        </div>
      </section>
      <div className="forms-properties">
        <div className="forms-properties-header">
          Selected field <span>×</span>
        </div>
        <small>QUESTION LABEL</small>
        <div className="forms-property-input">
          How likely are you to recommend us?
        </div>
        <small>FIELD TYPE</small>
        <div className="forms-property-input">
          Rating <span>⌄</span>
        </div>
        <small>FOLLOW-UP LOGIC</small>
        <div className="forms-logic-card">
          <i />
          If answer is less than 4<p>Show “What could we do better?”</p>
        </div>
        <div className="forms-property-toggle">
          <span>Required</span>
          <b>On</b>
        </div>
      </div>
    </div>
  );
}

function RegistrationPreview() {
  return (
    <div className="forms-registration-layout">
      <div className="forms-public-preview">
        <div className="forms-public-cover">
          <span>ACME / COMMUNITY</span>
          <div className="forms-cover-shapes">
            <i />
            <i />
            <i />
          </div>
          <strong>
            Product launch
            <br />
            open house
          </strong>
          <small>Thursday, October 9 · 4:00 PM</small>
        </div>
        <div className="forms-public-fields">
          <h3>Save your seat</h3>
          <p>Join us for a first look at what we have been building.</p>
          <div className="forms-public-inputs">
            <div>
              <small>Full name</small>
              <span>Jane Rivera</span>
            </div>
            <div>
              <small>Work email</small>
              <span>jane@company.com</span>
            </div>
          </div>
          <div className="forms-public-question">
            <b>How will you attend?</b>
            <div className="forms-public-radio is-selected">
              <i />
              In person
            </div>
            <div className="forms-public-radio">
              <i />
              Join online
            </div>
            <div className="forms-public-conditional">
              <small>FOLLOW-UP · SHOWN FOR “IN PERSON”</small>
              <b>Any access needs we should know about?</b>
              <span>Let us know how we can help.</span>
            </div>
            <div className="forms-public-submit">
              Reserve my seat <span>→</span>
            </div>
            <small className="forms-public-privacy">
              Your details stay with the event team.
            </small>
          </div>
        </div>
      </div>
      <div className="forms-preview-side">
        <span className="forms-preview-label">
          LIVE PREVIEW <i /> Published
        </span>
        <div className="forms-logic-connector">
          <div className="forms-logic-node">
            <b>How will you attend?</b>
            <small>Multiple choice</small>
            <em>In person</em>
            <em>Join online</em>
          </div>
          <div className="forms-logic-branch">
            <span>In person</span>
            <i />
          </div>
          <div className="forms-logic-result">
            <b>Access needs</b>
            <small>Follow-up appears here</small>
          </div>
        </div>
        <div className="forms-preview-note">
          <span>↳</span>
          <p>Conditional questions adapt the form to each response.</p>
        </div>
      </div>
    </div>
  );
}

function ResponseReview() {
  return (
    <div className="forms-response-layout">
      <div className="forms-response-main">
        <div className="forms-response-heading">
          <div>
            <h2>Design requests</h2>
            <p>Submitted by your team · Updated just now</p>
          </div>
          <span>Export CSV</span>
        </div>
        <div className="forms-response-summary">
          <div>
            <small>NEW THIS WEEK</small>
            <b>34</b>
            <span>↑ 12% from last week</span>
          </div>
          <div>
            <small>COMMON REQUEST</small>
            <b>Onboarding</b>
            <span>11 submissions</span>
          </div>
          <div>
            <small>NEEDING DETAILS</small>
            <b>6</b>
            <span>AI flagged for follow-up</span>
          </div>
        </div>
        <div className="forms-response-table">
          <div className="forms-table-head">
            <span>REQUEST</span>
            <span>PRIORITY</span>
            <span>STATUS</span>
          </div>
          <div className="forms-table-row">
            <span>
              <b>Improve mobile onboarding</b>
              <small>Growth team · due Oct 18</small>
            </span>
            <em className="forms-priority-high">High</em>
            <i>Needs review</i>
          </div>
          <div className="forms-table-row">
            <span>
              <b>New customer welcome deck</b>
              <small>Customer success · due Oct 21</small>
            </span>
            <em>Normal</em>
            <i className="forms-status-ready">Ready</i>
          </div>
          <div className="forms-table-row">
            <span>
              <b>Update product comparison</b>
              <small>Marketing · missing audience</small>
            </span>
            <em>Normal</em>
            <i>Needs details</i>
          </div>
        </div>
        <div className="forms-response-foot">
          <span>●</span> 34 responses · sorted by priority
        </div>
      </div>
    </div>
  );
}

function BuilderAgent() {
  return (
    <div className="forms-agent-shell">
      <AgentSidebarHeader />
      <div className="forms-agent-content">
        <div className="forms-agent-user">
          Add a follow-up if someone rates us below 4.
        </div>
        <div className="forms-agent-reply">
          <b>
            <span>AI</span> Forms agent
          </b>
          <p>
            Added the conditional question “What could we do better?” It appears
            only after a rating of 1, 2, or 3.
          </p>
          <div className="forms-agent-action">
            <i /> New follow-up · question 3
          </div>
        </div>
        <div className="forms-agent-suggestion">
          <small>TRY ASKING</small>
          <p>Summarize responses by theme</p>
        </div>
        <div className="forms-agent-composer">
          <span className="forms-composer-placeholder">
            Ask the agent about this form…
          </span>
          <div className="forms-composer-tools">
            <span className="forms-context-control">＋ Add context</span>
            <span className="forms-agent-selector">Claude Code⌄</span>
            <span className="forms-composer-mode">Act⌄</span>
            <span className="forms-composer-mic">◉</span>
            <span className="forms-composer-send">↑</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResponseAgent() {
  return (
    <div className="forms-agent-shell forms-response-agent">
      <AgentSidebarHeader />
      <div className="forms-agent-content">
        <div className="forms-insight-card">
          <small>TOP SIGNAL</small>
          <b>Onboarding needs clearer guidance</b>
          <p>11 people asked for help during setup. 7 mentioned mobile.</p>
          <div className="forms-insight-meter">
            <i />
          </div>
          <span>Based on 11 responses</span>
        </div>
        <div className="forms-insight-callout">
          <span>Suggested follow-up</span>
          <p>Ask 6 requesters to add a target platform and audience.</p>
          <b>Draft a follow-up</b>
        </div>
        <div className="forms-agent-evidence">
          <small>IN THE RESPONSES</small>
          <p>“I wasn’t sure what to do after connecting my workspace.”</p>
          <span>— Product team · Oct 2</span>
        </div>
        <div className="forms-agent-composer">
          <span className="forms-composer-placeholder">
            Ask about these responses…
          </span>
          <div className="forms-composer-tools">
            <span className="forms-context-control">＋ Add context</span>
            <span className="forms-agent-selector">Claude Code⌄</span>
            <span className="forms-composer-mode">Act⌄</span>
            <span className="forms-composer-mic">◉</span>
            <span className="forms-composer-send">↑</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentSidebarHeader() {
  return (
    <div className="forms-agent-head">
      <button className="forms-agent-new-chat">
        <span>＋</span> New chat
      </button>
      <div className="forms-agent-head-actions">
        <button aria-label="New agent chat">＋</button>
        <button aria-label="Agent chat options">···</button>
        <button aria-label="Collapse agent sidebar">×</button>
      </div>
    </div>
  );
}
