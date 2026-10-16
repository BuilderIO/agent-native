import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { canonicalizeNfm } from "../../shared/nfm.js";
import {
  applyMarkdownSuggestionOperation,
  applyMarkdownSuggestionWithSiblings,
  operationAnchor,
} from "../../shared/suggestion-apply.js";
import { markdownSuggestionOperationsForFindReplace } from "../../shared/suggestion-diff.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-suggestion-canonical-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let adapterKind: string;
let getDocumentAction: typeof import("../../actions/get-document.js").default;
let createSuggestion: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion").default;
let createProposal: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal").default;
const previousSyncEventsEnabled =
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;

const ownerEmail = "canonical-owner@example.com";
const ctx = { caller: "cli" as const, userEmail: ownerEmail };
let sequence = 0;

// An agent writes `$60`; a page written through its live copy stores `\$60`.
const agentBody = "It costs $60 today and $70 tomorrow.";
const storedBody = canonicalizeNfm(agentBody);

function rules(emails: string[]) {
  return {
    version: 1,
    mode: "rules",
    emails,
    orgIds: [],
    percentage: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

async function setLiveBodyFlags(on: boolean) {
  for (const flag of ["content.live-body-shadow", "content.live-body-writer"])
    await putSetting(`feature-flag:${flag}`, rules(on ? [ownerEmail] : []));
}

beforeAll(async () => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  adapterKind = (await import("./suggested-edits.js"))
    .CONTENT_DOCUMENT_SUGGESTION_ADAPTER;
  getDocumentAction = (await import("../../actions/get-document.js")).default;
  createSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion")
  ).default;
  createProposal = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal")
  ).default;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  await (await import("../plugins/suggested-edits.js")).default();
  const { registerFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  const { CONTENT_FEATURE_FLAGS } =
    await import("../../shared/feature-flags.js");
  registerFeatureFlags(CONTENT_FEATURE_FLAGS);
}, 60_000);

beforeEach(async () => {
  await setLiveBodyFlags(true);
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
  if (previousSyncEventsEnabled === undefined)
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  else
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS =
      previousSyncEventsEnabled;
});

async function seedPage(page: { switched: boolean }) {
  sequence += 1;
  const id = `canonical-page-${sequence}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      title: "Agent page",
      content: storedBody,
      ownerEmail,
      bodyRevision: 4,
      collabBodyRevision: 4,
      liveBodySwitchedAt: page.switched ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

function agentOperations(before: string, find: string, replace: string) {
  return markdownSuggestionOperationsForFindReplace({
    before,
    find,
    replace,
    start: before.indexOf(find),
  });
}

async function suggestOnAgentText(
  documentId: string,
  find: string,
  replace: string,
) {
  const document = await getDocumentAction.run({ id: documentId }, ctx);
  sequence += 1;
  const [operation] = agentOperations(agentBody, find, replace);
  return createSuggestion.run(
    {
      resourceType: "document",
      resourceId: documentId,
      adapterKind,
      baseRevision: document.revision,
      summary: "Agent edit",
      idempotencyKey: `canonical-suggestion-${sequence}`,
      operations: [operation!],
    },
    ctx,
  );
}

function ownerIt(name: string, run: () => Promise<void>) {
  it(name, () => runWithRequestContext({ userEmail: ownerEmail }, run));
}

describe("suggestion matching on a page written through its live copy", () => {
  ownerIt(
    "saves a suggestion written against the agent's form onto the stored text",
    async () => {
      const documentId = await seedPage({ switched: true });
      const suggestion = await suggestOnAgentText(documentId, "today", "now");

      const [operation] = suggestion.operations;
      expect(operation!.before).toMatchObject({ markdown: storedBody });
      expect(applyMarkdownSuggestionOperation(storedBody, operation!)).toBe(
        canonicalizeNfm(agentBody.replace("today", "now")),
      );
    },
  );

  ownerIt("keeps the exact comparison while the flags are off", async () => {
    await setLiveBodyFlags(false);
    const documentId = await seedPage({ switched: true });
    await expect(
      suggestOnAgentText(documentId, "today", "now"),
    ).rejects.toMatchObject({ errorCode: "suggestion_conflict" });
  });

  ownerIt(
    "keeps the exact comparison on a page that isn't switched",
    async () => {
      const documentId = await seedPage({ switched: false });
      await expect(
        suggestOnAgentText(documentId, "today", "now"),
      ).rejects.toMatchObject({ errorCode: "suggestion_conflict" });
    },
  );

  ownerIt("refuses a before-state that is a different body", async () => {
    const documentId = await seedPage({ switched: true });
    const document = await getDocumentAction.run({ id: documentId }, ctx);
    const other = "It costs $65 today and $70 tomorrow.";
    const [operation] = agentOperations(other, "today", "now");
    await expect(
      createSuggestion.run(
        {
          resourceType: "document",
          resourceId: documentId,
          adapterKind,
          baseRevision: document.revision,
          summary: "Agent edit",
          idempotencyKey: `canonical-other-${documentId}`,
          operations: [operation!],
        },
        ctx,
      ),
    ).rejects.toMatchObject({ errorCode: "suggestion_conflict" });
  });

  ownerIt(
    "refuses a suggestion whose change disappears in the stored form",
    async () => {
      const documentId = await seedPage({ switched: true });
      await expect(
        suggestOnAgentText(documentId, "$60", String.raw`\$60`),
      ).rejects.toMatchObject({ errorCode: "suggestion_no_change" });
    },
  );

  ownerIt(
    "keeps proposal members listing each other on the stored text",
    async () => {
      const documentId = await seedPage({ switched: true });
      const document = await getDocumentAction.run({ id: documentId }, ctx);
      const operations = agentOperations(
        agentBody,
        "$60 today and $70",
        "$75 now and $80",
      );
      expect(operations.length).toBeGreaterThan(1);
      const created = await createProposal.run(
        {
          resourceType: "document",
          resourceId: documentId,
          adapterKind,
          baseRevision: document.revision,
          summary: "Agent edits",
          idempotencyKey: `canonical-proposal-${documentId}`,
          suggestions: operations.map((operation, index) => ({
            summary: `Edit ${index + 1}`,
            operations: [operation],
          })),
        },
        ctx,
      );

      const stored = created.suggestions.map(
        (suggestion) => suggestion.operations[0]!,
      );
      const ranges = stored.map((operation) => {
        const { from, to } = operationAnchor(operation);
        return { from, to };
      });
      for (const [index, operation] of stored.entries()) {
        expect(operation.before).toMatchObject({ markdown: storedBody });
        expect(operationAnchor(operation).siblingRanges).toEqual(
          ranges.filter((_, other) => other !== index),
        );
      }
      // Accepting each member in turn, as accept does, reaches the agent's
      // result in the stored form.
      let content = storedBody;
      const accepted: { from: number; to: number }[] = [];
      for (const [index, operation] of stored.entries()) {
        const next = applyMarkdownSuggestionWithSiblings(
          content,
          operation,
          accepted,
        );
        expect(next).not.toBeNull();
        content = next!;
        accepted.push(ranges[index]!);
      }
      expect(content).toBe(
        canonicalizeNfm(
          agentBody.replace("$60 today and $70", "$75 now and $80"),
        ),
      );
    },
  );
});
