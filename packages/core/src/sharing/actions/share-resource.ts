import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineAction } from "../../action.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { assertAccess, ForbiddenError } from "../access.js";
import { requireShareableResource } from "../registry.js";
import { sendEmail, isEmailConfigured } from "../../server/email.js";
import { renderEmail, emailStrong } from "../../server/email-template.js";
import { getAppProductionUrl } from "../../server/app-url.js";

export function isSyntheticQaEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return false;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return (
    local.includes("+qa") &&
    (domain === "example.test" ||
      domain.endsWith(".test") ||
      domain === "example.invalid" ||
      domain.endsWith(".invalid"))
  );
}

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!base) return path;
  const normalizedBase = `/${base}`;
  if (path === normalizedBase || path.startsWith(`${normalizedBase}/`)) {
    return path;
  }
  return `${normalizedBase}${path}`;
}

function safeNotificationUrl(value: string, appUrl: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const base = new URL(appUrl);
    if (trimmed.startsWith("/")) {
      const path = appPath(trimmed);
      const basePath = base.pathname.replace(/\/+$/, "");
      const alreadyIncludesBase =
        basePath && basePath !== "/" && path.startsWith(`${basePath}/`);
      const joined = alreadyIncludesBase
        ? `${base.origin}${path}`
        : `${appUrl.replace(/\/+$/, "")}${path}`;
      return new URL(joined).toString();
    }

    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.origin !== base.origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveShareNotificationUrl(
  explicitUrl: string | undefined,
  fallbackPath: string | undefined,
  appUrl = getAppProductionUrl(),
): string {
  for (const candidate of [explicitUrl, fallbackPath]) {
    if (!candidate) continue;
    const url = safeNotificationUrl(candidate, appUrl);
    if (url) return url;
  }
  return appUrl;
}

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
  // (audit H5) Sharing-grant operations are admin-tier and let a caller
  // expand who can read/write a resource. Refuse from the tools iframe
  // bridge so a malicious shared tool can't silently re-share its
  // viewer's resources to an attacker-controlled email.
  toolCallable: false,
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
    notify: z
      .boolean()
      .default(true)
      .describe(
        "Whether to email the user about a new individual share. Defaults to true.",
      ),
    resourceUrl: z
      .string()
      .optional()
      .describe(
        "Optional app-relative or same-origin URL recipients should open. External origins are ignored.",
      ),
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

    if (
      args.notify !== false &&
      args.principalType === "user" &&
      isEmailConfigured() &&
      !isSyntheticQaEmail(args.principalId)
    ) {
      try {
        const titleCol = reg.titleColumn ?? "title";
        const [resource] = await db
          .select()
          .from(reg.resourceTable)
          .where(eq(reg.resourceTable.id, args.resourceId));
        const resourceTitle: string =
          (resource?.[titleCol] as string | undefined) ?? args.resourceType;
        const appUrl = getAppProductionUrl();
        const resourcePath =
          resource && reg.getResourcePath
            ? reg.getResourcePath(resource)
            : undefined;
        const notificationUrl = resolveShareNotificationUrl(
          args.resourceUrl,
          resourcePath,
          appUrl,
        );
        const appName =
          process.env.APP_NAME || process.env.VITE_APP_NAME || "Agent Native";
        const subject = `${actor} shared "${resourceTitle}" with you on ${appName}`;
        const { html, text } = renderEmail({
          preheader: subject,
          heading: "You've been given access",
          paragraphs: [
            `${emailStrong(actor)} has shared the ${reg.displayName} ${emailStrong(resourceTitle)} with you as a ${emailStrong(args.role)}.`,
            `Use the button below to open it. If prompted, sign in with ${emailStrong(args.principalId)}.`,
          ],
          cta: { label: `Open ${reg.displayName}`, url: notificationUrl },
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
