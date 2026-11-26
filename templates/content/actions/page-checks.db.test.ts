import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// No decision model is ready here; yes/no parts have their own tests.
vi.mock("@agent-native/core/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/decisions")>()),
  getDecisionsStatus: async () => ({
    providerOrder: ["jev", "openai"],
    providers: [],
  }),
}));

const directory = mkdtempSync(join(tmpdir(), "content-page-checks-"));
const owner = "checks-owner@example.com";
const editor = "checks-editor@example.com";
const commenter = "checks-commenter@example.com";
const viewer = "checks-viewer@example.com";
const stranger = "checks-stranger@example.com";
let dbModule: typeof import("../server/db/index.js");
let actions: {
  list: typeof import("./list-page-checks.js").default;
  add: typeof import("./add-page-check.js").default;
  update: typeof import("./update-page-check.js").default;
  remove: typeof import("./delete-page-check.js").default;
  tryCheck: typeof import("./try-page-check.js").default;
  run: typeof import("./run-page-checks.js").default;
  skip: typeof import("./skip-page-check.js").default;
};

const words = (count: number, word = "word") =>
  Array.from({ length: count }, () => word).join(" ");

const DRAFT = [
  `${words(182)} end.`,
  "",
  "## The review queue",
  "",
  "Queue one. Queue two.",
  "",
  "## Next",
  "",
  "Next para.",
].join("\n");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "db")}`);
  dbModule = await import("../server/db/index.js");
  const { runContentMigrations } = await import("../server/plugins/db.js");
  await runContentMigrations();
  actions = {
    list: (await import("./list-page-checks.js")).default,
    add: (await import("./add-page-check.js")).default,
    update: (await import("./update-page-check.js")).default,
    remove: (await import("./delete-page-check.js")).default,
    tryCheck: (await import("./try-page-check.js")).default,
    run: (await import("./run-page-checks.js")).default,
    skip: (await import("./skip-page-check.js")).default,
  };
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const as = <T>(userEmail: string, fn: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, fn);
const ctxFor = (userEmail: string) => ({
  caller: "frontend" as const,
  userEmail,
});

let pages = 0;
async function newPage(content = DRAFT) {
  const documentId = `checks-page-${++pages}`;
  const db = dbModule.getDb();
  await db.insert(dbModule.schema.documents).values({
    id: documentId,
    ownerEmail: owner,
    title: "Checks test",
    content,
  });
  for (const [principalId, role] of [
    [editor, "editor"],
    [commenter, "commenter"],
    [viewer, "viewer"],
  ] as const) {
    await db.insert(dbModule.schema.documentShares).values({
      id: crypto.randomUUID(),
      resourceId: documentId,
      principalType: "user",
      principalId,
      role,
      createdBy: owner,
      createdAt: new Date().toISOString(),
    });
  }
  return documentId;
}

async function setBody(documentId: string, content: string) {
  await dbModule
    .getDb()
    .update(dbModule.schema.documents)
    .set({ content })
    .where(eq(dbModule.schema.documents.id, documentId));
}

async function body(documentId: string) {
  const [row] = await dbModule
    .getDb()
    .select({
      content: dbModule.schema.documents.content,
      updatedAt: dbModule.schema.documents.updatedAt,
    })
    .from(dbModule.schema.documents)
    .where(eq(dbModule.schema.documents.id, documentId));
  return row;
}

function addIntroCheck(documentId: string, userEmail = editor) {
  return as(userEmail, () =>
    actions.add.run(
      { documentId, sentence: "Under 120 words", scope: { kind: "intro" } },
      ctxFor(userEmail),
    ),
  );
}

function list(documentId: string, userEmail = commenter) {
  return as(userEmail, () =>
    actions.list.run({ documentId }, ctxFor(userEmail)),
  );
}

function run(documentId: string, userEmail = editor) {
  return as(userEmail, () =>
    actions.run.run({ documentId }, ctxFor(userEmail)),
  );
}

async function resultRows(checkId: string) {
  return dbModule
    .getDb()
    .select()
    .from(dbModule.schema.contentPageCheckResults)
    .where(eq(dbModule.schema.contentPageCheckResults.checkId, checkId));
}

describe("adding and reading checks", () => {
  it("marks an intro over its count and never touches the page", async () => {
    const documentId = await newPage();
    const before = await body(documentId);

    const added = await addIntroCheck(documentId);

    const [check] = added.checks;
    expect(check).toMatchObject({
      sentence: "Under 120 words",
      scope: { kind: "intro" },
      parts: [{ kind: "count", unit: "words", min: null, max: 120 }],
    });
    expect(check.answers).toMatchObject([
      {
        key: "intro",
        answer: "not_fine",
        result: { parts: [{ finding: "not_fine", count: 183 }] },
      },
    ]);
    expect(await body(documentId)).toEqual(before);
  });

  it("shows what a sentence reads as before it's saved, and saves nothing", async () => {
    const documentId = await newPage();
    const tried = await as(editor, () =>
      actions.tryCheck.run(
        {
          documentId,
          sentence: "Under 120 words. Opens with something that happened.",
          scope: { kind: "intro" },
        },
        ctxFor(editor),
      ),
    );
    expect(tried.reading.parts.map((part) => part.kind)).toEqual([
      "count",
      "unread",
    ]);
    expect(tried).toMatchObject({
      parts: null,
      answers: null,
      problem: { kind: "no_model" },
      decider: null,
    });

    const counted = await as(editor, () =>
      actions.tryCheck.run(
        {
          documentId,
          sentence: "At most 2 sentences",
          scope: { kind: "page" },
        },
        ctxFor(editor),
      ),
    );
    expect(counted.answers?.[0]).toMatchObject({
      answer: "not_fine",
      result: { parts: [{ count: 4 }] },
    });
    expect((await list(documentId)).checks).toEqual([]);
  });

  it("refuses a sentence it can't read, a yes/no part with no model, and more than 20 checks", async () => {
    const documentId = await newPage();
    const add = (sentence: string) =>
      as(editor, () =>
        actions.add.run(
          { documentId, sentence, scope: { kind: "page" } },
          ctxFor(editor),
        ),
      );
    await expect(
      add(
        "Under 120 words. Opens with a question. Ends with a link. Names a person.",
      ),
    ).rejects.toMatchObject({ errorCode: "PAGE_CHECK_UNREADABLE" });
    await expect(add("Opens with a question")).rejects.toMatchObject({
      errorCode: "PAGE_CHECK_NO_MODEL",
    });

    for (let index = 0; index < 20; index++) {
      await addIntroCheck(documentId);
    }
    await expect(addIntroCheck(documentId)).rejects.toMatchObject({
      errorCode: "PAGE_CHECK_LIMIT",
    });
  });

  it("finds a section by its heading, and says when it's gone", async () => {
    const documentId = await newPage();
    const added = await as(editor, () =>
      actions.add.run(
        {
          documentId,
          sentence: "At most 1 sentence",
          scope: { kind: "section", heading: "The review queue", level: 2 },
        },
        ctxFor(editor),
      ),
    );
    expect(added.checks[0]?.answers[0]).toMatchObject({
      answer: "not_fine",
      result: { parts: [{ count: 2 }] },
    });

    await setBody(documentId, DRAFT.replace("## The review queue", "## Gone"));
    expect((await run(documentId)).checks[0]?.answers).toEqual([
      {
        key: "section",
        place: null,
        answer: "couldnt",
        result: null,
        reason: "section_deleted",
      },
    ]);

    await expect(
      as(editor, () =>
        actions.add.run(
          {
            documentId,
            sentence: "At most 1 sentence",
            scope: { kind: "section", heading: "Nowhere", level: 2 },
          },
          ctxFor(editor),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "PAGE_CHECK_SECTION_NOT_FOUND" });
  });
});

describe("running checks", () => {
  it("shows a changed place until a run checks it again, storing one answer per place", async () => {
    const documentId = await newPage();
    const { checkId } = await addIntroCheck(documentId);

    await setBody(
      documentId,
      DRAFT.replace(`${words(182)} end.`, `${words(117)} end.`),
    );
    expect((await list(documentId)).checks[0]?.answers[0]?.answer).toBe(
      "changed",
    );

    const [first, second] = await Promise.all([
      run(documentId),
      run(documentId, owner),
    ]);
    for (const ran of [first, second]) {
      expect(ran.checks[0]?.answers[0]).toMatchObject({
        answer: "fine",
        result: { parts: [{ count: 118 }] },
      });
    }
    expect(await resultRows(checkId)).toHaveLength(1);
  });

  it("checks each paragraph and forgets paragraphs that are gone", async () => {
    const documentId = await newPage("One two three.\n\nFour five.");
    const added = await as(editor, () =>
      actions.add.run(
        {
          documentId,
          sentence: "At most 2 words",
          scope: { kind: "each_paragraph" },
        },
        ctxFor(editor),
      ),
    );
    expect(added.checks[0]?.answers.map((answer) => answer.answer)).toEqual([
      "not_fine",
      "fine",
    ]);

    await setBody(documentId, "Four five.");
    await run(documentId);
    expect(await resultRows(added.checkId)).toHaveLength(1);
  });

  it("keeps a paused check's answers and doesn't run it", async () => {
    const documentId = await newPage();
    const { checkId } = await addIntroCheck(documentId);
    await as(editor, () =>
      actions.update.run({ documentId, checkId, paused: true }, ctxFor(editor)),
    );
    await setBody(documentId, "Short.");
    const ran = await run(documentId);
    expect(ran.checks[0]).toMatchObject({ paused: true });
    expect(ran.checks[0]?.answers[0]?.answer).toBe("changed");
  });

  it("checks a changed sentence again", async () => {
    const documentId = await newPage();
    const { checkId } = await addIntroCheck(documentId);
    const updated = await as(editor, () =>
      actions.update.run(
        { documentId, checkId, sentence: "Under 200 words" },
        ctxFor(editor),
      ),
    );
    expect(updated.checks[0]?.answers[0]?.answer).toBe("fine");
  });
});

describe("skipping a place", () => {
  it("lasts until the text changes, and undo brings the answer back", async () => {
    const documentId = await newPage();
    const { checkId } = await addIntroCheck(documentId);

    await as(editor, () =>
      actions.skip.run(
        { documentId, checkId, placeKey: "intro" },
        ctxFor(editor),
      ),
    );
    expect((await list(documentId)).checks[0]?.answers[0]?.answer).toBe(
      "skipped",
    );

    await as(editor, () =>
      actions.skip.run(
        { documentId, checkId, placeKey: "intro", undo: true },
        ctxFor(editor),
      ),
    );
    expect((await list(documentId)).checks[0]?.answers[0]?.answer).toBe(
      "not_fine",
    );

    await as(editor, () =>
      actions.skip.run(
        { documentId, checkId, placeKey: "intro" },
        ctxFor(editor),
      ),
    );
    await setBody(documentId, DRAFT.replace("end.", "ending."));
    expect((await run(documentId)).checks[0]?.answers[0]?.answer).toBe(
      "not_fine",
    );
  });
});

describe("who can do what", () => {
  it("lets commenters read checks and nothing more", async () => {
    const documentId = await newPage();
    const { checkId } = await addIntroCheck(documentId);
    expect((await list(documentId, commenter)).canEdit).toBe(false);
    expect((await list(documentId, editor)).canEdit).toBe(true);

    await expect(addIntroCheck(documentId, commenter)).rejects.toThrow(
      /Requires editor/,
    );
    await expect(run(documentId, commenter)).rejects.toThrow(/Requires editor/);
    await expect(
      as(commenter, () =>
        actions.skip.run(
          { documentId, checkId, placeKey: "intro" },
          ctxFor(commenter),
        ),
      ),
    ).rejects.toThrow(/Requires editor/);
  });

  it("sends viewers and strangers nothing", async () => {
    const documentId = await newPage();
    await addIntroCheck(documentId);
    await expect(list(documentId, viewer)).rejects.toThrow(
      /Requires commenter/,
    );
    await expect(list(documentId, stranger)).rejects.toThrow(/No access/);
  });

  it("stops a person's runs when they lose edit access", async () => {
    const documentId = await newPage();
    await addIntroCheck(documentId);
    await dbModule
      .getDb()
      .update(dbModule.schema.documentShares)
      .set({ role: "commenter" })
      .where(
        and(
          eq(dbModule.schema.documentShares.resourceId, documentId),
          eq(dbModule.schema.documentShares.principalId, editor),
        ),
      );
    await expect(run(documentId)).rejects.toThrow(/Requires editor/);
  });
});

describe("deleting a check", () => {
  it("takes its answers and skips with it", async () => {
    const documentId = await newPage();
    const { checkId } = await addIntroCheck(documentId);
    await as(editor, () =>
      actions.skip.run(
        { documentId, checkId, placeKey: "intro" },
        ctxFor(editor),
      ),
    );
    await as(editor, () =>
      actions.remove.run({ documentId, checkId }, ctxFor(editor)),
    );
    expect((await list(documentId)).checks).toEqual([]);
    expect(await resultRows(checkId)).toEqual([]);
    const skips = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentPageCheckSkips)
      .where(eq(dbModule.schema.contentPageCheckSkips.checkId, checkId));
    expect(skips).toEqual([]);
  });
});
