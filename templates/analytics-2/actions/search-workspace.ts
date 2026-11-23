import { isAgentCaller } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { navigateAfterWrite } from "@agent-native/core/application-state";
import { getThread, listThreads } from "@agent-native/core/server";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfilesWithStatus } from "@agent-native/core/user-profile/server";
import { z } from "zod";

import { workspaceChatScope } from "../app/lib/workspace-chat-scope.js";
import {
  agentNavigationSchema,
  agentOpenIntentSchema,
} from "../server/agent-navigation.js";
import {
  currentApplicationId,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { readProjectCategories } from "../server/model/project-categories.js";
import type { ProjectAccessLevel } from "../server/model/project-grant-access.js";
import {
  getReadableProjectDocument,
  listWorkspaceVisibleProjects,
  projectIdsWithMatchingCellText,
} from "../server/model/projects-store.js";
import { cellSearchText } from "../shared/cell-search-text.js";
import { WORKSPACE_SEARCH_TEXT_MAX_LENGTH } from "../shared/search-limits.js";
import { foldText } from "../shared/text-fold.js";

const SEARCH_CONCURRENCY = 8;
const THREAD_SEARCH_MAX_PAGES = 4;
const THREAD_SEARCH_MAX_BODY_SCANS = 20;
const RECENT_PROJECT_LIMIT = 10;

async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as T, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
  return results;
}

function searchRoutePath(text: string): string {
  const trimmed = text.trim();
  return trimmed
    ? `/home/search?q=${encodeURIComponent(trimmed)}`
    : "/home/search";
}

const projectResult = z.object({
  kind: z.literal("project"),
  id: z.string(),
  title: z.string(),
  href: z.string(),
  updatedAt: z.string(),
  description: z.string(),
  ownerName: z.string(),
  accessLabel: z.string().optional(),
  archived: z.boolean(),
  publishedAppHref: z.string().optional(),
  cellMatches: z.array(
    z.object({
      cellId: z.string(),
      cellKind: z.enum(["sql", "python", "r", "markdown", "text", "chart"]),
      snippet: z.string(),
    }),
  ),
});

function extractMatchingSnippet(text: string, foldedQuery: string): string {
  if (!text.includes("\n")) return text;
  const line = text
    .split(/\r?\n/)
    .find((candidate) => foldText(candidate).includes(foldedQuery));
  return line ? line.trim() : text;
}

function accessLabelFor(
  level: ProjectAccessLevel | undefined,
  isOwner: boolean,
): string | undefined {
  const effective = level ?? (isOwner ? "owner" : undefined);
  switch (effective) {
    case "owner":
    case "manage":
      return "Full access";
    case "edit":
      return "Can edit";
    case "read":
      return "Can view";
    default:
      return undefined;
  }
}
const threadResult = z.object({
  kind: z.literal("thread"),
  id: z.string(),
  title: z.string(),
  href: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
});

const optionalDateStringSchema = z
  .string()
  .nullable()
  .default(null)
  .refine(
    (value) =>
      value === null ||
      value.trim() === "" ||
      Number.isFinite(Date.parse(value.trim())),
    "Invalid date string",
  );

const THREAD_TEXT_KEYS = new Set([
  "text",
  "content",
  "prompt",
  "message",
  "title",
  "summary",
]);

function collectThreadText(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (value) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectThreadText(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string") {
      if (THREAD_TEXT_KEYS.has(key) && nested) out.push(nested);
    } else if (nested && typeof nested === "object") {
      collectThreadText(nested, out);
    }
  }
}

function extractThreadSearchableText(threadData: string): string {
  try {
    const parsed: unknown = JSON.parse(threadData);
    const chunks: string[] = [];
    collectThreadText(parsed, chunks);
    return chunks.join(" ");
  } catch {
    return threadData;
  }
}

export default defineAction({
  mcpTool: true,
  description:
    'Search owned projects, saved cell text and conversations in the active workspace. Use for topic discovery (e.g. "find notebooks about revenue"); pass intent: "open" to open /home/search?q=... in the current tab. For a specifically named dashboard/project, call open-project instead.',
  schema: z
    .object({
      text: z.string().max(WORKSPACE_SEARCH_TEXT_MAX_LENGTH).default(""),
      fields: z
        .array(z.enum(["title", "description", "cellContents"]))
        .default(["title", "description", "cellContents"]),
      dateRange: z.enum(["24h", "7d", "30d", "90d"]).nullable().default(null),
      dateFrom: optionalDateStringSchema,
      dateTo: optionalDateStringSchema,
      // The date filter's own field selector: the reference lets the days narrow either the
      // last-edited time or the created time, with "Last edited" chosen first.
      dateField: z.enum(["lastEdited", "created"]).default("lastEdited"),
      projectsOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Return only projects when true; otherwise include conversations.",
        ),
      includeArchived: z.boolean().default(false),
      creatorIds: z.array(z.string()).default([]),
      categoryIds: z.array(z.string()).default([]),
      statusIds: z.array(z.string()).default([]),
      intent: agentOpenIntentSchema.describe(
        'Pass "open" to open /home/search?q=... in the current tab when asked to find, search, or show matching work.',
      ),
    })
    .strict(),
  http: { method: "GET" },
  readOnly: true,
  retrySafe: true,
  // Calls with intent: "open" queue a tab navigation command, so classify only
  // those calls as writes while keeping plain UI and background searches read-only.
  planMode: {
    effect: (input) => (input?.intent === "open" ? "write" : "read"),
  },
  persistInBrowser: false,
  outputSchema: z.object({
    results: z.array(
      z.discriminatedUnion("kind", [projectResult, threadResult]),
    ),
    navigation: agentNavigationSchema.optional(),
  }),
  run: async (input, context) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    const query = foldText(input.text.trim());
    const days =
      input.dateRange === "24h"
        ? 1
        : input.dateRange
          ? Number.parseInt(input.dateRange)
          : null;
    const threshold = days === null ? null : Date.now() - days * 86_400_000;
    // A typed range wins over a preset: it names exact days, end day included.
    const typedFrom = input.dateFrom ? Date.parse(input.dateFrom) : Number.NaN;
    const typedTo = input.dateTo
      ? /^\d{4}-\d{2}-\d{2}$/.test(input.dateTo.trim())
        ? Date.parse(`${input.dateTo.trim()}T23:59:59.999Z`)
        : Date.parse(input.dateTo)
      : Number.NaN;
    const customSince = Number.isFinite(typedFrom) ? typedFrom : null;
    const customUntil = Number.isFinite(typedTo) ? typedTo : null;
    // Whatever the field selector names is the timestamp the typed days compare against; a row
    // without a created time falls back to the last-edited time the store always has.
    const fieldDate = (
      createdAt: string | number | null | undefined,
      updatedAt: string | number,
    ): string | number =>
      input.dateField === "created" && createdAt ? createdAt : updatedAt;
    const matchesDate = (date: string | number) => {
      const at = new Date(date).getTime();
      if (customSince !== null && at < customSince) return false;
      if (customUntil !== null && at > customUntil) return false;
      if (customSince !== null || customUntil !== null) return true;
      return threshold === null || at >= threshold;
    };
    const allProjects = await listWorkspaceVisibleProjects(scope);
    const isSearching =
      !!query ||
      !!input.dateRange ||
      customSince !== null ||
      customUntil !== null ||
      input.includeArchived ||
      !!input.creatorIds.length ||
      !!input.categoryIds.length ||
      !!input.statusIds.length;
    const projects = isSearching
      ? allProjects
      : allProjects
          .filter((project) => !project.archivedAt && !!project.lastOpenedAt)
          .sort((a, b) =>
            (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""),
          )
          .slice(0, RECENT_PROJECT_LIMIT);
    const results: Array<
      z.infer<typeof projectResult> | z.infer<typeof threadResult>
    > = [];
    const ownCreator = new Set(
      [current.ownerEmail, current.request.authUserId].filter(Boolean),
    );
    // A creator filter names the person who owns the project, so a selected
    // member either matches the row's owner or removes the row. The caller's
    // own id and email both address the caller.
    const creatorMatches = (ownerEmail: string) =>
      !input.creatorIds.length ||
      input.creatorIds.some(
        (id) =>
          id === ownerEmail ||
          (ownerEmail === current.ownerEmail && ownCreator.has(id)),
      );
    // Categories are project assignments in this workspace, not a label on the
    // project row: read the assignments once and match the selected ids.
    const categoriesByProject = input.categoryIds.length
      ? new Map(
          (await readProjectCategories(scope)).map((assignment) => [
            assignment.projectId,
            assignment.categoryIds,
          ]),
        )
      : null;
    const categoryMatches = (projectId: string) =>
      categoriesByProject === null ||
      (categoriesByProject.get(projectId) ?? []).some((id) =>
        input.categoryIds.includes(id),
      );
    const navigationPromise =
      input.intent === "open" && isAgentCaller(context?.caller)
        ? navigateAfterWrite(
            { path: searchRoutePath(input.text) },
            { ctx: context, intent: "open" },
          )
            .then(
              (result): z.infer<typeof agentNavigationSchema> =>
                result.navigated
                  ? { status: "requested" }
                  : result.reason === "agent-keeps-view"
                    ? { status: "kept" }
                    : { status: "unavailable", reason: "browser_tab_missing" },
            )
            .catch(
              (): z.infer<typeof agentNavigationSchema> => ({
                status: "unavailable",
                reason: "command_write_failed",
              }),
            )
        : Promise.resolve(undefined);

    const eligibleProjects = projects.filter(
      (project) =>
        (input.includeArchived || !project.archivedAt) &&
        matchesDate(
          fieldDate(
            project.createdAt,
            project.userUpdatedAt ?? project.updatedAt,
          ),
        ) &&
        creatorMatches(project.ownerEmail) &&
        categoryMatches(project.id) &&
        (!input.statusIds.length ||
          input.statusIds.includes(project.statusId ?? "")),
    );

    const searchProjects = async () => {
      const searchCells = Boolean(
        query && input.fields.includes("cellContents"),
      );
      const ownerEmails = [
        ...new Set(eligibleProjects.map((project) => project.ownerEmail)),
      ];
      const [cellCandidates, profileResult] = await Promise.all([
        searchCells
          ? projectIdsWithMatchingCellText(scope, eligibleProjects, (text) =>
              foldText(text).includes(query),
            )
          : Promise.resolve(null),
        ownerEmails.length > 0
          ? getUserProfilesWithStatus(ownerEmails)
          : Promise.resolve({
              profiles: new Map<string, { name: string }>(),
              incomplete: false,
            }),
      ]);
      const ownerDisplayName = (ownerEmail: string): string => {
        const profileName = profileResult.profiles
          .get(ownerEmail.toLowerCase())
          ?.name.trim();
        if (profileName && !isEmailDerivedName(profileName, ownerEmail)) {
          return profileName;
        }
        if (ownerEmail.toLowerCase() === current.ownerEmail.toLowerCase()) {
          const requestName = current.request.userName?.trim();
          if (requestName && !isEmailDerivedName(requestName, ownerEmail)) {
            return requestName;
          }
        }
        return "";
      };
      const projectRows = await mapConcurrent(
        eligibleProjects,
        SEARCH_CONCURRENCY,
        async (project): Promise<z.infer<typeof projectResult> | null> => {
          const cellMatches: z.infer<typeof projectResult>["cellMatches"] = [];
          let match =
            !query ||
            (input.fields.includes("title") &&
              foldText(project.title).includes(query)) ||
            (input.fields.includes("description") &&
              foldText(project.description).includes(query));
          if (cellCandidates?.has(project.id)) {
            const document = await getReadableProjectDocument(
              scope,
              project.id,
            );
            for (const cell of document?.cells ?? []) {
              const contents = cell.contents;
              const text = cellSearchText(contents);
              if (text === null || !foldText(text).includes(query)) continue;
              const kind =
                contents.kind === "code" ? contents.language : contents.kind;
              if (
                !["sql", "python", "r", "markdown", "text", "chart"].includes(
                  kind,
                )
              )
                continue;
              cellMatches.push({
                cellId: cell.id,
                cellKind: kind as z.infer<
                  typeof projectResult
                >["cellMatches"][number]["cellKind"],
                snippet: extractMatchingSnippet(text, query),
              });
              match = true;
            }
          }
          if (!match) return null;
          const accessLabel = accessLabelFor(
            project.yourAccess,
            project.ownerEmail.trim().toLowerCase() ===
              current.ownerEmail.trim().toLowerCase(),
          );
          return {
            kind: "project",
            id: project.id,
            title: project.title,
            href: `/project/${encodeURIComponent(project.id)}/latest`,
            updatedAt: project.userUpdatedAt ?? project.updatedAt,
            description: project.description,
            ownerName: ownerDisplayName(project.ownerEmail),
            ...(accessLabel ? { accessLabel } : {}),
            archived: !!project.archivedAt,
            ...(project.publishedVersionId
              ? {
                  publishedAppHref: `/app/${encodeURIComponent(project.id)}/latest`,
                }
              : {}),
            cellMatches,
          };
        },
      );
      return projectRows.filter(
        (row): row is z.infer<typeof projectResult> => row !== null,
      );
    };

    // Walk the framework's pages before filtering the active organization. Its
    // organization option is an ACL context and includes other owned work.
    const appId = currentApplicationId(context);
    const pageSize = 50;
    // Conversation results answer the same text query under the filters: a
    // date, category or status filter narrows projects, it does not silence
    // the caller's own conversations. A creator filter that names someone else
    // does exclude them.
    const threadCreatorAllowed =
      !input.creatorIds.length ||
      input.creatorIds.some((id) => ownCreator.has(id));

    const searchThreads = async () => {
      const matched: Array<z.infer<typeof threadResult>> = [];
      if (input.projectsOnly || !query || !threadCreatorAllowed) return matched;
      let bodyScans = 0;
      for (
        let pageIndex = 0, offset = 0;
        pageIndex < THREAD_SEARCH_MAX_PAGES;
        pageIndex += 1, offset += pageSize
      ) {
        const options = {
          orgId: current.orgId,
          ownership: "mine" as const,
          includeExternal: false,
          sourceAppId: appId,
          scope: workspaceChatScope(current.orgId, appId),
          includeArchived: input.includeArchived,
          collapseEdits: true,
          offset,
        };
        const page = await listThreads(current.ownerEmail, {
          ...options,
          limit: pageSize,
        });
        const eligible = page.filter(
          (thread) =>
            thread.orgId === current.orgId &&
            matchesDate(fieldDate(thread.createdAt, thread.updatedAt)),
        );
        const bodyCandidates: typeof eligible = [];
        for (const thread of eligible) {
          if (matched.length >= 5) break;
          if (
            foldText(thread.title).includes(query) ||
            foldText(thread.preview).includes(query)
          ) {
            matched.push({
              kind: "thread",
              id: thread.id,
              title: thread.title,
              href: `/thread/${encodeURIComponent(thread.id)}`,
              updatedAt: new Date(thread.updatedAt).toISOString(),
              createdAt: new Date(thread.createdAt).toISOString(),
            });
          } else {
            bodyCandidates.push(thread);
          }
        }
        const remainingScans = input.fields.includes("cellContents")
          ? Math.max(0, THREAD_SEARCH_MAX_BODY_SCANS - bodyScans)
          : 0;
        const candidatesToScan = bodyCandidates.slice(0, remainingScans);
        for (
          let start = 0;
          start < candidatesToScan.length && matched.length < 5;
          start += SEARCH_CONCURRENCY
        ) {
          const chunk = candidatesToScan.slice(
            start,
            start + SEARCH_CONCURRENCY,
          );
          const storedChunk = await Promise.all(
            chunk.map((thread) => getThread(thread.id)),
          );
          for (
            let index = 0;
            index < chunk.length && matched.length < 5;
            index += 1
          ) {
            const thread = chunk[index]!;
            const stored = storedChunk[index];
            const matches =
              !!stored &&
              stored.orgId === current.orgId &&
              stored.ownerEmail.trim().toLowerCase() === current.ownerEmail &&
              stored.source?.appId === appId &&
              foldText(extractThreadSearchableText(stored.threadData)).includes(
                query,
              );
            if (!matches) continue;
            matched.push({
              kind: "thread",
              id: thread.id,
              title: thread.title,
              href: `/thread/${encodeURIComponent(thread.id)}`,
              updatedAt: new Date(thread.updatedAt).toISOString(),
              createdAt: new Date(thread.createdAt).toISOString(),
            });
          }
        }
        bodyScans += candidatesToScan.length;
        if (
          matched.length >= 5 ||
          page.length < pageSize ||
          bodyScans >= THREAD_SEARCH_MAX_BODY_SCANS
        )
          break;
      }
      return matched;
    };

    const [projectResults, threadResults, navigation] = await Promise.all([
      searchProjects(),
      input.projectsOnly === true ? Promise.resolve([]) : searchThreads(),
      navigationPromise,
    ]);
    results.push(...projectResults, ...threadResults);
    if (query) {
      const rank = (result: (typeof results)[number]) => {
        if (result.kind === "project" && !input.fields.includes("title"))
          return 0;
        const title = foldText(result.title.trim());
        if (title === query) return 3;
        if (title.startsWith(query)) return 2;
        return title.includes(query) ? 1 : 0;
      };
      results.sort((a, b) => rank(b) - rank(a));
    }
    return navigation ? { results, navigation } : { results };
  },
});
