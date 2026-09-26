import { AgentToggleButton } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { NotificationsBell } from "@agent-native/core/client/notifications";
import { RunsTray } from "@agent-native/core/client/progress";
import {
  useHeaderTitle,
  useHeaderActions,
} from "@agent-native/toolkit/app-shell";
import type { ReactNode } from "react";
import { useLocation } from "react-router";

import { useDecks } from "@/context/DeckContext";
import { cn } from "@/lib/utils";

const pageTitleKeys: Record<string, string> = {
  "/home": "header.decks",
  "/templates": "templatesPage.title",
  "/design-systems": "header.designSystems",
  "/agent": "settings.agentTitle",
  "/settings": "header.settings",
  "/extensions": "header.extensions",
};

function DeckTitle({ id }: { id: string }) {
  const { getDeck } = useDecks();
  const t = useT();
  const deck = getDeck(id);
  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">
      {deck?.title || t("header.deck")}
    </h1>
  );
}

function ResolvedTitle({ pathname }: { pathname: string }) {
  const t = useT();
  if (pageTitleKeys[pathname]) {
    return (
      <h1 className="text-lg font-semibold tracking-tight truncate">
        {t(pageTitleKeys[pathname])}
      </h1>
    );
  }

  const deckMatch = pathname.match(/^\/deck\/([^/]+)$/);
  if (deckMatch) return <DeckTitle id={deckMatch[1]} />;

  if (pathname.startsWith("/extensions/")) {
    return (
      <h1 className="text-lg font-semibold tracking-tight truncate">
        {t("header.tool")}
      </h1>
    );
  }

  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">
      {t("header.slides")}
    </h1>
  );
}

function HeaderControls({
  children,
  showNotifications = true,
}: {
  children?: ReactNode;
  showNotifications?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 shrink-0">
      {children}
      {showNotifications ? <NotificationsBell pollMs={30_000} /> : null}
      <RunsTray pollMs={0} />
      <AgentToggleButton />
    </div>
  );
}

export function HomeHeaderActions({
  search,
  children,
}: {
  search: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="slides-home-search w-full min-w-0">{search}</div>
      <HeaderControls showNotifications={false}>{children}</HeaderControls>
    </>
  );
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const home = location.pathname === "/home";

  return (
    <header
      className={cn(
        "hidden shrink-0 border-b border-border bg-background md:block",
        home && "slides-home-header border-b-0",
      )}
    >
      <div
        className={cn(
          "flex h-12 items-center gap-3 px-4 lg:px-6",
          home && "slides-home-toolbar",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {title ?? <ResolvedTitle pathname={location.pathname} />}
        </div>
        {home && actions ? actions : <HeaderControls>{actions}</HeaderControls>}
      </div>
    </header>
  );
}
