import { ok } from "node:assert/strict";

import {
  closeDbExec,
  getDbExec,
  withMigrationRuntime,
} from "@agent-native/core/db";
import {
  getResourcesEmitter,
  type ResourceEvent,
} from "@agent-native/core/resources";
import { resourcePut, SHARED_OWNER } from "@agent-native/core/resources/store";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import resanitizeCaptures from "../../actions/resanitize-captures.js";
import { getDb, schema } from "../db/index.js";
import { runBrainMigrations } from "../plugins/db.js";
import { contentHash, createCapture, writeBrainSettings } from "./brain.js";

const ownerEmail = "capture-invalidation@agent-native.test";
const originalContent = "Product API ships Monday.\nNice to see you.";
const revisedContent = "Product API ships Tuesday.";
const resourcePath = "knowledge/capture-invalidation.md";

async function snapshot() {
  const db = getDb();
  return {
    captures: await db.select().from(schema.brainRawCaptures),
    knowledge: await db.select().from(schema.brainKnowledge),
    proposals: await db.select().from(schema.brainProposals),
    audiences: await db.select().from(schema.brainAudiences),
    members: await db.select().from(schema.brainAudienceMembers),
    captureAudiences: await db.select().from(schema.brainCaptureAudiences),
    queue: await db.select().from(schema.brainIngestQueue),
    resources: (
      await getDbExec().execute("SELECT * FROM resources ORDER BY id")
    ).rows,
  };
}

describe("capture invalidation across Brain and the core resource transaction", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory://");
    const { runFrameworkReleaseMigrations } =
      await import("@agent-native/core/server");
    await withMigrationRuntime(async () => {
      await runFrameworkReleaseMigrations(null);
      await runBrainMigrations(null);
    });
  }, 30_000);

  afterAll(async () => {
    await closeDbExec();
    vi.unstubAllEnvs();
  });

  it.each(["createCapture", "resanitize"] as const)(
    "%s rolls back canonical deletion and derived redaction on a late SQL failure, then commits on retry",
    async (operation) => {
      await runWithRequestContext(
        { userEmail: ownerEmail, orgScope: "personal" },
        async () => {
          const db = getDb();
          const exec = getDbExec();
          // Each operation starts with its own production-created capture/audience.
          await db.delete(schema.brainIngestQueue);
          await db.delete(schema.brainProposals);
          await db.delete(schema.brainKnowledge);
          await db.delete(schema.brainCaptureAudiences);
          await db.delete(schema.brainAudienceMembers);
          await db.delete(schema.brainAudiences);
          await db.delete(schema.brainRawCaptures);
          await db.delete(schema.brainSources);
          await exec.execute("DELETE FROM resources");
          await writeBrainSettings({
            privacyClassifier: "deterministic",
            captureSanitizationEnabled: false,
          });
          await db.insert(schema.brainSources).values({
            id: "source",
            title: "Product notes",
            provider: "manual",
            ownerEmail,
            visibility: "private",
            configJson: JSON.stringify({ sanitizeBeforeStorage: true }),
          });
          const capture = await createCapture({
            id: "capture",
            sourceId: "source",
            externalId: "meeting-note",
            title: "Product API",
            kind: "note",
            content: originalContent,
            status: "distilled",
            privacyClassifier: "deterministic",
          });
          ok(capture);
          expect(capture.content).toBe(originalContent);
          const evidenceJson = JSON.stringify([
            { captureId: capture.id, quote: originalContent },
          ]);
          await db.insert(schema.brainKnowledge).values({
            id: "knowledge",
            sourceId: "source",
            captureId: capture.id,
            title: "Published API decision",
            body: originalContent,
            summary: "Monday launch",
            evidenceJson,
            publishedResourcePath: resourcePath,
            status: "published",
            createdBy: ownerEmail,
            ownerEmail,
          });
          // Evidence-only references must be invalidated too, not only direct capture_id links.
          await db.insert(schema.brainProposals).values({
            id: "proposal",
            sourceId: "source",
            captureId: null,
            title: "API proposal",
            body: originalContent,
            rationale: "Ship the API",
            payloadJson: JSON.stringify({ body: originalContent }),
            evidenceJson,
            createdBy: ownerEmail,
            ownerEmail,
          });
          const canonical = await resourcePut(
            SHARED_OWNER,
            resourcePath,
            originalContent,
          );
          const personal = await resourcePut(
            ownerEmail,
            resourcePath,
            "Unrelated personal resource",
          );
          if (operation === "resanitize") {
            await db
              .update(schema.brainSources)
              .set({ visibility: "org" })
              .where(eq(schema.brainSources.id, "source"));
            await db
              .update(schema.brainRawCaptures)
              .set({ audienceAclHash: null })
              .where(eq(schema.brainRawCaptures.id, capture.id));
            await writeBrainSettings({ captureSanitizationEnabled: true });
          }
          const before = await snapshot();
          // The failure is reachable only after all three layers have really changed.
          await exec.execute(`CREATE FUNCTION reject_late_invalidation() RETURNS trigger AS $$
          BEGIN
            IF (SELECT content FROM brain_raw_captures WHERE id = NEW.capture_id) LIKE '%Nice to see you.%'
              OR EXISTS (SELECT 1 FROM brain_knowledge WHERE id = 'knowledge' AND status <> 'redacted')
              OR EXISTS (SELECT 1 FROM brain_proposals WHERE id = 'proposal' AND status <> 'rejected')
              OR EXISTS (SELECT 1 FROM resources WHERE owner = '__shared__' AND path = 'knowledge/capture-invalidation.md')
            THEN RAISE EXCEPTION 'invalidation did not reach all persisted layers';
            END IF;
            RAISE EXCEPTION 'injected late queue failure';
          END;
        $$ LANGUAGE plpgsql`);
          await exec.execute(`CREATE TRIGGER reject_late_invalidation BEFORE INSERT ON brain_ingest_queue
          FOR EACH ROW EXECUTE FUNCTION reject_late_invalidation()`);
          const notifications: ResourceEvent[] = [];
          const committedSnapshots: Array<ReturnType<typeof snapshot>> = [];
          const onResource = (event: ResourceEvent) => {
            if (event.type === "delete") {
              notifications.push(event);
              // A subscriber must see committed cleanup, never an open transaction's state.
              committedSnapshots.push(snapshot());
            }
          };
          const emitter = getResourcesEmitter();
          emitter.on("resources", onResource);
          const mutate = () =>
            operation === "createCapture"
              ? createCapture({
                  sourceId: "source",
                  externalId: "meeting-note",
                  title: "Product API",
                  kind: "note",
                  content: revisedContent,
                  privacyClassifier: "deterministic",
                })
              : resanitizeCaptures.run({
                  captureIds: [capture.id],
                  includeNonTranscript: true,
                  allowCitationDrift: true,
                  dryRun: false,
                });
          try {
            await expect(mutate()).rejects.toMatchObject({
              cause: expect.objectContaining({
                message: "injected late queue failure",
              }),
            });
            expect(await snapshot()).toEqual(before);
            expect(notifications).toEqual([]);
            expect(committedSnapshots).toEqual([]);
            await exec.execute(
              "DROP TRIGGER reject_late_invalidation ON brain_ingest_queue",
            );
            await exec.execute("DROP FUNCTION reject_late_invalidation()");
            const result = await mutate();
            if (operation === "resanitize")
              expect(result).toMatchObject({ updated: 1, requested: 1 });
            const after = await snapshot();
            const expectedContent =
              operation === "createCapture"
                ? revisedContent
                : "Product API ships Monday.";
            expect(after.captures).toHaveLength(1);
            expect(after.captures[0]).toMatchObject({
              id: capture.id,
              content: expectedContent,
              contentHash: await contentHash(expectedContent),
              sensitivityDisposition: "allowed",
            });
            if (operation === "resanitize") {
              expect(after.audiences).toHaveLength(before.audiences.length + 1);
              expect(after.captureAudiences).toHaveLength(1);
              const assignment = after.captureAudiences[0];
              ok(assignment);
              expect(after.captures[0]?.audienceAclHash).toBe(
                assignment.aclHash,
              );
              expect(after.audiences).toContainEqual(
                expect.objectContaining({
                  id: assignment.audienceId,
                  kind: "org",
                  aclHash: assignment.aclHash,
                }),
              );
            }
            expect(after.knowledge).toEqual([
              expect.objectContaining({
                id: "knowledge",
                title: "Redacted Brain knowledge",
                body: "",
                summary: "",
                evidenceJson: "[]",
                status: "redacted",
                publishedResourcePath: null,
              }),
            ]);
            expect(after.proposals).toEqual([
              expect.objectContaining({
                id: "proposal",
                title: "Redacted Brain proposal",
                body: "",
                rationale: "",
                payloadJson: "{}",
                evidenceJson: "[]",
                status: "rejected",
              }),
            ]);
            expect(after.resources).toEqual(
              before.resources.filter((row) => row.id !== canonical.id),
            );
            expect(after.resources).toContainEqual(
              expect.objectContaining({
                id: personal.id,
                content: personal.content,
              }),
            );
            expect(after.queue).toHaveLength(before.queue.length + 1);
            const queued = after.queue.find(
              (row) => !before.queue.some((previous) => previous.id === row.id),
            );
            expect(queued).toMatchObject({
              operation: "search-index",
              captureId: capture.id,
              status: "queued",
            });
            expect(JSON.parse(queued?.payloadJson ?? "null")).toMatchObject({
              invalidation: {
                previous: { contentHash: capture.contentHash },
                next: { contentHash: await contentHash(expectedContent) },
              },
            });
            expect(notifications).toEqual([
              {
                source: "resources",
                type: "delete",
                id: canonical.id,
                owner: SHARED_OWNER,
                path: resourcePath,
              },
            ]);
            expect(await Promise.all(committedSnapshots)).toEqual([after]);
          } finally {
            emitter.off("resources", onResource);
            await exec.execute(
              "DROP TRIGGER IF EXISTS reject_late_invalidation ON brain_ingest_queue",
            );
            await exec.execute(
              "DROP FUNCTION IF EXISTS reject_late_invalidation()",
            );
          }
        },
      );
    },
  );
});
