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

export const LEGACY_TRACKING_EVENT_NAME_ALIASES = {
  "auth.login_clicked": "auth_login_clicked",
  "auth.signup_clicked": "auth_signup_clicked",
  "auth.signup_completed": "auth_signup_completed",
  "auth.signup_viewed": "auth_signup_viewed",
  "build your app": "build_your_app",
  "builder branch waitlist joined": "builder_branch_waitlist_joined",
  "builder connect clicked": "builder_connect_clicked",
  "builder connect failed": "builder_connect_failed",
  "builder connect popup blocked": "builder_connect_popup_blocked",
  "builder connect started": "builder_connect_started",
  "builder connect succeeded": "builder_connect_succeeded",
  "builder disconnect failed": "builder_disconnect_failed",
  "builder disconnect succeeded": "builder_disconnect_succeeded",
  "checkout.completed": "checkout_completed",
  "choose get started path": "choose_get_started_path",
  "click add to agent": "click_add_to_agent",
  "click build online": "click_build_online",
  "click community app": "click_community_app",
  "click community app action": "click_community_app_action",
  "click community app demo": "click_community_app_demo",
  "click community app source": "click_community_app_source",
  "click customize it": "click_customize_it",
  "click customize locally": "click_customize_locally",
  "click customize online": "click_customize_online",
  "click get started": "click_get_started",
  "click template": "click_template",
  "click view docs": "click_view_docs",
  "copy cli command": "copy_cli_command",
  "copy code block": "copy_code_block",
  "copy install command": "copy_install_command",
  "create form": "create_form",
  "desktop download": "desktop_download",
  "desktop open": "desktop_open",
  "environment switched": "environment_switched",
  "generate deck": "generate_deck",
  "open assets": "open_assets",
  "open hosted demo": "open_hosted_demo",
  "session replay upload rejected": "session_replay_upload_rejected",
  "session status": "session_status",
  "skill read docs": "skill_read_docs",
  "skills_cli cancelled": "skills_cli_cancelled",
  "skills_cli clients selected": "skills_cli_clients_selected",
  "skills_cli completed": "skills_cli_completed",
  "skills_cli connect completed": "skills_cli_connect_completed",
  "skills_cli connect failed": "skills_cli_connect_failed",
  "skills_cli connect started": "skills_cli_connect_started",
  "skills_cli failed": "skills_cli_failed",
  "skills_cli github action added": "skills_cli_github_action_added",
  "skills_cli install completed": "skills_cli_install_completed",
  "skills_cli instructions updated": "skills_cli_instructions_updated",
  "skills_cli mcp registered": "skills_cli_mcp_registered",
  "skills_cli plan mode selected": "skills_cli_plan_mode_selected",
  "skills_cli scope selected": "skills_cli_scope_selected",
  "skills_cli skills listed": "skills_cli_skills_listed",
  "skills_cli skills prompted": "skills_cli_skills_prompted",
  "skills_cli skills selected": "skills_cli_skills_selected",
  "skills_cli started": "skills_cli_started",
  "start from scratch": "start_from_scratch",
  "submit community app": "submit_community_app",
  "try live demo": "try_live_demo",
  "view clip preview": "view_clip_preview",
  "view plan video preview": "view_plan_video_preview",
} as const;

export function canonicalTrackingEvent(
  name: string,
  properties: Record<string, unknown>,
): {
  name: string;
  properties: Record<string, unknown>;
} | null {
  const canonicalName = (
    LEGACY_TRACKING_EVENT_NAME_ALIASES as Record<string, string>
  )[name];
  if (!canonicalName) return null;
  return {
    name: canonicalName,
    properties: {
      ...properties,
      canonical_event_name: canonicalName,
      legacy_event_name: name,
    },
  };
}

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
