import { appApiPath } from "@agent-native/core/client/api-path";

import type { CommunityApp } from "./community-apps";

export async function fetchCommunityApps(): Promise<CommunityApp[]> {
  const response = await fetch(appApiPath("/community-apps"), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Community app catalog returned HTTP ${response.status}.`);
  }
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { apps?: unknown }).apps)
  ) {
    throw new Error("Community app catalog returned invalid JSON.");
  }
  return (body as { apps: CommunityApp[] }).apps;
}
