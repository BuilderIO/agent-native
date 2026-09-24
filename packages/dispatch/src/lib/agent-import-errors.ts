/**
 * Agent-import failures the user is meant to read.
 *
 * `throw new Error(...)` does not survive the action HTTP transport: there it
 * is indistinguishable from a driver or upstream blowup, so it is replaced by
 * a generic 500 `"Internal server error"` and only `fail()` declares the text
 * safe to echo (see `packages/core/src/action.ts`). `normalizeAgentPack`,
 * `normalizeImportedAgent`, and `connect-external-agent` all raised their
 * validation diagnoses as bare `Error`s, so selecting a non-agent-pack file
 * (a CSV with no profile candidate, malformed JSON, a malformed endpoint URL)
 * reached the import dialog as the same opaque toast as a genuine crash.
 *
 * Raise through this helper instead so every caller-correctable diagnosis in
 * the shared import path stays a clean 4xx.
 */

import { fail, type FailOptions } from "@agent-native/core/action";

export const AGENT_IMPORT_ERROR_CODES = {
  /** The pack/file/endpoint input is missing, empty, or has no usable content. */
  inputInvalid: "agent_import_input_invalid",
  /** A file path escapes the pack, is ignored/private, or is too long. */
  pathInvalid: "agent_import_path_invalid",
  /** A file, the whole pack, or a pasted source exceeds a size budget. */
  payloadTooLarge: "agent_import_payload_too_large",
  /** No agent.md/CLAUDE.md/Markdown or JSON profile file was found. */
  profileMissing: "agent_import_profile_missing",
  /** The profile looked like JSON/a definition but could not be parsed. */
  profileMalformed: "agent_import_profile_malformed",
  /** An agent/endpoint already exists at the destination path. */
  duplicate: "agent_import_duplicate",
} as const;

export type AgentImportErrorCode =
  (typeof AGENT_IMPORT_ERROR_CODES)[keyof typeof AGENT_IMPORT_ERROR_CODES];

/** Abort an agent/agent-pack/endpoint import with a message the user can act on. */
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
