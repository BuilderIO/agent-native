import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readBrainScreen } from "../server/lib/brain.js";
import {
  listIntelligence,
  readPriorities,
  getEntityGraph,
} from "../server/lib/intelligence.js";
import {
  listPersonalMemories,
  listRecipes,
} from "../server/lib/personal-intelligence.js";
import { readBrainHealth } from "./get-brain-health.js";
import {
  readDistillationQueue,
  type ListDistillationQueueArgs,
} from "./list-distillation-queue.js";

const queueStatuses = ["queued", "processing", "done", "failed"] as const;
const queueIssues = ["all", "failed", "stale", "retryable"] as const;

export default defineAction({
  description:
    "See what the user is currently looking at in Brain, including selected source/capture/knowledge and recent lists.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  mcpTool: "search",
  run: async () => {
    const screen = await readBrainScreen();
    const navigation = (screen as { navigation?: unknown }).navigation;
    screen.brainHealth = await readBrainHealth();
    if (
      navigation &&
      typeof navigation === "object" &&
      (navigation as { view?: unknown }).view === "intelligence"
    ) {
      const nav = navigation as Record<string, unknown>;
      const params = searchParamsFromPath(nav.path);
      const tab =
        stringValue(nav.intelligenceTab) ?? params.get("tab") ?? "actions";
      const query = stringValue(nav.query) ?? params.get("q") ?? undefined;
      const owner = stringValue(nav.owner) ?? params.get("owner");
      const id =
        stringValue(nav.intelligenceId) ?? params.get("intelligenceId");
      const status =
        (nav.status ?? params.get("status")) === "completed"
          ? "completed"
          : (nav.status ?? params.get("status")) === "dismissed"
            ? "dismissed"
            : "open";
      screen.intelligence =
        tab === "brief"
          ? await readPriorities({
              ...(owner ? { owner } : {}),
              period:
                (nav.period ?? params.get("period")) === "weekly"
                  ? "weekly"
                  : "daily",
              limit: 50,
            })
          : tab === "entities"
            ? await getEntityGraph({ ...(query ? { query } : {}), limit: 50 })
            : tab === "memory"
              ? await listPersonalMemories()
              : tab === "recipes"
                ? await listRecipes()
                : await listIntelligence({
                    ...(query ? { query } : {}),
                    ...(id ? { id } : { status }),
                    limit: 50,
                  });
    }
    if (
      navigation &&
      typeof navigation === "object" &&
      (navigation as { view?: unknown }).view === "ops"
    ) {
      screen.distillationQueue = await readDistillationQueue(
        opsQueueArgs(navigation as Record<string, unknown>),
      );
    }
    return screen;
  },
});

function opsQueueArgs(
  navigation: Record<string, unknown>,
): ListDistillationQueueArgs {
  const params = searchParamsFromPath(navigation.path);
  const status = stringValue(navigation.status) ?? params.get("status");
  const issue =
    params.get("stale") === "true" ? "stale" : (params.get("issue") ?? "all");
  return {
    status: queueStatuses.some((item) => item === status)
      ? (status as ListDistillationQueueArgs["status"])
      : undefined,
    issue: queueIssues.some((item) => item === issue)
      ? (issue as ListDistillationQueueArgs["issue"])
      : "all",
    sourceId: stringValue(navigation.sourceId) ?? undefined,
    limit: clampLimit(navigation.limit, params.get("limit")),
  };
}

function searchParamsFromPath(value: unknown) {
  if (typeof value !== "string") return new URLSearchParams();
  const queryStart = value.indexOf("?");
  if (queryStart === -1) return new URLSearchParams();
  return new URLSearchParams(value.slice(queryStart + 1));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function clampLimit(navigationLimit: unknown, queryLimit: string | null) {
  const value =
    typeof navigationLimit === "number"
      ? navigationLimit
      : Number.parseInt(queryLimit ?? "", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 50) : 25;
}
