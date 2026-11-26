import { isDeepStrictEqual } from "node:util";

import {
  defineAction,
  fail,
  isOutsideAgentCall,
} from "@agent-native/core/action";
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
import { invalidateGoogleSourceAudiences } from "../server/lib/google-source-access.js";
import {
  requirePersonalGoogleConnection,
  requirePersonalGoogleSourceOwner,
} from "../server/lib/google-source-connection.js";
import { withGoogleSourceLock } from "../server/lib/google-source-lock.js";
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
import { isGoogleSourceProvider } from "../shared/google-source-config.js";
import { normalizeSlackChannelConfig } from "../shared/slack-source-config.js";
import { COMPANY_CONTEXT_INTAKE_KEY } from "../shared/types.js";
import {
  optionalJsonRecordSchema,
  sourceAnswerPolicySchema,
} from "./_schemas.js";
import {
  assertValidSourceConfig,
  mergeSourceConfigJson,
  sourceConfigJsonSchema,
  sourceConfigUnchanged,
} from "./_source-config.js";

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default defineAction({
  description:
    "Update a Brain source's title, status, config, cursor, or trusted-answer policy. Config keys are merged into the existing config; a top-level key such as zoom is replaced as a whole. Only organization owners and admins can change a Zoom source's config or cursor; other editors can still change its title, status, or trusted-answer policy.",
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
  // An outside agent may rename, pause or resume a source. It asks first
  // before archiving one or changing what it reads, its credentials, or how
  // far Brain trusts its answers.
  needsApproval: (args, ctx) =>
    isOutsideAgentCall(ctx) &&
    (args.config !== undefined ||
      args.configJson !== undefined ||
      args.cursor !== undefined ||
      args.policy !== undefined ||
      (args.status !== undefined &&
        args.status !== "active" &&
        args.status !== "paused")),
  mcpTool: "search",
  run: async (args) => {
    const access = await assertAccess("brain-source", args.id, "editor");
    const applyUpdate = async (existing: typeof access.resource) => {
      const mergedConfig = mergeSourceConfigJson(args.config, args.configJson);
      if (
        [args.config, mergedConfig].some(
          (submitted) =>
            submitted !== undefined &&
            ["sourceKey", "ingestTokenHash"].some((key) =>
              Object.prototype.hasOwnProperty.call(submitted, key),
            ),
        )
      ) {
        await assertAccess("brain-source", args.id, "admin");
        const storedConfig = parseJson<Record<string, unknown>>(
          existing.configJson,
          {},
        );
        const legacy =
          existing.sourceKey === null && existing.ingestTokenHash === null;
        for (const key of ["sourceKey", "ingestTokenHash"] as const) {
          const submitted =
            mergedConfig &&
            Object.prototype.hasOwnProperty.call(mergedConfig, key);
          if (
            submitted &&
            mergedConfig[key] !== null &&
            typeof mergedConfig[key] !== "string"
          ) {
            fail("Source credentials must be strings or null.", {
              errorCode: "invalid_source_config",
            });
          }
          if (
            !submitted &&
            !legacy &&
            (storedConfig[key] ?? null) !== existing[key]
          ) {
            fail(
              "Source credentials are inconsistent. Submit both credential fields to update them.",
              {
                errorCode: "source_config_conflict",
                statusCode: 409,
              },
            );
          }
        }
      }
      let config =
        mergedConfig && Object.keys(mergedConfig).length
          ? mergedConfig
          : undefined;
      if (isGoogleSourceProvider(existing.provider) && config !== undefined) {
        const previousConfig = parseJson<Record<string, unknown>>(
          existing.configJson,
          {},
        );
        if (isDeepStrictEqual({ ...previousConfig, ...config }, previousConfig))
          config = undefined;
      }
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
      if (isGoogleSourceProvider(existing.provider)) {
        requirePersonalGoogleSourceOwner(existing.ownerEmail);
        if (args.cursor !== undefined) {
          const previousCursor = parseJson<Record<string, unknown>>(
            existing.cursorJson,
            {},
          );
          if (
            !isDeepStrictEqual(
              { ...previousCursor, ...args.cursor },
              previousCursor,
            )
          )
            await invalidateGoogleSourceAudiences(existing.id);
        }
        if (config !== undefined) {
          const nextConfig = {
            ...parseJson<Record<string, unknown>>(existing.configJson, {}),
            ...config,
          };
          assertValidSourceConfig(existing.provider, nextConfig);
          await requirePersonalGoogleConnection(
            existing.provider,
            nextConfig,
            existing.ownerEmail,
          );
        }
      }
      const zoomAdmin =
        existing.provider === "zoom" &&
        (config !== undefined || args.cursor !== undefined)
          ? await assertBrainAdmin(existing.orgId)
          : undefined;
      if (config !== undefined) {
        if (!isGoogleSourceProvider(existing.provider))
          assertValidSourceConfig(existing.provider, config);
        if (
          Object.prototype.hasOwnProperty.call(
            config,
            COMPANY_CONTEXT_INTAKE_KEY,
          ) &&
          config[COMPANY_CONTEXT_INTAKE_KEY] !==
            parseJson<Record<string, unknown>>(existing.configJson, {})[
              COMPANY_CONTEXT_INTAKE_KEY
            ]
        ) {
          fail("The Company Context intake marker cannot be changed.", {
            errorCode: "company_context_intake_reserved",
          });
        }
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
          (config &&
            Object.prototype.hasOwnProperty.call(config, "answerPolicy"))
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
        if (
          config &&
          ["sourceKey", "ingestTokenHash"].some((key) =>
            Object.prototype.hasOwnProperty.call(config, key),
          )
        ) {
          const legacy =
            existing.sourceKey === null && existing.ingestTokenHash === null;
          for (const key of ["sourceKey", "ingestTokenHash"] as const) {
            if (Object.prototype.hasOwnProperty.call(config, key)) {
              updates[key] = config[key];
            } else if (legacy && typeof nextConfig[key] === "string") {
              updates[key] = nextConfig[key];
            }
          }
        }
        const nextConfigJson = stableJson(nextConfig);
        if (
          isGoogleSourceProvider(existing.provider) &&
          nextConfigJson !== existing.configJson
        )
          await invalidateGoogleSourceAudiences(existing.id);
        updates.configJson = nextConfigJson;
      }
      if (args.cursor !== undefined) {
        updates.cursorJson = stableJson({
          ...parseJson(existing.cursorJson, {}),
          ...args.cursor,
        });
      }
      const zoomChange =
        zoomAdmin &&
        config &&
        Object.prototype.hasOwnProperty.call(config, "zoom")
          ? zoomAllowlistChange(
              objectRecord(
                parseJson<Record<string, unknown>>(existing.configJson, {})
                  .zoom,
              ),
              objectRecord(config.zoom),
            )
          : undefined;
      const save = async (db: ReturnType<typeof getDb>) => {
        const saved = await db
          .update(schema.brainSources)
          .set(updates)
          .where(
            updates.configJson === undefined
              ? eq(schema.brainSources.id, args.id)
              : sourceConfigUnchanged(existing),
          )
          .returning();
        const source = saved.find((row) => row.id === args.id);
        if (!source)
          fail("The source changed. Reload it and retry the update.", {
            errorCode: "source_config_conflict",
            statusCode: 409,
          });
        return source;
      };
      const source =
        zoomAdmin &&
        zoomChange &&
        (zoomChange.added.length ||
          zoomChange.removed.length ||
          zoomChange.changedSettings.length)
          ? await getDb().transaction(async (tx) => {
              const db = tx as unknown as ReturnType<typeof getDb>;
              const saved = await save(db);
              await recordZoomAuditEvent(
                {
                  orgId: existing.orgId,
                  sourceId: existing.id,
                  actorEmail: zoomAdmin.email,
                  event: "allowlist-changed",
                  detail: zoomChange,
                },
                db,
              );
              return saved;
            })
          : await save(getDb());
      return { source: serializeSource(source) };
    };
    if (isGoogleSourceProvider(access.resource.provider)) {
      requirePersonalGoogleSourceOwner(access.resource.ownerEmail);
      return withGoogleSourceLock(args.id, async (current) => {
        if (!current || !isGoogleSourceProvider(current.provider))
          fail("Source is unavailable.", { errorCode: "source_unavailable" });
        return applyUpdate(current);
      });
    }
    return applyUpdate(access.resource);
  },
});
