/**
 * Server-side helper for completing video conferencing OAuth callbacks.
 *
 * Templates mount this under `/_agent-native/oauth/<kind>/callback.get.ts`
 * and forward the h3 event. The helper:
 *   1. Looks up the video provider by kind
 *   2. Allocates a `scheduling_credentials` row (so `credentialId` is stable)
 *   3. Calls the provider's `completeOAuth` (tokens get persisted via the
 *      provider's `updateTokens` callback, typically against core's
 *      `oauth_tokens` table, keyed by `credentialId`)
 *   4. Updates the credential row with display metadata
 *
 * It is intentionally agnostic to the consumer's auth/session plumbing —
 * pass in `userEmail` explicitly.
 */
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "./context.js";
import { getVideoProvider } from "./providers/registry.js";

export interface CompleteVideoOAuthResult {
  credentialId: string;
  kind: string;
  externalEmail?: string;
  externalAccountId: string;
  displayName?: string;
}

/**
 * Complete a video-provider OAuth callback. Throws on any failure so the
 * caller can decide how to render the error (HTML page, JSON, redirect).
 */
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

  // Insert row up-front so `updateTokens(credentialId, ...)` inside
  // completeOAuth has a stable key to write against.
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
    // Roll back the credentials row on failure.
    await getDb()
      .delete(schema.schedulingCredentials)
      .where(eq(schema.schedulingCredentials.id, credentialId));
    throw err;
  }

  // Update the credential row with external identity metadata.
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
