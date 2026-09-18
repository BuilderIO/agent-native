export type TemplateMode =
  | "advisor"
  | "queue"
  | "draft"
  | "memo"
  | "watch"
  | "library"
  | "account";

export type Accent = "amber" | "teal" | "coral" | "violet";

export interface QueueItem {
  id: string;
  name: string;
  meta: string;
  status: string;
  statusTone: "attention" | "ready" | "quiet" | "complete";
  score: string;
  age: string;
  owner: string;
  summary: string;
  tags: string[];
}

export interface DetailSection {
  label: string;
  value: string;
}

export interface DraftData {
  recipient: string;
  subject: string;
  body: string[];
  source: string;
  confidence: string;
  variants?: Record<string, DraftVariant>;
}

export interface DraftVariant {
  recipient: string;
  subject: string;
  body: string[];
  source?: string;
  confidence?: string;
}

export interface MemoData {
  headline: string;
  sections: Array<{ label: string; body: string }>;
  evidence: string[];
  variants?: Record<string, MemoData>;
}

export interface SignalItem {
  id: string;
  source: string;
  sourceTone: "linkedin" | "web" | "internal";
  title: string;
  body: string;
  time: string;
  impact: string;
  impactTone: "high" | "medium" | "low";
}

export interface ClipItem {
  id: string;
  title: string;
  account: string;
  duration: string;
  tag: string;
  color: "gold" | "mint" | "rose" | "sky";
  transcript: string;
}

export interface AdvisorData {
  observed: string[];
  recommendation: string;
  steps: string[];
}

export interface Template {
  slug: string;
  title: string;
  shortTitle: string;
  category: string;
  audience: string;
  summary: string;
  mode: TemplateMode;
  accent: Accent;
  systems: string[];
  cadence: string;
  primaryAction: string;
  secondaryAction: string;
  prompt: string;
  metric: { value: string; label: string };
  setup: string;
  rows?: QueueItem[];
  sections?: DetailSection[];
  sectionsByRowId?: Record<string, DetailSection[]>;
  draft?: DraftData;
  memo?: MemoData;
  signals?: SignalItem[];
  clips?: ClipItem[];
  advisor?: AdvisorData;
}

const accountTieringRows: QueueItem[] = [
  {
    id: "acme-health",
    name: "Acme Health",
    meta: "Enterprise · 1,240 seats",
    status: "Expansion ready",
    statusTone: "ready",
    score: "96",
    age: "2h ago",
    owner: "JL",
    summary:
      "Usage is up 34% and the procurement contact opened the security pack twice.",
    tags: ["Expansion", "Product signal"],
  },
  {
    id: "northstar-labs",
    name: "Northstar Labs",
    meta: "Mid-market · 84 seats",
    status: "Review tier",
    statusTone: "attention",
    score: "81",
    age: "4h ago",
    owner: "MR",
    summary:
      "Champion changed roles. Keep the account high-touch until the new owner is confirmed.",
    tags: ["Champion change", "Renewal"],
  },
  {
    id: "fieldwire",
    name: "Fieldwire",
    meta: "Growth · 42 seats",
    status: "Review tier",
    statusTone: "attention",
    score: "72",
    age: "Yesterday",
    owner: "SK",
    summary:
      "Three active teams are approaching the usage threshold for the next plan.",
    tags: ["Usage", "Plan fit"],
  },
  {
    id: "meridian-bio",
    name: "Meridian Bio",
    meta: "Growth · 28 seats",
    status: "Nurture",
    statusTone: "quiet",
    score: "54",
    age: "2d ago",
    owner: "AC",
    summary: "Low activity and no open opportunity in the last 30 days.",
    tags: ["Low activity"],
  },
];

const churnRows: QueueItem[] = [
  {
    id: "vector-works",
    name: "Vector Works",
    meta: "Renewal in 21 days · $84k ARR",
    status: "Intervene",
    statusTone: "attention",
    score: "88",
    age: "18m ago",
    owner: "DA",
    summary:
      "Weekly active users fell 41%; the executive sponsor has not replied to two check-ins.",
    tags: ["Usage drop", "Sponsor silent"],
  },
  {
    id: "lumen-payments",
    name: "Lumen Payments",
    meta: "Renewal in 46 days · $52k ARR",
    status: "Watch",
    statusTone: "attention",
    score: "74",
    age: "1h ago",
    owner: "RP",
    summary:
      "Support volume is elevated and the main workspace has not invited a new user in 30 days.",
    tags: ["Support", "Adoption"],
  },
  {
    id: "harbor-logistics",
    name: "Harbor Logistics",
    meta: "Renewal in 73 days · $29k ARR",
    status: "Healthy",
    statusTone: "complete",
    score: "28",
    age: "3h ago",
    owner: "JM",
    summary:
      "Usage is steady, key workflows are active, and the account added two teams this month.",
    tags: ["Healthy", "Adoption"],
  },
  {
    id: "sunroom-retail",
    name: "Sunroom Retail",
    meta: "Renewal in 9 days · $18k ARR",
    status: "Needs owner",
    statusTone: "attention",
    score: "67",
    age: "Yesterday",
    owner: "—",
    summary:
      "The renewal task is unassigned and the latest account note is six weeks old.",
    tags: ["Renewal", "Unassigned"],
  },
];

const linkedinIcpRows: QueueItem[] = [
  {
    id: "rivet-security",
    name: "Rivet Security",
    meta: "Series B · 220 employees",
    status: "Strong fit",
    statusTone: "ready",
    score: "94",
    age: "11m ago",
    owner: "—",
    summary:
      "Hiring three platform engineers and recently opened a second data center in Chicago.",
    tags: ["Hiring", "Data infra"],
  },
  {
    id: "kindred-health",
    name: "Kindred Health",
    meta: "Series C · 480 employees",
    status: "Research",
    statusTone: "attention",
    score: "86",
    age: "42m ago",
    owner: "—",
    summary:
      "VP Engineering posted about reducing operational drag across a fast-growing team.",
    tags: ["Exec signal", "Growth"],
  },
  {
    id: "cinder-finance",
    name: "Cinder Finance",
    meta: "Series A · 96 employees",
    status: "Watch",
    statusTone: "quiet",
    score: "68",
    age: "2h ago",
    owner: "—",
    summary:
      "Fits the company profile, but no timely trigger was found this week.",
    tags: ["ICP fit"],
  },
  {
    id: "redwood-robotics",
    name: "Redwood Robotics",
    meta: "Series B · 150 employees",
    status: "Strong fit",
    statusTone: "ready",
    score: "82",
    age: "Yesterday",
    owner: "—",
    summary:
      "New product launch and a fresh operations leadership hire create a timing window.",
    tags: ["Launch", "New hire"],
  },
];

const accountTieringSectionsByRowId: Record<string, DetailSection[]> = {
  "acme-health": [
    { label: "Why now", value: "Usage up 34%; security pack opened twice" },
    { label: "Relationship", value: "Champion active · procurement engaged" },
    { label: "Next move", value: "Invite VP Operations to expansion review" },
    { label: "Sources", value: "CRM · Product analytics · Calendar" },
  ],
  "northstar-labs": [
    { label: "Why now", value: "Champion changed roles" },
    { label: "Relationship", value: "New operations contact opened the brief" },
    { label: "Next move", value: "Confirm the new owner and renewal timeline" },
    { label: "Sources", value: "CRM · Mail · Calendar" },
  ],
  fieldwire: [
    { label: "Why now", value: "Three active teams near the usage threshold" },
    {
      label: "Relationship",
      value: "Account owner is engaged · no exec sponsor",
    },
    { label: "Next move", value: "Confirm expansion criteria with the owner" },
    { label: "Sources", value: "CRM · Product analytics · Calendar" },
  ],
  "meridian-bio": [
    { label: "Why now", value: "Low activity over the last 30 days" },
    { label: "Relationship", value: "No open opportunity" },
    { label: "Next move", value: "Re-engage only after a qualified signal" },
    { label: "Sources", value: "CRM · Product analytics" },
  ],
};

const churnSectionsByRowId: Record<string, DetailSection[]> = {
  "vector-works": [
    { label: "Risk signal", value: "Weekly active users down 41%" },
    { label: "Relationship", value: "Sponsor silent on 2 check-ins" },
    {
      label: "Suggested play",
      value: "Executive value review with a usage recovery plan",
    },
    { label: "Sources", value: "Product analytics · Support · CRM" },
  ],
  "lumen-payments": [
    {
      label: "Risk signal",
      value: "Support volume elevated; no new users in 30 days",
    },
    { label: "Relationship", value: "Renewal in 46 days · $52k ARR" },
    {
      label: "Suggested play",
      value: "Rebuild adoption with the support lead and sponsor",
    },
    { label: "Sources", value: "Product analytics · Support · CRM" },
  ],
  "harbor-logistics": [
    {
      label: "Risk signal",
      value: "Usage steady; 2 new teams added this month",
    },
    { label: "Relationship", value: "Renewal in 73 days · $29k ARR" },
    {
      label: "Suggested play",
      value: "Confirm the expansion path while the account is healthy",
    },
    { label: "Sources", value: "Product analytics · CRM · Calendar" },
  ],
  "sunroom-retail": [
    {
      label: "Risk signal",
      value: "Renewal in 9 days; latest note is six weeks old",
    },
    { label: "Relationship", value: "Renewal task is unassigned" },
    {
      label: "Suggested play",
      value: "Assign an owner and schedule a renewal checkpoint",
    },
    { label: "Sources", value: "CRM · Calendar" },
  ],
};

const linkedinIcpSectionsByRowId: Record<string, DetailSection[]> = {
  "rivet-security": [
    { label: "Fit", value: "Series B · 220 employees" },
    {
      label: "Timing",
      value: "Hiring 3 platform engineers; second data center",
    },
    {
      label: "Suggested opener",
      value: "Ask how platform handoff scales with the new team",
    },
    { label: "Sources", value: "LinkedIn · Company site · CRM" },
  ],
  "kindred-health": [
    { label: "Fit", value: "Series C · 480 employees" },
    { label: "Timing", value: "VP Engineering posted about operational drag" },
    {
      label: "Suggested opener",
      value: "Reference the handoff and operational-drag post",
    },
    { label: "Sources", value: "LinkedIn · Company site · CRM" },
  ],
  "cinder-finance": [
    { label: "Fit", value: "Series A · 96 employees" },
    { label: "Timing", value: "No timely trigger found this week" },
    {
      label: "Suggested opener",
      value: "Wait for a trigger; do not interrupt the team yet",
    },
    { label: "Sources", value: "LinkedIn · Company site · CRM" },
  ],
  "redwood-robotics": [
    { label: "Fit", value: "Series B · 150 employees" },
    { label: "Timing", value: "New product launch and operations hire" },
    {
      label: "Suggested opener",
      value: "Reference the launch and new-hire timing window",
    },
    { label: "Sources", value: "LinkedIn · Company site · CRM" },
  ],
};

export const templates: Template[] = [
  {
    slug: "agent-advisor",
    title: "Agent Advisor",
    shortTitle: "Advisor",
    category: "Meta workflow",
    audience: "Every operator",
    summary:
      "Find the repeatable work hiding in the way your team already operates.",
    mode: "advisor",
    accent: "teal",
    systems: ["Activity", "Chat", "Builder"],
    cadence: "On demand",
    primaryAction: "Inspect a workflow",
    secondaryAction: "See sample recommendation",
    prompt:
      "Inspect this workflow for repeated steps, judgment calls, and a useful Agent-Native app boundary.",
    metric: { value: "12", label: "repeated steps found" },
    setup: "Choose a recent workflow or start from a saved run.",
    advisor: {
      observed: [
        "4 reps rebuild the same account brief every Monday",
        "The same 3 systems are opened in sequence",
        "Approval happens after research, before outreach",
      ],
      recommendation:
        "Create an Account Tiering template with a ranked queue, evidence drawer, and approval step.",
      steps: [
        "Collect the workflow inputs",
        "Separate deterministic steps from judgment",
        "Preview the app boundary",
        "Open the clone in Builder",
      ],
    },
  },
  {
    slug: "account-tiering",
    title: "Account Tiering",
    shortTitle: "Account tiering",
    category: "GTM operations",
    audience: "RevOps + sales",
    summary:
      "Keep account priority aligned with live product and relationship signals.",
    mode: "queue",
    accent: "amber",
    systems: ["CRM", "Product", "Calendar"],
    cadence: "Every Monday",
    primaryAction: "Re-score accounts",
    secondaryAction: "Review changes",
    prompt:
      "Re-score these accounts using usage, relationship, and expansion signals, then explain the biggest tier changes.",
    metric: { value: "42", label: "accounts in scope" },
    setup: "Connect a CRM and choose the signals that define priority.",
    rows: accountTieringRows,
    sectionsByRowId: accountTieringSectionsByRowId,
    sections: [
      { label: "Why now", value: "Usage up 34%; security pack opened twice" },
      { label: "Relationship", value: "Champion active · procurement engaged" },
      { label: "Next move", value: "Invite VP Operations to expansion review" },
      { label: "Sources", value: "CRM · Product analytics · Calendar" },
    ],
  },
  {
    slug: "call-follow-up-drafter",
    title: "Call Follow-up Drafter",
    shortTitle: "Call follow-up",
    category: "GTM operations",
    audience: "AEs + CSMs",
    summary:
      "Turn the last call into a precise follow-up while the context is fresh.",
    mode: "draft",
    accent: "coral",
    systems: ["Calls", "CRM", "Mail"],
    cadence: "After every call",
    primaryAction: "Draft follow-up",
    secondaryAction: "Compare call evidence",
    prompt:
      "Draft a concise follow-up for the selected call. Keep commitments, open questions, and next steps explicit.",
    metric: { value: "8", label: "calls awaiting follow-up" },
    setup: "Connect call notes, CRM activity, and the sending inbox.",
    rows: [
      {
        id: "helio-call",
        name: "Helio Systems",
        meta: "Discovery call · 38 min",
        status: "Draft ready",
        statusTone: "ready",
        score: "91",
        age: "18m ago",
        owner: "MR",
        summary:
          "They need a faster handoff from sales to implementation before Q4.",
        tags: ["Discovery", "Q4"],
      },
      {
        id: "northstar-call",
        name: "Northstar Labs",
        meta: "Renewal call · 24 min",
        status: "Needs review",
        statusTone: "attention",
        score: "78",
        age: "2h ago",
        owner: "JL",
        summary:
          "The champion asked about procurement timing but no date was recorded.",
        tags: ["Renewal", "Open question"],
      },
      {
        id: "alto-call",
        name: "Alto Commerce",
        meta: "Demo · 46 min",
        status: "Not started",
        statusTone: "quiet",
        score: "63",
        age: "Yesterday",
        owner: "AC",
        summary:
          "Three stakeholders attended; the requested integration is still unclear.",
        tags: ["Demo", "Integration"],
      },
    ],
    draft: {
      recipient: "Maya Chen · Helio Systems",
      subject: "Next steps for Helio’s implementation handoff",
      body: [
        "Maya, thanks for walking through the handoff process today.",
        "The main gap is getting implementation the right context before the first customer meeting. I’ll send the current handoff checklist and a short example from a similar team.",
        "Would Thursday afternoon work to review the workflow with your implementation lead?",
      ],
      source: "Helio discovery call · CRM opportunity · Handoff checklist",
      confidence: "High confidence",
      variants: {
        "northstar-call": {
          recipient: "Jordan Lee · Northstar Labs",
          subject: "Northstar procurement timing from today’s renewal call",
          body: [
            "Jordan, thanks for the renewal conversation today.",
            "The open question is procurement timing. I’ll capture the decision path and confirm who needs to be involved before we schedule the next step.",
            "Would Tuesday afternoon work to review the timeline together?",
          ],
          source: "Northstar renewal call · CRM opportunity · Call notes",
          confidence: "Review before sending",
        },
        "alto-call": {
          recipient: "Alex Chen · Alto Commerce",
          subject: "Clarifying Alto’s integration plan",
          body: [
            "Alex, thanks for the product walkthrough today.",
            "You called out the integration boundary as the next open question. I’ll send the workflow notes and a short example of how similar teams scoped it.",
            "Could we reconnect after you confirm the system owner?",
          ],
          source: "Alto demo · CRM opportunity · Integration notes",
          confidence: "Review before sending",
        },
      },
    },
  },
  {
    slug: "win-loss-memo",
    title: "Win / Loss Memo",
    shortTitle: "Win / loss",
    category: "GTM operations",
    audience: "Sales leaders",
    summary:
      "Make every closed deal improve the next one with evidence-backed patterns.",
    mode: "memo",
    accent: "violet",
    systems: ["CRM", "Calls", "Mail"],
    cadence: "After close",
    primaryAction: "Generate memo",
    secondaryAction: "Inspect evidence",
    prompt:
      "Synthesize the selected closed deal into a win/loss memo with evidence, contributing factors, and one recommended change.",
    metric: { value: "17", label: "closed deals this quarter" },
    setup: "Connect closed opportunities and the conversations behind them.",
    rows: [
      {
        id: "lumen-win",
        name: "Lumen Payments",
        meta: "Won · $52k ARR",
        status: "Memo ready",
        statusTone: "ready",
        score: "89",
        age: "Today",
        owner: "RP",
        summary:
          "The security review and a customer proof point changed the decision.",
        tags: ["Win", "Security"],
      },
      {
        id: "orbit-loss",
        name: "Orbit Freight",
        meta: "Lost · $38k ARR",
        status: "Needs synthesis",
        statusTone: "attention",
        score: "76",
        age: "Yesterday",
        owner: "DA",
        summary:
          "Pricing entered late and the economic buyer joined only at the end.",
        tags: ["Loss", "Pricing"],
      },
      {
        id: "fieldwire-win",
        name: "Fieldwire",
        meta: "Won · $24k ARR",
        status: "Memo ready",
        statusTone: "ready",
        score: "84",
        age: "3d ago",
        owner: "SK",
        summary:
          "The team won by leading with a small pilot and clear adoption milestones.",
        tags: ["Win", "Pilot"],
      },
    ],
    memo: {
      headline: "Lumen chose confidence over feature breadth.",
      sections: [
        {
          label: "Decision pattern",
          body: "The deal moved after the security review became a guided working session rather than a checklist exchange.",
        },
        {
          label: "What changed the outcome",
          body: "A peer proof point gave the buyer cover with finance, while the implementation plan reduced perceived switching risk.",
        },
        {
          label: "Change for next time",
          body: "Bring the implementation plan into the second meeting for regulated accounts.",
        },
      ],
      evidence: [
        "Call note: “We need to know this will not become another six-month project.”",
        "Email thread: security review approved on Sep 12",
        "CRM: implementation plan shared before legal review",
      ],
      variants: {
        "orbit-loss": {
          headline: "Orbit lost on timing, not fit.",
          sections: [
            {
              label: "Decision pattern",
              body: "The economic buyer joined after pricing was framed, so cost became the default lens for the decision.",
            },
            {
              label: "What changed the outcome",
              body: "Pricing entered late and the implementation risk never got a concrete owner.",
            },
            {
              label: "Change for next time",
              body: "Bring the economic buyer and implementation plan into the second meeting.",
            },
          ],
          evidence: [
            "Call note: “We need to see the business case before we can move.”",
            "CRM: economic buyer joined the final call",
            "Email thread: pricing sent after technical validation",
          ],
        },
        "fieldwire-win": {
          headline: "Fieldwire bought the path to adoption.",
          sections: [
            {
              label: "Decision pattern",
              body: "A focused pilot made the first value moment concrete and gave the team a shared finish line.",
            },
            {
              label: "What changed the outcome",
              body: "Clear adoption milestones reduced the perceived risk of expanding to more teams.",
            },
            {
              label: "Change for next time",
              body: "Lead with a small pilot and define the expansion signal before the first demo.",
            },
          ],
          evidence: [
            "Call note: pilot scope agreed with the account team",
            "CRM: three adoption milestones completed",
            "Email thread: expansion approved after the pilot review",
          ],
        },
      },
    },
  },
  {
    slug: "churn-early-warning",
    title: "Churn Early Warning",
    shortTitle: "Churn warning",
    category: "Customer success",
    audience: "CS + account teams",
    summary:
      "See the accounts that need a human before renewal risk becomes a forecast.",
    mode: "queue",
    accent: "coral",
    systems: ["CRM", "Product", "Support"],
    cadence: "Every morning",
    primaryAction: "Scan renewal risk",
    secondaryAction: "Plan intervention",
    prompt:
      "Scan these accounts for churn risk, cite the signals, and propose the smallest useful intervention for each.",
    metric: { value: "4", label: "accounts needing review" },
    setup: "Connect product usage, support history, and renewal dates.",
    rows: churnRows,
    sectionsByRowId: churnSectionsByRowId,
    sections: [
      { label: "Risk signal", value: "Weekly active users down 41%" },
      { label: "Relationship", value: "Sponsor silent on 2 check-ins" },
      {
        label: "Suggested play",
        value: "Executive value review with a usage recovery plan",
      },
      { label: "Sources", value: "Product analytics · Support · CRM" },
    ],
  },
  {
    slug: "account-expert",
    title: "Account Expert",
    shortTitle: "Account expert",
    category: "GTM operations",
    audience: "Anyone with an account",
    summary:
      "Ask one account question and get a sourced answer instead of opening six tabs.",
    mode: "account",
    accent: "teal",
    systems: ["CRM", "Calls", "Mail", "Docs"],
    cadence: "On demand",
    primaryAction: "Ask about account",
    secondaryAction: "Open source trail",
    prompt:
      "Give me the current account picture: goals, risks, open commitments, stakeholders, and the best next question.",
    metric: { value: "1", label: "account in focus" },
    setup: "Choose an account and connect the systems that hold its context.",
    sections: [
      { label: "Account", value: "Acme Health · Enterprise" },
      { label: "Current goal", value: "Expand from data team to operations" },
      {
        label: "Open commitment",
        value: "Share security architecture before Friday",
      },
      {
        label: "Risk",
        value: "Procurement has not joined a live conversation",
      },
      {
        label: "Best next question",
        value: "What does operations need to see to sponsor the rollout?",
      },
      { label: "Sources", value: "3 calls · 8 emails · 1 CRM opportunity" },
    ],
  },
  {
    slug: "demo-clip-library",
    title: "Demo Clip Library",
    shortTitle: "Demo clips",
    category: "GTM enablement",
    audience: "Sales + marketing",
    summary:
      "Find the proof point from a past demo and reuse it in the next conversation.",
    mode: "library",
    accent: "amber",
    systems: ["Clips", "Calls", "CRM"],
    cadence: "As demos land",
    primaryAction: "Find a proof point",
    secondaryAction: "Tag selected clips",
    prompt:
      "Find the most relevant demo clips for the selected account and explain why each one is useful.",
    metric: { value: "126", label: "clips indexed" },
    setup: "Connect your recordings and choose the account metadata to index.",
    clips: [
      {
        id: "clip-1",
        title: "Permissioning in one minute",
        account: "Lumen Payments",
        duration: "01:08",
        tag: "Security",
        color: "gold",
        transcript:
          "The admin can set the boundary once, then every team inherits the same policy.",
      },
      {
        id: "clip-2",
        title: "The handoff that does not get lost",
        account: "Helio Systems",
        duration: "02:14",
        tag: "Handoff",
        color: "mint",
        transcript:
          "The implementation team sees the decision trail before they ever join the call.",
      },
      {
        id: "clip-3",
        title: "From signal to next action",
        account: "Acme Health",
        duration: "00:54",
        tag: "Workflow",
        color: "rose",
        transcript:
          "The account view turns a product signal into a precise question for the next meeting.",
      },
      {
        id: "clip-4",
        title: "A pilot with a finish line",
        account: "Fieldwire",
        duration: "01:42",
        tag: "Pilot",
        color: "sky",
        transcript:
          "We agreed on the first three workflows and the adoption signal that earns expansion.",
      },
    ],
  },
  {
    slug: "outbound-in-your-voice",
    title: "Outbound in Your Voice",
    shortTitle: "Outbound voice",
    category: "GTM operations",
    audience: "Founders + AEs",
    summary:
      "Turn a real trigger into a thoughtful first draft that sounds like your team.",
    mode: "draft",
    accent: "coral",
    systems: ["CRM", "LinkedIn", "Mail"],
    cadence: "When a signal appears",
    primaryAction: "Draft outreach",
    secondaryAction: "Review voice sources",
    prompt:
      "Draft outreach for the selected prospect using the trigger, account context, and my approved examples. Do not send.",
    metric: { value: "6", label: "new signals this week" },
    setup: "Add approved examples and define the outbound review boundary.",
    rows: [
      {
        id: "rivet-outbound",
        name: "Rivet Security",
        meta: "New VP Platform hire",
        status: "Draft ready",
        statusTone: "ready",
        score: "94",
        age: "11m ago",
        owner: "—",
        summary:
          "Their new platform leader is hiring around the exact workflow you solve.",
        tags: ["New hire", "ICP"],
      },
      {
        id: "kindred-outbound",
        name: "Kindred Health",
        meta: "Ops post · 2d ago",
        status: "Review tone",
        statusTone: "attention",
        score: "86",
        age: "42m ago",
        owner: "—",
        summary:
          "The signal is strong, but the post is personal and needs a lighter touch.",
        tags: ["Signal", "Tone"],
      },
      {
        id: "cinder-outbound",
        name: "Cinder Finance",
        meta: "ICP match · no trigger",
        status: "Hold",
        statusTone: "quiet",
        score: "68",
        age: "2h ago",
        owner: "—",
        summary:
          "Good fit, but there is no timely reason to interrupt the team yet.",
        tags: ["ICP fit"],
      },
    ],
    draft: {
      recipient: "Avery Patel · VP Platform, Rivet Security",
      subject: "The platform handoff after a new team hire",
      body: [
        "Avery, congrats on the new role.",
        "I noticed Rivet is building out the platform team. A pattern we see at that stage is the work between product, platform, and security becoming the slowest part of the launch.",
        "If that is showing up for you, I can share the short workflow one of our security teams uses to keep those handoffs visible.",
      ],
      source:
        "LinkedIn hiring signal · 3 approved outbound examples · Rivet account brief",
      confidence: "Review before sending",
      variants: {
        "kindred-outbound": {
          recipient: "Nina Okafor · Kindred Health",
          subject: "A lighter take on the ops handoff",
          body: [
            "Nina, your point about operational drag caught my attention.",
            "As teams grow, the work between product and operations can become the invisible launch tax. I can share a short workflow if that is useful.",
            "Happy to send it over without turning this into a sales process.",
          ],
          source: "Kindred LinkedIn post · 3 approved outbound examples",
          confidence: "Review tone before sending",
        },
        "cinder-outbound": {
          recipient: "Samir Shah · Cinder Finance",
          subject: "A workflow note for Cinder’s next phase",
          body: [
            "Samir, Cinder looks like a strong fit for the way we think about operational workflows.",
            "I did not see a timely trigger to interrupt your team, so I’m keeping this lightweight: I can share a short example when the timing is right.",
            "Would it be useful for me to send that over?",
          ],
          source: "Cinder account brief · 3 approved outbound examples",
          confidence: "Hold until there is a trigger",
        },
      },
    },
  },
  {
    slug: "linkedin-signal-watch",
    title: "LinkedIn Signal Watch",
    shortTitle: "Signal watch",
    category: "GTM intelligence",
    audience: "Marketing + sales",
    summary:
      "Turn the people and company changes you care about into a focused signal feed.",
    mode: "watch",
    accent: "teal",
    systems: ["LinkedIn", "CRM", "Slack"],
    cadence: "Daily at 8:00",
    primaryAction: "Scan new signals",
    secondaryAction: "Tune watchlist",
    prompt:
      "Scan the watchlist for meaningful people or company changes, remove noise, and explain which signals deserve action.",
    metric: { value: "9", label: "signals worth review" },
    setup: "Choose the people, accounts, and signal types worth watching.",
    signals: [
      {
        id: "signal-1",
        source: "LinkedIn",
        sourceTone: "linkedin",
        title: "Rivet Security hired a VP Platform",
        body: "Avery Patel joined this week and is hiring three platform engineers.",
        time: "11m ago",
        impact: "High relevance",
        impactTone: "high",
      },
      {
        id: "signal-2",
        source: "LinkedIn",
        sourceTone: "linkedin",
        title: "Kindred Health posted about operational drag",
        body: "The post names handoffs across a growing engineering team as a current focus.",
        time: "42m ago",
        impact: "High relevance",
        impactTone: "high",
      },
      {
        id: "signal-3",
        source: "CRM",
        sourceTone: "internal",
        title: "Northstar Labs changed champions",
        body: "The former champion moved teams; a new operations contact opened the latest brief.",
        time: "2h ago",
        impact: "Needs context",
        impactTone: "medium",
      },
      {
        id: "signal-4",
        source: "Web",
        sourceTone: "web",
        title: "Lumen Payments opened a Chicago office",
        body: "A new office is listed on the company site, but no related hiring signal is confirmed.",
        time: "Yesterday",
        impact: "Low confidence",
        impactTone: "low",
      },
    ],
  },
  {
    slug: "linkedin-icp-prospect-tracker",
    title: "LinkedIn ICP Prospect Tracker",
    shortTitle: "ICP tracker",
    category: "GTM intelligence",
    audience: "Founders + growth",
    summary:
      "Keep a living prospect list ranked by fit and the reason to reach out now.",
    mode: "queue",
    accent: "violet",
    systems: ["LinkedIn", "CRM", "Web"],
    cadence: "Every morning",
    primaryAction: "Refresh prospect list",
    secondaryAction: "Open research brief",
    prompt:
      "Refresh the ICP prospect list, rank by fit and timing, and cite the signal behind each recommendation.",
    metric: { value: "24", label: "prospects in scope" },
    setup: "Define your ICP and the signals that create a timing window.",
    rows: linkedinIcpRows,
    sectionsByRowId: linkedinIcpSectionsByRowId,
    sections: [
      { label: "Fit", value: "Series A-C · 80-500 employees" },
      { label: "Timing", value: "Hiring, launch, or new operations leader" },
      {
        label: "Suggested opener",
        value: "Reference the platform handoff signal",
      },
      { label: "Sources", value: "LinkedIn · Company site · CRM" },
    ],
  },
];

export const featuredTemplateSlugs = [
  "account-tiering",
  "call-follow-up-drafter",
  "win-loss-memo",
  "churn-early-warning",
  "account-expert",
  "demo-clip-library",
  "outbound-in-your-voice",
  "linkedin-signal-watch",
  "linkedin-icp-prospect-tracker",
];

export function getTemplate(slug: string | null): Template {
  return templates.find((template) => template.slug === slug) ?? templates[0];
}
