import { defineAction } from "@agent-native/core/action";
import { roleSatisfies } from "@agent-native/core/sharing";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  APPROVE_ROLE,
  canReadDraftAsset,
  canReadRun,
  resolveDraftReadScope,
  unrestrictedDraftReadScope,
} from "../server/lib/library-access.js";
import {
  requireLibraryAccess,
  serializeAssets,
  serializeGenerationRun,
  serializeLibrary,
} from "./_helpers.js";

export default defineAction({
  description:
    "Get an asset library with folders, collections, reference assets, generated assets, and recent generation runs.",
  schema: z.object({
    id: z.string().describe("Asset library ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }, ctx) => {
    const access = await requireLibraryAccess(id, ctx);
    const library = access.resource;
    const db = getDb();
    const [collections, folders, assets, runs] = await Promise.all([
      db
        .select()
        .from(schema.assetCollections)
        .where(eq(schema.assetCollections.libraryId, id)),
      db
        .select()
        .from(schema.assetFolders)
        .where(eq(schema.assetFolders.libraryId, id)),
      db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.libraryId, id))
        .orderBy(desc(schema.assets.createdAt)),
      db
        .select()
        .from(schema.assetGenerationRuns)
        .where(eq(schema.assetGenerationRuns.libraryId, id))
        .orderBy(desc(schema.assetGenerationRuns.createdAt)),
    ]);
    // Drafts belong to whoever generated them until an editor approves one, so
    // a below-editor caller sees their own candidates and runs, not the kit's.
    const scope = roleSatisfies(access.role, APPROVE_ROLE)
      ? unrestrictedDraftReadScope()
      : await resolveDraftReadScope([id]);
    return {
      library: serializeLibrary({ ...library, accessRole: access.role }),
      collections,
      folders,
      assets: serializeAssets(
        assets.filter((asset) => canReadDraftAsset(scope, asset)),
      ),
      runs: runs
        .filter((run) => canReadRun(scope, run))
        .map(serializeGenerationRun),
    };
  },
});
