import {
  requestAgentChatThreadOpen,
  requestAgentTaskOpen,
} from "@agent-native/core/client/agent-chat";
import { AgentToggleButton } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { RunsTray } from "@agent-native/core/client/progress";
import {
  useHeaderTitle,
  useHeaderActions,
} from "@agent-native/toolkit/app-shell";
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

export function Header() {
  const isHome = useLocation().pathname === "/home";
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
    <div
      className={cn(
        isHome ? "design-home-toolbar hidden shrink-0 md:block" : "contents",
      )}
    >
      <header
        className={cn(
          "hidden h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:flex lg:px-6",
          isHome && "design-home-header",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {title ?? <ResolvedTitle />}
        </div>
        {isHome ? (
          <div className="design-home-header-search min-w-0 w-full max-w-175 justify-self-center">
            {actions}
          </div>
        ) : null}
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

/**
 * Mobile counterpart of the header actions slot: <Header> is `md:flex`, so
 * without this every control a page publishes through `useSetHeaderActions`
 * is unmounted below the `md` breakpoint.
 */
export function MobileHeaderActions() {
  const isHome = useLocation().pathname === "/home";
  const actions = useHeaderActions();
  if (!actions) return null;
  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4 md:hidden",
        isHome && "justify-center",
      )}
    >
      {actions}
      {isHome ? <HomeImportButton /> : null}
    </div>
  );
}
