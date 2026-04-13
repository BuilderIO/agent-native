/**
 * Google-proxy resolver.
 *
 * Templates use this to decide whether a Gmail/Calendar/People request should
 * hit Google directly (user brought their own OAuth client + has OAuth tokens
 * stored) or tunnel through Builder's `/google/*` proxy (user connected Gmail
 * via Builder's multi-tenant OAuth app).
 *
 * The contract:
 *
 *   const target = await resolveGoogleTarget({ accountEmail, owner });
 *   const res = await fetch(`${target.baseUrl}/gmail/v1/users/me/messages`, {
 *     headers: target.headers,
 *   });
 *
 * In "direct" mode, `target.headers.Authorization = "Bearer <google-access-token>"`.
 * In "builder" mode, the headers carry the Builder private key + the account
 * email, and Builder attaches the Google access token on the server side.
 *
 * Priority order:
 *   1. If a direct access-token provider is given AND returns a token → direct
 *   2. Else if BUILDER_PRIVATE_KEY is set AND the account is marked
 *      "connected via Builder" → builder proxy
 *   3. Else throw FeatureNotConfiguredError with the Builder connect URL
 */
import {
  FeatureNotConfiguredError,
  getBuilderAuthHeader,
  getBuilderProxyOrigin,
  hasBuilderPrivateKey,
} from "./credential-provider.js";
import { getSetting } from "../settings/store.js";

export interface GoogleTarget {
  /** `https://gmail.googleapis.com` or `https://<builder-proxy>/google` */
  baseUrl: string;
  /** Headers to attach to every request */
  headers: Record<string, string>;
  /** Which path this is taking, for diagnostics / feature flags. */
  mode: "direct" | "builder";
}

export interface ResolveGoogleTargetOptions {
  /** Gmail account email ("alice@gmail.com"). Required for builder mode. */
  accountEmail: string;
  /** Session owner email (scoping key for oauth_tokens lookups). */
  owner?: string;
  /**
   * Callback that returns a valid direct Google access token for this account,
   * refreshing if needed. If present and returns a token, direct mode wins.
   * Pass `null` when the user hasn't connected Google directly.
   */
  getDirectAccessToken?: () => Promise<string | null>;
}

export async function resolveGoogleTarget(
  opts: ResolveGoogleTargetOptions,
): Promise<GoogleTarget> {
  // 1) Direct path — user brought their own GOOGLE_CLIENT_ID/SECRET and has
  //    stored oauth_tokens for this account.
  if (opts.getDirectAccessToken) {
    try {
      const token = await opts.getDirectAccessToken();
      if (token) {
        return {
          baseUrl: "https://gmail.googleapis.com",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          mode: "direct",
        };
      }
    } catch {
      // Fall through to builder mode on any failure resolving the direct token.
    }
  }

  // 2) Builder proxy path — the user connected Google via Builder
  //    (cli-auth?host=...&scope=google) and we have the account recorded.
  if (hasBuilderPrivateKey()) {
    const connected = await isAccountConnectedViaBuilder(opts.accountEmail);
    const auth = getBuilderAuthHeader();
    if (connected && auth) {
      return {
        baseUrl: `${getBuilderProxyOrigin()}/google`,
        headers: {
          Authorization: auth,
          "X-Google-Account": opts.accountEmail,
        },
        mode: "builder",
      };
    }
  }

  // 3) Nothing configured — let the UI render a CTA.
  throw new FeatureNotConfiguredError({
    requiredCredential: "google",
    message:
      "No Google connection for this account. Connect Gmail via Builder or set up a Google OAuth client.",
    builderConnectUrl: "/_agent-native/builder/google/connect",
    byokDocsUrl: "https://agent-native.com/docs/mail#google-oauth",
  });
}

/**
 * Track which Google accounts this workspace has connected via Builder.
 * Stored in the shared `settings` table under a single key so every app in
 * the workspace sees the same list (the `bpk-*` resolves to the same
 * ownerId regardless of which sibling app initiated the connect).
 */
const BUILDER_GOOGLE_ACCOUNTS_KEY = "builder-google-accounts";

interface BuilderGoogleAccounts {
  accounts: Array<{
    email: string;
    connectedAt: string;
    /** Space-separated scope set captured at consent time. */
    scope?: string;
  }>;
}

export async function listBuilderGoogleAccounts(): Promise<
  BuilderGoogleAccounts["accounts"]
> {
  const record = (await getSetting(BUILDER_GOOGLE_ACCOUNTS_KEY)) as unknown as
    | BuilderGoogleAccounts
    | null
    | undefined;
  return record?.accounts ?? [];
}

export async function isAccountConnectedViaBuilder(
  accountEmail: string,
): Promise<boolean> {
  const accounts = await listBuilderGoogleAccounts();
  return accounts.some(
    (a) => a.email.toLowerCase() === accountEmail.toLowerCase(),
  );
}

export async function recordBuilderGoogleAccount(account: {
  email: string;
  scope?: string;
}): Promise<void> {
  const { putSetting } = await import("../settings/store.js");
  const existing = await listBuilderGoogleAccounts();
  const filtered = existing.filter(
    (a) => a.email.toLowerCase() !== account.email.toLowerCase(),
  );
  filtered.push({
    email: account.email,
    connectedAt: new Date().toISOString(),
    scope: account.scope,
  });
  await putSetting(BUILDER_GOOGLE_ACCOUNTS_KEY, { accounts: filtered });
}

export async function forgetBuilderGoogleAccount(
  accountEmail: string,
): Promise<void> {
  const { putSetting } = await import("../settings/store.js");
  const existing = await listBuilderGoogleAccounts();
  const filtered = existing.filter(
    (a) => a.email.toLowerCase() !== accountEmail.toLowerCase(),
  );
  await putSetting(BUILDER_GOOGLE_ACCOUNTS_KEY, { accounts: filtered });
}
