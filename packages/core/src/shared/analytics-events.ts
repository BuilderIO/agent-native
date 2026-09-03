export const AGENT_NATIVE_LIFECYCLE_EVENTS = {
  appEntered: "app_entered",
  coreActionStarted: "core_action_started",
  coreActionCompleted: "core_action_completed",
  outputViewed: "output_viewed",
  outputShared: "output_shared",
  returnUsage: "return_usage",
  crossAppUsed: "cross_app_used",
  coreActionFailed: "core_action_failed",
  ctaClicked: "cta_clicked",
} as const;

export const AGENT_NATIVE_ACTION_EVENTS = {
  started: "action_started",
  completed: "action_completed",
  failed: "action_failed",
} as const;

export type AgentNativeLifecycleEventName =
  (typeof AGENT_NATIVE_LIFECYCLE_EVENTS)[keyof typeof AGENT_NATIVE_LIFECYCLE_EVENTS];

export type AgentNativeActionEventName =
  (typeof AGENT_NATIVE_ACTION_EVENTS)[keyof typeof AGENT_NATIVE_ACTION_EVENTS];

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeTrackingDimension(value: unknown): string | undefined {
  const normalized = stringValue(value)?.toLowerCase();
  if (!normalized || normalized === "localhost") return undefined;
  return normalized.startsWith("agent-native-")
    ? normalized.slice("agent-native-".length)
    : normalized;
}

export function withCanonicalTrackingProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...properties };
  const appName = normalizeTrackingDimension(
    properties.app_name ?? properties.app,
  );
  if (appName) next.app_name = appName;

  const templateName = normalizeTrackingDimension(
    properties.template_name ?? properties.template ?? properties.templateId,
  );
  if (templateName) next.template_name = templateName;

  const sessionId = stringValue(properties.session_id ?? properties.sessionId);
  if (sessionId) next.session_id = sessionId;

  return next;
}

function normalizedEventName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function outputId(properties: Record<string, unknown>): string | undefined {
  for (const key of [
    "output_id",
    "resource_id",
    "recording_id",
    "plan_id",
    "deck_id",
    "document_id",
    "form_id",
  ]) {
    const value = stringValue(properties[key]);
    if (value) return value;
  }
  return undefined;
}

function outputType(properties: Record<string, unknown>): string | undefined {
  return stringValue(properties.output_type ?? properties.resource_type);
}

const LIFECYCLE_PROPERTY_KEYS = [
  "user_id",
  "user_email",
  "app_name",
  "template_name",
  "session_id",
  "action_name",
  "action_method",
  "action_source",
  "caller",
  "success",
  "failure_type",
  "failure_code",
  "surface",
  "source",
  "referrer",
  "workspace_id",
  "company_domain",
  "share_method",
  "cta_name",
  "link_type",
  "run_id",
  "thread_id",
  "turn_id",
  "chat_tab_id",
  "chat_surface",
  "request_mode",
  "duration_ms",
  "status_code",
  "ref",
  "via",
] as const;

function lifecycleProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of LIFECYCLE_PROPERTY_KEYS) {
    const value = properties[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      next[key] = value;
    }
  }
  const id = outputId(properties);
  if (id) next.output_id = id;
  const type = outputType(properties);
  if (type) next.output_type = type;
  return next;
}

export function legacyLifecycleEvent(
  name: string,
  properties: Record<string, unknown>,
): {
  name: AgentNativeLifecycleEventName;
  properties: Record<string, unknown>;
} | null {
  const normalized = withCanonicalTrackingProperties(properties);
  const base = lifecycleProperties(normalized);

  if (
    name === "share_link_copied" ||
    name === "share_invite_sent" ||
    name === "share_visibility_change"
  ) {
    return {
      name: AGENT_NATIVE_LIFECYCLE_EVENTS.outputShared,
      properties: {
        ...base,
        share_method:
          name === "share_link_copied"
            ? "copy_link"
            : name === "share_invite_sent"
              ? "invite"
              : "visibility_change",
      },
    };
  }

  if (
    name === "share_view" ||
    name === "view clip preview" ||
    name === "view plan video preview"
  ) {
    return {
      name: AGENT_NATIVE_LIFECYCLE_EVENTS.outputViewed,
      properties: {
        ...base,
        ...(name === "view clip preview" ? { output_type: "clip" } : {}),
        ...(name === "view plan video preview" ? { output_type: "plan" } : {}),
      },
    };
  }

  if (name === "app.first_action") {
    const action = stringValue(properties.action);
    if (action === "chat_submit" || action === "recording_start") {
      return {
        name: AGENT_NATIVE_LIFECYCLE_EVENTS.coreActionStarted,
        properties: { ...base, action_name: action },
      };
    }
    if (action === "plan_viewed") {
      return {
        name: AGENT_NATIVE_LIFECYCLE_EVENTS.outputViewed,
        properties: { ...base, action_name: action },
      };
    }
  }

  if (name === "generate deck") {
    return {
      name: AGENT_NATIVE_LIFECYCLE_EVENTS.ctaClicked,
      properties: { ...base, cta_name: "generate_deck" },
    };
  }

  if (name === "share_cta_click") {
    return {
      name: AGENT_NATIVE_LIFECYCLE_EVENTS.ctaClicked,
      properties: {
        ...base,
        cta_name: stringValue(properties.cta) ?? "share_cta",
      },
    };
  }

  if (
    name === "auth.signup_clicked" ||
    name === "auth.login_clicked" ||
    name === "builder connect clicked" ||
    name.startsWith("click ") ||
    name.startsWith("try ") ||
    name.startsWith("choose ") ||
    name === "create your own" ||
    name === "start from scratch"
  ) {
    return {
      name: AGENT_NATIVE_LIFECYCLE_EVENTS.ctaClicked,
      properties: {
        ...base,
        cta_name: stringValue(properties.cta) ?? normalizedEventName(name),
      },
    };
  }

  return null;
}
