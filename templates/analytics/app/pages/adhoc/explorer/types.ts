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

export function createDefaultConfig(
  name = "Untitled Explorer",
): ExplorerConfig {
  return {
    name,
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

export interface EnrichedProperty {
  name: string;
  label: string;
  columnExpr: string;
  joinTable: string;
  joinAlias: string;
  joinOn: string;
  valuesSql: string;
  category: string;
}

export const ENRICHED_PROPERTIES: EnrichedProperty[] = [];

export const ENRICHED_PROPERTY_MAP = new Map(
  ENRICHED_PROPERTIES.map((p) => [p.name, p]),
);

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

export const KNOWN_EVENTS = [
  { value: "signup", label: "Signup", category: "Acquisition" },
  { value: "login", label: "Login", category: "Acquisition" },
  { value: "pageView", label: "Page View", category: "Acquisition" }, // i18n-ignore stable event label
  {
    value: "self reported attribution option selected",
    label: "Self-Reported Attribution", // i18n-ignore stable event label
    category: "Acquisition",
  },
  { value: "click", label: "Click", category: "Acquisition" },

  { value: "content saved", label: "Content Saved", category: "Content" }, // i18n-ignore stable event label
  {
    value: "content published",
    label: "Content Published", // i18n-ignore stable event label
    category: "Content",
  },
  {
    value: "insert content-api call",
    label: "Content API Call", // i18n-ignore stable event label
    category: "Content",
  },
  { value: "publish", label: "Publish", category: "Content" },
  { value: "model created", label: "Model Created", category: "Content" }, // i18n-ignore stable event label
  { value: "space created", label: "Space Created", category: "Content" }, // i18n-ignore stable event label
  { value: "content created", label: "Content Created", category: "Content" }, // i18n-ignore stable event label
  { value: "content deleted", label: "Content Deleted", category: "Content" }, // i18n-ignore stable event label

  {
    value: "agent chat message submitted",
    label: "Agent Chat Message", // i18n-ignore stable event label
    category: "AI",
  },
  {
    value: "agent chat accepted",
    label: "Agent Chat Accepted", // i18n-ignore stable event label
    category: "AI",
  },
  {
    value: "agent chat rejected",
    label: "Agent Chat Rejected", // i18n-ignore stable event label
    category: "AI",
  },
  {
    value: "agent chat started",
    label: "Agent Chat Started", // i18n-ignore stable event label
    category: "AI",
  },
  { value: "generate", label: "Generate", category: "AI" },

  { value: "import figma", label: "Import Figma", category: "Visual Editor" }, // i18n-ignore stable event label
  { value: "import code", label: "Import Code", category: "Visual Editor" }, // i18n-ignore stable event label
  { value: "drag and drop", label: "Drag and Drop", category: "Visual Editor" }, // i18n-ignore stable event label
  {
    value: "open visual editor",
    label: "Open Visual Editor", // i18n-ignore stable event label
    category: "Visual Editor",
  },
  { value: "preview", label: "Preview", category: "Visual Editor" },

  {
    value: "integration installed",
    label: "Integration Installed", // i18n-ignore stable event label
    category: "Integrations",
  },
  {
    value: "integration removed",
    label: "Integration Removed", // i18n-ignore stable event label
    category: "Integrations",
  },
  { value: "sdk download", label: "SDK Download", category: "Integrations" }, // i18n-ignore stable event label

  {
    value: "subscription created",
    label: "Subscription Created", // i18n-ignore stable event label
    category: "Billing",
  },
  {
    value: "subscription updated",
    label: "Subscription Updated", // i18n-ignore stable event label
    category: "Billing",
  },
  {
    value: "subscription cancelled",
    label: "Subscription Cancelled", // i18n-ignore stable event label
    category: "Billing",
  },
  { value: "checkout started", label: "Checkout Started", category: "Billing" }, // i18n-ignore stable event label
  { value: "plan selected", label: "Plan Selected", category: "Billing" }, // i18n-ignore stable event label

  { value: "invite sent", label: "Invite Sent", category: "Collaboration" }, // i18n-ignore stable event label
  {
    value: "invite accepted",
    label: "Invite Accepted", // i18n-ignore stable event label
    category: "Collaboration",
  },
  { value: "comment added", label: "Comment Added", category: "Collaboration" }, // i18n-ignore stable event label
];

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
