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
  | "scale"
  | "file";

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
  /** File input metadata. Only used when `type` is `file`. */
  multiple?: boolean;
  accept?: string;
  maxSizeBytes?: number;
  maxFiles?: number;
}

/** Storage reference persisted for a submitted file field. */
export interface FormFileValue {
  url: string;
  name: string;
  type: string;
  size: number;
  id?: string;
  provider?: string;
  handle?: string;
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

export type FormCompletionMode =
  | "message"
  | "redirect"
  | "message_then_refresh"
  | "refresh";

export const DEFAULT_FORM_COMPLETION_REFRESH_SECONDS = 5;
export const MIN_FORM_COMPLETION_REFRESH_SECONDS = 1;
export const MAX_FORM_COMPLETION_REFRESH_SECONDS = 3600;

export interface FormSettings {
  submitText?: string;
  successMessage?: string;
  redirectUrl?: string;
  completionMode?: FormCompletionMode;
  completionRefreshSeconds?: number;
  showProgressBar?: boolean;
  /** Send new response summaries to the form owner's account email. */
  emailOnNewResponses?: boolean;
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
  completionMode?: FormCompletionMode;
  completionRefreshSeconds?: number;
  showProgressBar?: boolean;
}

/** Resolve legacy forms that only have a redirect URL into the current mode. */
export function getFormCompletionMode(
  settings: Pick<FormSettings, "completionMode" | "redirectUrl">,
): FormCompletionMode {
  switch (settings.completionMode) {
    case "message":
    case "redirect":
    case "message_then_refresh":
    case "refresh":
      return settings.completionMode;
    default:
      return settings.redirectUrl ? "redirect" : "message";
  }
}

export function getFormCompletionRefreshSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_FORM_COMPLETION_REFRESH_SECONDS;
  }
  return Math.min(
    MAX_FORM_COMPLETION_REFRESH_SECONDS,
    Math.max(MIN_FORM_COMPLETION_REFRESH_SECONDS, value),
  );
}

export function assertValidFormCompletionSettings(
  settings: FormSettings,
): void {
  if (settings.completionMode !== undefined) {
    switch (settings.completionMode) {
      case "message":
      case "redirect":
      case "message_then_refresh":
      case "refresh":
        break;
      default:
        throw new Error(
          "settings.completionMode must be message, redirect, message_then_refresh, or refresh",
        );
    }
  }

  const seconds = settings.completionRefreshSeconds;
  if (
    seconds !== undefined &&
    (!Number.isInteger(seconds) ||
      seconds < MIN_FORM_COMPLETION_REFRESH_SECONDS ||
      seconds > MAX_FORM_COMPLETION_REFRESH_SECONDS)
  ) {
    throw new Error(
      `settings.completionRefreshSeconds must be an integer between ${MIN_FORM_COMPLETION_REFRESH_SECONDS} and ${MAX_FORM_COMPLETION_REFRESH_SECONDS}`,
    );
  }
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
    completionMode: s.completionMode,
    completionRefreshSeconds: s.completionRefreshSeconds,
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
  role?: "owner" | "viewer" | "commenter" | "editor" | "admin";
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
   * URL of the direct public form or trusted embed source page. Sensitive URL
   * query keys are scrubbed before it is stored; null when no page context is
   * available or anonymous mode suppresses response metadata.
   */
  pageUrl?: string | null;
  /**
   * Runtime shell the feedback was sent from — "web", "electron", or "tauri" —
   * forwarded by trusted embeds as a hidden pass-through field. Null when
   * unknown or anonymous mode suppresses response metadata.
   */
  clientSurface?: string | null;
  communityPromotion?: {
    status: "publishing" | "published" | "failed" | "unknown";
    builderContentId?: string | null;
    communitySlug?: string | null;
    error?: string | null;
    promotedAt?: string | null;
    promotedBy?: string | null;
  } | null;
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
