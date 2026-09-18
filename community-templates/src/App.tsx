import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  IconArrowUpRight,
  IconBrandLinkedin,
  IconCalendarEvent,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconDatabase,
  IconFileDescription,
  IconFilter,
  IconGauge,
  IconLayoutDashboard,
  IconListCheck,
  IconMail,
  IconMessageCircle,
  IconPlayerPlay,
  IconQuote,
  IconSearch,
  IconSend,
  IconSettings,
  IconShieldCheck,
  IconStack2,
  IconTimeline,
  IconUserCircle,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import {
  featuredTemplateSlugs,
  getTemplate,
  templates,
  type Accent,
  type AdvisorData,
  type ClipItem,
  type DraftData,
  type MemoData,
  type QueueItem,
  type SignalItem,
  type Template,
} from "./template-data";

type IconProps = { size?: number; stroke?: number };
type TemplateIcon = ComponentType<IconProps>;

const templateIcons: Record<string, TemplateIcon> = {
  "account-tiering": IconChartBar,
  "call-follow-up-drafter": IconMail,
  "win-loss-memo": IconFileDescription,
  "churn-early-warning": IconGauge,
  "account-expert": IconUserCircle,
  "demo-clip-library": IconVideo,
  "outbound-in-your-voice": IconSend,
  "linkedin-signal-watch": IconBrandLinkedin,
  "linkedin-icp-prospect-tracker": IconUsers,
  "agent-advisor": IconStack2,
};

const modeLabels: Record<Template["mode"], string> = {
  advisor: "Workflow inspector",
  queue: "Review queue",
  draft: "Evidence workspace",
  memo: "Evidence workspace",
  watch: "Signal feed",
  library: "Media library",
  account: "Account dossier",
};

function currentSlug(): string {
  return window.location.hash.slice(1) || "agent-advisor";
}

function TemplateIcon({ slug, size = 18 }: { slug: string; size?: number }) {
  const Icon = templateIcons[slug] ?? IconLayoutDashboard;
  return <Icon size={size} stroke={1.8} />;
}

function matchesQuery(query: string, ...values: string[]): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return (
    !normalizedQuery || values.join(" ").toLowerCase().includes(normalizedQuery)
  );
}

function useVisibleSelection<T extends { id: string }>(
  items: T[],
  selectedId: string | null,
  onSelect: (id: string | null) => void,
): T | undefined {
  useEffect(() => {
    if (!items.length) {
      if (selectedId !== null) onSelect(null);
      return;
    }
    if (!items.some((item) => item.id === selectedId)) {
      onSelect(items[0].id);
    }
  }, [items, onSelect, selectedId]);

  return items.find((item) => item.id === selectedId) ?? items[0];
}

function App() {
  const [slug, setSlug] = useState(currentSlug);
  const template = getTemplate(slug);
  const [selectedId, setSelectedId] = useState<string | null>(
    template.rows?.[0]?.id ??
      template.signals?.[0]?.id ??
      template.clips?.[0]?.id ??
      null,
  );
  const [agentOpen, setAgentOpen] = useState(false);
  const [planStatus, setPlanStatus] = useState<"ready" | "staged">("ready");

  useEffect(() => {
    const handleHashChange = () => setSlug(currentSlug());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    setSelectedId(
      template.rows?.[0]?.id ??
        template.signals?.[0]?.id ??
        template.clips?.[0]?.id ??
        null,
    );
    setAgentOpen(false);
    setPlanStatus("ready");
  }, [template]);

  const selectedRecord = useMemo(() => {
    return (
      template.rows?.find((row) => row.id === selectedId)?.name ??
      template.signals?.find((signal) => signal.id === selectedId)?.title ??
      template.clips?.find((clip) => clip.id === selectedId)?.title ??
      template.sections?.[0]?.value ??
      "the current workflow"
    );
  }, [selectedId, template]);

  const openPlan = () => {
    sendToAgentChat({
      message: template.prompt,
      context: [
        `Community template: ${template.title}`,
        `Selected record: ${selectedRecord}`,
        `Requested boundary: ${template.setup}`,
        "This is a bounded planning request. Explain evidence and ask for approval before any write-back.",
      ].join("\n"),
      submit: false,
      openSidebar: true,
      chatTarget: "local",
      usageLabel: `community-template:${template.slug}`,
    });
    setAgentOpen(true);
    setPlanStatus("staged");
  };

  const selectTemplate = (nextSlug: string) => {
    window.location.hash = nextSlug;
  };

  return (
    <div className="app-shell">
      <TemplateRail slug={template.slug} onSelect={selectTemplate} />
      <main className={`main-surface accent-${template.accent}`}>
        <header className="topbar">
          <div className="breadcrumbs">
            <span>COMMUNITY TEMPLATES</span>
            <IconChevronRight size={14} />
            <strong>{template.category}</strong>
          </div>
          <div className="topbar-actions">
            <span className="sample-badge">
              <span className="status-dot" /> Local sample data
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Template settings"
            >
              <IconSettings size={17} />
            </button>
          </div>
        </header>

        <div className="workspace">
          <section className="workflow-column">
            <div className="workflow-header">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-mark" /> {template.audience}
                </div>
                <h1>{template.title}</h1>
                <p className="template-summary">{template.summary}</p>
              </div>
              <div className="metric-block">
                <strong>{template.metric.value}</strong>
                <span>{template.metric.label}</span>
              </div>
            </div>

            <div className="action-row">
              <button
                className="button button-primary"
                type="button"
                onClick={openPlan}
              >
                <IconPlayerPlay size={16} />
                {template.primaryAction}
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setAgentOpen((open) => !open)}
              >
                <IconListCheck size={16} />
                {template.secondaryAction}
              </button>
              <span className="cadence-label">
                <IconCalendarEvent size={15} /> {template.cadence}
              </span>
            </div>

            <div className="surface-meta">
              <span>
                <TemplateIcon slug={template.slug} size={15} />{" "}
                {modeLabels[template.mode]}
              </span>
              <span>
                <IconDatabase size={15} /> {template.systems.join(" · ")}
              </span>
              <span className="meta-spacer" />
              <span>Last sample run 8 min ago</span>
            </div>

            <TemplateView
              template={template}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              onOpenPlan={openPlan}
            />
          </section>

          <AgentPlan
            template={template}
            selectedRecord={selectedRecord}
            open={agentOpen}
            status={planStatus}
            onOpen={openPlan}
          />
        </div>
      </main>
    </div>
  );
}

function TemplateRail({
  slug,
  onSelect,
}: {
  slug: string;
  onSelect: (slug: string) => void;
}) {
  const featured = featuredTemplateSlugs
    .map((featuredSlug) =>
      templates.find((template) => template.slug === featuredSlug),
    )
    .filter((template): template is Template => Boolean(template));

  return (
    <aside className="template-rail">
      <div className="rail-brand">
        <span className="brand-mark">A</span>
        <div>
          <span>AGENT-NATIVE</span>
          <strong>COMMUNITY</strong>
        </div>
      </div>
      <div className="rail-context">
        <span>Template gallery</span>
        <IconArrowUpRight size={15} />
      </div>

      <div className="rail-section">
        <span className="rail-label">GEOFF&apos;S SHORTLIST</span>
        <nav className="template-nav" aria-label="Geoff's shortlist">
          {featured.map((template) => (
            <TemplateNavItem
              key={template.slug}
              template={template}
              selected={template.slug === slug}
              onSelect={onSelect}
            />
          ))}
        </nav>
      </div>

      <div className="rail-section rail-section-discovery">
        <span className="rail-label">DISCOVERY</span>
        <TemplateNavItem
          template={getTemplate("agent-advisor")}
          selected={slug === "agent-advisor"}
          onSelect={onSelect}
        />
      </div>

      <div className="rail-footer">
        <div className="rail-rule" />
        <div className="rail-footer-row">
          <span className="mini-avatar">S</span>
          <div>
            <strong>Steve&apos;s workspace</strong>
            <span>Builder-ready starters</span>
          </div>
          <IconChevronRight size={15} />
        </div>
      </div>
    </aside>
  );
}

function TemplateNavItem({
  template,
  selected,
  onSelect,
}: {
  template: Template;
  selected: boolean;
  onSelect: (slug: string) => void;
}) {
  return (
    <button
      className={`template-nav-item ${selected ? "is-selected" : ""}`}
      type="button"
      onClick={() => onSelect(template.slug)}
      aria-label={template.title}
      title={template.title}
    >
      <span className={`nav-icon accent-icon-${template.accent}`}>
        <TemplateIcon slug={template.slug} size={16} />
      </span>
      <span className="nav-copy">
        <strong>{template.shortTitle}</strong>
        <span>{template.audience}</span>
      </span>
      {selected ? <span className="nav-active-mark" /> : null}
    </button>
  );
}

function AgentPlan({
  template,
  selectedRecord,
  open,
  status,
  onOpen,
}: {
  template: Template;
  selectedRecord: string;
  open: boolean;
  status: "ready" | "staged";
  onOpen: () => void;
}) {
  const steps = template.advisor?.steps ?? [
    "Gather the selected record and source trail",
    "Explain the recommendation in plain language",
    "Preview the proposed write-back",
    "Ask for approval before changing a system",
  ];

  return (
    <aside className={`agent-panel ${open ? "is-open" : ""}`}>
      <div className="agent-panel-head">
        <div>
          <span className="panel-kicker">AGENT PLAN</span>
          <h2>{status === "staged" ? "Plan staged" : "Ready to inspect"}</h2>
        </div>
        <span className={`plan-indicator ${status}`}>
          <span className="status-dot" />{" "}
          {status === "staged" ? "In chat" : "Idle"}
        </span>
      </div>

      {open ? (
        <div className="agent-plan-body">
          <div className="agent-pill-context">
            <span className="agent-pill-label">AGENT PILL</span>
            <span>{selectedRecord}</span>
          </div>
          <p className="agent-prompt">{template.prompt}</p>
          <div className="plan-section">
            <div className="plan-section-heading">
              <span>PROPOSED FLOW</span>
              <span>{steps.length} steps</span>
            </div>
            <ol className="plan-steps">
              {steps.map((step, index) => (
                <li key={step}>
                  <span className="step-number">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="agent-safety-note">
            <IconShieldCheck size={17} />
            <span>Human review before CRM, Mail, or list changes.</span>
          </div>
          <button className="button button-plan" type="button" onClick={onOpen}>
            <IconMessageCircle size={16} /> Stage in Agent Chat
          </button>
          <span className="plan-footnote">
            Prefills the host sidebar. Nothing is sent.
          </span>
        </div>
      ) : (
        <div className="agent-empty-state">
          <div className="empty-orbit">
            <IconStack2 size={22} />
          </div>
          <p>
            Use the contextual Agent Pill to inspect this workflow with the
            current record already in scope.
          </p>
          <button className="button button-plan" type="button" onClick={onOpen}>
            <IconMessageCircle size={16} /> Open agent plan
          </button>
        </div>
      )}
    </aside>
  );
}

function TemplateView({
  template,
  selectedId,
  onSelect,
  onOpenPlan,
}: {
  template: Template;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenPlan: () => void;
}) {
  switch (template.mode) {
    case "advisor":
      return <AdvisorView data={template.advisor!} onOpenPlan={onOpenPlan} />;
    case "queue":
      return (
        <QueueView
          template={template}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      );
    case "draft":
      return (
        <DraftView
          template={template}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      );
    case "memo":
      return (
        <MemoView
          template={template}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      );
    case "watch":
      return (
        <WatchView
          signals={template.signals ?? []}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      );
    case "library":
      return (
        <LibraryView
          clips={template.clips ?? []}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      );
    case "account":
      return <AccountView template={template} />;
  }
}

function ViewHeader({
  kicker,
  title,
  count,
  children,
}: {
  kicker?: string;
  title: string;
  count?: string;
  children?: ReactNode;
}) {
  return (
    <div className="view-header">
      <div>
        {kicker ? <span className="view-kicker">{kicker}</span> : null}
        <div className="view-title-row">
          <h2>{title}</h2>
          {count ? <span className="count-badge">{count}</span> : null}
        </div>
      </div>
      {children ? <div className="view-controls">{children}</div> : null}
    </div>
  );
}

function SearchField({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="search-field">
      <IconSearch size={16} />
      <input
        aria-label={placeholder}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function QueueView({
  template,
  selectedId,
  onSelect,
}: {
  template: Template;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      (template.rows ?? []).filter((row) =>
        matchesQuery(
          query,
          row.name,
          row.meta,
          row.status,
          row.summary,
          row.tags.join(" "),
        ),
      ),
    [query, template.rows],
  );
  const selected = useVisibleSelection(rows, selectedId, onSelect);

  return (
    <div className="template-view">
      <ViewHeader
        kicker="REVIEW QUEUE"
        title="Work that needs a decision"
        count={`${rows.length} visible`}
      >
        <label className="search-field">
          <IconSearch size={16} />
          <input
            aria-label="Filter accounts"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter accounts"
          />
        </label>
        <span className="filter-label">
          <IconFilter size={15} /> All signals
        </span>
      </ViewHeader>
      <div className="queue-layout">
        <div className="queue-table">
          <div className="queue-table-head">
            <span>ACCOUNT</span>
            <span>STATUS</span>
            <span>SCORE</span>
            <span>OWNER</span>
            <span>UPDATED</span>
          </div>
          {rows.map((row) => (
            <button
              className={`queue-row ${row.id === selected?.id ? "is-selected" : ""}`}
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
            >
              <span className="queue-account">
                <strong>{row.name}</strong>
                <small>{row.meta}</small>
              </span>
              <StatusBadge tone={row.statusTone} label={row.status} />
              <span className="score-value">{row.score}</span>
              <span className="owner-value">{row.owner}</span>
              <span className="age-value">{row.age}</span>
            </button>
          ))}
          {!rows.length ? (
            <div className="empty-table">No records match this filter.</div>
          ) : null}
        </div>
        <QueueDetail
          row={selected}
          sections={
            selected
              ? (template.sectionsByRowId?.[selected.id] ?? template.sections)
              : template.sections
          }
        />
      </div>
    </div>
  );
}

function QueueDetail({
  row,
  sections,
}: {
  row?: QueueItem;
  sections?: Template["sections"];
}) {
  if (!row)
    return (
      <div className="detail-panel empty-detail">
        Select a record to see its evidence.
      </div>
    );
  return (
    <div className="detail-panel">
      <div className="detail-heading">
        <div>
          <span className="view-kicker">SELECTED RECORD</span>
          <h3>{row.name}</h3>
          <span>{row.meta}</span>
        </div>
        <span
          className={`detail-score accent-text-${toneFromStatus(row.statusTone)}`}
        >
          {row.score}
        </span>
      </div>
      <div className="detail-summary">
        <IconCircleCheck size={17} />
        <span>{row.summary}</span>
      </div>
      <div className="tag-row">
        {row.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
      <div className="evidence-list">
        {(sections ?? []).map((section) => (
          <div className="evidence-row" key={section.label}>
            <span>{section.label}</span>
            <strong>{section.value}</strong>
          </div>
        ))}
      </div>
      <div className="detail-footer">
        <span>
          <IconClock size={14} /> Updated {row.age}
        </span>
        <span>
          <IconUserCircle size={14} /> Owner {row.owner}
        </span>
      </div>
    </div>
  );
}

function StatusBadge({
  tone,
  label,
}: {
  tone: QueueItem["statusTone"];
  label: string;
}) {
  return (
    <span className={`status-badge status-${tone}`}>
      <span className="status-dot" /> {label}
    </span>
  );
}

function toneFromStatus(tone: QueueItem["statusTone"]): Accent {
  if (tone === "attention") return "coral";
  if (tone === "ready" || tone === "complete") return "teal";
  return "amber";
}

function DraftView({
  template,
  selectedId,
  onSelect,
}: {
  template: Template;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      (template.rows ?? []).filter((row) =>
        matchesQuery(
          query,
          row.name,
          row.meta,
          row.status,
          row.summary,
          row.tags.join(" "),
        ),
      ),
    [query, template.rows],
  );
  const selected = useVisibleSelection(rows, selectedId, onSelect);
  return (
    <div className="template-view">
      <ViewHeader
        kicker={
          template.slug === "outbound-in-your-voice"
            ? "PROSPECT QUEUE"
            : "CALL QUEUE"
        }
        title="Evidence before the draft"
        count={`${rows.length} records`}
      >
        <SearchField
          placeholder="Search records"
          value={query}
          onChange={setQuery}
        />
        <span className="filter-label">
          <IconFilter size={15} /> Needs review
        </span>
      </ViewHeader>
      <div className="draft-layout">
        <div className="record-list">
          {rows.map((row) => (
            <button
              className={`record-card ${row.id === selected?.id ? "is-selected" : ""}`}
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
            >
              <div className="record-card-top">
                <strong>{row.name}</strong>
                <span className="score-value">{row.score}</span>
              </div>
              <span>{row.meta}</span>
              <p>{row.summary}</p>
              <div className="record-card-bottom">
                <StatusBadge tone={row.statusTone} label={row.status} />
                <span>{row.age}</span>
              </div>
            </button>
          ))}
          {!rows.length ? (
            <div className="empty-table">No records match this search.</div>
          ) : null}
        </div>
        <DraftPanel row={selected} draft={template.draft} />
      </div>
    </div>
  );
}

function DraftPanel({ row, draft }: { row?: QueueItem; draft?: DraftData }) {
  if (!row || !draft)
    return (
      <div className="detail-panel empty-detail">
        Select a record to preview its draft.
      </div>
    );
  const selectedDraft = draft.variants?.[row.id] ?? draft;
  return (
    <div className="draft-panel">
      <div className="evidence-strip">
        <div className="evidence-strip-icon">
          <IconQuote size={17} />
        </div>
        <div>
          <span className="view-kicker">BOUNDED EVIDENCE</span>
          <strong>
            {row.name}: {row.summary}
          </strong>
        </div>
        <span className="confidence-badge">
          <IconShieldCheck size={14} /> {selectedDraft.confidence}
        </span>
      </div>
      <div className="draft-preview">
        <div className="draft-toolbar">
          <span className="view-kicker">DRAFT PREVIEW</span>
          <button className="icon-text-button" type="button">
            <IconCopy size={15} /> Copy
          </button>
        </div>
        <div className="mail-meta">
          <span>To</span>
          <strong>{selectedDraft.recipient}</strong>
          <span>Subject</span>
          <strong>{selectedDraft.subject}</strong>
        </div>
        <div className="draft-body">
          {selectedDraft.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <div className="draft-sources">
          <IconDatabase size={15} />
          <span>{selectedDraft.source}</span>
        </div>
      </div>
      <div className="review-bar">
        <span>
          <IconShieldCheck size={15} /> Reviewable draft - never auto-sent
        </span>
        <button className="button button-small" type="button">
          <IconMail size={15} /> Open in Mail
        </button>
      </div>
    </div>
  );
}

function MemoView({
  template,
  selectedId,
  onSelect,
}: {
  template: Template;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      (template.rows ?? []).filter((row) =>
        matchesQuery(
          query,
          row.name,
          row.meta,
          row.status,
          row.summary,
          row.tags.join(" "),
        ),
      ),
    [query, template.rows],
  );
  const selected = useVisibleSelection(rows, selectedId, onSelect);
  return (
    <div className="template-view">
      <ViewHeader
        kicker="CLOSED DEALS"
        title="Patterns worth carrying forward"
        count="Q3"
      >
        <span className="filter-label">
          <IconFilter size={15} /> Won + lost
        </span>
        <SearchField
          placeholder="Find a deal"
          value={query}
          onChange={setQuery}
        />
      </ViewHeader>
      <div className="memo-layout">
        <div className="memo-deal-list">
          {rows.map((row) => (
            <button
              className={`memo-deal ${row.id === selected?.id ? "is-selected" : ""}`}
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
            >
              <div className="record-card-top">
                <strong>{row.name}</strong>
                <span className="age-value">{row.age}</span>
              </div>
              <span>{row.meta}</span>
              <div className="record-card-bottom">
                <StatusBadge tone={row.statusTone} label={row.status} />
                <span>{row.owner}</span>
              </div>
            </button>
          ))}
          {rows.length ? (
            <div className="memo-selection">
              <IconCheck size={15} />
              <span>1 deal selected for synthesis</span>
            </div>
          ) : (
            <div className="empty-table">No deals match this search.</div>
          )}
        </div>
        <MemoPanel row={selected} memo={template.memo} />
      </div>
    </div>
  );
}

function MemoPanel({ row, memo }: { row?: QueueItem; memo?: MemoData }) {
  if (!row || !memo)
    return (
      <div className="detail-panel empty-detail">
        Select a deal to see the memo.
      </div>
    );
  const selectedMemo = memo.variants?.[row.id] ?? memo;
  return (
    <div className="memo-panel">
      <div className="memo-panel-head">
        <div>
          <span className="view-kicker">MEMO PREVIEW</span>
          <h3>{row.name}</h3>
        </div>
        <span className="memo-state">
          <IconCircleCheck size={15} /> Cited
        </span>
      </div>
      <h4>{selectedMemo.headline}</h4>
      <div className="memo-sections">
        {selectedMemo.sections.map((section) => (
          <div className="memo-section" key={section.label}>
            <span>{section.label}</span>
            <p>{section.body}</p>
          </div>
        ))}
      </div>
      <div className="memo-evidence">
        <div className="memo-evidence-head">
          <span className="view-kicker">SOURCE TRAIL</span>
          <span>{selectedMemo.evidence.length} references</span>
        </div>
        {selectedMemo.evidence.map((evidence) => (
          <div className="source-line" key={evidence}>
            <IconQuote size={14} />
            <span>{evidence}</span>
          </div>
        ))}
      </div>
      <div className="review-bar">
        <span>
          <IconFileDescription size={15} /> Ready to save as a team artifact
        </span>
        <button className="button button-small" type="button">
          <IconCopy size={15} /> Copy memo
        </button>
      </div>
    </div>
  );
}

function WatchView({
  signals,
  selectedId,
  onSelect,
}: {
  signals: SignalItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const visibleSignals = useMemo(
    () =>
      signals.filter((signal) =>
        matchesQuery(
          query,
          signal.source,
          signal.title,
          signal.body,
          signal.impact,
        ),
      ),
    [query, signals],
  );
  const selected = useVisibleSelection(visibleSignals, selectedId, onSelect);
  return (
    <div className="template-view">
      <ViewHeader
        kicker="SIGNAL FEED"
        title="The few changes worth a look"
        count={`${visibleSignals.length} signals`}
      >
        <SearchField
          placeholder="Search people or companies"
          value={query}
          onChange={setQuery}
        />
        <span className="filter-label">
          <IconFilter size={15} /> High relevance
        </span>
      </ViewHeader>
      <div className="signal-layout">
        <div className="signal-feed">
          {visibleSignals.map((signal) => (
            <button
              className={`signal-card ${signal.id === selected?.id ? "is-selected" : ""}`}
              key={signal.id}
              type="button"
              onClick={() => onSelect(signal.id)}
            >
              <div className="signal-source-row">
                <span className={`source-mark source-${signal.sourceTone}`}>
                  {signal.sourceTone === "linkedin" ? (
                    <IconBrandLinkedin size={14} />
                  ) : signal.sourceTone === "web" ? (
                    <IconArrowUpRight size={14} />
                  ) : (
                    <IconDatabase size={14} />
                  )}
                </span>
                <span>{signal.source}</span>
                <span className="signal-time">{signal.time}</span>
              </div>
              <strong>{signal.title}</strong>
              <p>{signal.body}</p>
              <span className={`impact impact-${signal.impactTone}`}>
                {signal.impact}
              </span>
            </button>
          ))}
          {!visibleSignals.length ? (
            <div className="empty-table">No signals match this search.</div>
          ) : null}
        </div>
        <SignalDetail signal={selected} />
      </div>
    </div>
  );
}

function SignalDetail({ signal }: { signal?: SignalItem }) {
  if (!signal)
    return (
      <div className="detail-panel empty-detail">
        Select a signal to inspect its source.
      </div>
    );
  return (
    <div className="detail-panel signal-detail">
      <div className="detail-heading">
        <div>
          <span className="view-kicker">SIGNAL CONTEXT</span>
          <h3>{signal.title}</h3>
        </div>
        <span className={`impact impact-${signal.impactTone}`}>
          {signal.impact}
        </span>
      </div>
      <p className="signal-detail-body">{signal.body}</p>
      <div className="source-preview">
        <div className="source-preview-head">
          <IconBrandLinkedin size={17} />
          <span>Source preview</span>
          <IconArrowUpRight size={15} />
        </div>
        <div className="source-preview-line" />
        <div className="source-preview-line short" />
      </div>
      <div className="evidence-list">
        <div className="evidence-row">
          <span>Detected</span>
          <strong>{signal.time}</strong>
        </div>
        <div className="evidence-row">
          <span>Account context</span>
          <strong>CRM record linked</strong>
        </div>
        <div className="evidence-row">
          <span>Next decision</span>
          <strong>Review, dismiss, or queue work</strong>
        </div>
      </div>
      <div className="review-bar">
        <span>
          <IconShieldCheck size={15} /> Human review required
        </span>
        <button className="button button-small" type="button">
          <IconListCheck size={15} /> Review signal
        </button>
      </div>
    </div>
  );
}

function LibraryView({
  clips,
  selectedId,
  onSelect,
}: {
  clips: ClipItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const visibleClips = useMemo(
    () =>
      clips.filter((clip) =>
        matchesQuery(
          query,
          clip.title,
          clip.account,
          clip.tag,
          clip.transcript,
        ),
      ),
    [clips, query],
  );
  const selected = useVisibleSelection(visibleClips, selectedId, onSelect);
  return (
    <div className="template-view">
      <ViewHeader
        kicker="CLIP LIBRARY"
        title="Proof points your team can reuse"
        count={`${visibleClips.length} shown`}
      >
        <SearchField
          placeholder="Search transcript or account"
          value={query}
          onChange={setQuery}
        />
        <span className="filter-label">
          <IconFilter size={15} /> All topics
        </span>
      </ViewHeader>
      <div className="library-layout">
        <div className="clip-grid">
          {visibleClips.map((clip) => (
            <button
              className={`clip-card clip-${clip.color} ${clip.id === selected?.id ? "is-selected" : ""}`}
              key={clip.id}
              type="button"
              onClick={() => onSelect(clip.id)}
            >
              <div className="clip-art">
                <IconPlayerPlay size={22} />
                <span>{clip.duration}</span>
              </div>
              <div className="clip-card-copy">
                <span className="clip-tag">{clip.tag}</span>
                <strong>{clip.title}</strong>
                <span>{clip.account}</span>
              </div>
            </button>
          ))}
          {!visibleClips.length ? (
            <div className="empty-table">No clips match this search.</div>
          ) : null}
        </div>
        <ClipDetail clip={selected} />
      </div>
    </div>
  );
}

function ClipDetail({ clip }: { clip?: ClipItem }) {
  if (!clip)
    return (
      <div className="detail-panel empty-detail">
        Select a clip to preview it.
      </div>
    );
  return (
    <div className="detail-panel clip-detail">
      <div className="clip-detail-art">
        <IconPlayerPlay size={28} />
        <span>{clip.duration}</span>
      </div>
      <div className="detail-heading">
        <div>
          <span className="view-kicker">SELECTED CLIP</span>
          <h3>{clip.title}</h3>
          <span>
            {clip.account} · {clip.tag}
          </span>
        </div>
        <button className="icon-text-button" type="button">
          <IconCopy size={15} /> Copy link
        </button>
      </div>
      <div className="transcript-box">
        <span className="view-kicker">TRANSCRIPT</span>
        <p>“{clip.transcript}”</p>
      </div>
      <div className="evidence-list">
        <div className="evidence-row">
          <span>Indexed from</span>
          <strong>Demo recording</strong>
        </div>
        <div className="evidence-row">
          <span>Suggested use</span>
          <strong>Account follow-up</strong>
        </div>
        <div className="evidence-row">
          <span>Share state</span>
          <strong>Workspace only</strong>
        </div>
      </div>
      <div className="review-bar">
        <span>
          <IconShieldCheck size={15} /> Share after review
        </span>
        <button className="button button-small" type="button">
          <IconArrowUpRight size={15} /> Share clip
        </button>
      </div>
    </div>
  );
}

function AccountView({ template }: { template: Template }) {
  const [query, setQuery] = useState("");
  const accountMatches = matchesQuery(
    query,
    "Acme Health",
    "Enterprise · 1,240 seats",
    ...(template.sections ?? []).map((section) => section.value),
  );
  return (
    <div className="template-view">
      <ViewHeader
        kicker="ACCOUNT DOSSIER"
        title="One account, fully in focus"
        count={accountMatches ? "1 account" : "0 accounts"}
      >
        <SearchField
          placeholder="Search accounts"
          value={query}
          onChange={setQuery}
        />
        <span className="filter-label">
          <IconFilter size={15} /> Current accounts
        </span>
      </ViewHeader>
      {accountMatches ? (
        <div className="account-layout">
          <div className="account-index">
            <div className="account-index-head">
              <span className="view-kicker">ACCOUNT</span>
              <IconCircleCheck size={16} />
            </div>
            <div className="account-identity">
              <span className="large-avatar">A</span>
              <div>
                <strong>Acme Health</strong>
                <span>Enterprise · 1,240 seats</span>
              </div>
            </div>
            <div className="account-score">
              <span>Account health</span>
              <strong>96</strong>
              <div className="score-bar">
                <span />
              </div>
            </div>
            <div className="account-links">
              <span>
                <IconUsers size={15} /> 12 stakeholders
              </span>
              <span>
                <IconFileDescription size={15} /> 1 open opportunity
              </span>
              <span>
                <IconTimeline size={15} /> 3 active threads
              </span>
            </div>
            <button
              className="button button-secondary account-question"
              type="button"
            >
              <IconMessageCircle size={15} /> Ask a question
            </button>
          </div>
          <div className="dossier-panel">
            <div className="dossier-head">
              <div>
                <span className="view-kicker">LIVE SNAPSHOT</span>
                <h3>What the team should know now</h3>
              </div>
              <span className="source-count">
                <IconDatabase size={15} /> 12 source records
              </span>
            </div>
            <div className="dossier-grid">
              {(template.sections ?? []).map((section, index) => (
                <div
                  className={`dossier-card ${index === 0 ? "is-featured" : ""}`}
                  key={section.label}
                >
                  <span>{section.label}</span>
                  <strong>{section.value}</strong>
                  <small>
                    {index === 0
                      ? "Most recent signal"
                      : index === 5
                        ? "Source trail"
                        : "From connected context"}
                  </small>
                </div>
              ))}
            </div>
            <div className="account-timeline">
              <div className="memo-evidence-head">
                <span className="view-kicker">RECENT ACTIVITY</span>
                <span>Last 30 days</span>
              </div>
              <div className="timeline-row">
                <span className="timeline-dot teal" />
                <div>
                  <strong>Security architecture shared</strong>
                  <span>Sep 16 · CRM activity</span>
                </div>
                <IconChevronRight size={15} />
              </div>
              <div className="timeline-row">
                <span className="timeline-dot amber" />
                <div>
                  <strong>Procurement contact opened brief</strong>
                  <span>Sep 14 · Mail</span>
                </div>
                <IconChevronRight size={15} />
              </div>
              <div className="timeline-row">
                <span className="timeline-dot coral" />
                <div>
                  <strong>Expansion question added</strong>
                  <span>Sep 12 · Call notes</span>
                </div>
                <IconChevronRight size={15} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="account-empty detail-panel empty-detail">
          No accounts match this search.
        </div>
      )}
    </div>
  );
}

function AdvisorView({
  data,
  onOpenPlan,
}: {
  data: AdvisorData;
  onOpenPlan: () => void;
}) {
  return (
    <div className="template-view advisor-view">
      <ViewHeader
        kicker="WORKFLOW INSPECTOR"
        title="Turn a repeat into a reusable app"
        count="3 systems"
      >
        <span className="filter-label">
          <IconFilter size={15} /> Recent workflows
        </span>
      </ViewHeader>
      <div className="advisor-grid">
        <div className="observed-panel">
          <div className="subpanel-head">
            <span className="view-kicker">OBSERVED PATTERN</span>
            <span className="analysis-badge">
              <IconGauge size={14} /> High repeatability
            </span>
          </div>
          <h3>Monday account review</h3>
          <p className="panel-intro">
            The same work is happening in a predictable order across the team.
          </p>
          <div className="observed-list">
            {data.observed.map((observation, index) => (
              <div className="observed-row" key={observation}>
                <span className="step-number">{index + 1}</span>
                <span>{observation}</span>
                <IconCheck size={15} />
              </div>
            ))}
          </div>
          <div className="workflow-ribbon">
            <span>CRM</span>
            <IconChevronRight size={14} />
            <span>Product</span>
            <IconChevronRight size={14} />
            <span>Calendar</span>
          </div>
        </div>
        <div className="recommendation-panel">
          <div className="subpanel-head">
            <span className="view-kicker">RECOMMENDED BOUNDARY</span>
            <span className="analysis-badge teal-badge">
              <IconCircleCheck size={14} /> Ready to clone
            </span>
          </div>
          <div className="recommendation-mark">
            <IconStack2 size={23} />
          </div>
          <h3>Account Tiering</h3>
          <p>{data.recommendation}</p>
          <div className="recommended-components">
            <span>Ranked queue</span>
            <span>Evidence drawer</span>
            <span>Approval step</span>
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={onOpenPlan}
          >
            <IconMessageCircle size={16} /> Stage customization plan
          </button>
        </div>
      </div>
      <div className="advisor-steps">
        <div className="subpanel-head">
          <span className="view-kicker">HOW IT BECOMES AN APP</span>
          <span>Human-led at the boundary</span>
        </div>
        <div className="advisor-step-row">
          {data.steps.map((step, index) => (
            <div className="advisor-step" key={step}>
              <span className="step-number">{index + 1}</span>
              <strong>{step}</strong>
              {index < data.steps.length - 1 ? (
                <IconChevronRight size={15} />
              ) : (
                <IconCircleCheck size={16} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
