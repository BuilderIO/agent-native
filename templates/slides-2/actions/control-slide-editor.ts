import {
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { appStateKey } from "../shared/app-state-tabs.js";
import {
  SLIDE_EDITOR_COMMAND_KEY,
  SLIDE_EDITOR_STATUS_KEY,
  isSlideEditorOperationAvailable,
  slideEditorCommandSchema,
  slideEditorStatusSchema,
} from "../shared/editor-control.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import { readStoredSlideSource } from "./_slide-source.js";
import {
  compareAndSetAppStateForCurrentTab,
  getCurrentRequestBrowserTabId,
  readAppStateForCurrentTab,
} from "./_tab-state.js";

function rethrowSlideSourceFailure(error: unknown): never {
  if (isActionContractError(error)) throw error;
  if (!(error instanceof Error)) throw error;
  const failure = error as Error & {
    statusCode?: unknown;
    errorCode?: unknown;
    details?: unknown;
  };
  if (
    typeof failure.statusCode !== "number" ||
    typeof failure.errorCode !== "string"
  ) {
    throw error;
  }
  const details =
    failure.details &&
    typeof failure.details === "object" &&
    !Array.isArray(failure.details)
      ? (failure.details as Record<string, unknown>)
      : undefined;
  fail(error.message, {
    statusCode: failure.statusCode,
    errorCode: failure.errorCode,
    ...(details ? { details } : {}),
  });
}

export default defineAction({
  title: "Control the active slide editor",
  description:
    "Queue one Undo, Redo, or Save command for the active editor tab. Copy deckId, slideId, editorSessionId, historyVersion, sourceRevision, and sourceHash from the latest view-screen result, and provide a fresh commandId. The command is applied only if the tab, editor session, history, and saved source identity still match; call view-screen again to confirm whether it was applied.",
  schema: z.object({
    deckId: z
      .string()
      .min(1)
      .max(128)
      .describe("Active deck ID from view-screen"),
    slideId: z
      .string()
      .min(1)
      .max(128)
      .describe("Active slide ID from view-screen"),
    operation: z
      .enum(["undo", "redo", "save"])
      .describe("Editor command to queue"),
    commandId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/)
      .describe(
        "Fresh unique command ID; reuse it only when retrying this exact call",
      ),
    editorSessionId: z
      .string()
      .min(1)
      .max(128)
      .describe("Editor session ID from the latest view-screen result"),
    historyVersion: z
      .number()
      .int()
      .nonnegative()
      .describe("Current editor history version from view-screen"),
    sourceRevision: z
      .number()
      .int()
      .positive()
      .describe("Saved source revision from view-screen"),
    sourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .describe("Saved source SHA-256 from view-screen"),
  }),
  retrySafe: true,
  http: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input) => {
    if (!getCurrentRequestBrowserTabId()) {
      fail("An active browser tab is required to control the slide editor.", {
        statusCode: 409,
        errorCode: "editor_tab_required",
      });
    }
    await assertAccess("deck", input.deckId, "editor");

    const navigation = await readAppStateForCurrentTab(
      appStateKey("navigation"),
      { fallbackToGlobal: false },
    );
    if (
      navigation?.app !== "slides-2" ||
      navigation.view !== "editor" ||
      navigation.deckId !== input.deckId ||
      navigation.slideId !== input.slideId
    ) {
      fail("The active tab is no longer showing this slide editor.", {
        statusCode: 409,
        errorCode: "editor_context_stale",
      });
    }

    const commandKey = appStateKey(SLIDE_EDITOR_COMMAND_KEY);
    const existingCommand = await readAppStateForCurrentTab(commandKey, {
      fallbackToGlobal: false,
    });
    const parsedExisting = slideEditorCommandSchema.safeParse(existingCommand);
    if (parsedExisting.success) {
      const current = parsedExisting.data;
      if (current.commandId === input.commandId) {
        const sameCommand =
          current.operation === input.operation &&
          current.deckId === input.deckId &&
          current.slideId === input.slideId &&
          current.editorSessionId === input.editorSessionId &&
          current.historyVersion === input.historyVersion &&
          current.sourceRevision === input.sourceRevision &&
          current.sourceHash === input.sourceHash;
        if (!sameCommand) {
          fail(
            "That command ID was already used for a different editor command.",
            {
              statusCode: 409,
              errorCode: "editor_command_id_conflict",
            },
          );
        }
        return {
          commandId: current.commandId,
          operation: current.operation,
          status: current.status,
          ...(current.failureCode ? { failureCode: current.failureCode } : {}),
        };
      }
      if (current.status === "pending") {
        fail("Another slide editor command is still pending.", {
          statusCode: 409,
          errorCode: "editor_command_pending",
        });
      }
    } else if (existingCommand !== null) {
      fail("The active slide editor command state is invalid.", {
        statusCode: 409,
        errorCode: "editor_command_state_invalid",
      });
    }

    const statusState = await readAppStateForCurrentTab(
      appStateKey(SLIDE_EDITOR_STATUS_KEY),
      { fallbackToGlobal: false },
    );
    const status = slideEditorStatusSchema.safeParse(statusState);
    if (
      !status.success ||
      status.data.deckId !== input.deckId ||
      status.data.slideId !== input.slideId ||
      status.data.editorSessionId !== input.editorSessionId ||
      status.data.historyVersion !== input.historyVersion ||
      status.data.sourceRevision !== input.sourceRevision ||
      status.data.sourceHash !== input.sourceHash
    ) {
      fail(
        "The slide editor changed. Read view-screen again before retrying.",
        {
          statusCode: 409,
          errorCode: "editor_state_stale",
        },
      );
    }
    if (!isSlideEditorOperationAvailable(status.data, input.operation)) {
      fail(
        `The ${input.operation} command is not available in the current editor state.`,
        {
          statusCode: 409,
          errorCode: "editor_command_unavailable",
        },
      );
    }

    const [deckRow] = await getDb()
      .select({ id: schema.decks.id, data: schema.decks.data })
      .from(schema.decks)
      .where(eq(schema.decks.id, input.deckId))
      .limit(1);
    if (!deckRow) {
      fail("Deck not found.", { statusCode: 404, errorCode: "deck_not_found" });
    }
    let sourceSnapshot: ReturnType<typeof readStoredSlideSource>;
    try {
      sourceSnapshot = readStoredSlideSource(deckRow.data, input.slideId);
    } catch (error) {
      rethrowSlideSourceFailure(error);
    }
    assertSlides2DeckData(sourceSnapshot.data);
    if (
      sourceSnapshot.revision !== input.sourceRevision ||
      sourceSnapshot.sourceHash !== input.sourceHash
    ) {
      fail(
        "The saved slide source changed. Read view-screen again before retrying.",
        {
          statusCode: 409,
          errorCode: "editor_source_stale",
        },
      );
    }

    const pendingCommand = slideEditorCommandSchema.parse({
      protocolVersion: 1,
      commandId: input.commandId,
      operation: input.operation,
      deckId: input.deckId,
      slideId: input.slideId,
      editorSessionId: input.editorSessionId,
      historyVersion: input.historyVersion,
      sourceRevision: input.sourceRevision,
      sourceHash: input.sourceHash,
      status: "pending",
    });
    const didQueue = await compareAndSetAppStateForCurrentTab(
      commandKey,
      existingCommand,
      pendingCommand,
    );
    if (!didQueue) {
      fail(
        "The editor command queue changed. Read view-screen and try again.",
        {
          statusCode: 409,
          errorCode: "editor_command_conflict",
        },
      );
    }
    return {
      commandId: input.commandId,
      operation: input.operation,
      status: "pending",
    };
  },
});
