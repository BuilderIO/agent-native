import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalizeNfm } from "../shared/nfm.js";
import { resolveMarkdownSuggestionRange } from "../shared/suggestion-rebase.js";
import { suggestionTextPresentationForSource } from "../shared/suggestion-text.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-suggest-document-edit-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");
type SuggestAction = typeof import("./suggest-document-edit.js").default;
type CreateDocumentAction = typeof import("./create-document.js").default;
type GetDocumentAction = typeof import("./get-document.js").default;
type ListSuggestionsAction =
  typeof import("@agent-native/core/review/suggestions/actions/list-resource-suggestions").default;
type UpdateDocumentAction = typeof import("./update-document.js").default;
type GetSuggestionAction =
  typeof import("@agent-native/core/review/suggestions/actions/get-resource-suggestion").default;
type DecideSuggestionAction =
  typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let suggestDocumentEdit: SuggestAction;
let createDocument: CreateDocumentAction;
let getDocument: GetDocumentAction;
let listResourceSuggestions: ListSuggestionsAction;
let updateDocument: UpdateDocumentAction;
let getResourceSuggestion: GetSuggestionAction;
let decideResourceSuggestion: DecideSuggestionAction;

const ctx = {
  caller: "cli" as const,
  userEmail: "owner@example.com",
};

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await (
    await import("../server/plugins/suggested-edits.js")
  ).default(undefined as never);
  suggestDocumentEdit = (await import("./suggest-document-edit.js")).default;
  createDocument = (await import("./create-document.js")).default;
  getDocument = (await import("./get-document.js")).default;
  listResourceSuggestions = (
    await import("@agent-native/core/review/suggestions/actions/list-resource-suggestions")
  ).default;
  updateDocument = (await import("./update-document.js")).default;
  getResourceSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/get-resource-suggestion")
  ).default;
  decideResourceSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
  ).default;
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let sequence = 0;

async function createPage(content: string) {
  return runWithRequestContext(
    { userEmail: ctx.userEmail, orgId: null },
    async () => {
      sequence += 1;
      const result = (await createDocument.run(
        {
          title: `Suggest edit page ${sequence}`,
          content,
        },
        ctx,
      )) as { id: string };
      const doc = (await getDocument.run({ id: result.id }, ctx)) as {
        revision: string;
      };
      return { id: result.id as string, revision: doc.revision };
    },
  );
}

describe("suggest-document-edit", () => {
  it("creates independent edits under one proposal and replays its membership", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const before = "We shipped quickly, and the results were good.";
        const after = "We shipped quickly and the results were excellent.";
        const { id, revision } = await createPage(before);
        const args = {
          id,
          baseRevision: revision,
          idempotencyKey: `granular-${id}`,
          find: before,
          replace: after,
          summary: "Tighten release sentence",
        };
        const result = (await suggestDocumentEdit.run(args, ctx)) as {
          suggestionId: string;
          suggestionIds: string[];
          proposalId: string;
        };
        expect(result.suggestionIds).toHaveLength(2);
        expect(result.suggestionId).toBe(result.suggestionIds[0]);
        expect(result.proposalId).toBeTruthy();
        const listed = (await listResourceSuggestions.run(
          { resourceType: "document", resourceId: id },
          ctx,
        )) as {
          suggestions: Array<{
            id: string;
            proposalId?: string;
            operations: Array<{
              before: { markdown: string; changedText: string };
              after: { changedText: string };
              anchor: { from: number; to: number };
            }>;
          }>;
        };
        const children = result.suggestionIds.map(
          (childId) => listed.suggestions.find((item) => item.id === childId)!,
        );
        expect(
          children.every((item) => item.proposalId === result.proposalId),
        ).toBe(true);
        expect(
          children.map((item) => [
            item.operations[0]!.before.changedText,
            item.operations[0]!.after.changedText,
          ]),
        ).toEqual([
          [",", ""],
          ["good", "excellent"],
        ]);
        const replay = (await suggestDocumentEdit.run(
          args,
          ctx,
        )) as typeof result;
        expect(replay.suggestionIds).toEqual(result.suggestionIds);
        expect(replay.proposalId).toBe(result.proposalId);

        await updateDocument.run({ id, content: "A newer body." }, ctx);
        const staleReplay = (await suggestDocumentEdit.run(
          args,
          ctx,
        )) as typeof result;
        expect(staleReplay.suggestionIds).toEqual(result.suggestionIds);
        await expect(
          suggestDocumentEdit.run(
            { ...args, baseRevision: "a-different-base-revision" },
            ctx,
          ),
        ).rejects.toThrow(/already created a different suggested edit/);
      },
    );
  });

  it("creates no suggestion for a no-op replacement", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("No change here.");
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `noop-${id}`,
              find: "No change here.",
              replace: "No change here.",
            },
            ctx,
          ),
        ).rejects.toThrow(/does not change the page/);
        const listed = (await listResourceSuggestions.run(
          { resourceType: "document", resourceId: id },
          ctx,
        )) as { suggestions: unknown[] };
        expect(listed.suggestions).toEqual([]);
      },
    );
  });

  it("appends another agent edit to an explicit proposal", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const before =
          "We shipped quickly, and the results were good.\nA second note is ready.";
        const { id, revision } = await createPage(before);
        const summary = "Review the release notes";
        const first = (await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `append-first-${id}`,
            find: "We shipped quickly, and the results were good.",
            replace: "We shipped quickly and the results were excellent.",
            summary,
          },
          ctx,
        )) as { proposalId: string; suggestionIds: string[] };
        const second = (await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `append-second-${id}`,
            proposalId: first.proposalId,
            find: "A second note is ready.",
            replace: "A second note is approved.",
            summary,
          },
          ctx,
        )) as { proposalId: string; suggestionIds: string[] };
        expect(second.proposalId).toBe(first.proposalId);
        expect(second.suggestionIds).toHaveLength(1);
        expect(second.suggestionIds[0]).not.toBe(first.suggestionIds[0]);
      },
    );
  });

  it("creates a pending suggestion and leaves the page unchanged", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Hello suggestion probe.");
        const result = (await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `se-${id}-1`,
            find: "Hello suggestion probe.",
            replace: "Hello, suggestion probe.",
          },
          ctx,
        )) as { suggestionId: string; status: string; url: string };

        expect(result.status).toBe("pending");
        expect(result.url).toContain(id);

        const after = (await getDocument.run({ id }, ctx)) as {
          content: string;
          revision: string;
        };
        expect(after.content).toBe("Hello suggestion probe.");
        expect(after.revision).toBe(revision);

        const listed = (await listResourceSuggestions.run(
          { resourceType: "document", resourceId: id },
          ctx,
        )) as {
          suggestions: Array<{
            id: string;
            status: string;
            operations: Array<{
              before?: unknown;
              after?: unknown;
              anchor?: unknown;
            }>;
          }>;
        };
        expect(listed.suggestions.map((s) => s.id)).toContain(
          result.suggestionId,
        );
        const persisted = listed.suggestions.find(
          (suggestion) => suggestion.id === result.suggestionId,
        )!;
        const operation = persisted.operations[0]!;
        const before = operation.before as {
          markdown: string;
          changedText: string;
        };
        const afterPayload = operation.after as {
          markdown: string;
          changedText: string;
        };
        const anchor = operation.anchor as { from: number; to: number };
        expect(
          suggestionTextPresentationForSource(before.changedText, {
            source: before.markdown,
            from: anchor.from,
            to: anchor.to,
          }),
        ).not.toBeNull();
        expect(
          suggestionTextPresentationForSource(afterPayload.changedText, {
            source: afterPayload.markdown,
            from: anchor.from,
            to: anchor.from + afterPayload.changedText.length,
          }),
        ).not.toBeNull();
      },
    );
  });

  it("round-trips an action suggestion through canonical preview coordinates", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const content =
          "# Review notes\n\nEditors publish carefully.\n\n- Verify preview\n- Verify highlight";
        const find = "Editors publish carefully.";
        const replace = "Editors publish deliberately.";
        const { id, revision } = await createPage(content);
        const created = (await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `presentation-${id}`,
            find,
            replace,
          },
          ctx,
        )) as { suggestionId: string };
        const listed = (await listResourceSuggestions.run(
          { resourceType: "document", resourceId: id },
          ctx,
        )) as {
          suggestions: Array<{
            id: string;
            operations: Array<{
              before: { markdown: string; changedText: string };
              after: { markdown: string; changedText: string };
              anchor: { from: number; to: number };
            }>;
          }>;
        };
        const operation = listed.suggestions.find(
          (suggestion) => suggestion.id === created.suggestionId,
        )!.operations[0]!;
        const canonical = canonicalizeNfm(content);
        const range = resolveMarkdownSuggestionRange(canonical, operation);

        expect(range).toEqual({
          from: canonical.indexOf("carefully"),
          to: canonical.indexOf("carefully") + "carefully".length,
        });
        expect(
          suggestionTextPresentationForSource(operation.before.changedText, {
            source: operation.before.markdown,
            from: operation.anchor.from,
            to: operation.anchor.to,
          }),
        ).not.toBeNull();
        expect(
          suggestionTextPresentationForSource(operation.after.changedText, {
            source: operation.after.markdown,
            from: operation.anchor.from,
            to: operation.anchor.from + operation.after.changedText.length,
          }),
        ).not.toBeNull();
      },
    );
  });

  it("replays the same idempotency key instead of duplicating", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Repeatable body text.");
        const args = {
          id,
          baseRevision: revision,
          idempotencyKey: `replay-${id}`,
          find: "Repeatable body text.",
          replace: "Replaced body text.",
        };
        const first = (await suggestDocumentEdit.run(args, ctx)) as {
          suggestionId: string;
        };
        const second = (await suggestDocumentEdit.run(args, ctx)) as {
          suggestionId: string;
        };
        expect(second.suggestionId).toBe(first.suggestionId);
      },
    );
  });

  it("replays the same logical edit after the document changed", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Original body line.");
        const args = {
          id,
          baseRevision: revision,
          idempotencyKey: `moved-${id}`,
          find: "Original body line.",
          replace: "Edited body line.",
        };
        const first = (await suggestDocumentEdit.run(args, ctx)) as {
          suggestionId: string;
        };
        await updateDocument.run(
          { id, content: "The page changed underneath the proposal." },
          ctx,
        );
        const retry = (await suggestDocumentEdit.run(args, ctx)) as {
          suggestionId: string;
        };
        expect(retry.suggestionId).toBe(first.suggestionId);
        await expect(
          suggestDocumentEdit.run(
            { ...args, baseRevision: "a-different-base-revision" },
            ctx,
          ),
        ).rejects.toThrow(/already created a different suggested edit/);
      },
    );
  });

  it("rejects key reuse for a different edit", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Two possible edits here.");
        await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `reuse-${id}`,
            find: "Two possible edits",
            replace: "One settled edit",
          },
          ctx,
        );
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `reuse-${id}`,
              find: "possible edits here",
              replace: "different edit there",
            },
            ctx,
          ),
        ).rejects.toThrow(/already created a different suggested edit/);
      },
    );
  });

  it("rejects key reuse across documents", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const first = await createPage("Identical body text.");
        const second = await createPage("Identical body text.");
        await suggestDocumentEdit.run(
          {
            id: first.id,
            baseRevision: first.revision,
            idempotencyKey: `cross-doc-${first.id}`,
            find: "Identical body text.",
            replace: "Edited body text.",
          },
          ctx,
        );
        await expect(
          suggestDocumentEdit.run(
            {
              id: second.id,
              baseRevision: second.revision,
              idempotencyKey: `cross-doc-${first.id}`,
              find: "Identical body text.",
              replace: "Edited body text.",
            },
            ctx,
          ),
        ).rejects.toThrow(/already created a different suggested edit/);
      },
    );
  });

  it("replays a legacy human receipt for an external agent retry", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Shared inbox body.");
        const args = {
          id,
          baseRevision: revision,
          idempotencyKey: `caller-kind-${id}`,
          find: "Shared inbox body.",
          replace: "Edited body.",
        };
        const createResourceSuggestion = (
          await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion")
        ).default;
        const { buildMarkdownSuggestionOperation } =
          await import("./suggest-document-edit.js");
        const first = (await createResourceSuggestion.run(
          {
            resourceType: "document",
            resourceId: id,
            adapterKind: "content.document-markdown",
            baseRevision: revision,
            summary: `Replace "${args.find}" with "${args.replace}"`,
            idempotencyKey: args.idempotencyKey,
            operations: [
              buildMarkdownSuggestionOperation({
                content: "Shared inbox body.",
                find: args.find,
                replace: args.replace,
                start: 0,
              }),
            ],
          },
          ctx,
        )) as { id: string };
        await (await import("@agent-native/core/db")).getDbExec().execute({
          sql: "UPDATE agent_review_suggestion_creations SET receipt_version = 1 WHERE idempotency_key = ?",
          args: [args.idempotencyKey],
        });
        const retry = (await suggestDocumentEdit.run(args, {
          caller: "mcp" as const,
          userEmail: ctx.userEmail,
        })) as { suggestionId: string };
        expect(retry.suggestionId).toBe(first.id);
      },
    );
  });

  it("suggests an owner-org document shared to another organization", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id } = await createPage("Shared across orgs body.");
        const db = getDb();
        await db
          .update(schema.documents)
          .set({ orgId: "org-owner" })
          .where(eq(schema.documents.id, id));
        await db.insert(schema.documentShares).values({
          id: `cross-org-share-${id}`,
          resourceId: id,
          principalType: "org",
          principalId: "org-shared",
          role: "commenter",
          createdBy: ctx.userEmail,
        });

        const result = await runWithRequestContext(
          { userEmail: "member@other-org", orgId: "org-shared" },
          async () => {
            const input = {
              id,
              find: "Shared across orgs body.",
              replace: "Edited body.",
              idempotencyKey: `cross-org-${id}`,
            };
            const first = (await suggestDocumentEdit.run(input, {
              caller: "cli" as const,
              userEmail: "member@other-org",
            })) as {
              suggestionId: string;
              suggestionIds: string[];
              proposalId: string;
            };
            const retry = (await suggestDocumentEdit.run(input, {
              caller: "cli" as const,
              userEmail: "member@other-org",
            })) as { suggestionId: string; proposalId: string };
            expect(retry).toMatchObject({
              suggestionId: first.suggestionId,
              proposalId: first.proposalId,
            });
            return first;
          },
        );

        // Read back what was actually stored, as the document's owner.
        const listed = (await listResourceSuggestions.run(
          { resourceType: "document", resourceId: id },
          ctx,
        )) as {
          suggestions: Array<{
            id: string;
            proposalId?: string;
            authorEmail: string | null;
            ownerEmail: string | null;
            orgId: string | null;
            status: string;
            operations: Array<{
              before: { changedText: string };
              after: { changedText: string };
            }>;
          }>;
        };
        // The retry replayed the receipt instead of storing a second copy.
        expect(listed.suggestions.map((item) => item.id).sort()).toEqual(
          [...result.suggestionIds].sort(),
        );
        const stored = result.suggestionIds.map(
          (suggestionId) =>
            listed.suggestions.find((item) => item.id === suggestionId)!,
        );
        // The suggestion is attributed to the other org's member but scoped to
        // the document's own owner and org, so the owner's side can review it.
        for (const item of stored) {
          expect(item).toMatchObject({
            proposalId: result.proposalId,
            authorEmail: "member@other-org",
            ownerEmail: ctx.userEmail,
            orgId: "org-owner",
            status: "pending",
          });
        }
        expect(
          stored.map((item) => [
            item.operations[0]!.before.changedText,
            item.operations[0]!.after.changedText,
          ]),
        ).toEqual([["Shared across orgs body", "Edited body"]]);
        // A suggestion proposes; it must not have rewritten the document.
        const unchanged = (await getDocument.run({ id }, ctx)) as {
          content: string;
        };
        expect(unchanged.content).toBe("Shared across orgs body.");
      },
    );
  });

  it("rejects a current human receipt replayed by an external agent", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Current human body.");
        const args = {
          id,
          baseRevision: revision,
          idempotencyKey: `current-human-${id}`,
          find: "Current human body.",
          replace: "Edited body.",
        };
        await suggestDocumentEdit.run(args, ctx);
        await expect(
          suggestDocumentEdit.run(args, {
            caller: "mcp" as const,
            userEmail: ctx.userEmail,
          }),
        ).rejects.toThrow(/belongs to another caller/);
      },
    );
  });

  it("rejects an agent receipt replayed by a human caller", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Agent receipt body.");
        const args = {
          id,
          baseRevision: revision,
          idempotencyKey: `agent-receipt-${id}`,
          find: "Agent receipt body.",
          replace: "Edited body.",
        };
        await suggestDocumentEdit.run(args, {
          caller: "mcp" as const,
          userEmail: ctx.userEmail,
        });
        await expect(suggestDocumentEdit.run(args, ctx)).rejects.toThrow(
          /belongs to another caller/,
        );
      },
    );
  });

  it("rejects receipt replay with a changed summary", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Summarized body line.");
        await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `summary-${id}`,
            find: "Summarized body line.",
            replace: "Edited body line.",
            summary: "Original summary",
          },
          ctx,
        );
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `summary-${id}`,
              find: "Summarized body line.",
              replace: "Edited body line.",
              summary: "Different summary",
            },
            ctx,
          ),
        ).rejects.toThrow(/already created a different suggested edit/);
      },
    );
  });

  it("records external agent attribution for mcp callers", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Attribution body text.");
        const result = (await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `attr-${id}`,
            find: "Attribution body text.",
            replace: "Edited body text.",
          },
          { caller: "mcp" as const, userEmail: ctx.userEmail },
        )) as { suggestionId: string };
        const listed = (await listResourceSuggestions.run(
          { resourceType: "document", resourceId: id },
          ctx,
        )) as { suggestions: Array<{ id: string; actorKind: string }> };
        const recorded = listed.suggestions.find(
          (item) => item.id === result.suggestionId,
        );
        expect(recorded?.actorKind).toBe("agent");
      },
    );
  });

  it("attaches the open-suggestion deep link", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Link contract body.");
        const action = (await import("./suggest-document-edit.js")).default;
        const result = (await action.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `link-${id}`,
            find: "Link contract body.",
            replace: "Edited body text.",
          },
          ctx,
        )) as { suggestionId: string };
        const link = (
          action as unknown as { link: (input: unknown) => unknown }
        ).link({
          args: { id },
          result,
        });
        expect(link).toEqual({
          url: `/page/${id}?suggestion=${result.suggestionId}`,
          label: "Open suggestion",
        });
      },
    );
  });

  it("reports a missing find with the fix in the message", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Unique body text.");
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `missing-${id}`,
              find: "Text that is not on the page.",
              replace: "x",
            },
            ctx,
          ),
        ).rejects.toThrow(/does not appear on the page/);
      },
    );
  });

  const TABLE_PAGE = [
    "Intro text.",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| alpha cell | beta |",
    "",
    "Closing text.",
  ].join("\n");
  const CALLOUT_PAGE = [
    '<callout icon="💡">',
    "\tCallout alpha text",
    "</callout>",
  ].join("\n");
  const TOGGLE_PAGE = [
    "<details>",
    "<summary>Title</summary>",
    "\tToggle alpha text",
    "</details>",
  ].join("\n");
  const COLUMNS_PAGE = [
    "<columns>",
    "\t<column>",
    "\t\tLeft alpha text",
    "\t</column>",
    "\t<column>",
    "\t\tRight text",
    "\t</column>",
    "</columns>",
  ].join("\n");

  it.each([
    ["a table cell", TABLE_PAGE, "alpha cell", "omega cell"],
    ["a callout", CALLOUT_PAGE, "alpha", "omega"],
    ["a toggle", TOGGLE_PAGE, "alpha", "omega"],
    ["a column", COLUMNS_PAGE, "alpha", "omega"],
    [
      "a callout's paragraphs",
      CALLOUT_PAGE,
      "Callout alpha text",
      "Callout alpha text\n\tAdded paragraph.",
    ],
    [
      "a toggle's paragraphs",
      TOGGLE_PAGE,
      "Toggle alpha text",
      "Toggle alpha text\n\tAdded paragraph.",
    ],
    [
      "a column's paragraphs",
      COLUMNS_PAGE,
      "Left alpha text",
      "Left alpha text\n\t\tAdded paragraph.",
    ],
  ])(
    "suggests and accepts an edit inside %s",
    async (_block, content, find, replace) => {
      await runWithRequestContext(
        { userEmail: ctx.userEmail, orgId: null },
        async () => {
          const { id, revision } = await createPage(content);
          const before = (await getDocument.run({ id }, ctx)) as {
            content: string;
          };
          const result = (await suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `frame-text-${id}`,
              find,
              replace,
            },
            { caller: "mcp" as const, userEmail: ctx.userEmail },
          )) as { suggestionId: string; status: string };
          expect(result.status).toBe("pending");
          const suggestion = await getResourceSuggestion.run(
            { id: result.suggestionId },
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
          const after = (await getDocument.run({ id }, ctx)) as {
            content: string;
          };
          expect(after.content).toBe(before.content.replace(find, replace));
        },
      );
    },
  );

  it.each([
    ["a table cell", "alpha cell", "omega cell"],
    ["a callout", "Callout alpha text", "Callout omega text"],
  ])(
    "accepts an edit inside %s after someone opens a toggle on the page",
    async (_block, find, replace) => {
      await runWithRequestContext(
        { userEmail: ctx.userEmail, orgId: null },
        async () => {
          const content = [TABLE_PAGE, CALLOUT_PAGE, TOGGLE_PAGE].join("\n\n");
          const { id, revision } = await createPage(content);
          const result = (await suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `frame-reopened-${id}`,
              find,
              replace,
            },
            { caller: "mcp" as const, userEmail: ctx.userEmail },
          )) as { suggestionId: string };
          const opened = canonicalizeNfm(content).replace(
            "<details>",
            "<details open>",
          );
          await updateDocument.run({ id, content: opened }, ctx);
          const before = (await getDocument.run({ id }, ctx)) as {
            content: string;
          };
          expect(before.content).toBe(opened);
          const suggestion = await getResourceSuggestion.run(
            { id: result.suggestionId },
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
          const after = (await getDocument.run({ id }, ctx)) as {
            content: string;
          };
          expect(after.content).toBe(opened.replace(find, replace));
        },
      );
    },
  );

  it.each([
    ["an agent wrote", (page: string) => page],
    ["saved in canonical form", canonicalizeNfm],
  ])(
    "accepts a cell edit in its own row after someone edits that row on a page %s",
    async (_form, form) => {
      await runWithRequestContext(
        { userEmail: ctx.userEmail, orgId: null },
        async () => {
          const row = (service: string) =>
            `| Owned by Alice in the platform group | TBD | Waiting on the platform team to confirm | ${service} |`;
          const content = form(
            [
              "| Owner | Status | Notes | Service |",
              "| --- | --- | --- | --- |",
              row("billing"),
              row("search"),
            ].join("\n"),
          );
          const { id, revision } = await createPage(content);
          const createResourceSuggestion = (
            await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion")
          ).default;
          const { buildMarkdownSuggestionOperation } =
            await import("./suggest-document-edit.js");
          // The editor anchors a suggestion on the changed word alone.
          const created = (await createResourceSuggestion.run(
            {
              resourceType: "document",
              resourceId: id,
              adapterKind: "content.document-markdown",
              baseRevision: revision,
              summary: "Mark billing done",
              idempotencyKey: `row-edit-${id}`,
              operations: [
                buildMarkdownSuggestionOperation({
                  content,
                  find: "TBD",
                  replace: "Done",
                  start: content.indexOf("TBD"),
                }),
              ],
            },
            ctx,
          )) as { id: string };
          const edited = canonicalizeNfm(content).replace("Waiting", "Blocked");
          await updateDocument.run({ id, content: edited }, ctx);
          const suggestion = await getResourceSuggestion.run(
            { id: created.id },
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
          const after = (await getDocument.run({ id }, ctx)) as {
            content: string;
          };
          expect(after.content).toBe(edited.replace("TBD", "Done"));
        },
      );
    },
  );

  it.each([
    [
      "adds a table row",
      TABLE_PAGE,
      "| alpha cell | beta |",
      "| alpha cell | beta |\n| new | row |",
    ],
    [
      "adds a column",
      COLUMNS_PAGE,
      "\t\tRight text\n\t</column>",
      "\t\tRight text\n\t</column>\n\t<column>\n\t\tMore\n\t</column>",
    ],
    ["changes a callout icon", CALLOUT_PAGE, 'icon="💡"', 'icon="🔥"'],
    [
      "changes a toggle title",
      TOGGLE_PAGE,
      "<summary>Title</summary>",
      "<summary>New title</summary>",
    ],
  ])(
    "refuses a suggestion that %s with a typed error",
    async (_change, content, find, replace) => {
      await runWithRequestContext(
        { userEmail: ctx.userEmail, orgId: null },
        async () => {
          const { id, revision } = await createPage(content);
          await expect(
            suggestDocumentEdit.run(
              {
                id,
                baseRevision: revision,
                idempotencyKey: `frame-shape-${id}`,
                find,
                replace,
              },
              { caller: "mcp" as const, userEmail: ctx.userEmail },
            ),
          ).rejects.toMatchObject({
            statusCode: 422,
            errorCode: "suggestion_structure_unsupported",
          });
        },
      );
    },
  );

  // suggest-document-edit splits these into one suggestion per cell or
  // column; a hand-built proposal can still send them as one operation.
  it.each([
    [
      "changes text in two table cells",
      TABLE_PAGE,
      "alpha cell | beta",
      "omega cell | gamma",
    ],
    [
      "moves text across a table cell edge",
      TABLE_PAGE,
      "alpha cell | beta",
      "alpha | cell beta",
    ],
    [
      "bolds text in two table cells",
      TABLE_PAGE,
      "alpha cell | beta",
      "**alpha cell** | **beta**",
    ],
    [
      "moves a paragraph's text into a callout",
      `${CALLOUT_PAGE}\n\nAfter the callout`,
      "alpha text\n</callout>\n\nAfter the callout",
      "alpha text After\n</callout>\n\nthe callout",
    ],
  ])(
    "refuses one operation that %s",
    async (change, content, find, replace) => {
      await runWithRequestContext(
        { userEmail: ctx.userEmail, orgId: null },
        async () => {
          const { id, revision } = await createPage(content);
          const createResourceSuggestion = (
            await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion")
          ).default;
          const { buildMarkdownSuggestionOperation } =
            await import("./suggest-document-edit.js");
          await expect(
            createResourceSuggestion.run(
              {
                resourceType: "document",
                resourceId: id,
                adapterKind: "content.document-markdown",
                baseRevision: revision,
                summary: change,
                idempotencyKey: `cross-edge-${id}`,
                operations: [
                  buildMarkdownSuggestionOperation({
                    content,
                    find,
                    replace,
                    start: content.indexOf(find),
                  }),
                ],
              },
              ctx,
            ),
          ).rejects.toMatchObject({
            statusCode: 422,
            errorCode: "suggestion_structure_unsupported",
          });
        },
      );
    },
  );

  it("rejects an ambiguous find", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id } = await createPage(
          "Same text.\n\nSame text.\n\nSame text.",
        );
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: "body:0:x",
              idempotencyKey: `ambiguous-${id}`,
              find: "Same text.",
              replace: "y",
            },
            ctx,
          ),
        ).rejects.toThrow(/appears 3 times/);
      },
    );
  });

  it("requires baseRevision and idempotencyKey from external callers", async () => {
    const { id } = await createPage("Protocol body.");
    await expect(
      suggestDocumentEdit.run(
        { id, find: "Protocol body.", replace: "x" },
        { caller: "mcp" as const, userEmail: ctx.userEmail },
      ),
    ).rejects.toThrow(/baseRevision and idempotencyKey/);
  });

  it("proposes an edit to an ordinary database item without changing its body", async () => {
    const { id, revision } = await createPage("Database item body.");
    const db = getDb();
    const now = new Date().toISOString();
    const databaseId = `suggest-edit-db-${sequence}`;
    await db.insert(schema.documents).values({
      id: `suggest-edit-db-doc-${sequence}`,
      title: "Test database",
      content: "",
      ownerEmail: ctx.userEmail,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabases).values({
      id: databaseId,
      ownerEmail: ctx.userEmail,
      documentId: `suggest-edit-db-doc-${sequence}`,
      title: "Test database",
      createdAt: now,
      updatedAt: now,
    });
    const primaryId = `suggest-edit-primary-${sequence}`;
    await db.insert(schema.documentPropertyDefinitions).values({
      id: primaryId,
      ownerEmail: ctx.userEmail,
      databaseId,
      name: "Content",
      type: "blocks",
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.contentDatabases)
      .set({ primaryBlocksPropertyId: primaryId, blocksSeeded: 1 })
      .where(eq(schema.contentDatabases.id, databaseId));
    await db.insert(schema.contentDatabaseItems).values({
      id: `suggest-edit-item-${sequence}`,
      ownerEmail: ctx.userEmail,
      databaseId,
      documentId: id,
      createdAt: now,
      updatedAt: now,
    });
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const result = (await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `db-${id}`,
            find: "Database item body.",
            replace: "x",
          },
          ctx,
        )) as { suggestionId: string };
        expect(result.suggestionId).toBeTruthy();
        const [document] = await db
          .select({ content: schema.documents.content })
          .from(schema.documents)
          .where(eq(schema.documents.id, id));
        expect(document?.content).toBe("Database item body.");
      },
    );
    const collaborator = "collaborator@example.com";
    await db.insert(schema.documentShares).values({
      id: `suggest-edit-row-share-${sequence}`,
      resourceId: id,
      principalType: "user",
      principalId: collaborator,
      role: "commenter",
      createdBy: ctx.userEmail,
      createdAt: now,
    });
    const collaboratorContext = { ...ctx, userEmail: collaborator };
    await runWithRequestContext(
      { userEmail: collaborator, orgId: null },
      async () => {
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `row-only-${id}`,
              find: "Database item body.",
              replace: "x",
            },
            collaboratorContext,
          ),
        ).rejects.toThrow(/no primary Blocks field/);
      },
    );
    await db.insert(schema.documentShares).values({
      id: `suggest-edit-db-share-${sequence}`,
      resourceId: `suggest-edit-db-doc-${sequence}`,
      principalType: "user",
      principalId: collaborator,
      role: "viewer",
      createdBy: ctx.userEmail,
      createdAt: now,
    });
    await runWithRequestContext(
      { userEmail: collaborator, orgId: null },
      async () => {
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `row-and-db-${id}`,
              find: "Database item body.",
              replace: "x",
            },
            collaboratorContext,
          ),
        ).resolves.toMatchObject({ status: "pending" });
      },
    );
  });
});
