import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EVENT_FEEDBACK_QUESTION_IDS,
  eventFeedbackBlocks,
} from "../shared/form-model/fixtures.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import createForm from "./create-form.js";
import getDropoffs from "./get-form-dropoffs.js";
import getInsights from "./get-form-insights.js";
import getVisitSeries from "./get-form-visit-series.js";
import publishForm from "./publish-form.js";
import recordEvent from "./record-form-event.js";
import submitResponse from "./submit-response.js";

describe("visits, drop-offs and completion", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("counts visitors across sessions, completion time, and where sessions stop", async () => {
    const blocks = eventFeedbackBlocks({ withSnack: false });
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () => publishForm.run({ id, blocks }));
    const first = { id: EVENT_FEEDBACK_QUESTION_IDS.rating };
    const second = { id: EVENT_FEEDBACK_QUESTION_IDS.comments };
    const send = (
      session: string,
      type: "visit" | "start" | "question_answer",
      data?: Record<string, unknown>,
    ) =>
      recordEvent.run({
        formId: id,
        sessionId: `${id}-${session}-aaaa`,
        type,
        ...(data ? { data } : {}),
      });

    await send("s1", "visit", { respondentId: "person-1-aaaa" });
    await send("s1", "start");
    await send("s1", "question_answer", { questionId: first.id });
    await send("s2", "visit", { respondentId: "person-1-aaaa" });
    await send("s3", "visit", { respondentId: "person-2-aaaa" });
    await send("s3", "start");
    await send("s3", "question_answer", { questionId: first.id });
    await send("s3", "question_answer", { questionId: second.id });
    await submitResponse.run({
      formId: id,
      sessionId: `${id}-s1-aaaa`,
      respondentId: "person-1-aaaa",
      answers: { [first.id]: 4 },
      isCompleted: true,
    });

    const insights = await as(owner, () =>
      getInsights.run({ formId: id, period: "all" }),
    );
    expect(insights).toMatchObject({ visits: 3, starts: 2, submissions: 1 });
    expect(insights.uniqueRespondents).toBe(2);
    expect(insights.completionDurationMs).toBeGreaterThanOrEqual(0);

    const dropoffs = await as(owner, () =>
      getDropoffs.run({ formId: id, period: "all" }),
    );
    const byId = new Map(
      dropoffs.questions.map((row) => [row.question.id, row]),
    );
    expect(byId.get(first.id)).toMatchObject({ answered: 2, droppedOff: 0 });
    expect(byId.get(second.id)).toMatchObject({ answered: 1, droppedOff: 1 });

    const series = await as(owner, () =>
      getVisitSeries.run({ formId: id, period: "24h" }),
    );
    expect(series.unit).toBe("hour");
    expect(series.buckets.reduce((sum, bucket) => sum + bucket.visits, 0)).toBe(
      3,
    );
  });
});
