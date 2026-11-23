import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { resourcePath } from "../app/lib/navigation-contract.js";
import { findProjectsByTitle } from "../server/lib/find-project-by-title.js";
import { requireReadableProject } from "../server/lib/project-action-access.js";
import { pickProjectByQuestion } from "../server/lib/project-title-match.js";

export default defineAction({
  description:
    "Resolve the project a Home 'open project <title>' request names, so the UI can land on it without starting a conversation. Reads only; never opens or creates anything.",
  schema: z
    .object({
      title: z.string().trim().min(1).max(200).describe("Project title."),
      question: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe(
          "The whole question the title came from. Used only to pick one of several projects whose titles match.",
        ),
    })
    .strict(),
  outputSchema: z.union([
    z.object({
      status: z.literal("found"),
      projectId: z.string(),
      title: z.string(),
      href: z.string().startsWith("/"),
    }),
    z.object({ status: z.enum(["none", "ambiguous"]) }),
  ]),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ title, question }) => {
    const matches = await findProjectsByTitle(title);
    if (matches.length === 0) return { status: "none" as const };
    const only = question
      ? pickProjectByQuestion(matches, question)
      : matches.length === 1
        ? matches[0]
        : undefined;
    if (!only) return { status: "ambiguous" as const };
    try {
      await requireReadableProject(only.id);
    } catch {
      return { status: "none" as const };
    }
    return {
      status: "found" as const,
      projectId: only.id,
      title: only.title,
      href: resourcePath("project", only.id),
    };
  },
});
