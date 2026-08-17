import { z } from "zod";

/**
 * Workspace gateway.
 *
 * A workspace deploy puts one gateway in front of N apps, so these are a
 * *different host* from this app's own URL — not another spelling of it.
 * `deploy/workspace-deploy.ts` sets them on each app it launches.
 *
 * Each field lists the plain and `VITE_` spelling as aliases of one value. The
 * prefix only ever meant "inline this into the browser bundle", which is a
 * delivery question, not a second setting — the shell projection in
 * `server/app-origin-config.ts` answers that now.
 *
 * Length-checked but not `.url()`-validated, for the same reason as `app.url`:
 * a malformed value should fail where it is used, not take every config read
 * in the process down with it.
 */
export const workspaceConfig = z.object({
  gatewayUrl: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["WORKSPACE_GATEWAY_URL", "VITE_WORKSPACE_GATEWAY_URL"],
      doc: "URL of the workspace gateway fronting this app.",
    }),
  oauthOrigin: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["WORKSPACE_OAUTH_ORIGIN", "VITE_WORKSPACE_OAUTH_ORIGIN"],
      doc: "Shared origin workspace apps complete OAuth against.",
    }),
});
