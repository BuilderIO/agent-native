export const INTEGRATION_DURABLE_DISPATCH_ENV =
  "AGENT_INTEGRATION_DURABLE_DISPATCH";
export const INTEGRATION_DURABLE_DISPATCH_SCOPES_ENV =
  "AGENT_INTEGRATION_DURABLE_DISPATCH_SCOPES";
export const INTEGRATION_PROCESS_TASK_PATH =
  "/_agent-native/integrations/process-task";
export const INTEGRATION_RETRY_SWEEP_PATH =
  "/_agent-native/integrations/retry-stuck-tasks";
export const INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT =
  "integration-pending-tasks-sweep";

export function isIntegrationDurableDispatchConfigured(): boolean {
  const value = process.env.AGENT_INTEGRATION_DURABLE_DISPATCH;
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}
