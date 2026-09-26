import { fail, type FailOptions } from "@agent-native/core/action";

export const AGENT_IMPORT_ERROR_CODES = {
  inputInvalid: "agent_import_input_invalid",
  pathInvalid: "agent_import_path_invalid",
  payloadTooLarge: "agent_import_payload_too_large",
  profileMissing: "agent_import_profile_missing",
  profileMalformed: "agent_import_profile_malformed",
  duplicate: "agent_import_duplicate",
} as const;

export type AgentImportErrorCode =
  (typeof AGENT_IMPORT_ERROR_CODES)[keyof typeof AGENT_IMPORT_ERROR_CODES];

export function failAgentImport(
  message: string,
  code: AgentImportErrorCode,
  options: { statusCode?: number; details?: Record<string, unknown> } = {},
): never {
  const failOptions: FailOptions = {
    errorCode: code,
    statusCode: options.statusCode ?? 400,
  };
  if (options.details !== undefined) failOptions.details = options.details;
  fail(message, failOptions);
}
