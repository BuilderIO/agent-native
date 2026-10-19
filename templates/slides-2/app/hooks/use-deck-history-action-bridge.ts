import {
  compareAndSetClientAppState,
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/application-state";
import { useChangeVersion, useDbSync } from "@agent-native/core/client/hooks";
import { appStateKey, appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";

import { TAB_ID } from "@/lib/tab-id";

import {
  completeDeckHistoryCommand,
  deckHistoryCommandMatchesStatus,
  deckHistoryCommandSchema,
  deckHistoryStatusSchema,
  DECK_HISTORY_COMMAND_KEY,
  DECK_HISTORY_STATUS_KEY,
  isDeckHistoryOperationAvailable,
  type DeckHistoryCommand,
  type DeckHistoryStatus,
} from "../../shared/deck-history-control.js";

const COMMAND_POLL_RETRY_MS = 500;

function commandIdentityMatches(
  left: DeckHistoryCommand,
  right: DeckHistoryCommand,
): boolean {
  return (
    left.commandId === right.commandId &&
    left.operation === right.operation &&
    left.deckId === right.deckId &&
    left.editorSessionId === right.editorSessionId &&
    left.historyVersion === right.historyVersion
  );
}

function commandStateMatches(value: unknown, expected: DeckHistoryCommand) {
  const parsed = deckHistoryCommandSchema.safeParse(value);
  return (
    parsed.success && JSON.stringify(parsed.data) === JSON.stringify(expected)
  );
}

export function useDeckHistoryActionBridge({
  deckId,
  historyVersion,
  canUndo,
  canRedo,
  enabled,
  undo,
  redo,
  flushDeckSave,
}: {
  deckId: string | undefined;
  historyVersion: number;
  canUndo: boolean;
  canRedo: boolean;
  enabled: boolean;
  undo: (deckId: string) => Promise<boolean>;
  redo: (deckId: string) => Promise<boolean>;
  flushDeckSave: (deckId: string) => Promise<void>;
}): void {
  const [editorSessionId] = useState(() => nanoid());
  const commandKey = appStateKeyForBrowserTab(
    appStateKey(DECK_HISTORY_COMMAND_KEY),
    TAB_ID,
  );
  const commandVersion = useChangeVersion(
    `app-state:${appStateKey(DECK_HISTORY_COMMAND_KEY)}`,
  );
  useDbSync({
    ignoreSource: TAB_ID,
    realtime: { reason: "apply agent commands to DeckEditor history" },
    pauseWhenHidden: false,
  });
  const status = useMemo<DeckHistoryStatus | null>(() => {
    if (!deckId || !enabled) return null;
    return deckHistoryStatusSchema.parse({
      protocolVersion: 1,
      deckId,
      editorSessionId,
      historyVersion,
      canUndo,
      canRedo,
    });
  }, [canRedo, canUndo, deckId, editorSessionId, enabled, historyVersion]);
  const statusRef = useRef<DeckHistoryStatus | null>(status);
  statusRef.current = status;
  const operationsRef = useRef({ undo, redo, flushDeckSave });
  operationsRef.current = { undo, redo, flushDeckSave };
  const executingCommandIdsRef = useRef(new Set<string>());
  const completedCommandsRef = useRef(new Map<string, DeckHistoryCommand>());

  useEffect(() => {
    if (!status) return;
    const key = appStateKeyForBrowserTab(
      appStateKey(DECK_HISTORY_STATUS_KEY),
      TAB_ID,
    );
    void writeClientAppState(key, status, { requestSource: TAB_ID }).catch(
      (error) => console.error("Could not update deck history status.", error),
    );
  }, [status]);

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    let active = false;
    let requested = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (cancelled || retryTimer !== null) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void poll();
      }, COMMAND_POLL_RETRY_MS);
    };

    const acknowledge = async (
      pending: DeckHistoryCommand,
      terminal: DeckHistoryCommand,
      expected: Record<string, unknown>,
    ) => {
      completedCommandsRef.current.set(pending.commandId, terminal);
      if (completedCommandsRef.current.size > 16) {
        const oldest = completedCommandsRef.current.keys().next().value;
        if (oldest) completedCommandsRef.current.delete(oldest);
      }
      try {
        if (
          await compareAndSetClientAppState(
            commandKey,
            expected,
            terminal as unknown as Record<string, unknown>,
            { requestSource: TAB_ID },
          )
        ) {
          return;
        }
        const current = await readClientAppState<unknown>(commandKey);
        if (
          commandStateMatches(current, terminal) ||
          !commandStateMatches(current, pending)
        ) {
          return;
        }
        scheduleRetry();
      } catch (error) {
        console.error("Could not acknowledge the deck history command.", error);
        scheduleRetry();
      }
    };

    const poll = async () => {
      if (cancelled) return;
      if (active) {
        requested = true;
        return;
      }
      active = true;
      try {
        const state = await readClientAppState<unknown>(commandKey);
        if (cancelled) return;
        const parsed = deckHistoryCommandSchema.safeParse(state);
        if (!parsed.success || parsed.data.status !== "pending") return;
        const pending = parsed.data;
        const cached = completedCommandsRef.current.get(pending.commandId);
        if (cached) {
          const terminal = commandIdentityMatches(pending, cached)
            ? cached
            : completeDeckHistoryCommand(pending, {
                status: "rejected",
                failureCode: "command_failed",
              });
          await acknowledge(
            pending,
            terminal,
            state as Record<string, unknown>,
          );
          return;
        }
        if (executingCommandIdsRef.current.has(pending.commandId)) return;

        const currentStatus = statusRef.current;
        let result:
          | { status: "applied" }
          | {
              status: "rejected";
              failureCode: NonNullable<DeckHistoryCommand["failureCode"]>;
            };
        if (
          !currentStatus ||
          !deckHistoryCommandMatchesStatus(pending, currentStatus) ||
          pending.deckId !== deckId
        ) {
          result = { status: "rejected", failureCode: "stale_editor_state" };
        } else if (
          !isDeckHistoryOperationAvailable(currentStatus, pending.operation)
        ) {
          result = { status: "rejected", failureCode: "command_unavailable" };
        } else {
          executingCommandIdsRef.current.add(pending.commandId);
          try {
            const applied =
              await operationsRef.current[pending.operation](deckId);
            if (!applied) {
              result = {
                status: "rejected",
                failureCode: "command_failed",
              };
            } else {
              try {
                await operationsRef.current.flushDeckSave(deckId);
                result = { status: "applied" };
              } catch (error) {
                console.error("Could not persist deck history command.", error);
                result = {
                  status: "rejected",
                  failureCode: "persistence_failed",
                };
              }
            }
          } catch (error) {
            console.error("Could not apply deck history command.", error);
            result = { status: "rejected", failureCode: "command_failed" };
          } finally {
            executingCommandIdsRef.current.delete(pending.commandId);
          }
        }
        await acknowledge(
          pending,
          completeDeckHistoryCommand(pending, result),
          state as Record<string, unknown>,
        );
      } catch (error) {
        console.error("Could not read the deck history command.", error);
        scheduleRetry();
      } finally {
        active = false;
        if (requested && !cancelled) {
          requested = false;
          void poll();
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [commandKey, commandVersion, deckId]);
}
