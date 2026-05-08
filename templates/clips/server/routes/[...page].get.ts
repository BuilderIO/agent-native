import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
import {
  defineEventHandler,
  getRequestURL,
  setResponseHeader,
  type H3Event,
} from "h3";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  MEDIA_CAPTURE_PERMISSIONS_POLICY,
  withMediaCapturePermissions,
} from "../lib/media-permissions.js";

const ssrHandler = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

function recordingIdFromAuthenticatedPath(pathname: string): string | null {
  const match = pathname.match(/^\/r\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function shareRedirect(recordingId: string, search: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: `/share/${encodeURIComponent(recordingId)}${search}`,
      "Permissions-Policy": MEDIA_CAPTURE_PERMISSIONS_POLICY,
    },
  });
}

async function redirectNonOwnerRecordingPath(
  event: H3Event,
): Promise<Response | null> {
  const url = getRequestURL(event);
  const recordingId = recordingIdFromAuthenticatedPath(url.pathname);
  if (!recordingId) return null;

  const session = await getSession(event).catch(() => null);
  if (!session?.email) return shareRedirect(recordingId, url.search);

  try {
    const access = await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      () => resolveAccess("recording", recordingId),
    );
    if (access.role === "owner") return null;
  } catch {
    // Treat missing/inaccessible recordings the same as non-owner access here;
    // the share route can render the canonical public/not-found state.
  }

  return shareRedirect(recordingId, url.search);
}

export default defineEventHandler(async (event) => {
  const redirect = await redirectNonOwnerRecordingPath(event);
  if (redirect) return redirect;

  const response = (await ssrHandler(event)) as Response;
  setResponseHeader(
    event,
    "Permissions-Policy",
    MEDIA_CAPTURE_PERMISSIONS_POLICY,
  );
  return withMediaCapturePermissions(response);
});
