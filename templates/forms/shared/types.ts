import type {
  DataChartWidget,
  DataInsightsWidgetResult,
  DataTableColumn,
  DataTableWidget,
  DataWidgetDisplay,
} from "@agent-native/core/data-widgets";


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
  multiple?: boolean;
  accept?: string;
  maxSizeBytes?: number;
  maxFiles?: number;
}

export interface FormFileValue {
  url: string;
  name: string;
  type: string;
  size: number;
  id?: string;
  provider?: string;
  handle?: string;
}


export type IntegrationType = "webhook" | "slack" | "discord" | "google-sheets";

export interface FormIntegration {
  id: string;
  type: IntegrationType;
  name: string;
  enabled: boolean;
  url: string;
}


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
  emailOnNewResponses?: boolean;
  anonymous?: boolean;
  integrations?: FormIntegration[];
  allowedOrigins?: string[];
}

export const FORM_SETTINGS_KEYS = [
  "submitText",
  "successMessage",
  "redirectUrl",
  "completionMode",
  "completionRefreshSeconds",
  "showProgressBar",
  "emailOnNewResponses",
  "anonymous",
  "integrations",
  "allowedOrigins",
] as const;

export interface PublicFormSettings {
  submitText?: string;
  successMessage?: string;
  redirectUrl?: string;
  completionMode?: FormCompletionMode;
  completionRefreshSeconds?: number;
  showProgressBar?: boolean;
}

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
  const unknownKeys = Object.keys(settings).filter(
    (key) => !(FORM_SETTINGS_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `Unknown form setting(s): ${unknownKeys.join(", ")}. Valid settings: ${FORM_SETTINGS_KEYS.join(", ")}`,
    );
  }

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


export interface Form {
  id: string;
  title: string;
  description?: string;
  slug: string;
  fields: FormField[];
  settings: FormSettings;
  status: "draft" | "published" | "closed";
  role?: "owner" | "viewer" | "commenter" | "editor" | "admin";
  responseCount?: number;
  createdAt: string;
  updatedAt: string;
}


export interface FormResponse {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  submittedAt: string;
  submitterEmail?: string | null;
  pageUrl?: string | null;
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
