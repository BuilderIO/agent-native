import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineAction } from "../../action.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { assertAccess, ForbiddenError } from "../access.js";
import { requireShareableResource } from "../registry.js";
import { sendEmail, isEmailConfigured } from "../../server/email.js";
import { renderEmail, emailStrong } from "../../server/email-template.js";
import { getAppProductionUrl } from "../../server/app-url.js";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export default defineAction({
  description:
    "Grant a user or org access to a shareable resource. Owner or admin role required.",
  schema: z.object({
    resourceType: z
      .string()
      .describe("Registered resource type, e.g. 'document', 'form'."),
    resourceId: z.string().describe("Id of the resource to share."),
    principalType: z
      .enum(["user", "org"])
      .describe("'user' for an individual, 'org' for a whole organization."),
    principalId: z
      .string()
      .describe("Email (user) or org id (org) of the principal."),
    role: z
      .enum(["viewer", "editor", "admin"])
      .default("viewer")
      .describe("Role to grant."),
  }),
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    await assertAccess(args.resourceType, args.resourceId, "admin");
    const actor = getRequestUserEmail();
    if (!actor) throw new ForbiddenError("Not signed in");

    const db = reg.getDb() as any;
    const [existing] = await db
      .select()
      .from(reg.sharesTable)
      .where(
        and(
          eq(reg.sharesTable.resourceId, args.resourceId),
          eq(reg.sharesTable.principalType, args.principalType),
          eq(reg.sharesTable.principalId, args.principalId),
        ),
      );

    if (existing) {
      await db
        .update(reg.sharesTable)
        .set({ role: args.role })
        .where(eq(reg.sharesTable.id, existing.id));
      return { id: existing.id, updated: true };
    }

    const id = nanoid();
    await db.insert(reg.sharesTable).values({
      id,
      resourceId: args.resourceId,
      principalType: args.principalType,
      principalId: args.principalId,
      role: args.role,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    });

    if (args.principalType === "user" && isEmailConfigured()) {
      try {
        const titleCol = reg.titleColumn ?? "title";
        const [resource] = await db
          .select()
          .from(reg.resourceTable)
          .where(eq(reg.resourceTable.id, args.resourceId));
        const resourceTitle: string =
          (resource?.[titleCol] as string | undefined) ?? args.resourceType;
        const appUrl = getAppProductionUrl();
        const appName =
          process.env.APP_NAME || process.env.VITE_APP_NAME || "Agent Native";
        const subject = `${actor} shared "${resourceTitle}" with you on ${appName}`;
        const { html, text } = renderEmail({
          preheader: subject,
          heading: "You've been given access",
          paragraphs: [
            `${emailStrong(actor)} has shared the ${reg.displayName} ${emailStrong(resourceTitle)} with you as a ${emailStrong(args.role)}.`,
            `You can access it by visiting ${emailStrong(appName)}.`,
          ],
          cta: { label: `Open ${reg.displayName}`, url: appUrl },
          footer: `You received this because ${actor} granted you ${args.role} access.`,
        });
        await sendEmail({ to: args.principalId, subject, html, text });
      } catch (err) {
        console.error(
          "[share-resource] failed to send share notification:",
          err,
        );
      }
    }

    return { id, updated: false };
  },
});
