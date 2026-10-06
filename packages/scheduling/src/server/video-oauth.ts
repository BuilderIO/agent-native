import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getSchedulingContext } from "./context.js";
import { getVideoProvider } from "./providers/registry.js";

export interface CompleteVideoOAuthResult {
  credentialId: string;
  kind: string;
  externalEmail?: string;
  externalAccountId: string;
  displayName?: string;
}

export async function completeVideoOAuth(opts: {
  kind: string;
  userEmail: string;
  code: string;
  redirectUri: string;
}): Promise<CompleteVideoOAuthResult> {
  const { kind, userEmail, code, redirectUri } = opts;
  const provider = getVideoProvider(kind);
  if (!provider) {
    throw new Error(`No video provider registered for ${kind}`);
  }
  if (!provider.completeOAuth) {
    throw new Error(`Video provider ${kind} does not support OAuth`);
  }

  const { getDb, schema } = getSchedulingContext();
  const now = new Date().toISOString();
  const credentialId = nanoid();

  await getDb().insert(schema.schedulingCredentials).values({
    id: credentialId,
    type: kind,
    userEmail,
    appId: kind,
    oauthTokenId: credentialId,
    isDefault: false,
    invalid: false,
    createdAt: now,
    updatedAt: now,
  });

  let result: Awaited<ReturnType<NonNullable<typeof provider.completeOAuth>>>;
  try {
    result = await provider.completeOAuth({
      credentialId,
      userEmail,
      code,
      redirectUri,
    });
  } catch (err) {
    await getDb()
      .delete(schema.schedulingCredentials)
      .where(eq(schema.schedulingCredentials.id, credentialId));
    throw err;
  }

  await getDb()
    .update(schema.schedulingCredentials)
    .set({
      externalEmail: result.externalEmail ?? null,
      displayName: result.displayName ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.schedulingCredentials.id, credentialId));

  return {
    credentialId,
    kind,
    externalEmail: result.externalEmail,
    externalAccountId: result.externalAccountId,
    displayName: result.displayName,
  };
}
