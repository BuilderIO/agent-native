import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Suspense } from "react";

import { HomeFavoritesSection } from "./favorites";
import { HomePromptSection, homePromptTitleForIntent } from "./hero";
import { HomePopularSection } from "./popular";
import { HomeRecentsSection } from "./recents";
import { HomeSection } from "./section";
import { HomeSuggestionsSection } from "./suggestions";
import type { HomePageProps } from "./types";

import "./home.css";

export function HomePage({
  user,
  workspace,
  contextProgress,
  contextProgressPending = false,
  recents,
  favorites,
  popular,
  suggestions,
  getStarted,
  agentComposer,
  callbacks,
  activeIntent = null,
  promptTitle,
}: HomePageProps) {
  const resolvedPromptTitle =
    promptTitle ?? homePromptTitleForIntent(activeIntent);

  return (
    <div className="ws-home" data-workspace={workspace.id}>
      <Suspense
        fallback={
          <div className="ws-home-prompt" aria-hidden="true">
            <div className="ws-home-prompt-bg" />
            <div className="ws-home-prompt-grid" />
            <div className="ws-home-prompt-inner">
              <Skeleton className="mb-[22px] h-8 w-72 max-w-full" />
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="mt-3 h-7 w-64 max-w-full" />
              <Skeleton className="mt-[31px] h-11 w-full rounded-lg" />
            </div>
          </div>
        }
      >
        <HomePromptSection
          user={user}
          title={resolvedPromptTitle}
          activeIntent={activeIntent}
          agentComposer={agentComposer}
          contextProgress={contextProgress}
          contextProgressPending={contextProgressPending}
          callbacks={callbacks}
        />
      </Suspense>

      {getStarted ? (
        <HomeSection title="Get started" variation="B">
          {getStarted}
        </HomeSection>
      ) : null}

      <HomeSection title="Jump back in" variation="A" layout="recents">
        <HomeRecentsSection recents={recents} callbacks={callbacks} />
      </HomeSection>

      {suggestions ? (
        <HomeSection
          title="Context management"
          variation="B"
          className="ws-home-section--context-management"
        >
          <HomeSuggestionsSection
            suggestions={suggestions}
            callbacks={callbacks}
          />
        </HomeSection>
      ) : null}

      {favorites ? (
        <HomeSection title="Your favorites" variation="B">
          <HomeFavoritesSection favorites={favorites} callbacks={callbacks} />
        </HomeSection>
      ) : null}

      {popular ? (
        <HomeSection title="Popular projects" variation="A" fullHeight>
          <HomePopularSection popular={popular} />
        </HomeSection>
      ) : null}
    </div>
  );
}
