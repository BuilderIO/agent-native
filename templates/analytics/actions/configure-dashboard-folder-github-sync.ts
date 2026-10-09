import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  configureFolderSync,
  syncCallerFromRequest,
} from "../server/lib/dashboard-github-sync/folder-sync";

const linkSchema = z.object({
  owner: z.string().min(1).describe("GitHub owner: a user or organization"),
  repo: z.string().min(1).describe("GitHub repository name"),
  branch: z
    .string()
    .optional()
    .describe("Branch to read from and open export PRs against. Defaults to main."),
  path: z
    .string()
    .optional()
    .describe(
      "Repo folder holding one <dashboardId>.json per dashboard. Defaults to dashboards.",
    ),
});

export default defineAction({
  description:
    "Link a dashboard folder to a GitHub repo folder for sync, or unlink it by passing link null. " +
    "Linking or unlinking clears each dashboard's sync base, so the next preview starts from scratch. " +
    "Stores no credentials: the GitHub connection is set up separately.",
  schema: z.object({
    folderId: z.string().min(1).describe("Dashboard folder ID"),
    link: linkSchema.nullable().describe("GitHub link, or null to unlink"),
  }),
  http: { method: "POST" },
  run: async ({ folderId, link }) =>
    configureFolderSync(folderId, syncCallerFromRequest(), link),
});
