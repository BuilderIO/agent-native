// i18n-raw-literal-disable-file -- source-shaped Chat artwork; example data is fabricated.
import { AgentNativeIcon } from "@agent-native/core/client/agent-native-icon";
import {
  IconArrowUpRight,
  IconArrowUp,
  IconCheck,
  IconMessages,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarRight,
  IconMicrophone,
  IconPaperclip,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";

import "./ChatLandingMock.css";

export type ChatLandingVariant =
  | "internal-assistant"
  | "prototype-agent-workflow"
  | "interface-for-agent-work";

const THREADS = [
  "Launch research brief",
  "Customer interview themes",
  "Launch review queue",
  "Prototype a research assistant",
];

const CONNECTIONS = [
  { mark: "G", name: "Granola", detail: "Meeting notes", tone: "granola" },
  { mark: "L", name: "Linear", detail: "Issues and projects", tone: "linear" },
  { mark: "D", name: "Google Drive", detail: "Docs and files", tone: "drive" },
  { mark: "N", name: "Notion", detail: "Pages and databases", tone: "notion" },
];

const VARIANT_COPY = {
  "internal-assistant": {
    title: "Launch research brief",
    user: "What are the three risks from this week's launch research, and who owns each one?",
    answer:
      "I found three recurring risks across the research notes and linked each one to its owner.",
    footer: "Compiled from 8 notes · updated just now",
  },
  "prototype-agent-workflow": {
    title: "Prototype a research assistant",
    user: "Can this assistant combine meeting notes, project issues, and our launch docs?",
    answer:
      "Yes. Add the tools your app needs, then give the agent one action for each workflow.",
    footer: "These example connections are ready to add to your own app",
  },
  "interface-for-agent-work": {
    title: "Launch review queue",
    user: "Turn the open launch questions into a review queue the team can work through.",
    answer:
      "I grouped the open questions by owner and added the next step for each one.",
    footer: "Three items are ready for review",
  },
} as const;

export function ChatLandingMock({
  className = "",
  label,
  variant = "internal-assistant",
  sidebarCollapsed = false,
}: {
  className?: string;
  label: string;
  variant?: ChatLandingVariant;
  sidebarCollapsed?: boolean;
}) {
  const content = VARIANT_COPY[variant];

  return (
    <div
      className={
        "chat-product-art" +
        (sidebarCollapsed ? " chat-product-art--sidebar-collapsed" : "") +
        " " +
        className
      }
      role="img"
      aria-label={label}
    >
      <div className="chat-app-window" aria-hidden="true">
        <aside className="chat-app-sidebar">
          <div className="chat-app-brand">
            <AgentNativeIcon
              aria-hidden="true"
              className="chat-app-brand-mark"
            />
            <span>Chat</span>
            <button type="button" tabIndex={-1} aria-label="Collapse sidebar">
              <IconLayoutSidebarLeftCollapse size={16} />
            </button>
          </div>
          <button className="chat-new-button" type="button" tabIndex={-1}>
            <IconPlus size={15} />
            New chat
          </button>
          <div className="chat-history-heading">Recents</div>
          <div className="chat-history-list">
            {THREADS.map((thread, index) => (
              <div
                className={
                  "chat-history-item" +
                  (thread === content.title ? " is-selected" : "")
                }
                key={thread}
              >
                <IconMessages size={13} />
                <span>{thread}</span>
                {index === 0 ? <span className="chat-history-dot" /> : null}
              </div>
            ))}
          </div>
          <div className="chat-user">
            <span className="chat-user-avatar">A</span>
            <span>
              <strong>Alex Morgan</strong>
              <small>Workspace</small>
            </span>
            <span className="chat-sidebar-actions">
              <IconSearch size={15} />
              <IconLayoutSidebarLeftCollapse size={15} />
            </span>
          </div>
        </aside>

        <main className="chat-conversation">
          <header className="chat-conversation-header">
            <span>{content.title}</span>
            <span className="chat-header-spacer" />
            <button
              className="chat-workspace-toggle"
              type="button"
              tabIndex={-1}
              aria-label="Open workspace panel"
            >
              <IconLayoutSidebarRight size={16} />
            </button>
          </header>

          <section className="chat-message-flow">
            <div className="chat-message chat-message-user">
              <span>{content.user}</span>
            </div>

            <div className="chat-assistant-message">
              <div className="chat-assistant-content">
                <p>{content.answer}</p>
                {variant === "prototype-agent-workflow" ? (
                  <div className="chat-connect-panel">
                    <div className="chat-connect-heading">
                      <div>
                        <strong>Connect a source</strong>
                        <span>Choose where this agent can look</span>
                      </div>
                      <span className="chat-connection-count">4 available</span>
                    </div>
                    <div className="chat-connection-grid">
                      {CONNECTIONS.map((connection) => (
                        <div
                          className="chat-connection-card"
                          key={connection.name}
                        >
                          <span
                            className={
                              "chat-connection-mark chat-connection-mark--" +
                              connection.tone
                            }
                          >
                            {connection.mark}
                          </span>
                          <span className="chat-connection-copy">
                            <strong>{connection.name}</strong>
                            <small>{connection.detail}</small>
                          </span>
                          <span className="chat-connect-action">Connect</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {variant === "internal-assistant" ? (
                  <div className="chat-research-result">
                    <div className="chat-result-heading">
                      <span>Launch risks</span>
                      <span>3 findings</span>
                    </div>
                    <div className="chat-result-row">
                      <span className="chat-result-number">01</span>
                      <span>
                        <strong>Onboarding copy is still unclear</strong>
                        <small>
                          Owner: Maya · 5 notes mention setup friction
                        </small>
                      </span>
                      <span className="chat-result-open">
                        <IconArrowUpRight size={13} />
                      </span>
                    </div>
                    <div className="chat-result-row">
                      <span className="chat-result-number">02</span>
                      <span>
                        <strong>Two partner reviews are outstanding</strong>
                        <small>Owner: Devon · target date is Thursday</small>
                      </span>
                      <span className="chat-result-open">
                        <IconArrowUpRight size={13} />
                      </span>
                    </div>
                    <div className="chat-result-row">
                      <span className="chat-result-number">03</span>
                      <span>
                        <strong>Analytics events need a final check</strong>
                        <small>
                          Owner: Alex · release checklist has 2 open items
                        </small>
                      </span>
                      <span className="chat-result-open">
                        <IconArrowUpRight size={13} />
                      </span>
                    </div>
                  </div>
                ) : null}
                {variant === "interface-for-agent-work" ? (
                  <div className="chat-queue-preview">
                    <div className="chat-queue-title">
                      <span>Launch review queue</span>
                      <span className="chat-queue-view">Open in app</span>
                    </div>
                    <div className="chat-queue-columns">
                      <span>QUESTION</span>
                      <span>OWNER</span>
                      <span>STATUS</span>
                    </div>
                    <div className="chat-queue-row">
                      <strong>Update onboarding copy</strong>
                      <span>Maya</span>
                      <span className="chat-status-pill">Ready</span>
                    </div>
                    <div className="chat-queue-row">
                      <strong>Verify launch events</strong>
                      <span>Alex</span>
                      <span className="chat-status-pill">In review</span>
                    </div>
                    <div className="chat-queue-row">
                      <strong>Confirm partner quote</strong>
                      <span>Devon</span>
                      <span className="chat-status-pill">Waiting</span>
                    </div>
                  </div>
                ) : null}
                <div className="chat-answer-footer">
                  <IconCheck size={12} />
                  {content.footer}
                </div>
              </div>
            </div>
          </section>

          <div className="chat-composer">
            <div className="chat-composer-placeholder">
              Message your agent...
            </div>
            <div className="chat-composer-toolbar">
              <button type="button" tabIndex={-1} aria-label="Add context">
                <IconPlus size={16} />
                <span className="chat-context-label">Add context</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Attach file">
                <IconPaperclip size={16} />
              </button>
              <span className="chat-composer-mode">Auto</span>
              <span className="chat-toolbar-spacer" />
              <button type="button" tabIndex={-1} aria-label="Voice input">
                <IconMicrophone size={16} />
              </button>
              <button
                className="chat-send-button"
                type="button"
                tabIndex={-1}
                aria-label="Send message"
              >
                <IconArrowUp size={16} />
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
