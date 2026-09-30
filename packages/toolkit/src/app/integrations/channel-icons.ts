import type { IntegrationIconKey } from "@agent-native/core/integrations/catalog";
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
