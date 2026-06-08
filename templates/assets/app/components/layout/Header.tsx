import { useLocation } from "react-router";
import { AgentToggleButton, useActionQuery } from "@agent-native/core/client";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitles: Record<string, string> = {
  "/": "Create",
  "/library": "Library",
  "/brand-kits": "Brand Kits",
  "/extensions": "Extensions",
  "/settings": "Settings",
};

function LibraryTitle({ id }: { id: string }) {
  const { data } = useActionQuery("get-library", { id }) as any;
  const title = data?.library?.title ?? "Brand Kit";
  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
  );
}

function StaticTitle({ pathname }: { pathname: string }) {
  const title = pageTitles[pathname] ?? "Assets";
  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
  );
}

function ResolvedTitle() {
  const location = useLocation();
  const libraryMatch = location.pathname.match(/^\/brand-kits\/([^/]+)/);
  if (libraryMatch) {
    return <LibraryTitle id={libraryMatch[1]} />;
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
        <AgentToggleButton />
      </div>
    </header>
  );
}
