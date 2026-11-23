import {
  useNavigationOpener,
  type NavigationEntry,
  type ShellModel,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

import { useHomeShellModel, type HomeShellFixture } from "./shell";

export const bootFixtures = [
  null,
  "light",
  "dark",
  "system",
  "auto",
  "malformed",
  "0",
  "1",
  "true",
  "false",
].flatMap((stored) =>
  [false, true].flatMap((systemDark) =>
    [1280, 1050].map((viewport) => ({
      name: `boot-theme-${stored ?? "absent"}-${systemDark ? "dark" : "light"}-${viewport}`,
      stored,
      systemDark,
      viewport,
    })),
  ),
);

export function useWorkspaceJourneyModel(
  fixture: HomeShellFixture = { name: "desktop-default" },
): ShellModel {
  const location = useLocation();
  // The original media hook starts false; its first commit is open even on a narrow viewport.
  const [viewport, setViewport] = useState(1280);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1050px)");
    const sync = () => setViewport(window.innerWidth);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const narrow = viewport <= 1050;
  const opener = useNavigationOpener({
    initialOpen: true,
    routeKey: location.pathname,
    dismissOnNavigation: narrow,
  });
  useEffect(() => opener.setOpen(!narrow), [narrow]);
  const base = useHomeShellModel({
    ...fixture,
    path: location.pathname,
    width: viewport,
  });
  return {
    ...base,
    navigation: {
      ...base.navigation,
      presentation: {
        ...base.navigation.presentation,
        mobileOpen: { value: opener.open, set: opener.setOpen },
      },
    },
    regions: base.regions.map((region) =>
      region.id === "shell.nav.dismiss"
        ? { ...region, visible: narrow && opener.open }
        : region,
    ),
    effects: base.effects.map((effect) =>
      effect.id === "close-drawer"
        ? {
            ...effect,
            run: () => {
              if (narrow) opener.dismiss();
            },
          }
        : effect.id === "open-drawer"
          ? { ...effect, run: opener.show }
          : effect,
    ),
  };
}

export function themeChoicesModel(model: ShellModel): ShellModel {
  const choices: NavigationEntry[] = [];
  function find(entries: readonly NavigationEntry[]) {
    for (const entry of entries) {
      if (entry.containerId === "account-theme")
        choices.push(...(entry.children ?? []));
      else find(entry.children ?? []);
    }
  }
  find(model.navigation.entries);
  if (choices.length !== 4)
    throw new Error("Expected one theme heading and three choices");
  return {
    ...model,
    navigation: { ...model.navigation, entries: choices, sections: [] },
  };
}
