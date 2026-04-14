/**
 * Credential provider abstraction.
 *
 * Every feature that needs an external credential (Anthropic API key,
 * Google OAuth tokens, OpenAI key, Slack bot token, etc.) should go through
 * one of the resolve*() helpers here instead of reading `process.env`
 * directly. That way the same feature can work in three modes:
 *
 *   1. User set their own key in .env              → use it directly
 *   2. User connected Builder via `/cli-auth`      → route through Builder proxy
 *   3. Neither                                      → throw FeatureNotConfigured
 *
 * Templates catch FeatureNotConfigured and show a "Connect Builder (1 click) /
 * set up your own key (guide)" card.
 *
 * Today these helpers are used by the Builder-hosted LLM gateway, and the
 * shape is meant to grow to cover future managed credential integrations
 * (e.g. additional Builder-hosted services) without rewrites.
 */

export class FeatureNotConfiguredError extends Error {
  readonly requiredCredential: string;
  readonly builderConnectUrl?: string;
  readonly byokDocsUrl?: string;

  constructor(opts: {
    requiredCredential: string;
    message?: string;
    builderConnectUrl?: string;
    byokDocsUrl?: string;
  }) {
    super(
      opts.message ??
        `Feature requires credential "${opts.requiredCredential}". Connect Builder or set your own key.`,
    );
    this.name = "FeatureNotConfiguredError";
    this.requiredCredential = opts.requiredCredential;
    this.builderConnectUrl = opts.builderConnectUrl;
    this.byokDocsUrl = opts.byokDocsUrl;
  }
}

/** True when a Builder private key is configured in this environment. */
export function hasBuilderPrivateKey(): boolean {
  return !!process.env.BUILDER_PRIVATE_KEY;
}

/** The origin for Builder-proxied API calls. Overridable for testing. */
export function getBuilderProxyOrigin(): string {
  return (
    process.env.BUILDER_PROXY_ORIGIN ||
    process.env.AIR_HOST ||
    process.env.BUILDER_API_HOST ||
    "https://ai-services.builder.io"
  );
}

/** Authorization header value for Builder-proxied calls. */
export function getBuilderAuthHeader(): string | null {
  const key = process.env.BUILDER_PRIVATE_KEY;
  return key ? `Bearer ${key}` : null;
}
