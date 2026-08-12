/**
 * Find-or-create the design backing one Builder branch, keyed on
 * `(builderOrgId, projectId, branchName)` in `data.fusionApp` so no migration is
 * needed. If the linkage scan becomes hot, the fix is an indexed external-key
 * column — not a broader scan here.
 */

import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, asc, like } from "drizzle-orm";

import createDesignAction from "../../actions/create-design.js";
import {
  type DesignFusionApp,
  readFusionApp,
  writeFusionApp,
} from "../../shared/full-app.js";
import { getDb, schema } from "../db/index.js";
import { mutateDesignData } from "./design-data-mutation.js";

export interface BuilderHostDesignKey {
  builderOrgId: string;
  projectId: string;
  branchName: string;
  contentId?: string | null;
}

export interface BuilderHostDesignResult {
  designId: string;
  created: boolean;
  fusionApp: DesignFusionApp;
}

/** Constant patterns — no user input, so no `%`/`_` escaping concern. */
const FUSION_LINKAGE_PATTERN = '%"fusionApp"%';
const BUILDER_HOST_PATTERN = '%"builder-host"%';

export function matchesBuilderHostKey(
  app: DesignFusionApp,
  key: BuilderHostDesignKey,
): boolean {
  return (
    app.source === "builder-host" &&
    app.builderOrgId === key.builderOrgId &&
    app.projectId === key.projectId &&
    app.branchName === key.branchName
  );
}

/**
 * Pick the design for `key` out of candidate rows, oldest first, so a duplicate
 * created by two simultaneous first-opens converges to one doc on every later
 * open instead of alternating.
 */
export function selectBuilderHostDesignId(
  rows: Array<{ id: string; data: unknown }>,
  key: BuilderHostDesignKey,
): string | null {
  for (const row of rows) {
    const app = readFusionApp(row.data);
    if (app && matchesBuilderHostKey(app, key)) return row.id;
  }
  return null;
}

async function findBuilderHostDesignId(
  key: BuilderHostDesignKey,
): Promise<string | null> {
  const rows = await getDb()
    .select({ id: schema.designs.id, data: schema.designs.data })
    .from(schema.designs)
    .where(
      and(
        accessFilter(
          schema.designs,
          schema.designShares,
          currentAccess(),
          "editor",
        ),
        like(schema.designs.data, FUSION_LINKAGE_PATTERN),
        like(schema.designs.data, BUILDER_HOST_PATTERN),
      ),
    )
    .orderBy(asc(schema.designs.createdAt), asc(schema.designs.id));

  return selectBuilderHostDesignId(rows, key);
}

/**
 * `previewUrl` must already be validated by `parseBuilderPreviewUrl`; this
 * stores it verbatim and does not re-check the host allowlist.
 */
export async function findOrCreateBuilderHostDesign(args: {
  key: BuilderHostDesignKey;
  previewUrl?: string;
  title?: string;
}): Promise<BuilderHostDesignResult> {
  const { key, previewUrl } = args;
  const missing = (["builderOrgId", "projectId", "branchName"] as const).filter(
    (field) => !key[field]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Builder host design key is incomplete: missing ${missing.join(", ")}.`,
    );
  }

  if (!getRequestUserEmail()) {
    throw new Error(
      "No request principal: a Builder host design needs one before it can be created.",
    );
  }

  let designId = await findBuilderHostDesignId(key);
  let created = false;

  if (!designId) {
    const design = await createDesignAction.run({
      title: args.title?.trim() || key.branchName,
      description: `Builder Fusion branch "${key.branchName}" in project ${key.projectId}.`,
      projectType: "prototype",
    });
    designId = design.id;
    created = true;
  }

  const now = new Date().toISOString();
  let fusionApp: DesignFusionApp | null = null;

  await mutateDesignData({
    designId,
    mutate: (current) => {
      const previous = readFusionApp(current);
      const next: DesignFusionApp = {
        ...(previous ?? {}),
        source: "builder-host",
        builderOrgId: key.builderOrgId,
        projectId: key.projectId,
        branchName: key.branchName,
        contentId: key.contentId ?? previous?.contentId,
        previewUrl: previewUrl ?? previous?.previewUrl,
        // Builder owns the container; nothing here provisions it, so it is
        // ready by definition once a preview URL exists for it.
        status: (previewUrl ?? previous?.previewUrl) ? "ready" : "building",
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      };
      fusionApp = next;
      return writeFusionApp(current, next);
    },
    isApplied: (persisted) => {
      const app = readFusionApp(persisted);
      if (!app || !matchesBuilderHostKey(app, key)) return false;
      return previewUrl ? app.previewUrl === previewUrl : true;
    },
  });

  if (!fusionApp) {
    throw new Error(
      `Failed to write the Builder host linkage for design "${designId}".`,
    );
  }

  // The linkage lives in `designs.data`, so there is no unique constraint to
  // claim it: two concurrent first-opens of the same branch each create a
  // design. Re-reading after the write converges both callers on the same
  // deterministic winner rather than handing teammates separate documents.
  if (created) {
    const winner = await findBuilderHostDesignId(key);
    if (winner && winner !== designId) {
      return { designId: winner, created: false, fusionApp };
    }
  }

  return { designId, created, fusionApp };
}
