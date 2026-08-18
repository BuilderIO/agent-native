import { classifyTerminalErrorCode } from "./error-detail.js";

export const AGENT_FAILURE_TAXONOMY_CODES = [
  "provider_network_error",
  "provider_config_error",
  "overloaded_error",
  "authentication_error",
  "unknown",
] as const;

export type AgentFailureTaxonomyCode =
  (typeof AGENT_FAILURE_TAXONOMY_CODES)[number];

export type AgentFailureRegime = "interactive" | "scheduled";

export interface AgentFailureTaxonomy {
  code: AgentFailureTaxonomyCode;
  label: string;
  regime: AgentFailureRegime;
  source: "error_code" | "error_detail" | "unknown";
}

const LABELS: Record<AgentFailureTaxonomyCode, string> = {
  provider_network_error: "SSL/TLS provider transport drop",
  provider_config_error: "Model reasoning_effort with tools",
  overloaded_error: "Provider overloaded_error",
  authentication_error: "Missing provider authentication",
  unknown: "Unclassified failure",
};

function knownCode(value: unknown): AgentFailureTaxonomyCode | undefined {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "provider_network_error" ||
    normalized === "connection_error" ||
    normalized === "network_error" ||
    normalized === "ssl_error" ||
    normalized === "tls_error"
  ) {
    return "provider_network_error";
  }
  if (
    normalized === "provider_config_error" ||
    normalized === "reasoning_effort_tools"
  ) {
    return "provider_config_error";
  }
  if (
    normalized === "overloaded_error" ||
    normalized === "provider_overloaded"
  ) {
    return "overloaded_error";
  }
  if (
    normalized === "authentication_error" ||
    normalized === "missing_authentication_header" ||
    normalized === "http_401" ||
    normalized === "unauthorized"
  ) {
    return "authentication_error";
  }
  return undefined;
}

/**
 * Classify the production failure families used by the Factory triage queue.
 * The regime is deliberately derived from the durable run id, not inferred
 * from prose: scheduled runs use the `job-` namespace and interactive runs do
 * not. This keeps a healthy chat sample from hiding a scheduled outage.
 */
export function classifyAgentFailure(input: {
  runId?: unknown;
  errorCode?: unknown;
  errorDetail?: unknown;
  terminalReason?: unknown;
  terminalEvent?: unknown;
  regime?: AgentFailureRegime;
}): AgentFailureTaxonomy {
  const regime =
    input.regime ??
    (typeof input.runId === "string" && input.runId.startsWith("job-")
      ? "scheduled"
      : "interactive");
  const explicit = knownCode(input.errorCode);
  if (explicit) {
    return {
      code: explicit,
      label: LABELS[explicit],
      regime,
      source: "error_code",
    };
  }

  const evidence = [
    input.errorCode,
    input.errorDetail,
    input.terminalReason,
    input.terminalEvent,
  ].filter((value) => value !== undefined && value !== null);
  for (const value of evidence) {
    const text =
      typeof value === "string"
        ? value
        : (JSON.stringify(value) ?? String(value));
    const classified = knownCode(classifyTerminalErrorCode(text));
    if (classified) {
      return {
        code: classified,
        label: LABELS[classified],
        regime,
        source: "error_detail",
      };
    }
  }

  return {
    code: "unknown",
    label: LABELS.unknown,
    regime,
    source: "unknown",
  };
}
