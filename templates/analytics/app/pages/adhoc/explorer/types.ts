export interface ExplorerFilter {
  property: string;
  operator: "=" | "!=" | "contains" | "not_contains" | "is_set" | "is_not_set";
  value?: string;
}

export interface ExplorerEvent {
  event: string;
  label?: string;
  filters: ExplorerFilter[];
  groupBy: string[];
}

export type ChartType = "line" | "bar" | "table" | "metric";
export type DateRange = "7d" | "14d" | "30d" | "90d" | "custom";

export interface ExplorerConfig {
  name: string;
  events: ExplorerEvent[];
  chartType: ChartType;
  dateRange: DateRange;
  customDateStart?: string;
  customDateEnd?: string;
}

export function createDefaultConfig(): ExplorerConfig {
  return {
    name: "Untitled Explorer",
    events: [createDefaultEvent()],
    chartType: "line",
    dateRange: "30d",
  };
}

export function createDefaultEvent(): ExplorerEvent {
  return {
    event: "",
    filters: [],
    groupBy: [],
  };
}

/**
 * Enriched properties that come from JOINed dimension tables.
 * These are available on every event via automatic JOINs.
 */
export interface EnrichedProperty {
  /** Property name used in filters/group-by */
  name: string;
  /** Display label */
  label: string;
  /** SQL column expression (aliased via the join) */
  columnExpr: string;
  /** Table to JOIN */
  joinTable: string;
  /** JOIN alias */
  joinAlias: string;
  /** JOIN condition (references 'e' as events alias) */
  joinOn: string;
  /** SQL to fetch distinct values for the dropdown */
  valuesSql: string;
  /** Category for the property picker */
  category: string;
}

const DIM_SUB = "`@project.dbt_mart.dim_subscriptions`";
const DIM_ORG = "`@project.dbt_mart.dim_organizations`";
const DIM_USER = "`@project.dbt_mart.dim_users`";

function dimValsSql(table: string, col: string): string {
  return `SELECT ${col} AS val, COUNT(*) AS cnt FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != '' GROUP BY val ORDER BY cnt DESC LIMIT 50`;
}

export const ENRICHED_PROPERTIES: EnrichedProperty[] = [
  // --- Subscription (dim_subscriptions, 18k rows, ~0.03GB) ---
  {
    name: "subscription_plan",
    label: "Subscription Plan",
    columnExpr: "sub.plan",
    joinTable: DIM_SUB,
    joinAlias: "sub",
    joinOn: "e.organizationId = sub.space_id AND sub.status = 'active'",
    valuesSql: dimValsSql(DIM_SUB, "plan"),
    category: "Subscription",
  },
  {
    name: "subscription_status",
    label: "Subscription Status",
    columnExpr: "sub.status",
    joinTable: DIM_SUB,
    joinAlias: "sub",
    joinOn: "e.organizationId = sub.space_id",
    valuesSql: dimValsSql(DIM_SUB, "status"),
    category: "Subscription",
  },

  // --- Organization (dim_organizations, 3M rows, ~0.13GB) ---
  {
    name: "org_subscription",
    label: "Org Subscription",
    columnExpr: "org.subscription",
    joinTable: DIM_ORG,
    joinAlias: "org",
    joinOn: "e.organizationId = org.org_id",
    valuesSql: dimValsSql(DIM_ORG, "subscription"),
    category: "Organization",
  },
  {
    name: "org_name",
    label: "Org Name",
    columnExpr: "org.organization_name",
    joinTable: DIM_ORG,
    joinAlias: "org",
    joinOn: "e.organizationId = org.org_id",
    valuesSql: dimValsSql(DIM_ORG, "organization_name"),
    category: "Organization",
  },
  {
    name: "org_kind",
    label: "Org Kind",
    columnExpr: "org.kind",
    joinTable: DIM_ORG,
    joinAlias: "org",
    joinOn: "e.organizationId = org.org_id",
    valuesSql: dimValsSql(DIM_ORG, "kind"),
    category: "Organization",
  },
  {
    name: "org_company_size",
    label: "Company Size",
    columnExpr: "org.company_size",
    joinTable: DIM_ORG,
    joinAlias: "org",
    joinOn: "e.organizationId = org.org_id",
    valuesSql: dimValsSql(DIM_ORG, "company_size"),
    category: "Organization",
  },
  {
    name: "org_is_trial",
    label: "Is Trial",
    columnExpr: "CAST(org.is_trial AS STRING)",
    joinTable: DIM_ORG,
    joinAlias: "org",
    joinOn: "e.organizationId = org.org_id",
    valuesSql: `SELECT CAST(is_trial AS STRING) AS val, COUNT(*) AS cnt FROM ${DIM_ORG} GROUP BY val ORDER BY cnt DESC`,
    category: "Organization",
  },
  {
    name: "org_trial_type",
    label: "Trial Type",
    columnExpr: "org.trial_type",
    joinTable: DIM_ORG,
    joinAlias: "org",
    joinOn: "e.organizationId = org.org_id",
    valuesSql: dimValsSql(DIM_ORG, "trial_type"),
    category: "Organization",
  },
  {
    name: "org_is_enterprise_trial",
    label: "Is Enterprise Trial",
    columnExpr: "CAST(org.is_enterprise_trial AS STRING)",
    joinTable: DIM_ORG,
    joinAlias: "org",
    joinOn: "e.organizationId = org.org_id",
    valuesSql: `SELECT CAST(is_enterprise_trial AS STRING) AS val, COUNT(*) AS cnt FROM ${DIM_ORG} GROUP BY val ORDER BY cnt DESC`,
    category: "Organization",
  },

  // --- User (dim_users, 63M rows, ~2.75GB) ---
  {
    name: "user_email_domain",
    label: "Email Domain",
    columnExpr: "usr.email_domain",
    joinTable: DIM_USER,
    joinAlias: "usr",
    joinOn: "e.userId = usr.user_id",
    valuesSql: dimValsSql(DIM_USER, "email_domain"),
    category: "User",
  },
  {
    name: "user_intent",
    label: "User Intent",
    columnExpr: "usr.intent",
    joinTable: DIM_USER,
    joinAlias: "usr",
    joinOn: "e.userId = usr.user_id",
    valuesSql: dimValsSql(DIM_USER, "intent"),
    category: "User",
  },
  {
    name: "user_use_case",
    label: "Use Case",
    columnExpr: "usr.use_case",
    joinTable: DIM_USER,
    joinAlias: "usr",
    joinOn: "e.userId = usr.user_id",
    valuesSql: dimValsSql(DIM_USER, "use_case"),
    category: "User",
  },
  {
    name: "user_auth_provider",
    label: "Auth Provider",
    columnExpr: "usr.auth_provider",
    joinTable: DIM_USER,
    joinAlias: "usr",
    joinOn: "e.userId = usr.user_id",
    valuesSql: dimValsSql(DIM_USER, "auth_provider"),
    category: "User",
  },
  {
    name: "user_has_enterprise",
    label: "Has Enterprise Sub",
    columnExpr: "CAST(usr.has_enterprise_subscription AS STRING)",
    joinTable: DIM_USER,
    joinAlias: "usr",
    joinOn: "e.userId = usr.user_id",
    valuesSql: `SELECT CAST(has_enterprise_subscription AS STRING) AS val, COUNT(*) AS cnt FROM ${DIM_USER} GROUP BY val ORDER BY cnt DESC`,
    category: "User",
  },
  {
    name: "user_industry",
    label: "Industry (ZoomInfo)",
    columnExpr: "usr.zi_primary_industry",
    joinTable: DIM_USER,
    joinAlias: "usr",
    joinOn: "e.userId = usr.user_id",
    valuesSql: dimValsSql(DIM_USER, "zi_primary_industry"),
    category: "User",
  },
  {
    name: "user_revenue_range",
    label: "Revenue Range (ZoomInfo)",
    columnExpr: "usr.zi_revenue_range",
    joinTable: DIM_USER,
    joinAlias: "usr",
    joinOn: "e.userId = usr.user_id",
    valuesSql: dimValsSql(DIM_USER, "zi_revenue_range"),
    category: "User",
  },
  {
    name: "user_job_function",
    label: "Job Function (ZoomInfo)",
    columnExpr: "usr.zi_job_function_name",
    joinTable: DIM_USER,
    joinAlias: "usr",
    joinOn: "e.userId = usr.user_id",
    valuesSql: dimValsSql(DIM_USER, "zi_job_function_name"),
    category: "User",
  },
];

export const ENRICHED_PROPERTY_MAP = new Map(
  ENRICHED_PROPERTIES.map((p) => [p.name, p]),
);

/** Top-level columns that can be used directly in WHERE/GROUP BY */
export const TOP_LEVEL_COLUMNS = [
  "event",
  "name",
  "url",
  "type",
  "kind",
  "userId",
  "organizationId",
  "sessionId",
  "browser",
  "modelName",
  "modelId",
  "message",
] as const;

export const TOP_LEVEL_COLUMN_SET = new Set<string>(TOP_LEVEL_COLUMNS);

/** Known events for the picker — grouped by category */
export const KNOWN_EVENTS = [
  // Acquisition
  { value: "signup", label: "Signup", category: "Acquisition" },
  { value: "login", label: "Login", category: "Acquisition" },
  { value: "pageView", label: "Page View", category: "Acquisition" },
  {
    value: "self reported attribution option selected",
    label: "Self-Reported Attribution",
    category: "Acquisition",
  },
  { value: "click", label: "Click", category: "Acquisition" },

  // Content
  { value: "content saved", label: "Content Saved", category: "Content" },
  {
    value: "content published",
    label: "Content Published",
    category: "Content",
  },
  {
    value: "insert content-api call",
    label: "Content API Call",
    category: "Content",
  },
  { value: "publish", label: "Publish", category: "Content" },
  { value: "model created", label: "Model Created", category: "Content" },
  { value: "space created", label: "Space Created", category: "Content" },
  { value: "content created", label: "Content Created", category: "Content" },
  { value: "content deleted", label: "Content Deleted", category: "Content" },

  // Agent Chat / AI
  {
    value: "agent chat message submitted",
    label: "Agent Chat Message",
    category: "AI",
  },
  {
    value: "agent chat accepted",
    label: "Agent Chat Accepted",
    category: "AI",
  },
  {
    value: "agent chat rejected",
    label: "Agent Chat Rejected",
    category: "AI",
  },
  {
    value: "agent chat started",
    label: "Agent Chat Started",
    category: "AI",
  },
  { value: "generate", label: "Generate", category: "AI" },

  // Visual Editor
  { value: "import figma", label: "Import Figma", category: "Visual Editor" },
  { value: "import code", label: "Import Code", category: "Visual Editor" },
  { value: "drag and drop", label: "Drag and Drop", category: "Visual Editor" },
  {
    value: "open visual editor",
    label: "Open Visual Editor",
    category: "Visual Editor",
  },
  { value: "preview", label: "Preview", category: "Visual Editor" },

  // Integrations
  {
    value: "integration installed",
    label: "Integration Installed",
    category: "Integrations",
  },
  {
    value: "integration removed",
    label: "Integration Removed",
    category: "Integrations",
  },
  { value: "sdk download", label: "SDK Download", category: "Integrations" },

  // Billing
  {
    value: "subscription created",
    label: "Subscription Created",
    category: "Billing",
  },
  {
    value: "subscription updated",
    label: "Subscription Updated",
    category: "Billing",
  },
  {
    value: "subscription cancelled",
    label: "Subscription Cancelled",
    category: "Billing",
  },
  { value: "checkout started", label: "Checkout Started", category: "Billing" },
  { value: "plan selected", label: "Plan Selected", category: "Billing" },

  // Collaboration
  { value: "invite sent", label: "Invite Sent", category: "Collaboration" },
  {
    value: "invite accepted",
    label: "Invite Accepted",
    category: "Collaboration",
  },
  { value: "comment added", label: "Comment Added", category: "Collaboration" },
];

/** Known properties grouped by category */
export const KNOWN_PROPERTIES = [
  {
    category: "User Identity",
    properties: ["userId", "organizationId", "sessionId", "email", "userEmail"],
  },
  {
    category: "Event Info",
    properties: [
      "event",
      "name",
      "type",
      "kind",
      "message",
      "action",
      "category",
      "label",
    ],
  },
  {
    category: "Technical",
    properties: [
      "browser",
      "url",
      "device",
      "os",
      "platform",
      "userAgent",
      "screenResolution",
      "language",
    ],
  },
  {
    category: "Content",
    properties: [
      "modelName",
      "modelId",
      "contentId",
      "contentName",
      "contentType",
    ],
  },
  {
    category: "Attribution",
    properties: [
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmTerm",
      "utmContent",
      "referrer",
      "referrerDomain",
      "landingPage",
      "gclid",
      "fbclid",
    ],
  },
  {
    category: "Product",
    properties: [
      "option",
      "plan",
      "tier",
      "source",
      "target",
      "value",
      "framework",
      "sdk",
      "sdkVersion",
      "integration",
      "feature",
    ],
  },
  {
    category: "AI",
    properties: [
      "model",
      "provider",
      "prompt",
      "response",
      "tokensUsed",
      "chatId",
      "messageId",
      "accepted",
      "rejected",
    ],
  },
  {
    category: "Subscription",
    properties: [
      "subscription_plan",
      "subscription_status",
      "org_subscription",
    ],
  },
  {
    category: "Organization",
    properties: [
      "org_name",
      "org_kind",
      "org_company_size",
      "org_is_trial",
      "org_trial_type",
      "org_is_enterprise_trial",
    ],
  },
  {
    category: "User",
    properties: [
      "user_email_domain",
      "user_intent",
      "user_use_case",
      "user_auth_provider",
      "user_has_enterprise",
      "user_industry",
      "user_revenue_range",
      "user_job_function",
    ],
  },
  {
    category: "Billing",
    properties: [
      "planName",
      "planId",
      "amount",
      "currency",
      "interval",
      "coupon",
    ],
  },
];
