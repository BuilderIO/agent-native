import { AsyncLocalStorage } from "node:async_hooks";

import { resolveAccess, type AccessContext } from "@agent-native/core/sharing";

import { isActiveUploadBinding } from "./content-uploads.js";

/**
 * The Content document binding a request was vouched in through, and the
 * reader Content vouched for (null for a signed-out reader of a public doc).
 */
export interface ContentDocGrant {
  bindingId: string;
  recordingId: string;
  origin: "upload" | "link";
  state: "active" | "trashed";
  viewerEmail: string | null;
}

const grants = new AsyncLocalStorage<ContentDocGrant>();

export function runWithContentDocGrant<T>(
  grant: ContentDocGrant,
  fn: () => T,
): T {
  return grants.run(grant, fn);
}

/**
 * Host access resolver for recordings. Inside a vouched Content request, an
 * active upload binding makes a reader with no access of their own a viewer
 * of that one recording. It never denies and never lowers a role; the
 * identity check keeps a nested request for someone else (a notification
 * recipient, say) from inheriting the reader's grant.
 */
export async function contentDocReaderRole(
  resource: { id?: unknown },
  ctx: AccessContext,
): Promise<"viewer" | undefined> {
  const grant = grants.getStore();
  if (!grant || !isActiveUploadBinding(grant)) return undefined;
  if (resource.id !== grant.recordingId) return undefined;
  const userEmail = ctx.userEmail?.trim().toLowerCase() || null;
  if (userEmail !== grant.viewerEmail) return undefined;
  // A host role replaces the reader's share roles, so a reader who can
  // already open the Clip (an editor, say) must not be handed `viewer`.
  const own = await grants.exit(() =>
    resolveAccess("recording", grant.recordingId, ctx),
  );
  return own ? undefined : "viewer";
}
