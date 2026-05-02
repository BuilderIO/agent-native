/**
 * Workspace-wide auth plugin for @{{APP_NAME}}/shared.
 *
 * Today this just re-uses the framework default, which already does the
 * right thing for most enterprises (Better Auth with Google SSO when
 * GOOGLE_CLIENT_ID/SECRET are set, email/password otherwise, local dev
 * bypass via AUTH_MODE=local). Customize it here when your enterprise
 * needs specific behavior — e.g.:
 *
 *   - Wrap the default to force a specific SSO provider
 *   - Add a callback that provisions users into your directory
 *   - Pre-register organizations / role mappings from Okta groups
 *   - Fail closed on unauthenticated requests outside dev
 *
 * Every app in the workspace inherits this automatically (as long as the
 * root package.json has `"agent-native": { "workspaceCore": "@{{APP_NAME}}/shared" }`).
 */
import { defaultAuthPlugin } from "@agent-native/core/server";

export const authPlugin = async (nitroApp: any): Promise<void> => {
  // Run the framework default first so Better Auth, org tables, and session
  // middleware are all set up.
  await defaultAuthPlugin(nitroApp);

  // Add enterprise-specific post-auth behavior here. Examples:
  //
  //   const h3 = getH3App(nitroApp);
  //   h3.use(defineEventHandler(async (event) => {
  //     const session = await getSession(event);
  //     if (session?.email && !session.email.endsWith("@{{APP_NAME}}.com")) {
  //       setResponseStatus(event, 403);
  //       return { error: "Only @{{APP_NAME}}.com accounts allowed" };
  //     }
  //   }));
};
