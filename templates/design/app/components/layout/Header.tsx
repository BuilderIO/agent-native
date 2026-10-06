import {
  requestAgentChatThreadOpen,
  requestAgentTaskOpen,
} from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useHeaderTitle,
  useHeaderActions,
} from "@agent-native/toolkit/app-shell";
import { AgentToggleButton } from "@agent-native/toolkit/app/chat";
import { RunsTray } from "@agent-native/toolkit/app/progress";
import { IconMenu2 } from "@tabler/icons-react";
import { useCallback } from "react";
import { useLocation } from "react-router";

import { HomeImportButton } from "@/components/editor/HomeImportButton";
import { cn } from "@/lib/utils";

const pageTitleKeys: Record<string, string> = {
  "/": "navigation.designs",
  "/home": "navigation.designs",
  "/design-systems": "navigation.designSystems",
  "/design-systems/setup": "navigation.setupDesignSystem",
  "/settings": "navigation.settings",
};

export function isDesignHomeRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/home";
}

type HeaderAgentRun = {
  title?: string;
  metadata?: Record<string, unknown> | null;
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

export function Header({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const location = useLocation();
  const isHome = isDesignHomeRoute(location.pathname);
  const t = useT();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const openRunThread = useCallback(
    (threadId: string, run?: HeaderAgentRun) => {
      const metadata = run?.metadata ?? {};
      const parentThreadId =
        typeof metadata.parentThreadId === "string"
          ? metadata.parentThreadId.trim()
          : "";
      const isAgentTeam =
        metadata.kind === "agent-team" || metadata.source === "agent-teams";
      if (isAgentTeam && parentThreadId && parentThreadId !== threadId) {
        requestAgentTaskOpen({
          threadId,
          parentThreadId,
          description:
            typeof metadata.description === "string"
              ? metadata.description
              : run?.title || "",
          name: typeof metadata.name === "string" ? metadata.name : "",
        });
        return;
      }
      requestAgentChatThreadOpen({ threadId });
    },
    [],
  );

  return (
    <div className={cn(isHome ? "shrink-0" : "contents")}>
      <header
        className={cn(
          "shrink-0 items-center gap-3 bg-background px-4 lg:px-6",
          isHome
            ? "h-14 design-home-header"
            : "hidden h-12 border-b border-border md:flex",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isHome ? (
            <button
              type="button"
              onClick={onOpenNavigation}
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              aria-label={t("navigation.openNavigation")}
            >
              <IconMenu2 className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          {title ?? <ResolvedTitle />}
        </div>
        {isHome && actions ? <div className="shrink-0">{actions}</div> : null}
        <div className="flex items-center justify-end gap-2 shrink-0">
          {isHome ? <HomeImportButton /> : null}
          {!isHome && actions}
          <RunsTray pollMs={0} onOpenThread={openRunThread} />
          <AgentToggleButton />
        </div>
      </header>
    </div>
  );
}

export function MobileHeaderActions() {
  const location = useLocation();
  const isHome = isDesignHomeRoute(location.pathname);
  const actions = useHeaderActions();
  if (isHome || !actions) return null;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4 md:hidden">
      {actions}
    </div>
  );
}
