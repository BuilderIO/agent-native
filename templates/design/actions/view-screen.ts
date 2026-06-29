/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and design context from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseCanvasFrameGeometryById } from "../shared/canvas-frames.js";
import { designGenerationSessionKey } from "../shared/generation-session.js";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state including which design is open, which view they are on (list, editor, design-systems, present, templates, settings), active/focused design screen, selected element, active inspector tab (design, tweaks, or extensions), overview canvas state, plus any pending question overlay or variant grid. Always call this first before taking any action.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const [navigation, designSelection] = await Promise.all([
      readAppStateForCurrentTab("navigation"),
      readAppStateForCurrentTab("design-selection"),
    ]);
    const designId =
      navigation &&
      typeof navigation === "object" &&
      typeof (navigation as { designId?: unknown }).designId === "string"
        ? (navigation as { designId: string }).designId
        : undefined;
    const showQuestions =
      (designId
        ? await readAppState(`show-questions:${designId}`)
        : undefined) ?? (await readAppState("show-questions"));
    const generationSession = designId
      ? await readAppState(designGenerationSessionKey(designId))
      : undefined;
    const designVariants = designId
      ? await readAppState("design-variants").then((value) => {
          if (!value || typeof value !== "object") return undefined;
          return (value as { designId?: unknown }).designId === designId
            ? value
            : undefined;
        })
      : undefined;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (designSelection) screen.designSelection = designSelection;
    if (designId) {
      const access = await resolveAccess("design", designId).catch(() => null);
      if (access) {
        const db = getDb();
        const files = await db
          .select({
            id: schema.designFiles.id,
            filename: schema.designFiles.filename,
            fileType: schema.designFiles.fileType,
            updatedAt: schema.designFiles.updatedAt,
          })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.designId, designId));
        let data: Record<string, unknown> = {};
        const rawData = (access.resource as { data?: unknown }).data;
        if (typeof rawData === "string") {
          try {
            const parsed = JSON.parse(rawData);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              data = parsed as Record<string, unknown>;
            }
          } catch {
            data = {};
          }
        }
        const activeFileId =
          designSelection &&
          typeof designSelection === "object" &&
          typeof (designSelection as { activeFileId?: unknown })
            .activeFileId === "string"
            ? (designSelection as { activeFileId: string }).activeFileId
            : undefined;
        const activeFilename =
          designSelection &&
          typeof designSelection === "object" &&
          typeof (designSelection as { activeFilename?: unknown })
            .activeFilename === "string"
            ? (designSelection as { activeFilename: string }).activeFilename
            : undefined;
        screen.design = {
          id: designId,
          title: (access.resource as { title?: unknown }).title ?? null,
          screens: files,
          activeScreen: activeFileId
            ? (files.find((file) => file.id === activeFileId) ?? null)
            : (files.find((file) => file.filename === activeFilename) ?? null),
          canvasFrames: parseCanvasFrameGeometryById(data.canvasFrames),
        };
      }
    }
    if (showQuestions) {
      screen.pendingQuestions = showQuestions;
      screen.note =
        "Questions are visible to the user as a full-canvas overlay. Wait for their answers (they'll come back as a chat message) before generating.";
    }
    if (designVariants) {
      screen.pendingVariants = designVariants;
      screen.variantsNote =
        'A variant picker is open. Wait for the user to choose a direction before generating further. In an inline MCP app their pick returns to you automatically; if it opened as a browser tab (a CLI or code editor), they paste an auto-copied summary or just tell you which one (e.g. "use variant A"). Once you know the choice, read the saved index.html with get-design-snapshot. Do not call generate-design while this picker is open.';
    }
    if (generationSession) {
      screen.generationSession = generationSession;
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
