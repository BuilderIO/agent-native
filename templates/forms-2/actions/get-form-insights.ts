import { defineAction } from "@agent-native/core/action";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  formInsightsSchema,
  INSIGHT_PERIODS,
} from "../shared/form-contract.js";
import {
  firstRow,
  formsAccess,
  formsErrors,
  orgScope,
  requireForm,
} from "./_access.js";
import { loadQuestions, periodRange } from "./_form-store.js";

export default defineAction({
  description:
    "Form metrics for a period: visits, starts, completed submissions, unique respondents, completion rate, mean visit duration, and an answer count per question.",
  schema: z.object({
    formId: z.string().describe("Form id"),
    period: z
      .enum(INSIGHT_PERIODS)
      .default("all")
      .describe(
        "One of all, today, yesterday, 24h, 7d, 30d, 3m, 6m, 12m; defaults to all",
      ),
  }),
  outputSchema: formInsightsSchema,
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formId, period }) => {
    const access = formsAccess();
    await requireForm(access, formId);
    const db = getDb();
    const { formEvents, submissions, responses } = schema;
    const { from, to } = periodRange(period);

    const events = firstRow(
      await db
        .select({
          visits: sql<number>`count(distinct ${formEvents.sessionId}) filter (where ${formEvents.type} = 'visit')::int`,
          starts: sql<number>`count(distinct ${formEvents.sessionId}) filter (where ${formEvents.type} = 'start')::int`,
        })
        .from(formEvents)
        .where(
          and(
            orgScope(formEvents, access.orgId),
            eq(formEvents.formId, formId),
            from ? gte(formEvents.at, from) : undefined,
            to ? lt(formEvents.at, to) : undefined,
          ),
        ),
    );

    const sessions = await db
      .select({
        first: sql<string>`min(${formEvents.at})`,
        last: sql<string>`max(${formEvents.at})`,
      })
      .from(formEvents)
      .where(
        and(
          orgScope(formEvents, access.orgId),
          eq(formEvents.formId, formId),
          from ? gte(formEvents.at, from) : undefined,
          to ? lt(formEvents.at, to) : undefined,
        ),
      )
      .groupBy(formEvents.sessionId)
      .having(sql`count(*) > 1`)
      .limit(5000);
    const durations = sessions.map(
      (row) => Date.parse(row.last) - Date.parse(row.first),
    );
    const visitDurationMs = durations.length
      ? Math.round(
          durations.reduce((sum, ms) => sum + ms, 0) / durations.length,
        )
      : null;

    const completed = and(
      orgScope(submissions, access.orgId),
      eq(submissions.formId, formId),
      eq(submissions.isCompleted, true),
      isNull(submissions.deletedAt),
      from ? gte(submissions.submittedAt, from) : undefined,
      to ? lt(submissions.submittedAt, to) : undefined,
    );
    const totals = firstRow(
      await db
        .select({ submissions: sql<number>`count(*)::int` })
        .from(submissions)
        .where(completed),
    );

    const visitors = await db
      .selectDistinct({
        id: sql<string | null>`${formEvents.data}->>'respondentId'`,
      })
      .from(formEvents)
      .where(
        and(
          orgScope(formEvents, access.orgId),
          eq(formEvents.formId, formId),
          eq(formEvents.type, "visit"),
          from ? gte(formEvents.at, from) : undefined,
          to ? lt(formEvents.at, to) : undefined,
        ),
      )
      .limit(5000);
    const submitters = await db
      .selectDistinct({ id: submissions.respondentId })
      .from(submissions)
      .where(completed)
      .limit(5000);
    const respondents = new Set(
      [...visitors, ...submitters].flatMap((row) => (row.id ? [row.id] : [])),
    );

    const finished = await db
      .select({
        sessionId: submissions.sessionId,
        submittedAt: submissions.submittedAt,
      })
      .from(submissions)
      .where(completed)
      .limit(5000);
    const firstSeen = finished.length
      ? await db
          .select({
            sessionId: formEvents.sessionId,
            first: sql<string>`min(${formEvents.at})`,
          })
          .from(formEvents)
          .where(
            and(
              eq(formEvents.formId, formId),
              inArray(
                formEvents.sessionId,
                finished.map((row) => row.sessionId),
              ),
            ),
          )
          .groupBy(formEvents.sessionId)
      : [];
    const startedAt = new Map(
      firstSeen.map((row) => [row.sessionId, row.first]),
    );
    const completionTimes = finished.flatMap((row) => {
      const first = startedAt.get(row.sessionId);
      return first ? [Date.parse(row.submittedAt) - Date.parse(first)] : [];
    });
    const completionDurationMs = completionTimes.length
      ? Math.round(
          completionTimes.reduce((sum, ms) => sum + ms, 0) /
            completionTimes.length,
        )
      : null;

    const answerCounts = await db
      .select({
        questionId: responses.questionId,
        count: sql<number>`count(*)::int`,
      })
      .from(responses)
      .innerJoin(submissions, eq(submissions.id, responses.submissionId))
      .where(and(completed, orgScope(responses, access.orgId)))
      .groupBy(responses.questionId);
    const countByRow = new Map(
      answerCounts.map((row) => [row.questionId, row.count]),
    );
    const rows = await loadQuestions(db, access.orgId, formId);

    const visits = events?.visits ?? 0;
    const done = totals?.submissions ?? 0;
    return {
      visits,
      starts: events?.starts ?? 0,
      submissions: done,
      uniqueRespondents: respondents.size,
      completionRate: visits === 0 ? 0 : Math.min(1, done / visits),
      visitDurationMs,
      completionDurationMs,
      questions: rows.map((question) => ({
        id: question.id,
        title: question.title,
        type: question.type,
        isDeleted: question.isDeleted,
        answerCount: countByRow.get(`${formId}:${question.id}`) ?? 0,
      })),
    };
  },
});
