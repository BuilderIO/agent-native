import { useLocation, useParams } from "react-router";
import { useDecks } from "@/context/DeckContext";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import { AgentToggleButton } from "@agent-native/core/client";

const pageTitles: Record<string, string> = {
  "/": "Decks",
  "/design-systems": "Design Systems",
  "/team": "Team",
  "/settings": "Settings",
  "/extensions": "Extensions",
};

function DeckTitle({ id }: { id: string }) {
  const { getDeck } = useDecks();
  const deck = getDeck(id);
  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">
      {deck?.title || "Deck"}
    </h1>
  );
}

function ResolvedTitle({ pathname }: { pathname: string }) {
  if (pageTitles[pathname]) {
    return (
      <h1 className="text-lg font-semibold tracking-tight truncate">
        {pageTitles[pathname]}
      </h1>
    );
  }

  const deckMatch = pathname.match(/^\/deck\/([^/]+)$/);
  if (deckMatch) return <DeckTitle id={deckMatch[1]} />;

  if (pathname.startsWith("/extensions/")) {
    return (
      <h1 className="text-lg font-semibold tracking-tight truncate">Tool</h1>
    );
  }

  return (
    <h1 className="text-lg font-semibold tracking-tight truncate">Slides</h1>
  );
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? <ResolvedTitle pathname={location.pathname} />}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>
    </header>
  );
}
