import { z } from "zod";

export const SLIDE_EDITOR_STATUS_KEY = "slide-editor-status";
export const SLIDE_EDITOR_COMMAND_KEY = "slide-editor-command";

const identifierSchema = z.string().min(1).max(128);
const sourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const slideEditorStatusSchema = z
  .object({
    protocolVersion: z.literal(1),
    deckId: identifierSchema,
    slideId: identifierSchema,
    editorSessionId: identifierSchema,
    historyVersion: z.number().int().nonnegative(),
    sourceRevision: z.number().int().positive(),
    sourceHash: sourceHashSchema,
    hasPendingEdits: z.boolean(),
    canUndo: z.boolean(),
    canRedo: z.boolean(),
    canSave: z.boolean(),
  })
  .strict();

export type SlideEditorStatus = z.infer<typeof slideEditorStatusSchema>;

export const slideEditorCommandSchema = z
  .object({
    protocolVersion: z.literal(1),
    commandId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
    operation: z.enum(["undo", "redo", "save"]),
    deckId: identifierSchema,
    slideId: identifierSchema,
    editorSessionId: identifierSchema,
    historyVersion: z.number().int().nonnegative(),
    sourceRevision: z.number().int().positive(),
    sourceHash: sourceHashSchema,
    status: z.enum(["pending", "applied", "rejected"]),
    completedAt: z.number().int().nonnegative().optional(),
    failureCode: z
      .enum(["stale_editor_state", "command_unavailable", "command_failed"])
      .optional(),
  })
  .strict();

export type SlideEditorCommand = z.infer<typeof slideEditorCommandSchema>;

export function isSlideEditorOperationAvailable(
  status: SlideEditorStatus,
  operation: SlideEditorCommand["operation"],
): boolean {
  switch (operation) {
    case "undo":
      return status.canUndo;
    case "redo":
      return status.canRedo;
    case "save":
      return status.hasPendingEdits && status.canSave;
  }
}

export function slideEditorCommandMatchesEditorState(
  commandValue: unknown,
  status: SlideEditorStatus,
  editorState: {
    deckId: string;
    slideId: string;
    editorSessionId: string;
    historyVersion: number;
    sourceRevision: number;
    sourceHash: string;
  },
): commandValue is SlideEditorCommand {
  const parsed = slideEditorCommandSchema.safeParse(commandValue);
  if (!parsed.success || parsed.data.status !== "pending") return false;
  const command = parsed.data;
  return (
    slideEditorCommandMatchesStatus(command, status) &&
    command.deckId === editorState.deckId &&
    command.slideId === editorState.slideId &&
    command.editorSessionId === editorState.editorSessionId &&
    command.historyVersion === editorState.historyVersion &&
    command.sourceRevision === editorState.sourceRevision &&
    command.sourceHash === editorState.sourceHash
  );
}

export function slideEditorCommandMatchesStatus(
  commandValue: unknown,
  status: SlideEditorStatus,
): commandValue is SlideEditorCommand {
  const parsed = slideEditorCommandSchema.safeParse(commandValue);
  if (!parsed.success || parsed.data.status !== "pending") return false;
  const command = parsed.data;
  return (
    command.deckId === status.deckId &&
    command.slideId === status.slideId &&
    command.editorSessionId === status.editorSessionId &&
    command.historyVersion === status.historyVersion &&
    command.sourceRevision === status.sourceRevision &&
    command.sourceHash === status.sourceHash
  );
}

export function completeSlideEditorCommand(
  command: SlideEditorCommand,
  result:
    | { status: "applied" }
    | {
        status: "rejected";
        failureCode: NonNullable<SlideEditorCommand["failureCode"]>;
      },
  completedAt = Date.now(),
): SlideEditorCommand {
  return slideEditorCommandSchema.parse({
    ...command,
    ...result,
    completedAt,
  });
}
