import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { getOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  buildDbtSourceIndexFromGitHub,
  DBT_REPOSITORY_SETTING_KEY,
  dbtRepositorySettingSchema,
  type DbtRepository,
} from "../server/lib/index-build-github.js";
import {
  createSourceIndexRun,
  finishSourceIndexRun,
  listSourceIndexRuns,
  SOURCE_INDEX_RUN_STALE_AFTER_MS,
  type SourceIndexRunOutcome,
} from "../server/lib/source-index-runs.js";
import type { SourceIndexBundle } from "../server/lib/source-index-schema.js";
import {
  invalidateSourceIndexCache,
  SOURCE_INDEX_SETTING_KEY,
} from "../server/lib/source-index-store.js";

function indexedSourceRevisions(
  bundle: SourceIndexBundle,
): Record<string, string> {
  return Object.fromEntries(
    bundle.sources.map((source): [string, string] => {
      const revision = source.revision ?? source.contentFingerprint;
      if (!revision) {
        // guard:allow-bare-error — invariant: withRevision stamps every source before storage, so a missing revision is a builder bug.
        throw new Error(`Source ${source.id} has no indexed revision.`);
      }
      return [source.id, revision];
    }),
  );
}

async function readDbtRepository(orgId: string): Promise<DbtRepository> {
  const value = await getOrgSetting(orgId, DBT_REPOSITORY_SETTING_KEY);
  if (!value) {
    fail(
      "Set the organization's dbt GitHub repository before building the source index.",
      { errorCode: "dbt_repository_not_configured", statusCode: 409 },
    );
  }
  const parsed = dbtRepositorySettingSchema.safeParse(value);
  if (!parsed.success) {
    fail("The organization's dbt repository setting is invalid.", {
      errorCode: "dbt_repository_invalid",
      statusCode: 500,
    });
  }
  return parsed.data;
}

export default defineAction({
  description:
    "Rebuild the organization's Analytics source index from its configured dbt GitHub repository. Requires an organization owner or admin. Every build is recorded as a run. A successful build replaces the current index; a failed build leaves it unchanged and records the error. The index holds source metadata only, and its entries remain unapproved suggestions.",
  schema: z.object({
    trigger: z
      .enum(["manual", "scheduled"])
      .default("manual")
      .describe(
        'What started the build: "manual" for an admin request (default) or "scheduled" for a recurring run',
      ),
  }),
  mcpTool: false,
  run: async ({ trigger }, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    const orgId = admin.orgId;
    const repository = await readDbtRepository(orgId);

    const [latest] = await listSourceIndexRuns(orgId, 1);
    if (
      latest?.status === "running" &&
      Date.now() - Date.parse(latest.startedAt) <
        SOURCE_INDEX_RUN_STALE_AFTER_MS
    ) {
      fail("A source index build is already running for this organization.", {
        errorCode: "source_index_build_running",
        statusCode: 409,
      });
    }

    const run = await createSourceIndexRun({
      orgId,
      trigger,
      createdByEmail: admin.userEmail,
    });
    let outcome: SourceIndexRunOutcome;
    try {
      const { bundle } = await buildDbtSourceIndexFromGitHub(repository);
      // Computed before the write so a bad source fails the run instead of
      // leaving a stored index with no recorded revisions.
      const sourceRevisions = indexedSourceRevisions(bundle);
      await putOrgSetting(orgId, SOURCE_INDEX_SETTING_KEY, bundle);
      invalidateSourceIndexCache(orgId);
      outcome = {
        status: "succeeded",
        entryCount: bundle.entries.length,
        sourceRevisions,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The source index could not be built.";
      await finishSourceIndexRun(run.id, orgId, {
        status: "failed",
        error: message,
      });
      fail(message, {
        errorCode: "source_index_build_failed",
        statusCode: 500,
      });
    }

    return finishSourceIndexRun(run.id, orgId, outcome);
  },
});
