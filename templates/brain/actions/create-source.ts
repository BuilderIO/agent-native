import { defineAction } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  createSource,
  nanoid,
  serializeSource,
  sha256Hex,
} from "../server/lib/brain.js";
import {
  assertSourceCredentialAvailable,
  assertSourceWorkspaceConnectionAvailable,
} from "../server/lib/source-credentials.js";
import { withSourceAnswerPolicy } from "../server/lib/source-policy.js";
import {
  assertBrainAdmin,
  recordZoomAuditEvent,
  zoomAllowlistChange,
} from "../server/lib/zoom-governance.js";
import {
  jsonRecordSchema,
  sourceAnswerPolicySchema,
  sourceProviderSchema,
} from "./_schemas.js";
import {
  assertValidSourceConfig,
  mergeSourceConfigJson,
  sourceConfigJsonSchema,
} from "./_source-config.js";

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default defineAction({
  description:
    "Create a Brain source for manual imports, generic captures, Clips, Slack, Granola, GitHub, or Zoom. Only organization owners and admins can create Zoom sources.",
  schema: z.object({
    id: z.string().optional().describe("Optional optimistic source ID"),
    title: z.string().min(1).describe("Human-readable source name"),
    provider: sourceProviderSchema.default("manual"),
    config: jsonRecordSchema.describe(
      "Provider configuration object for UI and CLI callers; agents use configJson",
    ),
    configJson: sourceConfigJsonSchema,
    sourceKey: z
      .string()
      .optional()
      .describe("Stable key used by signed webhook payloads"),
    ingestToken: z
      .string()
      .optional()
      .describe("Optional signed-ingest bearer token; stored only as a hash"),
    visibility: z.enum(["private", "org"]).default("private"),
    policy: sourceAnswerPolicySchema
      .optional()
      .describe(
        "Optional answer policy controlling trust, eligibility, authority, freshness, review, and conflicts",
      ),
  }),
  run: async (args) => {
    let config = { ...mergeSourceConfigJson(args.config, args.configJson) };
    assertValidSourceConfig(args.provider, config, { creating: true });
    const zoomAdmin =
      args.provider === "zoom" ? await assertBrainAdmin() : undefined;
    if (args.policy !== undefined || config.answerPolicy !== undefined) {
      config = withSourceAnswerPolicy(
        config,
        args.policy ?? config.answerPolicy,
      );
    }
    const workspaceConnectionId =
      typeof config.workspaceConnectionId === "string"
        ? config.workspaceConnectionId.trim()
        : "";
    if (workspaceConnectionId) {
      config.workspaceConnectionId = workspaceConnectionId;
      await assertSourceWorkspaceConnectionAvailable({
        provider: args.provider,
        workspaceConnectionId,
      });
      await assertSourceCredentialAvailable({
        provider: args.provider,
        workspaceConnectionId,
        ctx: getCredentialContext(),
      });
    } else {
      delete config.workspaceConnectionId;
    }
    let ingestToken: string | undefined;
    if (args.sourceKey) {
      ingestToken = args.ingestToken ?? `brain_${nanoid(32)}`;
      config.sourceKey = args.sourceKey;
      config.ingestTokenHash = await sha256Hex(ingestToken);
    }
    const values = {
      id: args.id,
      title: args.title,
      provider: args.provider,
      config,
      visibility: args.visibility,
    };
    const source = zoomAdmin
      ? await getDb().transaction(async (tx) => {
          const db = tx as unknown as ReturnType<typeof getDb>;
          const created = await createSource(values, db);
          await recordZoomAuditEvent(
            {
              orgId: created.orgId ?? zoomAdmin.orgId,
              sourceId: created.id,
              actorEmail: zoomAdmin.email,
              event: "allowlist-changed",
              detail: {
                created: true,
                ...zoomAllowlistChange({}, objectRecord(config.zoom)),
              },
            },
            db,
          );
          return created;
        })
      : await createSource(values);
    return { source: serializeSource(source), ingestToken };
  },
});
