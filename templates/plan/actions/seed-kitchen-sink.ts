import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import createVisualPlan from "./create-visual-plan.js";
import { getDb, schema } from "../server/db/index.js";
import type { PlanContent } from "../shared/plan-content.js";

/**
 * DEV-ONLY one-off seed: creates a real, persisted plan that exercises every
 * diff-aware block (change-aware data-model + api-endpoint, annotated unified +
 * split diffs, file-tree badges, annotated-code) and makes it public so it can
 * be opened at /plans/<id> without a session. Run against a throwaway local
 * SQLite DB; safe to delete.
 */

const DM_FIELD_BEFORE = `export interface DataModelField {
  name: string;
  type?: string;
  pk?: boolean;
  nullable?: boolean;
}`;

const DM_FIELD_AFTER = `export interface DataModelField {
  name: string;
  type?: string;
  pk?: boolean;
  nullable?: boolean;
  change?: "added" | "modified" | "removed" | "renamed";
  was?: string;
}`;

const AUTH_BEFORE = `export function getSession(req: Request) {
  const token = readBearer(req);
  return verifyLegacy(token);
}`;

const AUTH_AFTER = `export function getSession(req: Request) {
  const token = readBearer(req);
  const aud = audienceFor(req);
  return verifyMcp(token, aud);
}`;

const ANNOTATED_CODE = `export function verify(token: string) {
  const decoded = jwt.decode(token);
  return decoded.userId;
}`;

const content: PlanContent = {
  version: 1,
  title: "Diff blocks — kitchen sink",
  brief:
    "Every diff-aware capability: change-aware data-model + api-endpoint, annotated unified/split diffs, file-tree badges, and the shared annotation rail.",
  blocks: [
    {
      id: "h-schema",
      type: "rich-text",
      data: {
        markdown:
          "## 1 · Schema diff — `data-model` change flags\n\nPer-field and per-entity `change` chips (reusing file-tree's vocabulary), strikethrough for removed, and `was → type` for modified.",
      },
    },
    {
      id: "dm",
      type: "data-model",
      data: {
        entities: [
          {
            id: "plans",
            name: "plans",
            change: "modified",
            fields: [
              { name: "id", type: "uuid", pk: true },
              { name: "kind", type: "text", change: "added" },
              {
                name: "content",
                type: "jsonb",
                change: "modified",
                was: "text",
              },
              { name: "title", type: "text", change: "renamed", was: "name" },
              { name: "legacy_html", type: "text", change: "removed" },
              { name: "owner_id", type: "uuid", fk: "users.id" },
            ],
          },
          {
            id: "comments",
            name: "comments",
            change: "added",
            fields: [
              { name: "id", type: "uuid", pk: true },
              { name: "plan_id", type: "uuid", fk: "plans.id" },
              { name: "body", type: "text" },
            ],
          },
        ],
        relations: [
          { from: "comments", to: "plans", kind: "1-n", label: "plan_id" },
        ],
      },
    },
    {
      id: "h-api",
      type: "rich-text",
      data: {
        markdown:
          "## 2 · API contract diff — `api-endpoint` change flags\n\nChange markers on the route, params, and responses; `optional → required` for a modified param.",
      },
    },
    {
      id: "ep",
      type: "api-endpoint",
      data: {
        method: "POST",
        path: "/_agent-native/actions/:name",
        summary: "Invoke an app action",
        change: "modified",
        params: [
          { name: "name", in: "path", type: "string", required: true },
          {
            name: "scope",
            in: "query",
            type: "string",
            required: true,
            change: "modified",
            was: "optional",
          },
          { name: "dryRun", in: "query", type: "boolean", change: "added" },
          {
            name: "legacyMode",
            in: "query",
            type: "boolean",
            change: "removed",
          },
        ],
        responses: [
          { status: "200", description: "OK" },
          { status: "409", description: "Conflict", change: "added" },
        ],
      },
    },
    {
      id: "h-unified",
      type: "rich-text",
      data: {
        markdown:
          "## 3 · Annotated diff — unified\n\nLine-anchored notes (after-side) with numbered markers + hover-linked rail.",
      },
    },
    {
      id: "d-unified",
      type: "diff",
      data: {
        filename: "templates/plan/shared/plan-content.ts",
        language: "ts",
        mode: "unified",
        before: DM_FIELD_BEFORE,
        after: DM_FIELD_AFTER,
        annotations: [
          {
            lines: "6",
            label: "change",
            note: "New per-field diff flag — reuses file-tree's added/modified/removed/renamed vocabulary.",
          },
          {
            lines: "7",
            label: "was",
            note: "Holds the prior value (e.g. the old column type) for a modified field.",
          },
        ],
      },
    },
    {
      id: "h-split",
      type: "rich-text",
      data: {
        markdown:
          '## 4 · Annotated diff — split\n\nSame annotations in side-by-side mode, including a `side: "before"` note on a removed line.',
      },
    },
    {
      id: "d-split",
      type: "diff",
      data: {
        filename: "server/plugins/auth.ts",
        language: "ts",
        mode: "split",
        before: AUTH_BEFORE,
        after: AUTH_AFTER,
        annotations: [
          {
            lines: "3",
            label: "audience",
            note: "Resolve the audience so the token can be scoped per app.",
          },
          {
            lines: "4",
            note: "Bearer path now routes through MCP verify so connect-minted tokens work.",
          },
          {
            side: "before",
            lines: "3",
            label: "removed",
            note: "Legacy verifier dropped.",
          },
        ],
      },
    },
    {
      id: "h-files",
      type: "rich-text",
      data: {
        markdown:
          "## 5 · Changed files — `file-tree` badges\n\nThe change vocabulary the other blocks reuse.",
      },
    },
    {
      id: "ft",
      type: "file-tree",
      data: {
        title: "All four change kinds",
        entries: [
          {
            path: "packages/core/src/client/blocks/library/annotation-rail.tsx",
            change: "added",
            note: "Shared marker + note rail.",
          },
          {
            path: "packages/core/src/client/blocks/library/DiffBlock.tsx",
            change: "modified",
            note: "Maps annotations onto the line grid.",
          },
          {
            path: "packages/core/src/client/blocks/library/old-diff-helper.ts",
            change: "removed",
            note: "Folded into annotation-rail.",
          },
          {
            path: "packages/core/src/client/blocks/library/DiffView.tsx",
            change: "renamed",
            note: "→ DiffBlock.tsx",
          },
        ],
      },
    },
    {
      id: "h-annotated",
      type: "rich-text",
      data: {
        markdown:
          "## 6 · `annotated-code` — the shared rail in its native block\n\nThe same marker + note rail `diff` now reuses.",
      },
    },
    {
      id: "ac",
      type: "annotated-code",
      data: {
        filename: "auth.ts",
        language: "ts",
        code: ANNOTATED_CODE,
        annotations: [
          { lines: "2", label: "decode", note: "Decode the JWT payload." },
          { lines: "3", label: "return", note: "Extract the user id." },
        ],
      },
    },
  ],
};

export default defineAction({
  description: "DEV-ONLY: seed a public diff-blocks kitchen-sink plan.",
  agentTool: false,
  schema: z.object({}).optional(),
  run: async () => {
    if (process.env.NODE_ENV !== "development") {
      throw new Error(
        "seed actions are dev-only and disabled in production (NODE_ENV must be 'development')",
      );
    }
    const result = (await createVisualPlan.run({
      title: "Diff blocks — kitchen sink",
      brief: content.brief,
      source: "manual",
      status: "review",
      content,
      sections: [],
      comments: [],
    } as never)) as { planId: string };

    const planId = result.planId;
    // Make it public so it opens at /plans/<id> without a session.
    await getDb()
      .update(schema.plans)
      .set({ visibility: "public" })
      .where(eq(schema.plans.id, planId));

    console.log("SEEDED_PLAN_ID:", planId);
    console.log("OPEN: /plans/" + planId);
    return { planId, path: "/plans/" + planId };
  },
});
