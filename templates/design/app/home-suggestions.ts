import { trackEvent } from "@agent-native/core/client/analytics";
import type {
  HomeSuggestionClick,
  HomeSuggestionPools,
  HomeSuggestionPrompt,
} from "@agent-native/toolkit/app-shell";

const prompts = (
  role: string,
  keys: readonly string[],
): HomeSuggestionPrompt[] =>
  keys.map((key, index) => ({
    id: `design-suggestion-${index + 1}`,
    label: `home.suggestionLabels.${role}.${key}`,
    prompt: `home.suggestions.${role}.${key}`,
  }));

export const DESIGN_HOME_SUGGESTION_POOLS: HomeSuggestionPools<HomeSuggestionPrompt> =
  {
    product: prompts("product", [
      "analyticsDashboard",
      "roadmapWorkspace",
      "onboardingFlow",
      "featureComparison",
      "feedbackPortal",
      "releaseNotes",
      "projectWorkspace",
      "launchWaitlist",
    ]),
    design: prompts("design", [
      "portfolioHome",
      "designSystem",
      "bankingApp",
      "travelBooking",
      "coffeeShop",
      "musicFestival",
      "accessibilityAudit",
      "artBook",
    ]),
    developer: prompts("developer", [
      "apiDocs",
      "deploymentDashboard",
      "componentPlayground",
      "databaseConsole",
      "issueTriage",
      "authSettings",
      "workflowBuilder",
      "developerPortfolio",
    ]),
    marketing: prompts("marketing", [
      "campaignLanding",
      "emailBuilder",
      "socialCalendar",
      "brandCampaign",
      "webinarRegistration",
      "seoBrief",
      "launchMetrics",
      "newsletterSignup",
    ]),
    sales: prompts("sales", [
      "leadWorkspace",
      "accountBrief",
      "productDemo",
      "proposalBuilder",
      "pipelineDashboard",
      "meetingBooking",
      "customerStory",
      "accountHandoff",
    ]),
    ops: prompts("ops", [
      "inventoryDashboard",
      "staffScheduler",
      "vendorPortal",
      "incidentResponse",
      "expenseApprovals",
      "warehouseReceiving",
      "automationControl",
      "helpdeskQueue",
    ]),
    individual: prompts("individual", [
      "personalPortfolio",
      "mealPlanner",
      "homeBudget",
      "tripPlanner",
      "readingJournal",
      "invoiceTracker",
      "habitTracker",
      "neighborhoodEvents",
    ]),
    general: prompts("general", [
      "saasHomepage",
      "analyticsDashboard",
      "habitApp",
      "onlineStore",
      "creativePortfolio",
      "bookingPage",
      "adminDashboard",
      "communityEvent",
    ]),
  };

export function trackDesignHomeSuggestionClick(click: HomeSuggestionClick) {
  trackEvent("home_suggestion_clicked", {
    app_id: click.appId,
    role: click.role,
    suggestion_id: click.suggestionId,
    position: click.position,
  });
}
