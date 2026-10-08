import { defineAction, fail } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  nowIso,
  parseJson,
  serializeSource,
  stableJson,
} from "../server/lib/brain.js";
import {
  assertSourceCredentialAvailable,
  assertSourceWorkspaceConnectionAvailable,
} from "../server/lib/source-credentials.js";
import { withSourceAnswerPolicy } from "../server/lib/source-policy.js";
import { normalizeSlackChannelConfig } from "../shared/slack-source-config.js";
import {
  optionalJsonRecordSchema,
  sourceAnswerPolicySchema,
} from "./_schemas.js";
import {
  assertValidSourceConfig,
  mergeSourceConfigJson,
  sourceConfigJsonSchema,
} from "./_source-config.js";

export default defineAction({
  description:
    "Update a Brain source's title, status, config, cursor, or trusted-answer policy. Config keys are merged into the existing config; a top-level key such as zoom is replaced as a whole.",
  schema: z.object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    status: z.enum(["active", "paused", "archived", "error"]).optional(),
    config: optionalJsonRecordSchema.describe(
      "Config keys to merge, as an object for UI and CLI callers; agents use configJson",
    ),
    configJson: sourceConfigJsonSchema,
    cursor: optionalJsonRecordSchema,
    policy: sourceAnswerPolicySchema
      .optional()
      .describe(
        "Merge trust, answer eligibility, authority, freshness, review, or conflict behavior into the source answer policy",
      ),
  }),
  run: async (args) => {
    const access = await assertAccess("brain-source", args.id, "editor");
    const existing = access.resource;
    const mergedConfig = mergeSourceConfigJson(args.config, args.configJson);
    const config =
      mergedConfig && Object.keys(mergedConfig).length
        ? mergedConfig
        : undefined;
    if (
      args.title === undefined &&
      args.status === undefined &&
      config === undefined &&
      args.cursor === undefined &&
      args.policy === undefined
    ) {
      fail(
        "update-source received no changes. Pass title, status, policy, or the config keys to change in configJson.",
        { errorCode: "no_source_changes" },
      );
    }
    if (config !== undefined) {
      assertValidSourceConfig(existing.provider, config);
    }
    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.status !== undefined) updates.status = args.status;
    if (config !== undefined || args.policy !== undefined) {
      let nextConfig: Record<string, unknown> = {
        ...parseJson<Record<string, unknown>>(existing.configJson, {}),
        ...config,
      };
      if (
        args.policy !== undefined ||
        (config && Object.prototype.hasOwnProperty.call(config, "answerPolicy"))
      ) {
        nextConfig = withSourceAnswerPolicy(
          nextConfig,
          args.policy ?? nextConfig.answerPolicy,
        );
      }
      if (existing.provider === "slack") {
        nextConfig = normalizeSlackChannelConfig(nextConfig, config ?? {});
      }
      const workspaceConnectionId =
        typeof nextConfig.workspaceConnectionId === "string"
          ? nextConfig.workspaceConnectionId.trim()
          : "";
      if (workspaceConnectionId) {
        nextConfig.workspaceConnectionId = workspaceConnectionId;
        await assertSourceWorkspaceConnectionAvailable({
          provider: existing.provider,
          workspaceConnectionId,
        });
        await assertSourceCredentialAvailable({
          provider: existing.provider,
          workspaceConnectionId,
          ctx: getCredentialContext(),
        });
      } else {
        delete nextConfig.workspaceConnectionId;
      }
      updates.configJson = stableJson(nextConfig);
      if (typeof nextConfig.sourceKey === "string") {
        updates.sourceKey = nextConfig.sourceKey;
      }
      if (typeof nextConfig.ingestTokenHash === "string") {
        updates.ingestTokenHash = nextConfig.ingestTokenHash;
      }
    }
    if (args.cursor !== undefined) {
      updates.cursorJson = stableJson({
        ...parseJson(existing.cursorJson, {}),
        ...args.cursor,
      });
    }
    await getDb()
      .update(schema.brainSources)
      .set(updates)
      .where(eq(schema.brainSources.id, args.id));
    const [source] = await getDb()
      .select()
      .from(schema.brainSources)
      .where(eq(schema.brainSources.id, args.id))
      .limit(1);
    return { source: serializeSource(source) };
  },
});
