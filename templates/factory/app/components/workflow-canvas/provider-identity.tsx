import {
  IconBrandGithub,
  IconBrandGoogleBigQuery,
  IconBrandJira,
  IconBrandNotion,
  IconBrandSentry,
  IconBrandSlack,
  IconBrandStripe,
  IconMail,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * Tile classes per hue, written out in full so Tailwind generates them. Each
 * key needs a `--provider-<key>` token in `app/global.css`.
 */
const HUE_TILE = {
  slack: "bg-provider-slack/15 text-provider-slack",
  github: "bg-provider-github/15 text-provider-github",
  hubspot: "bg-provider-hubspot/15 text-provider-hubspot",
  pylon: "bg-provider-pylon/15 text-provider-pylon",
  stripe: "bg-provider-stripe/15 text-provider-stripe",
  posthog: "bg-provider-posthog/15 text-provider-posthog",
  bigquery: "bg-provider-bigquery/15 text-provider-bigquery",
  notion: "bg-provider-notion/15 text-provider-notion",
  jira: "bg-provider-jira/15 text-provider-jira",
  gong: "bg-provider-gong/15 text-provider-gong",
  sentry: "bg-provider-sentry/15 text-provider-sentry",
  email: "bg-provider-email/15 text-provider-email",
  builder: "bg-provider-builder/15 text-provider-builder",
  factory: "bg-provider-factory/15 text-provider-factory",
} as const;

type ProviderHue = keyof typeof HUE_TILE;

interface ProviderIdentity {
  /** Display name. Integration names are data, not translated copy. */
  label: string;
  /** Shown in the tile when the integration has no brand icon. */
  letter: string;
  /** A key of `HUE_TILE`, or null for the neutral tile. */
  hue: ProviderHue | null;
  icon: ComponentType<{ className?: string }> | null;
}

interface KnownProvider {
  label: string;
  hue: ProviderHue;
  icon: ComponentType<{ className?: string }> | null;
}

// Tabler has no brand icon for HubSpot, PostHog, Gong, Builder, Pylon or Factory,
// so those show their letter instead.
const KNOWN_PROVIDERS: Record<string, KnownProvider> = {
  slack: { label: "Slack", hue: "slack", icon: IconBrandSlack },
  github: { label: "GitHub", hue: "github", icon: IconBrandGithub },
  hubspot: { label: "HubSpot", hue: "hubspot", icon: null },
  pylon: { label: "Pylon", hue: "pylon", icon: null },
  stripe: { label: "Stripe", hue: "stripe", icon: IconBrandStripe },
  posthog: { label: "PostHog", hue: "posthog", icon: null },
  bigquery: {
    label: "BigQuery",
    hue: "bigquery",
    icon: IconBrandGoogleBigQuery,
  },
  notion: { label: "Notion", hue: "notion", icon: IconBrandNotion },
  jira: { label: "Jira", hue: "jira", icon: IconBrandJira },
  gong: { label: "Gong", hue: "gong", icon: null },
  sentry: { label: "Sentry", hue: "sentry", icon: IconBrandSentry },
  email: { label: "Email", hue: "email", icon: IconMail },
  builder: { label: "Builder", hue: "builder", icon: null },
  factory: { label: "Factory", hue: "factory", icon: null },
};

export function providerIdentity(provider: string): ProviderIdentity {
  const known = KNOWN_PROVIDERS[provider] as KnownProvider | undefined;
  const label =
    known?.label ?? provider.charAt(0).toUpperCase() + provider.slice(1);
  return {
    label,
    letter: label.charAt(0).toUpperCase(),
    hue: known?.hue ?? null,
    icon: known?.icon ?? null,
  };
}

export function ProviderIcon({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  const identity = providerIdentity(provider);
  const Icon = identity.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md",
        identity.hue ? HUE_TILE[identity.hue] : "bg-muted text-foreground",
        className,
      )}
    >
      {Icon ? (
        <Icon className="size-4" />
      ) : (
        <span className="text-sm font-medium">{identity.letter}</span>
      )}
    </span>
  );
}
