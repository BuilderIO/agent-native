import { useLocation } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import { AgentToggleButton } from "@agent-native/core/client";

const pageTitles: Record<string, string> = {
  "/": "Designs",
  "/examples": "Examples",
  "/design-systems": "Design Systems",
  "/design-systems/setup": "Set up design system",
  "/settings": "Settings",
};

function DesignTitle({ id }: { id: string }) {
  const { data } = useActionQuery<{ title?: string }>("get-design", { id });
  const title = data?.title ?? "Design";
  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
  );
}

function StaticTitle({ pathname }: { pathname: string }) {
  const title = pageTitles[pathname] ?? "Design";
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
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>
    </header>
  );
}
