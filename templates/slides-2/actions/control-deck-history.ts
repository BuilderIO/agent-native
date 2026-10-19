import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { z } from "zod";

import { appStateKey } from "../shared/app-state-tabs.js";
import {
  deckHistoryCommandSchema,
  deckHistoryStatusSchema,
  DECK_HISTORY_COMMAND_KEY,
  DECK_HISTORY_STATUS_KEY,
  isDeckHistoryOperationAvailable,
} from "../shared/deck-history-control.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  compareAndSetAppStateForCurrentTab,
  getCurrentRequestBrowserTabId,
  readAppStateForCurrentTab,
} from "./_tab-state.js";

export default defineAction({
  title: "Undo or redo a deck edit",
  description:
    "Queue one Undo or Redo command in the active Slides 2 DeckEditor. Copy deckId, editorSessionId, and historyVersion from the latest view-screen result, then provide a fresh commandId. The command applies only while that tab and history state still match; call this action again with the same commandId to read its result.",
  schema: z.object({
    deckId: z
      .string()
      .min(1)
      .max(128)
      .describe("Active deck ID from view-screen"),
    operation: z.enum(["undo", "redo"]).describe("Edit history operation"),
    commandId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/)
      .describe("Fresh unique command ID; reuse only to retry this exact call"),
    editorSessionId: z
      .string()
      .min(1)
      .max(128)
      .describe("Deck editor session ID from the latest view-screen result"),
    historyVersion: z
      .number()
      .safe()
      .int()
      .nonnegative()
      .describe(
        "Deck editor history version from the latest view-screen result",
      ),
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
      fail("An active browser tab is required to control deck history.", {
        statusCode: 409,
        errorCode: "deck_history_tab_required",
      });
    }

    let access;
    try {
      access = await assertAccess("deck", input.deckId, "editor");
    } catch (error) {
      if (error instanceof ForbiddenError) {
        fail("Deck not found.", {
          statusCode: 404,
          errorCode: "deck_not_found",
        });
      }
      throw error;
    }
    assertSlides2DeckData(access.resource.data);

    const navigation = await readAppStateForCurrentTab(
      appStateKey("navigation"),
      { fallbackToGlobal: false },
    );
    if (
      navigation?.app !== "slides-2" ||
      navigation.view !== "editor" ||
      navigation.deckId !== input.deckId
    ) {
      fail("The active tab is no longer showing this deck editor.", {
        statusCode: 409,
        errorCode: "deck_history_context_stale",
      });
    }

    const commandKey = appStateKey(DECK_HISTORY_COMMAND_KEY);
    const existingCommand = await readAppStateForCurrentTab(commandKey, {
      fallbackToGlobal: false,
    });
    const parsedExisting = deckHistoryCommandSchema.safeParse(existingCommand);
    if (!parsedExisting.success && existingCommand !== null) {
      fail("The deck history command state is invalid.", {
        statusCode: 409,
        errorCode: "deck_history_command_state_invalid",
      });
    }
    if (parsedExisting.success) {
      const current = parsedExisting.data;
      if (current.commandId === input.commandId) {
        const sameCommand =
          current.operation === input.operation &&
          current.deckId === input.deckId &&
          current.editorSessionId === input.editorSessionId &&
          current.historyVersion === input.historyVersion;
        if (!sameCommand) {
          fail("That command ID was already used for different deck history.", {
            statusCode: 409,
            errorCode: "deck_history_command_id_conflict",
          });
        }
        return {
          commandId: current.commandId,
          operation: current.operation,
          status: current.status,
          ...(current.failureCode ? { failureCode: current.failureCode } : {}),
        };
      }
      if (current.status === "pending") {
        fail("Another deck history command is still pending.", {
          statusCode: 409,
          errorCode: "deck_history_command_pending",
        });
      }
    }

    const statusState = await readAppStateForCurrentTab(
      appStateKey(DECK_HISTORY_STATUS_KEY),
      { fallbackToGlobal: false },
    );
    const status = deckHistoryStatusSchema.safeParse(statusState);
    if (
      !status.success ||
      status.data.deckId !== input.deckId ||
      status.data.editorSessionId !== input.editorSessionId ||
      status.data.historyVersion !== input.historyVersion
    ) {
      fail("Deck history changed. Read view-screen again before retrying.", {
        statusCode: 409,
        errorCode: "deck_history_state_stale",
      });
    }
    if (!isDeckHistoryOperationAvailable(status.data, input.operation)) {
      fail(`The ${input.operation} command is not available right now.`, {
        statusCode: 409,
        errorCode: "deck_history_command_unavailable",
      });
    }

    const pendingCommand = deckHistoryCommandSchema.parse({
      protocolVersion: 1,
      commandId: input.commandId,
      operation: input.operation,
      deckId: input.deckId,
      editorSessionId: input.editorSessionId,
      historyVersion: input.historyVersion,
      status: "pending",
    });
    const didQueue = await compareAndSetAppStateForCurrentTab(
      commandKey,
      existingCommand,
      pendingCommand,
    );
    if (!didQueue) {
      fail(
        "The deck history command queue changed. Read view-screen and retry.",
        {
          statusCode: 409,
          errorCode: "deck_history_command_conflict",
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
