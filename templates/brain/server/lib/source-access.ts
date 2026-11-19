import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  accessFilter,
  currentAccess,
  ForbiddenError,
  type AccessContext,
  type ShareableResourceRegistration,
} from "@agent-native/core/sharing";
import { and, eq, ne, or, sql } from "drizzle-orm";

import {
  GOOGLE_SOURCE_PROVIDERS,
  isGoogleSourceProvider,
} from "../../shared/google-source-config.js";
import { getDb, schema } from "../db/index.js";

export function personalGoogleSourceFilter(ctx?: AccessContext) {
  const email = (ctx ? ctx.userEmail : getRequestUserEmail())
    ?.trim()
    .toLowerCase();
  return or(
    and(
      ...GOOGLE_SOURCE_PROVIDERS.map((provider) =>
        ne(schema.brainSources.provider, provider),
      ),
    ),
    email
      ? sql`lower(${schema.brainSources.ownerEmail}) = ${email}`
      : sql`false`,
  );
}

async function persistedSource(resource: unknown, ctx: AccessContext) {
  if (
    !resource ||
    typeof resource !== "object" ||
    !("id" in resource) ||
    typeof resource.id !== "string"
  )
    return undefined;
  const rows = await getDb()
    .select({
      id: schema.brainSources.id,
      provider: schema.brainSources.provider,
      ownerEmail: schema.brainSources.ownerEmail,
    })
    .from(schema.brainSources)
    .where(
      and(
        eq(schema.brainSources.id, resource.id),
        accessFilter(schema.brainSources, schema.brainSourceShares, ctx),
      ),
    )
    .limit(1);
  return rows.find((row) => row.id === resource.id);
}

export async function resolvePersonalSourceAccess(
  resource: unknown,
  ctx: AccessContext,
): Promise<null | undefined> {
  const row = await persistedSource(resource, ctx);
  if (!row || !isGoogleSourceProvider(row.provider)) return undefined;
  return ctx.userEmail?.trim().toLowerCase() ===
    row.ownerEmail.trim().toLowerCase()
    ? undefined
    : null;
}

export const assertSourceSharingChange: NonNullable<
  ShareableResourceRegistration["assertSharingChange"]
> = async ({ resource, change }) => {
  const row = await persistedSource(resource, currentAccess());
  if (!row) throw new ForbiddenError("Source is unavailable.");
  if (!isGoogleSourceProvider(row.provider)) return;
  if (change.kind === "visibility" && change.visibility === "private") return;
  throw new ForbiddenError(
    "Personal connected sources must remain private to their owner.",
  );
};
