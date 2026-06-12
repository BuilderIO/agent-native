import { defineAction } from "@agent-native/core";
import {
  ForbiddenError,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { newId, nowIso } from "../server/plans.js";
import { PLAN_REPORT_REASONS } from "../shared/types.js";

const optionalTrimmed = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }, z.string().max(max).optional());

export default defineAction({
  description:
    "Report a public or otherwise accessible Agent-Native Plan for inappropriate, unsafe, or abusive content. Use this only when the user explicitly wants to flag the current plan for moderation.",
  schema: z.object({
    planId: z.string().min(1).describe("Plan ID to report."),
    reason: z
      .enum(PLAN_REPORT_REASONS)
      .describe("The primary reason the plan is being reported."),
    details: optionalTrimmed(1000).describe(
      "Optional short context for moderators. Do not include secrets or private data.",
    ),
    pageUrl: optionalTrimmed(2048)
      .pipe(z.string().url().max(2048).optional())
      .describe("Optional URL where the reported plan was viewed."),
  }),
  agentTool: false,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: false,
    isConsequential: true,
    title: "Report Visual Plan",
    description:
      "Flag an accessible plan for moderation review without changing plan content.",
  },
  run: async (args) => {
    const reporterEmail = getRequestUserEmail();
    if (!reporterEmail) {
      throw new ForbiddenError(
        "Open the public plan before reporting it so the report can be scoped to that viewer.",
      );
    }

    const access = await resolveAccess(
      "plan",
      args.planId,
      resolvePlanAccessContext(currentAccess()),
    );
    if (!access) throw new ForbiddenError(`Plan ${args.planId} not found`);
    const plan = access.resource as typeof schema.plans.$inferSelect;
    if (plan.visibility !== "public") {
      throw new ForbiddenError(
        "Only public plans can be reported from the public review surface.",
      );
    }

    const db = getDb();
    const now = nowIso();
    const reporterName = getRequestUserName() ?? null;
    const pageUrl = args.pageUrl ?? null;
    const details = args.details ?? null;

    const [existing] = await db
      .select({
        id: schema.planReports.id,
        occurrenceCount: schema.planReports.occurrenceCount,
      })
      .from(schema.planReports)
      .where(
        and(
          eq(schema.planReports.planId, args.planId),
          eq(schema.planReports.reporterEmail, reporterEmail),
          eq(schema.planReports.status, "open"),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.planReports)
        .set({
          reason: args.reason,
          details,
          reporterName,
          pageUrl,
          occurrenceCount: existing.occurrenceCount + 1,
          updatedAt: now,
        })
        .where(eq(schema.planReports.id, existing.id));
      return {
        ok: true,
        reportId: existing.id,
        duplicate: true,
        message: "Thanks. We updated your existing report.",
      };
    }

    const reportId = newId("rpt");
    await db.insert(schema.planReports).values({
      id: reportId,
      planId: args.planId,
      reason: args.reason,
      details,
      status: "open",
      reporterEmail,
      reporterName,
      pageUrl,
      occurrenceCount: 1,
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      reportId,
      duplicate: false,
      message: "Thanks. We will review this plan.",
    };
  },
});
