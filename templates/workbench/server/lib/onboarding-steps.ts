/**
 * Workbench onboarding step registrations.
 *
 * Templates register steps with the framework onboarding registry; the agent
 * sidebar's setup checklist polls `/_agent-native/onboarding/steps` on every
 * request and renders each step with its current `complete` flag. See the
 * framework `onboarding` skill for the full pattern.
 *
 * Workbench has four steps:
 *
 * 1. **Connect GitHub** (required) — handed off to Dispatch's shared
 *    workspace-integration flow; Workbench never owns its own OAuth client.
 *    Completion is checked via `isGitHubConnected()` from the github helper.
 *
 * 2. **Add a repo to your queue** (required) — links to Workbench's own
 *    Settings page. Completion is satisfied when the user has at least one
 *    row in `workbench_repos` they own.
 *
 * 3. **Connect Sentry** (optional, coming soon in v1.0) — kept in the
 *    registry so the slot is reserved; completion will start firing for
 *    real once the Sentry shared workspace integration ships in v1.1.
 *
 * 4. **Try Custom Tools** (optional) — agent-task method that prompts the
 *    user to build an Alpine extension. Completion checks the physical
 *    `tools` SQL table (Drizzle export `extensions`) for any row scoped to
 *    the current user or their active org. Done via raw SQL because the
 *    framework doesn't expose an `@agent-native/core/extensions/store`
 *    subpath; the `tools` table is created lazily and a missing-table
 *    error is treated as "zero extensions".
 *
 * `isComplete` callbacks run inside `runWithRequestContext({ userEmail,
 * orgId })` (set up by the onboarding plugin), so framework helpers that
 * read `getRequestUserEmail()` / `getRequestOrgId()` work transparently:
 * `accessFilter()`, `listWorkspaceConnections()`, etc. The framework also
 * passes `{ sessionId, userEmail, orgId }` as the callback argument; we
 * destructure those directly so the resolver is self-contained.
 */

import { registerOnboardingStep } from "@agent-native/core/onboarding";
import { listWorkspaceConnections } from "@agent-native/core/workspace-connections";
import { getDbExec } from "@agent-native/core/db";
import { eq, sql } from "drizzle-orm";
import { isGitHubConnected } from "./github-connection.js";
import { getDispatchIntegrationsUrl } from "./dispatch-url.js";
import { getDb, schema } from "../db/index.js";

/**
 * Local mirror of the framework's `OnboardingResolveContext` shape — the
 * argument the registry passes to every `isComplete` callback. Kept inline
 * here because the framework only exports the interface as part of
 * `OnboardingStep`'s signature; we just need the field shape for our default
 * argument fallback.
 */
interface OnboardingContext {
  sessionId: string;
  userEmail?: string;
  orgId?: string | null;
}

const EMPTY_CONTEXT: OnboardingContext = { sessionId: "local" };

/** Dispatch's shared-integration flow deep-linked to GitHub for Workbench. */
const GITHUB_CONNECT_URL = getDispatchIntegrationsUrl({
  provider: "github",
  appId: "workbench",
});

/** Dispatch's shared-integration flow deep-linked to Sentry for Workbench. */
const SENTRY_CONNECT_URL = getDispatchIntegrationsUrl({
  provider: "sentry",
  appId: "workbench",
});

/**
 * Register every Workbench onboarding step with the framework registry.
 * Called once at server boot from `server/plugins/setup-workbench.ts`.
 * Idempotent: re-registering a step with the same `id` overwrites the
 * previous entry (see `registerOnboardingStep` in the framework).
 */
export function registerWorkbenchOnboarding(): void {
  // ── 1. Connect GitHub ──────────────────────────────────────────────────────
  registerOnboardingStep({
    id: "workbench-connect-github",
    order: 10,
    required: true,
    title: "Connect GitHub",
    description:
      "Link your workspace GitHub account so Workbench can show your PRs and CI status.",
    methods: [
      {
        id: "connect-via-dispatch",
        kind: "link",
        primary: true,
        label: "Connect GitHub",
        description:
          "Connect once in Dispatch and grant Workbench access; reused across every workspace app.",
        payload: { url: GITHUB_CONNECT_URL },
      },
      {
        id: "agent-task",
        kind: "agent-task",
        label: "Have the agent set it up for me",
        description:
          "Walks you through connecting GitHub via the workspace integrations flow.",
        payload: {
          prompt:
            "Connect my GitHub account via workspace integrations so Workbench can read my PRs, CI status, and reviews. Use the shared workspace integration (not a Workbench-owned OAuth flow), grant Workbench access, and confirm when the connection is healthy.",
        },
      },
    ],
    isComplete: async (context = EMPTY_CONTEXT) => {
      const { userEmail, orgId } = context;
      if (!userEmail) return false;
      try {
        return await isGitHubConnected(userEmail, orgId ?? "");
      } catch {
        // Workspace-connection tables may not be initialized in some
        // dev/test scenarios. Treat as "not connected" rather than 500ing
        // the whole steps endpoint.
        return false;
      }
    },
  });

  // ── 2. Add a repo to your queue ────────────────────────────────────────────
  registerOnboardingStep({
    id: "workbench-add-repo",
    order: 20,
    required: true,
    title: "Add a repo to your queue",
    description:
      "Pick at least one repo so Workbench knows where to pull PRs from.",
    methods: [
      {
        id: "open-settings",
        kind: "link",
        primary: true,
        label: "Open Settings",
        description: "Add or remove repos from your Workbench queue.",
        payload: { url: "/settings" },
      },
      {
        id: "agent-task",
        kind: "agent-task",
        label: "Ask the agent to add a repo",
        description:
          "Tell the agent which repo to add and it'll do it for you.",
        payload: {
          prompt:
            "Add a repo to my Workbench queue. Ask me which owner/repo to add if you don't know, then save it so my PRs and CI status start showing up in the Attention Queue.",
        },
      },
    ],
    isComplete: async (context = EMPTY_CONTEXT) => {
      const { userEmail } = context;
      if (!userEmail) return false;
      try {
        const db = getDb();
        const normalized = userEmail.trim().toLowerCase();
        // Per-user scoping: workbench_repos.ownerEmail is set from the
        // request context on insert. We're checking "does THIS user have at
        // least one row?", so equality on ownerEmail is the right filter.
        const [row] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.workbenchRepos)
          .where(eq(schema.workbenchRepos.ownerEmail, normalized));
        return Number(row?.count ?? 0) > 0;
      } catch {
        return false;
      }
    },
  });

  // ── 3. Connect Sentry (optional, coming-soon placeholder for v1.0) ─────────
  registerOnboardingStep({
    id: "workbench-connect-sentry",
    order: 30,
    required: false,
    title: "Connect Sentry",
    description:
      "Optional — surface new production errors in your Attention Queue.",
    methods: [
      {
        id: "connect-via-dispatch",
        kind: "link",
        primary: true,
        label: "Connect Sentry",
        description:
          "Connect once in Dispatch and grant Workbench access. Sentry-in-queue lands in v1.1.",
        disabled: true,
        disabledLabel: "Coming soon",
        payload: { url: SENTRY_CONNECT_URL },
      },
      {
        id: "agent-task",
        kind: "agent-task",
        label: "Have the agent set it up for me",
        disabled: true,
        disabledLabel: "Coming soon",
        payload: {
          prompt:
            "Connect my Sentry account via workspace integrations so Workbench can surface new production errors in my Attention Queue. Use the shared workspace integration (not a Workbench-owned OAuth flow) and grant Workbench access.",
        },
      },
    ],
    isComplete: async () => {
      // Future-proof: when the Sentry shared workspace integration ships,
      // a granted+connected workspace connection of provider `sentry`
      // satisfies this step automatically.
      try {
        const connections = await listWorkspaceConnections({
          provider: "sentry",
        });
        return connections.some(
          (connection) => connection.status === "connected",
        );
      } catch {
        return false;
      }
    },
  });

  // ── 4. Try Custom Tools ────────────────────────────────────────────────────
  registerOnboardingStep({
    id: "workbench-try-custom-tools",
    order: 40,
    required: false,
    title: "Try Custom Tools",
    description:
      "Ask the agent to build you a mini-tool — kanban, dashboard, anything.",
    methods: [
      {
        id: "agent-task",
        kind: "agent-task",
        primary: true,
        label: "Ask the agent to build one",
        description:
          "Describe what you want and the agent will scaffold a sandboxed mini-app you can pin to your Workbench.",
        payload: {
          prompt:
            "Build me a custom tool that... (describe what you want — a kanban for my open PRs, a dashboard of CI failures, a sticky-notes board, anything). Use the create-extension action; the tool should be a sandboxed Alpine.js mini-app that lives in my workspace.",
        },
      },
      {
        id: "browse",
        kind: "link",
        label: "Browse my tools",
        description: "Open the Custom Tools room.",
        payload: { url: "/extensions" },
      },
    ],
    isComplete: async (context = EMPTY_CONTEXT) => {
      const { userEmail, orgId } = context;
      if (!userEmail) return false;
      // Query the physical `tools` SQL table directly (the Drizzle export is
      // `extensions`; the table name kept the legacy `tools` identifier).
      // The table is created lazily by `ensureExtensionsTables()` when any
      // extensions code path runs; treat "missing table" as "zero extensions"
      // so the step just stays incomplete until the user opens the room.
      try {
        const client = getDbExec();
        const normalizedEmail = userEmail.trim().toLowerCase();
        const trimmedOrgId = orgId?.trim() || null;
        // Match the framework `accessFilter` scoping for extensions: an
        // extension counts if the current user owns it OR it lives in the
        // user's active org. Cross-user shares within the same org would
        // already be visible via the org check; we intentionally don't
        // join `tool_shares` here to keep the readiness probe cheap.
        const scopeClause = trimmedOrgId
          ? "(lower(owner_email) = ? OR org_id = ?)"
          : "lower(owner_email) = ?";
        const scopeArgs = trimmedOrgId
          ? [normalizedEmail, trimmedOrgId]
          : [normalizedEmail];
        const { rows } = await client.execute({
          sql: `SELECT 1 FROM tools WHERE ${scopeClause} LIMIT 1`,
          args: scopeArgs,
        });
        return rows.length > 0;
      } catch {
        return false;
      }
    },
  });
}
