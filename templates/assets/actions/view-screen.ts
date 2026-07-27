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

function screenError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default defineAction({
  description:
    "See what the user is currently looking at in Assets, including current library/asset context and pending generation variants.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx) => {
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
    const errors: Record<string, string> = {};
    const readPart = async <T>(
      key: string,
      task: () => T | Promise<T>,
    ): Promise<T | null> => {
      try {
        const value = await task();
        screen[key] = value;
        return value;
      } catch (error) {
        errors[key] = screenError(error);
        return null;
      }
    };

    if (nav?.libraryId) {
      const library = await readPart("library", () =>
        getLibrary.run({ id: nav.libraryId }, ctx),
      );
      if (library) {
        const [generationPresets] = await Promise.all([
          readPart("generationPresets", () =>
            listGenerationPresets.run(
              {
                libraryId: nav.libraryId,
              },
              ctx,
            ),
          ),
          readPart("generationSessions", () =>
            listGenerationSessions.run(
              {
                libraryId: nav.libraryId,
                limit: 20,
              },
              ctx,
            ),
          ),
        ]);
        if (nav?.presetId && generationPresets) {
          const presets = Array.isArray((generationPresets as any).presets)
            ? (generationPresets as any).presets
            : [];
          screen.generationPreset =
            presets.find((preset: any) => preset.id === nav.presetId) ?? null;
        }
      }
    }
    if (nav?.assetId) {
      await readPart("asset", () => getAsset.run({ id: nav.assetId }, ctx));
    }
    if (nav?.sessionId) {
      await readPart("generationSession", () =>
        getGenerationSession.run(
          {
            id: nav.sessionId,
          },
          ctx,
        ),
      );
    }
    if (nav?.runId) {
      await readPart("generationRun", () =>
        getGenerationRun.run(
          {
            runId: nav.runId,
          },
          ctx,
        ),
      );
    }
    if (nav?.view === "picker") {
      await readPart("libraries", () =>
        listLibraries.run({ compact: true }, ctx),
      );
      if (nav.libraryId) {
        await readPart("assets", () =>
          listAssets.run(
            {
              libraryId: nav.libraryId,
              mediaType:
                nav.mediaType === "image" || nav.mediaType === "video"
                  ? nav.mediaType
                  : undefined,
              query:
                typeof nav.query === "string" && nav.query.trim()
                  ? nav.query
                  : undefined,
            },
            ctx,
          ),
        );
      }
    }
    if (nav?.view === "library" && nav?.selection === "all") {
      await Promise.all([
        readPart("libraries", () => listLibraries.run({ compact: false }, ctx)),
        readPart("assets", () =>
          listAssets.run(
            {
              query:
                typeof nav.search === "string" && nav.search.trim()
                  ? nav.search
                  : undefined,
            },
            ctx,
          ),
        ),
      ]);
    }
    if (nav?.view === "audit") {
      await readPart("audit", () => listAuditRuns.run({ limit: 20 }, ctx));
    }
    if (Object.keys(errors).length) {
      screen.errors = errors;
    }
    return screen;
  },
});
