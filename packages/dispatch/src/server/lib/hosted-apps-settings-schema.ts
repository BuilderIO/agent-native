import { z } from "zod";

/** Result of the get/set hosted-apps actions. */
export const hostedAppsSettingsViewSchema = z.object({
  showHostedApps: z.boolean(),
});
