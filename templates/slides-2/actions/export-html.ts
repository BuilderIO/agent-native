import fs from "fs";
import path from "path";

import { defineAction, fail } from "@agent-native/core/action";
import {
  hydrateBuilderDesignSystemReference,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import { buildStandaloneHtml } from "../app/lib/standalone-html.js";
import {
  trackDeckExported,
  withExportFailureTracking,
} from "../server/lib/deck-export-tracking.js";
import { generationAttemptIdOf } from "../server/lib/slides-tracking.js";
import {
  safeGeneratedFilename,
  tenantExportDir,
} from "../server/lib/tenant-files.js";
import type { DesignSystemData } from "../shared/api.js";
import {
  type AspectRatio,
  ASPECT_RATIO_VALUES,
} from "../shared/aspect-ratios.js";
import { sourceRuntimeExportError } from "../shared/source-runtime-export.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  projectRenderingDesignSystemData,
  readDeckLinkedDesignSystem,
} from "./_linked-design-system.js";
import { compileSlideSource } from "./_slide-source.js";
export { buildStandaloneHtml } from "../app/lib/standalone-html.js";

function parseStoredDesignSystem(
  rawData: string,
): DesignSystemData | undefined {
  try {
    const parsed = JSON.parse(rawData);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as DesignSystemData)
      : undefined;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
}

const trackHtmlExportFailures = withExportFailureTracking<{
  deckId: string;
}>("html");

export default defineAction({
  description:
    "Build a standalone HTML presentation with built-in keyboard navigation for the editor to download. Returns the generated file contents as `html`, not a download URL. Supported source-backed slides are rendered before export; slides requiring browser Worker rendering fail with source_runtime_export_required.",
  agentTool: false,
  schema: z.object({
    deckId: z.string().describe("Deck ID to export"),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: trackHtmlExportFailures(async ({ deckId }, ctx, facts) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail)
      fail("no authenticated user", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });

    const access = await resolveAccess("deck", deckId);
    if (!access)
      fail(`Deck not found: ${deckId}`, {
        errorCode: "deck_not_found",
        statusCode: 404,
      });

    facts.deckId = deckId;
    const row = access.resource;
    assertSlides2DeckData(row.data);
    const deckData = JSON.parse(row.data);
    const slides = deckData.slides || [];
    facts.slideCount = slides.length;
    facts.generationAttemptId = generationAttemptIdOf(
      deckData.generationContext,
    );
    const rawAspectRatio = deckData.aspectRatio;
    const aspectRatio: AspectRatio | undefined = ASPECT_RATIO_VALUES.includes(
      rawAspectRatio,
    )
      ? rawAspectRatio
      : undefined;

    if (slides.length === 0) {
      fail("Cannot export empty deck", {
        errorCode: "empty_deck",
        statusCode: 400,
      });
    }
    const exportSlides = [];
    for (const slide of slides) {
      if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
        exportSlides.push(slide);
        continue;
      }
      const slideRecord = slide as Record<string, unknown>;
      const sourceTsx = slideRecord.sourceTsx;
      const content = slideRecord.content;
      if (
        slideRecord.sourceRuntimeRequired !== true &&
        typeof sourceTsx === "string" &&
        sourceTsx.trim() &&
        !(typeof content === "string" && content.trim())
      ) {
        const rendered = await compileSlideSource(sourceTsx, {
          ownerEmail: row.ownerEmail,
          orgId: row.orgId,
        });
        exportSlides.push(
          rendered.content.trim()
            ? { ...slideRecord, content: rendered.content }
            : slide,
        );
        continue;
      }
      exportSlides.push(slide);
    }
    const sourceRuntimeError = sourceRuntimeExportError(exportSlides, "html");
    if (sourceRuntimeError) {
      fail(sourceRuntimeError.message, {
        errorCode: sourceRuntimeError.errorCode,
        statusCode: sourceRuntimeError.statusCode,
        details: {
          format: sourceRuntimeError.format,
          slideIds: sourceRuntimeError.slideIds,
          slideCount: sourceRuntimeError.slideCount,
        },
      });
    }

    const designSystemId = row.designSystemId ?? deckData.designSystemId;
    let designSystem: DesignSystemData | undefined;
    let builderTokenValues: Record<string, string> | undefined;
    if (typeof designSystemId === "string" && designSystemId.trim()) {
      const designSystemAccess = await readDeckLinkedDesignSystem(
        row,
        designSystemId,
      );
      // Deck-only readers get the rendering projection and no Builder token
      // hydration: the token map is emitted whole into the exported HTML.
      const rawData = designSystemAccess?.viaDeck
        ? projectRenderingDesignSystemData(designSystemAccess.resource.data)
        : designSystemAccess?.resource?.data;
      if (typeof rawData === "string") {
        designSystem = parseStoredDesignSystem(rawData);
        const builderReference = designSystemAccess?.viaDeck
          ? null
          : parseBuilderDesignSystemProxyReference(rawData);
        if (builderReference) {
          try {
            builderTokenValues = (
              await hydrateBuilderDesignSystemReference(builderReference)
            ).tokenValues;
          } catch (error) {
            console.warn(
              "Builder design-system export hydration failed",
              error,
            );
          }
        }
      }
    }

    const html = buildStandaloneHtml(
      row.title,
      exportSlides,
      aspectRatio,
      designSystem,
      builderTokenValues,
    );
    const filename = safeGeneratedFilename(row.title, ".html");

    let filePath: string | undefined;
    if (!isServerless()) {
      const exportDir = tenantExportDir(userEmail);
      fs.mkdirSync(exportDir, { recursive: true });
      filePath = path.join(exportDir, filename);
      fs.writeFileSync(filePath, html);
    }

    trackDeckExported(
      {
        ...facts,
        deckId,
        exportFormat: "html",
        renderLocation: "server",
        status: "completed",
      },
      ctx,
    );

    return { html, filePath, filename, slideCount: exportSlides.length };
  }),
});

function isServerless(): boolean {
  return Boolean(
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.cwd() === "/var/task" ||
    process.cwd().startsWith("/var/task/"),
  );
}
