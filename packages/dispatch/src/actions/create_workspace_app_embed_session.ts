import { defineAction } from "@agent-native/core";
import { getRequestContext } from "@agent-native/core/server";
import { z } from "zod";

import { listWorkspaceApps } from "../server/lib/app-creation-store.js";
import { createWorkspaceSsoEmbedSession } from "../server/lib/mcp-gateway.js";

function isPathWithinApp(pathname: string, appPath: string): boolean {
  const normalized = appPath.replace(/\/+$/, "") || "/";
  return normalized === "/"
    ? pathname.startsWith("/")
    : pathname === normalized || pathname.startsWith(`${normalized}/`);
}

/**
 * Browser callers must come from the Dispatch parent surface. Native callers
 * carry the parent bearer explicitly; direct in-process action calls have no
 * request headers and are already inside the server authorization boundary.
 */
export async function assertWorkspaceEmbedSessionCaller(
  headers: Headers | undefined,
): Promise<void> {
  if (!headers) return;

  const fetchSite = headers.get("sec-fetch-site")?.trim().toLowerCase();
  // Electron's Chromium fetch adds Sec-Fetch-Site even for the native broker's
  // server request. The custom header is not sendable by a cross-origin page
  // without a successful CORS preflight, so it is the native CSRF marker.
  if (
    fetchSite &&
    fetchSite !== "same-origin" &&
    headers.get("x-agent-native-csrf")?.trim() === "1"
  ) {
    return;
  }
  // Browsers always send Sec-Fetch-Site and page scripts cannot forge or strip
  // this forbidden header. Native clients without fetch metadata authenticate
  // through the normal action request context below.
  if (!fetchSite) return;
  if (fetchSite !== "same-origin") {
    throw new Error("Workspace app sessions must be requested by Dispatch.");
  }

  const referer = headers.get("referer");
  const requestOrigin = getRequestContext()?.requestOrigin;
  if (!referer || !requestOrigin) {
    throw new Error("Workspace app sessions must be requested by Dispatch.");
  }

  let refererUrl: URL;
  try {
    refererUrl = new URL(referer);
  } catch {
    throw new Error("Workspace app sessions must be requested by Dispatch.");
  }
  if (refererUrl.origin !== requestOrigin) {
    throw new Error("Workspace app sessions must be requested by Dispatch.");
  }
  const apps = await listWorkspaceApps({
    includeAgentCards: false,
    audience: "all",
  });
  if (
    apps.some(
      (app) =>
        !app.isDispatch && isPathWithinApp(refererUrl.pathname, app.path),
    )
  ) {
    throw new Error("Workspace apps cannot mint sessions for themselves.");
  }
}

export default defineAction({
  description:
    "Create a one-time app-scoped embed session for a workspace app opened inside Dispatch. This browser-only path is rollout-gated and never exposes an app's reusable session to another app.",
  schema: z.object({
    app: z
      .string()
      .optional()
      .describe("Workspace app id when path is app-relative."),
    url: z
      .string()
      .optional()
      .describe("Absolute app URL or app-relative path."),
    path: z
      .string()
      .optional()
      .describe("App-relative path. Requires app when url is not provided."),
    chrome: z
      .enum(["full", "minimal"])
      .optional()
      .describe("Embed chrome preference. Defaults to full."),
  }),
  readOnly: false,
  parallelSafe: false,
  agentTool: false,
  toolCallable: false,
  run: async (args, context) => {
    await assertWorkspaceEmbedSessionCaller(context?.requestHeaders);
    return createWorkspaceSsoEmbedSession(args);
  },
});
