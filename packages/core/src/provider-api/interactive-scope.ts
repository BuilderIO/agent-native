import { AsyncLocalStorage } from "node:async_hooks";

import { getRequestRunContext } from "../server/request-context.js";

/**
 * A verified binding between a chat turn and the person who started it. A
 * durable run carries one so its tool calls can still count as that person's
 * foreground work after the live request has ended. Structural on purpose:
 * whichever module signs and verifies the grant (a chat-turn store, a durable
 * dispatch payload) passes it in; this module only checks that it is unexpired
 * and that a tool call belongs to it.
 */
export interface ProviderTurnGrant {
  runId: string;
  turnId: string;
  owner: string;
  expiresAt: number;
}

type InteractiveScope = {
  active: boolean;
  action: boolean;
  parent?: InteractiveScope | undefined;
  /** A grant a durable background run carries for its own turn. */
  turnGrant?: ProviderTurnGrant;
  /** A grant an external chat host proved for the turn that called the tool. */
  chatTurnGrant?: ProviderTurnGrant;
  signal?: AbortSignal;
};

const interactiveScope = new AsyncLocalStorage<InteractiveScope>();

function grantExpired(grant: ProviderTurnGrant | undefined): boolean {
  return grant !== undefined && Date.now() >= grant.expiresAt;
}

function hasInteractiveScope(
  actionOnly: boolean,
  allowBackground: boolean,
): boolean {
  if (
    !allowBackground &&
    getRequestRunContext()?.isBackgroundWorker === true &&
    !isChatTurnInteractiveScope()
  )
    return false;
  let scope = interactiveScope.getStore();
  if (!scope || (actionOnly && !scope.action)) return false;
  while (scope) {
    if (
      !scope.active ||
      scope.signal?.aborted ||
      grantExpired(scope.chatTurnGrant) ||
      grantExpired(scope.turnGrant)
    )
      return false;
    scope = scope.parent;
  }
  return true;
}

/** True inside an action whose chain carries a live, unexpired chat-turn grant. */
export function isChatTurnInteractiveScope(): boolean {
  let scope = interactiveScope.getStore();
  if (!scope?.action) return false;
  let proven = false;
  while (scope) {
    if (!scope.active || scope.signal?.aborted) return false;
    if (scope.chatTurnGrant) {
      if (grantExpired(scope.chatTurnGrant)) return false;
      proven = true;
    }
    scope = scope.parent;
  }
  return proven;
}

/**
 * True while a person is waiting on this work: a verified browser action or a
 * live chat turn. A background worker counts only with a chat-turn grant.
 * `actionOnly` also requires the innermost scope to be an action run.
 */
export function isProviderInteractiveScope(actionOnly = false): boolean {
  return hasInteractiveScope(actionOnly, false);
}

/**
 * Like `isProviderInteractiveScope`, but a background worker also counts when
 * its action runs inside a durable turn grant (`runWithDurableTurnToolScope`).
 */
export function isDurableProviderInteractiveScope(): boolean {
  return hasInteractiveScope(
    getRequestRunContext()?.isBackgroundWorker === true,
    true,
  );
}

/**
 * Run one tool call of a durable chat run. When an ancestor scope carries a
 * turn grant and the call belongs to that same run, turn and owner, the call
 * runs as interactive until `signal` aborts; any other call runs explicitly
 * non-interactive. Without a grant the work runs unchanged.
 */
export async function runWithDurableTurnToolScope<T>(
  work: () => T | Promise<T>,
  signal: AbortSignal,
  binding: {
    runId: string | undefined;
    turnId: string | undefined;
    owner: string | null | undefined;
    unattended?: boolean;
    networkProtocol?: string;
  },
): Promise<T> {
  const parent = interactiveScope.getStore();
  let ancestor = parent;
  while (ancestor && !ancestor.turnGrant && !ancestor.chatTurnGrant)
    ancestor = ancestor.parent;
  const grant = ancestor?.chatTurnGrant ?? ancestor?.turnGrant;
  if (!grant) return await work();
  if (
    binding.unattended ||
    (binding.networkProtocol !== undefined &&
      !(binding.networkProtocol === "a2a" && ancestor?.chatTurnGrant)) ||
    binding.runId !== grant.runId ||
    binding.turnId !== grant.turnId ||
    binding.owner?.trim().toLowerCase() !== grant.owner.trim().toLowerCase()
  )
    return runWithProviderInteractiveScope(false, work);
  const scope: InteractiveScope = {
    active: true,
    action: true,
    ...(parent ? { parent } : {}),
    signal,
  };
  return interactiveScope.run(scope, async () => {
    try {
      return await work();
    } finally {
      scope.active = false;
    }
  });
}

/**
 * Mark `work` as interactive (or explicitly not). The scope is revoked when the
 * work settles; a returned `ReadableStream` keeps it until the stream ends, so
 * detached work cannot outlive the action or live chat stream that admitted it.
 */
export async function runWithProviderInteractiveScope<T>(
  interactive: boolean,
  work: () => T | Promise<T>,
  options: {
    action?: boolean;
    turnGrant?: ProviderTurnGrant;
    chatTurnGrant?: ProviderTurnGrant;
  } = {},
): Promise<T> {
  const scope: InteractiveScope = {
    active:
      interactive ||
      options.turnGrant !== undefined ||
      options.chatTurnGrant !== undefined,
    ...(options.chatTurnGrant ? { chatTurnGrant: options.chatTurnGrant } : {}),
    ...(options.turnGrant ? { turnGrant: options.turnGrant } : {}),
    action: options.action !== false,
    parent: interactiveScope.getStore(),
  };
  return interactiveScope.run(scope, async () => {
    let streaming = false;
    try {
      const result = await work();
      if (result instanceof ReadableStream) {
        const reader = result.getReader();
        const stream = new ReadableStream({
          pull(controller) {
            return interactiveScope.run(scope, async () => {
              try {
                const next = await reader.read();
                if (next.done) {
                  scope.active = false;
                  controller.close();
                } else controller.enqueue(next.value);
              } catch (error) {
                scope.active = false;
                controller.error(error);
              }
            });
          },
          cancel(reason) {
            scope.active = false;
            return reader.cancel(reason);
          },
        });
        streaming = true;
        return stream as T;
      }
      return result;
    } finally {
      if (!streaming) scope.active = false;
    }
  });
}
