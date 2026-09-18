import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
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
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export const DESIGN_ACCESS_REQUEST_EMAIL_ID = "design.access-request";

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function displayNameForEmail(email: string): string {
  const parts = email
    .replace(/@.*/, "")
    .split(/[._+-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0
    ? parts
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : email;
}

function accessRequestId(designId: string, requesterEmail: string): string {
  return `design-access-request-${createHash("sha256")
    .update(designId)
    .update("\0")
    .update(requesterEmail)
    .digest("hex")}`;
}

function absoluteDesignUrl(designId: string): string {
  const appUrl = getAppProductionUrl().replace(/\/+$/, "");
  const path = `/design/${encodeURIComponent(designId)}`;
  try {
    return new URL(path, `${appUrl}/`).toString();
  } catch {
    return `${appUrl}${path}`;
  }
}

export function renderDesignAccessRequestEmail(input: {
  requesterName: string;
  requesterEmail: string;
  designTitle: string;
  url: string;
}) {
  const subject = `${input.requesterName} requested access to "${input.designTitle}"`;
  return {
    subject,
    ...renderEmail({
      preheader: subject,
      heading: "Access request",
      paragraphs: [
        `${emailStrong(input.requesterName)} (${emailStrong(input.requesterEmail)}) requested access to ${emailStrong(input.designTitle)}.`,
        "Open the design and use Share to grant access if this request should be approved.",
      ],
      cta: { label: "Open design", url: input.url },
      footer: "You received this because you own this Agent-Native Design.",
    }),
  };
}

async function notifyOwner(input: {
  designId: string;
  designTitle: string;
  ownerEmail: string | null;
  requesterEmail: string;
  requesterName: string;
}): Promise<boolean> {
  if (!(await isEmailConfigured())) return false;
  if (
    !input.ownerEmail ||
    input.ownerEmail.trim().toLowerCase() === input.requesterEmail
  ) {
    return false;
  }

  await sendEmail({
    ...renderDesignAccessRequestEmail({
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail,
      designTitle: input.designTitle,
      url: absoluteDesignUrl(input.designId),
    }),
    to: input.ownerEmail,
    templateId: DESIGN_ACCESS_REQUEST_EMAIL_ID,
  });
  return true;
}

export default defineAction({
  description:
    "Request access to a private Agent-Native Design URL. Records a durable access request and notifies the owner when email is configured.",
  schema: z.object({
    designId: z.string().min(1).describe("Design ID to request access to."),
  }),
  agentTool: false,
  run: async ({ designId }) => {
    const requesterEmail = getRequestUserEmail()?.trim().toLowerCase();
    if (!requesterEmail) {
      throw httpError("Sign in to request access to this design.", 401);
    }

    const db = getDb();
    const [design] = await db
      .select({
        id: schema.designs.id,
        title: schema.designs.title,
        ownerEmail: schema.designs.ownerEmail,
      })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);

    if (!design) {
      throw httpError(`Design ${designId} not found`, 404);
    }

    const access = await resolveAccess("design", designId);
    if (access) {
      return {
        ok: true,
        alreadyHasAccess: true,
        alreadyRequested: false,
        notifiedOwner: false,
        message: "You already have access. Refreshing the design...",
      };
    }

    const requesterName =
      getRequestUserName()?.trim() || displayNameForEmail(requesterEmail);
    const requestId = accessRequestId(designId, requesterEmail);
    const [request] = await db
      .insert(schema.designAccessRequests)
      .values({
        id: requestId,
        designId,
        requesterEmail,
        requesterName,
      })
      .onConflictDoNothing()
      .returning({ id: schema.designAccessRequests.id });

    if (!request) {
      return {
        ok: true,
        alreadyHasAccess: false,
        alreadyRequested: true,
        notifiedOwner: false,
        requestId,
        message: "Access has already been requested from the design owner.",
      };
    }

    let notifiedOwner = false;
    try {
      notifiedOwner = await notifyOwner({
        designId,
        designTitle: design.title,
        ownerEmail: design.ownerEmail ?? null,
        requesterEmail,
        requesterName,
      });
    } catch (error) {
      console.warn(
        "[design-access] access request notification failed:",
        error,
      );
    }

    return {
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: false,
      notifiedOwner,
      requestId,
      message: notifiedOwner
        ? "Access request sent to the design owner."
        : "Access request recorded for the design owner.",
    };
  },
});
