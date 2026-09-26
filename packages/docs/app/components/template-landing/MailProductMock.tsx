// i18n-raw-literal-disable-file -- static Mail artwork; names and messages are fabricated.
import {
  IconArchive,
  IconArrowUp,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconDots,
  IconMailOpened,
  IconMessageCircle,
  IconMenu2,
  IconMicrophone,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconStar,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

import "./MailProductMock.css";

type MailVariant =
  | "empty"
  | "priorities"
  | "labels"
  | "automations"
  | "agent"
  | "jev";

type MailProductMockProps = {
  label: string;
  variant?: MailVariant;
  className?: string;
};

const THREADS = [
  {
    sender: "Maya Chen",
    subject: "Re: Northstar launch review",
    snippet: "Can you confirm the final time for Thursday?",
    time: "9:42 AM",
    label: "Needs reply",
    unread: true,
  },
  {
    sender: "Devon Lee",
    subject: "Q3 invoice approval",
    snippet: "Updated terms are attached for a quick review.",
    time: "9:18 AM",
    label: "Finance",
    unread: true,
  },
  {
    sender: "Nora Patel",
    subject: "Customer interview notes",
    snippet: "A few patterns surfaced across the last six calls.",
    time: "8:31 AM",
    label: "Research",
    unread: false,
  },
  {
    sender: "Olive & Pine",
    subject: "Spring campaign images",
    snippet: "Sharing the first set of creative for your feedback.",
    time: "Yesterday",
    label: "Client",
    unread: false,
  },
  {
    sender: "Studio Weekly",
    subject: "The week in product design",
    snippet: "Five stories selected for your Friday read.",
    time: "Yesterday",
    label: "Newsletter",
    unread: false,
  },
  {
    sender: "Team calendar",
    subject: "Design review moved to 2:30",
    snippet: "The updated invite is on your calendar.",
    time: "Mon",
    label: "Calendar",
    unread: false,
  },
  {
    sender: "Luca Rivera",
    subject: "Re: Pricing page review",
    snippet: "I left two notes on the new comparison table.",
    time: "8:10 AM",
    label: "Product",
    unread: true,
  },
  {
    sender: "Priya Shah",
    subject: "Launch checklist: final owners",
    snippet: "The remaining approvals are ready to review.",
    time: "7:58 AM",
    label: "Needs reply",
    unread: false,
  },
  {
    sender: "Omar Johnson",
    subject: "Re: Q3 support themes",
    snippet: "I grouped the top requests by customer segment.",
    time: "7:42 AM",
    label: "Research",
    unread: false,
  },
  {
    sender: "Becca Park",
    subject: "Updated onboarding copy",
    snippet: "Here is the shorter version for the welcome flow.",
    time: "7:25 AM",
    label: "Product",
    unread: true,
  },
  {
    sender: "Evan Brooks",
    subject: "Design partner feedback",
    snippet: "Three teams asked for the same export option.",
    time: "7:12 AM",
    label: "Client",
    unread: false,
  },
  {
    sender: "Ada Li",
    subject: "Analytics naming cleanup",
    snippet: "The dashboard events now use the shared names.",
    time: "6:54 AM",
    label: "Product",
    unread: false,
  },
  {
    sender: "Nova Labs",
    subject: "Workshop notes and next steps",
    snippet: "Thanks for the walkthrough; our action items are below.",
    time: "Yesterday",
    label: "Client",
    unread: false,
  },
  {
    sender: "Ops digest",
    subject: "Your weekly workspace summary",
    snippet: "A short recap of updates across your connected apps.",
    time: "Yesterday",
    label: "Newsletter",
    unread: false,
  },
  {
    sender: "Mina Park",
    subject: "Re: Customer advisory group",
    snippet: "The April session is confirmed for next Wednesday.",
    time: "Yesterday",
    label: "Calendar",
    unread: false,
  },
];

const JEV_THREADS = [
  {
    sender: "Maya Chen",
    subject: "Re: Northstar launch review",
    snippet: "Thursday at 2:30 works. I added my final notes.",
    time: "9:42 AM",
    label: "Important",
    unread: true,
  },
  {
    sender: "Mika Tanaka",
    subject: "Re: #284 Keep the inbox quick",
    snippet: "The retry branch needs the same label check.",
    time: "9:31 AM",
    label: "Product",
    unread: true,
  },
  {
    sender: "Alex Morgan",
    subject: "PR #291 · AI label rules",
    snippet: "I left one suggestion on the filtering change.",
    time: "9:14 AM",
    label: "Product",
    unread: false,
  },
  {
    sender: "Devon Lee",
    subject: "Q3 invoice approval",
    snippet: "Updated terms are attached for a quick review.",
    time: "9:05 AM",
    label: "Finance",
    unread: true,
  },
  {
    sender: "Nora Patel",
    subject: "Customer interview notes",
    snippet: "A few patterns surfaced across the last six calls.",
    time: "8:31 AM",
    label: "Research",
    unread: false,
  },
  {
    sender: "Luca Rivera",
    subject: "Re: Pricing page review",
    snippet: "I left two notes on the new comparison table.",
    time: "8:10 AM",
    label: "Product",
    unread: true,
  },
  {
    sender: "Priya Shah",
    subject: "Launch checklist: final owners",
    snippet: "The remaining approvals are ready to review.",
    time: "7:58 AM",
    label: "Important",
    unread: false,
  },
  {
    sender: "Studio Weekly",
    subject: "The week in product design",
    snippet: "Five stories selected for your Friday read.",
    time: "Yesterday",
    label: "Newsletter",
    unread: false,
  },
  {
    sender: "Becca Park",
    subject: "Updated onboarding copy",
    snippet: "Here is the shorter version for the welcome flow.",
    time: "7:25 AM",
    label: "Product",
    unread: true,
  },
  {
    sender: "Evan Brooks",
    subject: "Design partner feedback",
    snippet: "Three teams asked for the same export option.",
    time: "7:12 AM",
    label: "Client",
    unread: false,
  },
  {
    sender: "Ada Li",
    subject: "Analytics naming cleanup",
    snippet: "The dashboard events now use the shared names.",
    time: "6:54 AM",
    label: "Product",
    unread: false,
  },
  {
    sender: "Nova Labs",
    subject: "Workshop notes and next steps",
    snippet: "Thanks for the walkthrough; our action items are below.",
    time: "Yesterday",
    label: "Client",
    unread: false,
  },
] satisfies (typeof THREADS)[number][];

const AGENT_STATES = {
  empty: {
    prompt: "",
    answer: "",
    title: "",
    rows: [],
    footer: "",
  },
  priorities: {
    prompt: "Which messages need a reply today?",
    answer:
      "Two threads are time-sensitive. I ranked them by who is waiting and the dates in the conversation.",
    title: "Priority sort",
    rows: [
      ["Maya Chen", "Confirm Thursday's launch review", "Reply today"],
      ["Devon Lee", "Approve the Q3 invoice", "Due today"],
    ],
    footer: "Sorted by reply urgency and deadline",
  },
  labels: {
    prompt: "Label Nora's interview notes and explain why.",
    answer:
      "I applied Research after matching the six customer interviews and the themes in the thread.",
    title: "AI label applied",
    rows: [
      ["Research", "6 customer interviews", "Added"],
      ["Customer themes", "Matches your saved rule", "Context"],
    ],
    footer: "Labels follow meaning and context, not subject words alone",
  },
  automations: {
    prompt: "Keep newsletters out of my way as they arrive.",
    answer:
      "I set a rule to label newsletters and archive them after a week. You can review each run here.",
    title: "Background automation",
    rows: [
      ["When", "A newsletter arrives", "Trigger"],
      ["Then", "Label it; archive after 7 days", "Active"],
    ],
    footer: "Last run today · 4 messages handled",
  },
  jev: {
    prompt:
      "Archive GitHub bots, keep human PR comments in Product, and prioritize my manager's mail.",
    answer:
      "Jev made those rules: 12 bot updates were archived, human reviews stay in Product, and your manager's mail ranks higher.",
    title: "Jev inbox rules",
    rows: [
      ["GitHub bots", "Archive automated notifications", "Archived"],
      ["Human PR comments", "Keep them in your Product label", "Product"],
      ["Your manager", "Move their mail to Important", "Important"],
    ],
    footer: "Runs in background · edit with a prompt",
  },
  agent: {
    prompt: "Reply to Maya and confirm Thursday at 2:30.",
    answer:
      "I drafted a reply in this thread. Review it before sending; nothing has been sent.",
    title: "Draft reply",
    rows: [
      ["To", "Maya Chen", "Northstar launch review"],
      ["Message", "Thursday at 2:30 works for us.", "Draft"],
    ],
    footer: "Saved to drafts · awaiting your review",
  },
} as const;

export function MailProductMock({
  label,
  variant = "empty",
  className = "",
}: MailProductMockProps) {
  const agent = AGENT_STATES[variant];
  const visibleThreads =
    variant === "jev"
      ? JEV_THREADS
      : variant === "automations"
        ? THREADS.filter((thread) => thread.label === "Newsletter")
        : THREADS;
  const focusedIndex = variant === "labels" ? 2 : 0;

  return (
    <div
      className={"mail-product-art mm-focus-" + variant + " " + className}
      role="img"
      aria-label={label}
    >
      <div className="mm-app" aria-hidden="true">
        <div className="mm-mail-app">
          <header className="mm-topbar">
            <button className="mm-icon-button" type="button" tabIndex={-1}>
              <IconMenu2 size={17} />
            </button>
            <nav className="mm-tabs">
              <span
                className={
                  "mm-tab" + (variant === "automations" ? "" : " is-active")
                }
              >
                All 42
              </span>
              <span className="mm-tab">Important 5</span>
              <span
                className={
                  "mm-tab" + (variant === "automations" ? " is-active" : "")
                }
              >
                Automated 11
              </span>
              <span className="mm-tab">Product 6</span>
              <span className="mm-tab">Other</span>
            </nav>
            <button
              className="mm-icon-button mm-tab-settings"
              type="button"
              tabIndex={-1}
              aria-label="Configure tabs"
            >
              <IconSettings size={15} />
            </button>
            <div className="mm-sort-control">
              {variant === "priorities" || variant === "jev" ? (
                <IconBolt size={13} />
              ) : null}
              <span>
                {variant === "priorities" || variant === "jev"
                  ? "Priority"
                  : "Newest"}
              </span>
              <IconChevronDown size={13} />
            </div>
            <div className="mm-topbar-spacer" />
            <button
              className="mm-icon-button mm-search-toggle"
              type="button"
              tabIndex={-1}
            >
              <IconSearch size={17} />
            </button>
            <button
              className="mm-icon-button mm-refresh-toggle"
              type="button"
              tabIndex={-1}
            >
              <IconRefresh size={17} />
            </button>
            <button className="mm-compose" type="button" tabIndex={-1}>
              Compose
            </button>
            <div
              className="mm-account-stack"
              aria-label="Connected mail accounts"
            >
              <span className="mm-account-avatar">A</span>
              <span className="mm-account-avatar is-second">M</span>
            </div>
          </header>

          <div className="mm-body">
            <main className="mm-inbox">
              <div className="mm-thread-list">
                {visibleThreads.map((thread, index) => (
                  <MailThreadRow
                    key={thread.sender}
                    thread={thread}
                    focused={variant !== "empty" && index === focusedIndex}
                    hovered={index === 1}
                    priority={
                      (variant === "priorities" && index < 2) ||
                      (variant === "jev" && index === 0)
                    }
                  />
                ))}
              </div>
            </main>
          </div>
        </div>

        <aside className="mm-agent">
          <div className="mm-agent-header">
            <button className="mm-agent-new-chat" type="button" tabIndex={-1}>
              New chat
            </button>
            <span className="mm-agent-header-spacer" />
            <div className="mm-agent-actions">
              <button type="button" tabIndex={-1} aria-label="New chat tab">
                <IconPlus size={16} />
              </button>
              <button type="button" tabIndex={-1} aria-label="Chat options">
                <IconDots size={17} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Close agent sidebar"
              >
                <IconX size={16} />
              </button>
            </div>
          </div>

          <div
            className={
              "mm-agent-transcript" + (variant === "empty" ? " is-empty" : "")
            }
          >
            {variant === "empty" ? (
              <div className="mm-agent-empty">
                <span className="mm-agent-empty-mark">
                  <IconMessageCircle size={19} stroke={1.7} />
                </span>
                <div className="mm-agent-suggestions">
                  <button type="button" tabIndex={-1}>
                    Summarize this thread
                  </button>
                  <button type="button" tabIndex={-1}>
                    Draft a reply
                  </button>
                  <button type="button" tabIndex={-1}>
                    Find the action items
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mm-agent-user-message">{agent.prompt}</div>
                <div className="mm-agent-assistant-message">
                  <p>{agent.answer}</p>
                  <div className="mm-agent-result">
                    <div className="mm-agent-result-heading">
                      <strong>{agent.title}</strong>
                      <span>
                        <IconCheck size={13} />
                        {variant === "jev" ? "Active" : "Updated"}
                      </span>
                    </div>
                    {agent.rows.map(([title, detail, status]) => (
                      <div className="mm-agent-result-row" key={title}>
                        <span className="mm-agent-result-copy">
                          <strong>{title}</strong>
                          <small>{detail}</small>
                        </span>
                        <span className="mm-agent-result-status">{status}</span>
                      </div>
                    ))}
                    {variant === "agent" ? (
                      <div className="mm-draft-actions">
                        <span>Review draft</span>
                        <span>Edit</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="mm-agent-message-tools">
                    <span>{agent.footer}</span>
                    <IconDots size={15} />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="mm-agent-composer">
            <div className="mm-agent-editor">
              Ask the agent to explore, build, or explain...
            </div>
            <div className="mm-agent-composer-toolbar">
              <button type="button" tabIndex={-1} aria-label="Add context">
                <IconPlus size={16} />
              </button>
              <button className="mm-agent-mode" type="button" tabIndex={-1}>
                Claude Code <IconChevronDown size={12} />
              </button>
              <button className="mm-agent-mode" type="button" tabIndex={-1}>
                Act <IconChevronDown size={12} />
              </button>
              <span className="mm-agent-toolbar-spacer" />
              <button type="button" tabIndex={-1} aria-label="Voice input">
                <IconMicrophone size={16} />
              </button>
              <button
                className="mm-agent-send"
                type="button"
                tabIndex={-1}
                aria-label="Send"
              >
                <IconArrowUp size={16} />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MailThreadRow({
  thread,
  focused,
  hovered = false,
  priority = false,
}: {
  thread: (typeof THREADS)[number];
  focused: boolean;
  hovered?: boolean;
  priority?: boolean;
}) {
  return (
    <div
      className={
        "mm-thread-row" +
        (focused ? " is-focused" : "") +
        (hovered ? " is-hovered" : "")
      }
    >
      <span className="mm-row-unread">{thread.unread ? <span /> : null}</span>
      <strong className={"mm-sender" + (thread.unread ? " is-unread" : "")}>
        {thread.sender}
      </strong>
      <span
        className={
          "mm-label-chip mm-label-chip--" +
          thread.label.toLowerCase().replace(/\s+/g, "-")
        }
      >
        {thread.label}
      </span>
      <span className="mm-subject-line">
        <strong className={thread.unread ? "is-unread" : ""}>
          {thread.subject}
        </strong>
        <span> — {thread.snippet}</span>
      </span>
      {priority ? (
        <span className="mm-priority-mark">
          <IconStar size={13} />
        </span>
      ) : null}
      <div className="mm-row-action-rail">
        <time>{thread.time}</time>
        {hovered ? (
          <div className="mm-row-actions">
            <IconMailOpened size={14} />
            <IconArchive size={14} />
            <IconClock size={14} />
            <IconTrash size={14} />
            <IconStar size={14} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
