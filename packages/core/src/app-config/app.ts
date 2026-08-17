import { z } from "zod";

/**
 * App identity.
 *
 * Three fields, not one, because the eight environment keys that spell "which
 * app is this" were never all the same question:
 *
 * - `id` is this deployment's own identity — data programs, onboarding, the
 *   CLI, and agent model defaults scope by it.
 * - `workspaceId` is the identity a workspace deploy assigns. `vault_grants`
 *   rows are written with it, so credential scoping must prefer it over `id`
 *   or an app would look up grants under a name nobody granted.
 * - `name` is the user-facing display name ("Acme"), used in transactional
 *   emails and page titles. It is not an identifier, and only leaks into
 *   identity resolution as a last-resort fallback in readers that had nothing
 *   better.
 *
 * Collapsing these into one field is the tempting simplification and it is
 * wrong: it would silently repoint credential grant lookups.
 *
 * None of them has a default. `credentialProvider` denies access when no app
 * identity is configured, and a default of `"app"` would turn that denial into
 * a lookup scoped to an app literally named `app`. Readers that want a
 * placeholder apply it themselves, where it is visible.
 */
export const appConfig = z.object({
  id: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_NATIVE_APP_ID", "APP_ID"],
      doc: "Stable identity of this app deployment.",
    }),
  workspaceId: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: [
        "AGENT_NATIVE_WORKSPACE_APP_ID",
        "VITE_AGENT_NATIVE_WORKSPACE_APP_ID",
      ],
      doc: "Identity assigned by a workspace deploy. Credential grants are scoped to this.",
    }),
  name: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["APP_NAME"],
      doc: "User-facing display name of this app.",
    }),
  /**
   * The app's canonical public URL — what a user sees in a share link, an
   * email, or a JWT issuer claim.
   *
   * This is NOT "where does this running deployment answer". On a deploy
   * preview those differ, and conflating them is what sent background work to
   * production from a preview twice. Self-address is derived by
   * `resolveSelfDispatchBaseUrl()`, which consults the platform's own deploy
   * URLs first and falls back to this; it is deliberately not settable here.
   *
   * Not `.url()`-validated on purpose. This value is read by self-dispatch,
   * SSR, and OAuth, so a malformed one would make every `getAppConfig()` call
   * in the process throw rather than fail in the one place that cares.
   * Consumers that need a parseable URL validate it themselves and say what
   * broke — `onboarding-html.ts` already reports "invalid app URL" with the
   * feature named, which is a better error than a zod path.
   */
  url: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: [
        "APP_URL",
        "VITE_APP_URL",
        "BETTER_AUTH_URL",
        "VITE_BETTER_AUTH_URL",
      ],
      doc: "Canonical public URL of this app, used for user-facing links.",
    }),
  packageName: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["npm_package_name"],
      doc: "Package name of the running app, as npm sets it for a script.",
    }),
  template: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["VITE_AGENT_NATIVE_TEMPLATE"],
      doc: "First-party template this app was generated from.",
    }),
});
