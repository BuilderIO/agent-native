import { getAsyncLocalStorageCtor } from "../shared/optional-node-builtins.js";

// Kept out of an import: `defineAction` reaches this module from the browser
// bundle, which must not load `server/`. The request context registers itself.
let isBackgroundWorkerRun: () => boolean = () => false;

export function registerBackgroundWorkerProbe(probe: () => boolean): void {
  isBackgroundWorkerRun = probe;
}

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
  /** A tool call `runWithDurableTurnToolScope` matched to its run's turn grant. */
  durableTurnCall?: true;
  signal?: AbortSignal;
};

// Absent in the browser, where there is no ambient scope to carry: work simply runs.
const ScopeStorage = getAsyncLocalStorageCtor();
const interactiveScope = ScopeStorage
  ? new ScopeStorage<InteractiveScope>()
  : undefined;

function runInScope<T>(scope: InteractiveScope, work: () => T): T {
  return interactiveScope ? interactiveScope.run(scope, work) : work();
}

function grantExpired(grant: ProviderTurnGrant | undefined): boolean {
  return grant !== undefined && Date.now() >= grant.expiresAt;
}

function hasInteractiveScope(
  actionOnly: boolean,
  allowBackground: boolean,
): boolean {
  if (!allowBackground && isBackgroundWorkerRun() && !hasProvenTurn())
    return false;
  let scope = interactiveScope?.getStore();
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

// A background worker's action counts only for a turn proven on its chain:
// a chat-turn grant, or a durable tool call matched to its run's turn grant.
function hasProvenTurn(): boolean {
  let scope = interactiveScope?.getStore();
  if (!scope?.action) return false;
  while (scope) {
    if (scope.chatTurnGrant || scope.durableTurnCall) return true;
    scope = scope.parent;
  }
  return false;
}

/** True inside an action whose chain carries a live, unexpired chat-turn grant. */
export function isChatTurnInteractiveScope(): boolean {
  let scope = interactiveScope?.getStore();
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
 * True while a person is waiting on this work through a scope: an MCP/tool call
 * made for a live chat turn. A background worker counts only with a chat-turn
 * grant, or inside a durable run's own tool call for the turn its verified
 * grant names (`runWithDurableTurnToolScope`). A browser request is not marked here; a gate recognises it from the
 * request itself. `actionOnly` also requires the innermost scope to be an
 * action run.
 */
export function isProviderInteractiveScope(actionOnly = false): boolean {
  return hasInteractiveScope(actionOnly, false);
}

/**
 * Like `isProviderInteractiveScope`, but a background worker also counts when
 * its action runs inside a durable turn grant (`runWithDurableTurnToolScope`).
 */
export function isDurableProviderInteractiveScope(): boolean {
  return hasInteractiveScope(isBackgroundWorkerRun(), true);
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
  const parent = interactiveScope?.getStore();
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
    durableTurnCall: true,
    ...(parent ? { parent } : {}),
    signal,
  };
  return runInScope(scope, async () => {
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
    /** Revokes the scope when it aborts, e.g. a canceled task. */
    signal?: AbortSignal;
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
    parent: interactiveScope?.getStore(),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  return runInScope(scope, async () => {
    let streaming = false;
    try {
      const result = await work();
      if (result instanceof ReadableStream) {
        const reader = result.getReader();
        const stream = new ReadableStream({
          pull(controller) {
            return runInScope(scope, async () => {
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
