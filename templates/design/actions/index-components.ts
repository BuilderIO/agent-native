import { defineAction } from "@agent-native/core/action";
import {
  applyTextToYDoc,
  CollabBaseVersionConflictError,
} from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import {
  lockPreparedSourceCollaboration,
  readPreparedSourceText,
  SourceWorkspaceEditConflictError,
  designSourceMutationLockKey,
  withPreparedSourceFileMutation,
} from "../server/source-workspace.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  componentIndexId,
  detectInstances,
  buildDefinitions,
  type ComponentDefinition,
  type ComponentInstance,
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

export default defineAction({
  description:
    "Scan the design's HTML for component annotations " +
    "(`data-agent-native-component`) and return the component list plus " +
    "detected instances. For inline/Alpine designs, parses the HTML directly " +
    "and persists the discovered components into component_index. For real-app " +
    "sources (localhost / fusion), the indexComponents capability must be " +
    "available; if not, returns an empty list with ctaRequired=true and a " +
    "message prompting the user to Connect Builder (free tier available).",
  schema: z.object({
    designId: z.string().describe("Design project ID to index components for"),
    fileId: z
      .string()
      .optional()
      .describe(
        "Specific design file id. Defaults to the primary index.html when omitted.",
      ),
  }),
  readOnly: false,
  http: { method: "POST" },
  run: async ({ designId, fileId }) => {
    const db = getDb();

    const access = await assertAccess("design", designId, "editor");

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    const caps = resolveSourceCapabilities(sourceType);

    const hasFullIndex = hasCapability(caps, "indexComponents");
    const ctaRequired =
      sourceType !== "inline" && !hasCapability(caps, "indexComponents");

    if (ctaRequired) {
      return {
        designId,
        sourceType,
        ctaRequired: true,
        ctaMessage:
          "Full component indexing (prop types, cva variants, Storybook " +
          "stories, jump-to-source) requires a connected Builder app. " +
          "Connect Builder (free tier available) via the Make it real CTA to unlock this feature.",
        components: [] as ComponentDefinition[],
        instances: [] as ComponentInstance[],
        totalComponents: 0,
        totalInstances: 0,
      };
    }

    const conditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designFiles.designId, designId),
      fileId
        ? eq(schema.designFiles.id, fileId)
        : eq(schema.designFiles.filename, "index.html"),
    ];
    const [candidate] = await db
      .select({ id: schema.designFiles.id })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);
    if (!candidate) throw new Error("Design HTML file not found.");

    let preparedCallbackEntered = false;
    let result;
    try {
      result = await withPreparedSourceFileMutation(
        candidate.id,
        undefined,
        async (lease) => {
          preparedCallbackEntered = true;
          const [file] = await db
            .select({
              id: schema.designFiles.id,
              designId: schema.designFiles.designId,
              filename: schema.designFiles.filename,
              content: schema.designFiles.content,
            })
            .from(schema.designFiles)
            .innerJoin(
              schema.designs,
              eq(schema.designFiles.designId, schema.designs.id),
            )
            .where(and(...conditions))
            .limit(1);

          if (!file) throw new Error("Design HTML file not found.");

          const transaction = getDbExec().transaction;
          if (!transaction) {
            throw new SourceWorkspaceEditConflictError(
              "Could not verify a source file's live version. Re-read the design and retry.",
            );
          }

          return transaction(async (tx) => {
            await tx.execute({
              sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
              args: [designSourceMutationLockKey(designId)],
            });

            const lockedFileResult = await tx.execute({
              sql: 'SELECT id, design_id AS "designId", filename, content FROM design_files WHERE id = ? AND design_id = ? FOR UPDATE',
              args: [file.id, designId],
            });
            const lockedFileRow = lockedFileResult.rows[0] as
              | {
                  id?: unknown;
                  designId?: unknown;
                  filename?: unknown;
                  content?: unknown;
                }
              | undefined;

            if (
              !lockedFileRow ||
              typeof lockedFileRow.id !== "string" ||
              typeof lockedFileRow.designId !== "string" ||
              typeof lockedFileRow.filename !== "string" ||
              (lockedFileRow.content !== null &&
                typeof lockedFileRow.content !== "string") ||
              lockedFileRow.content !== file.content
            ) {
              throw new SourceWorkspaceEditConflictError(
                "The source file changed while its live version was being read. Re-read the design and retry.",
              );
            }
            const lockedFile = {
              id: lockedFileRow.id,
              designId: lockedFileRow.designId,
              filename: lockedFileRow.filename,
              content: lockedFileRow.content as string | null,
            };

            const preparedCollaboration = await lockPreparedSourceCollaboration(
              tx,
              file.id,
              lease,
            );
            let html = (lockedFile.content as string | null) ?? "";

            if (preparedCollaboration.needsSeed) {
              applyTextToYDoc(lease.doc, "content", html, "agent");
              try {
                await lease.persist(tx, html);
              } catch (error) {
                if (error instanceof CollabBaseVersionConflictError) {
                  throw new SourceWorkspaceEditConflictError(
                    "The source file changed while its live version was being initialized. Re-read the design and retry.",
                  );
                }
                throw error;
              }
            }
            html = readPreparedSourceText(lease);

            const codeLayerSource: CodeLayerSource = {
              kind: "design-file",
              designId: lockedFile.designId,
              fileId: lockedFile.id,
              filename: lockedFile.filename,
            };
            const projection = buildCodeLayerProjection(html, {
              source: codeLayerSource,
            });
            const instances = detectInstances(projection.nodes);
            const definitions = buildDefinitions(instances);

            const now = new Date().toISOString();
            const selectorByNodeId = new Map(
              instances.map((instance) => [instance.nodeId, instance.selector]),
            );
            const designOwner = (access.resource as { ownerEmail?: unknown })
              .ownerEmail;
            const ownerEmail =
              getRequestUserEmail() ??
              (typeof designOwner === "string" && designOwner
                ? designOwner
                : null);
            if (!ownerEmail) throw new Error("no authenticated user");

            for (const def of definitions) {
              const id = componentIndexId(designId, def.name);
              await tx.execute({
                sql: `INSERT INTO component_index
                  (id, design_id, name, runtime_selectors, owner_email, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                  runtime_selectors = excluded.runtime_selectors,
                  updated_at = excluded.updated_at`,
                args: [
                  id,
                  designId,
                  def.name,
                  JSON.stringify(
                    def.instanceNodeIds
                      .map((nodeId) => selectorByNodeId.get(nodeId))
                      .filter((selector): selector is string =>
                        Boolean(selector),
                      ),
                  ),
                  ownerEmail,
                  now,
                  now,
                ],
              });
            }

            const indexMap = new Map(
              definitions.map((def) => [
                def.name,
                componentIndexId(designId, def.name),
              ]),
            );
            const annotatedInstances = instances.map((inst) => ({
              ...inst,
              componentIndexId: indexMap.get(inst.name),
            }));

            return {
              designId,
              sourceType,
              ctaRequired: false,
              hasFullIndex,
              components: definitions,
              instances: annotatedInstances,
              totalComponents: definitions.length,
              totalInstances: instances.length,
              note:
                sourceType === "inline"
                  ? "Showing annotated Alpine components from data-agent-native-component attributes. Connect Builder (free tier available) for full TS prop types and cva variants."
                  : undefined,
            };
          });
        },
      );
    } catch (error) {
      if (
        !preparedCallbackEntered &&
        !(error instanceof SourceWorkspaceEditConflictError)
      ) {
        throw new SourceWorkspaceEditConflictError(
          "Could not verify a source file's live version. Re-read the design and retry.",
        );
      }
      throw error;
    }

    return result;
  },
});
