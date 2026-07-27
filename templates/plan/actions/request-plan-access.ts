import { defineAction } from "@agent-native/core";
import {
  emailStrong,
  getAppProductionUrl,
  isEmailConfigured,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { currentAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  resolvePlanAccessContext,
} from "../server/lib/local-identity.js";
import { newId, nowIso, planPath, writeEvent } from "../server/plans.js";

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function displayNameForEmail(email: string): string {
  const local = email.replace(/@.*/, "");
  const parts = local
    .split(/[._+-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function absolutePlanUrl(planId: string, kind: "plan" | "recap"): string {
  const appUrl = getAppProductionUrl().replace(/\/+$/, "");
  const path = planPath(planId, kind);
  try {
    return new URL(path, `${appUrl}/`).toString();
  } catch {
    return `${appUrl}${path}`;
  }
}

async function notifyOwner(input: {
  planId: string;
  planKind: "plan" | "recap";
  planTitle: string;
  ownerEmail: string | null;
  requesterEmail: string;
  requesterName: string;
}): Promise<boolean> {
  if (!(await isEmailConfigured())) return false;
  if (!input.ownerEmail || input.ownerEmail === input.requesterEmail) {
    return false;
  }

  const url = absolutePlanUrl(input.planId, input.planKind);
  const subject = `${input.requesterName} requested access to "${input.planTitle}"`;
  const { html, text } = renderEmail({
    preheader: subject,
    heading: "Access request",
    paragraphs: [
      `${emailStrong(input.requesterName)} (${emailStrong(input.requesterEmail)}) requested access to ${emailStrong(input.planTitle)}.`,
      "Open the plan and use Share to grant access if this request should be approved.",
    ],
    cta: { label: "Open plan", url },
    footer: "You received this because you own this Agent-Native Plan.",
  });
  await sendEmail({ to: input.ownerEmail, subject, html, text });
  return true;
}

export default defineAction({
  description:
    "Request access to a private Agent-Native Plan URL. Records an access-request event and notifies the owner when email is configured.",
  schema: z.object({
    planId: z.string().min(1).describe("Plan ID to request access to."),
  }),
  agentTool: false,
  run: async ({ planId }) => {
    const requesterEmail = getRequestUserEmail();
    if (
      !requesterEmail ||
      isAnonymousPublicViewer(requesterEmail) ||
      isGuestAuthorIdentity(requesterEmail)
    ) {
      throw httpError("Sign in to request access to this plan.", 401);
    }

    const db = getDb();
    const [plan] = await db
      .select({
        id: schema.plans.id,
        title: schema.plans.title,
        kind: schema.plans.kind,
        ownerEmail: schema.plans.ownerEmail,
        deletedAt: schema.plans.deletedAt,
      })
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);

    if (!plan || plan.deletedAt) {
      throw httpError(`Plan ${planId} not found`, 404);
    }

    const access = await resolveAccess(
      "plan",
      planId,
      resolvePlanAccessContext(currentAccess()),
    );
    if (access) {
      return {
        ok: true,
        alreadyHasAccess: true,
        notifiedOwner: false,
        message: "You already have access. Refreshing the plan...",
      };
    }

    const requesterName =
      getRequestUserName()?.trim() || displayNameForEmail(requesterEmail);
    const requestId = newId("req");
    const now = nowIso();

    await writeEvent({
      planId,
      type: "plan.access_requested",
      message: `${requesterEmail} requested access to this plan.`,
      payload: {
        requestId,
        requesterEmail,
        requesterName,
        requestedAt: now,
      },
      createdBy: "human",
    });

    let notifiedOwner = false;
    try {
      notifiedOwner = await notifyOwner({
        planId,
        planKind: plan.kind ?? "plan",
        planTitle: plan.title,
        ownerEmail: plan.ownerEmail ?? null,
        requesterEmail,
        requesterName,
      });
    } catch (error) {
      console.warn("[plan-access] access request notification failed:", error);
    }

    return {
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner,
      requestId,
      message: notifiedOwner
        ? "Access request sent to the plan owner."
        : "Access request recorded for the plan owner.",
    };
  },
});
