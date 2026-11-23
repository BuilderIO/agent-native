import type { ShellModel } from "@agent-native/toolkit/app-shell/sidebar-shell";

import { useHomeShellModel } from "./shell";

export const navigationJourneyFixtures = [
  {
    name: "advertised-targets",
    menu: "more" as const,
    setupPageRegistered: true,
  },
  { name: "context-page-unavailable", setupPageRegistered: false },
] as const;

export function useNavigationJourneyModel(
  fixture: (typeof navigationJourneyFixtures)[number],
): ShellModel {
  const model = useHomeShellModel(fixture);
  return {
    ...model,
    navigation: {
      ...model.navigation,
      entries: model.navigation.entries.map((entry) =>
        entry.id === "sidebar.nav.context"
          ? { ...entry, visible: fixture.setupPageRegistered }
          : entry,
      ),
    },
  };
}
