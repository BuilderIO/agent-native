import "dotenv/config";
import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import fs from "fs";
import {
  defineEventHandler,
  readBody,
  sendStream,
  setResponseStatus,
} from "h3";
import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core/server";
import { createFileSync } from "@agent-native/core/adapters/sync";
import { handleDemo } from "./routes/demo";
import { handleQuery } from "./routes/query-proxy";
import {
  handleBlogPagesSeo,
  handlePageKeywords,
  handleTopKeywords,
} from "./routes/dataforseo";
import {
  handleHubspotDeals,
  handleHubspotPipelines,
  handleHubspotMetrics,
} from "./routes/hubspot";
import {
  handleContentCalendar,
  handleContentCalendarSchema,
  handleNotionPage,
} from "./routes/notion";
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
import {
  handleStripeBilling,
  handleStripeBillingByProduct,
  handleStripePaymentStatus,
  handleStripeRefunds,
  handleStripeSubscriptions,
} from "./routes/stripe";
import { handleTrackEvent } from "./routes/events";
import {
  handleListInstructions,
  handleGetInstruction,
  handleSaveInstruction,
  handleCanEditInstructions,
} from "./routes/ai-instructions";
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

export async function createAppServer() {
  const { app, router } = createServer({ envKeys });

  const watcher = createFileWatcher("./data");

  // Serve generated chart images (no auth needed, ephemeral)
  const mediaDir = path.resolve(import.meta.dirname, "../media");
  router.get(
    "/api/media/**",
    defineEventHandler(async (event) => {
      const filename = event.path.replace("/api/media/", "");
      const filepath = path.resolve(mediaDir, filename);
      if (!filepath.startsWith(mediaDir + path.sep)) {
        setResponseStatus(event, 403);
        return { error: "Forbidden" };
      }
      try {
        await stat(filepath);
        return sendStream(event, createReadStream(filepath));
      } catch {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
    }),
  );

  // Theme persistence (no auth needed)
  const themeFile = path.join(mediaDir, "theme.json");
  router.get(
    "/api/theme",
    defineEventHandler((_event) => {
      try {
        if (fs.existsSync(themeFile)) {
          const data = JSON.parse(fs.readFileSync(themeFile, "utf8"));
          return data;
        } else {
          return { theme: "dark" };
        }
      } catch {
        return { theme: "dark" };
      }
    }),
  );
  router.post(
    "/api/theme",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const theme = body?.theme === "light" ? "light" : "dark";
      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
      fs.writeFileSync(themeFile, JSON.stringify({ theme }));
      return { theme };
    }),
  );

  // Events tracking (before auth middleware - needs to be public for beacons)
  router.post("/api/events/track", handleTrackEvent);

  // AI Instructions - read endpoints are public, write requires auth
  router.get("/api/ai-instructions/list", handleListInstructions);
  router.get("/api/ai-instructions/get", handleGetInstruction);
  router.get("/api/ai-instructions/can-edit", handleCanEditInstructions);
  router.post("/api/ai-instructions/save", handleSaveInstruction);

  router.get("/api/demo", handleDemo);

  // Query endpoint - runs SQL directly against BigQuery
  router.post("/api/query", handleQuery);

  // DataForSEO SEO data
  router.get("/api/seo/blog-pages", handleBlogPagesSeo);
  router.get("/api/seo/keywords", handlePageKeywords);
  router.get("/api/seo/top-keywords", handleTopKeywords);

  // HubSpot CRM
  router.get("/api/hubspot/deals", handleHubspotDeals);
  router.get("/api/hubspot/pipelines", handleHubspotPipelines);
  router.get("/api/hubspot/metrics", handleHubspotMetrics);

  // Notion content calendar + page rendering
  router.get("/api/notion/content-calendar", handleContentCalendar);
  router.get(
    "/api/notion/content-calendar/schema",
    handleContentCalendarSchema,
  );
  router.get("/api/notion/page/:pageId", handleNotionPage);
  // Twitter
  router.get("/api/twitter/tweets", handleTwitterTweets);
  router.get("/api/twitter/multi", handleTwitterMulti);

  // Pylon support
  router.get("/api/pylon/issues", handlePylonIssues);
  router.get("/api/pylon/accounts", handlePylonAccounts);

  // Common Room community
  router.get("/api/commonroom/members", handleCommonRoomMembers);

  // Gong sales calls
  router.get("/api/gong/calls", handleGongCalls);
  router.get("/api/gong/users", handleGongUsers);

  // Apollo contact/company enrichment
  router.get("/api/apollo/search", handleApolloSearch);

  // Grafana monitoring
  router.get("/api/grafana/dashboards", handleGrafanaDashboards);
  router.get("/api/grafana/dashboard", handleGrafanaDashboard);
  router.get("/api/grafana/datasources", handleGrafanaDatasources);
  router.get("/api/grafana/alerts", handleGrafanaAlerts);
  router.post("/api/grafana/query", handleGrafanaQuery);

  // Sentry error tracking
  router.get("/api/sentry/projects", handleSentryProjects);
  router.get("/api/sentry/issues", handleSentryIssues);
  router.get("/api/sentry/issue-events", handleSentryIssueEvents);
  router.get("/api/sentry/stats", handleSentryStats);

  // Google Cloud monitoring
  router.get("/api/gcloud/services", handleGCloudServices);
  router.get("/api/gcloud/metrics", handleGCloudMetrics);
  router.get("/api/gcloud/logs", handleGCloudLogs);

  // Slack feedback
  router.get("/api/slack/team", handleSlackTeam);
  router.get("/api/slack/channels", handleSlackChannels);
  router.get("/api/slack/history", handleSlackHistory);
  router.get("/api/slack/multi-history", handleSlackMultiHistory);
  router.get("/api/slack/search", handleSlackSearch);

  // Feedback
  router.post("/api/feedback", handleFeedback);

  // GitHub
  router.get("/api/github/search", handleGitHubSearch);
  router.get("/api/github/pr", handleGitHubPR);
  router.get("/api/github/issue", handleGitHubIssue);
  router.get("/api/github/prs", handleGitHubPRList);
  router.get("/api/github/org-prs", handleGitHubOrgPRs);
  router.post("/api/github/graphql", handleGitHubGraphQL);

  // Explorer configs
  router.get("/api/explorer-configs", listExplorerConfigs);
  router.get("/api/explorer-configs/:id", getExplorerConfig);
  router.post("/api/explorer-configs/:id", saveExplorerConfig);
  router.delete("/api/explorer-configs/:id", deleteExplorerConfig);

  // Explorer dashboards
  router.get("/api/explorer-dashboards", listExplorerDashboards);
  router.get("/api/explorer-dashboards/:id", getExplorerDashboard);
  router.post("/api/explorer-dashboards/:id", saveExplorerDashboard);
  router.delete("/api/explorer-dashboards/:id", deleteExplorerDashboard);

  // Jira tickets
  router.get("/api/jira/search", handleJiraSearch);
  router.get("/api/jira/issue", handleJiraIssue);
  router.get("/api/jira/projects", handleJiraProjects);
  router.get("/api/jira/statuses", handleJiraStatuses);
  router.get("/api/jira/boards", handleJiraBoards);
  router.get("/api/jira/sprints", handleJiraSprints);
  router.get("/api/jira/analytics", handleJiraAnalytics);

  // Stripe billing
  router.get("/api/stripe/billing", handleStripeBilling);
  router.get("/api/stripe/billing-by-product", handleStripeBillingByProduct);
  router.get("/api/stripe/payment-status", handleStripePaymentStatus);
  router.get("/api/stripe/refunds", handleStripeRefunds);
  router.get("/api/stripe/subscriptions", handleStripeSubscriptions);

  // Gamification system
  router.get("/api/gamification/persona", handleGetPersona);
  router.post("/api/gamification/persona", handleSetPersona);
  router.post("/api/gamification/validate-metric", handleValidateMetric);
  router.get("/api/gamification/leaderboard", handleLeaderboard);
  router.get("/api/gamification/my-stats", handleMyStats);
  router.get("/api/gamification/new-metrics", handleNewMetrics);

  // File sync
  const syncResult = await createFileSync({ contentRoot: "./data" });
  if (syncResult.status === "error") {
    console.warn(`[app] File sync failed: ${syncResult.reason}`);
  }
  const extraEmitters =
    syncResult.status === "ready" ? [syncResult.sseEmitter] : [];

  router.get(
    "/api/file-sync/status",
    defineEventHandler(() => {
      if (syncResult.status !== "ready")
        return { enabled: false, conflicts: 0 };
      return {
        enabled: true,
        connected: true,
        conflicts: syncResult.fileSync.conflictCount,
      };
    }),
  );

  router.get(
    "/api/events",
    createSSEHandler(watcher, { extraEmitters, contentRoot: "./data" }),
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    if (syncResult.status === "ready") await syncResult.shutdown();
    process.exit(0);
  });

  // Conflict notification
  if (syncResult.status === "ready") {
    syncResult.fileSync.syncEvents.on("sync", (event) => {
      try {
        if (event.type === "conflict-needs-llm") {
          fs.mkdirSync("application-state", { recursive: true });
          fs.writeFileSync(
            "application-state/sync-conflict.json",
            JSON.stringify(event, null, 2),
          );
        } else if (event.type === "conflict-resolved") {
          fs.rmSync("application-state/sync-conflict.json", { force: true });
        }
      } catch {
        /* best-effort */
      }
    });
  }

  return app;
}
