import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eventFeedbackBlocks } from "../shared/form-model/fixtures.js";
import {
  as,
  owner,
  startTestDb,
  stopTestDb,
  stranger,
} from "./_test-context.js";
import createForm from "./create-form.js";
import deleteSubmissions from "./delete-submissions.js";
import exportCsv from "./export-submissions-csv.js";
import getInsights from "./get-form-insights.js";
import getQuestionSummary from "./get-question-summary.js";
import getSubmission from "./get-submission.js";
import listSubmissions from "./list-submissions.js";
import listTrash from "./list-trash.js";
import publishForm from "./publish-form.js";
import recordEvent from "./record-form-event.js";
import restoreItem from "./restore-item.js";
import restoreSubmission from "./restore-submission.js";
import submitResponse from "./submit-response.js";
import updateSettings from "./update-form-settings.js";

const RATING = "feedback-rating";
const COMMENTS = "feedback-comments";
const SNACK = "feedback-snack";

async function feedbackForm() {
  const { id } = await as(owner, () => createForm.run({}));
  await as(owner, () =>
    publishForm.run({ id, blocks: eventFeedbackBlocks({ withSnack: true }) }),
  );
  await as(owner, () =>
    updateSettings.run({ id, settings: { partialSubmissions: true } }),
  );
  const send = (session: string, answers: object, isCompleted = true) =>
    submitResponse.run({
      formId: id,
      sessionId: `${id}-${session}`,
      respondentId: `person-${session}`,
      answers: answers as never,
      isCompleted,
    });
  const first = await send("results-s1", {
    [RATING]: 5,
    [COMMENTS]: "Great",
    [SNACK]: "Chips",
  });
  await send("results-s2", {
    [RATING]: 3,
    [COMMENTS]: "=SUM(1)",
    [SNACK]: "Nuts, mixed",
  });
  await send("results-s3", { [SNACK]: "Pretzels" }, false);
  await as(owner, () =>
    publishForm.run({ id, blocks: eventFeedbackBlocks({ withSnack: false }) }),
  );
  return { id, first };
}

describe("results", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("keeps a deleted question's column, counts and filters", async () => {
    const { id } = await feedbackForm();
    const all = await as(owner, () =>
      listSubmissions.run({ formId: id, filter: "all", limit: 100, offset: 0 }),
    );
    expect(all.counts).toEqual({ all: 3, completed: 2, partial: 1 });
    expect(all.questions.map((q) => [q.title, q.isDeleted])).toEqual([
      ["Overall rating", false],
      ["Comments", false],
      ["Favorite snack", true],
    ]);
    expect(all.submissions).toHaveLength(3);
    expect(all.hasMore).toBe(false);
    const partial = await as(owner, () =>
      listSubmissions.run({
        formId: id,
        filter: "partial",
        limit: 100,
        offset: 0,
      }),
    );
    expect(partial.submissions.map((s) => s.answers[SNACK])).toEqual([
      "Pretzels",
    ]);
    const paged = await as(owner, () =>
      listSubmissions.run({ formId: id, filter: "all", limit: 2, offset: 0 }),
    );
    expect(paged.hasMore).toBe(true);
  });

  it("soft deletes a submission, trashes it and restores it", async () => {
    const { id, first } = await feedbackForm();
    if (!first.ok) throw new Error("seed failed");
    await as(owner, () =>
      deleteSubmissions.run({ formId: id, ids: [first.submissionId] }),
    );
    const list = await as(owner, () =>
      listSubmissions.run({ formId: id, filter: "all", limit: 100, offset: 0 }),
    );
    expect(list.counts).toEqual({ all: 2, completed: 1, partial: 1 });
    const trash = await as(owner, () => listTrash.run({}));
    expect(trash.items.map((i) => [i.kind, i.id])).toEqual([
      ["submission", first.submissionId],
    ]);
    await expect(
      as(owner, () => getSubmission.run({ id: first.submissionId })),
    ).rejects.toMatchObject({ errorCode: "not_found" });

    await as(owner, () =>
      restoreItem.run({ kind: "submission", id: first.submissionId }),
    );
    const back = await as(owner, () =>
      listSubmissions.run({ formId: id, filter: "all", limit: 100, offset: 0 }),
    );
    expect(back.counts.all).toBe(3);
    await as(owner, () =>
      deleteSubmissions.run({ formId: id, ids: [first.submissionId] }),
    );
    await as(owner, () => restoreSubmission.run({ id: first.submissionId }));
    const read = await as(owner, () =>
      getSubmission.run({ id: first.submissionId }),
    );
    expect(read.submission.answers[SNACK]).toBe("Chips");
    expect(read.formName).toBe("Event feedback");
  });

  it("refuses to restore a submission whose duplicate key a newer one now holds", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () =>
      publishForm.run({
        id,
        blocks: eventFeedbackBlocks({ withSnack: false }),
      }),
    );
    await as(owner, () =>
      updateSettings.run({ id, settings: { preventDuplicates: true } }),
    );
    const send = (session: string) =>
      submitResponse.run({
        formId: id,
        sessionId: `${id}-${session}`,
        respondentId: "same-person",
        answers: { [RATING]: 4 },
        isCompleted: true,
      });
    const older = await send("dedupe-1");
    if (!older.ok) throw new Error("seed failed");
    await as(owner, () =>
      deleteSubmissions.run({ formId: id, ids: [older.submissionId] }),
    );
    expect(await send("dedupe-2")).toMatchObject({ ok: true });

    const expected = {
      errorCode: "conflict",
      message: expect.stringContaining("newer submission"),
    };
    await expect(
      as(owner, () =>
        restoreItem.run({ kind: "submission", id: older.submissionId }),
      ),
    ).rejects.toMatchObject(expected);
    await expect(
      as(owner, () => restoreSubmission.run({ id: older.submissionId })),
    ).rejects.toMatchObject(expected);
    const trash = await as(owner, () => listTrash.run({}));
    expect(trash.items.map((item) => item.id)).toContain(older.submissionId);
  });

  it("exports CSV with deleted columns, quoting and formula guard", async () => {
    const { id } = await feedbackForm();
    const { csv, filename } = await as(owner, () =>
      exportCsv.run({ formId: id, filter: "completed" }),
    );
    expect(filename).toBe("event-feedback-submissions.csv");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "Submitted at,Overall rating,Comments,Favorite snack",
    );
    expect(lines).toHaveLength(3);
    expect(csv).toContain("'=SUM(1)");
    expect(csv).toContain('"Nuts, mixed"');
  });

  it("computes insights and question summaries", async () => {
    const { id } = await feedbackForm();
    for (const [session, types] of [
      ["ins-session-1", ["visit", "start"]],
      ["ins-session-2", ["visit"]],
      ["ins-session-3", ["visit", "start"]],
      ["ins-session-4", ["visit"]],
    ] as const)
      for (const type of types)
        await recordEvent.run({
          formId: id,
          sessionId: `${id}-${session}`,
          type,
        });
    const insights = await as(owner, () =>
      getInsights.run({ formId: id, period: "all" }),
    );
    expect(insights).toMatchObject({
      visits: 4,
      starts: 2,
      submissions: 2,
      uniqueRespondents: 2,
    });
    expect(insights.completionRate).toBe(0.5);
    expect(insights.questions.find((q) => q.id === SNACK)).toMatchObject({
      isDeleted: true,
      answerCount: 2,
    });

    const rating = await as(owner, () =>
      getQuestionSummary.run({ formId: id, questionId: RATING }),
    );
    expect(rating.average).toBe(4);
    expect(rating.distribution).toEqual([
      { value: 3, count: 1 },
      { value: 5, count: 1 },
    ]);
    const comments = await as(owner, () =>
      getQuestionSummary.run({ formId: id, questionId: COMMENTS }),
    );
    expect(comments.recent.map((r) => r.text).sort()).toEqual([
      "=SUM(1)",
      "Great",
    ]);
  });

  it("keeps other organizations out of results", async () => {
    const { id } = await feedbackForm();
    await expect(
      as(stranger, () =>
        listSubmissions.run({
          formId: id,
          filter: "all",
          limit: 100,
          offset: 0,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "not_found" });
  });
});
