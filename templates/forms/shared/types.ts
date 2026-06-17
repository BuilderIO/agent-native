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
  /** Email of the submitter when known (claimed by the client; not verified). */
  submitterEmail?: string | null;
}

// ---------------------------------------------------------------------------
// Response insight widgets
// ---------------------------------------------------------------------------

export interface ResponseInsightsTableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface ResponseInsightsTable {
  title: string;
  columns: ResponseInsightsTableColumn[];
  rows: Array<Record<string, string | number | boolean | null>>;
  totalRows: number;
  sampledRows: number;
  truncated: boolean;
}

export interface ResponseInsightsChartSeries {
  type: "bar";
  title: string;
  xKey: "date";
  yKey: "submissions";
  series: Array<{ key: "submissions"; label: string }>;
  data: Array<{ date: string; submissions: number }>;
  sampled: boolean;
}

export interface ResponseInsightsWidgetResult {
  widget: "data-insights";
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
  display: {
    title: string;
    route: string;
    primaryAction: { label: string; href: string };
  };
}
