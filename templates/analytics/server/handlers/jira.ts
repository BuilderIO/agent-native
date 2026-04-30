import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../lib/credentials";
import {
  searchIssues,
  getIssue,
  getProjects,
  getStatuses,
  getBoards,
  getSprints,
  getAnalytics,
} from "../lib/jira";

async function requireJiraCredentials(
  event: Parameters<typeof requireCredential>[0],
) {
  return (
    (await requireCredential(event, "JIRA_BASE_URL", "Jira")) ||
    (await requireCredential(event, "JIRA_USER_EMAIL", "Jira")) ||
    (await requireCredential(event, "JIRA_API_TOKEN", "Jira"))
  );
}

export const handleJiraSearch = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireJiraCredentials(event);
    if (missing) return missing;
    try {
      const { jql, maxResults: maxResultsParam } = getQuery(event);
      if (!jql) {
        setResponseStatus(event, 400);
        return { error: "jql query parameter is required" };
      }
      const maxResults = parseInt(maxResultsParam as string) || 50;
      const result = await searchIssues(jql as string, undefined, maxResults);
      return result;
    } catch (err: any) {
      console.error("Jira search error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

export const handleJiraIssue = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireJiraCredentials(event);
    if (missing) return missing;
    try {
      const { key } = getQuery(event);
      if (!key) {
        setResponseStatus(event, 400);
        return { error: "key query parameter is required" };
      }
      const issue = await getIssue(key as string);
      return { issue };
    } catch (err: any) {
      console.error("Jira issue error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

export const handleJiraProjects = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireJiraCredentials(event);
    if (missing) return missing;
    try {
      const projects = await getProjects();
      return { projects, total: projects.length };
    } catch (err: any) {
      console.error("Jira projects error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

export const handleJiraStatuses = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireJiraCredentials(event);
    if (missing) return missing;
    try {
      const { project } = getQuery(event);
      const statuses = await getStatuses(project as string | undefined);
      return { statuses, total: statuses.length };
    } catch (err: any) {
      console.error("Jira statuses error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

export const handleJiraBoards = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireJiraCredentials(event);
    if (missing) return missing;
    try {
      const boards = await getBoards();
      return { boards, total: boards.length };
    } catch (err: any) {
      console.error("Jira boards error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

export const handleJiraSprints = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireJiraCredentials(event);
    if (missing) return missing;
    try {
      const { boardId: boardIdParam } = getQuery(event);
      const boardId = parseInt(boardIdParam as string);
      if (!boardId) {
        setResponseStatus(event, 400);
        return { error: "boardId query parameter is required" };
      }
      const sprints = await getSprints(boardId);
      return { sprints, total: sprints.length };
    } catch (err: any) {
      console.error("Jira sprints error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

export const handleJiraAnalytics = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireJiraCredentials(event);
    if (missing) return missing;
    try {
      const { projects: projectsParam, days: daysParam } = getQuery(event);
      const projects = projectsParam
        ? (projectsParam as string).split(",").map((p) => p.trim())
        : [];
      const days = parseInt(daysParam as string) || 30;
      const analytics = await getAnalytics(projects, days);
      return analytics;
    } catch (err: any) {
      console.error("Jira analytics error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);
