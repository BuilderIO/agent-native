import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  assertCanDeleteAsset,
  deleteDraftAssetIfUnchanged,
} from "../server/lib/library-access.js";
import { getAssetOrThrow } from "./_helpers.js";

export default defineAction({
  description:
    "Delete an asset row. Requires editor access to its library, except for an unsaved draft candidate, which its author can always discard.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    const asset = await getAssetOrThrow(id);
    const access = await assertCanDeleteAsset(asset);
    if (access.canApprove) {
      await getDb().delete(schema.assets).where(eq(schema.assets.id, id));
      return { id, deleted: true };
    }
    // A draft author's delete was authorized from a prior read. If an editor
    // approved the candidate in between, that save wins — re-running the rule
    // against the row's new state reports why, rather than reporting a delete
    // that did not happen.
    if (await deleteDraftAssetIfUnchanged(asset)) {
      return { id, deleted: true };
    }
    await assertCanDeleteAsset(await getAssetOrThrow(id));
    throw new Error(
      `Asset ${id} changed while being discarded. Reload and try again.`,
    );
  },
});
