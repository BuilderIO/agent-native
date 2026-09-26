
import { listOAuthAccountsByOwner } from "../oauth-tokens/store.js";
import { registerOnboardingStep } from "../onboarding/registry.js";
import type {
  OnboardingResolveContext,
  OnboardingStep,
} from "../onboarding/types.js";
import type { RegisteredSecret } from "./register.js";
import { readAppSecretMeta } from "./storage.js";

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
            description: "Paste the key in Settings → Integrations → API keys.",
            payload: {
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
