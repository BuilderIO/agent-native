import { isPrivateBlobConfiguredForRequest } from "@agent-native/core/private-blob";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { createError, defineEventHandler, setResponseHeader } from "h3";

/**
 * Whether the caller's workspace has private storage to keep images in, so
 * the comment box can say so before anyone picks one.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const session = await getSession(event);
  if (!session?.email)
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  return runWithRequestContext(
    {
      userEmail: session.email,
      ...(session.orgId ? { orgId: session.orgId } : {}),
    },
    async () => ({ configured: await isPrivateBlobConfiguredForRequest() }),
  );
});
