import type { SettingsSectionsProps } from "@agent-native/toolkit/app/settings";
import { Suspense } from "react";

import { lazyRoute } from "@/components/workspace/lazy-route";

const Settings = lazyRoute(() =>
  import("./settings-sections").then(({ ReferenceSettingsSections }) => ({
    default: ReferenceSettingsSections,
  })),
);

function SettingsPart(props: SettingsSectionsProps) {
  return (
    <Suspense fallback={null}>
      <Settings {...props} />
    </Suspense>
  );
}

export const referenceParts = {
  SettingsSections: SettingsPart,
  Sidebar: lazyRoute(() =>
    import("./sidebar-shell").then(({ sidebarShellParts }) => ({
      default: sidebarShellParts.Sidebar,
    })),
  ),
  AppShell: lazyRoute(() =>
    import("./sidebar-shell").then(({ sidebarShellParts }) => ({
      default: sidebarShellParts.AppShell,
    })),
  ),
};
