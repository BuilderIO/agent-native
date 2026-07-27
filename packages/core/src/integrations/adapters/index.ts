import type { PlatformAdapter } from "../types.js";
import { discordAdapter } from "./discord.js";
import { emailAdapter } from "./email.js";
import { microsoftTeamsAdapter } from "./microsoft-teams.js";
import { slackAdapter } from "./slack.js";
import { telegramAdapter } from "./telegram.js";
import { whatsappAdapter } from "./whatsapp.js";

/** Create the built-in adapter for proactive delivery outside a webhook run. */
export function getDefaultAdapter(
  platform: string,
): PlatformAdapter | undefined {
  switch (platform) {
    case "slack":
      return slackAdapter();
    case "telegram":
      return telegramAdapter();
    case "whatsapp":
      return whatsappAdapter();
    case "discord":
      return discordAdapter();
    case "microsoft-teams":
      return microsoftTeamsAdapter();
    case "email":
      return emailAdapter();
    default:
      return undefined;
  }
}
