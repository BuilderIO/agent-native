import { z } from "zod";

const deckIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .describe("Deck ID for the active presentation");

export const presenterControlInputSchema = z.discriminatedUnion("operation", [
  z.object({
    deckId: deckIdSchema,
    operation: z.literal("next").describe("Advance to the next step or slide"),
  }),
  z.object({
    deckId: deckIdSchema,
    operation: z
      .literal("previous")
      .describe("Return to the previous step or slide"),
  }),
  z.object({
    deckId: deckIdSchema,
    operation: z
      .literal("goto")
      .describe("Jump to a slide by its 1-based UI slide number"),
    slideNumber: z
      .number()
      .int()
      .min(1)
      .describe(
        "1-based slide number to show, from 1 through the deck's current slide count",
      ),
  }),
  z.object({
    deckId: deckIdSchema,
    operation: z
      .literal("blackout")
      .describe("Toggle a black or white overlay on the projected slide"),
    mode: z.enum(["black", "white"]).describe("Overlay color to toggle"),
  }),
  z.object({
    deckId: deckIdSchema,
    operation: z
      .literal("switch-deck")
      .describe("Switch the open presenter console to another accessible deck"),
    targetDeckId: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .describe("Deck ID to open; requires viewer access"),
  }),
]);

const commandMetadataSchema = {
  commandId: z.string().uuid(),
  issuedAt: z.number().int().nonnegative(),
};

export const presenterControlCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    ...commandMetadataSchema,
    deckId: deckIdSchema,
    operation: z.literal("next"),
  }),
  z.object({
    ...commandMetadataSchema,
    deckId: deckIdSchema,
    operation: z.literal("previous"),
  }),
  z.object({
    ...commandMetadataSchema,
    deckId: deckIdSchema,
    operation: z.literal("goto"),
    slideNumber: z.number().int().min(1),
  }),
  z.object({
    ...commandMetadataSchema,
    deckId: deckIdSchema,
    operation: z.literal("blackout"),
    mode: z.enum(["black", "white"]),
  }),
  z.object({
    ...commandMetadataSchema,
    deckId: deckIdSchema,
    operation: z.literal("switch-deck"),
    targetDeckId: z.string().trim().min(1).max(512),
  }),
]);

export const presenterControlQueueSchema = z.object({
  commands: z.array(presenterControlCommandSchema).max(100),
});

export type PresenterControlInput = z.infer<typeof presenterControlInputSchema>;
export type PresenterControlCommand = z.infer<
  typeof presenterControlCommandSchema
>;
export type PresenterControlQueue = z.infer<typeof presenterControlQueueSchema>;

export const PRESENTER_CONTROL_QUEUE_LIMIT = 100;
export const PRESENTER_CONTROL_COMMAND_TTL_MS = 60_000;

export function isPresenterControlCommandFresh(
  command: PresenterControlCommand,
  now = Date.now(),
): boolean {
  const age = now - command.issuedAt;
  // The action and console use server and browser clocks, respectively.
  return Math.abs(age) <= PRESENTER_CONTROL_COMMAND_TTL_MS;
}
