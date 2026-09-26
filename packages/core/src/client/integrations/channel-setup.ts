import {
  IconBrandDiscord,
  IconBrandGoogleDrive,
  IconBrandSlack,
  IconBrandTeams,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconMail,
  IconPlug,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

import {
  listBuiltInChannelIntegrations,
  type IntegrationCatalogEntry,
  type IntegrationIconKey,
} from "../../integrations/catalog.js";

export type ChannelIcon = ComponentType<{
  className?: string;
  size?: number | string;
  stroke?: number | string;
}>;

const CHANNEL_ICONS: Partial<Record<IntegrationIconKey, ChannelIcon>> = {
  slack: IconBrandSlack,
  "microsoft-teams": IconBrandTeams,
  discord: IconBrandDiscord,
  telegram: IconBrandTelegram,
  whatsapp: IconBrandWhatsapp,
  email: IconMail,
  "google-docs": IconBrandGoogleDrive,
};

/** The Tabler icon for a catalog entry's `iconKey`. */
export function channelIcon(iconKey: string): ChannelIcon {
  return CHANNEL_ICONS[iconKey as IntegrationIconKey] ?? IconPlug;
}

/**
 * The order Settings › Channels lists channels in (spec §5.19): the ones most
 * apps use first, then the rest in catalog order.
 */
const CHANNEL_DISPLAY_ORDER: readonly string[] = [
  "slack",
  "google-docs",
  "telegram",
  "whatsapp",
  "discord",
  "microsoft-teams",
  "email",
];

export function listChannelsForSettings(): readonly IntegrationCatalogEntry[] {
  const rank = (id: string) => {
    const index = CHANNEL_DISPLAY_ORDER.indexOf(id);
    return index === -1 ? CHANNEL_DISPLAY_ORDER.length : index;
  };
  return [...listBuiltInChannelIntegrations()].sort(
    (a, b) => rank(a.id) - rank(b.id),
  );
}

/** One credential a channel needs, from the adapter or the catalog. */
export interface ChannelCredential {
  key: string;
  required: boolean;
  /** At least one key in a group must be set (Resend or SendGrid). */
  alternativeGroup?: string;
}

/**
 * True when a required credential, or every credential of a required
 * alternative group, is not configured. `isConfigured` answers for one key.
 */
export function hasMissingRequiredCredentials(
  credentials: readonly ChannelCredential[],
  isConfigured: (key: string) => boolean,
): boolean {
  const alternatives = new Map<string, ChannelCredential[]>();
  for (const credential of credentials) {
    if (!credential.required) continue;
    if (!credential.alternativeGroup) {
      if (!isConfigured(credential.key)) return true;
      continue;
    }
    const group = alternatives.get(credential.alternativeGroup) ?? [];
    group.push(credential);
    alternatives.set(credential.alternativeGroup, group);
  }
  return [...alternatives.values()].some((group) =>
    group.every((credential) => !isConfigured(credential.key)),
  );
}

export type ChannelConnectionState = "on" | "off" | "not-set-up";

/**
 * A channel is on only when it is both enabled and configured: an enabled row
 * whose credentials were removed receives nothing.
 */
export function channelConnectionState(status: {
  configured: boolean;
  enabled: boolean;
}): ChannelConnectionState {
  if (!status.configured) return "not-set-up";
  return status.enabled ? "on" : "off";
}
