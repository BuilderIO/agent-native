/**
 * Onboarding integration for the secrets registry.
 *
 * When a secret is registered with `required: true`, we inject an onboarding
 * step so the sidebar checklist nudges the user to configure it. The step's
 * completion resolver consults the live status — either by checking for an
 * env var, by looking at oauth-tokens, or by reading `app_secrets`.
 */

import { registerOnboardingStep } from "../onboarding/registry.js";
import type { OnboardingStep } from "../onboarding/types.js";
import { hasOAuthTokens } from "../oauth-tokens/store.js";
import { getDbExec } from "../db/client.js";
import type { RegisteredSecret } from "./register.js";

/**
 * If the secret is marked `required`, register a matching onboarding step.
 * Called by `registerRequiredSecret()`. No-op for non-required secrets.
 *
 * Step `order` sits at 60 by default so framework steps (10/20/30/40) stay
 * at the top; the caller can bump this by re-registering the step.
 */
export function maybeRegisterSecretOnboardingStep(
  secret: RegisteredSecret,
): void {
  if (!secret.required) return;

  const step: OnboardingStep = {
    id: `secret:${secret.key}`,
    order: 60,
    required: true,
    title: secret.label,
    description:
      secret.description ??
      `Set up "${secret.key}" to finish configuring the app.`,
    methods: [
      secret.kind === "oauth"
        ? {
            id: "connect",
            kind: "link",
            primary: true,
            label: `Connect ${secret.label}`,
            description: "Opens the OAuth flow.",
            payload: {
              url: secret.oauthConnectUrl ?? "#open-secrets-settings",
              external: false,
            },
          }
        : {
            id: "open-settings",
            kind: "link",
            primary: true,
            label: `Open ${secret.label} settings`,
            description:
              "Paste the key in the sidebar's API Keys & Connections section.",
            payload: {
              // Fragment handled by the sidebar — expands the Secrets section
              // and focuses the matching input.
              url: `#secrets:${secret.key}`,
              external: false,
            },
          },
    ],
    isComplete: async () => {
      // Env var satisfies the step — lets ops teams set keys via deploy
      // configuration without round-tripping the sidebar UI.
      if (process.env[secret.key]) return true;
      if (secret.kind === "oauth" && secret.oauthProvider) {
        try {
          return await hasOAuthTokens(secret.oauthProvider);
        } catch {
          return false;
        }
      }
      // api-key: check app_secrets for *any* row matching the key. We don't
      // try to resolve scope here — onboarding runs per-request elsewhere, so
      // "any configured user" counts as configured for the banner.
      try {
        const exec = getDbExec();
        const { rows } = await exec.execute({
          sql: `SELECT 1 FROM app_secrets WHERE key = ? LIMIT 1`,
          args: [secret.key],
        });
        return rows.length > 0;
      } catch {
        return false;
      }
    },
  };

  registerOnboardingStep(step);
}
