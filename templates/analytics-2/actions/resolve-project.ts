import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import {
  listProjectRows,
  projectIdsWithSqlCell,
} from "../server/model/projects-store.js";
import { foldText } from "../shared/text-fold.js";

const CANDIDATE_LIMIT = 5;
const QUERY_SCAN_LIMIT = 100;

const candidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});

export default defineAction({
  mcpTool: true,
  description:
    "Turn a vague project reference into one project id before writing. which=current is the project open on screen; which=recent is the one edited last; which=newest is the one created last; which=recent-query is the last edited one with a SQL cell ('that query' when nothing is open); reference is part of a title. Returns resolved, or ambiguous with a question and candidates to ask the person, or none. Never guess between candidates.",
  schema: z
    .object({
      which: z.enum(["current", "recent", "newest", "recent-query"]).optional(),
      reference: z.string().trim().min(1).max(200).optional(),
    })
    .strict()
    .refine(
      ({ which, reference }) =>
        (which === undefined) !== (reference === undefined),
      { message: "Give exactly one of which or reference." },
    ),
  outputSchema: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("resolved"),
      source: z.enum(["screen", "recent", "newest", "recent-query", "title"]),
      project: candidateSchema,
    }),
    z.object({
      status: z.literal("ambiguous"),
      question: z.string(),
      candidates: z.array(candidateSchema).max(CANDIDATE_LIMIT),
      matches: z.number().int().positive(),
    }),
    z.object({
      status: z.literal("none"),
      message: z.string(),
      recent: candidateSchema.optional(),
    }),
  ]),
  http: false,
  readOnly: true,
  run: async ({ which, reference }) => {
    const current = await requireCurrentWorkspace();
    const rows = await listProjectRows({
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
      archived: false,
    });
    const summary = (project: (typeof rows)[number]) => ({
      id: project.id,
      title: project.title,
      updatedAt: project.updatedAt,
    });

    if (which === "current") {
      const navigation = await readAppState("navigation");
      const open =
        navigation?.resourceKind === "project"
          ? rows.find(({ id }) => id === navigation.resourceId)
          : undefined;
      const recent = rows.at(0);
      return open
        ? {
            status: "resolved" as const,
            source: "screen" as const,
            project: summary(open),
          }
        : {
            status: "none" as const,
            message:
              "No project is open on screen. `recent` is the project edited last: confirm it with the person before editing it, or ask which project.",
            ...(recent === undefined ? {} : { recent: summary(recent) }),
          };
    }

    if (which === "recent-query") {
      const recent = rows.slice(0, QUERY_SCAN_LIMIT);
      const withQuery = await projectIdsWithSqlCell(recent.map(({ id }) => id));
      const first = recent.find(({ id }) => withQuery.has(id));
      return first === undefined
        ? {
            status: "none" as const,
            message: `None of the ${recent.length} most recently edited projects has a SQL cell. Ask which query the person means.`,
          }
        : {
            status: "resolved" as const,
            source: "recent-query" as const,
            project: summary(first),
          };
    }

    if (which !== undefined) {
      const ordered =
        which === "recent"
          ? rows
          : [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const first = ordered.at(0);
      return first === undefined
        ? {
            status: "none" as const,
            message: "This workspace has no projects.",
          }
        : {
            status: "resolved" as const,
            source: which,
            project: summary(first),
          };
    }

    const needle = foldText(reference ?? "");
    const matches = rows.filter((project) =>
      foldText(project.title).includes(needle),
    );
    const exact = matches.filter(
      (project) => foldText(project.title.trim()) === needle,
    );
    const chosen = exact.length === 1 ? exact : matches;
    const only = chosen.at(0);
    if (only === undefined)
      return {
        status: "none" as const,
        message: "No project title matches that reference.",
      };
    if (chosen.length === 1)
      return {
        status: "resolved" as const,
        source: "title" as const,
        project: summary(only),
      };
    return {
      status: "ambiguous" as const,
      question: `${chosen.length} projects match. Which one do you mean?`,
      candidates: chosen.slice(0, CANDIDATE_LIMIT).map(summary),
      matches: chosen.length,
    };
  },
});
