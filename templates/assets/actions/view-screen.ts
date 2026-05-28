import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import getLibrary from "./get-library.js";
import getAsset from "./get-asset.js";
import getGenerationSession from "./get-generation-session.js";
import getGenerationRun from "./get-generation-run.js";
import listGenerationPresets from "./list-generation-presets.js";
import listGenerationSessions from "./list-generation-sessions.js";
import listAuditRuns from "./list-audit-runs.js";

export default defineAction({
  description:
    "See what the user is currently looking at in Assets, including current library/asset context and pending generation variants.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const [navigation, variants, legacyVariants] = await Promise.all([
      readAppState("navigation"),
      readAppState("asset-variants"),
      readAppState("image-variants").catch(() => null),
    ]);
    const screen: Record<string, unknown> = {
      navigation,
      variants: variants ?? legacyVariants,
    };
    const nav = navigation as any;
    if (nav?.libraryId) {
      screen.library = await getLibrary.run({ id: nav.libraryId });
      screen.generationPresets = await listGenerationPresets.run({
        libraryId: nav.libraryId,
      });
      screen.generationSessions = await listGenerationSessions.run({
        libraryId: nav.libraryId,
        limit: 20,
      });
    }
    if (nav?.assetId) {
      screen.asset = await getAsset.run({ id: nav.assetId });
    }
    if (nav?.sessionId) {
      screen.generationSession = await getGenerationSession.run({
        id: nav.sessionId,
      });
    }
    if (nav?.runId) {
      screen.generationRun = await getGenerationRun.run({
        runId: nav.runId,
      });
    }
    if (nav?.view === "audit") {
      screen.audit = await listAuditRuns.run({ limit: 20 });
    }
    return screen;
  },
});
