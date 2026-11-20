import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import {
  pagesSurveyBlocks,
  singlePageBlocks,
} from "../shared/form-model/fixtures.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import createForm from "./create-form.js";
import deleteForm from "./delete-form.js";
import getPublicForm from "./get-public-form.js";
import publishForm from "./publish-form.js";
import recordEvent from "./record-form-event.js";
import saveDraft from "./save-form-draft.js";
import submitResponse from "./submit-response.js";
import updateSettings from "./update-form-settings.js";

const YES = "pages-reply:option-0";
const NO = "pages-reply:option-1";

async function publishedForm(blocks = singlePageBlocks()) {
  const { id } = await as(owner, () => createForm.run({}));
  await as(owner, () => publishForm.run({ id, blocks }));
  return id;
}

const submit = (
  formId: string,
  sessionId: string,
  answers: Record<string, never>,
  isCompleted = true,
) =>
  submitResponse.run({
    formId,
    sessionId,
    respondentId: "respondent-1",
    answers,
    isCompleted,
  });

describe("public form and responses", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("serves published blocks only and hides drafts without saying why", async () => {
    const { id: draftId } = await as(owner, () => createForm.run({}));
    await as(owner, () =>
      saveDraft.run({ id: draftId, blocks: singlePageBlocks() }),
    );
    expect(await getPublicForm.run({ formId: draftId })).toEqual({
      state: "unavailable",
    });
    expect(await getPublicForm.run({ formId: "missing" })).toEqual({
      state: "unavailable",
    });

    const id = await publishedForm();
    await as(owner, () => saveDraft.run({ id, blocks: pagesSurveyBlocks() }));
    const open = await getPublicForm.run({ formId: id });
    expect(open.state).toBe("open");
    if (open.state === "open")
      expect(JSON.stringify(open.form.blocks)).toContain("Single survey");

    await as(owner, () => deleteForm.run({ id }));
    expect(await getPublicForm.run({ formId: id })).toEqual({
      state: "unavailable",
    });
  });

  it("stamps the form's org on every row a respondent writes", async () => {
    const id = await publishedForm();
    await recordEvent.run({
      formId: id,
      sessionId: "session-org-1",
      type: "visit",
    });
    await submit(id, "session-org-1", {});
    const db = getDb();
    const { forms, questions, submissions, responses, formEvents } = schema;
    for (const table of [forms, questions, submissions, responses, formEvents])
      expect(await db.select().from(table).where(isNull(table.orgId))).toEqual(
        [],
      );
    const [event] = await db
      .select()
      .from(formEvents)
      .where(eq(formEvents.formId, id));
    expect(event?.orgId).toBe(owner.orgId);
  });

  it("reports a closed form and refuses submissions to it", async () => {
    const id = await publishedForm();
    await as(owner, () =>
      updateSettings.run({
        id,
        isClosed: true,
        settings: { closedMessage: "Back soon" },
      }),
    );
    expect(await getPublicForm.run({ formId: id })).toEqual({
      state: "closed",
      message: "Back soon",
    });
    const result = await submit(id, "session-closed-1", {
      "single-name": "Ada" as never,
    });
    expect(result).toMatchObject({ ok: false, reason: "closed" });
  });

  it("closes at the submissions limit", async () => {
    const id = await publishedForm();
    await as(owner, () =>
      updateSettings.run({ id, settings: { submissionsLimit: 1 } }),
    );
    expect(
      (await submit(id, "session-limit-1", { "single-name": "A" as never })).ok,
    ).toBe(true);
    expect(await getPublicForm.run({ formId: id })).toMatchObject({
      state: "closed",
    });
  });

  it("refuses an unpublished form and rejects invalid answers", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () => saveDraft.run({ id, blocks: singlePageBlocks() }));
    expect(
      await submit(id, "session-draft-1", { "single-name": "A" as never }),
    ).toMatchObject({
      ok: false,
      reason: "unavailable",
    });

    const live = await publishedForm();
    const invalid = await submit(live, "session-invalid-1", {});
    expect(invalid).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: [{ questionId: "single-name", code: "required" }],
    });
    const count = await getDb().select().from(schema.submissions);
    expect(count.some((s) => s.formId === live)).toBe(false);
  });

  it("is idempotent on the session id", async () => {
    const id = await publishedForm();
    const answers = { "single-name": "Ada" as never };
    const [a, b] = await Promise.all([
      submit(id, "session-idem-1", answers),
      submit(id, "session-idem-1", answers),
    ]);
    const again = await submit(id, "session-idem-1", answers);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    if (a.ok && b.ok && again.ok) {
      expect(b.submissionId).toBe(a.submissionId);
      expect(again.submissionId).toBe(a.submissionId);
    }
    const rows = await getDb()
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.formId, id));
    expect(rows).toHaveLength(1);
    const other = await publishedForm();
    expect(await submit(other, "session-idem-1", answers)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("drops answers from pages the respondent skipped", async () => {
    const id = await publishedForm(pagesSurveyBlocks());
    const result = await submit(id, "session-branch-1", {
      "pages-name": "Ada" as never,
      "pages-reply": { selected: [NO] } as never,
      "pages-feedback": "never shown" as never,
      "pages-extra": "kept" as never,
    });
    expect(result.ok).toBe(true);
    const rows = await getDb()
      .select({ id: schema.responses.questionId })
      .from(schema.responses);
    const mine = rows.filter((r) => r.id.startsWith(`${id}:`)).map((r) => r.id);
    expect(mine.sort()).toEqual(
      [`${id}:pages-extra`, `${id}:pages-name`, `${id}:pages-reply`].sort(),
    );

    const yes = await submit(id, "session-branch-2", {
      "pages-name": "Ada" as never,
      "pages-reply": { selected: [YES] } as never,
      "pages-email": "ada@example.test" as never,
      "pages-feedback": "ok" as never,
    });
    expect(yes.ok).toBe(true);
  });

  it("saves partial submissions only when the form allows them", async () => {
    const id = await publishedForm();
    expect(
      await submit(
        id,
        "session-partial-1",
        { "single-name": "A" as never },
        false,
      ),
    ).toMatchObject({ ok: false, reason: "invalid" });
    await as(owner, () =>
      updateSettings.run({ id, settings: { partialSubmissions: true } }),
    );
    const partial = await submit(id, "session-partial-1", {}, false);
    expect(partial).toMatchObject({ ok: true, isCompleted: false });
    const done = await submit(id, "session-partial-1", {
      "single-name": "Ada" as never,
    });
    expect(done).toMatchObject({ ok: true, isCompleted: true });
    if (partial.ok && done.ok)
      expect(done.submissionId).toBe(partial.submissionId);
  });

  it("records events only for published forms and caps a session", async () => {
    const id = await publishedForm();
    const event = (sessionId: string, formId = id) =>
      recordEvent.run({ formId, sessionId, type: "visit" });
    expect(await event("session-events-1")).toEqual({ recorded: true });
    expect(await event("session-events-1", "missing")).toEqual({
      recorded: false,
    });
    for (let i = 0; i < 199; i++) await event("session-events-1");
    expect(await event("session-events-1")).toEqual({ recorded: false });
  });
});
