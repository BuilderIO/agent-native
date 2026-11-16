import type { ReactNode } from "react";

import type { ConnectedAppSummary } from "../lib/other-apps";
import {
  tierWorkspaceApps,
  useWorkspaceAppLayout,
} from "../lib/workspace-app-layout";
import type { WorkspaceAppSummary } from "../lib/workspace-apps";
import { AppList } from "./app-list-row";
import { AppTierSections } from "./app-tier-sections";
import { ConnectedAppCard } from "./connected-app-card";
import { WorkspaceAppCard } from "./workspace-app-card";

type AppCardEntry =
  | { id: string; name: string; source?: undefined; app: WorkspaceAppSummary }
  | {
      id: string;
      name: string;
      source: "builtin";
      hosted: ConnectedAppSummary;
    };

/** Home and All apps: workspace app cards and hosted app cards, tiered. */
export function AppCardTiers({
  workspaceApps,
  hostedApps,
  appsTitle,
  actions,
  hasPinnedApps,
  appsFallback,
}: {
  workspaceApps: readonly WorkspaceAppSummary[];
  hostedApps: readonly ConnectedAppSummary[];
  appsTitle: string;
  actions?: ReactNode;
  hasPinnedApps?: boolean;
  appsFallback?: ReactNode;
}) {
  const { layout, togglePinned } = useWorkspaceAppLayout();
  const tiers = tierWorkspaceApps<AppCardEntry>(
    [
      ...workspaceApps.map((app) => ({ id: app.id, name: app.name, app })),
      ...hostedApps.map((hosted) => ({
        id: hosted.id,
        name: hosted.name,
        source: "builtin" as const,
        hosted,
      })),
    ],
    layout,
  );
  const isPinned = (id: string) =>
    layout.pinnedIds.includes(id.trim().toLowerCase());

  return (
    <AppTierSections
      tiers={tiers}
      appsTitle={appsTitle}
      actions={actions}
      hasPinnedApps={hasPinnedApps}
      appsFallback={appsFallback}
      renderItems={(entries) => (
        <AppList layout="grid">
          {entries.map((entry) =>
            "app" in entry ? (
              <WorkspaceAppCard
                key={entry.id}
                app={entry.app}
                isPinned={isPinned(entry.id)}
                onTogglePinned={() => togglePinned(entry.id)}
              />
            ) : (
              <ConnectedAppCard
                key={entry.id}
                app={entry.hosted}
                isPinned={isPinned(entry.id)}
                onTogglePinned={() => togglePinned(entry.id)}
              />
            ),
          )}
        </AppList>
      )}
    />
  );
}
