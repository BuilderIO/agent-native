import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  connectionAdvice,
  failWorkflowAction,
} from "../server/lib/workflow-action-errors.js";
import { resolveWorkflowReadScope } from "../server/lib/workflow-read-actions.js";
import { createProviderHttp } from "../server/workflow-host/option-listers/provider-http.js";
import {
  describeOptionListers,
  findOptionLister,
  listProviderOptions,
} from "../server/workflow-host/option-listers/registry.js";
import {
  InvalidCursorError,
  OptionListError,
} from "../server/workflow-host/option-listers/types.js";

const FAILURE_STATUS = {
  credential_missing: 412,
  rate_limited: 429,
  provider_unreadable: 424,
} as const;

function failFromList(error: OptionListError, resource: string): never {
  const advice =
    error.code === "credential_missing" && error.reason === "not_connected"
      ? ` ${connectionAdvice(error.provider)}`
      : "";
  return failWorkflowAction({
    message: `${error.message}${advice}`,
    errorCode: error.code,
    statusCode: FAILURE_STATUS[error.code],
    retryable: error.retryable,
    details: {
      provider: error.provider,
      resource,
      ...(error.reason ? { reason: error.reason } : {}),
      ...(error.scope ? { scope: error.scope } : {}),
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
      ...(error.status === undefined ? {} : { status: error.status }),
    },
  });
}

export default defineAction({
  description:
    "List the real channels, repositories, organizations or projects a connected provider has, so a workflow field holds a value that exists instead of an id someone typed. Resources: slack `channels` (value is the channel id; tags mark private channels and channels the bot is not in), github `repositories` (value `owner/name`), sentry `organizations`, then sentry `projects` with parent set to the organization slug (value `organization/project`, what a Sentry source's scope stores). Pass search to find one in a long list, and pass nextCursor back as cursor for the next page. Read-only, with the same credential a workflow run uses. It fails with credential_missing (not connected, refused or missing a permission: connect it), rate_limited (try again later) or provider_unreadable; an empty options list means the provider has none, never that the list could not load.",
  schema: z.object({
    factoryId: factoryIdSchema,
    provider: z
      .enum(["slack", "sentry", "github"])
      .describe("The connected provider to list from."),
    resource: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .describe(
        "What to list: channels (slack), repositories (github), organizations or projects (sentry).",
      ),
    parent: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/)
      .optional()
      .describe(
        "What the resource is listed inside: the organization slug for sentry projects.",
      ),
    search: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Only options whose name, value or detail contains this text. A search reads a few provider pages and returns nextCursor when it stopped before the end.",
      ),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("The nextCursor of the previous page; omit for the first."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    { factoryId, provider, resource, parent, search, cursor },
    context,
  ) => {
    await resolveWorkflowReadScope(factoryId, context);
    const lister = findOptionLister(provider, resource);
    if (!lister) {
      return failWorkflowAction({
        message: `${provider} has no ${resource} list. Available: ${describeOptionListers().join(", ")}.`,
        errorCode: "unsupported_resource",
        statusCode: 400,
        details: { provider, resource },
      });
    }
    if (lister.parentResource && !parent) {
      return failWorkflowAction({
        message: `${provider} ${resource} are listed inside one ${lister.parentResource.replace(/s$/, "")}: pass parent.`,
        errorCode: "parent_required",
        statusCode: 400,
        details: { provider, resource, parentResource: lister.parentResource },
      });
    }
    try {
      const page = await listProviderOptions(
        lister,
        createProviderHttp(provider, context?.signal),
        { parent, search, cursor },
      );
      return {
        provider,
        resource,
        options: page.options,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    } catch (error) {
      if (error instanceof OptionListError) {
        return failFromList(error, resource);
      }
      if (error instanceof InvalidCursorError) {
        return failWorkflowAction({
          message: error.message,
          errorCode: "bad_cursor",
          statusCode: 400,
          details: { provider, resource },
        });
      }
      throw error;
    }
  },
});
