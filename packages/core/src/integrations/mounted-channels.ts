/**
 * The channel adapters the integrations plugin mounted, and the operations
 * its routes run on them, so the Channels actions reach the same adapters and
 * side effects instead of a second copy. The plugin publishes this at init;
 * an app without the plugin has none, which the actions report as such.
 */

import type { PlatformAdapter } from "./types.js";

export type ChannelWebhookRegistration =
  | { ok: true; webhookUrl: string; result?: unknown }
  | { ok: true; message: string }
  | { ok: false; statusCode: number; error: string };

export interface MountedChannels {
  readonly adapters: readonly PlatformAdapter[];
  /** `{baseUrl}/_agent-native/integrations/{platform}/webhook`. */
  webhookUrl(baseUrl: string, platform: string): string;
  /**
   * Save the on/off switch and start or stop what the platform runs while on
   * (the Google Docs poller). `baseUrl` is the app's public URL, when known.
   */
  setEnabled(
    platform: string,
    enabled: boolean,
    options: { actorEmail?: string; baseUrl?: string },
  ): Promise<void>;
  /**
   * Register the webhook with the provider (Telegram's setWebhook). Reads
   * credentials from the current request context.
   */
  registerWebhook(
    platform: string,
    baseUrl: string,
  ): Promise<ChannelWebhookRegistration>;
}

const MOUNTED_CHANNELS_SYMBOL = Symbol.for(
  "agent-native.integrations.mounted-channels",
);
const globalMountedChannels = globalThis as typeof globalThis & {
  [MOUNTED_CHANNELS_SYMBOL]?: MountedChannels | null;
};

// Dev servers can mount the plugin from one module instance while the action
// registry resolves another, and a module-local value made every action report
// "no channels" while the routes worked. Keep it process-wide, as the
// feature-flag registry does.
export function setMountedChannels(next: MountedChannels | null): void {
  globalMountedChannels[MOUNTED_CHANNELS_SYMBOL] = next;
}

export function getMountedChannels(): MountedChannels | null {
  return globalMountedChannels[MOUNTED_CHANNELS_SYMBOL] ?? null;
}
