import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import getLibrary from "./get-library.js";
import getAsset from "./get-asset.js";
import listAuditRuns from "./list-audit-runs.js";

export default defineAction({
  description:
    "See what the user is currently looking at in Images, including current library/image context and pending image variants.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const [navigation, variants] = await Promise.all([
      readAppState("navigation"),
      readAppState("image-variants"),
    ]);
    const screen: Record<string, unknown> = { navigation, variants };
    const nav = navigation as any;
    if (nav?.libraryId) {
      screen.library = await getLibrary
        .run({ id: nav.libraryId })
        .catch((err) => ({
          error: err instanceof Error ? err.message : String(err),
        }));
    }
    if (nav?.assetId) {
      screen.asset = await getAsset.run({ id: nav.assetId }).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    if (nav?.view === "audit") {
      screen.audit = await listAuditRuns.run({ limit: 20 }).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    return screen;
  },
});
