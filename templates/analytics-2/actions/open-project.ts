import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { resourcePath } from "../app/lib/navigation-contract.js";
import {
  agentNavigationSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import { findProjectsByTitle } from "../server/lib/find-project-by-title.js";
import { pickProjectByQuestion } from "../server/lib/project-title-match.js";

const errors = defineActionErrors("project_not_found", "project_ambiguous");

export default defineAction({
  mcpTool: true,
  description:
    "Open a project (dashboard) by its name in one step: resolves the name on the server and navigates the current tab straight to it. Prefer this for 'show me', 'open', or 'take me to' the <name> dashboard, board, or project, and for questions about a named dashboard (\"How's my metrics doing in my V3 dashboard?\"). Never call search-workspace to find a known dashboard: that opens the search UI; this call lands on the dashboard itself.",
  schema: z
    .object({
      name: z.string().trim().min(1).describe("Project title to open."),
      question: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe(
          "Optional full user question to disambiguate when multiple projects match name.",
        ),
      intent: z.literal("open").default("open"),
    })
    .strict(),
  outputSchema: z.object({
    projectId: z.string(),
    title: z.string(),
    path: z.string(),
    navigation: agentNavigationSchema.optional(),
  }),
  errors,
  http: false,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ name, question }, context) => {
    const matches = await findProjectsByTitle(name);
    const project =
      matches.length === 1
        ? matches[0]
        : matches.length > 1 && question
          ? pickProjectByQuestion(matches, question)
          : undefined;
    if (matches.length === 0)
      return errors.fail(
        `No project is named "${name}". Use search-workspace to look for it; do not create a project to open one.`,
        "project_not_found",
      );
    if (matches.length > 1 && !project)
      return errors.fail(
        `${matches.length} projects match "${name}": ${matches
          .slice(0, 5)
          .map((p) => `"${p.title}" (${p.id})`)
          .join(", ")}. Open one with navigate and its projectId.`,
        "project_ambiguous",
      );
    if (!project)
      return errors.fail(
        `No project is named "${name}". Use search-workspace to look for it; do not create a project to open one.`,
        "project_not_found",
      );
    return {
      projectId: project.id,
      title: project.title,
      path: resourcePath("project", project.id),
      ...(await showAgentProject(context, project.id, "open")),
    };
  },
});
