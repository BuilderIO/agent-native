import { AgentToggleButton, useT } from "@agent-native/core/client";
import { RunsTray } from "@agent-native/core/client/progress";
import {
  useHeaderTitle,
  useHeaderActions,
} from "@agent-native/toolkit/app-shell";
import { useLocation } from "react-router";

import { useDecks } from "@/context/DeckContext";

const pageTitleKeys: Record<string, string> = {
  "/": "header.decks",
  "/design-systems": "header.designSystems",
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

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="hidden h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:flex lg:px-6">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? <ResolvedTitle pathname={location.pathname} />}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <RunsTray />
        <AgentToggleButton />
      </div>
    </header>
  );
}
