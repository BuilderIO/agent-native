import { z } from "zod";

export const DECK_HISTORY_STATUS_KEY = "deck-history-status";
export const DECK_HISTORY_COMMAND_KEY = "deck-history-command";

const identifierSchema = z.string().min(1).max(128);

export const deckHistoryStatusSchema = z
  .object({
    protocolVersion: z.literal(1),
    deckId: identifierSchema,
    editorSessionId: identifierSchema,
    historyVersion: z.number().safe().int().nonnegative(),
    canUndo: z.boolean(),
    canRedo: z.boolean(),
  })
  .strict();

export type DeckHistoryStatus = z.infer<typeof deckHistoryStatusSchema>;

export const deckHistoryCommandSchema = z
  .object({
    protocolVersion: z.literal(1),
    commandId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
    operation: z.enum(["undo", "redo"]),
    deckId: identifierSchema,
    editorSessionId: identifierSchema,
    historyVersion: z.number().safe().int().nonnegative(),
    status: z.enum(["pending", "applied", "rejected"]),
    completedAt: z.number().safe().int().nonnegative().optional(),
    failureCode: z
      .enum([
        "stale_editor_state",
        "command_unavailable",
        "command_failed",
        "persistence_failed",
      ])
      .optional(),
  })
  .strict();

export type DeckHistoryCommand = z.infer<typeof deckHistoryCommandSchema>;

export function isDeckHistoryOperationAvailable(
  status: DeckHistoryStatus,
  operation: DeckHistoryCommand["operation"],
): boolean {
  return operation === "undo" ? status.canUndo : status.canRedo;
}

export function deckHistoryCommandMatchesStatus(
  commandValue: unknown,
  status: DeckHistoryStatus,
): commandValue is DeckHistoryCommand {
  const parsed = deckHistoryCommandSchema.safeParse(commandValue);
  if (!parsed.success || parsed.data.status !== "pending") return false;
  return (
    parsed.data.deckId === status.deckId &&
    parsed.data.editorSessionId === status.editorSessionId &&
    parsed.data.historyVersion === status.historyVersion
  );
}

export function completeDeckHistoryCommand(
  command: DeckHistoryCommand,
  result:
    | { status: "applied" }
    | {
        status: "rejected";
        failureCode: NonNullable<DeckHistoryCommand["failureCode"]>;
      },
  completedAt = Date.now(),
): DeckHistoryCommand {
  return deckHistoryCommandSchema.parse({
    ...command,
    ...result,
    completedAt,
  });
}
