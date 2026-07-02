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

function stringProp(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function stringArrayProp(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object") return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : [];
}

function boolProp(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}

function objectProp(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const candidate = (value as Record<string, unknown>)[key];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : {};
}

function resolveActiveScreen(
  files: Array<{
    id: string;
    filename: string;
    fileType: string | null;
    updatedAt: string | null;
  }>,
  navigation: unknown,
  designSelection: unknown,
) {
  const selectionFileId = stringProp(designSelection, "activeFileId");
  if (selectionFileId) {
    const active = files.find((file) => file.id === selectionFileId);
    if (active) return active;
  }

  const selectionFilename = stringProp(designSelection, "activeFilename");
  if (selectionFilename) {
    const active = files.find((file) => file.filename === selectionFilename);
    if (active) return active;
  }

  const selectedScreenIds = stringArrayProp(
    designSelection,
    "selectedScreenIds",
  );
  for (const screenId of selectedScreenIds) {
    const selected = files.find((file) => file.id === screenId);
    if (selected) return selected;
  }

  const navigationTargets = [
    stringProp(navigation, "fileId"),
    stringProp(navigation, "screenId"),
    stringProp(navigation, "filename"),
    stringProp(navigation, "screen"),
  ].filter((value): value is string => !!value);
  for (const target of navigationTargets) {
    const active = files.find(
      (file) =>
        file.id === target ||
        file.filename === target ||
        file.filename.replace(/\.[^.]+$/, "") === target,
    );
    if (active) return active;
  }

  const view = stringProp(navigation, "view");
  const editorView =
    stringProp(navigation, "editorView") ?? stringProp(navigation, "viewMode");
  if (view === "present" || (view === "editor" && editorView === "single")) {
    return (
      files.find((file) => file.filename === "index.html") ?? files[0] ?? null
    );
  }

  return null;
}

function resolveActiveCodeFile(
  files: Array<{
    id: string;
    filename: string;
    fileType: string | null;
    updatedAt: string | null;
  }>,
  designSelection: unknown,
) {
  const codeWorkspace = objectProp(designSelection, "codeWorkspace");
  if (Object.keys(codeWorkspace).length === 0) return null;
  const fileId = stringProp(codeWorkspace, "activeFileId");
  const path = stringProp(codeWorkspace, "activePath");
  const file = files.find(
    (candidate) => candidate.id === fileId || candidate.filename === path,
  );
  return {
    open: boolProp(codeWorkspace, "open") ?? false,
    backendKind: stringProp(codeWorkspace, "backendKind") ?? "virtual-inline",
    path: path ?? file?.filename ?? null,
    fileId: fileId ?? file?.id ?? null,
    dirty: boolProp(codeWorkspace, "dirty") ?? false,
    versionHash: stringProp(codeWorkspace, "versionHash") ?? null,
    file: file ?? null,
  };
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state including which design is open, which view they are on (list, editor, design-systems, present, settings), active/focused design screen, selected element, active inspector tab (design or tweaks), active left rail panel (file, agent, assets, import, tools, tokens, or code), active code file metadata, overview canvas state, plus any pending question overlay. Always call this first before taking any action.",
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
        screen.design = {
          id: designId,
          title: (access.resource as { title?: unknown }).title ?? null,
          screens: files,
          activeScreen: resolveActiveScreen(files, navigation, designSelection),
          activeCodeFile: resolveActiveCodeFile(files, designSelection),
          canvasFrames: parseCanvasFrameGeometryById(data.canvasFrames),
        };
      }
    }
    if (showQuestions) {
      screen.pendingQuestions = showQuestions;
      screen.note =
        "Questions are visible to the user as a full-canvas overlay. Wait for their answers (they'll come back as a chat message) before generating.";
    }
    if (generationSession) {
      const GENERATION_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
      const startedAt =
        typeof (generationSession as { startedAt?: unknown }).startedAt ===
        "string"
          ? new Date(
              (generationSession as { startedAt: string }).startedAt,
            ).getTime()
          : 0;
      const isStale =
        startedAt > 0 && Date.now() - startedAt > GENERATION_SESSION_TTL_MS;
      screen.generationSession = generationSession;
      if (isStale) {
        screen.generationSessionNote =
          "This generation session may be stale or abandoned (started more than 10 minutes ago). Verify saved screens via the design file list rather than assuming generation is still in progress.";
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
