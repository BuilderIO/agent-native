import { defineAction } from "@agent-native/core";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { z } from "zod";

import getAsset from "./get-asset.js";
import getGenerationRun from "./get-generation-run.js";
import getGenerationSession from "./get-generation-session.js";
import getLibrary from "./get-library.js";
import listAssets from "./list-assets.js";
import listAuditRuns from "./list-audit-runs.js";
import listGenerationPresets from "./list-generation-presets.js";
import listGenerationSessions from "./list-generation-sessions.js";
import listLibraries from "./list-libraries.js";

export default defineAction({
  description:
    "See what the user is currently looking at in Assets, including current library/asset context and pending generation variants.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const [navigation, variants, legacyVariants] = await Promise.all([
      readAppStateForCurrentTab("navigation"),
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
    if (nav?.view === "picker") {
      screen.libraries = await listLibraries.run({ compact: true });
      if (nav.libraryId) {
        screen.assets = await listAssets.run({
          libraryId: nav.libraryId,
          mediaType:
            nav.mediaType === "image" || nav.mediaType === "video"
              ? nav.mediaType
              : undefined,
          query:
            typeof nav.query === "string" && nav.query.trim()
              ? nav.query
              : undefined,
        });
      }
    }
    if (nav?.view === "library" && nav?.selection === "all") {
      screen.libraries = await listLibraries.run({ compact: false });
      screen.assets = await listAssets.run({
        query:
          typeof nav.search === "string" && nav.search.trim()
            ? nav.search
            : undefined,
      });
    }
    if (nav?.view === "audit") {
      screen.audit = await listAuditRuns.run({ limit: 20 });
    }
    return screen;
  },
});
