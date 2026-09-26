import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => ({ status: "no-recipients" })),
}));

const directory = mkdtempSync(join(tmpdir(), "content-editor-adjacent-"));
const owner = "editor-adjacent@example.com";
const ctx = { caller: "frontend" as const, userEmail: owner };

let createDocument: typeof import("./create-document.js").default;
let getDocument: typeof import("./get-document.js").default;
let updateDocument: typeof import("./update-document.js").default;
let addComment: typeof import("./add-comment.js").default;
let updateComment: typeof import("./update-comment.js").default;
let suggestDocumentEdit: typeof import("./suggest-document-edit.js").default;
let getResourceSuggestion: typeof import("@agent-native/core/review/suggestions/actions/get-resource-suggestion").default;
let decideResourceSuggestion: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;
let listDocumentHistory: typeof import("./list-document-history.js").default;
let listDocumentHistoryCheckpoints: typeof import("./list-document-history-checkpoints.js").default;
let getDocumentHistoryCheckpoint: typeof import("./get-document-history-checkpoint.js").default;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "db")}`);
  vi.stubEnv("AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS", "1");
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await (
    await import("../server/plugins/suggested-edits.js")
  ).default(undefined as never);
  createDocument = (await import("./create-document.js")).default;
  getDocument = (await import("./get-document.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  addComment = (await import("./add-comment.js")).default;
  updateComment = (await import("./update-comment.js")).default;
  suggestDocumentEdit = (await import("./suggest-document-edit.js")).default;
  getResourceSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/get-resource-suggestion")
  ).default;
  decideResourceSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
  ).default;
  listDocumentHistory = (await import("./list-document-history.js")).default;
  listDocumentHistoryCheckpoints = (
    await import("./list-document-history-checkpoints.js")
  ).default;
  getDocumentHistoryCheckpoint = (
    await import("./get-document-history-checkpoint.js")
  ).default;
}, 60_000);

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

async function asOwner<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: owner, orgId: null }, run);
}

async function createPage(content: string) {
  const created = await createDocument.run(
    { title: "Adjacent edit fixture", content },
    ctx,
  );
  return getDocument.run({ id: created.id }, ctx);
}

describe("editor-adjacent activity", () => {
  it("keeps comment-only activity outside body revision and accepts a body save from the original base", async () => {
    await asOwner(async () => {
      const original = await createPage("Original passage.");
      const comment = await addComment.run(
        { documentId: original.id, content: "Review this passage." },
        ctx,
      );
      await updateComment.run(
        { id: comment.id, documentId: original.id, resolved: true },
        ctx,
      );

      const afterComment = await getDocument.run({ id: original.id }, ctx);
      expect(afterComment.content).toBe(original.content);
      expect(afterComment.bodyRevision).toBe(original.bodyRevision);
      expect(afterComment.revision).toBe(original.revision);

      const saved = await updateDocument.run(
        {
          id: original.id,
          content: "Revised passage.",
          baseRevision: original.revision,
          authoredBaseRevision: original.revision,
          authoredBaseContent: original.content,
          authoredCandidateContent: "Revised passage.",
          editorSessionId: `comment-neighbor-${original.id}`,
          editorEditGeneration: 1,
          editorSnapshotTitle: original.title,
          editorSnapshotContent: "Revised passage.",
          browserSaveAttemptId: `comment-neighbor-${original.id}`,
          historySessionId: "comment-neighbor-save",
        },
        ctx,
      );
      expect(saved).not.toHaveProperty("conflict", true);
      expect(saved.content).toBe("Revised passage.");
      const afterSave = await getDocument.run({ id: original.id }, ctx);
      expect(afterSave.content).toBe("Revised passage.");
      expect(afterSave.bodyRevision).toBe(original.bodyRevision + 1);
    });
  });

  it("accepts a suggestion after comment activity and exposes both bodies in History", async () => {
    await asOwner(async () => {
      const original = await createPage(
        "Shared passage.\n\nIndependent paragraph.",
      );
      const proposed = await suggestDocumentEdit.run(
        {
          id: original.id,
          baseRevision: original.revision,
          idempotencyKey: `suggest-${original.id}`,
          find: "Shared passage.",
          replace: "Revised shared passage.",
        },
        ctx,
      );
      await addComment.run(
        { documentId: original.id, content: "Keep the second paragraph." },
        ctx,
      );
      const suggestion = await getResourceSuggestion.run(
        { id: proposed.suggestionId },
        ctx,
      );
      const decision = await decideResourceSuggestion.run(
        {
          id: suggestion.id,
          decision: "accepted",
          idempotencyKey: `accept-${suggestion.id}`,
          observedBase: suggestion.baseRevision,
          observedRevision: suggestion.revision,
        },
        ctx,
      );
      expect(decision.suggestion?.status).toBe("accepted");

      const after = await getDocument.run({ id: original.id }, ctx);
      expect(after.content).toBe(
        "Revised shared passage.\n\nIndependent paragraph.",
      );
      expect(after.bodyRevision).toBe(original.bodyRevision + 1);
      const groups = await listDocumentHistory.run(
        { documentId: original.id },
        ctx,
      );
      const versions = await Promise.all(
        groups.groups.map(async (group) => {
          const page = await listDocumentHistoryCheckpoints.run(
            { documentId: original.id, groupId: group.id },
            ctx,
          );
          return Promise.all(
            page.checkpoints.map((checkpoint) =>
              getDocumentHistoryCheckpoint.run(
                { documentId: original.id, versionId: checkpoint.id },
                ctx,
              ),
            ),
          );
        }),
      );
      const bodies = versions
        .flat()
        .map((version) => version.checkpoint.content);
      expect(bodies).toContain(original.content);
      expect(bodies).toContain(after.content);
    });
  });

  it("accepts a suggestion after an independent body edit without losing either change", async () => {
    await asOwner(async () => {
      const original = await createPage(
        "Shared passage.\n\nIndependent paragraph.",
      );
      const proposed = await suggestDocumentEdit.run(
        {
          id: original.id,
          baseRevision: original.revision,
          idempotencyKey: `independent-suggest-${original.id}`,
          find: "Shared passage.",
          replace: "Revised shared passage.",
        },
        ctx,
      );
      await updateDocument.run(
        {
          id: original.id,
          content: "Shared passage.\n\nUpdated independent paragraph.",
          baseRevision: original.revision,
          authoredBaseRevision: original.revision,
          authoredBaseContent: original.content,
          authoredCandidateContent:
            "Shared passage.\n\nUpdated independent paragraph.",
          editorSessionId: `independent-edit-${original.id}`,
          editorEditGeneration: 1,
          editorSnapshotTitle: original.title,
          editorSnapshotContent:
            "Shared passage.\n\nUpdated independent paragraph.",
          browserSaveAttemptId: `independent-edit-${original.id}`,
          historySessionId: "independent-browser-edit",
        },
        ctx,
      );
      const suggestion = await getResourceSuggestion.run(
        { id: proposed.suggestionId },
        ctx,
      );
      const decision = await decideResourceSuggestion.run(
        {
          id: suggestion.id,
          decision: "accepted",
          idempotencyKey: `independent-accept-${suggestion.id}`,
          observedBase: suggestion.baseRevision,
          observedRevision: suggestion.revision,
        },
        ctx,
      );
      expect(decision.suggestion?.status).toBe("accepted");
      const after = await getDocument.run({ id: original.id }, ctx);
      expect(after.content).toBe(
        "Revised shared passage.\n\nUpdated independent paragraph.",
      );
      expect(after.bodyRevision).toBe(original.bodyRevision + 2);
    });
  });
});
