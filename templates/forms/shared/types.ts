import type {
  DataChartWidget,
  DataInsightsWidgetResult,
  DataTableColumn,
  DataTableWidget,
  DataWidgetDisplay,
} from "@agent-native/core/data-widgets";

// ---------------------------------------------------------------------------
// Form field types
// ---------------------------------------------------------------------------

export type FormFieldType =
  | "text"
  | "email"
  | "number"
  | "textarea"
  | "select"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "date"
  | "rating"
  | "scale";

export interface ConditionalRule {
  fieldId: string;
  operator: "equals" | "not_equals" | "contains";
  value: string;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  description?: string;
  required: boolean;
  options?: string[];
  validation?: FieldValidation;
  conditional?: ConditionalRule;
  width?: "full" | "half";
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export type IntegrationType = "webhook" | "slack" | "discord" | "google-sheets";

export interface FormIntegration {
  id: string;
  type: IntegrationType;
  name: string;
  enabled: boolean;
  url: string;
}

// ---------------------------------------------------------------------------
// Form settings
// ---------------------------------------------------------------------------

export interface FormSettings {
  submitText?: string;
  successMessage?: string;
  redirectUrl?: string;
  showProgressBar?: boolean;
  /**
   * Strict response privacy mode. When enabled, submissions do not retain the
   * request IP, submitter identity, chat/run ids, page URL, or client surface.
   */
  anonymous?: boolean;
  integrations?: FormIntegration[];
  /**
   * Origins permitted to POST submissions cross-origin (e.g. from embedded
   * feedback popovers). Empty/unset = allow any origin (back-compat).
   * Each entry is a full origin like "https://app.example.com".
   */
  allowedOrigins?: string[];
}

/**
 * The subset of {@link FormSettings} that is safe to expose to anonymous
 * respondents of a published form. This is an explicit ALLOWLIST: only the
 * fields the public fill page (and SSR renderer) actually need to render and
 * submit a form are included. Owner-private settings such as
 * `integrations` (which carry Slack/Discord/generic webhook URLs) and
 * `allowedOrigins` are deliberately omitted and must never reach the client.
 *
 * When adding a new public-facing setting, add it here explicitly so the
 * default stays "private unless allowlisted".
 */
export interface PublicFormSettings {
  submitText?: string;
  successMessage?: string;
  redirectUrl?: string;
  showProgressBar?: boolean;
}

/**
 * Project a full {@link FormSettings} object down to the public-safe
 * {@link PublicFormSettings} allowlist. Strips integration webhook URLs,
 * allowed-origins, and any future owner-private fields so the public
 * form-fetch endpoint and SSR path never leak owner secrets.
 */
export function toPublicFormSettings(
  settings: FormSettings | null | undefined,
): PublicFormSettings {
  const s = settings ?? {};
  return {
    submitText: s.submitText,
    successMessage: s.successMessage,
    redirectUrl: s.redirectUrl,
    showProgressBar: s.showProgressBar,
  };
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export interface Form {
  id: string;
  title: string;
  description?: string;
  slug: string;
  fields: FormField[];
  settings: FormSettings;
  status: "draft" | "published" | "closed";
  /** Effective role of the current user on this form. */
  role?: "owner" | "viewer" | "editor" | "admin";
  responseCount?: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Form response
// ---------------------------------------------------------------------------

export interface FormResponse {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  submittedAt: string;
  /** Real submitter email when known; synthetic anonymous-owner ids are hidden. */
  submitterEmail?: string | null;
  /**
   * URL of the page the respondent was on, forwarded by trusted embeds (e.g.
   * the framework FeedbackButton) as a hidden pass-through field. Null when the
   * submission carried no page context (e.g. a direct fill on the public page).
   */
  pageUrl?: string | null;
  /**
   * Runtime shell the feedback was sent from — "web", "electron", or "tauri" —
   * forwarded by trusted embeds as a hidden pass-through field. Null when
   * unknown (e.g. a direct fill on the public page).
   */
  clientSurface?: string | null;
}

// ---------------------------------------------------------------------------
// Response insight widgets
// ---------------------------------------------------------------------------

export type ResponseInsightsTableColumn = DataTableColumn;

export type ResponseInsightsTable = Omit<
  DataTableWidget,
  "title" | "columns" | "rows" | "totalRows" | "sampledRows" | "truncated"
> & {
  title: string;
  columns: ResponseInsightsTableColumn[];
  rows: Array<Record<string, string | number | boolean | null>>;
  totalRows: number;
  sampledRows: number;
  truncated: boolean;
};

export type ResponseInsightsChartSeries = Omit<
  DataChartWidget,
  "type" | "title" | "xKey" | "series" | "data" | "sampled"
> & {
  type: "bar";
  title: string;
  xKey: "date";
  series: Array<{ key: "submissions"; label: string }>;
  data: Array<{ date: string; submissions: number }>;
  sampled: boolean;
};

export type ResponseInsightsDisplay = DataWidgetDisplay & {
  title: string;
  route: string;
  primaryAction: { label: string; href: string };
};

type ResponseInsightsWidgetResultBase = DataInsightsWidgetResult<{
  widgetId: "forms.responseInsights.v1";
  scope: {
    formId?: string;
    title: string;
    days: number;
    sampledLimit: number;
    formLimit: number;
  };
  summary: {
    forms: number;
    responses: number;
    sampledResponses: number;
    truncated: boolean;
    rangeStart: string;
    rangeEnd: string;
    scopeCapped: boolean;
  };
  forms: Array<{
    id: string;
    title: string;
    slug: string;
    status: string;
    responseCount: number;
    url: string;
  }>;
  chartSeries: ResponseInsightsChartSeries;
  table: ResponseInsightsTable;
  display: ResponseInsightsDisplay;
}>;

export type ResponseInsightsWidgetResult = Omit<
  ResponseInsightsWidgetResultBase,
  "widgetId" | "chartSeries" | "table" | "display"
> & {
  widgetId: "forms.responseInsights.v1";
  chartSeries: ResponseInsightsChartSeries;
  table: ResponseInsightsTable;
  display: ResponseInsightsDisplay;
};
