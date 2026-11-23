import type {
  SettingsPageHeader,
  SettingsShellContextValue,
} from "@agent-native/toolkit/app/settings/shell";
import { Suspense, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";

import {
  SettingsShellProvider,
  SkillsSettingsPage,
} from "./toolkit-settings-parts";

/** Personal skills are available to workspace members as well as admins. */
export function AnalyticsSkillsPage() {
  const navigate = useNavigate();
  const [header, setHeader] = useState<SettingsPageHeader | null>(null);
  const context = useMemo<SettingsShellContextValue>(
    () => ({
      route: { page: "skills", sub: null },
      navigate: (page, sub, options) => {
        const href = `/settings/${page}${sub ? `/${sub}` : ""}`;
        void navigate(href, { replace: options?.replace ?? false });
      },
      setHeader,
    }),
    [navigate],
  );
  return (
    <SettingsShellProvider value={context}>
      <section className="analytics-skills-page">
        <header className="analytics-skills-header">
          <h1>{header?.title ?? "Skills"}</h1>
          {header?.action}
        </header>
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <SkillsSettingsPage trashRemovedSkills />
        </Suspense>
      </section>
    </SettingsShellProvider>
  );
}
