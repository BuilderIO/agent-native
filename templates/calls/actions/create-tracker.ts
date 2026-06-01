/**
 * Create a new tracker definition in the current workspace.
 *
 * Usage:
 *   pnpm action create-tracker --name="Pricing" --kind=keyword --keywords='["price","pricing","cost"]'
 *   pnpm action create-tracker --name="Objections" --kind=smart --classifierPrompt="Is the prospect raising an objection?"
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { nanoid, resolveWorkspaceIdForAction } from "../server/lib/calls.js";
import { writeAppState } from "@agent-native/core/application-state";

const KeywordArray = z.array(z.string().min(1));

export default defineAction({
  description:
    "Create a tracker definition. kind='keyword' requires keywords[]; kind='smart' requires classifierPrompt. Color defaults to #111111.",
  schema: z.object({
    name: z.string().min(1).max(80).describe("Display name"),
    description: z.string().max(500).optional().describe("Short description"),
    kind: z
      .enum(["keyword", "smart"])
      .default("keyword")
      .describe("Tracker type"),
    keywords: z
      .union([z.string(), KeywordArray])
      .optional()
      .describe(
        "For kind=keyword: array of phrases — JSON-encoded string (CLI) or array (agent).",
      ),
    classifierPrompt: z
      .string()
      .min(1)
      .optional()
      .describe(
        "For kind=smart: the classifier criterion the agent will apply per-paragraph.",
      ),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#111111")
      .describe("Hex color"),
    workspaceId: z
      .string()
      .optional()
      .describe(
        "Workspace id; defaults to the current-workspace app-state value.",
      ),
  }),
  run: async (args) => {
    let keywords: string[] = [];
    if (args.kind === "keyword") {
      if (args.keywords === undefined) {
        throw new Error("kind='keyword' requires --keywords");
      }
      if (typeof args.keywords === "string") {
        let raw: unknown;
        try {
          raw = JSON.parse(args.keywords);
        } catch {
          raw = args.keywords
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        keywords = KeywordArray.parse(raw);
      } else {
        keywords = KeywordArray.parse(args.keywords);
      }
      keywords = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
      if (keywords.length === 0) {
        throw new Error("kind='keyword' requires at least one keyword");
      }
    }
    if (args.kind === "smart") {
      if (!args.classifierPrompt || args.classifierPrompt.trim().length === 0) {
        throw new Error("kind='smart' requires --classifierPrompt");
      }
    }

    const db = getDb();
    const workspaceId = await resolveWorkspaceIdForAction({
      workspaceId: args.workspaceId,
      minRole: "creator-lite",
    });

    const id = nanoid();
    const nowIso = new Date().toISOString();

    await db.insert(schema.trackerDefinitions).values({
      id,
      workspaceId,
      name: args.name.trim(),
      description: args.description?.trim() ?? "",
      kind: args.kind,
      keywordsJson: JSON.stringify(keywords),
      classifierPrompt:
        args.kind === "smart" ? args.classifierPrompt!.trim() : null,
      color: args.color,
      isDefault: false,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created tracker ${id} "${args.name}" (${args.kind})`);
    return {
      id,
      workspaceId,
      name: args.name.trim(),
      kind: args.kind,
      keywords,
      classifierPrompt:
        args.kind === "smart" ? args.classifierPrompt!.trim() : null,
      color: args.color,
    };
  },
});
