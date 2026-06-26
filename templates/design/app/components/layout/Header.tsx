import { useActionQuery, useT } from "@agent-native/core/client";
import { AgentToggleButton } from "@agent-native/core/client";
import { RunsTray } from "@agent-native/core/client/progress";
import { useLocation } from "react-router";

import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitleKeys: Record<string, string> = {
  "/": "navigation.designs",
  "/templates": "navigation.templates",
  "/design-systems": "navigation.designSystems",
  "/design-systems/setup": "navigation.setupDesignSystem",
  "/settings": "navigation.settings",
};

function DesignTitle({ id }: { id: string }) {
  const { data } = useActionQuery<{ title?: string }>("get-design", { id });
  const title = data?.title ?? "Design";
  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
  );
}

function StaticTitle({ pathname }: { pathname: string }) {
  const t = useT();
  const title = pageTitleKeys[pathname]
    ? t(pageTitleKeys[pathname])
    : t("navigation.brand");
  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
  );
}

function ResolvedTitle() {
  const location = useLocation();
  const designMatch = location.pathname.match(/^\/design\/(.+)$/);
  if (designMatch) {
    return <DesignTitle id={designMatch[1]} />;
  }
  return <StaticTitle pathname={location.pathname} />;
}

export function Header() {
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? <ResolvedTitle />}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <RunsTray pollMs={1500} />
        <AgentToggleButton />
      </div>
    </header>
  );
}
