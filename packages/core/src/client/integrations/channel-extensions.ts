import { useSyncExternalStore, type ComponentType } from "react";

import type { SettingsPageContext } from "../settings/shell/registry.js";

export interface ChannelSettingsExtensionProps {
  /** The channel's catalog id, for example `slack`. */
  platform: string;
  context: SettingsPageContext;
}

/**
 * An app's own settings for one channel, shown on that channel's page in
 * Settings › Channels above the agent's own connection. Clips uses one for
 * Slack link previews. The component renders its own groups and enforces its
 * own roles through its actions.
 */
export interface ChannelSettingsExtension {
  /** Unique within the platform. Registering the same id again replaces it. */
  id: string;
  /** The channel's catalog id, for example `slack`. */
  platform: string;
  /** Lower sorts first. Defaults to 0. */
  order?: number;
  component: ComponentType<ChannelSettingsExtensionProps>;
}

let extensions: readonly ChannelSettingsExtension[] = [];
const listeners = new Set<() => void>();
const byPlatform = new Map<string, readonly ChannelSettingsExtension[]>();
const EMPTY: readonly ChannelSettingsExtension[] = [];

function sameSlot(a: ChannelSettingsExtension, b: ChannelSettingsExtension) {
  return a.platform === b.platform && a.id === b.id;
}

function publish(next: readonly ChannelSettingsExtension[]) {
  extensions = next;
  byPlatform.clear();
  for (const listener of listeners) listener();
}

/**
 * Add channel settings for this app. Call it at module scope next to the
 * app's settings route. Returns a function that removes what it added.
 */
export function registerChannelSettingsExtensions(
  additions: readonly ChannelSettingsExtension[],
): () => void {
  publish([
    ...extensions.filter(
      (existing) => !additions.some((added) => sameSlot(existing, added)),
    ),
    ...additions,
  ]);
  return () => {
    publish(extensions.filter((existing) => !additions.includes(existing)));
  };
}

export function getChannelSettingsExtensions(
  platform: string,
): readonly ChannelSettingsExtension[] {
  const cached = byPlatform.get(platform);
  if (cached) return cached;
  const matching = extensions
    .filter((extension) => extension.platform === platform)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const result = matching.length ? matching : EMPTY;
  byPlatform.set(platform, result);
  return result;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChannelSettingsExtensions(
  platform: string,
): readonly ChannelSettingsExtension[] {
  return useSyncExternalStore(
    subscribe,
    () => getChannelSettingsExtensions(platform),
    () => getChannelSettingsExtensions(platform),
  );
}
