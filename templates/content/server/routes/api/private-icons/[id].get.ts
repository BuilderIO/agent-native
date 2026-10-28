import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { createError, defineEventHandler, setResponseHeader } from "h3";

import {
  assertPrivateIconId,
  ownsPrivateIcon,
  readPrivateIcon,
} from "../../../lib/private-icon-authority.js";
import { resolveReadablePrivateIcon } from "../../../lib/private-icon-references.js";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const id = event.context.params?.id ?? "";
  try {
    assertPrivateIconId(id);
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Icon not found" });
  }
  const session = await getSession(event);
  return runWithRequestContext(
    { userEmail: session?.email, orgId: session?.orgId },
    async () => {
      let reference = await resolveReadablePrivateIcon(id, {
        userEmail: session?.email,
        orgId: session?.orgId,
      });
      if (!reference && session?.email) {
        const scopes = [session.orgId ?? null];
        if (session.orgId) scopes.push(null);
        for (const orgId of scopes) {
          if (
            await ownsPrivateIcon({
              assetId: id,
              ownerEmail: session.email,
              orgId,
            })
          ) {
            reference = { orgId };
            break;
          }
        }
      }
      if (!reference)
        throw createError({ statusCode: 404, statusMessage: "Icon not found" });
      const icon = await readPrivateIcon({
        assetId: id,
        orgId: reference.orgId,
      });
      if (!icon)
        throw createError({ statusCode: 404, statusMessage: "Icon not found" });
      setResponseHeader(event, "Content-Type", icon.mimeType);
      if (icon.mimeType === "image/svg+xml")
        setResponseHeader(event, "Content-Security-Policy", "sandbox");
      return Buffer.from(icon.data);
    },
  );
});
