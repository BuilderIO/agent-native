import type { ChatFirstAppIconRenderOptions } from "./types.js";

export type ChatFirstPrimaryTab =
  | "new-chat"
  | "integrations"
  | "scheduled"
  | "search";

/**
 * The one rail entry that owns the active presentation. `undefined` means the
 * host has not resolved a surface yet, which must stay distinguishable from a
 * nav surface owning the rail while no app is selected.
 */
export type ChatFirstActiveSurface =
  | { kind: "app"; appId: string }
  | { kind: "nav"; tab: ChatFirstPrimaryTab };

export function chatFirstActiveSurface({
  activeAppId,
  activeTab,
}: {
  activeAppId?: string;
  activeTab?: ChatFirstPrimaryTab;
}): ChatFirstActiveSurface | undefined {
  if (activeTab !== undefined) return { kind: "nav", tab: activeTab };
  if (activeAppId !== undefined) return { kind: "app", appId: activeAppId };
  return undefined;
}

export function chatFirstAppIconState(
  surface: ChatFirstActiveSurface | undefined,
  appId: string,
): ChatFirstAppIconRenderOptions {
  if (!surface) return { isActive: false, isInactive: false };
  const isActive = surface.kind === "app" && surface.appId === appId;
  return { isActive, isInactive: !isActive };
}

export function chatFirstNavTabActive(
  surface: ChatFirstActiveSurface | undefined,
  tab: ChatFirstPrimaryTab,
): boolean {
  return surface?.kind === "nav" && surface.tab === tab;
}
