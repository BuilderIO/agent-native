import {
  compareAndSetClientAppState,
  readClientAppState,
} from "@agent-native/core/client/application-state";
import {
  actionErrorMessage,
  callAction,
  useChangeVersion,
  useDbSync,
  useSession,
} from "@agent-native/core/client/hooks";
import { appStateKey } from "@shared/app-state-tabs";
import {
  isPresenterControlCommandFresh,
  PRESENTER_CONTROL_QUEUE_LIMIT,
  presenterControlQueueSchema,
  type PresenterControlCommand,
  type PresenterControlInput,
} from "@shared/presenter-control";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

import { TAB_ID } from "@/lib/tab-id";

import type { OpenSlidePresenterMessage } from "./presenter-channel";

const QUEUE_KEY = appStateKey("presenter-control-queue");
const QUEUE_VERSION_SOURCE = `app-state:${QUEUE_KEY}`;
const MAX_QUEUE_WRITE_ATTEMPTS = 8;

function isPrivatePresenterPath(
  pathname: string,
  search: string,
  authenticated: boolean,
): boolean {
  const segments = pathname.replace(/\/+$/, "").split("/");
  return (
    authenticated &&
    segments.length === 4 &&
    segments[1] === "deck" &&
    Boolean(segments[2]) &&
    segments[3] === "present" &&
    new URLSearchParams(search).get("view") === "presenter"
  );
}

function presenterMessage(
  command: PresenterControlCommand,
): OpenSlidePresenterMessage {
  switch (command.operation) {
    case "next":
      return { type: "next" };
    case "previous":
      return { type: "prev" };
    case "goto":
      return { type: "goto", index: command.slideNumber - 1 };
    case "blackout":
      return { type: "toggle-blackout", mode: command.mode };
    case "switch-deck":
      return { type: "switch-deck", deckId: command.targetDeckId };
  }
}

async function restorePresenterCommand(
  command: PresenterControlCommand,
  commandIndex: number,
): Promise<boolean> {
  if (!isPresenterControlCommandFresh(command)) return false;

  for (let attempt = 0; attempt < MAX_QUEUE_WRITE_ATTEMPTS; attempt += 1) {
    const current =
      await readClientAppState<Record<string, unknown>>(QUEUE_KEY);
    const parsed =
      current === null
        ? { success: true as const, data: { commands: [] } }
        : presenterControlQueueSchema.safeParse(current);
    if (!parsed.success) {
      throw new Error("Presenter control queue state is invalid.");
    }
    if (
      parsed.data.commands.some(
        (queued) => queued.commandId === command.commandId,
      )
    ) {
      return true;
    }

    const commands = parsed.data.commands.filter((queued) =>
      isPresenterControlCommandFresh(queued),
    );
    if (commands.length >= PRESENTER_CONTROL_QUEUE_LIMIT) return false;
    commands.splice(Math.min(commandIndex, commands.length), 0, command);
    if (
      await compareAndSetClientAppState(
        QUEUE_KEY,
        current,
        { commands },
        { requestSource: TAB_ID },
      )
    ) {
      return true;
    }
  }

  return false;
}

export function usePresenterActionBridge({
  deckId,
  enabled,
  send,
  onSwitchDeck,
}: {
  deckId: string;
  enabled: boolean;
  send: (message: OpenSlidePresenterMessage) => boolean;
  onSwitchDeck: (deckId: string) => void;
}) {
  const drainPromiseRef = useRef<Promise<void> | null>(null);
  const deliveredCommandIdsRef = useRef(new Set<string>());
  const [error, setError] = useState<{ value: unknown } | null>(null);
  const queueVersion = useChangeVersion(QUEUE_VERSION_SOURCE);
  const { pathname, search } = useLocation();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";

  useDbSync({
    ignoreSource: TAB_ID,
    realtime:
      enabled && isPrivatePresenterPath(pathname, search, isAuthenticated)
        ? {
            reason: "relay presenter commands to the linked projection",
          }
        : undefined,
    pauseWhenHidden: false,
  });

  const drainQueue = useCallback(
    async (untilCommandId?: string) => {
      if (!deckId || !enabled) return false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (
          untilCommandId &&
          deliveredCommandIdsRef.current.has(untilCommandId)
        ) {
          return true;
        }

        const activeDrain = drainPromiseRef.current;
        if (activeDrain) {
          await activeDrain;
          continue;
        }

        const drain = (async () => {
          for (let queueAttempt = 0; queueAttempt < 100; queueAttempt += 1) {
            const current =
              await readClientAppState<Record<string, unknown>>(QUEUE_KEY);
            if (current === null) return;

            const parsed = presenterControlQueueSchema.safeParse(current);
            if (!parsed.success) {
              throw new Error("Presenter control queue state is invalid.");
            }

            const fresh = parsed.data.commands.filter((command) =>
              isPresenterControlCommandFresh(command),
            );
            const commandIndex = fresh.findIndex(
              (command) => command.deckId === deckId,
            );
            const command = commandIndex < 0 ? null : fresh[commandIndex];
            const nextCommands =
              commandIndex < 0
                ? fresh
                : fresh.filter((_queued, index) => index !== commandIndex);
            if (nextCommands.length === parsed.data.commands.length) return;

            const claimed = await compareAndSetClientAppState(
              QUEUE_KEY,
              current,
              { commands: nextCommands },
              { requestSource: TAB_ID },
            );
            if (!claimed) continue;

            if (command) {
              let sent = false;
              try {
                sent = send(presenterMessage(command));
              } catch {
                sent = false;
              }
              if (!sent) {
                const restored = await restorePresenterCommand(
                  command,
                  commandIndex,
                );
                throw new Error(
                  restored
                    ? "Presenter command could not reach the live projection."
                    : "Presenter command could not reach the live projection and could not be restored to the queue.",
                );
              }
              if (command.operation === "switch-deck") {
                onSwitchDeck(command.targetDeckId);
              }
              deliveredCommandIdsRef.current.add(command.commandId);
              if (deliveredCommandIdsRef.current.size > 100) {
                const oldest = deliveredCommandIdsRef.current
                  .values()
                  .next().value;
                if (oldest) deliveredCommandIdsRef.current.delete(oldest);
              }
              setError(null);
              if (command.commandId === untilCommandId) return;
            } else if (
              untilCommandId &&
              !fresh.some((queued) => queued.commandId === untilCommandId)
            ) {
              return;
            }
          }
        })();
        drainPromiseRef.current = drain;
        try {
          await drain;
        } finally {
          if (drainPromiseRef.current === drain) {
            drainPromiseRef.current = null;
          }
        }

        if (!untilCommandId) return true;
        if (deliveredCommandIdsRef.current.has(untilCommandId)) return true;

        const current =
          await readClientAppState<Record<string, unknown>>(QUEUE_KEY);
        if (current === null) return true;
        const parsed = presenterControlQueueSchema.safeParse(current);
        if (!parsed.success) {
          throw new Error("Presenter control queue state is invalid.");
        }
        if (
          !parsed.data.commands.some(
            (command) => command.commandId === untilCommandId,
          )
        ) {
          return true;
        }
      }
      return !untilCommandId;
    },
    [deckId, enabled, onSwitchDeck, send],
  );

  useEffect(() => {
    if (!enabled) return;
    const drain = () => {
      void drainQueue().catch((nextError) => {
        setError({ value: nextError });
        console.error(
          "Could not relay a presenter control command.",
          nextError,
        );
      });
    };
    drain();
  }, [drainQueue, enabled, queueVersion]);

  const run = useCallback(
    async (input: PresenterControlInput) => {
      setError(null);
      try {
        const command = await callAction("control-presenter", input);
        const relayed = await drainQueue(command.commandId);
        if (!relayed) {
          throw new Error(
            "Presenter command could not reach the live projection.",
          );
        }
        return true;
      } catch (nextError) {
        setError({ value: nextError });
        return false;
      }
    },
    [drainQueue],
  );

  return {
    run,
    hasError: error !== null,
    errorMessage: error ? actionErrorMessage(error.value) : undefined,
  };
}
