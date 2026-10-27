import { trackEvent } from "@agent-native/core/client/analytics";
import type {
  HomeSuggestionClick,
  HomeSuggestionPools,
  HomeSuggestionPrompt,
  HomeSuggestionRoleKey,
} from "@agent-native/toolkit/app-shell";

const suggestionIds = {
  product: [
    "launch",
    "roadmap",
    "opportunity",
    "priorities",
    "metrics",
    "discovery",
    "vision",
    "release",
  ],
  design: [
    "caseStudy",
    "system",
    "critique",
    "research",
    "concepts",
    "accessibility",
    "brand",
    "sprint",
  ],
  developer: [
    "architecture",
    "api",
    "release",
    "incident",
    "migration",
    "security",
    "demo",
    "metrics",
  ],
  marketing: [
    "campaign",
    "story",
    "content",
    "positioning",
    "channels",
    "messaging",
    "event",
    "competition",
  ],
  sales: [
    "pitch",
    "proposal",
    "quarterlyReview",
    "discovery",
    "objections",
    "demo",
    "renewal",
    "enablement",
  ],
  ops: [
    "weeklyReview",
    "process",
    "capacity",
    "service",
    "vendor",
    "metrics",
    "onboarding",
    "risk",
  ],
  individual: [
    "project",
    "portfolio",
    "learning",
    "event",
    "budget",
    "travel",
    "community",
    "personalStory",
  ],
  general: [
    "overview",
    "fundraiser",
    "lesson",
    "research",
    "eventProposal",
    "teamStrategy",
    "howTo",
    "portfolioIntro",
  ],
} as const satisfies Record<HomeSuggestionRoleKey, readonly string[]>;

export interface SlidesHomeSuggestion extends HomeSuggestionPrompt {
  key: string;
}

function suggestionsFor(role: HomeSuggestionRoleKey) {
  return suggestionIds[role].map((id, index) => {
    const key = `home.suggestionPrompts.${role}.${id}`;
    const label = `home.suggestionLabels.${role}.${id}`;
    return {
      id: `slides-suggestion-${index + 1}`,
      key,
      label,
      prompt: key,
    };
  });
}

export const slidesHomeSuggestionPools = {
  product: suggestionsFor("product"),
  design: suggestionsFor("design"),
  developer: suggestionsFor("developer"),
  marketing: suggestionsFor("marketing"),
  sales: suggestionsFor("sales"),
  ops: suggestionsFor("ops"),
  individual: suggestionsFor("individual"),
  general: suggestionsFor("general"),
} satisfies HomeSuggestionPools<SlidesHomeSuggestion>;

export function trackSlidesHomeSuggestionClick(click: HomeSuggestionClick) {
  trackEvent("home_suggestion_clicked", {
    app_id: click.appId,
    role: click.role,
    suggestion_id: click.suggestionId,
    position: click.position,
  });
}
