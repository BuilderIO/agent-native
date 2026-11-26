import { z } from "zod";

import { defineAction, defineActionErrors, fail } from "../action.js";
import {
  createWorkspaceCredentialService,
  WorkspaceCredentialError,
  type WorkspaceCredentialServiceOptions,
} from "./workspace-credentials.js";

const statuses: Record<WorkspaceCredentialError["code"], number> = {
  invalid_input: 400,
  forbidden: 403,
  validation_failed: 400,
  conflict: 409,
  refused: 409,
  storage_failed: 503,
};
const operation = z
  .object({ operationId: z.string().trim().min(1).max(200) })
  .strict();
const identity = z.object({ connectionId: z.string().min(1) }).strict();
async function runPrivate<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code =
      error instanceof WorkspaceCredentialError ? error.code : "storage_failed";
    fail("The workspace credential operation could not be confirmed.", {
      errorCode: `workspace_credential_${code}`,
      statusCode: statuses[code],
    });
  }
}

/** Server registration only. Options are trusted provider definitions, never
 * browser input. Raw credentials stay on this private frontend boundary.
 * Archive requires a settled create; it does not cancel an unpublished one. */
export function createWorkspaceCredentialActions(
  options: WorkspaceCredentialServiceOptions,
) {
  const service = createWorkspaceCredentialService(options);
  // Built per registration, not at import: the connections barrel is imported
  // by modules that never register these actions.
  const errors = defineActionErrors(
    "workspace_credential_invalid_input",
    "workspace_credential_forbidden",
    "workspace_credential_validation_failed",
    "workspace_credential_conflict",
    "workspace_credential_refused",
    "workspace_credential_storage_failed",
  );
  return Object.freeze({
    create: defineAction({
      requiresSignedInBrowser: true,
      uiOnly: true,
      agentTool: false,
      mcpTool: false,
      toolCallable: false,
      persistInBrowser: false,
      persistInChatHistory: false,
      audit: { recordInputs: false },
      description:
        "Validate and create a workspace connection from its private credential form.",
      schema: operation
        .extend({
          name: z.string().trim().min(1).max(200).optional(),
          config: z
            .record(
              z.string(),
              z.union([
                z.string().max(65536),
                z.number().finite(),
                z.boolean(),
              ]),
            )
            .optional(),
          secretValues: z
            .array(
              z
                .object({
                  key: z.string().min(1).max(200),
                  secret: z.string().min(1).max(65536),
                })
                .strict(),
            )
            .min(1)
            .max(32),
        })
        .strict(),
      outputSchema: identity,
      errors,
      http: { method: "POST" },
      maxBodyBytes: 128 * 1024,
      run: (input) => runPrivate(() => service.create(input)),
    }),
    update: defineAction({
      requiresSignedInBrowser: true,
      uiOnly: true,
      agentTool: false,
      mcpTool: false,
      toolCallable: false,
      persistInBrowser: false,
      persistInChatHistory: false,
      audit: { recordInputs: false },
      description:
        "Validate and update a native workspace connection against the revision opened in its private form.",
      schema: identity
        .extend({
          revision: z.string().min(1).max(200),
          draft: z.boolean().optional(),
          name: z.string().trim().min(1).max(200).optional(),
          config: z
            .record(
              z.string(),
              z.union([
                z.string().max(65536),
                z.number().finite(),
                z.boolean(),
              ]),
            )
            .optional(),
          secretValues: z
            .array(
              z
                .object({
                  key: z.string().min(1).max(200),
                  secret: z.string().min(1).max(65536),
                })
                .strict(),
            )
            .max(32)
            .optional(),
        })
        .strict(),
      outputSchema: identity,
      errors,
      http: { method: "POST" },
      maxBodyBytes: 128 * 1024,
      run: (input) => runPrivate(() => service.update(input)),
    }),
    recover: defineAction({
      requiresSignedInBrowser: true,
      uiOnly: true,
      agentTool: false,
      mcpTool: false,
      toolCallable: false,
      persistInBrowser: false,
      persistInChatHistory: false,
      audit: { recordInputs: false },
      description:
        "Read this manager's exact workspace connection operation without resubmitting credentials.",
      schema: operation,
      outputSchema: identity.nullable(),
      errors,
      http: { method: "GET" },
      readOnly: true,
      run: (input) => runPrivate(() => service.findCreatedConnection(input)),
    }),
    archiveConnection: defineAction({
      requiresSignedInBrowser: true,
      uiOnly: true,
      agentTool: false,
      mcpTool: false,
      toolCallable: false,
      persistInBrowser: false,
      persistInChatHistory: false,
      audit: { recordInputs: false },
      description:
        "Soft-archive a native workspace connection by durable identity with current workspace management access.",
      schema: identity,
      outputSchema: z.object({ archived: z.boolean() }).strict(),
      errors,
      http: { method: "POST" },
      run: (input) => runPrivate(() => service.archiveConnection(input)),
    }),
    archive: defineAction({
      requiresSignedInBrowser: true,
      uiOnly: true,
      agentTool: false,
      mcpTool: false,
      toolCallable: false,
      persistInBrowser: false,
      persistInChatHistory: false,
      audit: { recordInputs: false },
      description:
        "Soft-archive this manager's settled workspace connection operation, preserving encrypted records.",
      schema: operation,
      outputSchema: z.object({ archived: z.boolean() }).strict(),
      errors,
      http: { method: "POST" },
      run: (input) => runPrivate(() => service.archiveCreatedConnection(input)),
    }),
  });
}

export type WorkspaceCredentialActions = ReturnType<
  typeof createWorkspaceCredentialActions
>;
