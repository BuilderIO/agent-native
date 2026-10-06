/**
 * Sign-in methods a deployment offers. Shared by the server (which reads the
 * deployment) and the client (which shows it), so this file imports nothing.
 */

export interface OrgSignInMethods {
  /** Email and password sign-in is part of every deployment. */
  emailPassword: true;
  google: boolean;
  github: boolean;
}

export type SocialSignInMethod = "google" | "github";

/** The host environment variables that turn each social sign-in method on. */
export const SIGN_IN_METHOD_ENV_VARS: Readonly<
  Record<SocialSignInMethod, readonly [clientId: string, clientSecret: string]>
> = {
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  github: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
};
