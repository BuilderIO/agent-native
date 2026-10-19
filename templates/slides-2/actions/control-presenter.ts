import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

import { appStateKey } from "../shared/app-state-tabs.js";
import {
  isPresenterControlCommandFresh,
  PRESENTER_CONTROL_QUEUE_LIMIT,
  presenterControlCommandSchema,
  presenterControlInputSchema,
  presenterControlQueueSchema,
  type PresenterControlInput,
} from "../shared/presenter-control.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";

const MAX_QUEUE_WRITE_ATTEMPTS = 8;
const QUEUE_KEY = appStateKey("presenter-control-queue");

function assertPresenterSlideNumber(deckData: string, slideNumber: number) {
  let data: unknown;
  try {
    data = JSON.parse(deckData);
  } catch {
    fail("Deck data is unreadable.", {
      errorCode: "invalid_deck_data",
      statusCode: 500,
    });
  }
  assertSlides2DeckData(data);
  const deck = data as Record<string, unknown>;
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  if (slideNumber > slides.length) {
    fail(
      slides.length === 0
        ? "This deck has no slides to present."
        : `Slide number must be between 1 and ${slides.length}.`,
      {
        errorCode: "slide_number_out_of_range",
        statusCode: 400,
      },
    );
  }
}

async function enqueuePresenterCommand(input: PresenterControlInput) {
  const now = Date.now();
  const command = presenterControlCommandSchema.parse({
    ...input,
    commandId: randomUUID(),
    issuedAt: now,
  });

  for (let attempt = 0; attempt < MAX_QUEUE_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readAppState(QUEUE_KEY);
    const parsed =
      current === null
        ? { success: true as const, data: { commands: [] } }
        : presenterControlQueueSchema.safeParse(current);
    if (!parsed.success) {
      fail("Presenter control state is invalid and could not be updated.", {
        errorCode: "invalid_presenter_control_state",
        statusCode: 409,
      });
    }

    const commands = parsed.data.commands.filter((queued) =>
      isPresenterControlCommandFresh(queued, now),
    );
    if (commands.length >= PRESENTER_CONTROL_QUEUE_LIMIT) {
      fail("The presenter command queue is full. Try again after it clears.", {
        errorCode: "presenter_control_queue_full",
        statusCode: 409,
      });
    }

    const next = { commands: [...commands, command] };
    if (await compareAndSetAppState(QUEUE_KEY, current, next)) {
      return command;
    }
  }

  fail("Presenter controls changed during the update. Retry the command.", {
    errorCode: "presenter_control_conflict",
    statusCode: 409,
  });
}

export default defineAction({
  description:
    "Control an open presentation by advancing, going back, jumping to a slide number from 1 through the active deck's slide count, toggling a black or white blackout, or switching the presenter console to another deck. Switching requires viewer access to both decks. Queues the command in SQL application state for the presenter console to relay to the live projection.",
  schema: presenterControlInputSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input) => {
    const access = await assertAccess("deck", input.deckId, "viewer");
    if (input.operation === "goto") {
      const deck = access.resource as { data: string };
      assertPresenterSlideNumber(deck.data, input.slideNumber);
    }
    if (input.operation === "switch-deck") {
      await assertAccess("deck", input.targetDeckId, "viewer");
    }
    const command = await enqueuePresenterCommand(input);
    return {
      ...command,
      message: "Presenter command queued for the open console.",
    };
  },
});
