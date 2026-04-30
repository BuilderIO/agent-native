/**
 * Onboarding integration for the secrets registry.
 *
 * When a secret is registered with `required: true`, we inject an onboarding
 * step so the sidebar checklist nudges the user to configure it. The step's
 * completion resolver consults the live status — either by checking for an
 * env var, by looking at oauth-tokens, or by reading `app_secrets`.
 */

import { registerOnboardingStep } from "../onboarding/registry.js";
import type {
  OnboardingResolveContext,
  OnboardingStep,
} from "../onboarding/types.js";
import {
  hasOAuthTokens,
  listOAuthAccountsByOwner,
} from "../oauth-tokens/store.js";
import { DEV_MODE_USER_EMAIL } from "../server/auth.js";
import type { RegisteredSecret } from "./register.js";
import { readAppSecretMeta } from "./storage.js";

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
    isComplete: async (context?: OnboardingResolveContext) => {
      const userEmail = context?.userEmail;
      if (!userEmail) return false;

      if (secret.kind === "oauth" && secret.oauthProvider) {
        try {
          // hasOAuthTokens now requires an owner — pass the dev sentinel for
          // local-dev's "any row exists" wildcard, otherwise the user email
          // so onboarding only marks the step complete for the user who
          // actually connected.
          if (userEmail === DEV_MODE_USER_EMAIL) {
            return await hasOAuthTokens(
              secret.oauthProvider,
              DEV_MODE_USER_EMAIL,
            );
          }
          const accounts = await listOAuthAccountsByOwner(
            secret.oauthProvider,
            userEmail,
          );
          return accounts.length > 0;
        } catch {
          return false;
        }
      }

      try {
        const scopeId =
          secret.scope === "workspace"
            ? (context?.orgId ?? `solo:${userEmail}`)
            : userEmail;
        const meta = await readAppSecretMeta({
          key: secret.key,
          scope: secret.scope,
          scopeId,
        });
        return !!meta;
      } catch {
        return false;
      }
    },
  };

  registerOnboardingStep(step);
}
