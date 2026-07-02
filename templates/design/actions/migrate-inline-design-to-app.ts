/**
 * migrate-inline-design-to-app — generate a real React + Tailwind app branch
 * from an inline Alpine/HTML design via the Builder cloud agent.
 *
 * ## What this action does
 *
 * 1. Requires viewer access to the design and that Builder is fully configured
 *    (credentials + branch project ID).  When Builder is not configured it
 *    returns a connect CTA gracefully, never throws.
 * 2. Reads the current design snapshot (live Yjs content when available).
 * 3. Snapshots the current state into `design_versions` (reversible baseline).
 * 4. Builds a migration seed (HTML + :root CSS vars + Brand Kit tokens) via
 *    `buildMigrationSeed` and hands it to `runBuilderAgent`.
 * 5. Returns `{ branchName, url, status, versionId }` so the caller can track
 *    the Builder branch and roll back via `versionId` if needed.
 *
 * ## Write gating (per DESIGN-STUDIO-PLAN.md §3 & §5)
 *
 * - `writeFile` / `writeTokens` / `writeMotion` on the inline source stay
 *   **planned** until bridge hardening.  This action does NOT write to the
 *   inline design's source files.
 * - `branch` / `deploy` capabilities are **available** once Builder is
 *   configured (fusion source tier).  This action is the entry point for that
 *   tier — it creates the Builder branch, NOT a local file write.
 * - The `design_versions` snapshot is the only local write: it is additive and
 *   never modifies the existing design data.
 *
 * ## Reversibility
 *
 * The snapshot saved as `design_versions` before the migration gives the user
 * a named restore point ("Pre-migration snapshot").  A future `restore-design-
 * version` action can replay it.  The original inline design row is unchanged.
 *
 * ## Connect CTA path
 *
 * When Builder is not connected this action returns:
 * ```json
 * { "status": "not-configured", "cta": { "kind": "connect-builder", ... } }
 * ```
 * so the UI can render the "Make it real" upgrade card without throwing.
 * The caller should offer `connect-builder-app` to surface the CTA first.
 */

import { defineAction } from "@agent-native/core";
import {
  runBuilderAgent,
  resolveBuilderBranchProjectId,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { buildDesignSnapshot } from "../server/lib/design-snapshot.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  resolveBuilderStatus,
  buildMigrationSeed,
} from "../shared/builder-app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The default Builder app host — mirrors the constant in builder-browser.ts. */
const DEFAULT_BUILDER_APP_HOST = "https://builder.io";

function resolveBuilderAppHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
  );
}

function buildConnectUrl(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/_agent-native/builder/connect`;
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Persist a `design_versions` snapshot row before the migration so the user
 * has a named restore point.  Additive only — never modifies existing rows.
 *
 * Returns the new version ID.
 */
async function snapshotDesign(
  designId: string,
  label: string,
): Promise<string> {
  const db = getDb();
  const versionId = nanoid();
  const now = new Date().toISOString();

  // Read the current file contents for the snapshot (stored content only;
  // we intentionally capture the persisted baseline, not in-flight collab text,
  // so the snapshot is stable and reproducible).
  const files = await db
    .select({
      filename: schema.designFiles.filename,
      content: schema.designFiles.content,
      fileType: schema.designFiles.fileType,
    })
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId));

  // Also capture the design data blob (tweaks, source type, etc.).
  // guard:allow-unscoped — the action's run() resolves and asserts editor
  // access on the design (resolveAccess + assertAccess "design", designId)
  // before this snapshot helper runs; reads only the addressed design row by id.
  const [design] = await db
    .select({ data: schema.designs.data, title: schema.designs.title })
    .from(schema.designs)
    .where(eq(schema.designs.id, designId))
    .limit(1);

  const snapshot = JSON.stringify({
    designId,
    label,
    capturedAt: now,
    designData: design?.data ?? "{}",
    files: files.map((f) => ({
      filename: f.filename,
      fileType: f.fileType,
      content: f.content,
    })),
  });

  await db.insert(schema.designVersions).values({
    id: versionId,
    designId,
    label,
    snapshot,
    createdAt: now,
  });

  return versionId;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    "Migrate an inline Alpine/HTML design to a real React + Tailwind app " +
    "by handing the design's HTML and tokens to the Builder cloud agent. " +
    "Requires Builder.io to be connected (credentials + branch project ID). " +
    "When Builder is NOT configured returns a connect CTA — never throws. " +
    "Snapshots the current design into design_versions before migrating so " +
    "the inline baseline is always recoverable. " +
    "Returns { branchName, url, status, versionId } on success. " +
    "Real-app source writes (writeFile/writeTokens/writeMotion to the inline " +
    "design) remain planned until bridge hardening; this action only creates a " +
    "Builder-hosted branch — it does NOT modify the inline design's files.",
  schema: z.object({
    designId: z.string().describe("Design project ID to migrate to a real app"),
    brandKitSummary: z
      .string()
      .optional()
      .describe(
        "Optional human-readable summary of the linked design system tokens " +
          "(e.g. from index-design-tokens) to include in the migration seed. " +
          "Improves token fidelity in the generated React app.",
      ),
    branchName: z
      .string()
      .optional()
      .describe(
        "Optional branch name for the Builder agent to use. " +
          "If omitted, Builder generates one.",
      ),
  }),
  run: async ({ designId, brandKitSummary, branchName }) => {
    // ── 1. Access check ────────────────────────────────────────────────────
    const access = await resolveAccess("design", designId);
    if (!access) {
      throw new Error("Design not found");
    }
    const design = access.resource as typeof schema.designs.$inferSelect;

    // Snapshotting a design_versions row + kicking off a paid Builder cloud run
    // are mutations: require editor access. A read-only (viewer) share must not
    // be able to trigger them.
    await assertAccess("design", designId, "editor");

    // ── 2. Builder status check ────────────────────────────────────────────
    const builderStatus = await resolveBuilderStatus();

    if (!builderStatus.connected || !builderStatus.builderEnabled) {
      // Return a graceful CTA; never throw so the UI can render the card.
      const connectUrl = buildConnectUrl(
        process.env.APP_URL ??
          process.env.VITE_APP_URL ??
          process.env.BETTER_AUTH_URL ??
          "",
      );
      const appHost = resolveBuilderAppHost();

      if (!builderStatus.connected) {
        return {
          status: "not-configured" as const,
          designId,
          cta: {
            kind: "connect-builder" as const,
            label: "Make this a real app",
            description:
              "Connect Builder.io to migrate this design to a real React app " +
              "with components, props, data states, branches, and deploys.",
            primaryAction: "Connect Builder.io",
            connectUrl,
          },
          message:
            "Builder is not connected. Call connect-builder-app to start " +
            "the OAuth flow, then retry migrate-inline-design-to-app.",
        };
      }

      // Connected but no project ID.
      return {
        status: "not-configured" as const,
        designId,
        cta: {
          kind: "configure-project" as const,
          label: "Configure Builder project",
          description:
            "Builder credentials are present but no branch project ID is set. " +
            "Set DISPATCH_BUILDER_PROJECT_ID, BUILDER_BRANCH_PROJECT_ID, or " +
            "BUILDER_PROJECT_ID to enable cloud agent migration.",
          primaryAction: "Open Builder settings",
          connectUrl: `${appHost}/account-settings`,
        },
        message:
          "Builder credentials are configured but no branch project ID is set. " +
          "Set DISPATCH_BUILDER_PROJECT_ID to enable cloud agent migration.",
      };
    }

    // ── 3. Resolve branch project ID ──────────────────────────────────────
    const projectId = await resolveBuilderBranchProjectId();
    if (!projectId) {
      throw new Error(
        "Builder branch project ID is not configured. " +
          "Set DISPATCH_BUILDER_PROJECT_ID, BUILDER_BRANCH_PROJECT_ID, or " +
          "BUILDER_PROJECT_ID and try again.",
      );
    }

    // ── 4. Snapshot the current design (reversible baseline) ──────────────
    const versionId = await snapshotDesign(
      designId,
      `Pre-migration snapshot — ${design.title}`,
    );

    // ── 5. Build the live snapshot (Yjs preferred for in-flight edits) ────
    const snapshot = await buildDesignSnapshot(designId, design.data);

    // ── 6. Build the migration seed prompt ────────────────────────────────
    const seed = buildMigrationSeed({
      title: design.title,
      files: snapshot.files,
      resolvedCssVars: snapshot.resolvedCssVars,
      brandKitSummary,
    });

    // ── 7. Hand off to the Builder cloud agent ────────────────────────────
    const ownerEmail = getRequestUserEmail();
    const result = await runBuilderAgent({
      prompt: seed.prompt,
      projectId,
      branchName: branchName?.trim() || undefined,
      userEmail: ownerEmail ?? undefined,
    });

    return {
      status: "processing" as const,
      designId,
      versionId,
      snapshotLabel: `Pre-migration snapshot — ${design.title}`,
      branchName: result.branchName,
      projectId: result.projectId,
      url: result.url,
      builderStatus: result.status,
      seedFileCount: seed.fileCount,
      seedTotalBytes: seed.totalBytes,
      message:
        `Migration started. Builder is generating a React app branch ` +
        `"${result.branchName}". Open the url to track progress. ` +
        `The original inline design is preserved as version ${versionId}.`,
    };
  },
});
