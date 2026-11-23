import { IconAlertTriangle, IconBulb, IconUser } from "@tabler/icons-react";
import { Link } from "react-router";

import { HomeLoading, HomeNonIdealState } from "./state";
import type { HomeCallbacks, HomeSuggestions } from "./types";

function SuggestionCard({
  suggestion,
}: {
  suggestion: HomeSuggestions["issues"][number];
}) {
  const hasStats =
    (suggestion.sourceCount ?? 0) > 0 || (suggestion.userCount ?? 0) > 0;
  const body = (
    <>
      <div className="ws-home-card-title">{suggestion.title}</div>
      {suggestion.description ? (
        <p className="ws-home-card-description">{suggestion.description}</p>
      ) : null}
      {hasStats ? (
        <div className="ws-home-card-meta">
          {(suggestion.sourceCount ?? 0) > 0 ? (
            <span className="ws-home-card-views">
              <IconAlertTriangle size={14} aria-label="Sources:" />
              {suggestion.sourceCount}
            </span>
          ) : null}
          {(suggestion.userCount ?? 0) > 0 ? (
            <span className="ws-home-card-views">
              <IconUser size={14} aria-label="Users:" />
              {suggestion.userCount}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return suggestion.href != null ? (
    <Link className="ws-home-card is-interactive" to={suggestion.href}>
      {body}
    </Link>
  ) : (
    <article className="ws-home-card">{body}</article>
  );
}

export function HomeSuggestionsSection({
  suggestions,
  callbacks,
}: {
  suggestions: HomeSuggestions;
  callbacks: HomeCallbacks;
}) {
  if (suggestions.status === "loading") {
    return <HomeLoading />;
  }

  if (suggestions.status === "unavailable") {
    return (
      <HomeNonIdealState
        icon={<IconBulb size={28} aria-hidden="true" />}
        description="Context suggestions are unavailable in this workspace."
      >
        <button
          type="button"
          className="ws-home-button"
          onClick={callbacks.onOpenContextStudio}
          disabled={callbacks.onOpenContextStudio == null}
        >
          Open Context Studio
        </button>
      </HomeNonIdealState>
    );
  }

  if (suggestions.status === "error") {
    return (
      <HomeNonIdealState
        icon={<IconAlertTriangle size={28} aria-hidden="true" />}
        description={
          suggestions.errorMessage ?? "There was an error loading suggestions"
        }
      />
    );
  }

  if (suggestions.issues.length === 0) {
    return (
      <HomeNonIdealState
        icon={<IconBulb size={28} aria-hidden="true" />}
        title="No suggestions yet"
        description="Suggestions will appear here as Analytics identifies improvements from your team's agent conversations and data activity."
      >
        <button
          type="button"
          className="ws-home-button"
          onClick={callbacks.onOpenContextStudio}
          disabled={callbacks.onOpenContextStudio == null}
        >
          Open Context Studio
        </button>
      </HomeNonIdealState>
    );
  }

  return (
    <div>
      <div className="ws-home-group-heading">
        <h4 className="ws-home-group-title">Latest suggestions</h4>
        {suggestions.viewAllHref != null ? (
          <Link className="ws-home-viewall" to={suggestions.viewAllHref}>
            View all
          </Link>
        ) : (
          <button type="button" className="ws-home-viewall" disabled>
            View all
          </button>
        )}
      </div>
      <div className="ws-home-card-grid">
        {suggestions.issues.map((suggestion) => (
          <SuggestionCard key={suggestion.id} suggestion={suggestion} />
        ))}
      </div>
    </div>
  );
}
