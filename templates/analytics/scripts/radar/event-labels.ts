const SAFE_RADAR_EVENT_NAMES = new Set([
  "signup",
  "onboarding_completed",
  "app_entered",
  "onboarding_app_entered",
  "generation_started",
  "generation_failed",
  "generation_completed",
  "design_prompt_submitted",
  "design_ready_viewed",
  "design_created",
  "deck_created",
  "recording_started",
  "recording_ready",
  "clips_local_recording_saved",
  "integration_setup_exposed",
  "action.response",
  "builder_connect_succeeded",
  "builder connect succeeded",
  "session_replay_upload_rejected",
  "onboarding_abandoned",
  "onboarding_method_clicked",
  "onboarding_method_outcome",
  "onboarding_experiment_exposed",
  "pageview",
  "agent_connected",
  "$mcp_tool_call",
]);

export function safeRadarEventLabel(eventName: string): string {
  return SAFE_RADAR_EVENT_NAMES.has(eventName) ? eventName : "unreviewed event";
}

export function radarEventLabelSql(expression: string): string {
  const names = [...SAFE_RADAR_EVENT_NAMES]
    .map((name) => `'${name.replace(/'/g, "''")}'`)
    .join(", ");
  return `CASE WHEN ${expression} IN (${names}) THEN ${expression} ELSE 'unreviewed_event' END`;
}
