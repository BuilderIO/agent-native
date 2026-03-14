import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer } from "@agent-native/core/server";
import { handleDemo } from "./routes/demo";
import { handleQuery } from "./routes/query-proxy";
import { handleBlogPagesSeo, handlePageKeywords, handleTopKeywords } from "./routes/dataforseo";
import { handleHubspotDeals, handleHubspotPipelines, handleHubspotMetrics } from "./routes/hubspot";
import { handleContentCalendar, handleContentCalendarSchema, handleNotionPage, handleDataDictionary } from "./routes/notion";
import { syncDataDictionary } from "./lib/notion";
import { handleTwitterTweets, handleTwitterMulti } from "./routes/twitter";
import { handlePylonIssues, handlePylonAccounts } from "./routes/pylon";
import { handleCommonRoomMembers } from "./routes/commonroom";
import { handleGongCalls, handleGongUsers } from "./routes/gong";
import { handleApolloSearch } from "./routes/apollo";
import {
  handleGrafanaDashboards,
  handleGrafanaDashboard,
  handleGrafanaDatasources,
  handleGrafanaAlerts,
  handleGrafanaQuery,
} from "./routes/grafana";
import {
  handleSentryProjects,
  handleSentryIssues,
  handleSentryIssueEvents,
  handleSentryStats,
} from "./routes/sentry";
import {
  handleGCloudServices,
  handleGCloudMetrics,
  handleGCloudLogs,
} from "./routes/gcloud";
import {
  handleSlackTeam,
  handleSlackChannels,
  handleSlackHistory,
  handleSlackMultiHistory,
  handleSlackSearch,
} from "./routes/slack";
import {
  handleJiraSearch,
  handleJiraIssue,
  handleJiraProjects,
  handleJiraStatuses,
  handleJiraBoards,
  handleJiraSprints,
  handleJiraAnalytics,
} from "./routes/jira";
import { handleFeedback } from "./routes/feedback";
import {
  handleGitHubSearch,
  handleGitHubPR,
  handleGitHubIssue,
  handleGitHubPRList,
  handleGitHubOrgPRs,
  handleGitHubGraphQL,
} from "./routes/github";
import {
  handleGetPersona,
  handleSetPersona,
  handleValidateMetric,
  handleLeaderboard,
  handleMyStats,
  handleNewMetrics,
} from "./routes/gamification";
import { handleMissingMetrics, handleApproveSuggestion, handleUpdateEntry, handleCanEdit } from "./routes/data-dictionary";
import {
  handleStripeBilling,
  handleStripeBillingByProduct,
  handleStripePaymentStatus,
  handleStripeRefunds,
  handleStripeSubscriptions,
} from "./routes/stripe";
import { handleTrackEvent } from "./routes/events";
import { handleListInstructions, handleGetInstruction, handleSaveInstruction, handleCanEditInstructions } from "./routes/ai-instructions";
import { envKeys } from "./lib/env-config.js";
import {
  listExplorerConfigs,
  getExplorerConfig,
  saveExplorerConfig,
  deleteExplorerConfig,
} from "./routes/explorer-configs";
import {
  listExplorerDashboards,
  getExplorerDashboard,
  saveExplorerDashboard,
  deleteExplorerDashboard,
} from "./routes/explorer-dashboards";

export function createAppServer() {
  const app = createServer({ envKeys });

  // Serve generated chart images (no auth needed, ephemeral)
  const mediaDir = path.join(import.meta.dirname, "../media");
  app.use("/api/media", express.static(mediaDir));

  // Theme persistence (no auth needed)
  const themeFile = path.join(mediaDir, "theme.json");
  app.get("/api/theme", (_req, res) => {
    try {
      if (fs.existsSync(themeFile)) {
        const data = JSON.parse(fs.readFileSync(themeFile, "utf8"));
        res.json(data);
      } else {
        res.json({ theme: "dark" });
      }
    } catch {
      res.json({ theme: "dark" });
    }
  });
  app.post("/api/theme", (req, res) => {
    const theme = req.body?.theme === "light" ? "light" : "dark";
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(themeFile, JSON.stringify({ theme }));
    res.json({ theme });
  });

  // Events tracking (before auth middleware - needs to be public for beacons)
  app.post("/api/events/track", handleTrackEvent);

  // AI Instructions - read endpoints are public, write requires auth
  app.get("/api/ai-instructions/list", handleListInstructions);
  app.get("/api/ai-instructions/get", handleGetInstruction);
  app.get("/api/ai-instructions/can-edit", handleCanEditInstructions);
  app.post("/api/ai-instructions/save", handleSaveInstruction);

  app.get("/api/demo", handleDemo);

  // Query endpoint - runs SQL directly against BigQuery
  app.post("/api/query", handleQuery);

  // DataForSEO SEO data
  app.get("/api/seo/blog-pages", handleBlogPagesSeo);
  app.get("/api/seo/keywords", handlePageKeywords);
  app.get("/api/seo/top-keywords", handleTopKeywords);

  // HubSpot CRM
  app.get("/api/hubspot/deals", handleHubspotDeals);
  app.get("/api/hubspot/pipelines", handleHubspotPipelines);
  app.get("/api/hubspot/metrics", handleHubspotMetrics);

  // Notion content calendar + page rendering
  app.get("/api/notion/content-calendar", handleContentCalendar);
  app.get("/api/notion/content-calendar/schema", handleContentCalendarSchema);
  app.get("/api/notion/page/:pageId", handleNotionPage);
  app.get("/api/notion/data-dictionary", handleDataDictionary);

  // Twitter
  app.get("/api/twitter/tweets", handleTwitterTweets);
  app.get("/api/twitter/multi", handleTwitterMulti);

  // Pylon support
  app.get("/api/pylon/issues", handlePylonIssues);
  app.get("/api/pylon/accounts", handlePylonAccounts);

  // Common Room community
  app.get("/api/commonroom/members", handleCommonRoomMembers);

  // Gong sales calls
  app.get("/api/gong/calls", handleGongCalls);
  app.get("/api/gong/users", handleGongUsers);

  // Apollo contact/company enrichment
  app.get("/api/apollo/search", handleApolloSearch);

  // Grafana monitoring
  app.get("/api/grafana/dashboards", handleGrafanaDashboards);
  app.get("/api/grafana/dashboard", handleGrafanaDashboard);
  app.get("/api/grafana/datasources", handleGrafanaDatasources);
  app.get("/api/grafana/alerts", handleGrafanaAlerts);
  app.post("/api/grafana/query", handleGrafanaQuery);

  // Sentry error tracking
  app.get("/api/sentry/projects", handleSentryProjects);
  app.get("/api/sentry/issues", handleSentryIssues);
  app.get("/api/sentry/issue-events", handleSentryIssueEvents);
  app.get("/api/sentry/stats", handleSentryStats);

  // Google Cloud monitoring
  app.get("/api/gcloud/services", handleGCloudServices);
  app.get("/api/gcloud/metrics", handleGCloudMetrics);
  app.get("/api/gcloud/logs", handleGCloudLogs);

  // Slack feedback
  app.get("/api/slack/team", handleSlackTeam);
  app.get("/api/slack/channels", handleSlackChannels);
  app.get("/api/slack/history", handleSlackHistory);
  app.get("/api/slack/multi-history", handleSlackMultiHistory);
  app.get("/api/slack/search", handleSlackSearch);

  // Feedback
  app.post("/api/feedback", handleFeedback);

  // GitHub
  app.get("/api/github/search", handleGitHubSearch);
  app.get("/api/github/pr", handleGitHubPR);
  app.get("/api/github/issue", handleGitHubIssue);
  app.get("/api/github/prs", handleGitHubPRList);
  app.get("/api/github/org-prs", handleGitHubOrgPRs);
  app.post("/api/github/graphql", handleGitHubGraphQL);

  // Explorer configs
  app.get("/api/explorer-configs", listExplorerConfigs);
  app.get("/api/explorer-configs/:id", getExplorerConfig);
  app.post("/api/explorer-configs/:id", saveExplorerConfig);
  app.delete("/api/explorer-configs/:id", deleteExplorerConfig);

  // Explorer dashboards
  app.get("/api/explorer-dashboards", listExplorerDashboards);
  app.get("/api/explorer-dashboards/:id", getExplorerDashboard);
  app.post("/api/explorer-dashboards/:id", saveExplorerDashboard);
  app.delete("/api/explorer-dashboards/:id", deleteExplorerDashboard);

  // Jira tickets
  app.get("/api/jira/search", handleJiraSearch);
  app.get("/api/jira/issue", handleJiraIssue);
  app.get("/api/jira/projects", handleJiraProjects);
  app.get("/api/jira/statuses", handleJiraStatuses);
  app.get("/api/jira/boards", handleJiraBoards);
  app.get("/api/jira/sprints", handleJiraSprints);
  app.get("/api/jira/analytics", handleJiraAnalytics);

  // Stripe billing
  app.get("/api/stripe/billing", handleStripeBilling);
  app.get("/api/stripe/billing-by-product", handleStripeBillingByProduct);
  app.get("/api/stripe/payment-status", handleStripePaymentStatus);
  app.get("/api/stripe/refunds", handleStripeRefunds);
  app.get("/api/stripe/subscriptions", handleStripeSubscriptions);

  // Data Dictionary gamification
  app.get("/api/data-dictionary/missing-metrics", handleMissingMetrics);
  app.get("/api/data-dictionary/can-edit", handleCanEdit);
  app.post("/api/data-dictionary/approve-suggestion", handleApproveSuggestion);
  app.post("/api/data-dictionary/update-entry", handleUpdateEntry);

  // Gamification system
  app.get("/api/gamification/persona", handleGetPersona);
  app.post("/api/gamification/persona", handleSetPersona);
  app.post("/api/gamification/validate-metric", handleValidateMetric);
  app.get("/api/gamification/leaderboard", handleLeaderboard);
  app.get("/api/gamification/my-stats", handleMyStats);
  app.get("/api/gamification/new-metrics", handleNewMetrics);

  // Sync data dictionary from Notion to local file (fire-and-forget)
  syncDataDictionary()
    .then(() => console.log("[startup] Data dictionary synced to docs/data-dictionary.md"))
    .catch((err) => console.error("[startup] Failed to sync data dictionary:", err.message));

  return app;
}
