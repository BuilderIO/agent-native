import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../lib/credentials";
import {
  listProjects,
  listIssues,
  getIssueEvents,
  getOrganizationStats,
} from "../lib/sentry";

export const handleSentryProjects = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(
      event,
      "SENTRY_AUTH_TOKEN",
      "Sentry",
    );
    if (missing) return missing;
    try {
      const { orgSlug } = getQuery(event);
      const projects = await listProjects(orgSlug as string | undefined);
      return { projects, total: projects.length };
    } catch (err: any) {
      console.error("Sentry projects error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handleSentryIssues = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(
      event,
      "SENTRY_AUTH_TOKEN",
      "Sentry",
    );
    if (missing) return missing;
    try {
      const { orgSlug, project, query, statsPeriod } = getQuery(event);
      const issues = await listIssues(
        project as string | undefined,
        query as string | undefined,
        statsPeriod as string | undefined,
        orgSlug as string | undefined,
      );
      return { issues, total: issues.length };
    } catch (err: any) {
      console.error("Sentry issues error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handleSentryIssueEvents = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(
      event,
      "SENTRY_AUTH_TOKEN",
      "Sentry",
    );
    if (missing) return missing;
    try {
      const { orgSlug, issueId } = getQuery(event);
      if (!issueId) {
        setResponseStatus(event, 400);
        return { error: "issueId query parameter is required" };
      }
      const events = await getIssueEvents(
        issueId as string,
        orgSlug as string | undefined,
      );
      return { events, total: events.length };
    } catch (err: any) {
      console.error("Sentry issue events error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handleSentryStats = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(
      event,
      "SENTRY_AUTH_TOKEN",
      "Sentry",
    );
    if (missing) return missing;
    try {
      const { orgSlug, statsPeriod, category } = getQuery(event);
      const stats = await getOrganizationStats(
        statsPeriod as string | undefined,
        category as string | undefined,
        orgSlug as string | undefined,
      );
      return stats;
    } catch (err: any) {
      console.error("Sentry stats error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});
