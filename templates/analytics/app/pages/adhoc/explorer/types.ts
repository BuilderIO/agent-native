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

/** Optional enriched properties that come from configured dimension joins. */
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

export const ENRICHED_PROPERTIES: EnrichedProperty[] = [];

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
